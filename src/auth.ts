import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminCreateUserCommand,
  AdminGetUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  MessageActionType,
  AttributeType,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import Twilio from "twilio";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";
import { CONFIG } from "./config.js";

const cognitoClient = new CognitoIdentityProviderClient({
  region: CONFIG.REGION,
});
const dynamoClient = new DynamoDBClient({ region: CONFIG.REGION });
const docClient = DynamoDBDocumentClient.from(dynamoClient);

let twilioClient: any;
if (CONFIG.TWILIO.ENABLE_SMS) {
  twilioClient = Twilio(CONFIG.TWILIO.ACCOUNT_SID, CONFIG.TWILIO.AUTH_TOKEN);
}

interface SendOTPInput {
  phoneNumber: string;
}

interface VerifyOTPInput {
  phoneNumber: string;
  otp: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  zipCode?: string;
}

interface VerifyEmailInput {
  email: string;
}

interface UpdateProfileInput {
  firstName: string;
  lastName?: string;
  email?: string;
  address?: string;
  zipCode?: string;
}

// Helper: Check rate limit
async function checkRateLimit(phoneNumber: string): Promise<boolean> {
  const now = Date.now();
  const oneMinuteAgo = now - CONFIG.RATE_LIMIT_WINDOW * 1000;

  const params = {
    TableName: CONFIG.RATE_LIMIT_TABLE,
    KeyConditionExpression: "phoneNumber = :phone AND #ts > :timeLimit",
    ExpressionAttributeNames: {
      "#ts": "timestamp",
    },
    ExpressionAttributeValues: {
      ":phone": phoneNumber,
      ":timeLimit": oneMinuteAgo,
    },
  };

  const result = await docClient.send(new QueryCommand(params));
  const requestCount = result.Items?.length || 0;

  return requestCount < CONFIG.MAX_OTP_REQUESTS;
}

// Helper: Record OTP request
async function recordOTPRequest(phoneNumber: string): Promise<void> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + CONFIG.RATE_LIMIT_WINDOW * 2; // TTL 2 minutes

  await docClient.send(
    new PutCommand({
      TableName: CONFIG.RATE_LIMIT_TABLE,
      Item: {
        phoneNumber,
        timestamp: now,
        ttl,
      },
    })
  );
}

// Helper: Store OTP
async function storeOTP(phoneNumber: string, otp: string): Promise<void> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + CONFIG.OTP_EXPIRY_SECONDS;

  await docClient.send(
    new PutCommand({
      TableName: CONFIG.OTP_STORE_TABLE,
      Item: {
        phoneNumber,
        otp,
        createdAt: now,
        ttl,
      },
    })
  );
}

// Helper: Verify and get OTP
async function verifyStoredOTP(
  phoneNumber: string,
  otp: string
): Promise<boolean> {
  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: CONFIG.OTP_STORE_TABLE,
        Key: { phoneNumber },
      })
    );

    if (!result.Item) {
      return false;
    }

    const now = Date.now();
    const expiryTime = result.Item.createdAt + CONFIG.OTP_EXPIRY_SECONDS * 1000;

    if (now > expiryTime) {
      // OTP expired, delete it
      await docClient.send(
        new DeleteCommand({
          TableName: CONFIG.OTP_STORE_TABLE,
          Key: { phoneNumber },
        })
      );
      return false;
    }

    const isValid = result.Item.otp === otp;

    // Delete OTP after verification attempt (one-time use)
    if (isValid) {
      await docClient.send(
        new DeleteCommand({
          TableName: CONFIG.OTP_STORE_TABLE,
          Key: { phoneNumber },
        })
      );
    }

    return isValid;
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return false;
  }
}

// Helper: Generate OTP
function generateOTP(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Helper: Upsert user record in BIDDU_USERS_TABLE
async function putBidduUser(params: {
  sub: string;
  phoneNumber: string;
  name: string;
  emailId?: string;
}): Promise<void> {
  const item: Record<string, any> = {
    sub: params.sub,
    phoneNumber: params.phoneNumber,
    name: params.name,
  };
  if (params.emailId && params.emailId.trim()) {
    item.emailId = params.emailId.trim();
  }

  await docClient.send(
    new PutCommand({
      TableName: CONFIG.USERS_TABLE,
      Item: item,
    })
  );
}

// Helper: Get user by phone number (tries GSI, falls back to Scan)
async function getUserByPhone(phoneNumber: string): Promise<any> {
  try {
    const query = await docClient.send(
      new QueryCommand({
        TableName: CONFIG.USERS_TABLE,
        IndexName: "phoneNumber-index",
        KeyConditionExpression: "#pn = :phone",
        ExpressionAttributeNames: { "#pn": "phoneNumber" },
        ExpressionAttributeValues: { ":phone": phoneNumber },
        Limit: 1,
      })
    );
    if ((query.Items?.length || 0) > 0) return query.Items?.[0];
  } catch (err) {
    console.error("error searching for user by phone number::", err);
    return null;
    // Likely index not created/active yet, fall back to Scan
  }
}

// Helper: Check if email is already used (tries GSI, falls back to Scan)
async function checkEmailExists(email: string): Promise<boolean> {
  try {
    const query = await docClient.send(
      new QueryCommand({
        TableName: CONFIG.USERS_TABLE,
        IndexName: "emailId-index",
        KeyConditionExpression: "#em = :email",
        ExpressionAttributeNames: { "#em": "emailId" },
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
      })
    );
    if ((query.Items?.length || 0) > 0) return true;
  } catch (_) {
    // fall through to Scan
  }
  try {
    const scan = await docClient.send(
      new ScanCommand({
        TableName: CONFIG.USERS_TABLE,
        FilterExpression: "#em = :email",
        ExpressionAttributeNames: { "#em": "emailId" },
        ExpressionAttributeValues: { ":email": email },
        Limit: 1,
      })
    );
    return (scan.Items?.length || 0) > 0;
  } catch (error) {
    console.error("Error checking email existence:", error);
    return false;
  }
}

// Helper: Send SMS (you'll need to implement actual SMS sending)
async function sendSMS(phoneNumber: string, message: string): Promise<void> {
  console.log(`Sending SMS to ${phoneNumber}: ${message}`);
  if (!twilioClient) {
    return;
  }

  await twilioClient.messages.create({
    body: message,
    to: phoneNumber,
    from: CONFIG.TWILIO.FROM_NUMBER,
  });
}

// Mutation: sendOTP
export async function sendOTP(args: SendOTPInput) {
  const { phoneNumber } = args;

  // Check rate limit
  const withinLimit = await checkRateLimit(phoneNumber);
  if (!withinLimit) {
    return {
      success: false,
      message: "Too many requests. Please try again after 1 minute.",
      isNewUser: false,
      expiresIn: 0,
    };
  }

  // Check if user exists
  const userExists = await getUserByPhone(phoneNumber);

  try {
    // Generate OTP
    const otp = generateOTP();

    // Store OTP
    await storeOTP(phoneNumber, otp);

    // Record rate limit
    await recordOTPRequest(phoneNumber);

    // Send SMS
    const message = userExists
      ? `Your Biddu login OTP is ${otp}. Valid for 10 minutes.`
      : `Your Biddu signup OTP is ${otp}. Valid for 10 minutes.`;

    await sendSMS(phoneNumber, message);

    return {
      success: true,
      message: userExists
        ? "Login OTP sent successfully"
        : "Signup OTP sent successfully",
      isNewUser: !userExists,
      expiresIn: CONFIG.OTP_EXPIRY_SECONDS,
      otp: CONFIG.TWILIO.ENABLE_SMS ? null : otp,
    };
  } catch (error: any) {
    console.error("Error sending OTP:", error);
    return {
      success: false,
      message: error.message || "Failed to send OTP",
      isNewUser: false,
      expiresIn: 0,
    };
  }
}

// Mutation: verifyOTP to create or login user
// if user exists, login user
// if user does not exist, create user
export async function verifyOTP(args: { input: VerifyOTPInput }) {
  const { input } = args;
  const { phoneNumber, otp, firstName, email } = input;

  // Verify OTP
  const isValidOTP = await verifyStoredOTP(phoneNumber, otp);

  if (!isValidOTP) {
    return {
      success: false,
      message: "Invalid or expired OTP",
      isNewUser: false,
      accessToken: null,
      idToken: null,
      refreshToken: null,
      user: null,
    };
  }

  try {
    // Check if user exists
    const user = await getUserByPhone(phoneNumber);

    if (user) {
      // For existing users, we'll use a workaround:
      // Set a temporary password and authenticate
      const tempPassword = generateTemporaryPassword();

      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: CONFIG.USER_POOL_ID,
          Username: phoneNumber,
          Password: tempPassword,
          Permanent: true,
        })
      );

      const authResponse = await cognitoClient.send(
        new AdminInitiateAuthCommand({
          UserPoolId: CONFIG.USER_POOL_ID,
          ClientId: CONFIG.CLIENT_ID,
          AuthFlow: "ADMIN_NO_SRP_AUTH",
          AuthParameters: {
            USERNAME: phoneNumber,
            PASSWORD: tempPassword,
          },
        })
      );

      return {
        success: true,
        message: "Login successful",
        isNewUser: false,
        accessToken: authResponse.AuthenticationResult?.AccessToken || null,
        idToken: authResponse.AuthenticationResult?.IdToken || null,
        refreshToken: authResponse.AuthenticationResult?.RefreshToken || null,
      };
    } else {
      // Validate firstName is provided
      if (!firstName || firstName.trim() === "") {
        return {
          success: false,
          message: "Name is required",
          isNewUser: false,
          accessToken: null,
          idToken: null,
          refreshToken: null,
          user: null,
        };
      }

      // Create new user
      const userAttributes: AttributeType[] = [
        { Name: "phone_number", Value: phoneNumber },
        { Name: "phone_number_verified", Value: "true" },
        { Name: "given_name", Value: firstName.trim() },
      ];

      if (email && email.trim()) {
        userAttributes.push({ Name: "email", Value: email.trim() });
        userAttributes.push({ Name: "email_verified", Value: "false" });
      }

      // Generate temporary password
      const tempPassword = generateTemporaryPassword();

      // Create user
      const createUserCommand = new AdminCreateUserCommand({
        UserPoolId: CONFIG.USER_POOL_ID,
        Username: phoneNumber,
        UserAttributes: userAttributes,
        TemporaryPassword: tempPassword,
        MessageAction: MessageActionType.SUPPRESS, // Don't send email/SMS
      });

      await cognitoClient.send(createUserCommand);

      // Set permanent password
      await cognitoClient.send(
        new AdminSetUserPasswordCommand({
          UserPoolId: CONFIG.USER_POOL_ID,
          Username: phoneNumber,
          Password: tempPassword,
          Permanent: true,
        })
      );

      // Fetch created user's sub and persist to BIDDU_USERS_TABLE
      const createdUser = await cognitoClient.send(
        new AdminGetUserCommand({
          UserPoolId: CONFIG.USER_POOL_ID,
          Username: phoneNumber,
        })
      );
      const subAttr = createdUser.UserAttributes?.find(
        (a) => a.Name === "sub"
      )?.Value;
      if (subAttr) {
        await putBidduUser({
          sub: subAttr,
          phoneNumber,
          name: firstName.trim(),
          emailId: email?.trim(),
        });
      }

      // Authenticate the new user
      const authResponse = await cognitoClient.send(
        new AdminInitiateAuthCommand({
          UserPoolId: CONFIG.USER_POOL_ID,
          ClientId: CONFIG.CLIENT_ID,
          AuthFlow: "ADMIN_NO_SRP_AUTH",
          AuthParameters: {
            USERNAME: phoneNumber,
            PASSWORD: tempPassword,
          },
        })
      );

      return {
        success: true,
        message: "User created and logged in successfully",
        isNewUser: true,
        accessToken: authResponse.AuthenticationResult?.AccessToken || null,
        idToken: authResponse.AuthenticationResult?.IdToken || null,
        refreshToken: authResponse.AuthenticationResult?.RefreshToken || null,
      };
    }
  } catch (error: any) {
    console.error("Error verifying OTP:", error);
    return {
      success: false,
      message: error.message || "Failed to verify OTP",
      isNewUser: false,
      accessToken: null,
      idToken: null,
      refreshToken: null,
      user: null,
    };
  }
}

// Mutation: verifyEmailId
export async function verifyEmailId(args: VerifyEmailInput) {
  const { email } = args;

  if (!email || !email.trim()) {
    return {
      available: false,
      message: "Email is required",
    };
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return {
      available: false,
      message: "Invalid email format",
    };
  }

  try {
    const emailExists = await checkEmailExists(email.trim());

    return {
      available: !emailExists,
      message: emailExists ? "Email already in use" : "Email is available",
    };
  } catch (error: any) {
    console.error("Error verifying email:", error);
    return {
      available: false,
      message: "Error checking email availability",
    };
  }
}

// Mutation: updateProfile
export async function updateProfile(
  args: { input: UpdateProfileInput },
  context: any
) {
  const { input } = args;
  const username = context.username; // From JWT token

  if (!username) {
    return {
      success: false,
      message: "User not authenticated",
      user: null,
    };
  }

  // Validate firstName
  if (!input.firstName || input.firstName.trim() === "") {
    return {
      success: false,
      message: "First name is required",
      user: null,
    };
  }

  try {
    // If email provided, check if it's already used by another user
    if (input.email && input.email.trim()) {
      const getUserCommand = new AdminGetUserCommand({
        UserPoolId: CONFIG.USER_POOL_ID,
        Username: username,
      });
      const currentUser = await cognitoClient.send(getUserCommand);
      const currentEmail = currentUser.UserAttributes?.find(
        (a) => a.Name === "email"
      )?.Value;

      // Only check if email is different from current email
      if (currentEmail !== input.email.trim()) {
        const emailExists = await checkEmailExists(input.email.trim());
        if (emailExists) {
          return {
            success: false,
            message: "Email already in use",
            user: null,
          };
        }
      }
    }

    const attributes: AttributeType[] = [
      { Name: "given_name", Value: input.firstName.trim() },
    ];

    if (input.lastName && input.lastName.trim()) {
      attributes.push({ Name: "family_name", Value: input.lastName.trim() });
    }

    if (input.email && input.email.trim()) {
      attributes.push({ Name: "email", Value: input.email.trim() });
      attributes.push({ Name: "email_verified", Value: "false" }); // Will need verification
    }

    if (input.address && input.address.trim()) {
      attributes.push({ Name: "address", Value: input.address.trim() });
    }

    if (input.zipCode && input.zipCode.trim()) {
      attributes.push({ Name: "zoneinfo", Value: input.zipCode.trim() });
    }

    const command = new AdminUpdateUserAttributesCommand({
      UserPoolId: CONFIG.USER_POOL_ID,
      Username: username,
      UserAttributes: attributes,
    });

    await cognitoClient.send(command);

    // Get updated user info
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: CONFIG.USER_POOL_ID,
      Username: username,
    });

    const userResponse = await cognitoClient.send(getUserCommand);
    const userAttrs = userResponse.UserAttributes || [];

    const user = {
      phoneNumber:
        userAttrs.find((a) => a.Name === "phone_number")?.Value || "",
      firstName: userAttrs.find((a) => a.Name === "given_name")?.Value || "",
      lastName: userAttrs.find((a) => a.Name === "family_name")?.Value || "",
      email: userAttrs.find((a) => a.Name === "email")?.Value || "",
      address: userAttrs.find((a) => a.Name === "address")?.Value || "",
      zipCode: userAttrs.find((a) => a.Name === "zoneinfo")?.Value || "",
      emailVerified:
        userAttrs.find((a) => a.Name === "email_verified")?.Value === "true",
    };

    return {
      success: true,
      message: "Profile updated successfully",
      user,
    };
  } catch (error: any) {
    console.error("Error updating profile:", error);
    return {
      success: false,
      message: error.message || "Failed to update profile",
      user: null,
    };
  }
}

// Helper function
function generateTemporaryPassword(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let password = "";

  // Ensure at least one uppercase, lowercase, number, and special char
  password += "A";
  password += "a";
  password += "1";
  password += "!";

  // Fill rest randomly
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  // Shuffle
  return password
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
}

// Lambda handlers for direct HTTP endpoints
export const handler = {
  sendOTP: async (event: any) => {
    const body = JSON.parse(event.body || "{}");
    const result = await sendOTP(body);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(result),
    };
  },
  verifyOTP: async (event: any) => {
    const body = JSON.parse(event.body || "{}");
    const result = await verifyOTP(body);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(result),
    };
  },
  verifyEmailId: async (event: any) => {
    const body = JSON.parse(event.body || "{}");
    const result = await verifyEmailId(body);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(result),
    };
  },
  updateProfile: async (event: any) => {
    const body = JSON.parse(event.body || "{}");
    const context = {
      username: event.requestContext?.authorizer?.jwt?.claims?.sub,
    };
    const result = await updateProfile(body, context);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(result),
    };
  },
};

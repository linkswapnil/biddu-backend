import 'dotenv/config';
import {
  createYoga,
  GraphQLSchemaWithContext,
  YogaInitialContext,
} from "graphql-yoga";
import { schema } from "./schema.js";
import jwt, { JwtPayload } from "jsonwebtoken";
import { verifyIdToken } from "./jws-verify.js";
import { UserTypes } from './types.js';

interface CognitoJwtClaims extends JwtPayload {
  "cognito:groups"?: string[];
  "cognito:username"?: string;
  email?: string;
  given_name?: string;
  family_name?: string;
  phone_number?: string;
}

export interface YogaContext {
  jwtClaims?: CognitoJwtClaims;
  jwtGroups: string[];
  username?: string;
  email?: string;
  userSub?: string;
  authSource?: UserTypes;
}

export const yoga = createYoga({
  schema: schema as GraphQLSchemaWithContext<YogaInitialContext & YogaContext>,
  context: async ({ request }): Promise<YogaContext> => {
    try {
      const auth = request.headers.get("authorization") ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
      if (!token) return { jwtGroups: [] };

      const claims = await verifyIdToken(token);
      const groups = (claims["cognito:groups"] as string[]) ?? [];
      const bidduIssuer = `https://cognito-idp.${process.env.REGION}.amazonaws.com/${process.env.OTP_USER_POOL_ID}`;
      const authSource = claims.iss === bidduIssuer ? UserTypes.BIDDU : UserTypes.ADMIN;
      return {
        jwtClaims: claims,
        jwtGroups: groups,
        username: claims["cognito:username"],
        userSub: claims.sub,
        email: claims.email,
        authSource,
      };
    } catch (err) {
      console.error("❌ Error while building context:", err);
      return { jwtGroups: [] };
    }
  },
  // cors: {
  //   origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  //   credentials: true,
  // },
});

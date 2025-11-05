  
  // Centralized config extraction and validation
  const getEnv = (key: string, required = true): string => {
    const value = process.env[key];
    if (!value && required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return value!;
  };
  
  // App Configuration
  export const CONFIG = {
    REGION: getEnv("REGION"),
    USER_POOL_ID: getEnv("OTP_USER_POOL_ID"),
    CLIENT_ID: getEnv("OTP_CLIENT_ID"),
    RATE_LIMIT_TABLE: getEnv("OTP_RATE_LIMIT_TABLE"),
    OTP_STORE_TABLE: process.env.OTP_STORE_TABLE || `${getEnv("OTP_RATE_LIMIT_TABLE")}-store`,
    USERS_TABLE: getEnv("BIDDU_USERS_TABLE"),
    OTP_EXPIRY_SECONDS: Number(process.env.OTP_EXPIRY_SECONDS) || 600, // 10 minutes
    MAX_OTP_REQUESTS: Number(process.env.MAX_OTP_REQUESTS) || 5,
    RATE_LIMIT_WINDOW: Number(process.env.RATE_LIMIT_WINDOW) || 60, // 1 minute
    BIDDU_PRODUCTS_TABLE: getEnv("BIDDU_PRODUCTS_TABLE"),
    BIDDU_PRODUCT_LOCATIONS_TABLE: getEnv("BIDDU_PRODUCT_LOCATIONS_TABLE"),
    TWILIO: {
      ACCOUNT_SID: getEnv("TWILIO_ACCOUNT_SID"),
      AUTH_TOKEN: getEnv("TWILIO_AUTH_TOKEN"),
      FROM_NUMBER: getEnv("TWILIO_PHONE_NUMBER"),
      ENABLE_SMS: process.env.ENABLE_SMS === "true",
    },
  };
  
import 'dotenv/config';
import {
  createYoga,
  GraphQLSchemaWithContext,
  YogaInitialContext,
} from "graphql-yoga";
import { schema } from "./schema.js";
import jwt, { JwtPayload } from "jsonwebtoken";
import { verifyIdToken } from "./jws-verify.js";

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
      return {
        jwtClaims: claims,
        jwtGroups: groups,
        username: claims["cognito:username"],
        userSub: claims.sub,
        email: claims.email,
      };
    } catch (err) {
      console.error("❌ Error while building context:", err);
      return { jwtGroups: [] };
    }
  },
});

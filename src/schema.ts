import { createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { YogaContext } from "./yoga";
import { ADMIN_GROUP_NAME } from "./constants.js";
import {
  sendOTP as authSendOTP,
  verifyOTP as authVerifyOTP,
  verifyEmailId as authVerifyEmailId,
  updateProfile as authUpdateProfile,
} from "./auth.js";
// import { addProduct as productAddProduct } from "./product.js"; // Removed since 'addProduct' is not exported
import { handler as productHandler } from "./product.js";
import { UserTypes } from "./types.js";
const PRODUCTS = [
  { id: "1", name: "Laptop", price: 1299.99 },
  { id: "2", name: "Headphones", price: 199.5 },
  { id: "3", name: "Keyboard", price: 89.0 },
];

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    """
    A simple product entity used for demo purposes
    """
    type Product {
      id: ID!
      name: String!
      price: Float!
    }

    type Query {
      greetings(name: String): String!
      products: [Product!]!
    }

    type Mutation {
      sendOTP(phoneNumber: String!): SendOTPResponse!
      verifyOTP(input: VerifyOTPInput!): VerifyOTPResponse!
      verifyEmailId(email: String!): EmailVerificationResponse!
      updateProfile(input: UpdateProfileInput!): UpdateProfileResponse!
      addProduct(input: AddBidProductInput!): BidProduct
    }

    input AddProductInput {
      name: String!
      price: Float!
    }

    type AddProductResponse {
      success: Boolean!
      message: String!
    }

    type SendOTPResponse {
      success: Boolean!
      message: String!
      isNewUser: Boolean!
      otp: String
      expiresIn: Int! # in seconds (600 for 10 minutes)
    }

    input VerifyOTPInput {
      phoneNumber: String!
      otp: String!
      firstName: String
      lastName: String
      email: String
      address: String
      zipCode: String
    }

    type VerifyOTPResponse {
      success: Boolean!
      message: String!
      isNewUser: Boolean!
      accessToken: String
      idToken: String
      refreshToken: String
      requiresProfileCompletion: Boolean
    }

    type EmailVerificationResponse {
      available: Boolean!
      message: String!
    }

    type UpdateProfileResponse {
      success: Boolean!
      message: String!
      user: User
    }

    input UpdateProfileInput {
      firstName: String!
      lastName: String
      email: String
      address: String
      zipCode: String
    }

    type User {
      phoneNumber: String!
      firstName: String!
      lastName: String
      email: String
      address: String
      zipCode: String
      emailVerified: Boolean
    }

    input AddBidProductInput {
      name: String!
      expectedPrice: Float!
      bidStartDate: Float!
      bidEndDate: Float!
      videoUrls: [String!]
      imageUrls: [String!]
      descriptionText: String
      userId: String!
      location: LocationInput!
      locationName: String!
    }

    input LocationInput {
      lat: Float!
      lng: Float!
    }

    type BidProduct {
      productId: ID!
      name: String!
      expectedPrice: Float!
      bidStartDate: Float!
      bidEndDate: Float!
      videoUrls: [String]
      imageUrls: [String]
      descriptionText: String
      userId: String!
      location: Location
      locationName: String
    }

    type Location {
      lat: Float
      lng: Float
    }
  `,
  resolvers: {
    Query: {
      greetings: (_: unknown, args: { name?: string }) => {
        return `Hello ${args.name ?? "world"}!`;
      },
      products: (_: unknown, __: unknown, context: YogaContext) => {
        const { jwtGroups } = context;
        if (!jwtGroups.includes(ADMIN_GROUP_NAME)) {
          throw new GraphQLError("Unauthorized");
        }
        return PRODUCTS;
      },
    },
    Mutation: {
      sendOTP: (_: unknown, args: { phoneNumber: string }) => {
        return authSendOTP(args);
      },
      verifyOTP: (_: unknown, args: { input: unknown }) => {
        return authVerifyOTP(args as { input: any });
      },
      verifyEmailId: (_: unknown, args: { email: string }) => {
        return authVerifyEmailId(args);
      },
      updateProfile: (
        _: unknown,
        args: { input: unknown },
        context: YogaContext
      ) => {
        return authUpdateProfile(args as { input: any }, context);
      },
      addProduct: (
        _: unknown,
        args: { input: unknown },
        context: YogaContext
      ) => {
        if (context.authSource !== UserTypes.BIDDU && !context.username) {
          throw new GraphQLError("Unauthorized");
        }
        // product handler expects an API Gateway-like event with body
        return productHandler.addProduct(args, context.username as string);
      },
    },
  },
});

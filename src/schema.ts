import { createSchema } from "graphql-yoga";
import { GraphQLError } from "graphql";
import { YogaContext } from "./yoga";
import { ADMIN_GROUP_NAME } from "./constants.js";
import {
  sendOTP as authSendOTP,
  verifyOTP as authVerifyOTP,
  verifyEmailId as authVerifyEmailId,
  updateProfile as authUpdateProfile,
  login as authLogin,
} from "./auth.js";
// import { addProduct as productAddProduct } from "./product.js"; // Removed since 'addProduct' is not exported
import { handler as productHandler } from "./product.js";
import { handler as categoryHandler } from "./category.js";
import { UserTypes } from "./types.js";
const PRODUCTS = [
  { id: "1", name: "Laptop", price: 1299.99 },
  { id: "2", name: "Headphones", price: 199.5 },
  { id: "3", name: "Keyboard", price: 89.0 },
];

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    type Product {
      name: String!
      price: Float!
    }

    input SearchNearbyProductsInput {
      lat: Float!
      lng: Float!
      radiusInKm: Float!
    }

    input SearchProductsInput {
      name: String
      categoryId: String
      subCategoryId: String
      minPrice: Float
      maxPrice: Float
      verified: Boolean
      refurbished: Boolean
      userId: String
      bidStartDate: Float
      bidEndDate: Float
      location: SearchLocationInput
      locationDetails: SearchLocationDetailsInput
    }

    input SearchLocationInput {
      lat: Float!
      lng: Float!
    }

    input SearchLocationDetailsInput {
      zipcode: String
      addressText: String
      city: String
      state: String
      country: String
    }

    type Query {
      greetings(name: String): String!
      products: [Product!]!
      searchNearbyProducts(
        input: SearchNearbyProductsInput!
      ): [BidProductWithDistance!]!
      searchProducts(input: SearchProductsInput): [BidProduct!]!
      getAllCategories: [CategoryWithSubCategories!]!
      getProductBids(productId: String!): [BidWithUser!]!
    }

    type Mutation {
      sendOTP(phoneNumber: String!): SendOTPResponse!
      verifyOTP(input: VerifyOTPInput!): VerifyOTPResponse!
      verifyEmailId(email: String!): EmailVerificationResponse!
      login(input: LoginInput!): LoginResponse!
      updateProfile(input: UpdateProfileInput!): UpdateProfileResponse!
      addProduct(input: AddBidProductInput!): BidProduct
      updateProduct(input: UpdateProductInput!): BidProduct!
      addCategory(input: AddCategoryInput!): Category!
      deleteCategory(categoryId: String!): DeleteResponse!
      addSubCategory(input: AddSubCategoryInput!): SubCategory!
      deleteSubCategory(subCategoryId: String!): DeleteResponse!
      addBid(input: AddBidInput!): Bid!
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

    input LoginInput {
      username: String!
      password: String!
    }

    type LoginResponse {
      success: Boolean!
      message: String!
      accessToken: String
      idToken: String
      refreshToken: String
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
      productId: ID
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
      verified: Boolean
      categoryId: String
      subCategoryId: String
      refurbished: Boolean
      faqs: [FAQ!]
      locationDetails: LocationDetails
      createdAt: Float
      updatedAt: Float
    }

    type Location {
      lat: Float
      lng: Float
    }

    type LocationDetails {
      zipcode: String
      addressText: String
      state: String
      city: String
      country: String
    }

    type FAQ {
      faqId: ID!
      question: String!
      answer: String
      askedBy: String!
    }

    input UpdateProductInput {
      productId: String!
      name: String
      expectedPrice: Float
      bidStartDate: Float
      bidEndDate: Float
      videoUrls: [String!]
      imageUrls: [String!]
      descriptionText: String
      verified: Boolean
      categoryId: String
      subCategoryId: String
      refurbished: Boolean
      addFAQ: AddFAQInput
      locationDetails: LocationDetailsInput
    }

    input AddFAQInput {
      question: String!
      answer: String
    }

    input LocationDetailsInput {
      zipcode: String
      addressText: String
      state: String
      city: String
      country: String
    }

    type BidProductWithDistance {
      productId: ID!
      name: String!
      expectedPrice: Float
      descriptionText: String
      imageUrls: [String]
      videoUrls: [String]
      bidStartDate: Float!
      bidEndDate: Float!
      userId: String!
      locationName: String
      distance: Float!
      highestBidPrice: Float
      totalBids: Int
    }

    type Category {
      categoryId: ID!
      categoryName: String!
    }

    type SubCategory {
      subCategoryId: ID!
      categoryId: ID!
      name: String!
    }

    type CategoryWithSubCategories {
      categoryId: ID!
      categoryName: String!
      subCategories: [SubCategory!]!
    }

    input AddCategoryInput {
      categoryName: String!
    }

    input AddSubCategoryInput {
      categoryId: String!
      name: String!
    }

    type DeleteResponse {
      success: Boolean!
      message: String!
    }

    input AddBidInput {
      productId: String!
      bidPrice: Float!
    }

    type Bid {
      bidId: ID!
      productId: ID!
      userId: String!
      bidPrice: Float!
      createdAt: Float!
    }

    type BidWithUser {
      bidId: ID!
      productId: ID!
      bidPrice: Float!
      createdAt: Float!
      user: BidUser
    }

    type BidUser {
      phoneNumber: String
      name: String
      emailId: String
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
      searchNearbyProducts: async (_: unknown, args: { input: any }) => {
        const resp = await productHandler.searchNearbyProducts({
          input: args.input,
        });
        const body =
          typeof (resp as any).body === "string"
            ? JSON.parse((resp as any).body)
            : (resp as any).body;
        return body;
      },
      getAllCategories: async () => {
        return categoryHandler.getAllCategories();
      },
      searchProducts: async (_: unknown, args: { input: any }) => {
        return productHandler.searchProducts({ input: args.input || {} });
      },
      getProductBids: async (
        _: unknown,
        args: { productId: string },
        context: YogaContext
      ) => {
        if (!context.username) {
          throw new GraphQLError("Unauthorized");
        }
        return productHandler.getProductBids(
          args.productId,
          context.username,
          context.jwtGroups || []
        );
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
      login: (_: unknown, args: { input: unknown }) => {
        const { input } = args as { input: { username: string; password: string } };
        return authLogin({ username: input.username, password: input.password });
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
        return productHandler.addProduct(args, context.username as string);
        // product handler expects an API Gateway-like event with body
        // return productHandler.addProduct(
        //   args,
        //   (context.username as string) || "11838dba-a051-706f-4266-8f61458049f1"
        // );
      },
      updateProduct: async (
        _: unknown,
        args: { input: unknown },
        context: YogaContext
      ) => {
        if (!context.username) {
          throw new GraphQLError("Unauthorized");
        }
        const input = args.input as any;
        // Check if user is the seller (product owner)
        // The updateProduct handler will fetch the product and verify ownership
        // For admin users, set isSeller to true to allow updates
        const isSeller = context.jwtGroups?.includes(ADMIN_GROUP_NAME) || false;
        return productHandler.updateProduct(
          args,
          context.username as string,
          isSeller
        );
      },
      addCategory: (_: unknown, args: { input: any }) => {
        return categoryHandler.addCategory(args);
      },
      deleteCategory: (_: unknown, args: { categoryId: string }) => {
        return categoryHandler.deleteCategory(args);
      },
      addSubCategory: (_: unknown, args: { input: any }) => {
        return categoryHandler.addSubCategory(args);
      },
      deleteSubCategory: (_: unknown, args: { subCategoryId: string }) => {
        return categoryHandler.deleteSubCategory(args);
      },
      addBid: (
        _: unknown,
        args: { input: unknown },
        context: YogaContext
      ) => {
        if (!context.username) {
          throw new GraphQLError("Unauthorized");
        }
        return productHandler.addBid(args, context.username as string);
      },
    },
  },
});

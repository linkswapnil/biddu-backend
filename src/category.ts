import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { CONFIG } from "./config.js";

const ddb = new DynamoDBClient({ region: CONFIG.REGION });
const docClient = DynamoDBDocumentClient.from(ddb);

export const handler = {
  addCategory: async (args: { input: { categoryName: string } }) => {
    const { categoryName } = args.input;
    if (!categoryName || !categoryName.trim()) {
      throw new Error("Category name is required");
    }

    const categoryId = uuidv4();
    await docClient.send(
      new PutCommand({
        TableName: CONFIG.BIDDU_CATEGORIES_TABLE,
        Item: {
          categoryId,
          categoryName: categoryName.trim(),
          createdAt: Date.now(),
        },
      })
    );

    return {
      categoryId,
      categoryName: categoryName.trim(),
    };
  },

  deleteCategory: async (args: { categoryId: string }) => {
    const { categoryId } = args;
    if (!categoryId) {
      throw new Error("Category ID is required");
    }

    // First, check if there are any subcategories
    const subcategories = await docClient.send(
      new QueryCommand({
        TableName: CONFIG.BIDDU_SUBCATEGORIES_TABLE,
        IndexName: "categoryId-index",
        KeyConditionExpression: "categoryId = :categoryId",
        ExpressionAttributeValues: {
          ":categoryId": categoryId,
        },
      })
    );

    if (subcategories.Items && subcategories.Items.length > 0) {
      throw new Error(
        "Cannot delete category with existing subcategories. Please delete subcategories first."
      );
    }

    await docClient.send(
      new DeleteCommand({
        TableName: CONFIG.BIDDU_CATEGORIES_TABLE,
        Key: { categoryId },
      })
    );

    return {
      success: true,
      message: "Category deleted successfully",
    };
  },

  addSubCategory: async (args: {
    input: { categoryId: string; name: string };
  }) => {
    const { categoryId, name } = args.input;
    if (!categoryId || !name || !name.trim()) {
      throw new Error("Category ID and subcategory name are required");
    }

    // Verify category exists
    const category = await docClient.send(
      new GetCommand({
        TableName: CONFIG.BIDDU_CATEGORIES_TABLE,
        Key: { categoryId },
      })
    );

    if (!category.Item) {
      throw new Error("Category not found");
    }

    const subCategoryId = uuidv4();
    await docClient.send(
      new PutCommand({
        TableName: CONFIG.BIDDU_SUBCATEGORIES_TABLE,
        Item: {
          subCategoryId,
          categoryId,
          name: name.trim(),
          createdAt: Date.now(),
        },
      })
    );

    return {
      subCategoryId,
      categoryId,
      name: name.trim(),
    };
  },

  deleteSubCategory: async (args: { subCategoryId: string }) => {
    const { subCategoryId } = args;
    if (!subCategoryId) {
      throw new Error("Subcategory ID is required");
    }

    await docClient.send(
      new DeleteCommand({
        TableName: CONFIG.BIDDU_SUBCATEGORIES_TABLE,
        Key: { subCategoryId },
      })
    );

    return {
      success: true,
      message: "Subcategory deleted successfully",
    };
  },

  getAllCategories: async () => {
    // Get all categories
    const categoriesResult = await docClient.send(
      new ScanCommand({
        TableName: CONFIG.BIDDU_CATEGORIES_TABLE,
      })
    );

    const categories = categoriesResult.Items || [];

    // Get all subcategories grouped by categoryId
    const subcategoriesResult = await docClient.send(
      new ScanCommand({
        TableName: CONFIG.BIDDU_SUBCATEGORIES_TABLE,
      })
    );

    const subcategories = subcategoriesResult.Items || [];
    const subcategoriesByCategory = subcategories.reduce(
      (acc: any, sub: any) => {
        if (!acc[sub.categoryId]) {
          acc[sub.categoryId] = [];
        }
        acc[sub.categoryId].push({
          subCategoryId: sub.subCategoryId,
          name: sub.name,
        });
        return acc;
      },
      {}
    );

    // Combine categories with their subcategories
    return categories.map((category: any) => ({
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      subCategories: subcategoriesByCategory[category.categoryId] || [],
    }));
  },
};


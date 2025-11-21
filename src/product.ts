import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
} from "@aws-sdk/lib-dynamodb";
// import AWS from "aws-sdk"; // v2 SDK required by dynamodb-geo

import { CONFIG } from "./config.js";
// import { computeGeohash, computeHashKey } from "./geo-util.js";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { verifyIdToken } from "./jws-verify.js";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import haversine from "haversine-distance";
import { ADMIN_GROUP_NAME } from "./constants.js";

const s3 = new S3Client({ region: CONFIG.REGION });

interface UploadRequestBody {
  filename: string;
  filetype: string;
}

interface DeleteRequestBody {
  fileKey: string;
}

function getBoundingBox(lat: number, lng: number, radiusKm: number) {
  const R = 6371; // Earth radius in km
  const deltaLat = (radiusKm / R) * (180 / Math.PI);
  const deltaLng =
    (radiusKm / (R * Math.cos((Math.PI * lat) / 180))) * (180 / Math.PI);

  return {
    minLat: lat - deltaLat,
    maxLat: lat + deltaLat,
    minLng: lng - deltaLng,
    maxLng: lng + deltaLng,
  };
}

const ddb = new DynamoDBClient({ region: CONFIG.REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddb);

// dynamodb-geo expects AWS SDK v2 DynamoDB client
// const ddbV2 = new AWS.DynamoDB({ region: CONFIG.REGION });
// const geoConfig = new GeoDataManagerConfiguration(
//   ddbV2,
//   CONFIG.BIDDU_PRODUCT_LOCATIONS_TABLE
// );
// geoConfig.hashKeyLength = 6;
// const geoTableManager = new GeoDataManager(geoConfig);

// const util = new GeoTableUtil();

export const handler = {
  addProduct: async (args: { input: unknown }, username: string) => {
    const input = args.input as any;

    // 🔒 Validate input
    if (
      !input.name ||
      !input.expectedPrice ||
      !input.bidStartDate ||
      !input.bidEndDate ||
      !input.userId ||
      !input.location
    ) {
      throw new Error(
        "Missing required fields: name, expectedPrice, bidStartDate, bidEndDate, userId, location"
      );
    }

    const productId = uuidv4();

    // 1️⃣ Product metadata for Products Table
    const productItem = {
      productId,
      name: input.name,
      expectedPrice: input.expectedPrice,
      bidStartDate: input.bidStartDate,
      bidEndDate: input.bidEndDate,
      videoUrls: input.videoUrls || [],
      imageUrls: input.imageUrls || [],
      descriptionText: input.descriptionText || "",
      userId: username,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // 🧾 Write product to Products Table
    await ddbDocClient.send(
      new PutCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Item: productItem,
      })
    );

    // 2️⃣ Product location for Locations Table
    const lat = Number(input.location.lat);
    const lng = Number(input.location.lng);

    const locationItem = {
      productId,
      lat,
      lng,
      createdAt: Date.now(),
    };

    await ddbDocClient.send(
      new PutCommand({
        TableName: CONFIG.BIDDU_PRODUCT_LOCATIONS_TABLE,
        Item: locationItem,
      })
    );

    // Return combined response
    return {
      ...productItem,
      location: {
        lat,
        lng,
      },
    };
  },
  getProductImageUploadUrl: async (
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResultV2> => {
    try {
      const auth = event.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
      if (!token) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
      }
      const claims = await verifyIdToken(token);
      const userSub = claims?.sub;

      if (!userSub) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
      }

      const body: UploadRequestBody = JSON.parse(event.body || "{}");
      const { filename, filetype } = body;

      if (!filename || !filetype) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Missing parameters: filename, filetype",
          }),
        };
      }

      const key = `products/${userSub}/${Date.now()}-${filename}`;

      const command = new PutObjectCommand({
        Bucket: CONFIG.BIDDU_PRODUCT_IMAGES_BUCKET,
        Key: key,
        ContentType: filetype,
      });

      const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
      const fileUrl = `https://${CONFIG.BIDDU_PRODUCT_IMAGES_BUCKET}.s3.${CONFIG.REGION}.amazonaws.com/${key}`;

      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify({ uploadUrl, fileUrl, key }),
      };
    } catch (error) {
      console.error("Error generating product image upload URL:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal Server Error" }),
      };
    }
  },
  deleteProductImage: async (
    event: APIGatewayProxyEventV2
  ): Promise<APIGatewayProxyResultV2> => {
    try {
      const auth = event.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
      if (!token) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
      }
      const claims = await verifyIdToken(token);
      const userSub = claims?.sub;

      if (!userSub) {
        return {
          statusCode: 401,
          body: JSON.stringify({ message: "Unauthorized" }),
        };
      }

      const body: DeleteRequestBody = JSON.parse(event.body || "{}");
      const { fileKey } = body;

      if (!fileKey) {
        return {
          statusCode: 400,
          body: JSON.stringify({ message: "Missing fileKey" }),
        };
      }

      // Ensure user owns the image folder
      if (!fileKey.startsWith(`products/${userSub}/`)) {
        return {
          statusCode: 403,
          body: JSON.stringify({
            message: "You cannot delete this product image",
          }),
        };
      }

      await s3.send(
        new DeleteObjectCommand({
          Bucket: CONFIG.BIDDU_PRODUCT_IMAGES_BUCKET!,
          Key: fileKey,
        })
      );

      return {
        statusCode: 200,
        body: JSON.stringify({ message: "Product image deleted successfully" }),
      };
    } catch (error) {
      console.error("Error deleting product image:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal Server Error" }),
      };
    }
  },
  searchNearbyProducts: async (args: {
    input: unknown;
  }): Promise<APIGatewayProxyResultV2> => {
    const input = args.input as any;
    const { lat, lng, radiusInKm = 5 } = input;

    const { minLat, maxLat, minLng, maxLng } = getBoundingBox(
      lat,
      lng,
      radiusInKm
    );

    const result = await ddb.send(
      new ScanCommand({
        TableName: CONFIG.BIDDU_PRODUCT_LOCATIONS_TABLE,
        FilterExpression:
          "lat BETWEEN :minLat AND :maxLat AND lng BETWEEN :minLng AND :maxLng",
        ExpressionAttributeValues: {
          ":minLat": minLat,
          ":maxLat": maxLat,
          ":minLng": minLng,
          ":maxLng": maxLng,
        },
      })
    );

    const items = result.Items || [];

    // Step 2: Filter precisely by Haversine distance
    const nearby = items
      .map((item) => {
        const distance =
          haversine(
            { latitude: lat, longitude: lng },
            { latitude: Number(item.lat), longitude: Number(item.lng) }
          ) / 1000;

        return { ...item, distance: parseFloat(distance.toFixed(2)) };
      })
      .filter((i) => i.distance <= radiusInKm)
      .sort((a, b) => a.distance - b.distance);

    // 4️⃣ Fetch full product details using Scan with FilterExpression
    // This filters at database level to reduce data transfer costs
    const productIds = nearby.map((item: any) => item.productId);
    
    if (productIds.length === 0) {
      return {
        statusCode: 200,
        headers: { "Access-Control-Allow-Origin": "*" },
        body: JSON.stringify([]),
      };
    }

    // Build FilterExpression: productId IN (list) AND verified = true
    // Use OR conditions for productId matching (DynamoDB doesn't support IN in FilterExpression)
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};
    
    // Build OR conditions for productIds (limit to reasonable size to avoid expression size limits)
    const maxProductIds = 10; // Limit to avoid expression size issues
    const productIdsToQuery = productIds.slice(0, maxProductIds);
    
    const productIdConditions = productIdsToQuery.map((id, index) => {
      const paramName = `:pid${index}`;
      expressionAttributeValues[paramName] = id;
      return `productId = ${paramName}`;
    });
    
    // Add verified filter
    expressionAttributeNames["#verified"] = "verified";
    expressionAttributeValues[":verified"] = true;
    
    // Combine conditions: (productId = :pid0 OR productId = :pid1 OR ...) AND #verified = :verified
    const filterExpression = `(${productIdConditions.join(" OR ")}) AND #verified = :verified`;
    
    // Scan products table with FilterExpression
    const allProducts: Record<string, any> = {};
    try {
      const scanResult = await ddbDocClient.send(
        new ScanCommand({
          TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
          FilterExpression: filterExpression,
          ExpressionAttributeNames: expressionAttributeNames,
          ExpressionAttributeValues: expressionAttributeValues,
        })
      );

      // Store products by productId for quick lookup
      if (scanResult.Items) {
        scanResult.Items.forEach((product: any) => {
          allProducts[product.productId] = product;
        });
      }
      
      // If we had more than maxProductIds, fetch remaining in batches
      if (productIds.length > maxProductIds) {
        const remainingBatches: string[][] = [];
        for (let i = maxProductIds; i < productIds.length; i += maxProductIds) {
          remainingBatches.push(productIds.slice(i, i + maxProductIds));
        }
        
        for (let batchIndex = 0; batchIndex < remainingBatches.length; batchIndex++) {
          const batch = remainingBatches[batchIndex];
          const batchExpressionAttributeValues: Record<string, any> = {
            ":verified": true,
          };
          
          const batchConditions = batch.map((id, index) => {
            const paramName = `:pid${batchIndex}_${index}`;
            batchExpressionAttributeValues[paramName] = id;
            return `productId = ${paramName}`;
          });
          
          const batchFilterExpression = `(${batchConditions.join(" OR ")}) AND #verified = :verified`;
          
          const batchScanResult = await ddbDocClient.send(
            new ScanCommand({
              TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
              FilterExpression: batchFilterExpression,
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: batchExpressionAttributeValues,
            })
          );
          
          if (batchScanResult.Items) {
            batchScanResult.Items.forEach((product: any) => {
              allProducts[product.productId] = product;
            });
          }
        }
      }
    } catch (err) {
      console.warn("Failed to fetch products with FilterExpression:", err);
    }

    // Map nearby items with product details (only verified products are in allProducts)
    const productDetails = nearby
      .map((item: any) => {
        const product = allProducts[item.productId];
        if (!product) {
          return null; // Product not found or not verified
        }
        
        // Calculate highestBidPrice and totalBids from bids array
        const bids = product.bids || [];
        const totalBids = bids.length;
        const highestBidPrice = bids.length > 0
          ? Math.max(...bids.map((bid: any) => bid.bidPrice))
          : null;
        
        return {
          ...item,
          ...product,
          highestBidPrice,
          totalBids,
        };
      })
      .filter((item) => item !== null); // Remove null entries

    return {
      statusCode: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(productDetails),
    };
  },
  updateProduct: async (
    args: { input: unknown },
    username: string,
    isSeller: boolean
  ) => {
    const input = args.input as any;
    const { productId } = input;

    if (!productId) {
      throw new Error("Product ID is required");
    }

    // Get existing product
    const existingProduct = await ddbDocClient.send(
      new GetCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
      })
    );

    if (!existingProduct.Item) {
      throw new Error("Product not found");
    }

    // Verify ownership (only seller can update, unless isSeller is true from admin context)
    if (existingProduct.Item.userId !== username && !isSeller) {
      throw new Error("Unauthorized: You can only update your own products");
    }

    // Build update expression dynamically
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Update basic fields
    if (input.name !== undefined) {
      updateExpressions.push("#name = :name");
      expressionAttributeNames["#name"] = "name";
      expressionAttributeValues[":name"] = input.name;
    }

    if (input.expectedPrice !== undefined) {
      updateExpressions.push("expectedPrice = :expectedPrice");
      expressionAttributeValues[":expectedPrice"] = input.expectedPrice;
    }

    if (input.bidStartDate !== undefined) {
      updateExpressions.push("bidStartDate = :bidStartDate");
      expressionAttributeValues[":bidStartDate"] = input.bidStartDate;
    }

    if (input.bidEndDate !== undefined) {
      updateExpressions.push("bidEndDate = :bidEndDate");
      expressionAttributeValues[":bidEndDate"] = input.bidEndDate;
    }

    if (input.videoUrls !== undefined) {
      updateExpressions.push("videoUrls = :videoUrls");
      expressionAttributeValues[":videoUrls"] = input.videoUrls;
    }

    if (input.imageUrls !== undefined) {
      updateExpressions.push("imageUrls = :imageUrls");
      expressionAttributeValues[":imageUrls"] = input.imageUrls;
    }

    if (input.descriptionText !== undefined) {
      updateExpressions.push("descriptionText = :descriptionText");
      expressionAttributeValues[":descriptionText"] = input.descriptionText;
    }

    // Update verification status
    if (input.verified !== undefined) {
      updateExpressions.push("#verified = :verified");
      expressionAttributeNames["#verified"] = "verified";
      expressionAttributeValues[":verified"] = input.verified;
    }

    // Update category and subcategory
    if (input.categoryId !== undefined) {
      updateExpressions.push("categoryId = :categoryId");
      expressionAttributeValues[":categoryId"] = input.categoryId;
    }

    if (input.subCategoryId !== undefined) {
      updateExpressions.push("subCategoryId = :subCategoryId");
      expressionAttributeValues[":subCategoryId"] = input.subCategoryId;
    }

    // Update refurbished status
    if (input.refurbished !== undefined) {
      updateExpressions.push("refurbished = :refurbished");
      expressionAttributeValues[":refurbished"] = input.refurbished;
    }

    // Handle FAQs - add new FAQ
    if (input.addFAQ) {
      const existingFAQs = existingProduct.Item.faqs || [];
      const newFAQ = {
        faqId: uuidv4(),
        question: input.addFAQ.question,
        answer: input.addFAQ.answer || null,
        askedBy: username,
      };
      existingFAQs.push(newFAQ);
      updateExpressions.push("faqs = :faqs");
      expressionAttributeValues[":faqs"] = existingFAQs;
    }

    // Handle location details
    if (input.locationDetails) {
      const locationDetails: Record<string, any> = {};
      if (input.locationDetails.zipcode !== undefined) {
        locationDetails.zipcode = input.locationDetails.zipcode;
      }
      if (input.locationDetails.addressText !== undefined) {
        locationDetails.addressText = input.locationDetails.addressText;
      }
      if (input.locationDetails.state !== undefined) {
        locationDetails.state = input.locationDetails.state;
      }
      if (input.locationDetails.city !== undefined) {
        locationDetails.city = input.locationDetails.city;
      }
      if (input.locationDetails.country !== undefined) {
        locationDetails.country = input.locationDetails.country;
      }

      if (Object.keys(locationDetails).length > 0) {
        updateExpressions.push("locationDetails = :locationDetails");
        expressionAttributeValues[":locationDetails"] = {
          ...(existingProduct.Item.locationDetails || {}),
          ...locationDetails,
        };
      }
    }

    // Always update updatedAt
    updateExpressions.push("updatedAt = :updatedAt");
    expressionAttributeValues[":updatedAt"] = Date.now();

    if (updateExpressions.length === 0) {
      throw new Error("No fields to update");
    }

    // Update product
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
        UpdateExpression: `SET ${updateExpressions.join(", ")}`,
        ExpressionAttributeNames:
          Object.keys(expressionAttributeNames).length > 0
            ? expressionAttributeNames
            : undefined,
        ExpressionAttributeValues: expressionAttributeValues,
      })
    );

    // Get updated product
    const updatedProduct = await ddbDocClient.send(
      new GetCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
      })
    );

    return updatedProduct.Item;
  },
  searchProducts: async (args: { input: unknown }) => {
    const input = args.input as any;

    // First, get productIds from locations table if lat/lng is provided
    let locationProductIds: string[] = [];
    if (input.location && input.location.lat !== undefined && input.location.lng !== undefined) {
      const { lat, lng } = input.location;
      const locationsResult = await ddbDocClient.send(
        new ScanCommand({
          TableName: CONFIG.BIDDU_PRODUCT_LOCATIONS_TABLE,
          FilterExpression: "lat = :lat AND lng = :lng",
          ExpressionAttributeValues: {
            ":lat": lat,
            ":lng": lng,
          },
        })
      );
      locationProductIds = (locationsResult.Items || []).map(
        (loc: any) => loc.productId
      );
      
      // If no products found with this location, return empty array
      if (locationProductIds.length === 0) {
        return [];
      }
    }

    // Build filter expressions
    const filterExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // Filter by productIds from location search (lat/lng) - added to scanParams
    // Use OR conditions for small lists, filter in memory for larger lists
    if (locationProductIds.length > 0) {
      if (locationProductIds.length <= 20) {
        // Use OR conditions for small lists (more reliable than IN)
        const orConditions = locationProductIds.map((id, index) => {
          const paramName = `:locId${index}`;
          expressionAttributeValues[paramName] = id;
          return `productId = ${paramName}`;
        });
        filterExpressions.push(`(${orConditions.join(" OR ")})`);
      } else {
        // For larger lists, we'll filter in memory after scan
        // Don't add to filter expression, will filter results later
      }
    }

    // Filter by name (case-insensitive partial match)
    if (input.name) {
      filterExpressions.push("contains(#name, :name)");
      expressionAttributeNames["#name"] = "name";
      expressionAttributeValues[":name"] = input.name;
    }

    // Filter by category
    if (input.categoryId) {
      filterExpressions.push("categoryId = :categoryId");
      expressionAttributeValues[":categoryId"] = input.categoryId;
    }

    // Filter by subcategory
    if (input.subCategoryId) {
      filterExpressions.push("subCategoryId = :subCategoryId");
      expressionAttributeValues[":subCategoryId"] = input.subCategoryId;
    }

    // Filter by price range
    if (input.minPrice !== undefined) {
      filterExpressions.push("expectedPrice >= :minPrice");
      expressionAttributeValues[":minPrice"] = input.minPrice;
    }
    if (input.maxPrice !== undefined) {
      filterExpressions.push("expectedPrice <= :maxPrice");
      expressionAttributeValues[":maxPrice"] = input.maxPrice;
    }

    // Filter by verified status
    if (input.verified !== undefined) {
      filterExpressions.push("#verified = :verified");
      expressionAttributeNames["#verified"] = "verified";
      expressionAttributeValues[":verified"] = input.verified;
    }

    // Filter by refurbished status
    if (input.refurbished !== undefined) {
      filterExpressions.push("refurbished = :refurbished");
      expressionAttributeValues[":refurbished"] = input.refurbished;
    }

    // Filter by userId
    if (input.userId) {
      filterExpressions.push("userId = :userId");
      expressionAttributeValues[":userId"] = input.userId;
    }

    // Filter by bid start date
    if (input.bidStartDate !== undefined) {
      filterExpressions.push("bidStartDate >= :bidStartDate");
      expressionAttributeValues[":bidStartDate"] = input.bidStartDate;
    }

    // Filter by bid end date
    if (input.bidEndDate !== undefined) {
      filterExpressions.push("bidEndDate <= :bidEndDate");
      expressionAttributeValues[":bidEndDate"] = input.bidEndDate;
    }

    // Filter by location details using nested attribute access
    if (input.locationDetails) {
      if (input.locationDetails.zipcode) {
        filterExpressions.push("locationDetails.zipcode = :zipcode");
        expressionAttributeValues[":zipcode"] = input.locationDetails.zipcode;
      }
      if (input.locationDetails.city) {
        filterExpressions.push("locationDetails.city = :city");
        expressionAttributeValues[":city"] = input.locationDetails.city;
      }
      if (input.locationDetails.state) {
        filterExpressions.push("locationDetails.state = :state");
        expressionAttributeValues[":state"] = input.locationDetails.state;
      }
      if (input.locationDetails.country) {
        filterExpressions.push("locationDetails.country = :country");
        expressionAttributeValues[":country"] = input.locationDetails.country;
      }
      // Note: addressText uses contains which may not work with nested attributes
      // We'll handle it in post-processing if needed
    }

    // Scan products table with filters
    const scanParams: any = {
      TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
    };

    if (filterExpressions.length > 0) {
      scanParams.FilterExpression = filterExpressions.join(" AND ");
      if (Object.keys(expressionAttributeNames).length > 0) {
        scanParams.ExpressionAttributeNames = expressionAttributeNames;
      }
      scanParams.ExpressionAttributeValues = expressionAttributeValues;
    }

    const productsResult = await ddbDocClient.send(
      new ScanCommand(scanParams)
    );

    let products = productsResult.Items || [];

    // Filter by location productIds in memory if list was too large for FilterExpression
    if (locationProductIds.length > 20) {
      products = products.filter((product: any) =>
        locationProductIds.includes(product.productId)
      );
    }

    // Post-process for addressText (contains doesn't work well with nested attributes in DynamoDB)
    if (input.locationDetails && input.locationDetails.addressText) {
      products = products.filter((product: any) => {
        const locationDetails = product.locationDetails || {};
        if (locationDetails.addressText) {
          return locationDetails.addressText
            .toLowerCase()
            .includes(input.locationDetails.addressText.toLowerCase());
        }
        return false;
      });
    }

    return products;
  },
  addBid: async (args: { input: unknown }, username: string) => {
    const input = args.input as any;
    const { productId, bidPrice } = input;

    if (!productId || !bidPrice) {
      throw new Error("Product ID and bid price are required");
    }

    if (bidPrice <= 0) {
      throw new Error("Bid price must be greater than 0");
    }

    // Get the product to verify it exists and check ownership
    const product = await ddbDocClient.send(
      new GetCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
      })
    );

    if (!product.Item) {
      throw new Error("Product not found");
    }

    // Validate: prevent users from bidding on their own products
    if (product.Item.userId === username) {
      throw new Error("You cannot bid on your own product");
    }

    // Check if bid is within the bid period
    const now = Date.now();
    if (now < product.Item.bidStartDate || now > product.Item.bidEndDate) {
      throw new Error("Bidding is not open for this product");
    }

    // Validate: bid price must be at least 80% of expected price (-20%)
    const minimumBidPrice = product.Item.expectedPrice * 0.8;
    if (bidPrice < minimumBidPrice) {
      throw new Error(`Bid price must be at least ${minimumBidPrice} (80% of expected price)`);
    }

    // Create the bid
    const bidId = uuidv4();
    const newBid = {
      bidId,
      userId: username,
      bidPrice,
      createdAt: Date.now(),
    };

    // Get existing bids from product or initialize empty array
    const existingBids = product.Item.bids || [];

    // Add the new bid to the array
    const updatedBids = [...existingBids, newBid];

    // Update the product with the new bid
    await ddbDocClient.send(
      new UpdateCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
        UpdateExpression: "SET bids = :bids, updatedAt = :updatedAt",
        ExpressionAttributeValues: {
          ":bids": updatedBids,
          ":updatedAt": Date.now(),
        },
      })
    );

    return {
      bidId,
      productId,
      userId: username,
      bidPrice,
      createdAt: newBid.createdAt,
    };
  },
  getProductBids: async (
    productId: string,
    username: string,
    jwtGroups: string[]
  ) => {
    // Get the product to verify it exists and check ownership
    const product = await ddbDocClient.send(
      new GetCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Key: { productId },
      })
    );

    if (!product.Item) {
      throw new Error("Product not found");
    }

    // Check authorization: only product owner or admin can see bids
    const isAdmin = jwtGroups.includes(ADMIN_GROUP_NAME);
    const isProductOwner = product.Item.userId === username;

    if (!isAdmin && !isProductOwner) {
      throw new Error("Unauthorized: Only product owner or admin can view bids");
    }

    // Get bids from product (bids are stored as an array in the product)
    const bids = product.Item.bids || [];

    if (bids.length === 0) {
      return [];
    }

    // Collect unique user IDs from bids
    const userIds: string[] = Array.from(
      new Set(bids.map((bid: any) => bid.userId).filter((id: any): id is string => typeof id === 'string'))
    );

    // Fetch user details in batch (BatchGetCommand supports up to 100 items)
    const userMap = new Map<string, any>();
    
    try {
      // BatchGetCommand can handle up to 100 items per request
      // If we have more than 100 unique users, we'll need to batch in chunks
      const batchSize = 100;
      const batches: string[][] = [];
      
      for (let i = 0; i < userIds.length; i += batchSize) {
        batches.push(userIds.slice(i, i + batchSize));
      }

      // Process all batches
      for (const batch of batches) {
        const batchResult = await ddbDocClient.send(
          new BatchGetCommand({
            RequestItems: {
              [CONFIG.USERS_TABLE]: {
                Keys: batch.map((userId) => ({ sub: userId })),
              },
            },
          })
        );

        // Map users by their sub (userId)
        const users = batchResult.Responses?.[CONFIG.USERS_TABLE];
        if (users && Array.isArray(users)) {
          users.forEach((user: any) => {
            if (user?.sub) {
              userMap.set(user.sub, {
                phoneNumber: user.phoneNumber || null,
                name: user.name || null,
                emailId: user.emailId || null,
              });
            }
          });
        }
      }
    } catch (err) {
      console.error("Error fetching users in batch:", err);
      // Continue with empty user map if batch fetch fails
    }

    // Map bids with user details
    const bidsWithUsers = bids.map((bid: any) => {
      const user = userMap.get(bid.userId) || null;

      return {
        bidId: bid.bidId,
        productId: productId,
        bidPrice: bid.bidPrice,
        createdAt: bid.createdAt,
        user,
      };
    });

    return bidsWithUsers;
  },
};

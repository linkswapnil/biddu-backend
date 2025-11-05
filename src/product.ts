import { v4 as uuidv4 } from "uuid";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import AWS from "aws-sdk"; // v2 SDK required by dynamodb-geo
import { GeoDataManager, GeoDataManagerConfiguration } from "dynamodb-geo";
import { CONFIG } from "./config.js";
import { computeGeohash, computeHashKey } from "./geo-util.js";

const ddb = new DynamoDBClient({ region: CONFIG.REGION });
const ddbDocClient = DynamoDBDocumentClient.from(ddb);

// dynamodb-geo expects AWS SDK v2 DynamoDB client
const ddbV2 = new AWS.DynamoDB({ region: CONFIG.REGION });
const geoConfig = new GeoDataManagerConfiguration(
  ddbV2,
  CONFIG.BIDDU_PRODUCT_LOCATIONS_TABLE
);
geoConfig.hashKeyLength = 6;
const geoTableManager = new GeoDataManager(geoConfig);

export const handler = {
  addProduct: async (args: { input: unknown }, username: string) => {
    const input = args.input as any;

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

    // product metadata to store in products table
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

    // 1) write product metadata to products table
    await ddbDocClient.send(
      new PutCommand({
        TableName: CONFIG.BIDDU_PRODUCTS_TABLE,
        Item: productItem,
      })
    );

    const lat = Number(input.location.lat);
    const lng = Number(input.location.lng);

    // compute values manually
    const geohash = computeGeohash(lat, lng);
    const hashKey = computeHashKey(geohash, geoConfig.hashKeyLength);
    // 2) write geo point to separate geo table using dynamodb-geo
    // RangeKeyValue is productId (so we can find the product from geo table)
    const geoPointResult = await geoTableManager.putPoint({
      RangeKeyValue: { S: productId },
      GeoPoint: {
        latitude: Number(input.location.lat),
        longitude: Number(input.location.lng),
      },
      PutItemInput: {
        Item: {
          hashKey: { N: String(hashKey) },
          rangeKey: { S: productId },
          geohash: { N: String(geohash) },
          // include productId & locationName and any extra fields you want in geo table
          productId: { S: productId },
          locationName: { S: input.locationName || "" },
          // optionally keep lat/lng redundantly for easy reads without parsing geoJson
          lat: { N: String(Number(input.location.lat)) },
          lng: { N: String(Number(input.location.lng)) },
          // createdAt for housekeeping
          createdAt: { N: String(Date.now()) },
        },
      },
    }).promise();


    return {
      ...productItem,
      location: {
        lat: Number(input.location.lat),
        lng: Number(input.location.lng),
      },
      locationName: input.locationName || "",
    };
  },
};

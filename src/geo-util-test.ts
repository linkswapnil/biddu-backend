import { computeGeohash, computeHashKey } from "./geo-util.js";

const lat = 12.9716;
const lng = 88.5946;

const geohash = computeGeohash(lat, lng);
const hashKey = computeHashKey(geohash, 6);

console.log({ geohash, hashKey });

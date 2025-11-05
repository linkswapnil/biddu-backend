import ngeohash from "ngeohash";

/**
 * Compute the numeric geohash (same as dynamodb-geo v0.4.0)
 */
export function computeGeohash(lat: number, lng: number): number {
  const hash = ngeohash.encode_int(lat, lng, 52); // 52-bit precision
  return hash;
}

/**
 * Compute the hashKey used for partitioning in DynamoDB
 */
export function computeHashKey(geohash: number, hashKeyLength: number): number {
  // take only top bits to form the hash key (same logic used internally)
  return geohash >> (52 - hashKeyLength * 5);
}

// jwt-verify.ts
import 'dotenv/config';
import jwksClient from 'jwks-rsa';
import jwt, { JwtPayload } from 'jsonwebtoken';

const REGION = process.env.REGION || process.env.REGION;
const ADMIN_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID as string;
const ADMIN_CLIENT_ID = process.env.COGNITO_CLIENT_ID as string;
const BIDDU_USER_POOL_ID = process.env.OTP_USER_POOL_ID as string;
const BIDDU_CLIENT_ID = process.env.OTP_CLIENT_ID as string;

const ADMIN_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${ADMIN_USER_POOL_ID}`;
const BIDDU_ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${BIDDU_USER_POOL_ID}`;

const adminJwks = jwksClient({
  jwksUri: `${ADMIN_ISSUER}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
  jwksRequestsPerMinute: 10,
});

const bidduJwks = jwksClient({
  jwksUri: `${BIDDU_ISSUER}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000,
  jwksRequestsPerMinute: 10,
});

function getKeyFrom(client: ReturnType<typeof jwksClient>) {
  return function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
    if (!header.kid) return callback(new Error('No KID in token'), undefined);
    client.getSigningKey(header.kid, (err: any, key: any) => {
      if (err) return callback(err as Error, undefined);
      const signingKey = key.getPublicKey();
      callback(null, signingKey);
    });
  };
}

export async function verifyIdToken(token: string): Promise<JwtPayload> {
  // Try admin pool first
  try {
    return await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        getKeyFrom(adminJwks),
        {
          algorithms: ['RS256'],
          audience: ADMIN_CLIENT_ID,
          issuer: ADMIN_ISSUER,
          clockTolerance: 5,
        },
        (err, decoded) => {
          if (err) return reject(err);
          const payload = decoded as JwtPayload;
          if ((payload as any).token_use !== 'id') return reject(new Error('Not an ID token'));
          resolve(payload);
        }
      );
    });
  } catch (_adminErr) {
    // Fallback to biddu user pool
    return await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        getKeyFrom(bidduJwks),
        {
          algorithms: ['RS256'],
          audience: BIDDU_CLIENT_ID,
          issuer: BIDDU_ISSUER,
          clockTolerance: 5,
        },
        (err, decoded) => {
          if (err) return reject(err);
          const payload = decoded as JwtPayload;
          if ((payload as any).token_use !== 'id') return reject(new Error('Not an ID token'));
          resolve(payload);
        }
      );
    });
  }
}

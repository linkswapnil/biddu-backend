// jwt-verify.ts
import 'dotenv/config';
import jwksClient from 'jwks-rsa';
import jwt, { JwtPayload } from 'jsonwebtoken';

const REGION = process.env.AWS_REGION;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID as string;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID as string;

const ISSUER = `https://cognito-idp.${REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`;

const client = jwksClient({
  jwksUri: `${ISSUER}/.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 5,
  cacheMaxAge: 10 * 60 * 1000, // 10 minutes
  jwksRequestsPerMinute: 10,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  if (!header.kid) return callback(new Error('No KID in token'), undefined);
  client.getSigningKey(header.kid, (err: any, key: any) => {
    if (err) return callback(err as Error, undefined);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

export async function verifyIdToken(token: string): Promise<JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
        audience: CLIENT_ID,
        issuer: ISSUER,
        clockTolerance: 5, // seconds
      },
      (err, decoded) => {
        if (err) return reject(err);
        const payload = decoded as JwtPayload;
        // extra checks (optional):
        if (payload.token_use !== 'id') return reject(new Error('Not an ID token'));
        resolve(payload);
      }
    );
  });
}

## GraphQL Yoga on AWS Lambda (Biddu-Backend example)

This is a minimal example that exposes a GraphQL endpoint on AWS Lambda using GraphQL Yoga and API Gateway HTTP API (v2).

### Prerequisites
- Node.js 18+ (Node 20 recommended)
- npm
- AWS account and credentials configured locally
- Serverless Framework v3 (installed locally via npx)

### Install
```bash
npm install
```

### Local development
Run a local HTTP server:
```bash
npm run dev
```
Open `http://localhost:4000/graphql`.

### Build
```bash
npm run build
```

### Deploy
```bash
npx serverless deploy
```
The function is deployed with an HTTP API at `/graphql`.

### Project structure
- `src/schema.ts`: GraphQL schema and resolvers
- `src/yoga.ts`: Yoga server instance configured for `/graphql`
- `src/handler.ts`: AWS Lambda handler that proxies API Gateway v2 events to Yoga
- `src/dev.ts`: Local dev entrypoint
- `serverless.yml`: Serverless configuration

### Notes
- The handler expects API Gateway v2 (HTTP API). For REST API (v1) adjust event mapping as needed.
- `serverless-offline` can be used via `npm run offline` for local API Gateway emulation.


sls deploy --verbose   
npm install -g serverless
export AWS_PROFILE=myawesome_app   

arn:aws:lambda:ap-south-1:314146313087:function:biddu-backend-dev-graphql

{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "InvokeGraphQLIAM",
      "Effect": "Allow",
      "Action": "execute-api:Invoke",
      "Resource": "arn:aws:lambda:ap-south-1:314146313087:function:biddu-backend-dev-graphql"
    }
  ]
}
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, Context } from 'aws-lambda';
import { yoga } from './yoga.js';

export async function graphql(
	event: APIGatewayProxyEventV2,
	context: Context
): Promise<APIGatewayProxyStructuredResultV2> {
	// Normalize protected paths to Yoga's configured endpoint
	const path = (event.rawPath === '/graphql-iam' || event.rawPath === '/graphql-jwt') ? '/graphql' : event.rawPath;
	const url = `https://${event.requestContext.domainName}${path}${event.rawQueryString ? '?' + event.rawQueryString : ''}`;

	const response = await yoga.fetch(
		url,
		{
			method: event.requestContext.http.method,
			headers: event.headers as HeadersInit,
			body: event.body && event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body ?? undefined,
		},
		{ event, context }
	);

	const headers: Record<string, string> = {};
	response.headers.forEach((value, key) => (headers[key] = value));

	return {
		statusCode: response.status,
		headers,
		body: await response.text(),
	};
}

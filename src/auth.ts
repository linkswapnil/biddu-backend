import 'dotenv/config';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand, AdminCreateUserCommand, AdminSetUserPasswordCommand, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const region = process.env.REGION || process.env.AWS_REGION || 'ap-south-1';
const cognito = new CognitoIdentityProviderClient({ region });

export const login: APIGatewayProxyHandlerV2 = async (event) => {
	try {
		const body = event.body ? JSON.parse(event.body as string) : {};
		const username: string = body.username;
		const password: string = body.password;
		const clientId = process.env.COGNITO_CLIENT_ID!;
		if (!username || !password) return { statusCode: 400, body: 'username and password are required' };
		if (!clientId) return { statusCode: 500, body: 'Missing COGNITO_CLIENT_ID' };

		const resp = await cognito.send(new InitiateAuthCommand({
			AuthFlow: 'USER_PASSWORD_AUTH',
			ClientId: clientId,
			AuthParameters: { USERNAME: username, PASSWORD: password },
		}));
        console.log("login response", resp);
		return {
			statusCode: 200,
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(resp.AuthenticationResult ?? {}),
		};
	} catch (e: any) {
		return { statusCode: 401, body: e?.message || 'Unauthorized' };
	}
};

export const signup: APIGatewayProxyHandlerV2 = async (event) => {
	// Require admin via JWT authorizer groups
	const claims: any = ((event.requestContext as any)?.authorizer)?.jwt?.claims;
	const groups: string[] = (claims?.['cognito:groups'] ?? []) as string[];
	if (!groups.includes('biddu-admin')) {
		return { statusCode: 403, body: 'Forbidden' };
	}

	try {
		const body = event.body ? JSON.parse(event.body as string) : {};
		const username: string = body.username;
		const password: string = body.password;
		const group: string | undefined = body.group; // optional role/group
		const userPoolId = process.env.COGNITO_USER_POOL_ID!;
		if (!username || !password) return { statusCode: 400, body: 'username and password are required' };
		if (!userPoolId) return { statusCode: 500, body: 'Missing COGNITO_USER_POOL_ID' };

		await cognito.send(new AdminCreateUserCommand({
			UserPoolId: userPoolId,
			Username: username,
			MessageAction: 'SUPPRESS',
		}));

		await cognito.send(new AdminSetUserPasswordCommand({
			UserPoolId: userPoolId,
			Username: username,
			Password: password,
			Permanent: true,
		}));

		if (group) {
			await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: group }));
		}

		return { statusCode: 200, body: 'OK' };
	} catch (e: any) {
		return { statusCode: 400, body: e?.message || 'Bad Request' };
	}
};



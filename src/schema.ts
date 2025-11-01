import { createSchema } from 'graphql-yoga';
import { GraphQLError } from 'graphql';
import { YogaContext } from './yoga';
import { ADMIN_GROUP_NAME } from './constants.js';

const PRODUCTS = [
	{ id: '1', name: 'Laptop', price: 1299.99 },
	{ id: '2', name: 'Headphones', price: 199.5 },
	{ id: '3', name: 'Keyboard', price: 89.0 },
];

export const schema = createSchema({
	typeDefs: /* GraphQL */ `
		"""A simple product entity used for demo purposes"""
		type Product {
			id: ID!
			name: String!
			price: Float!
		}

		type Query {
			greetings(name: String): String!
			products: [Product!]!
		}
	`,
	resolvers: {
		Query: {
			greetings: (_: unknown, args: { name?: string }) => {
				return `Hello ${args.name ?? 'world'}!`;
			},
			products: (
				_: unknown,
				__: unknown,
				context: YogaContext
			) => {
				const { jwtGroups } = context;
				if(!jwtGroups.includes(ADMIN_GROUP_NAME)) {
					throw new GraphQLError('Unauthorized');
				}
				console.log("context::", context, jwtGroups);
				return PRODUCTS;
			},
		},
	},
});

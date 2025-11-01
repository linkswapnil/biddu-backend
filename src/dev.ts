import { yoga } from './yoga.js';

const port = Number(process.env.PORT ?? 5001);

// Standard Node.js HTTP server
import('node:http').then(({ createServer }) => {
	createServer(yoga).listen(port, () => {
		console.log(`Yoga GraphQL server is running on http://localhost:${port}/graphql`);
	});
});

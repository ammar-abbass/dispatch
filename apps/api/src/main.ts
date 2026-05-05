import { env } from '@dispatch/config';
import { rootLogger } from '@dispatch/logger';
import { redis } from '@dispatch/queue';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
} from 'fastify-type-provider-zod';
import { nanoid } from 'nanoid';

import { apiKeyRoutes } from './api-keys/api-key.routes.js';
import { auditRoutes } from './audit/audit.routes.js';
import { authPlugin } from './auth/auth.plugin.js';
import { authRoutes } from './auth/auth.routes.js';
import { errorHandler } from './error-handler.js';
import { executionRoutes } from './executions/execution.routes.js';
import { healthRoutes } from './health/health.routes.js';
import { jobDefinitionRoutes } from './job-definitions/job-definition.routes.js';
import { startMetricsCollection } from './metrics/metrics.js';
import { queueRoutes } from './queues/queue.routes.js';
import { userRoutes } from './users/user.routes.js';
import { workerRoutes } from './workers/worker.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const logger = rootLogger.child({ service: 'api' });

const app = Fastify({
  loggerInstance: logger as any,
  bodyLimit: 65_536,
  genReqId: () => nanoid(),
});

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);
app.setErrorHandler(errorHandler);

await app.register(cors, {
  origin: env.NODE_ENV === 'production' ? false : true,
  credentials: true,
});
await app.register(helmet);
await app.register(cookie);
await app.register(jwt, { secret: env.JWT_SECRET });
await app.register(authPlugin);

await app.register(swagger, {
  openapi: {
    info: {
      title: 'Dispatch API',
      version: '1.0.0',
      description: 'Distributed job scheduling platform',
    },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKey: { type: 'apiKey', in: 'header', name: 'Authorization' },
      },
    },
    // Default security: most routes require authentication
    security: [{ bearerAuth: [] }, { apiKey: [] }],
  },
  transform: jsonSchemaTransform,
});

await app.register(swaggerUi, { routePrefix: '/docs' });

// ── Request ID middleware ──────────────────────────────────────────────────────
// Fastify already generates req.id via genReqId(). We surface it as requestId
// and propagate it as a response header so clients and logs can correlate.
app.addHook('onRequest', async (req, reply) => {
  (req as unknown as Record<string, string>).requestId = req.id;
  void reply.header('X-Request-Id', req.id);
});

await app.register(healthRoutes, { prefix: '/' });
await app.register(authRoutes, { prefix: '/v1/auth' });
await app.register(jobDefinitionRoutes, { prefix: '/v1/job-definitions' });
await app.register(executionRoutes, { prefix: '/v1/executions' });
await app.register(queueRoutes, { prefix: '/v1/queues' });
await app.register(workerRoutes, { prefix: '/v1/workers' });
await app.register(apiKeyRoutes, { prefix: '/v1/api-keys' });
await app.register(auditRoutes, { prefix: '/v1/audit-logs' });
await app.register(userRoutes, { prefix: '/v1/users' });

const metricsInterval = startMetricsCollection();

async function start() {
  await app.ready();
  await app.listen({ port: Number(env.API_PORT), host: env.API_HOST });
  logger.info(`API listening on ${env.API_HOST}:${env.API_PORT}`);
}

const signals = ['SIGTERM', 'SIGINT'];
for (const signal of signals) {
  process.on(signal, () => {
    logger.info({ signal }, 'Shutting down API');
    clearInterval(metricsInterval);
    void app
      .close()
      .then(() => redis.quit())
      .then(() => process.exit(0));
  });
}

start().catch((error: unknown) => {
  logger.error(error);
  process.exit(1);
});

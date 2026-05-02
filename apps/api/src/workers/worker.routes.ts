import { FastifyInstance } from 'fastify';

export async function workerRoutes(app: FastifyInstance) {
  app.addHook('onRequest', app.authenticate);

  app.get('/', {
    preHandler: app.authorize(['admin', 'operator', 'viewer']),
  }, async () => {
    return { workers: [] };
  });
}

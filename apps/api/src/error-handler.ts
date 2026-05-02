import { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AtlasError } from '@atlas/shared';
import { rootLogger } from '@atlas/logger';

const logger = rootLogger.child({ service: 'api' });

export function errorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof AtlasError) {
    return reply.code(error.statusCode).send({
      error: {
        code: error.code,
        message: error.message,
        requestId: _request.id,
        ...(error.meta ?? {}),
      },
    });
  }

  if (error.validation) {
    return reply.code(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        requestId: _request.id,
      },
    });
  }

  logger.error({ err: error, requestId: _request.id }, 'Unhandled error');

  return reply.code(500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: _request.id,
    },
  });
}

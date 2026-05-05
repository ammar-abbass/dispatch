import pino, { Logger } from 'pino';
import { env } from '@dispatch/config';
import os from 'os';

export type LogContext = Record<string, string | number | undefined>;

export function createLogger(context: LogContext = {}): Logger {
  return pino({
    level: env.LOG_LEVEL,
    base: {
      pid: process.pid,
      hostname: os.hostname(),
      ...context,
    },
    ...(env.NODE_ENV === 'development'
      ? {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          },
        }
      : {}),
  });
}

export const rootLogger = createLogger();

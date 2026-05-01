import pino from 'pino';
import { config } from '../config.js';

const redactPaths = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  '*.apiKey',
  '*.ANTHROPIC_API_KEY',
];

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'nomenclature-rag' },
  transport:
    process.env.NODE_ENV === 'production'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
        },
});

export type Logger = typeof logger;

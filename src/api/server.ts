import Fastify from 'fastify';
import corsPlugin from '@fastify/cors';
import staticPlugin from '@fastify/static';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';
import { pipeline } from './pipeline.js';
import { registerAskRoute } from './routes/ask.js';
import { registerFeedbackRoute } from './routes/feedback.js';
import { registerHealthRoute } from './routes/health.js';

const UI_DIR = path.join(config.ROOT, 'src', 'ui');

async function main() {
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024 });

  app.addHook('onRequest', (req, _reply, done) => {
    const { method, url } = req;
    logger.info({ method, url }, 'request');
    done();
  });

  await app.register(corsPlugin, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await registerHealthRoute(app);
  await registerAskRoute(app);
  await registerFeedbackRoute(app);

  await app.register(staticPlugin, {
    root: UI_DIR,
    prefix: '/',
    decorateReply: false,
  });

  pipeline.init().catch((err) => {
    logger.error({ err }, 'pipeline init failed');
    process.exit(1);
  });

  await app.listen({ host: config.HOST, port: config.PORT });
  logger.info({ host: config.HOST, port: config.PORT }, 'server listening');
}

main().catch((err) => {
  logger.error({ err }, 'fatal');
  process.exit(1);
});

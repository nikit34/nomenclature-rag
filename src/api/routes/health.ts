import type { FastifyInstance } from 'fastify';
import { pipeline } from '../pipeline.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => ({
    status: pipeline.isReady() ? 'ready' : 'warming_up',
    ts: new Date().toISOString(),
  }));
}

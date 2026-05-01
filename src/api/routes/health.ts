import type { FastifyInstance } from 'fastify';
import { pipeline } from '../pipeline.js';

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/api/health', async () => {
    const s = pipeline.getStatus();
    const status =
      s.phase === 'ready' ? 'ready' : s.phase === 'error' ? 'error' : 'warming_up';
    return {
      status,
      phase: s.phase,
      ...(s.done !== undefined ? { done: s.done } : {}),
      ...(s.total !== undefined ? { total: s.total } : {}),
      ...(s.error ? { error: s.error } : {}),
      ts: new Date().toISOString(),
    };
  });
}

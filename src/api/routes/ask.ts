import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pipeline } from '../pipeline.js';

const askSchema = z.object({
  query: z.string().min(1).max(1000),
});

export async function registerAskRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/ask', async (req, reply) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten(),
      });
    }
    if (!pipeline.isReady()) {
      return reply.code(503).send({ error: 'pipeline_warming_up' });
    }
    try {
      const result = await pipeline.ask(parsed.data.query);
      return result;
    } catch (err) {
      req.log.error({ err }, 'ask failed');
      const message = err instanceof Error ? err.message : 'internal_error';
      return reply.code(500).send({ error: 'internal_error', message });
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pipeline, type AskOptions, type AskResult } from '../pipeline.js';
import { WAREHOUSES } from '../../ingestion/types.js';

const warehouseSchema = z.enum(WAREHOUSES);

const filtersSchema = z.object({
  cities: z.array(warehouseSchema).max(WAREHOUSES.length).optional(),
  brands: z.array(z.string().min(1).max(100)).max(20).optional(),
  status: z.enum(['Распродажа', 'Новинка']).optional(),
  units: z.array(z.string().min(1).max(20)).max(10).optional(),
  requireAvailable: z.boolean().optional(),
});

const askSchema = z.object({
  query: z.string().min(1).max(1000),
  filters: filtersSchema.optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'stock_desc']).optional(),
  debug: z.boolean().optional(),
});

type PublicAskResponse = Omit<AskResult, 'diagnostics'> & {
  diagnostics?: AskResult['diagnostics'];
};

function toPublicResponse(result: AskResult, debug: boolean): PublicAskResponse {
  if (debug) return result;
  const { diagnostics: _diagnostics, ...rest } = result;
  return rest;
}

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
      const opts: AskOptions = {
        filters: parsed.data.filters,
        sort: parsed.data.sort,
        debug: parsed.data.debug,
      };
      const result = await pipeline.ask(parsed.data.query, opts);
      return toPublicResponse(result, parsed.data.debug === true);
    } catch (err) {
      req.log.error({ err }, 'ask failed');
      const message = err instanceof Error ? err.message : 'internal_error';
      return reply.code(500).send({ error: 'internal_error', message });
    }
  });
}

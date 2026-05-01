import type { FastifyInstance } from 'fastify';
import { PassThrough } from 'node:stream';
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

const queryStringSchema = z.object({
  q: z.string().min(1).max(1000),
  cities: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  brands: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  units: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : [v])),
  status: z.enum(['Распродажа', 'Новинка']).optional(),
  sort: z.enum(['relevance', 'price_asc', 'price_desc', 'stock_desc']).optional(),
  requireAvailable: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  debug: z
    .union([z.literal('true'), z.literal('false'), z.literal('1'), z.literal('0')])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
});

function buildOpts(parsed: z.infer<typeof askSchema>): AskOptions {
  const opts: AskOptions = {};
  if (parsed.filters) opts.filters = parsed.filters;
  if (parsed.sort) opts.sort = parsed.sort;
  if (parsed.debug !== undefined) opts.debug = parsed.debug;
  return opts;
}

async function runAsk(
  query: string,
  opts: AskOptions,
  reply: import('fastify').FastifyReply,
  req: import('fastify').FastifyRequest,
): Promise<unknown> {
  if (!pipeline.isReady()) {
    return reply.code(503).send({ error: 'pipeline_warming_up' });
  }
  try {
    const result = await pipeline.ask(query, opts);
    return toPublicResponse(result, opts.debug === true);
  } catch (err) {
    req.log.error({ err }, 'ask failed');
    const message = err instanceof Error ? err.message : 'internal_error';
    return reply.code(500).send({ error: 'internal_error', message });
  }
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
    return runAsk(parsed.data.query, buildOpts(parsed.data), reply, req);
  });

  app.get('/api/ask', async (req, reply) => {
    const qs = queryStringSchema.safeParse(req.query);
    if (!qs.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: qs.error.flatten(),
      });
    }
    const filters: NonNullable<AskOptions['filters']> = {};
    if (qs.data.cities) {
      const cities = qs.data.cities.filter((c): c is (typeof WAREHOUSES)[number] =>
        (WAREHOUSES as readonly string[]).includes(c),
      );
      if (cities.length) filters.cities = cities;
    }
    if (qs.data.brands && qs.data.brands.length) filters.brands = qs.data.brands;
    if (qs.data.units && qs.data.units.length) filters.units = qs.data.units;
    if (qs.data.status) filters.status = qs.data.status;
    if (qs.data.requireAvailable !== undefined) filters.requireAvailable = qs.data.requireAvailable;

    const opts: AskOptions = {};
    if (Object.keys(filters).length) opts.filters = filters;
    if (qs.data.sort) opts.sort = qs.data.sort;
    if (qs.data.debug !== undefined) opts.debug = qs.data.debug;

    return runAsk(qs.data.q, opts, reply, req);
  });

  app.post('/api/ask/stream', async (req, reply) => {
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

    const opts = buildOpts(parsed.data);
    const ctrl = new AbortController();
    // Use the socket's close event for true disconnect detection.
    // (req.raw 'close' fires when the request body is fully consumed, which
    //  happens immediately for short POST bodies — that's not a disconnect.)
    const sock = req.raw.socket;
    const onSockClose = () => {
      if (!sock.writableEnded) ctrl.abort();
    };
    sock.on('close', onSockClose);

    const stream = new PassThrough();
    stream.on('end', () => sock.off('close', onSockClose));
    stream.on('close', () => sock.off('close', onSockClose));
    stream.write(': stream-open\n\n');

    (async () => {
      try {
        for await (const ev of pipeline.askStream(parsed.data.query, opts, ctrl.signal)) {
          if (ctrl.signal.aborted) break;
          stream.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'internal_error';
        req.log.error({ err }, 'ask stream failed');
        stream.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
      } finally {
        stream.end();
      }
    })();

    reply.header('Content-Type', 'text/event-stream; charset=utf-8');
    reply.header('Cache-Control', 'no-cache, no-transform');
    reply.header('X-Accel-Buffering', 'no');
    return reply.send(stream);
  });
}

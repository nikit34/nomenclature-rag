import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config.js';
import { logger } from '../../observability/logger.js';

const feedbackSchema = z.object({
  requestId: z.string().min(1).max(64),
  offerId: z.number().int().nonnegative().optional(),
  kind: z.enum(['good', 'bad', 'wrong_product']),
  comment: z.string().max(2000).optional(),
  query: z.string().max(1000).optional(),
});

const FEEDBACK_DIR = path.join(config.ROOT, 'data');
const FEEDBACK_PATH = path.join(FEEDBACK_DIR, 'feedback.jsonl');

function appendFeedback(record: object): void {
  if (!fs.existsSync(FEEDBACK_DIR)) {
    fs.mkdirSync(FEEDBACK_DIR, { recursive: true });
  }
  fs.appendFileSync(FEEDBACK_PATH, JSON.stringify(record) + '\n', 'utf8');
}

export async function registerFeedbackRoute(app: FastifyInstance): Promise<void> {
  app.post('/api/feedback', async (req, reply) => {
    const parsed = feedbackSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_request',
        details: parsed.error.flatten(),
      });
    }
    const record = {
      ts: new Date().toISOString(),
      ...parsed.data,
    };
    try {
      appendFeedback(record);
      logger.info({ requestId: record.requestId, kind: record.kind, offerId: record.offerId }, 'feedback received');
      return { ok: true };
    } catch (err) {
      req.log.error({ err }, 'feedback write failed');
      return reply.code(500).send({ error: 'internal_error' });
    }
  });
}

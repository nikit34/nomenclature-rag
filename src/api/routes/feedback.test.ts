import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

let tmpRoot: string;

vi.mock('../../config.js', () => ({
  config: new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'ROOT') return tmpRoot;
        if (prop === 'LOG_LEVEL') return 'silent';
        return undefined;
      },
    },
  ),
}));

vi.mock('../../observability/logger.js', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

async function buildApp() {
  const { registerFeedbackRoute } = await import('./feedback.js');
  const app = Fastify({ logger: false });
  await registerFeedbackRoute(app);
  await app.ready();
  return app;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-feedback-'));
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('POST /api/feedback', () => {
  it('writes a JSONL line and returns ok', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { requestId: 'req-1', kind: 'good', offerId: 4479, query: 'M4 45мм' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const file = path.join(tmpRoot, 'data', 'feedback.jsonl');
    const content = fs.readFileSync(file, 'utf8').trim();
    const parsed = JSON.parse(content);
    expect(parsed.requestId).toBe('req-1');
    expect(parsed.kind).toBe('good');
    expect(parsed.offerId).toBe(4479);
    expect(parsed.query).toBe('M4 45мм');
    expect(parsed.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await app.close();
  });

  it('appends multiple records as separate lines', async () => {
    const app = await buildApp();
    await app.inject({ method: 'POST', url: '/api/feedback', payload: { requestId: 'r1', kind: 'good' } });
    await app.inject({ method: 'POST', url: '/api/feedback', payload: { requestId: 'r2', kind: 'bad' } });

    const file = path.join(tmpRoot, 'data', 'feedback.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).requestId).toBe('r1');
    expect(JSON.parse(lines[1]!).requestId).toBe('r2');
    await app.close();
  });

  it('rejects invalid kind', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { requestId: 'r1', kind: 'maybe' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_request');
    await app.close();
  });

  it('rejects missing requestId', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/feedback',
      payload: { kind: 'good' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

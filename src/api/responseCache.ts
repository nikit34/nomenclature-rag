import { createHash } from 'node:crypto';
import type { AskOptions, AskResult } from './pipeline.js';

const TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 200;

type Entry = { result: AskResult; ts: number };

// insertion order preserves LRU when we delete-and-reinsert on hit / put
const map = new Map<string, Entry>();

export function makeKey(rawQuery: string, opts: AskOptions): string {
  const payload = {
    q: rawQuery.trim().toLowerCase(),
    f: opts.filters ?? null,
    s: opts.sort ?? null,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function get(key: string): AskResult | null {
  const e = map.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > TTL_MS) {
    map.delete(key);
    return null;
  }
  // promote to most-recently-used
  map.delete(key);
  map.set(key, e);
  return e.result;
}

export function put(key: string, result: AskResult): void {
  if (map.has(key)) map.delete(key);
  map.set(key, { result, ts: Date.now() });
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

export function clear(): void {
  map.clear();
}

export function size(): number {
  return map.size;
}

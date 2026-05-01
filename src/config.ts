import { config as loadEnv } from 'dotenv';
import { z } from 'zod';
import path from 'node:path';

loadEnv();

const ROOT = process.env.APP_ROOT
  ? path.resolve(process.env.APP_ROOT)
  : process.cwd();

const schema = z.object({
  ANTHROPIC_API_KEY: z.string().min(20, 'ANTHROPIC_API_KEY missing'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  LLM_MODEL: z.string().default('claude-haiku-4-5'),
  EMBEDDING_MODEL: z.string().default('Xenova/multilingual-e5-small'),
  DATA_FILE: z.string().default('data/rag_assist.xlsx'),
  CACHE_DIR: z.string().default('cache'),
  TOP_K_BM25: z.coerce.number().int().positive().default(30),
  TOP_K_DENSE: z.coerce.number().int().positive().default(30),
  TOP_K_FINAL: z.coerce.number().int().positive().default(15),
  MAX_QUERY_CHARS: z.coerce.number().int().positive().default(500),
  MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(6000),
});

const parsed = schema.parse(process.env);

const resolveFromRoot = (p: string) => (path.isAbsolute(p) ? p : path.join(ROOT, p));

export const config = {
  ...parsed,
  ROOT,
  DATA_FILE_ABS: resolveFromRoot(parsed.DATA_FILE),
  CACHE_DIR_ABS: resolveFromRoot(parsed.CACHE_DIR),
  PRODUCTS_PATH: path.join(resolveFromRoot(parsed.CACHE_DIR), 'products.json'),
  EMBEDDINGS_PATH: path.join(resolveFromRoot(parsed.CACHE_DIR), 'embeddings.bin'),
  HASH_PATH: path.join(resolveFromRoot(parsed.CACHE_DIR), 'data.hash'),
  MODEL_CACHE: path.join(resolveFromRoot(parsed.CACHE_DIR), 'model'),
} as const;

export type AppConfig = typeof config;

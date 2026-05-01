import fs from 'node:fs';
import path from 'node:path';
import { env, pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';

env.cacheDir = config.MODEL_CACHE;
env.allowLocalModels = true;
env.allowRemoteModels = true;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    logger.info({ model: config.EMBEDDING_MODEL }, 'loading embedding model');
    extractorPromise = pipeline('feature-extraction', config.EMBEDDING_MODEL, {
      quantized: true,
    }) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const out: Float32Array[] = [];
  for (const t of texts) {
    const result = await extractor(t, { pooling: 'mean', normalize: true });
    out.push(new Float32Array(result.data as Float32Array));
  }
  return out;
}

export async function embedOne(text: string): Promise<Float32Array> {
  const [vec] = await embedTexts([text]);
  if (!vec) throw new Error('embedding failed');
  return vec;
}

export async function embedBatch(
  texts: string[],
  batchSize = 16,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const out: Float32Array[] = new Array(texts.length);
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const result = await extractor(batch, { pooling: 'mean', normalize: true });
    const dim = result.dims[result.dims.length - 1] as number;
    const flat = result.data as Float32Array;
    for (let j = 0; j < batch.length; j++) {
      out[i + j] = new Float32Array(flat.subarray(j * dim, (j + 1) * dim));
    }
    if (onProgress) onProgress(Math.min(i + batchSize, texts.length), texts.length);
  }
  return out;
}

export function getEmbeddingDim(vectors: Float32Array[]): number {
  if (vectors.length === 0 || !vectors[0]) throw new Error('no vectors');
  return vectors[0].length;
}

export function packEmbeddings(vectors: Float32Array[]): Buffer {
  if (vectors.length === 0) return Buffer.alloc(0);
  const dim = getEmbeddingDim(vectors);
  const buf = new Float32Array(vectors.length * dim);
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i];
    if (!v) continue;
    buf.set(v, i * dim);
  }
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function unpackEmbeddings(
  buf: Buffer,
  dim: number,
): Float32Array[] {
  const total = buf.byteLength / 4;
  const arr = new Float32Array(buf.buffer, buf.byteOffset, total);
  const count = total / dim;
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = new Float32Array(arr.subarray(i * dim, (i + 1) * dim));
  }
  return out;
}

export function saveEmbeddings(vectors: Float32Array[]): void {
  const dim = vectors.length > 0 ? getEmbeddingDim(vectors) : 0;
  const meta = { count: vectors.length, dim };
  fs.mkdirSync(path.dirname(config.EMBEDDINGS_PATH), { recursive: true });
  fs.writeFileSync(config.EMBEDDINGS_PATH, packEmbeddings(vectors));
  fs.writeFileSync(`${config.EMBEDDINGS_PATH}.meta.json`, JSON.stringify(meta));
}

export function loadEmbeddings(): { vectors: Float32Array[]; dim: number } {
  const metaPath = `${config.EMBEDDINGS_PATH}.meta.json`;
  if (!fs.existsSync(config.EMBEDDINGS_PATH) || !fs.existsSync(metaPath)) {
    throw new Error('embeddings cache not found; run pnpm ingest first');
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { count: number; dim: number };
  const buf = fs.readFileSync(config.EMBEDDINGS_PATH);
  return { vectors: unpackEmbeddings(buf, meta.dim), dim: meta.dim };
}

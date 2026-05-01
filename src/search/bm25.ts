import { create, insertMultiple, search } from '@orama/orama';
import type { Product } from '../ingestion/types.js';

export type BM25Index = unknown;

export type BM25Hit = {
  offerId: number;
  score: number;
};

const SCHEMA = {
  offerId: 'number',
  name: 'string',
  vendor: 'string',
  vendorCode: 'string',
  vendorCodeNorm: 'string',
  model: 'string',
  description: 'string',
  searchText: 'string',
} as const;

export async function buildBm25Index(products: Product[]): Promise<BM25Index> {
  const db = await create({
    schema: SCHEMA,
    components: {
      tokenizer: { language: 'russian', stemming: false },
    },
  });
  const docs = products.map((p) => ({
    offerId: p.offerId,
    name: p.name,
    vendor: p.vendor.raw,
    vendorCode: p.vendorCode,
    vendorCodeNorm: p.vendorCodeNorm,
    model: p.model,
    description: p.description,
    searchText: p.searchText,
  }));
  await insertMultiple(db, docs);
  return db;
}

export async function searchBm25(
  db: BM25Index,
  query: string,
  topK: number,
): Promise<BM25Hit[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await (search as any)(db, {
    term: query,
    properties: ['name', 'vendor', 'vendorCode', 'vendorCodeNorm', 'model', 'description', 'searchText'],
    boost: { name: 2, vendorCode: 4, vendorCodeNorm: 4, vendor: 1.5 },
    limit: topK,
    threshold: 0,
  });
  return (results.hits as Array<{ document: { offerId: number }; score: number }>).map((h) => ({
    offerId: h.document.offerId,
    score: h.score,
  }));
}

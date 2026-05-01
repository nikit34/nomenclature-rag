import type { Product } from '../ingestion/types.js';
import type { BM25Index } from './bm25.js';
import { searchBm25 } from './bm25.js';
import { embedOne } from './embeddings.js';
import { topKDense } from './vector.js';
import { detectCities } from './cityAliases.js';
import type { Warehouse } from '../ingestion/types.js';

export type HybridHit = {
  product: Product;
  bm25Rank?: number;
  denseRank?: number;
  rrfScore: number;
  signals: { bm25?: number; dense?: number };
};

const RRF_K = 60;

function rrf(rank: number): number {
  return 1 / (RRF_K + rank);
}

export type HybridDeps = {
  products: Product[];
  productIndexById: Map<number, number>;
  bm25: BM25Index;
  embeddings: Float32Array[];
};

export async function hybridSearch(
  deps: HybridDeps,
  query: string,
  opts: { kBm25: number; kDense: number; kFinal: number },
): Promise<HybridHit[]> {
  const [bm25Results, qVec] = await Promise.all([
    searchBm25(deps.bm25, query, opts.kBm25),
    embedOne(query),
  ]);
  const denseResults = topKDense(qVec, deps.embeddings, opts.kDense);

  const merged = new Map<number, HybridHit>();

  bm25Results.forEach((hit, rank) => {
    const idx = deps.productIndexById.get(hit.offerId);
    if (idx === undefined) return;
    const product = deps.products[idx];
    if (!product) return;
    merged.set(hit.offerId, {
      product,
      bm25Rank: rank + 1,
      rrfScore: rrf(rank + 1),
      signals: { bm25: hit.score },
    });
  });

  denseResults.forEach((hit, rank) => {
    const product = deps.products[hit.index];
    if (!product) return;
    const existing = merged.get(product.offerId);
    if (existing) {
      existing.denseRank = rank + 1;
      existing.rrfScore += rrf(rank + 1);
      existing.signals.dense = hit.score;
    } else {
      merged.set(product.offerId, {
        product,
        denseRank: rank + 1,
        rrfScore: rrf(rank + 1),
        signals: { dense: hit.score },
      });
    }
  });

  return Array.from(merged.values())
    .sort((a, b) => b.rrfScore - a.rrfScore)
    .slice(0, opts.kFinal);
}

export function inferCities(query: string): Warehouse[] {
  return detectCities(query);
}

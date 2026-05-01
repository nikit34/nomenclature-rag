import type { Product } from '../ingestion/types.js';
import type { BM25Hit, BM25Index } from './bm25.js';
import { searchBm25 } from './bm25.js';
import { embedOne } from './embeddings.js';
import { topKDense, type DenseHit } from './vector.js';
import { detectCities } from './cityAliases.js';
import type { Warehouse } from '../ingestion/types.js';
import { findCodeMatches, type VendorCodeIndex } from './exactMatch.js';
import type { BrandIndex } from './brandIndex.js';

export type HybridHit = {
  product: Product;
  bm25Rank?: number;
  denseRank?: number;
  rrfScore: number;
  signals: {
    bm25?: number;
    dense?: number;
    exactCode?: 'exact' | 'prefix';
  };
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
  vendorCodeIndex: VendorCodeIndex;
  brandIndex: BrandIndex;
};

export function rrfMerge(
  products: Product[],
  productIndexById: Map<number, number>,
  bm25Results: BM25Hit[],
  denseResults: DenseHit[],
  kFinal: number,
): HybridHit[] {
  const merged = new Map<number, HybridHit>();

  bm25Results.forEach((hit, rank) => {
    const idx = productIndexById.get(hit.offerId);
    if (idx === undefined) return;
    const product = products[idx];
    if (!product) return;
    merged.set(hit.offerId, {
      product,
      bm25Rank: rank + 1,
      rrfScore: rrf(rank + 1),
      signals: { bm25: hit.score },
    });
  });

  denseResults.forEach((hit, rank) => {
    const product = products[hit.index];
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
    .slice(0, kFinal);
}

export function pinCodeMatches(
  products: Product[],
  query: string,
  index: VendorCodeIndex,
  rrfHits: HybridHit[],
  kFinal: number,
): HybridHit[] {
  const matches = findCodeMatches(query, index);
  if (matches.length === 0) return rrfHits.slice(0, kFinal);

  const out: HybridHit[] = [];
  const seenOffer = new Set<number>();

  matches.forEach((m, i) => {
    const product = products[m.productIndex];
    if (!product) return;
    if (seenOffer.has(product.offerId)) return;
    seenOffer.add(product.offerId);
    out.push({
      product,
      rrfScore: 1 + 1 / (i + 1),
      signals: { exactCode: m.type },
    });
  });

  for (const hit of rrfHits) {
    if (out.length >= kFinal) break;
    if (seenOffer.has(hit.product.offerId)) continue;
    out.push(hit);
  }

  return out.slice(0, kFinal);
}

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
  const rrfHits = rrfMerge(
    deps.products,
    deps.productIndexById,
    bm25Results,
    denseResults,
    Math.max(opts.kFinal * 2, opts.kFinal + 10),
  );
  return pinCodeMatches(deps.products, query, deps.vendorCodeIndex, rrfHits, opts.kFinal);
}

export function inferCities(query: string): Warehouse[] {
  return detectCities(query);
}

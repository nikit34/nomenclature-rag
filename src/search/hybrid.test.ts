import { describe, expect, it } from 'vitest';
import { rrfMerge } from './hybrid.js';
import type { Product } from '../ingestion/types.js';
import type { BM25Hit } from './bm25.js';
import type { DenseHit } from './vector.js';

function p(offerId: number): Product {
  return {
    offerId,
    name: `Product ${offerId}`,
    vendor: { raw: 'V' },
    model: 'M',
    vendorCode: `VC-${offerId}`,
    vendorCodeNorm: `vc${offerId}`,
    description: '',
    attrs: {},
    numericAttrs: {},
    categoryId: 1,
    unit: 'шт',
    prices: { retail: 1 },
    warrantyManufacturer: true,
    available: true,
    stocks: {},
    searchText: '',
  };
}

function makeProducts(ids: number[]) {
  const products = ids.map(p);
  const productIndexById = new Map<number, number>();
  products.forEach((prod, i) => productIndexById.set(prod.offerId, i));
  return { products, productIndexById };
}

describe('rrfMerge', () => {
  it('merges BM25-only and dense-only results', () => {
    const { products, productIndexById } = makeProducts([10, 20, 30]);
    const bm25: BM25Hit[] = [{ offerId: 10, score: 5 }];
    const dense: DenseHit[] = [{ index: 1, score: 0.8 }]; // 20

    const out = rrfMerge(products, productIndexById, bm25, dense, 10);
    expect(out.map((h) => h.product.offerId).sort()).toEqual([10, 20]);
    const m10 = out.find((h) => h.product.offerId === 10)!;
    const m20 = out.find((h) => h.product.offerId === 20)!;
    expect(m10.bm25Rank).toBe(1);
    expect(m10.denseRank).toBeUndefined();
    expect(m20.denseRank).toBe(1);
    expect(m20.bm25Rank).toBeUndefined();
  });

  it('items found in both sources get higher RRF score than single-source ones', () => {
    const { products, productIndexById } = makeProducts([10, 20]);
    // both at rank 1
    const bm25: BM25Hit[] = [{ offerId: 10, score: 5 }];
    const dense: DenseHit[] = [
      { index: 0, score: 0.9 }, // 10
      { index: 1, score: 0.8 }, // 20
    ];

    const out = rrfMerge(products, productIndexById, bm25, dense, 10);
    // 10 = 1/(60+1) * 2 sources, 20 = 1/(60+2) * 1 source
    expect(out[0]?.product.offerId).toBe(10);
    expect(out[1]?.product.offerId).toBe(20);
    expect(out[0]!.rrfScore).toBeGreaterThan(out[1]!.rrfScore);
  });

  it('higher-ranked items beat lower-ranked single-source items', () => {
    const { products, productIndexById } = makeProducts([10, 20, 30]);
    const bm25: BM25Hit[] = [
      { offerId: 30, score: 5 }, // rank 1
      { offerId: 20, score: 3 }, // rank 2
      { offerId: 10, score: 1 }, // rank 3
    ];
    const dense: DenseHit[] = []; // dense missing

    const out = rrfMerge(products, productIndexById, bm25, dense, 10);
    expect(out.map((h) => h.product.offerId)).toEqual([30, 20, 10]);
  });

  it('ignores BM25 hits whose offerId is not in the index', () => {
    const { products, productIndexById } = makeProducts([10]);
    const bm25: BM25Hit[] = [
      { offerId: 10, score: 5 },
      { offerId: 999, score: 4 },
    ];
    const dense: DenseHit[] = [];

    const out = rrfMerge(products, productIndexById, bm25, dense, 10);
    expect(out.map((h) => h.product.offerId)).toEqual([10]);
  });

  it('ignores dense hits whose index is out of bounds', () => {
    const { products, productIndexById } = makeProducts([10]);
    const bm25: BM25Hit[] = [];
    const dense: DenseHit[] = [
      { index: 0, score: 0.9 },
      { index: 999, score: 0.5 }, // out of bounds
    ];

    const out = rrfMerge(products, productIndexById, bm25, dense, 10);
    expect(out.map((h) => h.product.offerId)).toEqual([10]);
  });

  it('respects kFinal cap and returns sorted by score', () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const { products, productIndexById } = makeProducts(ids);
    const bm25: BM25Hit[] = ids.map((id, i) => ({ offerId: id, score: 10 - i }));
    const dense: DenseHit[] = ids.map((_, i) => ({ index: i, score: 1 - i * 0.1 }));

    const out = rrfMerge(products, productIndexById, bm25, dense, 3);
    expect(out).toHaveLength(3);
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1]!.rrfScore).toBeGreaterThanOrEqual(out[i]!.rrfScore);
    }
  });

  it('records both ranks and signals when item appears in both', () => {
    const { products, productIndexById } = makeProducts([10]);
    const bm25: BM25Hit[] = [{ offerId: 10, score: 5 }];
    const dense: DenseHit[] = [{ index: 0, score: 0.92 }];

    const out = rrfMerge(products, productIndexById, bm25, dense, 5);
    expect(out[0]?.bm25Rank).toBe(1);
    expect(out[0]?.denseRank).toBe(1);
    expect(out[0]?.signals.bm25).toBe(5);
    expect(out[0]?.signals.dense).toBe(0.92);
  });

  it('returns empty when both sources empty', () => {
    const { products, productIndexById } = makeProducts([10]);
    expect(rrfMerge(products, productIndexById, [], [], 10)).toEqual([]);
  });
});

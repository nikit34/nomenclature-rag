import { describe, expect, it } from 'vitest';
import { validateAnswer } from './validateAnswer.js';
import type { Product } from '../ingestion/types.js';
import type { HybridHit } from '../search/hybrid.js';

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

const hit = (offerId: number): HybridHit => ({ product: p(offerId), rrfScore: 1, signals: {} });

describe('validateAnswer', () => {
  it('passes when all offerIds are in retrieved set', () => {
    const hits = [hit(1), hit(2)];
    const ans = {
      summary: 'ok',
      products: [
        { offerId: 1, explanation: 'a' },
        { offerId: 2, explanation: 'b' },
      ],
      insufficient_data: false,
    };
    const r = validateAnswer(ans, hits);
    expect(r.ok).toBe(true);
    expect(r.hallucinatedOfferIds).toEqual([]);
    expect(r.validProducts).toHaveLength(2);
  });

  it('flags hallucinated offerIds', () => {
    const hits = [hit(1)];
    const ans = {
      summary: 'mixed',
      products: [
        { offerId: 1, explanation: 'real' },
        { offerId: 999, explanation: 'fake' },
      ],
      insufficient_data: false,
    };
    const r = validateAnswer(ans, hits);
    expect(r.ok).toBe(false);
    expect(r.hallucinatedOfferIds).toEqual([999]);
    expect(r.validProducts).toHaveLength(1);
  });

  it('ok=true with empty products list', () => {
    const r = validateAnswer({ summary: '', products: [], insufficient_data: true }, []);
    expect(r.ok).toBe(true);
    expect(r.validProducts).toEqual([]);
  });
});

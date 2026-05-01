import { describe, expect, it } from 'vitest';
import { buildContext, formatProductForContext, tokensApprox } from './contextBudget.js';
import type { Product } from '../ingestion/types.js';
import type { HybridHit } from '../search/hybrid.js';

function makeHit(overrides: Partial<Product> = {}): HybridHit {
  const product: Product = {
    offerId: 1,
    name: 'Test Product',
    vendor: { raw: 'TestVendor (Test)', brand: 'TestVendor', country: 'Test' },
    model: 'Test',
    vendorCode: 'T-001',
    vendorCodeNorm: 't001',
    description: 'короткое описание',
    attrs: {},
    numericAttrs: {},
    categoryId: 1,
    unit: 'шт',
    prices: { retail: 100 },
    warrantyManufacturer: true,
    available: true,
    stocks: {
      'Москва, Кантемировская': { qty: 5, approx: false },
      'Санкт-Петербург': { qty: 0, approx: false },
    },
    searchText: '',
    ...overrides,
  };
  return { product, rrfScore: 1, signals: {} };
}

describe('tokensApprox', () => {
  it('returns 0 for empty', () => expect(tokensApprox('')).toBe(0));
  it('approximates ~2.7 chars per token (cyrillic-friendly)', () => {
    // 27 chars / 2.7 = 10
    expect(tokensApprox('a'.repeat(27))).toBe(10);
  });
});

describe('formatProductForContext', () => {
  it('renders all key fields', () => {
    const text = formatProductForContext(makeHit(), 0);
    expect(text).toContain('offerId=1');
    expect(text).toContain('vendorCode=T-001');
    expect(text).toContain('TestVendor');
    expect(text).toContain('100 RUR');
    expect(text).toContain('Москва, Кантемировская: 5');
  });

  it('shows "100+" for approx stocks', () => {
    const text = formatProductForContext(
      makeHit({ stocks: { Москва: { qty: 100, approx: true } } }),
      0,
    );
    expect(text).toContain('Москва: 100+');
  });
});

describe('buildContext', () => {
  it('keeps all hits when under budget', () => {
    const hits = [makeHit(), makeHit({ offerId: 2 })];
    const out = buildContext(hits, 10000);
    expect(out.items).toHaveLength(2);
    expect(out.truncated).toBe(false);
  });

  it('truncates when over budget', () => {
    const hits = Array.from({ length: 50 }, (_, i) => makeHit({ offerId: i + 1 }));
    const out = buildContext(hits, 100);
    expect(out.items.length).toBeLessThan(50);
    expect(out.truncated).toBe(true);
    expect(out.totalTokens).toBeLessThanOrEqual(100);
  });
});

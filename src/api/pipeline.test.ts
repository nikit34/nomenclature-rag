import { describe, expect, it } from 'vitest';
import { __testing, type AskFilters, type ApiProduct } from './pipeline.js';
import type { Product } from '../ingestion/types.js';
import type { HybridHit } from '../search/hybrid.js';

const { mergeFilters, sortProducts, computeRefinementOptions, toApiProduct } = __testing;

function p(overrides: Partial<Product> & { offerId: number }): Product {
  return {
    name: `Product ${overrides.offerId}`,
    vendor: { raw: 'V' },
    model: 'M',
    vendorCode: `VC-${overrides.offerId}`,
    vendorCodeNorm: `vc${overrides.offerId}`,
    description: '',
    attrs: {},
    numericAttrs: {},
    categoryId: 1,
    unit: 'шт',
    prices: { retail: 100 },
    warrantyManufacturer: true,
    available: true,
    stocks: {},
    searchText: '',
    ...overrides,
  };
}

const hit = (product: Product): HybridHit => ({ product, rrfScore: 1, signals: {} });

describe('mergeFilters', () => {
  it('returns inferred when user is undefined', () => {
    const inferred: AskFilters = { cities: ['Москва, Кантемировская'], brands: ['PULSE'] };
    expect(mergeFilters(inferred, undefined)).toEqual(inferred);
  });

  it('user-provided cities override inferred', () => {
    const inferred: AskFilters = { cities: ['Москва, Кантемировская'] };
    const user: AskFilters = { cities: ['Санкт-Петербург'] };
    expect(mergeFilters(inferred, user).cities).toEqual(['Санкт-Петербург']);
  });

  it('empty user array clears inferred (explicit "any")', () => {
    const inferred: AskFilters = { cities: ['Москва, Кантемировская'], brands: ['PULSE'] };
    const user: AskFilters = { cities: [], brands: [] };
    const merged = mergeFilters(inferred, user);
    expect(merged.cities).toBeUndefined();
    expect(merged.brands).toBeUndefined();
  });

  it('undefined user field falls back to inferred', () => {
    const inferred: AskFilters = { cities: ['Москва, Кантемировская'], brands: ['PULSE'] };
    const user: AskFilters = { brands: ['Italiana'] };
    const merged = mergeFilters(inferred, user);
    expect(merged.cities).toEqual(['Москва, Кантемировская']);
    expect(merged.brands).toEqual(['Italiana']);
  });

  it('requireAvailable from user wins (including explicit false)', () => {
    const merged = mergeFilters({ requireAvailable: true }, { requireAvailable: false });
    expect(merged.requireAvailable).toBe(false);
  });

  it('user status overrides inferred status', () => {
    const merged = mergeFilters({ status: 'Новинка' }, { status: 'Распродажа' });
    expect(merged.status).toBe('Распродажа');
  });
});

function ap(overrides: Partial<ApiProduct> & { offerId: number; retail: number; totalStock: number }): ApiProduct {
  const { retail, totalStock, ...rest } = overrides;
  return {
    name: `P${overrides.offerId}`,
    vendorCode: `VC${overrides.offerId}`,
    vendor: { raw: 'V' },
    unit: 'шт',
    prices: { retail },
    currency: 'RUR',
    available: true,
    totalStock,
    primaryCity: null,
    primaryStock: null,
    stocks: [],
    attrs: {},
    numericAttrs: {},
    explanation: '',
    ...rest,
  };
}

describe('sortProducts', () => {
  it('relevance preserves order', () => {
    const list = [ap({ offerId: 1, retail: 300, totalStock: 5 }), ap({ offerId: 2, retail: 100, totalStock: 1 })];
    expect(sortProducts(list, 'relevance').map((p) => p.offerId)).toEqual([1, 2]);
  });

  it('price_asc orders by ascending price', () => {
    const list = [ap({ offerId: 1, retail: 300, totalStock: 5 }), ap({ offerId: 2, retail: 100, totalStock: 1 })];
    expect(sortProducts(list, 'price_asc').map((p) => p.offerId)).toEqual([2, 1]);
  });

  it('stock_desc orders by descending totalStock', () => {
    const list = [ap({ offerId: 1, retail: 300, totalStock: 1 }), ap({ offerId: 2, retail: 100, totalStock: 99 })];
    expect(sortProducts(list, 'stock_desc').map((p) => p.offerId)).toEqual([2, 1]);
  });
});

describe('computeRefinementOptions', () => {
  it('counts brands across hits', () => {
    const hits = [
      hit(p({ offerId: 1, vendor: { raw: 'PULSE', brand: 'PULSE' } })),
      hit(p({ offerId: 2, vendor: { raw: 'PULSE', brand: 'PULSE' } })),
      hit(p({ offerId: 3, vendor: { raw: 'Italiana', brand: 'Italiana Ferramenta' } })),
    ];
    const r = computeRefinementOptions(hits);
    expect(r.brands).toEqual([
      { value: 'PULSE', label: 'PULSE', count: 2 },
      { value: 'Italiana Ferramenta', label: 'Italiana Ferramenta', count: 1 },
    ]);
  });

  it('counts cities only where stock > 0', () => {
    const hits = [
      hit(p({
        offerId: 1,
        stocks: { 'Москва, Кантемировская': { qty: 5, approx: false }, 'Воронеж': { qty: 0, approx: false } },
      })),
      hit(p({ offerId: 2, stocks: { 'Москва, Кантемировская': { qty: 2, approx: false } } })),
    ];
    const r = computeRefinementOptions(hits);
    expect(r.cities.find((c) => c.value === 'Москва, Кантемировская')?.count).toBe(2);
    expect(r.cities.find((c) => c.value === 'Воронеж')).toBeUndefined();
  });

  it('counts units and statuses', () => {
    const hits = [
      hit(p({ offerId: 1, unit: 'шт', status: 'Новинка' })),
      hit(p({ offerId: 2, unit: 'пар', status: 'Распродажа' })),
      hit(p({ offerId: 3, unit: 'шт' })),
    ];
    const r = computeRefinementOptions(hits);
    expect(r.units.find((u) => u.value === 'шт')?.count).toBe(2);
    expect(r.units.find((u) => u.value === 'пар')?.count).toBe(1);
    expect(r.statuses.find((s) => s.value === 'Новинка')?.count).toBe(1);
    expect(r.statuses.find((s) => s.value === 'Распродажа')?.count).toBe(1);
  });
});

describe('toApiProduct', () => {
  it('places primary city first, then non-zero, then zero', () => {
    const product = p({
      offerId: 1,
      stocks: {
        'Москва, Кантемировская': { qty: 0, approx: false },
        'Санкт-Петербург': { qty: 3, approx: false },
        'Воронеж': { qty: 7, approx: false },
      },
    });
    const out = toApiProduct(product, 'because', 'Москва, Кантемировская');
    expect(out.stocks[0]?.city).toBe('Москва, Кантемировская');
    expect(out.stocks[1]?.qty).toBeGreaterThan(0);
    expect(out.primaryCity).toBe('Москва, Кантемировская');
    expect(out.primaryStock?.qty).toBe(0);
  });

  it('computes total stock across all warehouses', () => {
    const product = p({
      offerId: 1,
      stocks: {
        'Москва, Кантемировская': { qty: 3, approx: false },
        'Санкт-Петербург': { qty: 5, approx: true },
      },
    });
    const out = toApiProduct(product, '', null);
    expect(out.totalStock).toBe(8);
  });

  it('omits brand/country when undefined', () => {
    const product = p({ offerId: 1, vendor: { raw: 'Plain' } });
    const out = toApiProduct(product, '', null);
    expect(out.vendor.raw).toBe('Plain');
    expect(out.vendor.brand).toBeUndefined();
    expect(out.vendor.country).toBeUndefined();
  });

  it('passes through wholesale and usd prices when present', () => {
    const product = p({ offerId: 1, prices: { retail: 100, wholesale: 80, usd: 1.5 } });
    const out = toApiProduct(product, '', null);
    expect(out.prices.wholesale).toBe(80);
    expect(out.prices.usd).toBe(1.5);
  });
});

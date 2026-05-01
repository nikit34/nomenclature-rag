import { describe, expect, it } from 'vitest';
import { applyFilters, type Filters } from './filters.js';
import type { Product } from '../ingestion/types.js';
import type { HybridHit } from './hybrid.js';

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

describe('applyFilters', () => {
  it('returns all hits with empty filter', () => {
    const hits = [hit(p({ offerId: 1 })), hit(p({ offerId: 2 }))];
    expect(applyFilters(hits, {})).toHaveLength(2);
  });

  it('requireAvailable drops unavailable products', () => {
    const hits = [
      hit(p({ offerId: 1, available: true })),
      hit(p({ offerId: 2, available: false })),
    ];
    const out = applyFilters(hits, { requireAvailable: true });
    expect(out.map((h) => h.product.offerId)).toEqual([1]);
  });

  it('brand filter is case-insensitive substring', () => {
    const hits = [
      hit(p({ offerId: 1, vendor: { raw: 'PULSE (Китай)', brand: 'PULSE' } })),
      hit(p({ offerId: 2, vendor: { raw: 'Italiana Ferramenta (Италия)', brand: 'Italiana Ferramenta' } })),
      hit(p({ offerId: 3, vendor: { raw: 'Permo (Италия)', brand: 'Permo' } })),
    ];
    const out = applyFilters(hits, { brand: 'italiana' });
    expect(out.map((h) => h.product.offerId)).toEqual([2]);
  });

  it('brand filter drops products without a brand', () => {
    const hits = [
      hit(p({ offerId: 1, vendor: { raw: 'Италия' } })),
      hit(p({ offerId: 2, vendor: { raw: 'PULSE (Китай)', brand: 'PULSE' } })),
    ];
    const out = applyFilters(hits, { brand: 'PULSE' });
    expect(out.map((h) => h.product.offerId)).toEqual([2]);
  });

  it('status filter exact-matches', () => {
    const hits = [
      hit(p({ offerId: 1, status: 'Новинка' })),
      hit(p({ offerId: 2, status: 'Распродажа' })),
      hit(p({ offerId: 3 })),
    ];
    expect(applyFilters(hits, { status: 'Новинка' }).map((h) => h.product.offerId)).toEqual([1]);
    expect(applyFilters(hits, { status: 'Распродажа' }).map((h) => h.product.offerId)).toEqual([2]);
  });

  it('unit filter exact-matches', () => {
    const hits = [
      hit(p({ offerId: 1, unit: 'шт' })),
      hit(p({ offerId: 2, unit: 'пар' })),
      hit(p({ offerId: 3, unit: 'компл' })),
    ];
    expect(applyFilters(hits, { unit: 'пар' }).map((h) => h.product.offerId)).toEqual([2]);
  });

  it('city filter keeps products with stock>0 in any matching warehouse', () => {
    const hits = [
      hit(p({ offerId: 1, stocks: { 'Москва, Кантемировская': { qty: 5, approx: false } } })),
      hit(p({ offerId: 2, stocks: { 'Санкт-Петербург': { qty: 3, approx: false } } })),
      hit(p({
        offerId: 3,
        stocks: {
          'Москва, Кантемировская': { qty: 0, approx: false },
          'Королёв': { qty: 2, approx: false },
        },
      })),
    ];
    const out = applyFilters(hits, { cities: ['Москва, Кантемировская', 'Королёв'] });
    expect(out.map((h) => h.product.offerId).sort()).toEqual([1, 3]);
  });

  it('city filter drops products with zero stock everywhere in the cities', () => {
    const hits = [
      hit(p({ offerId: 1, stocks: { 'Санкт-Петербург': { qty: 0, approx: false } } })),
    ];
    expect(applyFilters(hits, { cities: ['Санкт-Петербург'] })).toEqual([]);
  });

  it('combines multiple filters as AND', () => {
    const hits = [
      hit(p({
        offerId: 1,
        vendor: { raw: 'Italiana Ferramenta (Италия)', brand: 'Italiana Ferramenta' },
        unit: 'пар',
        stocks: { 'Москва, Кантемировская': { qty: 5, approx: false } },
      })),
      hit(p({
        offerId: 2,
        vendor: { raw: 'Italiana Ferramenta (Италия)', brand: 'Italiana Ferramenta' },
        unit: 'шт',
        stocks: { 'Москва, Кантемировская': { qty: 5, approx: false } },
      })),
      hit(p({
        offerId: 3,
        vendor: { raw: 'PULSE', brand: 'PULSE' },
        unit: 'пар',
        stocks: { 'Москва, Кантемировская': { qty: 5, approx: false } },
      })),
    ];
    const out = applyFilters(hits, {
      brand: 'Italiana',
      unit: 'пар',
      cities: ['Москва, Кантемировская'],
    });
    expect(out.map((h) => h.product.offerId)).toEqual([1]);
  });
});

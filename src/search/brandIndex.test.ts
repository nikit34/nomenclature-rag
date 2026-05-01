import { describe, expect, it } from 'vitest';
import { buildBrandIndex, detectBrand } from './brandIndex.js';
import type { Product } from '../ingestion/types.js';

function p(offerId: number, brand: string | undefined, raw = brand ?? ''): Product {
  return {
    offerId,
    name: `n${offerId}`,
    vendor: { raw, brand },
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

const PRODUCTS: Product[] = [
  p(1, 'PULSE'),
  p(2, 'Italiana Ferramenta'),
  p(3, 'Permo'),
  p(4, 'Пермо/Permo'),
  p(5, 'Virutex'),
  p(6, undefined, 'Италия'),
  p(7, 'Italiana Ferramenta'), // dup
  p(8, 'Vibo'),
];

describe('buildBrandIndex', () => {
  it('collects distinct brands', () => {
    const idx = buildBrandIndex(PRODUCTS);
    expect(idx.byLower.has('pulse')).toBe(true);
    expect(idx.byLower.has('italiana ferramenta')).toBe(true);
    expect(idx.byLower.has('permo')).toBe(true);
    expect(idx.byLower.has('пермо/permo')).toBe(true);
  });

  it('blocklists country-only "brands"', () => {
    const idx = buildBrandIndex([p(99, undefined, 'Италия'), ...PRODUCTS]);
    expect(idx.byLower.has('италия')).toBe(false);
  });

  it('sorts brandsLower longest-first', () => {
    const idx = buildBrandIndex(PRODUCTS);
    const lens = idx.brandsLower.map((s) => s.length);
    for (let i = 1; i < lens.length; i++) {
      expect(lens[i - 1]).toBeGreaterThanOrEqual(lens[i]!);
    }
  });
});

describe('detectBrand', () => {
  const idx = buildBrandIndex(PRODUCTS);

  it('matches a single-word brand', () => {
    expect(detectBrand('товары PULSE', idx)).toBe('PULSE');
    expect(detectBrand('что есть от Permo', idx)).toBe('Permo');
  });

  it('matches a multi-word brand', () => {
    expect(detectBrand('товары Italiana Ferramenta', idx)).toBe('Italiana Ferramenta');
  });

  it('is case-insensitive', () => {
    expect(detectBrand('что есть от pulse', idx)).toBe('PULSE');
    expect(detectBrand('italiana ferramenta на складе', idx)).toBe('Italiana Ferramenta');
  });

  it('prefers longer brand when shorter one is a substring of the query', () => {
    // both "Permo" and "Пермо/Permo" exist; longer one wins.
    const out = detectBrand('товары Пермо/Permo производство', idx);
    expect(out).toBe('Пермо/Permo');
  });

  it('does not match brand inside a larger word', () => {
    expect(detectBrand('виртуальный', idx)).toBeUndefined();
    expect(detectBrand('продукция (PULSEX)', idx)).toBeUndefined();
  });

  it('returns undefined when no brand mentioned', () => {
    expect(detectBrand('винты M4 длиной 45 мм оцинкованные', idx)).toBeUndefined();
  });

  it('ignores country names that look like brands', () => {
    expect(detectBrand('из Италии', idx)).toBeUndefined();
    expect(detectBrand('товары Италия', idx)).toBeUndefined();
  });

  it('handles punctuation around the brand', () => {
    expect(detectBrand('PULSE,', idx)).toBe('PULSE');
    expect(detectBrand('(PULSE)', idx)).toBe('PULSE');
  });
});

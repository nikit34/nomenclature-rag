import { describe, expect, it } from 'vitest';
import type { Product } from '../ingestion/types.js';
import { buildVendorCodeIndex, findCodeMatches } from './exactMatch.js';

function product(offerId: number, vendorCode: string, vendorCodeNorm: string): Product {
  return {
    offerId,
    name: `n${offerId}`,
    vendor: { raw: 'V' },
    model: 'M',
    vendorCode,
    vendorCodeNorm,
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
  product(4479, 'ZZ150 M4 X45 IB/ШТ', 'zz150m4x45ibшт'),
  product(5131, 'ZZ150BR M4 X45 IB/ШТ', 'zz150brm4x45ibшт'),
  product(5327, '7033 50', '703350'),
  product(5328, '7033 60', '703360'),
  product(9999, 'OTH-001', 'oth001'),
];

describe('buildVendorCodeIndex', () => {
  it('indexes all unique normalized codes', () => {
    const idx = buildVendorCodeIndex(PRODUCTS);
    expect(idx.exact.get('zz150m4x45ibшт')).toEqual([0]);
    expect(idx.exact.get('703350')).toEqual([2]);
    expect(idx.norms).toEqual([...idx.norms].sort());
  });

  it('groups products with identical normalized codes', () => {
    const dup = [
      product(1, 'AB-1', 'ab1'),
      product(2, 'AB 1', 'ab1'),
    ];
    const idx = buildVendorCodeIndex(dup);
    expect(idx.exact.get('ab1')).toEqual([0, 1]);
  });
});

describe('findCodeMatches', () => {
  const idx = buildVendorCodeIndex(PRODUCTS);

  it('exact match on full normalized vendorCode', () => {
    const m = findCodeMatches('ZZ150 M4 X45 IB/ШТ', idx);
    expect(m).toHaveLength(1);
    expect(m[0]?.type).toBe('exact');
    expect(PRODUCTS[m[0]!.productIndex]?.offerId).toBe(4479);
  });

  it('exact match on space-separated digits "7033 50"', () => {
    const m = findCodeMatches('нужен 7033 50', idx);
    expect(m.find((x) => PRODUCTS[x.productIndex]?.offerId === 5327)?.type).toBe('exact');
  });

  it('prefix match on "ZZ150" pins both ZZ150* products', () => {
    const m = findCodeMatches('ZZ150', idx);
    const ids = m.map((x) => PRODUCTS[x.productIndex]?.offerId).sort();
    expect(ids).toEqual([4479, 5131]);
    expect(m.every((x) => x.type === 'prefix')).toBe(true);
  });

  it('prefers exact over prefix when both apply', () => {
    const m = findCodeMatches('ZZ150 M4 X45 IB/ШТ', idx);
    expect(m[0]?.type).toBe('exact');
  });

  it('does not pin on short tokens like "M4"', () => {
    const m = findCodeMatches('M4', idx);
    expect(m).toEqual([]);
  });

  it('does not pin on letters-only short prefix', () => {
    const m = findCodeMatches('винт', idx);
    expect(m).toEqual([]);
  });

  it('returns empty for non-matching query', () => {
    const m = findCodeMatches('абракадабра 99999999', idx);
    expect(m).toEqual([]);
  });

  it('handles empty query', () => {
    expect(findCodeMatches('', idx)).toEqual([]);
    expect(findCodeMatches('   ', idx)).toEqual([]);
  });

  it('combines tokens across windows up to size 5', () => {
    const m = findCodeMatches('купить ZZ150 M4 X45 IB/ШТ срочно', idx);
    expect(m.find((x) => x.type === 'exact' && PRODUCTS[x.productIndex]?.offerId === 4479)).toBeTruthy();
  });
});

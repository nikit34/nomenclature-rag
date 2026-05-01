import { describe, expect, it, beforeAll } from 'vitest';
import { buildBm25Index, searchBm25, type BM25Index } from './bm25.js';
import type { Product } from '../ingestion/types.js';

function product(p: {
  offerId: number;
  name: string;
  vendor: { raw: string; brand?: string; country?: string };
  vendorCode: string;
  vendorCodeNorm: string;
  description?: string;
  unit?: string;
}): Product {
  return {
    name: p.name,
    vendor: p.vendor,
    model: p.name,
    vendorCode: p.vendorCode,
    vendorCodeNorm: p.vendorCodeNorm,
    description: p.description ?? '',
    attrs: {},
    numericAttrs: {},
    categoryId: 1,
    unit: p.unit ?? 'шт',
    prices: { retail: 1 },
    warrantyManufacturer: true,
    available: true,
    stocks: {},
    searchText: [p.name, p.vendor.raw, p.vendorCode, p.vendorCodeNorm, p.description ?? ''].join(' \n '),
    offerId: p.offerId,
  };
}

const PRODUCTS: Product[] = [
  product({
    offerId: 4479,
    name: 'Винт с полукруглой головкой под крест, M4x45, универсальный, оцинкованный (ZZ150 M4 X45 IB/ШТ)',
    vendor: { raw: 'Permo (Италия)', brand: 'Permo', country: 'Италия' },
    vendorCode: 'ZZ150 M4 X45 IB/ШТ',
    vendorCodeNorm: 'zz150m4x45ibшт',
    description: 'тип головки: полукруглая, диаметр резьбы: 4 мм, длина: 45 мм, цвет: оцинкованный',
  }),
  product({
    offerId: 5131,
    name: 'Винт с полукруглой головкой под крест, M4x45, универсальный, бронза (ZZ150BR M4 X45 IB/ШТ)',
    vendor: { raw: 'Permo (Италия)', brand: 'Permo', country: 'Италия' },
    vendorCode: 'ZZ150BR M4 X45 IB/ШТ',
    vendorCodeNorm: 'zz150brm4x45ibшт',
    description: 'тип головки: полукруглая, диаметр резьбы: 4 мм, длина: 45 мм, цвет: бронза',
  }),
  product({
    offerId: 5327,
    name: 'KAIMAN Менсолодержатель для деревянных и стеклянных полок 7 - 41 мм, хром матовый (2 шт.) (7033 50)',
    vendor: { raw: 'Italiana Ferramenta (Италия)', brand: 'Italiana Ferramenta', country: 'Италия' },
    vendorCode: '7033 50',
    vendorCodeNorm: '703350',
    description: 'стиль: модерн, материал полки: стекло/дерево, коллекция: KAIMAN, цвет: хром матовый',
    unit: 'пар',
  }),
  product({
    offerId: 5321,
    name: 'ПЕЛИКАН Менсолодержатель для деревянных и стеклянных полок 4 - 29 мм, никель матовый (NO.66 PEARL)',
    vendor: { raw: 'PULSE (Китай)', brand: 'PULSE', country: 'Китай' },
    vendorCode: 'NO.66 PEARL',
    vendorCodeNorm: 'no66pearl',
    description: 'стиль: модерн, материал полки: стекло/дерево, коллекция: ПЕЛИКАН, цвет: никель матовый',
  }),
  product({
    offerId: 9999,
    name: 'Чехол для дрели',
    vendor: { raw: 'OtherBrand', brand: 'OtherBrand' },
    vendorCode: 'OTH-001',
    vendorCodeNorm: 'oth001',
    description: 'не имеет отношения к запросам',
  }),
];

describe('buildBm25Index + searchBm25', () => {
  let index: BM25Index;
  beforeAll(async () => {
    index = await buildBm25Index(PRODUCTS);
  });

  it('finds exact vendorCode (ZZ150 M4 X45 IB)', async () => {
    const hits = await searchBm25(index, 'ZZ150 M4 X45 IB', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.map((h) => h.offerId)).toContain(4479);
  });

  it('finds vendorCode with space normalized form (7033 50)', async () => {
    const hits = await searchBm25(index, '7033 50', 5);
    expect(hits[0]?.offerId).toBe(5327);
  });

  it('matches by single description token', async () => {
    const hits = await searchBm25(index, 'оцинкованный', 5);
    expect(hits.map((h) => h.offerId)).toContain(4479);
    expect(hits.map((h) => h.offerId)).not.toContain(5131); // бронза
  });

  it('matches by brand', async () => {
    const hits = await searchBm25(index, 'Italiana Ferramenta', 5);
    expect(hits.map((h) => h.offerId)).toContain(5327);
  });

  it('exact vendorCode beats partial-name match', async () => {
    // vendorCode is boosted ×4, so an exact vendorCode lookup
    // ranks above products that only share name tokens.
    const hits = await searchBm25(index, 'NO.66 PEARL', 5);
    expect(hits[0]?.offerId).toBe(5321);
  });

  it('respects topK limit', async () => {
    const hits = await searchBm25(index, 'винт', 2);
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('returns empty for nonsense query', async () => {
    const hits = await searchBm25(index, 'qzzxnonexistent777', 5);
    expect(hits).toEqual([]);
  });

  it('does not surface unrelated products on specific queries', async () => {
    const hits = await searchBm25(index, 'KAIMAN хром', 5);
    expect(hits.map((h) => h.offerId)).not.toContain(9999);
  });
});

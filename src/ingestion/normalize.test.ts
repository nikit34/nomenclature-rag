import { describe, expect, it } from 'vitest';
import { normalizeRow } from './normalize.js';
import { COLS } from './parseExcel.js';

function makeRow(overrides: Record<number, unknown> = {}): (string | number | null)[] {
  const row: (string | number | null)[] = new Array(25).fill(null);
  row[COLS.offerId] = 4479;
  row[COLS.price] = 6.5;
  row[COLS.currencyId] = 'RUR';
  row[COLS.categoryId] = 1367;
  row[COLS.name] = 'Винт с полукруглой головкой M4x45 (ZZ150 M4 X45 IB/ШТ)';
  row[COLS.vendor] = 'Пермо/Permo (Италия)';
  row[COLS.model] = 'Винт с полукруглой головкой M4x45';
  row[COLS.vendorCode] = 'ZZ150 M4 X45 IB/ШТ';
  row[COLS.description] = 'диаметр резьбы: 4 мм, длина: 45 мм, цвет товара: оцинкованный';
  row[COLS.warranty] = 'true';
  row[COLS.unit] = 'шт';
  row[COLS.priceWholesale] = 4.06;
  row[COLS.stockMoscowKantemirovskaya] = 3897;
  row[COLS.stockSpb] = 4399;
  row[COLS.stockKlin] = 'более 100';
  row[COLS.available] = 'есть';
  row[COLS.status] = null;
  for (const [k, v] of Object.entries(overrides)) {
    row[parseInt(k, 10)] = v as never;
  }
  return row;
}

describe('normalizeRow', () => {
  it('normalizes a typical screw product row', () => {
    const p = normalizeRow(makeRow(), 2)!;
    expect(p.offerId).toBe(4479);
    expect(p.vendorCode).toBe('ZZ150 M4 X45 IB/ШТ');
    expect(p.vendor.brand).toBe('Пермо/Permo');
    expect(p.vendor.country).toBe('Италия');
    expect(p.unit).toBe('шт');
    expect(p.prices.retail).toBe(6.5);
    expect(p.prices.wholesale).toBe(4.06);
    expect(p.numericAttrs.length_mm).toBe(45);
    expect(p.numericAttrs.threadM).toBe(4);
    expect(p.available).toBe(true);
    expect(p.warrantyManufacturer).toBe(true);
  });

  it('parses "более 100" as approx stock', () => {
    const p = normalizeRow(makeRow(), 2)!;
    expect(p.stocks['МО, Клин']).toEqual({ qty: 100, approx: true });
    expect(p.stocks['Москва, Кантемировская']).toEqual({ qty: 3897, approx: false });
  });

  it('zeros missing stock', () => {
    const p = normalizeRow(makeRow(), 2)!;
    expect(p.stocks['Воронеж']).toEqual({ qty: 0, approx: false });
  });

  it('returns null when required fields missing', () => {
    expect(normalizeRow(makeRow({ [COLS.name]: null }), 2)).toBeNull();
    expect(normalizeRow(makeRow({ [COLS.vendorCode]: null }), 2)).toBeNull();
    expect(normalizeRow(makeRow({ [COLS.price]: null }), 2)).toBeNull();
  });

  it('keeps status when in allowed set', () => {
    expect(normalizeRow(makeRow({ [COLS.status]: 'Новинка' }), 2)?.status).toBe('Новинка');
    expect(normalizeRow(makeRow({ [COLS.status]: 'Распродажа' }), 2)?.status).toBe('Распродажа');
    expect(normalizeRow(makeRow({ [COLS.status]: 'unknown' }), 2)?.status).toBeUndefined();
  });

  it('available=false when "нет"', () => {
    expect(normalizeRow(makeRow({ [COLS.available]: 'нет' }), 2)?.available).toBe(false);
  });
});

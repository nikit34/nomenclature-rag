import { describe, expect, it } from 'vitest';
import {
  buildSearchText,
  extractNumeric,
  normalizeVendorCode,
  parseAttrs,
  parseVendor,
} from './extractFeatures.js';

describe('parseVendor', () => {
  it('parses brand and country from "Brand (Country)"', () => {
    expect(parseVendor('PULSE (Китай)')).toEqual({
      raw: 'PULSE (Китай)',
      brand: 'PULSE',
      country: 'Китай',
    });
  });

  it('parses dual-language brand', () => {
    const v = parseVendor('Пермо/Permo (Италия)');
    expect(v.brand).toBe('Пермо/Permo');
    expect(v.country).toBe('Италия');
  });

  it('falls back to raw=brand when no country', () => {
    expect(parseVendor('Италия')).toEqual({ raw: 'Италия', brand: 'Италия' });
  });

  it('handles empty input', () => {
    expect(parseVendor('')).toEqual({ raw: '' });
    expect(parseVendor(null)).toEqual({ raw: '' });
  });
});

describe('normalizeVendorCode', () => {
  it('lowercases and strips spaces and slashes', () => {
    expect(normalizeVendorCode('ZZ150 M4 X45 IB/ШТ')).toBe('zz150m4x45ibшт');
    expect(normalizeVendorCode('7033 50')).toBe('703350');
    expect(normalizeVendorCode('KR120WHITE')).toBe('kr120white');
  });

  it('keeps Russian letters', () => {
    expect(normalizeVendorCode('ШТ-005')).toBe('шт005');
  });
});

describe('parseAttrs', () => {
  it('extracts colon-separated key:value pairs', () => {
    expect(parseAttrs('Длина: 45 мм, материал: сталь')).toEqual({
      'длина': '45 мм',
      'материал': 'сталь',
    });
  });

  it('handles complex multi-attr description', () => {
    const out = parseAttrs(
      'Тип головки: полукруглая, диаметр резьбы: 4 мм, длина: 45 мм, цвет товара: оцинкованный',
    );
    expect(out['тип головки']).toBe('полукруглая');
    expect(out['диаметр резьбы']).toBe('4 мм');
    expect(out['длина']).toBe('45 мм');
    expect(out['цвет товара']).toBe('оцинкованный');
  });

  it('returns {} for null/empty', () => {
    expect(parseAttrs(null)).toEqual({});
    expect(parseAttrs('')).toEqual({});
  });

  it('ignores fragments without colon', () => {
    expect(parseAttrs('хороший товар, цена: 100')).toEqual({ 'цена': '100' });
  });
});

describe('extractNumeric', () => {
  it('extracts length and diameter from attrs', () => {
    const attrs = {
      'длина': '45 мм',
      'диаметр резьбы': '4 мм',
      'цвет': 'оцинкованный',
    };
    const out = extractNumeric(attrs, 'Винт M4x45', 'Длина: 45 мм, диаметр резьбы: 4 мм');
    expect(out.length_mm).toBe(45);
    expect(out.diameter_mm).toBe(4);
    expect(out.threadM).toBe(4);
  });

  it('extracts thread from name M4x45 pattern', () => {
    const out = extractNumeric({}, 'Винт с полукруглой M4x45', null);
    expect(out.threadM).toBe(4);
    expect(out.length_mm).toBe(45);
  });

  it('converts cm to mm', () => {
    const attrs = { 'толщина': '3 см' };
    const out = extractNumeric(attrs, 'Доска', null);
    expect(out.thickness_mm).toBe(30);
  });

  it('omits absent fields', () => {
    const out = extractNumeric({ 'цвет': 'красный' }, 'Какой-то товар', null);
    expect(out.length_mm).toBeUndefined();
    expect(out.diameter_mm).toBeUndefined();
  });

  it('handles comma decimal separators', () => {
    const out = extractNumeric({ 'длина': '4,5 мм' }, 'item', null);
    expect(out.length_mm).toBe(4.5);
  });
});

describe('buildSearchText', () => {
  it('concatenates name + brand + country + vendorCode (both forms) + description', () => {
    const text = buildSearchText({
      name: 'Винт M4x45',
      vendor: { raw: 'PULSE (Китай)', brand: 'PULSE', country: 'Китай' },
      vendorCode: 'ZZ150 M4 X45 IB',
      description: 'Длина: 45 мм',
      attrs: {},
    });
    expect(text).toContain('Винт M4x45');
    expect(text).toContain('PULSE');
    expect(text).toContain('Китай');
    expect(text).toContain('ZZ150 M4 X45 IB');
    expect(text).toContain('zz150m4x45ib');
    expect(text).toContain('Длина: 45 мм');
  });
});

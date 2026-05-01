import { z } from 'zod';
import type { Product, Stock } from './types.js';
import { COLS, STOCK_COLS, type RawRow } from './parseExcel.js';
import {
  buildSearchText,
  extractNumeric,
  normalizeVendorCode,
  parseAttrs,
  parseVendor,
} from './extractFeatures.js';

const STATUS_VALUES = new Set(['Распродажа', 'Новинка']);

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function toNumOr(v: unknown, fallback: number | undefined = undefined): number | undefined {
  if (v === null || v === undefined || v === '') return fallback;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function parseStock(v: unknown): Stock {
  if (typeof v === 'number' && Number.isFinite(v)) return { qty: Math.max(0, v), approx: false };
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (!s) return { qty: 0, approx: false };
    if (s.startsWith('более')) {
      const m = /(\d+)/.exec(s);
      const n = m && m[1] ? parseInt(m[1], 10) : 100;
      return { qty: n, approx: true };
    }
    const n = parseInt(s.replace(/\D/g, ''), 10);
    if (Number.isFinite(n)) return { qty: n, approx: false };
  }
  return { qty: 0, approx: false };
}

const productSchema = z.object({
  offerId: z.number().int().nonnegative(),
  name: z.string().min(1),
  vendorCode: z.string().min(1),
});

export function normalizeRow(row: RawRow, lineNo: number): Product | null {
  const offerIdRaw = row[COLS.offerId];
  const name = toStr(row[COLS.name]);
  const vendorCode = toStr(row[COLS.vendorCode]);
  if (offerIdRaw === null || offerIdRaw === undefined || !name || !vendorCode) {
    return null;
  }
  const offerId = typeof offerIdRaw === 'number' ? offerIdRaw : parseInt(String(offerIdRaw), 10);
  if (!Number.isFinite(offerId)) return null;

  const vendor = parseVendor(toStr(row[COLS.vendor]));
  const description = toStr(row[COLS.description]);
  const attrs = parseAttrs(description);
  const numericAttrs = extractNumeric(attrs, name, description);
  const model = toStr(row[COLS.model]) ?? name;

  const stocks: Record<string, Stock> = {};
  for (const [whName, colIdx] of Object.entries(STOCK_COLS)) {
    stocks[whName] = parseStock(row[colIdx]);
  }

  const statusRaw = toStr(row[COLS.status]);
  const status = statusRaw && STATUS_VALUES.has(statusRaw) ? (statusRaw as 'Распродажа' | 'Новинка') : undefined;

  const availableStr = toStr(row[COLS.available]);
  const available = availableStr === 'есть';

  const warrantyRaw = toStr(row[COLS.warranty]);
  const warrantyManufacturer = warrantyRaw === 'true' || warrantyRaw === 'TRUE';

  const retail = toNumOr(row[COLS.price]);
  if (retail === undefined) {
    return null;
  }

  const product: Product = {
    offerId,
    name,
    vendor,
    model,
    vendorCode,
    vendorCodeNorm: normalizeVendorCode(vendorCode),
    description: description ?? '',
    attrs,
    numericAttrs,
    categoryId: typeof row[COLS.categoryId] === 'number' ? (row[COLS.categoryId] as number) : 0,
    unit: toStr(row[COLS.unit]),
    prices: {
      retail,
      wholesale: toNumOr(row[COLS.priceWholesale]),
      legalEntityBYN: toNumOr(row[COLS.priceBynLegal]),
      individualBYN: toNumOr(row[COLS.priceBynIndiv]),
      usd: toNumOr(row[COLS.priceUsd]),
    },
    hitSales: toNumOr(row[COLS.hitSales]),
    warrantyManufacturer,
    status,
    available,
    stocks,
    searchText: '',
  };

  product.searchText = buildSearchText({
    name: product.name,
    vendor: product.vendor,
    vendorCode: product.vendorCode,
    description: product.description || null,
    attrs: product.attrs,
  });

  productSchema.parse(product);
  return product;
}

export function normalizeAll(rows: RawRow[]): {
  products: Product[];
  skipped: number;
} {
  const products: Product[] = [];
  let skipped = 0;
  rows.forEach((row, i) => {
    try {
      const p = normalizeRow(row, i + 2);
      if (p) products.push(p);
      else skipped++;
    } catch {
      skipped++;
    }
  });
  return { products, skipped };
}

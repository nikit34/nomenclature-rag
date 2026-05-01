import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { logger } from '../observability/logger.js';

XLSX.set_fs(fs);

export type RawRow = (string | number | null)[];

export const COLS = {
  offerId: 0,
  price: 1,
  currencyId: 2,
  categoryId: 3,
  name: 4,
  vendor: 5,
  model: 6,
  vendorCode: 7,
  description: 8,
  warranty: 9,
  priceWholesale: 10,
  hitSales: 11,
  unit: 12,
  priceUsd: 13,
  stockMoscowKantemirovskaya: 14,
  stockSpb: 15,
  stockVoronezh: 16,
  priceBynLegal: 17,
  priceBynIndiv: 18,
  stockKorolev: 19,
  stockKrasnodar: 20,
  stockKazan: 21,
  stockKlin: 22,
  available: 23,
  status: 24,
} as const;

export const STOCK_COLS: Record<string, number> = {
  'Москва, Кантемировская': COLS.stockMoscowKantemirovskaya,
  'Санкт-Петербург': COLS.stockSpb,
  'Воронеж': COLS.stockVoronezh,
  'Королёв': COLS.stockKorolev,
  'Краснодар': COLS.stockKrasnodar,
  'Казань': COLS.stockKazan,
  'МО, Клин': COLS.stockKlin,
};

export function readWorkbook(filePath: string): RawRow[] {
  logger.info({ filePath }, 'reading xlsx');
  const wb = XLSX.readFile(filePath, { cellDates: false, cellNF: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error('no sheets in workbook');
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error(`sheet ${sheetName} not readable`);
  const rows = XLSX.utils.sheet_to_json<RawRow>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
  if (rows.length < 2) throw new Error('xlsx has no data rows');
  return rows.slice(1);
}

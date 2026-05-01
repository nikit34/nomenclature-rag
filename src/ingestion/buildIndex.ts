import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';
import { readWorkbook } from './parseExcel.js';
import { normalizeAll } from './normalize.js';
import type { Product } from './types.js';

export function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function ensureCacheDir(): void {
  fs.mkdirSync(config.CACHE_DIR_ABS, { recursive: true });
}

export function loadProducts(): Product[] {
  const raw = fs.readFileSync(config.PRODUCTS_PATH, 'utf8');
  return JSON.parse(raw) as Product[];
}

export function saveProducts(products: Product[]): void {
  ensureCacheDir();
  fs.writeFileSync(config.PRODUCTS_PATH, JSON.stringify(products));
}

export function isCacheValid(): boolean {
  if (!fs.existsSync(config.HASH_PATH)) return false;
  if (!fs.existsSync(config.PRODUCTS_PATH)) return false;
  if (!fs.existsSync(config.EMBEDDINGS_PATH)) return false;
  const stored = fs.readFileSync(config.HASH_PATH, 'utf8').trim();
  const current = hashFile(config.DATA_FILE_ABS);
  return stored === current;
}

export function writeHash(): void {
  ensureCacheDir();
  fs.writeFileSync(config.HASH_PATH, hashFile(config.DATA_FILE_ABS));
}

export function ingestExcelOnly(): { products: Product[]; skipped: number } {
  if (!fs.existsSync(config.DATA_FILE_ABS)) {
    throw new Error(`data file not found: ${config.DATA_FILE_ABS}`);
  }
  const rows = readWorkbook(config.DATA_FILE_ABS);
  logger.info({ rows: rows.length }, 'rows read from xlsx');
  const { products, skipped } = normalizeAll(rows);
  logger.info({ products: products.length, skipped }, 'normalization complete');
  return { products, skipped };
}

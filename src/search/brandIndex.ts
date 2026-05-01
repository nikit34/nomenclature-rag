import type { Product } from '../ingestion/types.js';

export type BrandIndex = {
  /** lowercased brand strings, sorted by length desc so longer brands match first */
  brandsLower: string[];
  /** lowercased → original-cased brand */
  byLower: Map<string, string>;
};

/**
 * Lowercased forms that look like brands in the data but are actually country
 * names (a data-quality artefact: 397 rows have vendor="Италия" with no brand).
 * Excluded from detection to avoid false positives on natural-language queries
 * mentioning a country.
 */
const COUNTRY_BLOCKLIST = new Set([
  'италия',
  'россия',
  'китай',
  'испания',
  'португалия',
  'германия',
  'польша',
  'турция',
  'белоруссия',
  'украина',
  'индия',
]);

const MIN_BRAND_LEN = 3;

export function buildBrandIndex(products: Product[]): BrandIndex {
  const byLower = new Map<string, string>();
  for (const p of products) {
    const b = p.vendor.brand;
    if (!b) continue;
    const trimmed = b.trim();
    if (trimmed.length < MIN_BRAND_LEN) continue;
    const lc = trimmed.toLowerCase();
    if (COUNTRY_BLOCKLIST.has(lc)) continue;
    if (!byLower.has(lc)) byLower.set(lc, trimmed);
  }
  const brandsLower = Array.from(byLower.keys()).sort((a, b) => b.length - a.length);
  return { brandsLower, byLower };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detects the longest brand mention in the query as a token-bounded match
 * (the brand must be surrounded by non-letter/digit chars or string ends).
 * Returns the original-cased brand or undefined.
 */
export function detectBrand(query: string, idx: BrandIndex): string | undefined {
  if (!query) return undefined;
  const ql = query.toLowerCase();
  for (const lc of idx.brandsLower) {
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(lc)}(?:[^\\p{L}\\p{N}]|$)`, 'iu');
    if (re.test(ql)) return idx.byLower.get(lc);
  }
  return undefined;
}

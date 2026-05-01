import type { Product } from '../ingestion/types.js';
import { normalizeVendorCode } from '../ingestion/extractFeatures.js';

export type VendorCodeIndex = {
  exact: Map<string, number[]>;
  norms: string[];
};

export type CodeMatch = {
  productIndex: number;
  type: 'exact' | 'prefix';
  key: string;
};

const MAX_WINDOW = 5;
const MIN_LEN_EXACT = 3;
const MIN_LEN_PREFIX = 5;
const MAX_PREFIX_EXPANSION = 50;

export function buildVendorCodeIndex(products: Product[]): VendorCodeIndex {
  const exact = new Map<string, number[]>();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p) continue;
    const k = p.vendorCodeNorm;
    if (!k) continue;
    const arr = exact.get(k);
    if (arr) arr.push(i);
    else exact.set(k, [i]);
  }
  const norms = Array.from(exact.keys()).sort();
  return { exact, norms };
}

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

function lowerBound(arr: string[], target: string): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function findCodeMatches(query: string, idx: VendorCodeIndex): CodeMatch[] {
  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const windows: string[] = [];
  const seenKeys = new Set<string>();
  for (let size = Math.min(MAX_WINDOW, tokens.length); size >= 1; size--) {
    for (let start = 0; start + size <= tokens.length; start++) {
      const slice = tokens.slice(start, start + size).join(' ');
      const key = normalizeVendorCode(slice);
      if (!key) continue;
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      windows.push(key);
    }
  }

  const seenExact = new Set<number>();
  const seenPrefix = new Set<number>();
  const exactKeys: string[] = [];
  const exactMatches: CodeMatch[] = [];
  const prefixMatches: CodeMatch[] = [];

  for (const key of windows) {
    if (key.length < MIN_LEN_EXACT) continue;
    const hits = idx.exact.get(key);
    if (!hits) continue;
    exactKeys.push(key);
    for (const i of hits) {
      if (seenExact.has(i)) continue;
      seenExact.add(i);
      exactMatches.push({ productIndex: i, type: 'exact', key });
    }
  }

  for (const key of windows) {
    if (key.length < MIN_LEN_PREFIX) continue;
    if (!hasDigit(key)) continue;
    if (exactKeys.some((ek) => ek.startsWith(key))) continue;
    const lb = lowerBound(idx.norms, key);
    let expanded = 0;
    for (let p = lb; p < idx.norms.length; p++) {
      const norm = idx.norms[p]!;
      if (!norm.startsWith(key)) break;
      if (norm === key) continue;
      if (expanded++ >= MAX_PREFIX_EXPANSION) break;
      const products = idx.exact.get(norm);
      if (!products) continue;
      for (const pi of products) {
        if (seenExact.has(pi) || seenPrefix.has(pi)) continue;
        seenPrefix.add(pi);
        prefixMatches.push({ productIndex: pi, type: 'prefix', key });
      }
    }
  }

  return [...exactMatches, ...prefixMatches];
}

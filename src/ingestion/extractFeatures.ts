import type { NumericAttrs, Vendor } from './types.js';

export function parseVendor(raw: string | null): Vendor {
  const safe = (raw ?? '').trim();
  if (!safe) return { raw: '' };
  const m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(safe);
  if (m) {
    return {
      raw: safe,
      brand: m[1]?.trim() || undefined,
      country: m[2]?.trim() || undefined,
    };
  }
  return { raw: safe, brand: safe };
}

export function normalizeVendorCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9а-яё]/giu, '');
}

export function parseAttrs(description: string | null): Record<string, string> {
  if (!description) return {};
  const out: Record<string, string> = {};
  for (const chunk of description.split(/[,;]/)) {
    const idx = chunk.indexOf(':');
    if (idx <= 0) continue;
    const k = chunk.slice(0, idx).trim().toLowerCase();
    const v = chunk
      .slice(idx + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (k && v) out[k] = v;
  }
  return out;
}

const MM_PER_CM = 10;

function pickNumber(...values: (string | undefined)[]): number | undefined {
  for (const v of values) {
    if (!v) continue;
    const m = /(-?\d+(?:[.,]\d+)?)/.exec(v);
    if (m && m[1]) return parseFloat(m[1].replace(',', '.'));
  }
  return undefined;
}

function detectUnitMm(s: string | undefined): number | undefined {
  if (!s) return undefined;
  if (/см\b/i.test(s)) {
    const n = pickNumber(s);
    return n !== undefined ? n * MM_PER_CM : undefined;
  }
  return pickNumber(s);
}

export function extractNumeric(
  attrs: Record<string, string>,
  name: string,
  description: string | null,
): NumericAttrs {
  const out: NumericAttrs = {};

  out.length_mm = detectUnitMm(attrs['длина'] ?? attrs['длина изделия']);
  out.width_mm = detectUnitMm(attrs['ширина'] ?? attrs['ширина изделия']);
  out.height_mm = detectUnitMm(attrs['высота'] ?? attrs['высота опоры']);
  out.thickness_mm = detectUnitMm(attrs['толщина'] ?? attrs['толщина полки']);
  out.diameter_mm = detectUnitMm(
    attrs['диаметр'] ?? attrs['диаметр резьбы'] ?? attrs['диаметр головки'],
  );
  out.centerDistance_mm = detectUnitMm(attrs['межцентровое расстояние']);
  out.load_kg = pickNumber(attrs['нагрузка']);

  const threadAttr = attrs['резьба'] ?? attrs['диаметр резьбы'];
  const threadInName = /\bM(\d+(?:\.\d+)?)\b/i.exec(name);
  if (threadAttr) {
    const n = pickNumber(threadAttr);
    if (n !== undefined) out.threadM = n;
  } else if (threadInName && threadInName[1]) {
    out.threadM = parseFloat(threadInName[1]);
  }

  const dimRe = /(\d+(?:[.,]\d+)?)\s*[xх×]\s*(\d+(?:[.,]\d+)?)/i;
  const haystack = `${name} ${description ?? ''}`;
  const m = dimRe.exec(haystack);
  if (m && m[1] && m[2]) {
    if (out.threadM === undefined) {
      const aBefore = haystack.slice(0, m.index);
      const mAt = /\bM\s*$/i.test(aBefore);
      if (mAt) out.threadM = parseFloat(m[1].replace(',', '.'));
    }
    if (out.length_mm === undefined && out.threadM !== undefined) {
      out.length_mm = parseFloat(m[2].replace(',', '.'));
    }
  }

  for (const k of Object.keys(out) as (keyof NumericAttrs)[]) {
    if (out[k] === undefined || Number.isNaN(out[k])) delete out[k];
  }

  return out;
}

export function buildSearchText(opts: {
  name: string;
  vendor: Vendor;
  vendorCode: string;
  description: string | null;
  attrs: Record<string, string>;
}): string {
  const parts: string[] = [opts.name];
  if (opts.vendor.brand) parts.push(opts.vendor.brand);
  if (opts.vendor.country) parts.push(opts.vendor.country);
  if (opts.vendor.raw && opts.vendor.raw !== opts.vendor.brand) parts.push(opts.vendor.raw);
  parts.push(opts.vendorCode);
  parts.push(normalizeVendorCode(opts.vendorCode));
  if (opts.description) parts.push(opts.description);
  return parts.filter(Boolean).join(' \n ');
}

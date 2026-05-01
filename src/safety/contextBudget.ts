import type { HybridHit } from '../search/hybrid.js';

const APPROX_CHARS_PER_TOKEN = 3.6;

export function tokensApprox(text: string): number {
  return Math.ceil(text.length / APPROX_CHARS_PER_TOKEN);
}

export type ContextItem = {
  hit: HybridHit;
  asText: string;
  tokens: number;
};

export function formatProductForContext(hit: HybridHit, idx: number): string {
  const p = hit.product;
  const stocksList = Object.entries(p.stocks)
    .map(([city, s]) => `${city}: ${s.approx ? `${s.qty}+` : s.qty}`)
    .join('; ');
  const numAttrs = Object.entries(p.numericAttrs)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
  const lines = [
    `[${idx + 1}] offerId=${p.offerId} | vendorCode=${p.vendorCode} | unit=${p.unit ?? '-'}`,
    `name: ${p.name}`,
    `vendor: ${p.vendor.raw}${p.vendor.brand ? ` | brand=${p.vendor.brand}` : ''}${p.vendor.country ? ` | country=${p.vendor.country}` : ''}`,
    `price: ${p.prices.retail} RUR${p.prices.wholesale ? ` (опт ${p.prices.wholesale})` : ''}${p.prices.usd ? ` (~${p.prices.usd} у.е.)` : ''}`,
    `available: ${p.available ? 'есть' : 'нет'}${p.status ? ` | status=${p.status}` : ''}`,
    `stocks: ${stocksList}`,
  ];
  if (p.description) lines.push(`description: ${p.description}`);
  if (numAttrs) lines.push(`numeric: ${numAttrs}`);
  return lines.join('\n');
}

export function buildContext(
  hits: HybridHit[],
  maxTokens: number,
): { items: ContextItem[]; totalTokens: number; truncated: boolean } {
  const items: ContextItem[] = [];
  let total = 0;
  let truncated = false;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!hit) continue;
    const text = formatProductForContext(hit, i);
    const tk = tokensApprox(text);
    if (total + tk > maxTokens && items.length > 0) {
      truncated = true;
      break;
    }
    items.push({ hit, asText: text, tokens: tk });
    total += tk;
  }
  return { items, totalTokens: total, truncated };
}

import { pipeline } from '../api/pipeline.js';
import { config } from '../config.js';
import { logger } from '../observability/logger.js';
import { GOLDEN, type GoldenCase } from './golden.js';
import type { HybridHit } from '../search/hybrid.js';

export type RetrievalCaseStatus = 'pass' | 'fail' | 'skip';

export type RetrievalCaseResult = {
  id: string;
  query: string;
  status: RetrievalCaseStatus;
  reasons: string[];
  hits: Array<{ offerId: number; vendorCode: string; vendor: string; unit: string | null }>;
  topK: number;
  latencyMs: number;
};

function isApplicable(c: GoldenCase): boolean {
  return !!(
    c.mustBeTop1 ||
    c.mustAllMatch ||
    c.expects.anyOfOfferIds ||
    c.expects.anyOfVendorCodes
  );
}

function normalizeCode(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '');
}

function brandHaystack(p: HybridHit['product']): string {
  return `${p.vendor.brand ?? ''} ${p.vendor.raw}`.toLowerCase();
}

function checkCase(c: GoldenCase, hits: HybridHit[]): { reasons: string[]; topK: number } {
  const reasons: string[] = [];
  const topK = c.topK ?? config.TOP_K_FINAL;
  const trimmed = hits.slice(0, topK);

  if (c.mustBeTop1) {
    const top = trimmed[0];
    if (!top) {
      reasons.push('mustBeTop1: empty hits');
    } else {
      const m = c.mustBeTop1;
      if (m.anyOfOfferIds && !m.anyOfOfferIds.includes(top.product.offerId)) {
        reasons.push(
          `top-1 offerId=${top.product.offerId}, expected one of ${m.anyOfOfferIds.join(',')}`,
        );
      }
      if (m.anyOfVendorCodes) {
        const got = normalizeCode(top.product.vendorCode);
        const wanted = m.anyOfVendorCodes.map(normalizeCode);
        if (!wanted.some((w) => got.includes(w))) {
          reasons.push(
            `top-1 vendorCode="${top.product.vendorCode}", expected one of ${m.anyOfVendorCodes.join('|')}`,
          );
        }
      }
    }
  }

  if (c.mustAllMatch) {
    if (trimmed.length === 0) {
      reasons.push('mustAllMatch: empty hits');
    }
    const m = c.mustAllMatch;
    for (const h of trimmed) {
      const p = h.product;
      if (m.brand) {
        if (!brandHaystack(p).includes(m.brand.toLowerCase())) {
          reasons.push(`offer ${p.offerId} brand mismatch: "${p.vendor.raw}"`);
        }
      }
      if (m.cities && m.cities.length > 0) {
        const ok = m.cities.some((city) => {
          const s = p.stocks[city];
          return s && s.qty > 0;
        });
        if (!ok) {
          reasons.push(`offer ${p.offerId} no stock in ${m.cities.join('|')}`);
        }
      }
      if (m.unit) {
        if (p.unit !== m.unit) {
          reasons.push(`offer ${p.offerId} unit=${p.unit ?? 'null'}, expected ${m.unit}`);
        }
      }
    }
  }

  if (c.expects.anyOfOfferIds && !c.mustBeTop1) {
    const ids = trimmed.map((h) => h.product.offerId);
    if (!c.expects.anyOfOfferIds.some((id) => ids.includes(id))) {
      reasons.push(
        `expected one of offerIds ${c.expects.anyOfOfferIds.join(',')} in top-${topK}, got ${ids.join(',') || '<empty>'}`,
      );
    }
  }

  if (c.expects.anyOfVendorCodes && !c.mustBeTop1) {
    const got = trimmed.map((h) => normalizeCode(h.product.vendorCode));
    const wanted = c.expects.anyOfVendorCodes.map(normalizeCode);
    if (!wanted.some((w) => got.some((g) => g.includes(w)))) {
      reasons.push(
        `expected one of vendorCodes ${c.expects.anyOfVendorCodes.join('|')} in top-${topK}`,
      );
    }
  }

  return { reasons, topK };
}

export async function runRetrievalEval(
  opts: { only?: string[] } = {},
): Promise<RetrievalCaseResult[]> {
  await pipeline.init();
  const cases = opts.only ? GOLDEN.filter((c) => opts.only!.includes(c.id)) : GOLDEN;
  const out: RetrievalCaseResult[] = [];
  for (const c of cases) {
    if (!isApplicable(c)) {
      out.push({
        id: c.id,
        query: c.query,
        status: 'skip',
        reasons: ['no retrieval expectations'],
        hits: [],
        topK: c.topK ?? config.TOP_K_FINAL,
        latencyMs: 0,
      });
      continue;
    }
    const t0 = Date.now();
    logger.info({ id: c.id, query: c.query }, 'retrieval-eval case start');
    try {
      const r = await pipeline.retrieve(c.query);
      const { reasons, topK } = checkCase(c, r.hits);
      const trimmed = r.hits.slice(0, topK);
      const result: RetrievalCaseResult = {
        id: c.id,
        query: c.query,
        status: reasons.length === 0 ? 'pass' : 'fail',
        reasons,
        hits: trimmed.map((h) => ({
          offerId: h.product.offerId,
          vendorCode: h.product.vendorCode,
          vendor: h.product.vendor.raw,
          unit: h.product.unit,
        })),
        topK,
        latencyMs: Date.now() - t0,
      };
      out.push(result);
      logger.info(
        { id: c.id, status: result.status, reasons: result.reasons, latency_ms: result.latencyMs },
        'retrieval-eval case done',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({
        id: c.id,
        query: c.query,
        status: 'fail',
        reasons: [`error: ${message}`],
        hits: [],
        topK: c.topK ?? config.TOP_K_FINAL,
        latencyMs: Date.now() - t0,
      });
    }
  }
  return out;
}

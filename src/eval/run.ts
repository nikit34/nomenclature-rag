import { pipeline } from '../api/pipeline.js';
import { logger } from '../observability/logger.js';
import { GOLDEN, type GoldenCase } from './golden.js';
import type { AskResult } from '../api/pipeline.js';

export type CaseResult = {
  id: string;
  passed: boolean;
  reasons: string[];
  result: AskResult;
};

function checkCase(c: GoldenCase, r: AskResult): CaseResult {
  const reasons: string[] = [];
  const e = c.expects;
  const offerIds = r.products.map((p) => p.offerId);
  const codes = r.products.map((p) => p.vendorCode);
  const brandsOrVendors = r.products.map((p) => p.vendor.brand ?? p.vendor.raw);
  const units = r.products.map((p) => p.unit);

  if (e.anyOfOfferIds && !e.anyOfOfferIds.some((id) => offerIds.includes(id))) {
    reasons.push(`expected one of offerIds ${e.anyOfOfferIds.join(',')}, got ${offerIds.join(',')}`);
  }
  if (e.anyOfVendorCodes) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const wanted = e.anyOfVendorCodes.map(norm);
    const got = codes.map(norm);
    if (!wanted.some((w) => got.some((g) => g.includes(w)))) {
      reasons.push(`expected one of vendorCodes ${e.anyOfVendorCodes.join('|')}, got ${codes.join('|')}`);
    }
  }
  if (e.allBrand) {
    const want = e.allBrand.toLowerCase();
    if (r.products.length === 0) {
      if (e.acceptsClarification && (r.clarifying_question || r.insufficient_data)) {
        // ok: ambiguous query - asking back is acceptable
      } else {
        reasons.push('empty products');
      }
    }
    for (const b of brandsOrVendors) if (!b.toLowerCase().includes(want)) reasons.push(`vendor mismatch: ${b}`);
  }
  if (e.allInCities && r.products.length > 0) {
    for (const p of r.products) {
      const ok = e.allInCities.some((c) => {
        const s = p.stocks.find((entry) => entry.city === c);
        return s && s.qty > 0;
      });
      if (!ok) reasons.push(`offer ${p.offerId} has no stock in ${e.allInCities.join('|')}`);
    }
  }
  if (e.allUnit && r.products.length > 0) {
    for (const u of units) {
      if (!u || !e.allUnit.includes(u)) reasons.push(`unit mismatch: ${u}`);
    }
  }
  if (e.expectsInsufficientData) {
    if (!(r.insufficient_data || r.products.length === 0)) {
      reasons.push('expected insufficient_data but got products');
    }
  }
  if (e.forbidSubstring) {
    const haystack = (r.summary + ' ' + r.products.map((p) => p.explanation).join(' ')).toLowerCase();
    if (haystack.includes(e.forbidSubstring.toLowerCase())) {
      reasons.push(`forbidden substring "${e.forbidSubstring}" present in answer`);
    }
  }
  return { id: c.id, passed: reasons.length === 0, reasons, result: r };
}

export async function runEval(opts: { only?: string[] } = {}): Promise<CaseResult[]> {
  await pipeline.init();
  const cases = opts.only ? GOLDEN.filter((c) => opts.only!.includes(c.id)) : GOLDEN;
  const out: CaseResult[] = [];
  for (const c of cases) {
    logger.info({ id: c.id, query: c.query }, 'eval case start');
    try {
      const r = await pipeline.ask(c.query);
      const cr = checkCase(c, r);
      out.push(cr);
      logger.info(
        { id: c.id, passed: cr.passed, reasons: cr.reasons, latency_ms: r.diagnostics.latency_ms, cost: r.diagnostics.cost_usd },
        'eval case done',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({
        id: c.id,
        passed: false,
        reasons: [`error: ${message}`],
        result: {
          requestId: '',
          summary: '',
          products: [],
          insufficient_data: true,
          refinement_options: { cities: [], brands: [], units: [], statuses: [] },
          filters_applied: {},
          filters_inferred: {},
          total_available: 0,
          diagnostics: {
            sanitized_query: '',
            injection_detected: false,
            truncated_query: false,
            cities_inferred: [],
            retrieved_count: 0,
            after_filter_count: 0,
            context_tokens: 0,
            context_truncated: false,
            hallucinated_offer_ids: [],
            insufficient_data_reason: 'llm_said_no',
            llm_usage: { inputTokens: 0, outputTokens: 0 },
            cost_usd: 0,
            latency_ms: 0,
            cached: false,
          },
        },
      });
    }
  }
  return out;
}

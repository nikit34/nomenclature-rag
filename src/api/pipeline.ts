import fs from 'node:fs';
import { logger } from '../observability/logger.js';
import type { Product } from '../ingestion/types.js';
import {
  ensureCacheDir,
  ingestExcelOnly,
  isCacheValid,
  loadProducts,
  saveProducts,
  writeHash,
} from '../ingestion/buildIndex.js';
import { buildBm25Index, type BM25Index } from '../search/bm25.js';
import { embedBatch, loadEmbeddings, saveEmbeddings } from '../search/embeddings.js';
import { config } from '../config.js';
import { hybridSearch, type HybridDeps, type HybridHit } from '../search/hybrid.js';
import { applyFilters, type Filters } from '../search/filters.js';
import { detectCities } from '../search/cityAliases.js';
import { topKDense } from '../search/vector.js';
import { embedOne } from '../search/embeddings.js';
import { sanitizeQuery } from '../safety/sanitizeQuery.js';
import { buildContext } from '../safety/contextBudget.js';
import { validateAnswer } from '../safety/validateAnswer.js';
import { generateAnswer, type LLMUsage } from '../llm/client.js';
import { buildUserMessage, formatRetrieved } from '../llm/prompt.js';
import { estimateCostUsd } from '../observability/cost.js';

export type AskResult = {
  summary: string;
  products: Array<{
    offerId: number;
    name: string;
    vendorCode: string;
    vendor: string;
    unit: string | null;
    price: number;
    currency: 'RUR';
    available: boolean;
    status?: 'Распродажа' | 'Новинка';
    stocks: Record<string, { qty: number; approx: boolean }>;
    explanation: string;
  }>;
  clarifying_question?: string;
  insufficient_data: boolean;
  diagnostics: {
    sanitized_query: string;
    injection_detected: boolean;
    truncated_query: boolean;
    cities_inferred: string[];
    retrieved_count: number;
    after_filter_count: number;
    context_tokens: number;
    context_truncated: boolean;
    hallucinated_offer_ids: number[];
    llm_usage: LLMUsage;
    cost_usd: number;
    latency_ms: number;
  };
};

export class Pipeline {
  private deps!: HybridDeps;
  private ready = false;
  private buildPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = (async () => {
      const t0 = Date.now();
      if (!isCacheValid()) {
        logger.warn('cache missing or stale - running ingestion before serving');
        await runIngestion();
      }
      const products = loadProducts();
      const productIndexById = new Map<number, number>();
      products.forEach((p, i) => productIndexById.set(p.offerId, i));
      const { vectors } = loadEmbeddings();
      if (vectors.length !== products.length) {
        logger.warn(
          { products: products.length, vectors: vectors.length },
          'product/embedding count mismatch',
        );
      }
      const bm25 = await buildBm25Index(products);
      this.deps = { products, productIndexById, bm25, embeddings: vectors };
      this.ready = true;
      logger.info(
        { products: products.length, vectors: vectors.length, ms: Date.now() - t0 },
        'pipeline ready',
      );
    })();
    return this.buildPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  async ask(rawQuery: string): Promise<AskResult> {
    if (!this.ready) throw new Error('pipeline not ready');
    const tStart = Date.now();
    const sanitized = sanitizeQuery(rawQuery);
    if (!sanitized.query) {
      throw new Error('empty query after sanitization');
    }

    const cities = detectCities(sanitized.query);
    const filters: Filters = {
      cities: cities.length ? cities : undefined,
      requireAvailable: false,
    };
    const ql = sanitized.query.toLowerCase();
    if (/\bновинк/u.test(ql)) filters.status = 'Новинка';
    else if (/\bраспродаж/u.test(ql) || /\bскидк/u.test(ql) || /\bакци/u.test(ql)) filters.status = 'Распродажа';
    if (/\bпар(а|ам|ой|ы|у)\b|парами/u.test(ql)) filters.unit = 'пар';

    const narrow = !!(filters.unit || filters.status);
    const hasFilters = !!(filters.cities || filters.status || filters.unit || filters.brand);
    const wide = hasFilters ? 3 : 1;

    let finalHits: HybridHit[];
    let retrievedCount: number;
    if (narrow) {
      finalHits = await this.narrowRetrieval(sanitized.query, filters);
      retrievedCount = finalHits.length;
      if (finalHits.length === 0) {
        const hits = await hybridSearch(this.deps, sanitized.query, {
          kBm25: config.TOP_K_BM25 * wide,
          kDense: config.TOP_K_DENSE * wide,
          kFinal: config.TOP_K_FINAL,
        });
        retrievedCount = hits.length;
        finalHits = hits.slice(0, config.TOP_K_FINAL);
      }
    } else {
      const hits = await hybridSearch(this.deps, sanitized.query, {
        kBm25: config.TOP_K_BM25 * wide,
        kDense: config.TOP_K_DENSE * wide,
        kFinal: config.TOP_K_FINAL * wide,
      });
      retrievedCount = hits.length;
      const filtered = applyFilters(hits, filters);
      finalHits = (filtered.length > 0 ? filtered : hits).slice(0, config.TOP_K_FINAL);
    }

    const ctx = buildContext(finalHits, config.MAX_CONTEXT_TOKENS);
    const retrievedBlock = formatRetrieved(ctx.items);
    const userMessage = buildUserMessage(retrievedBlock, sanitized.query, {
      injectionDetected: sanitized.injectionDetected,
      truncated: sanitized.truncated,
    });

    const { answer, usage } = await generateAnswer(userMessage);
    const validation = validateAnswer(answer, finalHits);

    const validProductMap = new Map<number, Product>();
    for (const p of validation.validProducts) validProductMap.set(p.offerId, p);

    const products: AskResult['products'] = [];
    for (const ap of answer.products) {
      const p = validProductMap.get(ap.offerId);
      if (!p) continue;
      products.push({
        offerId: p.offerId,
        name: p.name,
        vendorCode: p.vendorCode,
        vendor: p.vendor.raw,
        unit: p.unit,
        price: p.prices.retail,
        currency: 'RUR',
        available: p.available,
        status: p.status,
        stocks: p.stocks,
        explanation: ap.explanation,
      });
    }

    const result: AskResult = {
      summary: answer.summary,
      products,
      clarifying_question: answer.clarifying_question,
      insufficient_data: answer.insufficient_data || products.length === 0,
      diagnostics: {
        sanitized_query: sanitized.query,
        injection_detected: sanitized.injectionDetected,
        truncated_query: sanitized.truncated,
        cities_inferred: cities,
        retrieved_count: retrievedCount,
        after_filter_count: finalHits.length,
        context_tokens: ctx.totalTokens,
        context_truncated: ctx.truncated,
        hallucinated_offer_ids: validation.hallucinatedOfferIds,
        llm_usage: usage,
        cost_usd: estimateCostUsd(usage),
        latency_ms: Date.now() - tStart,
      },
    };
    return result;
  }

  private async narrowRetrieval(query: string, filters: Filters): Promise<HybridHit[]> {
    const indexes: number[] = [];
    for (let i = 0; i < this.deps.products.length; i++) {
      const p = this.deps.products[i];
      if (!p) continue;
      if (filters.unit && p.unit !== filters.unit) continue;
      if (filters.status && p.status !== filters.status) continue;
      if (filters.brand && (!p.vendor.brand || !p.vendor.brand.toLowerCase().includes(filters.brand.toLowerCase()))) continue;
      if (filters.cities && filters.cities.length > 0) {
        const ok = filters.cities.some((c) => {
          const s = p.stocks[c];
          return s && s.qty > 0;
        });
        if (!ok) continue;
      }
      indexes.push(i);
    }
    if (indexes.length === 0) return [];
    const qVec = await embedOne(query);
    const subset = indexes
      .map((i) => ({ i, v: this.deps.embeddings[i] }))
      .filter((x): x is { i: number; v: Float32Array } => !!x.v);
    const subsetVecs = subset.map((s) => s.v);
    const dense = topKDense(qVec, subsetVecs, Math.min(config.TOP_K_FINAL, subset.length));
    const out: HybridHit[] = [];
    dense.forEach((d, rank) => {
      const idx = subset[d.index]?.i;
      const product = idx !== undefined ? this.deps.products[idx] : undefined;
      if (!product) return;
      out.push({
        product,
        denseRank: rank + 1,
        rrfScore: 1 / (60 + rank + 1),
        signals: { dense: d.score },
      });
    });
    return out;
  }
}

async function runIngestion(): Promise<void> {
  ensureCacheDir();
  const { products, skipped } = ingestExcelOnly();
  logger.info({ count: products.length, skipped }, 'parse+normalize done');
  saveProducts(products);
  logger.info({ model: config.EMBEDDING_MODEL }, 'computing embeddings (slow)');
  const t = Date.now();
  const texts = products.map((p) => p.searchText);
  const vectors = await embedBatch(texts, 32, (done, total) => {
    if (done % 32 === 0 || done === total) {
      const pct = ((done / total) * 100).toFixed(1);
      console.log(`[embed] ${done}/${total} (${pct}%) elapsed=${((Date.now() - t) / 1000).toFixed(0)}s`);
    }
  });
  saveEmbeddings(vectors);
  writeHash();
}

export const pipeline = new Pipeline();


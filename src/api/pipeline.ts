import { randomUUID } from 'node:crypto';
import { logger } from '../observability/logger.js';
import type { NumericAttrs, Product, Stock, Warehouse } from '../ingestion/types.js';
import { WAREHOUSES } from '../ingestion/types.js';
import {
  ensureCacheDir,
  ingestExcelOnly,
  isCacheValid,
  loadProducts,
  saveProducts,
  writeHash,
} from '../ingestion/buildIndex.js';
import { buildBm25Index } from '../search/bm25.js';
import { embedBatch, loadEmbeddings, saveEmbeddings } from '../search/embeddings.js';
import { config } from '../config.js';
import { hybridSearch, type HybridDeps, type HybridHit } from '../search/hybrid.js';
import { buildVendorCodeIndex } from '../search/exactMatch.js';
import { buildBrandIndex, detectBrand } from '../search/brandIndex.js';
import { applyFilters, type Filters } from '../search/filters.js';
import { detectCities } from '../search/cityAliases.js';
import { topKDense } from '../search/vector.js';
import { embedOne } from '../search/embeddings.js';
import { sanitizeQuery, type SanitizedQuery } from '../safety/sanitizeQuery.js';
import { buildContext } from '../safety/contextBudget.js';
import { validateAnswer } from '../safety/validateAnswer.js';
import { generateAnswer, type LLMUsage } from '../llm/client.js';
import { buildUserMessage, formatRetrieved } from '../llm/prompt.js';
import { estimateCostUsd } from '../observability/cost.js';

export type AskFilters = {
  cities?: Warehouse[];
  brands?: string[];
  status?: 'Распродажа' | 'Новинка';
  units?: string[];
  requireAvailable?: boolean;
};

export type AskSort = 'relevance' | 'price_asc' | 'price_desc' | 'stock_desc';

export type AskOptions = {
  filters?: AskFilters;
  sort?: AskSort;
  debug?: boolean;
};

export type ApiStock = { city: Warehouse; qty: number; approx: boolean };

export type ApiProduct = {
  offerId: number;
  name: string;
  vendorCode: string;
  vendor: { raw: string; brand?: string; country?: string };
  unit: string | null;
  prices: { retail: number; wholesale?: number; usd?: number };
  currency: 'RUR';
  available: boolean;
  status?: 'Распродажа' | 'Новинка';
  totalStock: number;
  primaryCity: Warehouse | null;
  primaryStock: ApiStock | null;
  stocks: ApiStock[];
  attrs: Record<string, string>;
  numericAttrs: NumericAttrs;
  hitSales?: number;
  explanation: string;
};

export type FacetOption = { value: string; label: string; count: number };

export type RefinementOptions = {
  cities: FacetOption[];
  brands: FacetOption[];
  units: FacetOption[];
  statuses: FacetOption[];
};

export type AskDiagnostics = {
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

export type AskResult = {
  requestId: string;
  summary: string;
  products: ApiProduct[];
  clarifying_question?: string;
  insufficient_data: boolean;
  refinement_options: RefinementOptions;
  filters_applied: AskFilters;
  filters_inferred: AskFilters;
  total_available: number;
  diagnostics: AskDiagnostics;
};

export type RetrievalResult = {
  hits: HybridHit[];
  sanitized: SanitizedQuery;
  filtersInferred: AskFilters;
  filtersApplied: AskFilters;
  cities: Warehouse[];
  retrievedCount: number;
  totalAvailable: number;
};

const STATUS_VALUES = ['Распродажа', 'Новинка'] as const;

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
      const vendorCodeIndex = buildVendorCodeIndex(products);
      const brandIndex = buildBrandIndex(products);
      this.deps = {
        products,
        productIndexById,
        bm25,
        embeddings: vectors,
        vendorCodeIndex,
        brandIndex,
      };
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

  inferFilters(query: string): AskFilters {
    const ql = query.toLowerCase();
    const cities = detectCities(query);
    const brand = detectBrand(query, this.deps.brandIndex);
    const inferred: AskFilters = {
      cities: cities.length ? cities : undefined,
      brands: brand ? [brand] : undefined,
    };
    if (/\bновинк/u.test(ql)) inferred.status = 'Новинка';
    else if (/\bраспродаж/u.test(ql) || /\bскидк/u.test(ql) || /\bакци/u.test(ql)) {
      inferred.status = 'Распродажа';
    }
    if (/\bпар(а|ам|ой|ы|у)\b|парами/u.test(ql)) inferred.units = ['пар'];
    return inferred;
  }

  async retrieve(rawQuery: string, opts: AskOptions = {}): Promise<RetrievalResult> {
    if (!this.ready) throw new Error('pipeline not ready');
    const sanitized = sanitizeQuery(rawQuery);
    if (!sanitized.query) {
      throw new Error('empty query after sanitization');
    }

    const inferred = this.inferFilters(sanitized.query);
    const merged = mergeFilters(inferred, opts.filters);
    const applied: Filters = {
      cities: merged.cities,
      brands: merged.brands,
      status: merged.status,
      units: merged.units,
      requireAvailable: merged.requireAvailable ?? true,
    };

    const narrow = !!(applied.units?.length || applied.status);
    const hasFilters = !!(
      applied.cities?.length ||
      applied.brands?.length ||
      applied.status ||
      applied.units?.length
    );
    const wide = hasFilters ? 3 : 1;

    let finalHits: HybridHit[];
    let retrievedCount: number;
    if (narrow) {
      finalHits = await this.narrowRetrieval(sanitized.query, applied);
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
      const filtered = applyFilters(hits, applied);
      finalHits = (filtered.length > 0 ? filtered : hits).slice(0, config.TOP_K_FINAL);
    }

    const totalAvailable = applyFilters(finalHits, applied).length;

    return {
      hits: finalHits,
      sanitized,
      filtersInferred: inferred,
      filtersApplied: applied,
      cities: applied.cities ?? [],
      retrievedCount,
      totalAvailable,
    };
  }

  async ask(rawQuery: string, opts: AskOptions = {}): Promise<AskResult> {
    if (!this.ready) throw new Error('pipeline not ready');
    const tStart = Date.now();
    const requestId = randomUUID();
    const {
      hits: finalHits,
      sanitized,
      filtersInferred,
      filtersApplied,
      cities,
      retrievedCount,
      totalAvailable,
    } = await this.retrieve(rawQuery, opts);

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

    const primaryCity: Warehouse | null = filtersApplied.cities?.[0] ?? null;

    let products: ApiProduct[] = [];
    for (const ap of answer.products) {
      const p = validProductMap.get(ap.offerId);
      if (!p) continue;
      products.push(toApiProduct(p, ap.explanation, primaryCity));
    }

    products = sortProducts(products, opts.sort ?? 'relevance');

    const refinement = computeRefinementOptions(finalHits);

    const result: AskResult = {
      requestId,
      summary: answer.summary,
      products,
      clarifying_question: answer.clarifying_question,
      insufficient_data: answer.insufficient_data || products.length === 0,
      refinement_options: refinement,
      filters_applied: filtersApplied,
      filters_inferred: filtersInferred,
      total_available: totalAvailable,
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
      if (filters.units && filters.units.length > 0 && (!p.unit || !filters.units.includes(p.unit))) {
        continue;
      }
      if (filters.status && p.status !== filters.status) continue;
      if (filters.brands && filters.brands.length > 0) {
        if (!p.vendor.brand) continue;
        const productBrand = p.vendor.brand.toLowerCase();
        const brandOk = filters.brands.some((b) => productBrand.includes(b.toLowerCase()));
        if (!brandOk) continue;
      }
      if (filters.requireAvailable && !p.available) continue;
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

function mergeFilters(inferred: AskFilters, user: AskFilters | undefined): AskFilters {
  if (!user) return { ...inferred };
  const pickArray = <T>(userVal: T[] | undefined, inferredVal: T[] | undefined): T[] | undefined => {
    if (userVal === undefined) return inferredVal;
    return userVal.length > 0 ? userVal : undefined;
  };
  return {
    cities: pickArray(user.cities, inferred.cities),
    brands: pickArray(user.brands, inferred.brands),
    status: user.status ?? inferred.status,
    units: pickArray(user.units, inferred.units),
    requireAvailable: user.requireAvailable ?? inferred.requireAvailable,
  };
}

function toApiProduct(p: Product, explanation: string, primaryCity: Warehouse | null): ApiProduct {
  const stocksRaw = WAREHOUSES.map<ApiStock>((city) => {
    const s: Stock | undefined = p.stocks[city];
    return { city, qty: s?.qty ?? 0, approx: s?.approx ?? false };
  });
  const sorted = sortStocks(stocksRaw, primaryCity);
  const totalStock = stocksRaw.reduce((sum, s) => sum + s.qty, 0);
  const primaryStock = primaryCity ? (stocksRaw.find((s) => s.city === primaryCity) ?? null) : null;

  const prices: ApiProduct['prices'] = { retail: p.prices.retail };
  if (p.prices.wholesale !== undefined) prices.wholesale = p.prices.wholesale;
  if (p.prices.usd !== undefined) prices.usd = p.prices.usd;

  const out: ApiProduct = {
    offerId: p.offerId,
    name: p.name,
    vendorCode: p.vendorCode,
    vendor: {
      raw: p.vendor.raw,
      ...(p.vendor.brand !== undefined ? { brand: p.vendor.brand } : {}),
      ...(p.vendor.country !== undefined ? { country: p.vendor.country } : {}),
    },
    unit: p.unit,
    prices,
    currency: 'RUR',
    available: p.available,
    totalStock,
    primaryCity,
    primaryStock,
    stocks: sorted,
    attrs: p.attrs,
    numericAttrs: p.numericAttrs,
    explanation,
  };
  if (p.status !== undefined) out.status = p.status;
  if (p.hitSales !== undefined) out.hitSales = p.hitSales;
  return out;
}

function sortStocks(stocks: ApiStock[], primaryCity: Warehouse | null): ApiStock[] {
  return [...stocks].sort((a, b) => {
    if (primaryCity) {
      if (a.city === primaryCity && b.city !== primaryCity) return -1;
      if (b.city === primaryCity && a.city !== primaryCity) return 1;
    }
    if (a.qty > 0 && b.qty === 0) return -1;
    if (b.qty > 0 && a.qty === 0) return 1;
    return b.qty - a.qty;
  });
}

function sortProducts(products: ApiProduct[], sort: AskSort): ApiProduct[] {
  if (sort === 'relevance') return products;
  const arr = [...products];
  if (sort === 'price_asc') arr.sort((a, b) => a.prices.retail - b.prices.retail);
  else if (sort === 'price_desc') arr.sort((a, b) => b.prices.retail - a.prices.retail);
  else if (sort === 'stock_desc') arr.sort((a, b) => b.totalStock - a.totalStock);
  return arr;
}

function computeRefinementOptions(hits: HybridHit[]): RefinementOptions {
  const cityCounts = new Map<Warehouse, number>();
  const brandCounts = new Map<string, number>();
  const unitCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();

  for (const h of hits) {
    const p = h.product;
    for (const city of WAREHOUSES) {
      const s = p.stocks[city];
      if (s && s.qty > 0) cityCounts.set(city, (cityCounts.get(city) ?? 0) + 1);
    }
    if (p.vendor.brand) {
      brandCounts.set(p.vendor.brand, (brandCounts.get(p.vendor.brand) ?? 0) + 1);
    }
    if (p.unit) unitCounts.set(p.unit, (unitCounts.get(p.unit) ?? 0) + 1);
    if (p.status) statusCounts.set(p.status, (statusCounts.get(p.status) ?? 0) + 1);
  }

  const facet = (entries: Iterable<[string, number]>): FacetOption[] =>
    Array.from(entries)
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));

  return {
    cities: facet(cityCounts as Map<string, number>),
    brands: facet(brandCounts),
    units: facet(unitCounts),
    statuses: facet(statusCounts).filter((s) => (STATUS_VALUES as readonly string[]).includes(s.value)),
  };
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

export const __testing = { mergeFilters, sortProducts, computeRefinementOptions, toApiProduct };

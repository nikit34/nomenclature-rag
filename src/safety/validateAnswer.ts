import type { Product } from '../ingestion/types.js';
import type { RawAnswer } from '../llm/schema.js';
import type { HybridHit } from '../search/hybrid.js';

export type ValidationResult = {
  ok: boolean;
  hallucinatedOfferIds: number[];
  validProducts: Product[];
};

export function validateAnswer(answer: RawAnswer, hits: HybridHit[]): ValidationResult {
  const allowed = new Map<number, Product>();
  for (const h of hits) allowed.set(h.product.offerId, h.product);
  const hallucinated: number[] = [];
  const valid: Product[] = [];
  for (const p of answer.products) {
    const found = allowed.get(p.offerId);
    if (!found) hallucinated.push(p.offerId);
    else valid.push(found);
  }
  return {
    ok: hallucinated.length === 0,
    hallucinatedOfferIds: hallucinated,
    validProducts: valid,
  };
}

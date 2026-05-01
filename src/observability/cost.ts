import type { LLMUsage } from '../llm/client.js';

const HAIKU_PRICE_PER_MTOK = {
  input: 1.0,
  output: 5.0,
  cacheWrite: 1.25,
  cacheRead: 0.1,
};

export function estimateCostUsd(usage: LLMUsage): number {
  const baseInput = usage.inputTokens
    - (usage.cacheReadInputTokens ?? 0)
    - (usage.cacheCreationInputTokens ?? 0);
  const inputCost = (Math.max(0, baseInput) * HAIKU_PRICE_PER_MTOK.input) / 1_000_000;
  const cacheCreate = ((usage.cacheCreationInputTokens ?? 0) * HAIKU_PRICE_PER_MTOK.cacheWrite) / 1_000_000;
  const cacheRead = ((usage.cacheReadInputTokens ?? 0) * HAIKU_PRICE_PER_MTOK.cacheRead) / 1_000_000;
  const output = (usage.outputTokens * HAIKU_PRICE_PER_MTOK.output) / 1_000_000;
  return inputCost + cacheCreate + cacheRead + output;
}

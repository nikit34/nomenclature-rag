import { runEval } from '../src/eval/run.js';
import { logger } from '../src/observability/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const only = args.length ? args : undefined;
  const t0 = Date.now();
  const results = await runEval({ only });
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const totalCost = results.reduce((s, r) => s + r.result.diagnostics.cost_usd, 0);
  const totalLatency = results.reduce((s, r) => s + r.result.diagnostics.latency_ms, 0);
  const hallucinatedAny = results.filter((r) => r.result.diagnostics.hallucinated_offer_ids.length > 0).length;

  console.log('\n=== EVAL RESULTS ===');
  for (const r of results) {
    const mark = r.passed ? '✅' : '❌';
    console.log(`${mark}  ${r.id}`);
    if (!r.passed) for (const reason of r.reasons) console.log(`    - ${reason}`);
  }
  console.log(`\nPass rate: ${passed}/${total}`);
  console.log(`Hallucinated cases: ${hallucinatedAny}/${total}`);
  console.log(`Total LLM cost: $${totalCost.toFixed(4)}`);
  console.log(`Avg latency: ${(totalLatency / total).toFixed(0)}ms`);
  console.log(`Wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(passed === total ? 0 : 1);
}

main().catch((err) => {
  logger.error({ err }, 'eval failed');
  process.exit(1);
});

import { runRetrievalEval } from '../src/eval/retrieval.js';
import { logger } from '../src/observability/logger.js';

async function main() {
  const args = process.argv.slice(2);
  const only = args.length ? args : undefined;
  const t0 = Date.now();
  const results = await runRetrievalEval({ only });
  const total = results.length;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  const evaluated = total - skipped;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);

  console.log('\n=== RETRIEVAL EVAL RESULTS ===');
  for (const r of results) {
    const mark = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️ ';
    console.log(`${mark}  ${r.id}  — ${r.query}`);
    if (r.status === 'fail') {
      for (const reason of r.reasons) console.log(`    - ${reason}`);
      const ids = r.hits.map((h) => h.offerId).join(',');
      console.log(`    top-${r.topK}: [${ids}]`);
    }
  }
  console.log(`\nPass: ${passed}/${evaluated}  (skipped: ${skipped})`);
  console.log(`Avg latency: ${evaluated ? (totalLatency / evaluated).toFixed(0) : 0}ms`);
  console.log(`Wall clock: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  logger.error({ err }, 'retrieval eval failed');
  process.exit(1);
});

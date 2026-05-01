import { config } from '../src/config.js';
import { logger } from '../src/observability/logger.js';
import {
  ensureCacheDir,
  ingestExcelOnly,
  isCacheValid,
  saveProducts,
  writeHash,
} from '../src/ingestion/buildIndex.js';
import { embedBatch, saveEmbeddings } from '../src/search/embeddings.js';

async function main() {
  const force = process.argv.includes('--force');
  if (!force && isCacheValid()) {
    logger.info('cache is valid, skipping ingest. Use --force to rebuild.');
    return;
  }
  ensureCacheDir();

  const t0 = Date.now();
  const { products, skipped } = ingestExcelOnly();
  logger.info({ count: products.length, skipped, ms: Date.now() - t0 }, 'parse+normalize done');

  saveProducts(products);
  logger.info({ path: config.PRODUCTS_PATH }, 'wrote products.json');

  logger.info({ model: config.EMBEDDING_MODEL }, 'starting embeddings (this may take several minutes)');
  const t1 = Date.now();
  const texts = products.map((p) => p.searchText);
  const vectors = await embedBatch(texts, 32, (done, total) => {
    if (done % 32 === 0 || done === total) {
      const pct = ((done / total) * 100).toFixed(1);
      const elapsed = ((Date.now() - t1) / 1000).toFixed(0);
      const eta = done > 0 ? Math.round(((Date.now() - t1) / done) * (total - done) / 1000) : 0;
      console.log(`[embed] ${done}/${total} (${pct}%) elapsed=${elapsed}s eta=${eta}s`);
    }
  });
  logger.info(
    { dim: vectors[0]?.length ?? 0, count: vectors.length, ms: Date.now() - t1 },
    'embeddings done',
  );
  saveEmbeddings(vectors);
  writeHash();
  logger.info('ingest complete');
}

main().catch((err) => {
  logger.error({ err }, 'ingest failed');
  process.exit(1);
});

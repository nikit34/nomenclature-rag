import { loadProducts } from '../src/ingestion/buildIndex.js';
import { buildBm25Index } from '../src/search/bm25.js';
import { loadEmbeddings, embedOne } from '../src/search/embeddings.js';
import { hybridSearch } from '../src/search/hybrid.js';
import { detectCities } from '../src/search/cityAliases.js';
import { buildVendorCodeIndex } from '../src/search/exactMatch.js';
import { buildBrandIndex } from '../src/search/brandIndex.js';

const QUERIES = [
  'ZZ150 M4 X45 IB',
  '7033 50',
  'винты M4 длиной около 45 мм оцинкованные',
  'KAIMAN в хроме',
  'держатель деревянной полки матовый никель',
  'товары Italiana Ferramenta',
  'менсолодержатели для стеклянных полок до 30 мм',
  'наличие в Санкт-Петербурге',
];

async function main() {
  const products = loadProducts();
  const { vectors } = loadEmbeddings();
  console.log(`loaded products=${products.length} vectors=${vectors.length} dim=${vectors[0]?.length}`);
  const productIndexById = new Map<number, number>();
  products.forEach((p, i) => productIndexById.set(p.offerId, i));
  const bm25 = await buildBm25Index(products);
  const vendorCodeIndex = buildVendorCodeIndex(products);
  const brandIndex = buildBrandIndex(products);
  const deps = { products, productIndexById, bm25, embeddings: vectors, vendorCodeIndex, brandIndex };

  for (const q of QUERIES) {
    const t = Date.now();
    const hits = await hybridSearch(deps, q, { kBm25: 30, kDense: 30, kFinal: 5 });
    const cities = detectCities(q);
    console.log(`\n>>> ${q}    [${Date.now() - t}ms, cities=${cities.join('|') || '-'}]`);
    for (const h of hits) {
      const p = h.product;
      const stocks = Object.entries(p.stocks)
        .filter(([, s]) => s.qty > 0)
        .map(([c, s]) => `${c.split(',')[0]}=${s.approx ? `${s.qty}+` : s.qty}`)
        .join(' ');
      const tag = h.signals.exactCode ? `pin:${h.signals.exactCode}` : `${h.bm25Rank ?? '-'}|${h.denseRank ?? '-'}`;
      console.log(
        `  [${tag}] ${p.offerId} ${p.vendorCode}  ${p.name.slice(0, 70)}  | unit=${p.unit} | ${stocks}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

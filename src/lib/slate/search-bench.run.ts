// Runs Slate's retrieval benchmark on an in-process Postgres (PGlite) with synthetic data.
// Usage: npm run bench:search            (text search only, no network)
//        SLATE_BENCH_SEMANTIC=1 npm run bench:search   (also OpenAI embeddings; needs OPENAI_API_KEY)
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../../db/schema.ts';
import { formatReport, runBenchmark, seedBench } from './search-bench.ts';
import { createDbSlateStore } from './store-db.ts';

const client = new PGlite();
const db = drizzle(client, { schema });
const { pushSchema } = await import('drizzle-kit/api');
const log = console.log;
console.log = () => {};
await (await pushSchema(schema, db as never)).apply();
console.log = log;

const uid = 'bench-creator';
const seeded = await seedBench(db, uid);
const store = createDbSlateStore(db);
const lexical = await runBenchmark(store, uid, seeded, { method: 'text search' });
console.log(formatReport(lexical));

if (process.env.SLATE_BENCH_SEMANTIC === '1') {
  const { createSemanticIndex } = await import('./semantic.ts');
  const semantic = createSemanticIndex(db, { apiKey: process.env.OPENAI_API_KEY ?? '' });
  const hybrid = await runBenchmark(store, uid, seeded, { method: 'text + embeddings', extendCtx: (ctx) => ({ ...ctx, semantic }) });
  console.log(`\n${formatReport(hybrid)}`);
}
await client.close();

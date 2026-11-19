import type { PgDatabase } from 'drizzle-orm/pg-core';
import { channels, contentItems, ideas } from '../../db/schema.ts';
import { BENCH_IDEAS, BENCH_POSTS, SCENARIOS, type Scenario, type ScenarioKind } from './search-bench-data.ts';
import { executeTool, TOOL_LIMITS, type ToolContext } from './tools.ts';
import type { SlateStore } from './types.ts';

/**
 * Slate retrieval benchmark (M5.0). Seeds the synthetic workspace, runs every scenario
 * through the real search tools, and reports Recall@5, MRR and latency.
 */

type Db = PgDatabase<any, any>;

export interface Seeded {
  postIds: Map<string, number>;
  ideaIds: Map<string, number>;
  channelIds: Map<string, number>;
}

export async function seedBench(db: Db, uid: string): Promise<Seeded> {
  const channelIds = new Map<string, number>();
  for (const name of ['Main Studio', 'Coffee Shorts', 'Design Feed']) {
    const [c] = await db.insert(channels).values({ userUid: uid, name }).returning();
    channelIds.set(name, c.id);
  }
  const postIds = new Map<string, number>();
  for (const p of BENCH_POSTS) {
    const [row] = await db
      .insert(contentItems)
      .values({ userUid: uid, title: p.title, caption: p.caption, tags: p.tags, notes: p.notes ?? '', channelId: channelIds.get(p.channel)!, channelName: p.channel, status: p.status })
      .returning();
    postIds.set(p.key, row.id);
  }
  const ideaIds = new Map<string, number>();
  for (const i of BENCH_IDEAS) {
    const [row] = await db.insert(ideas).values({ userUid: uid, title: i.title, notes: i.notes, tags: i.tags }).returning();
    ideaIds.set(i.key, row.id);
  }
  return { postIds, ideaIds, channelIds };
}

export interface ScenarioResult {
  query: string;
  kind: ScenarioKind;
  expect: string[];
  got: string[];
  recall: number | null;
  reciprocalRank: number | null;
  falsePositive: boolean;
  ms: number;
}

export interface BenchReport {
  method: string;
  recallAt5: number;
  mrr: number;
  /** Irrelevant queries that still returned something. */
  falsePositives: number;
  irrelevant: number;
  medianMs: number;
  p95Ms: number;
  byKind: Record<string, { n: number; recallAt5: number; mrr: number }>;
  results: ScenarioResult[];
}

export async function runBenchmark(
  store: SlateStore,
  uid: string,
  seeded: Seeded,
  opts: { method: string; extendCtx?: (ctx: ToolContext) => ToolContext; scenarios?: Scenario[] }
): Promise<BenchReport> {
  const keyOf = new Map<string, string>([
    ...[...seeded.postIds].map(([k, v]) => [`post:${v}`, k] as [string, string]),
    ...[...seeded.ideaIds].map(([k, v]) => [`idea:${v}`, k] as [string, string]),
  ]);
  const results: ScenarioResult[] = [];
  for (const s of opts.scenarios ?? SCENARIOS) {
    const base: ToolContext = { uid, store, today: '2026-11-17', budget: { chars: TOOL_LIMITS.totalResultChars } };
    const ctx = opts.extendCtx ? opts.extendCtx(base) : base;
    const args: Record<string, unknown> = { query: s.query, limit: 5 };
    if (s.channel) args.channel_id = seeded.channelIds.get(s.channel);
    if (s.stage) args.stage = s.stage;
    const t = performance.now();
    const out = await executeTool(s.target === 'posts' ? 'search_posts' : 'search_ideas', args, ctx);
    const ms = performance.now() - t;
    const data = JSON.parse(out.output) as { results?: { ref: string }[] };
    const got = (data.results ?? []).slice(0, 5).map((r) => keyOf.get(r.ref) ?? r.ref);
    if (!s.expect.length) {
      results.push({ query: s.query, kind: s.kind, expect: [], got, recall: null, reciprocalRank: null, falsePositive: got.length > 0, ms });
      continue;
    }
    const hit = s.expect.filter((k) => got.includes(k)).length;
    const first = got.findIndex((k) => s.expect.includes(k));
    results.push({ query: s.query, kind: s.kind, expect: s.expect, got, recall: hit / s.expect.length, reciprocalRank: first === -1 ? 0 : 1 / (first + 1), falsePositive: false, ms });
  }
  const scored = results.filter((r) => r.recall !== null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const byKind: BenchReport['byKind'] = {};
  for (const r of scored) {
    const k = (byKind[r.kind] ??= { n: 0, recallAt5: 0, mrr: 0 });
    k.n += 1;
    k.recallAt5 += r.recall!;
    k.mrr += r.reciprocalRank!;
  }
  for (const k of Object.values(byKind)) {
    k.recallAt5 /= k.n;
    k.mrr /= k.n;
  }
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  return {
    method: opts.method,
    recallAt5: avg(scored.map((r) => r.recall!)),
    mrr: avg(scored.map((r) => r.reciprocalRank!)),
    falsePositives: results.filter((r) => r.falsePositive).length,
    irrelevant: results.filter((r) => r.recall === null).length,
    medianMs: times[Math.floor(times.length / 2)],
    p95Ms: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    byKind,
    results,
  };
}

export function formatReport(r: BenchReport): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines = [
    `${r.method}: Recall@5 ${pct(r.recallAt5)} · MRR ${r.mrr.toFixed(3)} · false positives ${r.falsePositives}/${r.irrelevant} · median ${r.medianMs.toFixed(1)}ms · p95 ${r.p95Ms.toFixed(1)}ms`,
    ...Object.entries(r.byKind).map(([k, v]) => `  ${k.padEnd(10)} n=${String(v.n).padStart(2)}  Recall@5 ${pct(v.recallAt5).padStart(6)}  MRR ${v.mrr.toFixed(3)}`),
    '  misses:',
    ...r.results.filter((x) => (x.recall !== null && x.recall < 1) || x.falsePositive).map((x) => `    [${x.kind}] "${x.query}" expected ${x.expect.join(',') || '(nothing)'} got ${x.got.join(',') || '(nothing)'}`),
  ];
  return lines.join('\n');
}

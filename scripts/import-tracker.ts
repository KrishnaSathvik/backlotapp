/**
 * Loads the 85 tracker topics in docs/redesign/tracker-import.json as Planned / Made / Posted posts.
 *
 *   node scripts/import-tracker.ts                 # dry run: prints what would be inserted
 *   node scripts/import-tracker.ts --apply         # writes them
 *   node scripts/import-tracker.ts --user=<uid>    # which account (otherwise the only account)
 *   node scripts/import-tracker.ts --email=<email>
 *
 * Titles that already exist for that account are skipped. Connection: same as db:migrate.
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import * as dotenv from 'dotenv';
import { resolveDbConfig } from '../src/db/connection-config.ts';

dotenv.config({ path: '.env.local' });
dotenv.config();

const apply = process.argv.includes('--apply');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

type Row = { title: string; platform: string; status: string; notes: string };
const file = JSON.parse(readFileSync(new URL('../docs/redesign/tracker-import.json', import.meta.url), 'utf8')) as { items: Row[] };
const items = file.items ?? [];

const PLATFORMS = new Set(['youtube_long', 'youtube_shorts', 'instagram_reel', 'tiktok', 'instagram_carousel', 'other']);
const STATUSES = new Set(['idea', 'ready', 'posted']);
for (const item of items) {
  if (!item.title?.trim()) throw new Error('A tracker row has no title.');
  if (!PLATFORMS.has(item.platform)) throw new Error(`Unknown platform on “${item.title}”: ${item.platform}`);
  if (!STATUSES.has(item.status)) throw new Error(`Unknown stage on “${item.title}”: ${item.status}`);
}

const cfg = resolveDbConfig(process.env, 'migration');
if (cfg.source === 'none') {
  console.error('No database configured. Set DATABASE_MIGRATION_URL (or DATABASE_URL).');
  process.exit(2);
}

const client = new Client(cfg.pool);
await client.connect();
try {
  let uid = arg('user') ?? '';
  const email = arg('email');
  if (!uid && email) {
    const found = await client.query(`select id from auth.users where lower(email) = lower($1) limit 2`, [email]);
    if (found.rows.length !== 1) {
      console.error(found.rows.length ? 'More than one account uses that email.' : 'No account uses that email.');
      process.exit(2);
    }
    uid = found.rows[0].id;
  }
  if (!uid) {
    let rows: { id: string }[] = [];
    try {
      const found = await client.query(`select id from auth.users order by created_at limit 2`);
      rows = found.rows;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/permission denied/i.test(message)) throw error;
      const found = await client.query(`select distinct user_uid as id from content_items limit 2`);
      rows = found.rows;
    }
    if (rows.length !== 1) {
      console.error(rows.length === 0
        ? 'No account found. Pass --user=<uid> or --email=<email>.'
        : 'More than one account has posts. Pass --user=<uid> or --email=<email>.');
      process.exit(2);
    }
    uid = rows[0].id;
    console.log('Using the only account this login can see.');
  }

  const existing = await client.query(`select lower(title) as title from content_items where user_uid = $1`, [uid]);
  const have = new Set(existing.rows.map((r: { title: string }) => r.title));
  const fresh = items.filter((item) => !have.has(item.title.trim().toLowerCase()));
  const counts = { idea: 0, ready: 0, posted: 0 };
  for (const item of fresh) counts[item.status as 'idea' | 'ready' | 'posted'] += 1;

  console.log(`${apply ? 'Inserting' : 'Dry run (add --apply to write)'} · ${fresh.length} new · ${items.length - fresh.length} already there`);
  console.log(`Planned ${counts.idea} · Made ${counts.ready} · Posted ${counts.posted}`);
  for (const item of fresh) console.log(`  ${item.status.padEnd(6)}  ${item.platform.padEnd(20)}  ${item.title}`);

  if (!apply || !fresh.length) {
    if (!apply) console.log('Nothing was written.');
    process.exit(0);
  }

  await client.query('begin');
  for (const item of fresh) {
    await client.query(
      `insert into content_items (user_uid, title, platform, channel_name, status, caption, tags, notes, live_link, post_date, target_date, slides, attached_references)
       values ($1, $2, $3, '', $4, '', '[]'::jsonb, $5, '', '', '', '[]'::jsonb, '[]'::jsonb)`,
      [uid, item.title.trim(), item.platform, item.status, item.notes ?? '']
    );
  }
  await client.query('commit');
  console.log(`Inserted ${fresh.length} post(s).`);
} catch (error) {
  await client.query('rollback').catch(() => undefined);
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await client.end();
}

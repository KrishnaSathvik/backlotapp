/**
 * Regenerates the SQL Editor scripts in ops/supabase/manual-setup from src/db/migrations.
 *
 *   node scripts/generate-manual-setup.ts
 *
 * Runs only locally, against an in-process database (PGlite). Never connects anywhere.
 * src/db/manual-setup.test.ts fails while the checked-in scripts are out of date.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import { generateManualSetup } from '../src/db/manual-setup.ts';

export const MANUAL_SETUP_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'ops', 'supabase', 'manual-setup');

const files = await generateManualSetup();
await fsp.mkdir(MANUAL_SETUP_DIR, { recursive: true });
for (const f of files) {
  await fsp.writeFile(path.join(MANUAL_SETUP_DIR, f.path), f.content, 'utf8');
  console.log(`wrote ops/supabase/manual-setup/${f.path}`);
}

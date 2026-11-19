// Copies existing local uploads (.uploads) into the private Cloud Storage bucket.
//
//   node scripts/migrate-uploads-to-gcs.ts                 # dry run: inventory only (default)
//   node scripts/migrate-uploads-to-gcs.ts --apply         # copy and verify
//
// Needs: SQL_* (database), GCS_BUCKET, optional GCS_PREFIX (default "uploads/"), UPLOAD_DIR
// (default ./.uploads), and Application Default Credentials with write access to the bucket.
//
// Safety:
// - Never deletes or modifies local files, and never overwrites an existing object
//   (ifGenerationMatch=0). Objects keep the same storage key, so no database rows change.
// - Each copy is verified by size and MD5 against the local file.
// - Reports database rows with no local file, and local files with no database row; it
//   doesn't touch either. Removing local originals is a separate, manual step after review.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Storage } from '@google-cloud/storage';

const apply = process.argv.includes('--apply');
const dir = process.env.UPLOAD_DIR ?? path.join(process.cwd(), '.uploads');
const bucketName = process.env.GCS_BUCKET;
const prefix = process.env.GCS_PREFIX ?? 'uploads/';
if (!bucketName) throw new Error('Set GCS_BUCKET.');

const pool = new pg.Pool({ host: process.env.SQL_HOST, user: process.env.SQL_USER, password: process.env.SQL_PASSWORD, database: process.env.SQL_DB_NAME });
const bucket = new Storage().bucket(bucketName);

const md5 = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject);
  });

const rows = (await pool.query<{ storage_key: string; size_bytes: string; user_uid: string; mime_type: string }>('select storage_key, size_bytes, user_uid, mime_type from uploaded_files')).rows;
const local = new Set((await fsp.readdir(dir).catch(() => [] as string[])).filter((f) => !f.startsWith('.')));
const report = { dbRows: rows.length, localFiles: local.size, copied: 0, alreadyInBucket: 0, verified: 0, mismatched: [] as string[], missingLocally: [] as string[], untrackedLocal: [] as string[] };

for (const r of rows) {
  const file = path.join(dir, path.basename(r.storage_key));
  if (!local.has(path.basename(r.storage_key))) {
    report.missingLocally.push(r.storage_key);
    continue;
  }
  local.delete(path.basename(r.storage_key));
  const stat = await fsp.stat(file);
  const localMd5 = await md5(file);
  const object = bucket.file(`${prefix}${r.storage_key}`);
  const [exists] = await object.exists();
  if (!exists) {
    if (!apply) continue;
    await bucket.upload(file, { destination: object.name, preconditionOpts: { ifGenerationMatch: 0 }, metadata: { contentType: r.mime_type, cacheControl: 'private, max-age=0' }, validation: 'md5' });
    report.copied += 1;
  } else {
    report.alreadyInBucket += 1;
  }
  const [meta] = await object.getMetadata();
  if (Number(meta.size) === stat.size && meta.md5Hash === localMd5) report.verified += 1;
  else report.mismatched.push(r.storage_key);
}
report.untrackedLocal = [...local];

console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', bucket: bucketName, prefix, ...report, missingLocally: report.missingLocally.length, untrackedLocal: report.untrackedLocal.length, mismatched: report.mismatched }, null, 1));
if (report.missingLocally.length) console.log('Rows with no local file (not touched):', report.missingLocally.slice(0, 50));
if (report.untrackedLocal.length) console.log('Local files with no database row (not copied, not deleted):', report.untrackedLocal.slice(0, 50));
await pool.end();

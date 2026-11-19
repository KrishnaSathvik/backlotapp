import path from 'node:path';
import { createGcsStore } from './gcs.ts';
import { createLocalStore } from './local.ts';
import { createR2Store, type R2Config } from './r2.ts';
import type { MediaStore } from './types.ts';

export type { MediaStore } from './types.ts';

/** Local development store location. */
export const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

type Env = Record<string, string | undefined>;

export type StorageConfig =
  | ({ backend: 'r2' } & R2Config)
  | { backend: 'gcs'; bucket: string; prefix: string }
  | { backend: 'local' }
  | { backend: 'misconfigured'; error: string };

const withSlash = (p: string) => (p && !p.endsWith('/') ? `${p}/` : p);

/**
 * The configured media store:
 * - STORAGE_BACKEND=r2: private Cloudflare R2 bucket (production on Vercel). Needs R2_ACCOUNT_ID,
 *   R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY; optional R2_ENDPOINT (EU jurisdiction)
 *   and R2_PREFIX (default "uploads/").
 * - STORAGE_BACKEND=gcs: the earlier private Cloud Storage store. Legacy, kept only so existing
 *   files can be read during a migration; not a production default any more.
 * - otherwise local files under .uploads (development only).
 * Production refuses the local store unless STORAGE_ALLOW_LOCAL=true, because a serverless
 * instance's disk is temporary and not shared.
 */
export function readStorageConfig(env: Env = process.env): StorageConfig {
  const backend = (env.STORAGE_BACKEND ?? '').toLowerCase();
  if (backend === 'r2') {
    const missing = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !env[k]?.trim());
    if (missing.length) return { backend: 'misconfigured', error: `STORAGE_BACKEND=r2 needs ${missing.join(', ')}.` };
    const endpoint = env.R2_ENDPOINT?.trim();
    if (endpoint && !/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/?$/.test(endpoint)) {
      return { backend: 'misconfigured', error: 'R2_ENDPOINT must be https://<account>[.eu].r2.cloudflarestorage.com.' };
    }
    return {
      backend: 'r2',
      accountId: env.R2_ACCOUNT_ID!.trim(),
      bucket: env.R2_BUCKET!.trim(),
      accessKeyId: env.R2_ACCESS_KEY_ID!.trim(),
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(),
      endpoint: endpoint?.replace(/\/$/, '') || undefined,
      prefix: withSlash(env.R2_PREFIX ?? 'uploads/'),
    };
  }
  if (backend === 'gcs') {
    const bucket = env.GCS_BUCKET?.trim();
    if (!bucket) return { backend: 'misconfigured', error: 'STORAGE_BACKEND=gcs needs GCS_BUCKET.' };
    return { backend: 'gcs', bucket, prefix: withSlash(env.GCS_PREFIX ?? 'uploads/') };
  }
  if (backend && backend !== 'local') return { backend: 'misconfigured', error: `Unknown STORAGE_BACKEND "${backend}".` };
  if (env.NODE_ENV === 'production' && env.STORAGE_ALLOW_LOCAL !== 'true') {
    return { backend: 'misconfigured', error: 'Production needs STORAGE_BACKEND=r2 (local disk on a serverless instance is not durable).' };
  }
  return { backend: 'local' };
}

declare global {
  var _backlotMediaStore: MediaStore | undefined;
}

export function getMediaStore(): MediaStore {
  if (globalThis._backlotMediaStore) return globalThis._backlotMediaStore;
  const config = readStorageConfig();
  if (config.backend === 'misconfigured') throw new Error(`Storage misconfigured: ${config.error}`);
  globalThis._backlotMediaStore =
    config.backend === 'r2'
      ? createR2Store(config)
      : config.backend === 'gcs'
        ? createGcsStore({ bucket: config.bucket, prefix: config.prefix })
        : createLocalStore(UPLOAD_ROOT);
  return globalThis._backlotMediaStore;
}

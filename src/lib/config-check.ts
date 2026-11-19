import { checkDbConfig } from '../db/connection-config.ts';
import { ledgerPrefixFromEnv } from './account/ledger.ts';
import { firebaseClientProjectId, firebaseProjectId, readFirebaseAdminCredential } from './firebase-admin-config.ts';
import { parseFirebasePublicConfig } from './firebase-public-config.ts';
import { internalAuthConfig, type InternalJob } from './internal-auth.ts';
import { checkPrimary, readProviderConfig } from './slate/providers.ts';
import { readSiteUrl } from './site.ts';
import { readStorageConfig } from './storage/index.ts';
import { readSessionKey } from './storage/session-ref.ts';

/**
 * Production configuration check (Launch L3). Run at server start (instrumentation.ts) and by
 * the readiness check (/api/health?ready=1).
 *
 * Errors make a production instance refuse to serve (on Vercel, every request to that
 * deployment fails and its logs show `config.refusing_to_start`), so check /api/health?ready=1
 * on the preview deployment before promoting it. Outside production everything is a warning.
 *
 * Results name the setting and the problem, never a value.
 */

type Env = Record<string, string | undefined>;

export interface ConfigReport {
  errors: string[];
  warnings: string[];
}

const JOBS: InternalJob[] = ['deletions', 'maintenance'];

export function checkProductionConfig(env: Env = process.env): ConfigReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const prod = env.NODE_ENV === 'production';
  const need = (ok: boolean, msg: string) => {
    if (!ok) (prod ? errors : warnings).push(msg);
  };
  const set = (k: string) => !!env[k]?.trim();

  // Database: DATABASE_URL (Supabase transaction pooler) or the SQL_* variables.
  const dbCheck = checkDbConfig(env);
  for (const e of dbCheck.errors) need(false, e);
  warnings.push(...dbCheck.warnings);

  // Media storage and resumable-upload session sealing.
  const storage = readStorageConfig(env);
  if (storage.backend === 'misconfigured') need(false, storage.error);
  if (storage.backend === 'gcs') warnings.push('STORAGE_BACKEND=gcs is the legacy Cloud Storage store; production uses r2.');
  if (storage.backend === 'r2') {
    const ledger = ledgerPrefixFromEnv(env);
    if (!env.R2_LEDGER_BUCKET?.trim() && (ledger.startsWith(storage.prefix) || storage.prefix.startsWith(ledger) || !storage.prefix)) {
      need(false, 'R2_LEDGER_PREFIX must be separate from R2_PREFIX (the media orphan sweep must never see the deletion ledger).');
    }
    if (env.STORAGE_SOFT_DELETE_DAYS?.trim() && env.STORAGE_SOFT_DELETE_DAYS.trim() !== '0') {
      warnings.push('STORAGE_SOFT_DELETE_DAYS is set for R2, which has no soft delete: creators would be told files stay recoverable when they do not.');
    }
  }
  if (storage.backend === 'r2' && env.STORAGE_DELIVERY === 'proxy') {
    warnings.push('STORAGE_DELIVERY=proxy streams every file through Vercel Functions (payload and duration limits apply to large videos).');
  }

  // Firebase Admin: account deletion revokes sessions and deletes the sign-in, which needs a
  // credential. Vercel has no Google Application Default Credentials.
  const fb = readFirebaseAdminCredential(env);
  if (fb.error) need(false, fb.error);
  else if (!fb.credential && env.VERCEL) need(false, 'Firebase Admin has no credential on Vercel (set FIREBASE_SERVICE_ACCOUNT_JSON); account deletion cannot remove sign-ins.');
  if (fb.credential?.projectId && fb.credential.projectId !== firebaseProjectId(env)) {
    need(false, 'The Firebase service account belongs to a different project than the app signs in with.');
  }
  const publicConfig = parseFirebasePublicConfig(env.NEXT_PUBLIC_FIREBASE_CONFIG);
  if (publicConfig.error) need(false, publicConfig.error);
  if (env.FIREBASE_PROJECT_ID?.trim() && env.FIREBASE_PROJECT_ID.trim() !== firebaseClientProjectId(env)) {
    need(false, 'FIREBASE_PROJECT_ID differs from the project the browser signs in to (NEXT_PUBLIC_FIREBASE_CONFIG or firebase-applet-config.json); every sign-in would be rejected.');
  }
  const sessionKey = readSessionKey(env);
  if (sessionKey.error) need(false, sessionKey.error);

  // Slate providers.
  const primary = checkPrimary(readProviderConfig(env), env.NODE_ENV);
  if (!primary.ok) need(false, primary.error);
  else if (primary.warning) warnings.push(primary.warning);

  // Scheduled jobs: without the deletion worker, account deletions never finish.
  for (const job of JOBS) {
    const cfg = internalAuthConfig(job, env);
    if (cfg.weakSecret) need(false, `The ${job} job secret must be at least 32 characters.`);
    need(!!cfg.oidc || !!cfg.secret, `No credentials for the ${job} job (set its secret, or INTERNAL_OIDC_AUDIENCE and its invoker).`);
  }
  if (set('INTERNAL_OIDC_AUDIENCE') && !/^https:\/\//.test(env.INTERNAL_OIDC_AUDIENCE!.trim())) {
    need(false, 'INTERNAL_OIDC_AUDIENCE must be the https:// URL the scheduler jobs call.');
  }
  const d = internalAuthConfig('deletions', env);
  const m = internalAuthConfig('maintenance', env);
  if (d.secret && m.secret && d.secret === m.secret) need(false, 'The deletions and maintenance jobs must not share a secret.');
  if (d.oidc && m.oidc && d.oidc.invoker === m.oidc.invoker) {
    warnings.push('The deletions and maintenance jobs use the same invoker service account; separate ones limit what each can trigger.');
  }

  need(set('PRIVACY_CONTACT_EMAIL'), 'PRIVACY_CONTACT_EMAIL is not set (shown on /privacy).');

  // Public site: canonical URLs, sitemap, social previews and JSON-LD need the real origin.
  const site = readSiteUrl(env);
  if (site.error) need(false, site.error);
  else if (!site.url) warnings.push('SITE_URL is not set: pages have no canonical URLs, the sitemap is empty and social previews have no image.');

  if (set('BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL')) warnings.push('BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL is set (rollout-only flag).');
  if (env.STORAGE_ALLOW_LOCAL === 'true' && prod) warnings.push('STORAGE_ALLOW_LOCAL=true: uploads may land on temporary disk.');

  return { errors, warnings };
}

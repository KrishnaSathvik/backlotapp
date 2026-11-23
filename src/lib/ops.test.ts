import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionConfig } from './config-check.ts';
import { authorizeInternal, internalAuthConfig, type OidcVerifier } from './internal-auth.ts';
import { errorKind, sanitizeFields } from './ops-log.ts';

/** L3: internal job auth, structured-log sanitizing and production config validation. */

const quiet = async <T>(fn: () => Promise<T>) => {
  const e = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = e;
  }
};

const req = (auth?: string) =>
  new Request('https://backlot.example/api/internal/x', { method: 'POST', headers: auth ? { authorization: auth } : {} });

const S1 = 'd'.repeat(40);
const S2 = 'm'.repeat(40);
const JWT = 'aaa.bbb.ccc';

const verifierFor = (payload: { email?: string; email_verified?: boolean } | 'throw'): OidcVerifier & { audiences: string[] } => {
  const audiences: string[] = [];
  return {
    audiences,
    async verify(_t, audience) {
      audiences.push(audience);
      if (payload === 'throw') throw new Error('bad signature');
      return payload;
    },
  };
};

test('OPS1. each job has its own credentials; neither secret opens the other job', async () => {
  const env = { DELETION_WORKER_SECRET: S1, MAINTENANCE_SECRET: S2 };
  assert.equal(await authorizeInternal(req(`Bearer ${S1}`), 'deletions', { env }), null);
  assert.equal(await authorizeInternal(req(`Bearer ${S2}`), 'maintenance', { env }), null);
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${S2}`), 'deletions', { env })))?.status, 401);
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${S1}`), 'maintenance', { env })))?.status, 401);
  assert.equal((await quiet(() => authorizeInternal(req(), 'deletions', { env })))?.status, 401);
  // Unconfigured job: disabled. Short secret: not accepted.
  assert.equal((await authorizeInternal(req(`Bearer ${S1}`), 'deletions', { env: {} }))?.status, 404);
  assert.equal((await authorizeInternal(req('Bearer short'), 'deletions', { env: { DELETION_WORKER_SECRET: 'short' } }))?.status, 404);
  // The legacy CLEANUP_SECRET only ever opens maintenance.
  assert.equal(await authorizeInternal(req(`Bearer ${S2}`), 'maintenance', { env: { CLEANUP_SECRET: S2 } }), null);
  assert.equal((await authorizeInternal(req(`Bearer ${S2}`), 'deletions', { env: { CLEANUP_SECRET: S2 } }))?.status, 404);
  // Vercel Cron sends Authorization: Bearer $CRON_SECRET: it opens the deletions job only.
  assert.equal(await authorizeInternal(req(`Bearer ${S1}`), 'deletions', { env: { CRON_SECRET: S1 } }), null);
  assert.equal((await authorizeInternal(req(`Bearer ${S1}`), 'maintenance', { env: { CRON_SECRET: S1 } }))?.status, 404);
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${S2}`), 'deletions', { env: { CRON_SECRET: S1 } })))?.status, 401);
});

test('OPS2. OIDC: only a verified token from the configured invoker, for the configured audience', async () => {
  const env = {
    INTERNAL_OIDC_AUDIENCE: 'https://backlot.example',
    DELETION_WORKER_INVOKER: 'deletion-scheduler@proj.iam.gserviceaccount.com',
    MAINTENANCE_INVOKER: 'maint-scheduler@proj.iam.gserviceaccount.com',
  };
  const ok = verifierFor({ email: 'Deletion-Scheduler@proj.iam.gserviceaccount.com', email_verified: true });
  assert.equal(await authorizeInternal(req(`Bearer ${JWT}`), 'deletions', { env, verifier: ok }), null);
  assert.deepEqual(ok.audiences, ['https://backlot.example']);
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${JWT}`), 'maintenance', { env, verifier: ok })))?.status, 401, 'wrong invoker for this job');
  const unverified = verifierFor({ email: 'deletion-scheduler@proj.iam.gserviceaccount.com', email_verified: false });
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${JWT}`), 'deletions', { env, verifier: unverified })))?.status, 401);
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${JWT}`), 'deletions', { env, verifier: verifierFor('throw') })))?.status, 401);
  // A bad OIDC token doesn't fall through to the secret.
  const both = { ...env, DELETION_WORKER_SECRET: S1 };
  assert.equal((await quiet(() => authorizeInternal(req(`Bearer ${JWT}`), 'deletions', { env: both, verifier: verifierFor('throw') })))?.status, 401);
  assert.equal(await authorizeInternal(req(`Bearer ${S1}`), 'deletions', { env: both, verifier: verifierFor('throw') }), null);
  assert.equal(internalAuthConfig('deletions', { DELETION_WORKER_INVOKER: 'x@y' }).oidc, null, 'needs an audience too');
});

test('OPS3. structured log fields drop secrets, URLs, emails and content, and keep counts', () => {
  const out = sanitizeFields({
    job: 3,
    step: 'delete_files',
    input_tokens: 120,
    status_token: 'abc',
    id_token: 'abc',
    api_key: 'sk-x',
    session_ref: 'https://storage.googleapis.com/upload?upload_id=x',
    upload_url: 'https://x',
    email: 'a@b.c',
    caption: 'my caption',
    prompt: 'p',
    detail: 'line1\nline2',
    huge: 'x'.repeat(500),
    nan: Number.NaN,
    skip: undefined,
  });
  assert.deepEqual(Object.keys(out).sort(), ['detail', 'huge', 'input_tokens', 'job', 'nan', 'step']);
  assert.equal(out.detail, 'line1 line2');
  assert.equal((out.huge as string).length, 200);
  assert.equal(out.nan, null);
  assert.equal(errorKind(Object.assign(new Error('secret message with token=abc'), { code: 'auth/internal-error' })), 'auth/internal-error');
  assert.equal(errorKind(new TypeError('details')), 'TypeError');
  const wrapped = Object.assign(new Error('Failed query: insert … params: secret'), { cause: Object.assign(new Error('account is being deleted'), { code: 'BKDEL' }) });
  assert.equal(errorKind(wrapped), 'BKDEL', 'looks through driver wrappers');
});

test('OPS4. production config check names every missing setting, without values', () => {
  const missing = checkProductionConfig({ NODE_ENV: 'production' });
  for (const k of ['DATABASE_URL', 'STORAGE_BACKEND=r2', 'OPENAI_API_KEY', 'CRON_SECRET']) {
    assert.ok(missing.errors.some((e) => e.includes(k)), `reports ${k}`);
  }
  // Vercel + Supabase (database and Auth) + R2.
  const auth = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://pdhymiqjlzaanarleucv.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_pk-value-456',
  };
  const good = {
    NODE_ENV: 'production',
    VERCEL: '1',
    DATABASE_URL: 'postgresql://postgres.ref:pw-value-123@aws-0-us-east-1.pooler.supabase.com:6543/postgres',
    DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\\nX\\n-----END CERTIFICATE-----',
    STORAGE_BACKEND: 'r2',
    R2_ACCOUNT_ID: 'acct',
    R2_BUCKET: 'backlot-media',
    R2_ACCESS_KEY_ID: 'ak',
    R2_SECRET_ACCESS_KEY: 'r2-secret-789',
    ...auth,
    OPENAI_API_KEY: 'sk-test-value',
    DELETION_WORKER_SECRET: S1,
    MAINTENANCE_SECRET: S2,
    PRIVACY_CONTACT_EMAIL: 'privacy@example.com',
  };
  assert.deepEqual(checkProductionConfig(good).errors, []);
  // Vercel Cron's CRON_SECRET is enough for the deletions job; maintenance has no schedule.
  const { DELETION_WORKER_SECRET: _d, MAINTENANCE_SECRET: _m, ...noJobs } = good;
  assert.deepEqual(checkProductionConfig({ ...noJobs, CRON_SECRET: S1 }).errors, []);
  assert.ok(checkProductionConfig({ ...noJobs, CRON_SECRET: 'short' }).errors.some((e) => e.includes('at least 32')));
  const report = JSON.stringify(checkProductionConfig({ ...good, MAINTENANCE_SECRET: S1 }));
  assert.ok(report.includes('must not share a secret'));
  for (const v of [S1, 'pw-value-123', 'sk-test-value', 'r2-secret-789', 'pk-value-456', 'sb_publishable_test']) assert.ok(!report.includes(v), 'no values in the report');
  // Account deletion needs the Supabase secret key, Supabase needs its CA, and the ledger must not sit inside the media prefix.
  const { SUPABASE_SECRET_KEY: _secret, ...noSecret } = good;
  assert.ok(checkProductionConfig(noSecret).errors.some((e) => e.includes('SUPABASE_SECRET_KEY')));
  assert.ok(checkProductionConfig({ ...good, DATABASE_CA_CERT: '' }).errors.some((e) => e.includes('DATABASE_CA_CERT')));
  assert.ok(checkProductionConfig({ ...good, R2_LEDGER_PREFIX: 'uploads/ledger/' }).errors.some((e) => e.includes('R2_LEDGER_PREFIX')));
  // Sign-in needs the project URL and publishable key; secrets never go in public variables.
  const { NEXT_PUBLIC_SUPABASE_URL: _url, ...noUrl } = good;
  assert.ok(checkProductionConfig(noUrl).errors.some((e) => e.includes('NEXT_PUBLIC_SUPABASE_URL')));
  assert.ok(checkProductionConfig({ ...good, NEXT_PUBLIC_SUPABASE_URL: 'https://evil.example' }).errors.some((e) => e.includes('NEXT_PUBLIC_SUPABASE_URL must be')));
  assert.ok(checkProductionConfig({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }).errors.some((e) => e.includes('holds a secret key')));
  const serviceRoleJwt = `h.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.s`;
  assert.ok(checkProductionConfig({ ...good, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: serviceRoleJwt }).errors.some((e) => e.includes('holds a secret key')));
  assert.ok(checkProductionConfig({ ...good, SUPABASE_SECRET_KEY: 'sb_publishable_x' }).errors.some((e) => e.includes('is a publishable key')));
  assert.ok(checkProductionConfig({ ...good, NEXT_PUBLIC_SUPABASE_SECRET_KEY: 'x' }).errors.some((e) => e.includes('NEXT_PUBLIC_ prefix')));
  // The legacy Cloud Run configuration (SQL_* + GCS with ADC) still validates, with a warning.
  const legacy = {
    NODE_ENV: 'production',
    SQL_HOST: '/cloudsql/p:r:i',
    SQL_USER: 'app',
    SQL_PASSWORD: 'pw-value-123',
    SQL_DB_NAME: 'backlot',
    ...auth,
    STORAGE_BACKEND: 'gcs',
    GCS_BUCKET: 'backlot-media',
    UPLOAD_SESSION_KEY: Buffer.alloc(32, 7).toString('base64'),
    OPENAI_API_KEY: 'sk-test-value',
    DELETION_WORKER_SECRET: S1,
    MAINTENANCE_SECRET: S2,
    PRIVACY_CONTACT_EMAIL: 'privacy@example.com',
  };
  const legacyReport = checkProductionConfig(legacy);
  assert.deepEqual(legacyReport.errors, []);
  assert.ok(legacyReport.warnings.some((w) => w.includes('legacy')));
  // Outside production nothing is fatal.
  assert.deepEqual(checkProductionConfig({ NODE_ENV: 'development' }).errors, []);
});

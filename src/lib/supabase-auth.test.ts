import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { identityFromClaims } from './supabase/identity-claims.ts';
import { safeNextPath } from './supabase/redirect.ts';
import { supabaseIdentityProvider } from './account/supabase-identity.ts';
import { peekGoogleIdToken } from './google-identity.ts';
import { checkSupabaseAuthConfig } from './supabase/config.ts';

const UID = '3f1c2a4e-9b7d-4c1e-8a2f-5d6e7f8a9b0c';
const base = { sub: UID, role: 'authenticated', email: 'a@example.com', aud: 'authenticated' };

test('AUTH1. verified claims map to Backlot identity; the uid is the token subject', () => {
  assert.deepEqual(identityFromClaims({ ...base, amr: [{ method: 'oauth', timestamp: 1_800_000_000 }] }), {
    uid: UID,
    email: 'a@example.com',
    authTime: 1_800_000_000,
  });
  // Upper-case UUIDs normalize, so one person never gets two uids.
  assert.equal(identityFromClaims({ ...base, sub: UID.toUpperCase() })?.uid, UID);
  // Missing email is allowed (stored as empty), never invented.
  assert.equal(identityFromClaims({ ...base, email: undefined })?.email, '');
});

test('AUTH2. only real signed-in users are accepted', () => {
  assert.equal(identityFromClaims(null), null);
  assert.equal(identityFromClaims('token'), null);
  assert.equal(identityFromClaims({ ...base, role: 'anon' }), null, 'publishable/anon key JWT');
  assert.equal(identityFromClaims({ ...base, role: 'service_role' }), null, 'service role JWT');
  assert.equal(identityFromClaims({ ...base, is_anonymous: true }), null, 'anonymous sign-in');
  assert.equal(identityFromClaims({ ...base, sub: undefined }), null);
  assert.equal(identityFromClaims({ ...base, sub: 'firebase-uid-123' }), null, 'not a Supabase user id');
});

test('AUTH3. authTime is the last real sign-in (amr), 0 when unknown (forces re-sign-in for deletion)', () => {
  const amr = [
    { method: 'oauth', timestamp: 1_800_000_000 },
    { method: 'oauth', timestamp: 1_800_000_900 },
  ];
  assert.equal(identityFromClaims({ ...base, amr })?.authTime, 1_800_000_900);
  assert.equal(identityFromClaims({ ...base })?.authTime, 0);
  assert.equal(identityFromClaims({ ...base, amr: 'oauth' })?.authTime, 0);
  assert.equal(identityFromClaims({ ...base, amr: [{ method: 'oauth', timestamp: 'x' }] })?.authTime, 0);
  // iat (token refresh time) must not count as a sign-in.
  assert.equal(identityFromClaims({ ...base, iat: 1_900_000_000, amr: [{ method: 'oauth', timestamp: 1 }] })?.authTime, 1);
});

test('AUTH4. the OAuth callback only redirects to paths on this site', () => {
  assert.equal(safeNextPath('/app?tab=ideas'), '/app?tab=ideas');
  assert.equal(safeNextPath('/app'), '/app');
  for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '\\\\evil', 'app', '/%0d%0aSet-Cookie:x', '/a\nb', 'javascript:alert(1)']) {
    const out = safeNextPath(bad);
    assert.ok(out.startsWith('/') && !out.startsWith('//'), `${JSON.stringify(bad)} -> ${out}`);
    assert.ok(!out.includes('evil.example') || out.startsWith('/%'), `${JSON.stringify(bad)} stays on this site`);
  }
  assert.equal(safeNextPath('//evil.example'), '/app');
  assert.equal(safeNextPath('/\\evil.example'), '/app');
  assert.equal(safeNextPath('x'.repeat(600)), '/app');
});

/** A fake Supabase admin API recording calls. */
function fakeAdmin(users: Set<string>, fail?: { status?: number; code?: string; message: string }) {
  const calls: string[] = [];
  const result = (uid: string, data: unknown) => {
    // Supabase returns AuthApiError instances (Error subclasses with status and code).
    if (fail) return { data: null, error: Object.assign(new Error(fail.message), fail) };
    if (!users.has(uid)) return { data: { user: null }, error: Object.assign(new Error('User not found'), { status: 404, code: 'user_not_found' }) };
    return { data, error: null };
  };
  const client = {
    auth: {
      admin: {
        async updateUserById(uid: string, attrs: { ban_duration?: string }) {
          calls.push(`ban:${uid}:${attrs.ban_duration}`);
          return result(uid, { user: { id: uid } });
        },
        async deleteUser(uid: string, soft: boolean) {
          calls.push(`delete:${uid}:${soft}`);
          const r = result(uid, { user: { id: uid } });
          if (!r.error) users.delete(uid);
          return r;
        },
        async getUserById(uid: string) {
          calls.push(`get:${uid}`);
          return result(uid, { user: { id: uid } });
        },
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

test('AUTH5. account deletion: Supabase Auth revoke (ban), hard delete, existence check', async () => {
  const users = new Set([UID]);
  const { client, calls } = fakeAdmin(users);
  const identity = supabaseIdentityProvider(() => client);

  assert.equal(await identity.exists(UID), true);
  await identity.revokeSessions(UID);
  await identity.deleteUser(UID);
  assert.equal(await identity.exists(UID), false);
  assert.deepEqual(calls, [`get:${UID}`, `ban:${UID}:876000h`, `delete:${UID}:false`, `get:${UID}`]);

  // Idempotent: a user that's already gone isn't an error (resumed or repeated jobs).
  await identity.revokeSessions(UID);
  await identity.deleteUser(UID);
});

test('AUTH6. account deletion: real failures surface (the job retries), malformed uids never reach Supabase', async () => {
  const down = supabaseIdentityProvider(() => fakeAdmin(new Set([UID]), { status: 500, message: 'auth down' }).client);
  await assert.rejects(down.revokeSessions(UID), /auth down/);
  await assert.rejects(down.deleteUser(UID), /auth down/);
  await assert.rejects(down.exists(UID), /auth down/, 'never reports "gone" when it can’t tell');

  const { client, calls } = fakeAdmin(new Set());
  const identity = supabaseIdentityProvider(() => client);
  await identity.revokeSessions('legacy-firebase-uid');
  await identity.deleteUser('legacy-firebase-uid');
  assert.equal(await identity.exists('legacy-firebase-uid'), false);
  assert.deepEqual(calls, []);
});

test('AUTH7. re-sign-in with Google: the chosen account is read from the ID token (sub), garbage is rejected', () => {
  const payload = Buffer.from(JSON.stringify({ sub: '1234567890', email: 'a@example.com', aud: 'x' })).toString('base64url');
  assert.deepEqual(peekGoogleIdToken(`h.${payload}.s`), { sub: '1234567890', email: 'a@example.com' });
  assert.equal(peekGoogleIdToken('not-a-jwt'), null);
  assert.equal(peekGoogleIdToken(`h.${Buffer.from('{"email":"x"}').toString('base64url')}.s`), null, 'no sub');
});

test('AUTH8. config: Google client id optional (redirect fallback), but must look like one', () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://pdhymiqjlzaanarleucv.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x',
    SUPABASE_SECRET_KEY: 'sb_secret_x',
  };
  assert.ok(checkSupabaseAuthConfig(base).warnings.some((w) => w.includes('NEXT_PUBLIC_GOOGLE_CLIENT_ID')));
  assert.deepEqual(checkSupabaseAuthConfig({ ...base, NEXT_PUBLIC_GOOGLE_CLIENT_ID: '843-abc.apps.googleusercontent.com' }), { errors: [], warnings: [] });
  assert.ok(checkSupabaseAuthConfig({ ...base, NEXT_PUBLIC_GOOGLE_CLIENT_ID: 'GOCSPX-secret' }).errors.some((e) => e.includes('NEXT_PUBLIC_GOOGLE_CLIENT_ID')));
});

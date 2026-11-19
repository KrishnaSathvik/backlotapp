import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.ts';
import { uploadedFiles, uploadSessions } from '../../db/schema.ts';
import { partSizeFor } from './r2.ts';
import { readStorageConfig } from './index.ts';
import { cancelUpload, completeDirectUpload, signUploadParts, startDirectUpload, sweepBucketOrphans, uploadPolicyFromEnv, type UploadPolicy } from './uploads.ts';
import { StorageError, type MediaStore, type UploadedPart } from './types.ts';

/** Supabase/R2 migration I3: direct multipart uploads, on a fake R2 (no network) and real SQL (PGlite). */

const client = new PGlite();
const db = drizzle(client, { schema });
before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const log = console.log;
  console.log = () => {};
  try {
    await (await pushSchema(schema, db as never)).apply();
  } finally {
    console.log = log;
  }
});
after(() => client.close());

const PART = 1000; // the fake uses tiny parts

/** In-memory stand-in for R2's multipart API with the same rules the code relies on. */
function fakeR2() {
  const objects = new Map<string, { bytes: Uint8Array; at: Date }>();
  const uploads = new Map<string, { key: string; parts: Map<number, Uint8Array>; at: Date }>();
  const signed: string[] = [];
  const store: MediaStore & { objects: typeof objects; uploads: typeof uploads; signed: string[]; putPart(id: string, n: number, b: Uint8Array): void } = {
    kind: 'r2',
    objects,
    uploads,
    signed,
    putPart(id, n, b) {
      uploads.get(id)!.parts.set(n, b);
    },
    async beginUpload(key) {
      if (objects.has(key)) throw new StorageError('EXISTS', 'exists');
      const id = crypto.randomUUID();
      uploads.set(id, { key, parts: new Map(), at: new Date() });
      return id;
    },
    async writeChunk() {
      throw new StorageError('UNAVAILABLE', 'direct only');
    },
    async uploadedBytes(id) {
      return [...(uploads.get(id)?.parts.values() ?? [])].reduce((t, b) => t + b.length, 0);
    },
    async abortUpload(id) {
      uploads.delete(id);
    },
    async stat(key) {
      const o = objects.get(key);
      return o ? { size: o.bytes.length } : null;
    },
    async stream() {
      throw new Error('unused');
    },
    async readBuffer(key) {
      return Buffer.from(objects.get(key)!.bytes);
    },
    async delete(key) {
      objects.delete(key);
    },
    direct: {
      partSize: () => PART,
      async presignPart(key, id, n, len) {
        const url = `https://r2.test/${key}?uploadId=${id}&partNumber=${n}&len=${len}`;
        signed.push(url);
        return url;
      },
      async listParts(_key, id) {
        const u = uploads.get(id);
        if (!u) throw new StorageError('NOT_FOUND', 'gone');
        return [...u.parts.entries()].map(([partNumber, b]): UploadedPart => ({ partNumber, etag: `"${partNumber}"`, size: b.length }));
      },
      async completeUpload(_key, id, parts) {
        const u = uploads.get(id);
        if (!u) throw new StorageError('NOT_FOUND', 'gone');
        const bytes = Buffer.concat(parts.map((p) => u.parts.get(p.partNumber)!));
        objects.set(u.key, { bytes: new Uint8Array(bytes), at: new Date() });
        uploads.delete(id);
      },
      async readHead(key, n) {
        return objects.get(key)!.bytes.subarray(0, n);
      },
    },
    inventory: {
      async listObjects({ olderThan, limit }) {
        return [...objects.entries()].filter(([, o]) => o.at < olderThan).slice(0, limit).map(([key, o]) => ({ key, size: o.bytes.length, lastModified: o.at }));
      },
      async listMultipartUploads({ olderThan, limit }) {
        return [...uploads.entries()].filter(([, u]) => u.at < olderThan).slice(0, limit).map(([uploadId, u]) => ({ key: u.key, uploadId, initiated: u.at }));
      },
    },
  };
  return store;
}

const MP4_HEAD = [0, 0, 0, 24, ...Buffer.from('ftypisom')];
const file = (size: number, head = MP4_HEAD) => {
  const b = new Uint8Array(size);
  b.set(head);
  for (let i = head.length; i < size; i++) b[i] = i % 251;
  return b;
};
const policy: UploadPolicy = { quotaBytes: 100_000, maxActive: 2, sessionTtlMs: 60_000 };
const sendParts = (store: ReturnType<typeof fakeR2>, multipartId: string, bytes: Uint8Array, parts: number[]) => {
  for (const n of parts) store.putPart(multipartId, n, bytes.subarray((n - 1) * PART, n * PART));
};
const multipartOf = (store: ReturnType<typeof fakeR2>) => [...store.uploads.keys()].at(-1)!;

test('DU1. start → sign → resume → complete: R2’s part list is the truth, and only then is the file recorded', async () => {
  const store = fakeR2();
  const bytes = file(2500); // parts 1000, 1000, 500
  const input = { uploadId: 'direct-0001', fileName: 'clip.mp4', mimeType: 'video/mp4', totalSize: bytes.length };
  const start = await startDirectUpload(db, store, 'u-ann', input, policy);
  assert.deepEqual(start.body, { mode: 'direct', completed: false, partSize: PART, partCount: 3, uploadedParts: [] });

  const signed = await signUploadParts(db, store, 'u-ann', 'direct-0001', [1, 2, 3]);
  assert.equal(signed.status, 200);
  assert.deepEqual((signed.body as { parts: { size: number }[] }).parts.map((p) => p.size), [1000, 1000, 500], 'each URL is signed for its exact length');
  assert.equal((await signUploadParts(db, store, 'u-ann', 'direct-0001', [4])).status, 400, 'no part beyond the file');
  assert.equal((await signUploadParts(db, store, 'u-bob', 'direct-0001', [1])).status, 404, 'another account can’t sign parts of this upload');

  const mp = multipartOf(store);
  sendParts(store, mp, bytes, [1, 3]); // part 2 lost
  const early = await completeDirectUpload(db, store, 'u-ann', 'direct-0001');
  assert.equal(early.status, 409);
  assert.deepEqual((early.body as { missingParts: number[] }).missingParts, [2]);

  // A refresh: starting the same upload again reports what R2 already has.
  const resumed = await startDirectUpload(db, store, 'u-ann', input, policy);
  assert.deepEqual((resumed.body as { uploadedParts: number[] }).uploadedParts, [1, 3]);

  sendParts(store, mp, bytes, [2]);
  const done = await completeDirectUpload(db, store, 'u-ann', 'direct-0001');
  assert.equal(done.status, 200);
  const asset = (done.body as { asset: { id: string; size: number } }).asset;
  assert.deepEqual(store.objects.get(asset.id)!.bytes, bytes);
  const [row] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.storageKey, asset.id));
  assert.deepEqual([row.userUid, row.sizeBytes], ['u-ann', 2500]);

  // Repeating completion (a lost response) returns the same file; nothing duplicated.
  const again = await completeDirectUpload(db, store, 'u-ann', 'direct-0001');
  assert.equal((again.body as { asset: { id: string } }).asset.id, asset.id);
  assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.storageKey, asset.id))).length, 1);
});

test('DU2. a disguised file or a wrong-sized part is deleted and its reservation released', async () => {
  const store = fakeR2();
  const html = file(1500, [...Buffer.from('<html><script>')]);
  await startDirectUpload(db, store, 'u-cat', { uploadId: 'direct-0002', fileName: 'x.mp4', mimeType: 'video/mp4', totalSize: html.length }, policy);
  sendParts(store, multipartOf(store), html, [1, 2]);
  const bad = await completeDirectUpload(db, store, 'u-cat', 'direct-0002');
  assert.equal(bad.status, 415);
  assert.equal(store.objects.size, 0, 'the object is gone');
  const [s] = await db.select().from(uploadSessions).where(eq(uploadSessions.uploadId, 'direct-0002'));
  assert.equal(s.status, 'aborted');

  const bytes = file(1500);
  await startDirectUpload(db, store, 'u-cat', { uploadId: 'direct-0003', fileName: 'y.mp4', mimeType: 'video/mp4', totalSize: 1500 }, policy);
  const mp = multipartOf(store);
  store.putPart(mp, 1, bytes.subarray(0, 900)); // short non-final part
  store.putPart(mp, 2, bytes.subarray(900));
  assert.equal((await completeDirectUpload(db, store, 'u-cat', 'direct-0003')).status, 400);
  assert.equal(store.uploads.size, 0, 'the multipart upload was aborted');
});

test('DU3. quota, concurrency and the app-wide ceiling are enforced at start; cancel releases space', async () => {
  const store = fakeR2();
  const s = (id: string, size: number, uid = 'u-dee', p = policy) => startDirectUpload(db, store, uid, { uploadId: id, fileName: 'v.mp4', mimeType: 'video/mp4', totalSize: size }, p);
  assert.equal((await s('direct-0010', 60_000)).status, 200);
  assert.equal((await s('direct-0011', 50_000)).status, 413, 'over the per-account quota');
  assert.equal((await s('direct-0012', 10_000)).status, 200);
  assert.equal((await s('direct-0013', 10)).status, 429, 'two at a time');
  assert.deepEqual(await cancelUpload(db, store, 'u-dee', 'direct-0010'), { cancelled: true });
  assert.equal((await s('direct-0014', 50_000)).status, 200, 'cancelled space is free again');

  const tight: UploadPolicy = { ...policy, quotaBytes: 10 ** 9, appCeilingBytes: 1 };
  assert.equal((await s('direct-0015', 10, 'u-eve', tight)).status, 507, 'app-wide ceiling');
});

test('DU4. the orphan sweep deletes only what the database doesn’t know, and stops on a suspicious pattern', async () => {
  const store = fakeR2();
  const old = new Date(Date.now() - 10 * 86_400_000);
  const [kept] = await db.insert(uploadedFiles).values({ userUid: 'u-fay', storageKey: `${crypto.randomUUID()}.png`, fileName: 'a.png', mimeType: 'image/png', sizeBytes: 3 }).returning();
  store.objects.set(kept.storageKey, { bytes: new Uint8Array(3), at: old });
  const orphan = `${crypto.randomUUID()}.png`;
  store.objects.set(orphan, { bytes: new Uint8Array(3), at: old });
  store.objects.set('not-a-backlot-key.txt', { bytes: new Uint8Array(1), at: old });
  for (let i = 0; i < 3; i++) {
    const k = `${crypto.randomUUID()}.mp4`;
    await db.insert(uploadedFiles).values({ userUid: 'u-fay', storageKey: k, fileName: 'b.mp4', mimeType: 'video/mp4', sizeBytes: 1 });
    store.objects.set(k, { bytes: new Uint8Array(1), at: old });
  }
  const r = await sweepBucketOrphans(db, store, { orphanMinAgeMs: 86_400_000 });
  assert.deepEqual([r.orphansFound, r.orphansDeleted, r.unknownKeys], [1, 1, 1]);
  assert.ok(store.objects.has(kept.storageKey) && !store.objects.has(orphan) && store.objects.has('not-a-backlot-key.txt'));

  // Pointed at the wrong (empty) database, nearly everything looks orphaned: refuse.
  const wrong = fakeR2();
  for (let i = 0; i < 20; i++) wrong.objects.set(`${crypto.randomUUID()}.mp4`, { bytes: new Uint8Array(1), at: old });
  const refused = await sweepBucketOrphans(db, wrong, { orphanMinAgeMs: 86_400_000 });
  assert.equal(refused.refused, 'orphan_share');
  assert.equal(wrong.objects.size, 20, 'nothing deleted');
});

test('DU5. configuration and part sizing', () => {
  assert.equal(partSizeFor(10 * 1024 ** 2), 8 * 1024 ** 2);
  const huge = 200 * 1024 ** 3;
  assert.ok(Math.ceil(huge / partSizeFor(huge)) <= 10_000, 'never more than 10,000 parts');
  const r2 = readStorageConfig({ STORAGE_BACKEND: 'r2', R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' });
  assert.equal(r2.backend, 'r2');
  assert.equal((r2 as { prefix: string }).prefix, 'uploads/');
  assert.match((readStorageConfig({ STORAGE_BACKEND: 'r2', R2_BUCKET: 'b' }) as { error: string }).error, /R2_ACCOUNT_ID/);
  assert.equal(readStorageConfig({ STORAGE_BACKEND: 'r2', R2_ACCOUNT_ID: 'a', R2_BUCKET: 'b', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's', R2_ENDPOINT: 'https://evil.example' }).backend, 'misconfigured');
  const p = uploadPolicyFromEnv({});
  assert.deepEqual([p.quotaBytes, p.maxActive, p.appWarnBytes, p.appCeilingBytes], [1024 ** 3, 2, 8 * 1024 ** 3, 9.5 * 1024 ** 3]);
  assert.equal(uploadPolicyFromEnv({ STORAGE_APP_CEILING_GB: '0' }).appCeilingBytes, undefined);
});

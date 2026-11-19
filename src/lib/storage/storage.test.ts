import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.ts';
import { uploadedFiles, uploadSessions } from '../../db/schema.ts';
import { createGcsStore, receivedFromRange } from './gcs.ts';
import { readStorageConfig } from './index.ts';
import { createLocalStore } from './local.ts';
import { contentMatches, sniffType } from './sniff.ts';
import { cleanupUploads, receiveChunk, storageUsed, type UploadPolicy } from './uploads.ts';
import { isStorageKey, StorageError } from './types.ts';

/** L1: media storage layer. Local store on a temp dir, real SQL (PGlite); no cloud calls. */

const client = new PGlite();
const db = drizzle(client, { schema });
let root = '';
before(async () => {
  const { pushSchema } = await import('drizzle-kit/api');
  const log = console.log;
  console.log = () => {};
  try {
    await (await pushSchema(schema, db as never)).apply();
  } finally {
    console.log = log;
  }
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'backlot-store-'));
});
after(async () => {
  await client.close();
  await fsp.rm(root, { recursive: true, force: true });
});

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...Array(52).fill(7)]);
const MP4 = Uint8Array.from([0, 0, 0, 24, ...Buffer.from('ftypisom'), ...Array(52).fill(1)]);
const policy: UploadPolicy = { quotaBytes: 1_000_000, maxActive: 2, sessionTtlMs: 60_000 };
const bytes = (head: Uint8Array, size: number) => {
  const b = new Uint8Array(size);
  b.set(head.subarray(0, Math.min(head.length, size)));
  for (let i = head.length; i < size; i++) b[i] = i % 251;
  return b;
};

test('ST1. content sniffing: real types pass, disguised files fail', () => {
  assert.equal(sniffType(PNG), 'png');
  assert.equal(sniffType(MP4), 'isobmff');
  assert.ok(contentMatches('image/png', PNG));
  assert.ok(contentMatches('video/mp4', MP4));
  assert.ok(!contentMatches('image/png', MP4));
  assert.ok(!contentMatches('image/jpeg', new TextEncoder().encode('<html><script>alert(1)</script></html>')));
  assert.ok(!contentMatches('image/svg+xml', PNG));
});

test('ST2. chunked upload: sequential chunks, retried chunks, out-of-order chunks, completion and ownership', async () => {
  const store = createLocalStore(root);
  const file = bytes(PNG, 600);
  const send = (offset: number, len: number, uploadId = 'up-0001', uid = 'u-alice') =>
    receiveChunk(db, store, uid, { uploadId, offset, totalSize: file.length, fileName: 'cover.png', mimeType: 'image/png', chunk: file.subarray(offset, offset + len) }, policy);

  assert.deepEqual((await send(0, 256)).body, { completed: false, received: 256 });
  assert.deepEqual((await send(0, 256)).body, { completed: false, received: 256 }, 'a retried chunk is not written twice');
  const skip = await send(512, 88);
  assert.equal(skip.status, 409);
  assert.equal((skip.body as { received: number }).received, 256, 'out of order: told where to resume');
  const done = await send(256, 344);
  assert.equal(done.status, 200);
  assert.ok('completed' in done.body && done.body.completed);
  const asset = (done.body as { asset: { id: string; url: string; size: number } }).asset;
  assert.ok(isStorageKey(asset.id), 'server-chosen key, not the file name');
  assert.equal(asset.url, `/api/files/${asset.id}`);
  const stored = await fsp.readFile(path.join(root, asset.id));
  assert.deepEqual(new Uint8Array(stored), file);
  const [row] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.storageKey, asset.id));
  assert.deepEqual([row.userUid, row.sizeBytes, row.mimeType], ['u-alice', 600, 'image/png']);
  // The final chunk retried after completion returns the same asset; nothing duplicated.
  const again = await send(256, 344);
  assert.ok('asset' in again.body && again.body.asset.id === asset.id);
  assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.storageKey, asset.id))).length, 1);
  // Another user using the same upload id gets their own, separate session.
  const other = await send(0, 256, 'up-0001', 'u-bob');
  assert.deepEqual(other.body, { completed: false, received: 256 });
});

test('ST3. uploads are refused when the content is wrong, over quota, or too many run at once', async () => {
  const store = createLocalStore(root);
  const fake = await receiveChunk(db, store, 'u-carol', { uploadId: 'up-fake1', offset: 0, totalSize: 100, fileName: 'x.png', mimeType: 'image/png', chunk: new TextEncoder().encode('<?php system($_GET[1]); ?>'.padEnd(100, ' ')) }, policy);
  assert.equal(fake.status, 415);
  const big = await receiveChunk(db, store, 'u-carol', { uploadId: 'up-big01', offset: 0, totalSize: 2_000_000, fileName: 'v.mp4', mimeType: 'video/mp4', chunk: bytes(MP4, 64) }, policy);
  assert.equal(big.status, 413);
  for (const id of ['up-a0001', 'up-a0002']) {
    const r = await receiveChunk(db, store, 'u-dan', { uploadId: id, offset: 0, totalSize: 1000, fileName: 'v.mp4', mimeType: 'video/mp4', chunk: bytes(MP4, 100) }, policy);
    assert.equal(r.status, 200);
  }
  const third = await receiveChunk(db, store, 'u-dan', { uploadId: 'up-a0003', offset: 0, totalSize: 1000, fileName: 'v.mp4', mimeType: 'video/mp4', chunk: bytes(MP4, 100) }, policy);
  assert.equal(third.status, 429);
  assert.equal(await storageUsed(db, 'u-dan'), 2000, 'in-progress uploads count toward the quota');
});

test('ST4. cleanup cancels expired uploads and deletes objects that never got a database row', async () => {
  const store = createLocalStore(root);
  const now = new Date('2026-11-20T00:00:00Z');
  const file = bytes(PNG, 300);
  // Simulate "storage finished, database write failed": the object exists, no uploaded_files row.
  const key = '0f3e4a5b-1c2d-4e5f-8a9b-0c1d2e3f4a5b.png';
  const sessionRef = await store.beginUpload(key, 'image/png', 300);
  await store.writeChunk(sessionRef, key, 0, file, 300);
  await db.insert(uploadSessions).values({ userUid: 'u-erin', uploadId: 'up-orphan', storageKey: key, sessionRef, fileName: 'o.png', mimeType: 'image/png', totalSize: 300, received: 300, status: 'active', createdAt: now, updatedAt: now, expiresAt: now });
  const r = await cleanupUploads(db, store, new Date(now.getTime() + 1000));
  assert.ok(r.aborted >= 1 && r.objectsDeleted >= 1);
  assert.equal(await store.stat(key), null);
  const [s] = await db.select().from(uploadSessions).where(eq(uploadSessions.storageKey, key));
  assert.equal(s.status, 'aborted');
  // Files that do have an owner row are never deleted by cleanup.
  const kept = (await db.select().from(uploadedFiles)).map((f) => f.storageKey);
  for (const k of kept) assert.ok(await store.stat(k), k);
});

test('ST5. local store never overwrites, and refuses oversize reads', async () => {
  const store = createLocalStore(root);
  const key = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d.mp4';
  const s1 = await store.beginUpload(key, 'video/mp4', 64);
  await store.writeChunk(s1, key, 0, bytes(MP4, 64), 64);
  await assert.rejects(store.beginUpload(key, 'video/mp4', 64), (e: unknown) => e instanceof StorageError && e.code === 'EXISTS');
  await assert.rejects(store.readBuffer(key, 10), (e: unknown) => e instanceof StorageError && e.code === 'TOO_LARGE');
  const text = await new Response(await store.stream(key, { start: 4, end: 11 })).text();
  assert.equal(text, 'ftypisom');
});

test('ST6. Cloud Storage store: resumable session protocol and responses (fake bucket, no network)', async () => {
  assert.equal(receivedFromRange('bytes=0-2097151'), 2097152);
  assert.equal(receivedFromRange(null), 0);
  const calls: { method: string; range: string | null }[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const range = (init.headers as Record<string, string>)['Content-Range'] ?? null;
    calls.push({ method: init.method!, range });
    if (range === 'bytes 0-262143/300000') return new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } });
    if (range === 'bytes 262144-299999/300000') return new Response('{}', { status: 200 });
    if (range === 'bytes */300000') return new Response(null, { status: 308, headers: { Range: 'bytes=0-262143' } });
    return new Response(null, { status: 503 });
  }) as typeof fetch;
  const fakeBucket = { file: () => ({ createResumableUpload: async () => ['https://storage.example/session-1'] }) } as never;
  const gcs = createGcsStore({ bucket: 'b', bucketHandle: fakeBucket, fetchImpl: fakeFetch });
  const session = await gcs.beginUpload('k.mp4', 'video/mp4', 300000);
  assert.equal(session, 'https://storage.example/session-1');
  assert.deepEqual(await gcs.writeChunk(session, 'k', 0, new Uint8Array(262144), 300000), { received: 262144, complete: false });
  await assert.rejects(gcs.writeChunk(session, 'k', 262144, new Uint8Array(1000), 300000 + 10_000), (e: unknown) => e instanceof StorageError && e.code === 'OFFSET', 'non-final chunks must be 256 KiB multiples');
  assert.equal(await gcs.uploadedBytes(session, 'k', 300000), 262144);
  assert.deepEqual(await gcs.writeChunk(session, 'k', 262144, new Uint8Array(37856), 300000), { received: 300000, complete: true });
  await assert.rejects(gcs.writeChunk(session, 'k', 0, new Uint8Array(262144), 999999), (e: unknown) => e instanceof StorageError && e.code === 'UNAVAILABLE');
});

test('ST7. configuration: production can never silently use temporary local disk', () => {
  assert.deepEqual(readStorageConfig({ STORAGE_BACKEND: 'gcs', GCS_BUCKET: 'backlot-media' }), { backend: 'gcs', bucket: 'backlot-media', prefix: 'uploads/' });
  assert.deepEqual(readStorageConfig({ STORAGE_BACKEND: 'gcs', GCS_BUCKET: 'b', GCS_PREFIX: 'media' }), { backend: 'gcs', bucket: 'b', prefix: 'media/' });
  assert.equal(readStorageConfig({ STORAGE_BACKEND: 'gcs' }).backend, 'misconfigured');
  assert.equal(readStorageConfig({ NODE_ENV: 'production' }).backend, 'misconfigured');
  assert.equal(readStorageConfig({ NODE_ENV: 'production', STORAGE_ALLOW_LOCAL: 'true' }).backend, 'local');
  assert.equal(readStorageConfig({}).backend, 'local');
  assert.equal(readStorageConfig({ STORAGE_BACKEND: 's3' }).backend, 'misconfigured');
});

test('ST8. concurrent uploads can’t both claim the same free space', async () => {
  const store = createLocalStore(root);
  const tight: UploadPolicy = { quotaBytes: 1500, maxActive: 5, sessionTtlMs: 60_000 };
  const start = (id: string) =>
    receiveChunk(db, store, 'u-gina', { uploadId: id, offset: 0, totalSize: 1000, fileName: 'v.mp4', mimeType: 'video/mp4', chunk: bytes(MP4, 100) }, tight);
  const results = await Promise.all([start('up-race1'), start('up-race2'), start('up-race3')]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 413, 413], 'only one fits in the quota');
  assert.equal(await storageUsed(db, 'u-gina'), 1000);
  // The same upload id started twice at once gets one session, not two reservations.
  const same = await Promise.all([start('up-twin1'), start('up-twin1')].map((p) => p.catch((e) => e)));
  assert.ok(same.every((r) => r.status !== 500));
  assert.equal((await db.select().from(uploadSessions).where(eq(uploadSessions.uploadId, 'up-twin1'))).length <= 1, true);
});

test('ST9. upload-session references are sealed at rest and never stored in plain text', async () => {
  const { openSessionRef, readSessionKey, sealSessionRef } = await import('./session-ref.ts');
  const key = Buffer.alloc(32, 9);
  const uri = 'https://storage.googleapis.com/upload/storage/v1/b/bkt/o?uploadType=resumable&upload_id=SECRET123';
  const sealed = sealSessionRef(uri, key);
  assert.ok(sealed.startsWith('enc:v1:') && !sealed.includes('SECRET123'));
  assert.notEqual(sealSessionRef(uri, key), sealed, 'random IV per value');
  assert.equal(openSessionRef(sealed, key), uri);
  assert.equal(openSessionRef(sealed, Buffer.alloc(32, 1)), null, 'wrong key: unusable, not garbage');
  assert.equal(openSessionRef(sealed.slice(0, -2) + 'AA', key), null, 'tampered: rejected');
  assert.equal(openSessionRef(uri, key), uri, 'values stored before sealing still work');
  assert.equal(readSessionKey({ NODE_ENV: 'production', STORAGE_BACKEND: 'gcs' }).error?.includes('UPLOAD_SESSION_KEY'), true, 'production GCS requires the key');
  assert.equal(readSessionKey({ UPLOAD_SESSION_KEY: 'too-short' }).error?.includes('32 bytes'), true);
  assert.equal(readSessionKey({ UPLOAD_SESSION_KEY: key.toString('base64') }).key?.length, 32);
  assert.equal(readSessionKey({ UPLOAD_SESSION_KEY: key.toString('hex') }).key?.length, 32);

  // End to end: with the key set, the database only ever holds the sealed form.
  const store = createLocalStore(root);
  process.env.UPLOAD_SESSION_KEY = key.toString('base64');
  try {
    const r = await receiveChunk(db, store, 'u-hal', { uploadId: 'up-seal1', offset: 0, totalSize: 600, fileName: 'c.png', mimeType: 'image/png', chunk: bytes(PNG, 256) }, policy);
    assert.equal(r.status, 200);
    const [row] = await db.select().from(uploadSessions).where(eq(uploadSessions.uploadId, 'up-seal1'));
    assert.ok(row.sessionRef.startsWith('enc:v1:'));
    const done = await receiveChunk(db, store, 'u-hal', { uploadId: 'up-seal1', offset: 256, totalSize: 600, fileName: 'c.png', mimeType: 'image/png', chunk: bytes(PNG, 600).subarray(256) }, policy);
    assert.equal(done.status, 200, 'later chunks open the sealed reference');
    assert.ok('asset' in done.body);
  } finally {
    delete process.env.UPLOAD_SESSION_KEY;
  }
});

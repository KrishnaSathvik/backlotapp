import { Readable } from 'node:stream';
import { Storage, type Bucket } from '@google-cloud/storage';
import { StorageError, type ByteRange, type MediaStore } from './types.ts';

/**
 * Private Google Cloud Storage store.
 *
 * - Credentials: Application Default Credentials (the Cloud Run service account). No key
 *   files, and nothing about the bucket ever reaches the browser.
 * - Uploads: a resumable upload session per file, created with ifGenerationMatch=0 so an
 *   existing object is never overwritten. Each 2 MB chunk from the browser is forwarded to the
 *   session as it arrives, so no instance buffers a whole video. The session URI acts as a
 *   credential: it stays in Postgres and is never returned to clients. Unfinished sessions
 *   expire on Google's side after about a week; Backlot's cleanup also cancels them.
 * - Reads stream from the bucket through the app's owner-checked file route.
 */

const UPLOAD_GRANULE = 256 * 1024; // GCS: non-final resumable chunks must be multiples of 256 KiB

export interface GcsOptions {
  bucket: string;
  /** Object name prefix, e.g. "uploads/". */
  prefix?: string;
  /** Tests inject these. */
  bucketHandle?: Bucket;
  fetchImpl?: typeof fetch;
}

/** Bytes stored according to a 308 response's Range header ("bytes=0-N" → N + 1). */
export function receivedFromRange(range: string | null): number {
  const m = range?.match(/bytes=0-(\d+)/);
  return m ? Number(m[1]) + 1 : 0;
}

export function createGcsStore(opts: GcsOptions): MediaStore {
  const bucket = opts.bucketHandle ?? new Storage().bucket(opts.bucket);
  const doFetch = opts.fetchImpl ?? fetch;
  const name = (key: string) => `${opts.prefix ?? ''}${key}`;

  const status = async (session: string, total: number) => {
    const res = await doFetch(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}`, 'Content-Length': '0' } });
    if (res.status === 200 || res.status === 201) return { received: total, complete: true };
    if (res.status === 308) return { received: receivedFromRange(res.headers.get('range')), complete: false };
    if (res.status === 404 || res.status === 410) throw new StorageError('NOT_FOUND', 'upload session expired');
    throw new StorageError('UNAVAILABLE', `upload status ${res.status}`);
  };

  return {
    kind: 'gcs',
    async beginUpload(key, contentType) {
      try {
        const [uri] = await bucket.file(name(key)).createResumableUpload({
          metadata: { contentType, cacheControl: 'private, max-age=0' },
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        return uri;
      } catch (err) {
        throw new StorageError('UNAVAILABLE', `could not start upload: ${err instanceof Error ? err.message.slice(0, 120) : ''}`);
      }
    },
    async writeChunk(session, _key, offset, data, total) {
      const last = offset + data.length >= total;
      if (!last && data.length % UPLOAD_GRANULE !== 0) throw new StorageError('OFFSET', 'chunk size must be a multiple of 256 KiB');
      const res = await doFetch(session, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${offset}-${offset + data.length - 1}/${total}`, 'Content-Length': String(data.length) },
        body: data as unknown as BodyInit,
      });
      if (res.status === 200 || res.status === 201) return { received: total, complete: true };
      if (res.status === 308) return { received: receivedFromRange(res.headers.get('range')), complete: false };
      if (res.status === 412) throw new StorageError('EXISTS', 'object exists');
      if (res.status === 404 || res.status === 410) throw new StorageError('NOT_FOUND', 'upload session expired');
      // Anything else: ask the session what it has so the caller can resume correctly.
      throw new StorageError('UNAVAILABLE', `chunk upload failed (${res.status})`);
    },
    async uploadedBytes(session, _key, total) {
      return (await status(session, total)).received;
    },
    async abortUpload(session) {
      await doFetch(session, { method: 'DELETE' }).catch(() => undefined);
    },
    async stat(key) {
      try {
        const [meta] = await bucket.file(name(key)).getMetadata();
        return { size: Number(meta.size ?? 0) };
      } catch (err) {
        if ((err as { code?: number }).code === 404) return null;
        throw err;
      }
    },
    async stream(key, range?: ByteRange) {
      const file = bucket.file(name(key));
      const node = file.createReadStream(range ? { start: range.start, end: range.end, validation: false } : {});
      return Readable.toWeb(node) as ReadableStream<Uint8Array>;
    },
    async readBuffer(key, maxBytes) {
      const info = await this.stat(key);
      if (!info) throw new StorageError('NOT_FOUND', 'missing');
      if (info.size > maxBytes) throw new StorageError('TOO_LARGE', 'too large');
      const [buf] = await bucket.file(name(key)).download();
      return buf;
    },
    async delete(key) {
      await bucket.file(name(key)).delete({ ignoreNotFound: true });
    },
  };
}

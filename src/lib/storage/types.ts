/**
 * Where uploaded creator files live. All access goes through this interface so routes and
 * business logic never touch filesystem paths or a cloud SDK directly.
 *
 * Keys are server-generated (UUID + extension) and never chosen by clients. Ownership lives in
 * Postgres (uploaded_files); a store has no notion of users, so callers check ownership first.
 */

export interface ObjectInfo {
  size: number;
}

export interface ByteRange {
  start: number;
  end: number; // inclusive
}

/** One uploaded part of a direct (browser-to-bucket) multipart upload, as the bucket reports it. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

/**
 * Direct browser-to-bucket multipart uploads (Cloudflare R2). The server creates the upload,
 * hands the browser short-lived URLs that can each write exactly one part of one object, and
 * completes the upload itself from the bucket's own list of parts. Bucket credentials never
 * leave the server.
 */
export interface DirectUploads {
  /** Fixed part size for a file of `total` bytes (every part but the last has exactly this size). */
  partSize(total: number): number;
  /** Presigned PUT for one part. The URL authorizes only this key, upload, part number and length. */
  presignPart(key: string, uploadId: string, partNumber: number, contentLength: number, expiresInSec: number): Promise<string>;
  /** Parts the bucket has for an unfinished upload (authoritative; never the browser's word). */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  completeUpload(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  /** The first `length` bytes of a finished object (bounded inspection for type checks). */
  readHead(key: string, length: number): Promise<Uint8Array>;
}

/** Short-lived signed read URLs, so large files don't stream through the app server. */
export interface SignedReads {
  presignGet(key: string, opts: { expiresInSec: number; contentType: string; disposition: string }): Promise<string>;
}

/** Bucket listing for orphan cleanup (keys are returned without the store's prefix). */
export interface BucketInventory {
  listObjects(opts: { olderThan: Date; limit: number }): Promise<{ key: string; size: number; lastModified: Date }[]>;
  listMultipartUploads(opts: { olderThan: Date; limit: number }): Promise<{ key: string; uploadId: string; initiated: Date }[]>;
}

export interface MediaStore {
  readonly kind: 'local' | 'gcs' | 'r2';
  /** Present when the browser uploads straight to the bucket (R2). Absent: chunks go through /api/upload/chunk. */
  readonly direct?: DirectUploads;
  readonly signedReads?: SignedReads;
  readonly inventory?: BucketInventory;
  /**
   * Starts a resumable upload of exactly `size` bytes to `key`, refusing to overwrite an existing
   * object. Returns an opaque server-side session reference (never sent to browsers).
   */
  beginUpload(key: string, contentType: string, size: number): Promise<string>;
  /**
   * Writes `data` at `offset` (must equal bytes already stored). The final chunk completes the
   * object. Stores with `direct` uploads don't accept chunks through the server.
   */
  writeChunk(session: string, key: string, offset: number, data: Uint8Array, size: number): Promise<{ received: number; complete: boolean }>;
  /** Bytes the store has for an unfinished upload (used to resume after a lost response). */
  uploadedBytes(session: string, key: string, size: number): Promise<number>;
  /** Cancels an unfinished upload and discards its bytes. */
  abortUpload(session: string, key: string): Promise<void>;
  stat(key: string): Promise<ObjectInfo | null>;
  /** Streams the object (or one byte range) without buffering it in memory. */
  stream(key: string, range?: ByteRange): Promise<ReadableStream<Uint8Array>>;
  /** Reads a whole (small) object, refusing anything over `maxBytes`. */
  readBuffer(key: string, maxBytes: number): Promise<Buffer>;
  /** Deletes the object; a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export class StorageError extends Error {
  readonly code: 'NOT_FOUND' | 'TOO_LARGE' | 'EXISTS' | 'OFFSET' | 'UNAVAILABLE';
  constructor(code: StorageError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/** Validates a storage key: server-generated UUID + optional short extension. */
export function isStorageKey(key: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-z0-9]{1,10})?$/.test(key);
}

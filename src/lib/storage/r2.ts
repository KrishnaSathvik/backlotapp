import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageError, type ByteRange, type MediaStore, type UploadedPart } from './types.ts';

/**
 * Private Cloudflare R2 store (S3-compatible API).
 *
 * - The bucket is private: no public access, no r2.dev URL, no custom public domain. Every read
 *   is authorized by Backlot after an ownership check in Postgres.
 * - Credentials: an R2 API token scoped to this one bucket (Object Read & Write), server-side only.
 * - Uploads go straight from the browser to R2 as a multipart upload (see `direct`): the server
 *   creates the upload and signs one URL per part. Each URL is valid for minutes and can only
 *   write that part number of that upload of that server-chosen key, with exactly the signed
 *   Content-Length. The server then completes the upload from R2's own part list and checks the
 *   finished object's size and first bytes before it's recorded as the creator's file.
 * - Reads: short-lived signed GET URLs (after the ownership check) so video bytes don't pass
 *   through Vercel Functions; `stream` remains for small server-side reads and proxy mode.
 * - R2 has no soft delete or object versioning here: a deleted object is gone.
 */

const MiB = 1024 * 1024;
/** R2/S3: every part but the last must be at least 5 MiB, and an upload has at most 10,000 parts. */
const MIN_PART = 5 * MiB;
const DEFAULT_PART = 8 * MiB;
const MAX_PARTS = 10_000;

export interface R2Config {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Default https://<accountId>.r2.cloudflarestorage.com (set for an EU jurisdiction bucket). */
  endpoint?: string;
  /** Object key prefix for creator media, e.g. "uploads/". */
  prefix: string;
}

export function createR2Client(cfg: Pick<R2Config, 'accountId' | 'accessKeyId' | 'secretAccessKey' | 'endpoint'>): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint || `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Only send checksums when an operation requires them. Default flexible checksums would put
    // checksum parameters into presigned part URLs that the browser can't satisfy.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

const status = (err: unknown) => (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
const named = (err: unknown, ...names: string[]) => names.includes((err as { name?: string })?.name ?? '');
const isNotFound = (err: unknown) => status(err) === 404 || named(err, 'NotFound', 'NoSuchKey');
const isNoUpload = (err: unknown) => named(err, 'NoSuchUpload') || status(err) === 404;

function unavailable(what: string, err: unknown): StorageError {
  return new StorageError('UNAVAILABLE', `${what} failed (${status(err) ?? (err as { name?: string })?.name ?? 'error'})`);
}

/** Part size for a file: 8 MiB, raised (in whole MiB) when needed to stay under 10,000 parts. */
export function partSizeFor(total: number): number {
  const needed = Math.ceil(total / MAX_PARTS);
  return Math.max(DEFAULT_PART, MIN_PART, Math.ceil(needed / MiB) * MiB);
}

export function createR2Store(cfg: R2Config, client: S3Client = createR2Client(cfg)): MediaStore {
  const Bucket = cfg.bucket;
  const name = (key: string) => `${cfg.prefix}${key}`;
  const unprefix = (k: string) => (k.startsWith(cfg.prefix) ? k.slice(cfg.prefix.length) : k);

  const listParts = async (key: string, uploadId: string): Promise<UploadedPart[]> => {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    for (let page = 0; page < 20; page++) {
      let res;
      try {
        res = await client.send(new ListPartsCommand({ Bucket, Key: name(key), UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
      } catch (err) {
        if (isNoUpload(err)) throw new StorageError('NOT_FOUND', 'upload not found');
        throw unavailable('list parts', err);
      }
      for (const p of res.Parts ?? []) {
        if (p.PartNumber && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: Number(p.Size ?? 0) });
      }
      if (!res.IsTruncated) break;
      marker = res.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  };

  const stat = async (key: string) => {
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket, Key: name(key) }));
      return { size: Number(res.ContentLength ?? 0) };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw unavailable('stat', err);
    }
  };

  const getBody = async (key: string, range?: ByteRange) => {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: name(key), Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
      if (!res.Body) throw new StorageError('NOT_FOUND', 'missing');
      return res.Body;
    } catch (err) {
      if (err instanceof StorageError) throw err;
      if (isNotFound(err)) throw new StorageError('NOT_FOUND', 'missing');
      throw unavailable('read', err);
    }
  };

  return {
    kind: 'r2',

    async beginUpload(key, contentType) {
      // Keys are random UUIDs; still never start an upload over an existing object.
      if (await stat(key)) throw new StorageError('EXISTS', 'object exists');
      try {
        const res = await client.send(
          new CreateMultipartUploadCommand({ Bucket, Key: name(key), ContentType: contentType, CacheControl: 'private, max-age=0' })
        );
        if (!res.UploadId) throw new Error('no upload id');
        return res.UploadId;
      } catch (err) {
        throw unavailable('create upload', err);
      }
    },

    async writeChunk() {
      throw new StorageError('UNAVAILABLE', 'R2 uploads go directly from the browser (POST /api/upload/session)');
    },

    async uploadedBytes(session, key) {
      return (await listParts(key, session)).reduce((n, p) => n + p.size, 0);
    },

    async abortUpload(session, key) {
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: name(key), UploadId: session }));
      } catch (err) {
        if (!isNoUpload(err)) throw unavailable('abort upload', err);
      }
    },

    stat,

    async stream(key, range) {
      const body = await getBody(key, range);
      return body.transformToWebStream() as ReadableStream<Uint8Array>;
    },

    async readBuffer(key, maxBytes) {
      const info = await stat(key);
      if (!info) throw new StorageError('NOT_FOUND', 'missing');
      if (info.size > maxBytes) throw new StorageError('TOO_LARGE', 'too large');
      return Buffer.from(await (await getBody(key)).transformToByteArray());
    },

    async delete(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket, Key: name(key) }));
      } catch (err) {
        if (!isNotFound(err)) throw unavailable('delete', err);
      }
    },

    direct: {
      partSize: partSizeFor,
      async presignPart(key, uploadId, partNumber, contentLength, expiresInSec) {
        return getSignedUrl(
          client,
          new UploadPartCommand({ Bucket, Key: name(key), UploadId: uploadId, PartNumber: partNumber, ContentLength: contentLength }),
          // Content-Length is a signed header: the browser can't send a different-sized body.
          { expiresIn: expiresInSec, signableHeaders: new Set(['content-length']) }
        );
      },
      listParts,
      async completeUpload(key, uploadId, parts) {
        try {
          await client.send(
            new CompleteMultipartUploadCommand({
              Bucket,
              Key: name(key),
              UploadId: uploadId,
              MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
            })
          );
        } catch (err) {
          if (named(err, 'NoSuchUpload')) throw new StorageError('NOT_FOUND', 'upload not found');
          throw unavailable('complete upload', err);
        }
      },
      async readHead(key, length) {
        const body = await getBody(key, { start: 0, end: Math.max(0, length - 1) });
        return body.transformToByteArray();
      },
    },

    signedReads: {
      async presignGet(key, opts) {
        return getSignedUrl(
          client,
          new GetObjectCommand({
            Bucket,
            Key: name(key),
            ResponseContentType: opts.contentType,
            ResponseContentDisposition: opts.disposition,
            ResponseCacheControl: 'private, max-age=0, no-store',
          }),
          { expiresIn: opts.expiresInSec }
        );
      },
    },

    inventory: {
      async listObjects({ olderThan, limit }) {
        const out: { key: string; size: number; lastModified: Date }[] = [];
        let token: string | undefined;
        do {
          let res;
          try {
            res = await client.send(new ListObjectsV2Command({ Bucket, Prefix: cfg.prefix, ContinuationToken: token, MaxKeys: 1000 }));
          } catch (err) {
            throw unavailable('list objects', err);
          }
          for (const o of res.Contents ?? []) {
            if (!o.Key || !o.LastModified || o.LastModified >= olderThan) continue;
            out.push({ key: unprefix(o.Key), size: Number(o.Size ?? 0), lastModified: o.LastModified });
            if (out.length >= limit) return out;
          }
          token = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (token);
        return out;
      },
      async listMultipartUploads({ olderThan, limit }) {
        const out: { key: string; uploadId: string; initiated: Date }[] = [];
        let keyMarker: string | undefined;
        let uploadIdMarker: string | undefined;
        for (let page = 0; page < 50; page++) {
          let res;
          try {
            res = await client.send(new ListMultipartUploadsCommand({ Bucket, Prefix: cfg.prefix, KeyMarker: keyMarker, UploadIdMarker: uploadIdMarker, MaxUploads: 1000 }));
          } catch (err) {
            throw unavailable('list uploads', err);
          }
          for (const u of res.Uploads ?? []) {
            if (!u.Key || !u.UploadId || !u.Initiated || u.Initiated >= olderThan) continue;
            out.push({ key: unprefix(u.Key), uploadId: u.UploadId, initiated: u.Initiated });
            if (out.length >= limit) return out;
          }
          if (!res.IsTruncated) break;
          keyMarker = res.NextKeyMarker;
          uploadIdMarker = res.NextUploadIdMarker;
        }
        return out;
      },
    },
  };
}

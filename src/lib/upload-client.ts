import type { MediaAsset } from './content-logic';
import { CHUNK_SIZE, resolveMimeType, validateUpload } from './upload-limits';

function newUploadId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- resume after a refresh ----------
 * The same file (name, size, type, last modified) picked again within a day gets the same
 * uploadId, so the server resumes it instead of starting over. Per browser only; storage
 * failures (private mode, blocked storage) just mean no resume. */
const RESUME_KEY = 'backlot.uploads.v1';
const RESUME_MS = 23 * 60 * 60 * 1000;
type ResumeMap = Record<string, { id: string; at: number }>;
const fingerprint = (f: File, mime: string) => `${f.name}|${f.size}|${mime}|${f.lastModified}`;
function readResume(): ResumeMap {
  try {
    const m = JSON.parse(localStorage.getItem(RESUME_KEY) || '{}') as ResumeMap;
    const now = Date.now();
    for (const [k, v] of Object.entries(m)) if (!v || now - v.at > RESUME_MS) delete m[k];
    return m;
  } catch {
    return {};
  }
}
function writeResume(m: ResumeMap) {
  try {
    localStorage.setItem(RESUME_KEY, JSON.stringify(m));
  } catch {
    /* no resume across refreshes */
  }
}
function resumableId(file: File, mime: string): string {
  const m = readResume();
  const fp = fingerprint(file, mime);
  const id = m[fp]?.id ?? newUploadId();
  m[fp] = { id, at: m[fp]?.at ?? Date.now() };
  writeResume(m);
  return id;
}
function forgetResume(file: File, mime: string) {
  const m = readResume();
  delete m[fingerprint(file, mime)];
  writeResume(m);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(url: string, init: RequestInit, authToken: string): Promise<{ status: number; data: T }> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, ...(init.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

/** Retries network failures and 5xx a few times with backoff; returns other responses as they are. */
async function apiRetry<T>(url: string, init: RequestInit, authToken: string, signal?: AbortSignal) {
  for (let attempt = 1; ; attempt++) {
    signal?.throwIfAborted();
    try {
      const r = await api<T>(url, { ...init, signal }, authToken);
      if (r.status < 500 || attempt >= 5) return r;
    } catch (err) {
      if (signal?.aborted || attempt >= 5) throw err;
    }
    await sleep(500 * attempt);
  }
}

/**
 * Uploads a file, resumably.
 *
 * Production (R2): the server reserves quota and opens a private multipart upload; the browser
 * PUTs each part straight to R2 with a short-lived URL that can write only that part (so the
 * video never passes through the app server), then asks the server to complete and check it.
 * Lost responses, expired part URLs and a refresh mid-upload all resume from what R2 has.
 *
 * Local development: 2 MB chunks through /api/upload/chunk, each carrying its byte offset, so
 * retries never duplicate data and an out-of-order reply tells us where to resume.
 *
 * `signal` cancels: the server aborts the upload and releases the reserved space.
 */
export async function uploadAssetResumable(options: {
  file: File;
  authToken: string | null;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<MediaAsset> {
  const { file, authToken, onProgress, signal } = options;

  const problem = validateUpload(file.name, file.type, file.size);
  if (problem) throw new Error(problem);
  const mimeType = resolveMimeType(file.name, file.type);

  if (!authToken) {
    // Demo: keep the file in memory only. Nothing is uploaded or stored, and it is gone on refresh.
    const url = URL.createObjectURL(file);
    onProgress?.(100);
    return { id: newUploadId(), name: file.name, url, mimeType, size: file.size };
  }

  const uploadId = resumableId(file, mimeType);
  try {
    const start = await apiRetry<Record<string, unknown>>(
      '/api/upload/session',
      { method: 'POST', body: JSON.stringify({ uploadId, fileName: file.name, mimeType, size: file.size }) },
      authToken,
      signal
    );
    if (start.status === 410) {
      // That earlier attempt expired; start fresh.
      forgetResume(file, mimeType);
      return uploadAssetResumable(options);
    }
    if (start.status !== 200) throw new UploadError(String(start.data.error || `Upload failed (${start.status}).`), start.status);
    const asset =
      start.data.mode === 'chunked'
        ? await uploadChunked(file, mimeType, uploadId, authToken, onProgress, signal)
        : start.data.completed
          ? (start.data.asset as MediaAsset)
          : await uploadDirect(file, uploadId, authToken, start.data as unknown as DirectPlan, onProgress, signal);
    forgetResume(file, mimeType);
    onProgress?.(100);
    return asset;
  } catch (err) {
    if (signal?.aborted) {
      forgetResume(file, mimeType);
      await api('/api/upload/session?uploadId=' + encodeURIComponent(uploadId), { method: 'DELETE' }, authToken).catch(() => undefined);
      throw new Error('Upload cancelled.');
    }
    // Refused for a reason that won't change on retry: don't try to resume this one.
    if (err instanceof UploadError && err.status >= 400 && err.status < 500 && err.status !== 409) forgetResume(file, mimeType);
    throw err;
  }
}

interface DirectPlan {
  partSize: number;
  partCount: number;
  uploadedParts: number[];
}

/** Parts in flight at once. */
const PART_CONCURRENCY = 3;

async function uploadDirect(file: File, uploadId: string, authToken: string, plan: DirectPlan, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<MediaAsset> {
  const sizeOf = (n: number) => (n < plan.partCount ? plan.partSize : file.size - (plan.partCount - 1) * plan.partSize);
  const done = new Set(plan.uploadedParts);
  const report = () => onProgress?.(Math.min(99, Math.round(([...done].reduce((t, n) => t + sizeOf(n), 0) / file.size) * 100)));
  report();

  for (let round = 0; round < 6; round++) {
    const todo: number[] = [];
    for (let n = 1; n <= plan.partCount; n++) if (!done.has(n)) todo.push(n);

    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        // Sign a few parts at a time; URLs expire in minutes, so don't sign far ahead.
        const batch = todo.slice(next, next + Math.min(5, todo.length - next));
        next += batch.length;
        const signed = await apiRetry<{ parts?: { partNumber: number; url: string }[]; error?: string }>(
          '/api/upload/parts',
          { method: 'POST', body: JSON.stringify({ uploadId, partNumbers: batch }) },
          authToken,
          signal
        );
        if (signed.status !== 200 || !signed.data.parts) throw new UploadError(signed.data.error || `Upload failed (${signed.status}).`, signed.status);
        for (const p of signed.data.parts) {
          const start = (p.partNumber - 1) * plan.partSize;
          const body = file.slice(start, start + sizeOf(p.partNumber));
          let stored = false;
          for (let attempt = 1; attempt <= 4 && !stored; attempt++) {
            signal?.throwIfAborted();
            try {
              const res = await fetch(p.url, { method: 'PUT', body, signal });
              if (res.ok) {
                stored = true;
                break;
              }
              // 403: the URL expired while queued; the next round signs a new one.
              if (res.status === 403) break;
            } catch (err) {
              if (signal?.aborted) throw err;
              // A CORS block or a dead connection fails the same way every time. Stop instead of
              // retrying every part for several rounds while the label stays at 0%.
              if (err instanceof TypeError && attempt >= 2) {
                throw new Error('The browser blocked the upload before it reached storage.');
              }
            }
            if (!stored && attempt < 4) await sleep(700 * attempt);
          }
          // Only a part R2 accepted counts. A failed PUT used to be marked done, so completion
          // kept reporting it missing and the upload failed after looking finished.
          if (stored) done.add(p.partNumber);
        }
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.min(PART_CONCURRENCY, Math.max(1, todo.length)) }, worker));

    const complete = await apiRetry<{ completed?: boolean; asset?: MediaAsset; missingParts?: number[]; error?: string }>(
      '/api/upload/complete',
      { method: 'POST', body: JSON.stringify({ uploadId }) },
      authToken,
      signal
    );
    if (complete.status === 200 && complete.data.completed && complete.data.asset) return complete.data.asset;
    if (complete.status === 409 && Array.isArray(complete.data.missingParts)) {
      // R2 is the source of truth: re-send exactly what it doesn't have.
      for (const n of complete.data.missingParts) done.delete(n);
      report();
      continue;
    }
    throw new UploadError(complete.data.error || `Upload failed (${complete.status}).`, complete.status);
  }
  throw new Error('Upload did not complete. Try again.');
}

async function uploadChunked(file: File, mimeType: string, uploadId: string, authToken: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<MediaAsset> {
  let offset = 0;
  let failures = 0;

  while (true) {
    signal?.throwIfAborted();
    const end = Math.min(file.size, offset + CHUNK_SIZE);
    let res: Response;
    try {
      res = await fetch('/api/upload/chunk', {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'x-upload-id': uploadId,
          'x-chunk-offset': String(offset),
          'x-total-size': String(file.size),
          'x-file-name': encodeURIComponent(file.name),
          'x-mime-type': mimeType,
        },
        body: file.slice(offset, end),
      });
    } catch (err) {
      if (signal?.aborted || ++failures > 4) throw err instanceof Error ? err : new Error('Upload failed.');
      await sleep(500 * failures);
      continue;
    }

    const data = await res.json().catch(() => ({}));

    if (res.status === 409 && typeof data.received === 'number') {
      offset = data.received; // server tells us where to continue
      continue;
    }
    if (!res.ok) {
      if (res.status >= 500 && ++failures <= 4) {
        await sleep(500 * failures);
        continue;
      }
      throw new UploadError(data.error || `Upload failed (${res.status}).`, res.status);
    }

    failures = 0;
    offset = typeof data.received === 'number' ? data.received : end;
    onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));

    if (data.completed && data.asset) return data.asset as MediaAsset;
    if (offset >= file.size) throw new Error('Upload did not complete.');
  }
}

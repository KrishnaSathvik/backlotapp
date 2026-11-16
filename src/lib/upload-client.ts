import type { MediaAsset } from './content-logic';
import { saveLocalBlob } from './local-vault';
import { CHUNK_SIZE, resolveMimeType, validateUpload } from './upload-limits';

function newUploadId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Uploads a file in 2 MB chunks. Each chunk carries its byte offset, so retries
 * never duplicate data, and an out-of-order reply tells us where to resume.
 */
export async function uploadAssetResumable(options: {
  file: File;
  authToken: string | null;
  onProgress?: (percent: number) => void;
}): Promise<MediaAsset> {
  const { file, authToken, onProgress } = options;

  const problem = validateUpload(file.name, file.type, file.size);
  if (problem) throw new Error(problem);
  const mimeType = resolveMimeType(file.name, file.type);
  const uploadId = newUploadId();

  if (!authToken) {
    // Preview mode: keep the blob in IndexedDB.
    onProgress?.(35);
    const url = await saveLocalBlob(uploadId, file);
    onProgress?.(100);
    return { id: uploadId, name: file.name, url, mimeType, size: file.size };
  }

  let offset = 0;
  let failures = 0;

  while (true) {
    const end = Math.min(file.size, offset + CHUNK_SIZE);
    let res: Response;
    try {
      res = await fetch('/api/upload/chunk', {
        method: 'POST',
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
      if (++failures > 4) throw err instanceof Error ? err : new Error('Upload failed.');
      await new Promise((r) => setTimeout(r, 500 * failures));
      continue;
    }

    const data = await res.json().catch(() => ({}));

    if (res.status === 409 && typeof data.received === 'number') {
      offset = data.received; // server tells us where to continue
      continue;
    }
    if (!res.ok) {
      if (res.status >= 500 && ++failures <= 4) {
        await new Promise((r) => setTimeout(r, 500 * failures));
        continue;
      }
      throw new Error(data.error || `Upload failed (${res.status}).`);
    }

    failures = 0;
    offset = typeof data.received === 'number' ? data.received : end;
    onProgress?.(Math.min(100, Math.round((offset / file.size) * 100)));

    if (data.completed && data.asset) return data.asset as MediaAsset;
    if (offset >= file.size) throw new Error('Upload did not complete.');
  }
}

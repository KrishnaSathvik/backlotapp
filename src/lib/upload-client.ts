import type { MediaAsset } from './content-logic';
import { saveLocalBlob } from './local-vault';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB chunks for resumable uploads

export async function uploadAssetResumable(options: {
  file: File;
  authToken: string | null;
  onProgress?: (percent: number) => void;
}): Promise<MediaAsset> {
  const { file, authToken, onProgress } = options;
  const uploadId =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  if (!authToken) {
    // Preview / offline mode: persist raw Blob in IndexedDB with progress simulation
    onProgress?.(35);
    const url = await saveLocalBlob(uploadId, file);
    onProgress?.(100);
    return {
      id: uploadId,
      name: file.name,
      url,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
    };
  }

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  let completedAsset: MediaAsset | null = null;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(file.size, start + CHUNK_SIZE);
    const slice = file.slice(start, end);

    let attempt = 0;
    let uploadedChunk = false;

    while (!uploadedChunk && attempt < 3) {
      attempt += 1;
      try {
        const res = await fetch('/api/upload/chunk', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'x-upload-id': uploadId,
            'x-chunk-index': String(chunkIndex),
            'x-total-chunks': String(totalChunks),
            'x-file-name': encodeURIComponent(file.name),
            'x-mime-type': file.type || 'application/octet-stream',
            'x-total-size': String(file.size),
          },
          body: slice,
        });

        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }

        const data = await res.json();
        uploadedChunk = true;
        onProgress?.(Math.round(((chunkIndex + 1) / totalChunks) * 100));

        if (data.completed && data.asset) {
          completedAsset = data.asset as MediaAsset;
        }
      } catch (err) {
        if (attempt >= 3) throw err;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }
    }
  }

  if (!completedAsset) {
    throw new Error('Upload did not complete.');
  }

  return completedAsset;
}

import path from 'node:path';
import { getMediaStore, UPLOAD_ROOT } from './storage/index.ts';

export { UPLOAD_ROOT };

/** Reads a stored upload by its key through the configured store (callers check ownership first). */
export async function readUploadedFile(storageKey: string, maxBytes: number): Promise<Buffer> {
  return getMediaStore().readBuffer(path.basename(storageKey), maxBytes);
}

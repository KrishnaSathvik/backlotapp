import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { StorageError, type ByteRange, type MediaStore } from './types.ts';

/**
 * Local filesystem store for development. NOT durable on Cloud Run: an instance's disk is
 * temporary and not shared between instances. Production uses the Cloud Storage store.
 */
export function createLocalStore(root: string): MediaStore {
  const partials = path.join(root, '.partial');
  const objectPath = (key: string) => path.join(root, path.basename(key));
  const partPath = (session: string) => path.join(partials, `${path.basename(session)}.part`);
  const size = async (p: string) => {
    try {
      return (await fsp.stat(p)).size;
    } catch {
      return 0;
    }
  };

  return {
    kind: 'local',
    async beginUpload(key) {
      if (await size(objectPath(key))) throw new StorageError('EXISTS', 'object exists');
      await fsp.mkdir(partials, { recursive: true });
      const session = crypto.randomUUID();
      await fsp.writeFile(partPath(session), '');
      return session;
    },
    async writeChunk(session, key, offset, data, total) {
      const part = partPath(session);
      const have = await size(part);
      if (offset !== have) throw new StorageError('OFFSET', `expected offset ${have}`);
      await fsp.appendFile(part, data);
      const received = have + data.length;
      if (received < total) return { received, complete: false };
      if (received > total) throw new StorageError('OFFSET', 'more bytes than declared');
      // link() fails if the target exists, so a finished object is never overwritten.
      await fsp.link(part, objectPath(key)).catch((e: NodeJS.ErrnoException) => {
        throw e.code === 'EEXIST' ? new StorageError('EXISTS', 'object exists') : e;
      });
      await fsp.rm(part, { force: true });
      return { received, complete: true };
    },
    async uploadedBytes(session, key, total) {
      const done = await size(objectPath(key));
      return done === total && total > 0 ? total : size(partPath(session));
    },
    async abortUpload(session) {
      await fsp.rm(partPath(session), { force: true });
    },
    async stat(key) {
      try {
        const s = await fsp.stat(objectPath(key));
        return s.isFile() ? { size: s.size } : null;
      } catch {
        return null;
      }
    },
    async stream(key, range?: ByteRange) {
      const p = objectPath(key);
      if (!(await size(p)) && !(await fsp.stat(p).catch(() => null))) throw new StorageError('NOT_FOUND', 'missing');
      return Readable.toWeb(fs.createReadStream(p, range ? { start: range.start, end: range.end } : {})) as ReadableStream<Uint8Array>;
    },
    async readBuffer(key, maxBytes) {
      const p = objectPath(key);
      const s = await fsp.stat(p).catch(() => null);
      if (!s) throw new StorageError('NOT_FOUND', 'missing');
      if (s.size > maxBytes) throw new StorageError('TOO_LARGE', 'too large');
      return fsp.readFile(p);
    },
    async delete(key) {
      await fsp.rm(objectPath(key), { force: true });
    },
  };
}

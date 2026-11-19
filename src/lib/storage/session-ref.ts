import crypto from 'node:crypto';

/**
 * Protects upload-session references at rest.
 *
 * A Cloud Storage resumable-session URI is a bearer credential: anyone holding it can write the
 * object until the session ends. It never leaves the server (it isn't in any response or log),
 * and in the database it's stored sealed with AES-256-GCM under UPLOAD_SESSION_KEY (32 bytes,
 * base64 or hex, e.g. from Secret Manager). A database dump or a read-only SQL user therefore
 * can't resume anyone's upload.
 *
 * - Production with the Cloud Storage backend refuses to start uploads without the key
 *   (see readSessionKey; checked when an upload starts).
 * - Values stored before this change (plain URIs) are still read, so in-flight uploads continue.
 */

const PREFIX = 'enc:v1:';

function parseKey(raw: string | undefined): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  const buf = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : Buffer.from(v, 'base64');
  return buf.length === 32 ? buf : null;
}

export function readSessionKey(env: Record<string, string | undefined> = process.env): { key: Buffer | null; error?: string } {
  const key = parseKey(env.UPLOAD_SESSION_KEY);
  if (env.UPLOAD_SESSION_KEY?.trim() && !key) return { key: null, error: 'UPLOAD_SESSION_KEY must be 32 bytes (base64 or 64 hex characters).' };
  if (!key && env.NODE_ENV === 'production' && (env.STORAGE_BACKEND ?? '').toLowerCase() === 'gcs') {
    return { key: null, error: 'Production with STORAGE_BACKEND=gcs needs UPLOAD_SESSION_KEY.' };
  }
  return { key };
}

export function sealSessionRef(ref: string, key: Buffer | null = readSessionKey().key): string {
  if (!key || !ref) return ref;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(ref, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}

/** The usable reference, or null if it can't be opened (wrong or missing key). */
export function openSessionRef(stored: string, key: Buffer | null = readSessionKey().key): string | null {
  if (!stored.startsWith(PREFIX)) return stored || null; // stored before sealing existed
  if (!key) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

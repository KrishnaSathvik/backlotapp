/**
 * Public-page copy of the upload policy's numbers, without importing storage code.
 * Same rules as uploadPolicyFromEnv (src/lib/storage/uploads.ts). Server only: these env vars
 * aren't inlined into the browser bundle.
 */
const GiB = 1024 ** 3;

const posNum = (raw: string | undefined) => {
  const n = Number(raw);
  return raw?.trim() && Number.isFinite(n) && n > 0 ? n : null;
};

/** Per-account storage limit in bytes (STORAGE_QUOTA_GB, default 1 GB). */
export function storageQuotaBytes(env: Record<string, string | undefined> = process.env): number {
  return (posNum(env.STORAGE_QUOTA_GB) ?? 1) * GiB;
}

/** Uploads one account can have in progress at once (UPLOAD_MAX_CONCURRENT, default 2). */
export function concurrentUploads(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.UPLOAD_MAX_CONCURRENT);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

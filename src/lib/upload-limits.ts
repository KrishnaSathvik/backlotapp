/** Shared by the upload client and the upload API. */

export const CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024; // server tolerance

const MB = 1024 * 1024;
const GB = 1024 * MB;

/**
 * Per-file limits. Private-beta defaults: images 30 MB, videos 500 MB. Configurable (they're
 * inlined into the browser bundle at build time, so changing them needs a redeploy):
 *   NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB, NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB
 * The storage layer itself supports much larger files (multipart uploads up to 10,000 parts).
 */
function mbFrom(raw: string | undefined, fallbackMb: number, maxMb: number): number {
  const n = Number(raw);
  return (Number.isFinite(n) && n > 0 && n <= maxMb ? n : fallbackMb) * MB;
}
export const MAX_IMAGE_BYTES = mbFrom(process.env.NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB, 30, 200);
export const MAX_VIDEO_BYTES = mbFrom(process.env.NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB, 500, 50 * 1024);

// SVG is deliberately excluded: it can carry script.
export const IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
];
export const VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/x-matroska',
];

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  m4v: 'video/x-m4v',
  mkv: 'video/x-matroska',
};

/** Browser-reported type, falling back to the file extension (some browsers leave HEIC/MKV blank). */
export function resolveMimeType(name: string, reported: string): string {
  const type = (reported || '').toLowerCase();
  if (IMAGE_TYPES.includes(type) || VIDEO_TYPES.includes(type)) return type;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[ext] ?? type;
}

export function maxBytesFor(mimeType: string): number | null {
  if (IMAGE_TYPES.includes(mimeType)) return MAX_IMAGE_BYTES;
  if (VIDEO_TYPES.includes(mimeType)) return MAX_VIDEO_BYTES;
  return null;
}

/** "30 MB", "500 MB", "1.5 GB". */
export function formatLimit(bytes: number): string {
  return bytes >= GB ? `${+(bytes / GB).toFixed(1)} GB` : `${Math.round(bytes / MB)} MB`;
}

/** Human-readable reason a file cannot be uploaded, or null when it is fine. */
export function validateUpload(name: string, reportedType: string, size: number): string | null {
  const mimeType = resolveMimeType(name, reportedType);
  const max = maxBytesFor(mimeType);
  if (max === null) return `"${name}" is not a supported image or video type.`;
  if (size <= 0) return `"${name}" is empty.`;
  if (size > max) {
    return `"${name}" is larger than the ${formatLimit(max)} limit.`;
  }
  return null;
}

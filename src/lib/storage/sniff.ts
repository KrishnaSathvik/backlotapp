/**
 * Checks an upload's first bytes against its declared type, so a script or web page can't be
 * stored as "an image". (Files are also served with nosniff and a sandboxing CSP.)
 */

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));

/** The family the bytes look like, or null if unknown. */
export function sniffType(head: Uint8Array): 'jpeg' | 'png' | 'gif' | 'webp' | 'isobmff' | 'matroska' | null {
  if (head.length < 12) return null;
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp';
  // MP4, MOV, M4V, HEIC, HEIF, AVIF: an ISO-BMFF box ("ftyp", or QuickTime's older atoms) at byte 4.
  if (['ftyp', 'moov', 'mdat', 'wide', 'free', 'skip', 'pnot'].includes(ascii(head, 4, 4))) return 'isobmff';
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return 'matroska'; // WebM and MKV
  return null;
}

const EXPECTED: Record<string, ReturnType<typeof sniffType>[]> = {
  'image/jpeg': ['jpeg'],
  'image/png': ['png'],
  'image/gif': ['gif'],
  'image/webp': ['webp'],
  'image/avif': ['isobmff'],
  'image/heic': ['isobmff'],
  'image/heif': ['isobmff'],
  'video/mp4': ['isobmff'],
  'video/quicktime': ['isobmff'],
  'video/x-m4v': ['isobmff'],
  'video/webm': ['matroska'],
  'video/x-matroska': ['matroska'],
};

/** True when the first bytes match the declared media type. */
export function contentMatches(mimeType: string, head: Uint8Array): boolean {
  const family = sniffType(head);
  return family !== null && (EXPECTED[mimeType] ?? []).includes(family);
}

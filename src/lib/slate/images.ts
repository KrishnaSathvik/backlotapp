import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import sharp from 'sharp';
import { contentItems, ideas, uploadedFiles } from '../../db/schema.ts';
import type { ImagePart } from './prompt.ts';

/**
 * One image the creator explicitly picked for a Slate message (M5.4).
 *
 * - Nothing is sent unless the request names the image; attaching a post never sends media.
 * - The record must belong to the signed-in creator, and so must the uploaded file
 *   (uploaded_files row). Another user's image and a missing one look the same.
 * - The bytes are decoded to check they really are an image (JPEG, PNG, WebP or GIF),
 *   within size and pixel limits, then downscaled and re-encoded as JPEG. Re-encoding
 *   drops embedded metadata such as camera details and GPS location.
 * - The result travels inline in the provider request; no storage URL is ever shared,
 *   and no processed copy is kept.
 */

type Db = PgDatabase<any, any>;

export interface ImageRequest {
  type: 'post' | 'idea';
  id: number;
  slot: 'cover' | 'slide' | 'screenshot';
  /** For slides: 0-based position. */
  index?: number;
}

export const IMAGE_LIMITS = {
  maxFileBytes: 15 * 1024 * 1024,
  /** Decompression-bomb guard: width × height before resizing. */
  maxInputPixels: 50_000_000,
  /** Longest side sent to the model (both providers downscale beyond roughly this anyway). */
  maxSide: 1568,
  maxOutputBytes: 1_500_000,
  perDay: 30,
} as const;

export type LoadedImage = { ok: true; part: ImagePart; label: string; width: number; height: number; bytes: number } | { ok: false; status: 400 | 404 | 413 | 415; error: string };

const NOT_FOUND: LoadedImage = { ok: false, status: 404, error: 'That image isn’t available.' };

export function parseImageRequest(raw: unknown): ImageRequest | null | 'invalid' {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return 'invalid';
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((k) => !['type', 'id', 'slot', 'index'].includes(k))) return 'invalid';
  if (r.type !== 'post' && r.type !== 'idea') return 'invalid';
  if (typeof r.id !== 'number' || !Number.isInteger(r.id) || r.id < 1 || r.id > 2_147_483_647) return 'invalid';
  if (r.type === 'post' && r.slot !== 'cover' && r.slot !== 'slide') return 'invalid';
  if (r.type === 'idea' && r.slot !== 'screenshot') return 'invalid';
  if (r.slot === 'slide') {
    if (typeof r.index !== 'number' || !Number.isInteger(r.index) || r.index < 0 || r.index > 99) return 'invalid';
  } else if (r.index !== undefined) return 'invalid';
  return { type: r.type, id: r.id, slot: r.slot as ImageRequest['slot'], ...(r.slot === 'slide' ? { index: r.index as number } : {}) };
}

/** `/api/files/<key>` → key, or null for anything else. */
function storageKeyOf(url: string | undefined | null): string | null {
  if (!url || !url.startsWith('/api/files/')) return null;
  const key = path.basename(decodeURIComponent(url.slice('/api/files/'.length).split('?')[0]));
  return key && key !== '.' && key !== '..' ? key : null;
}

export async function loadSlateImage(
  db: Db,
  uid: string,
  req: ImageRequest,
  readFile: (key: string, maxBytes: number) => Promise<Buffer>
): Promise<LoadedImage> {
  let url: string | null = null;
  let label = '';
  if (req.type === 'post') {
    const [p] = await db.select().from(contentItems).where(and(eq(contentItems.id, req.id), eq(contentItems.userUid, uid))).limit(1);
    if (!p) return NOT_FOUND;
    if (req.slot === 'cover') {
      url = p.coverAsset?.url ?? null;
      label = `Cover of “${p.title}”`;
    } else {
      url = p.slides[req.index!]?.url ?? null;
      label = `Slide ${req.index! + 1} of “${p.title}”`;
    }
  } else {
    const [i] = await db.select().from(ideas).where(and(eq(ideas.id, req.id), eq(ideas.userUid, uid))).limit(1);
    if (!i) return NOT_FOUND;
    url = i.screenshotUrl || null;
    label = `Screenshot in “${i.title}”`;
  }
  const key = storageKeyOf(url);
  if (!key) return NOT_FOUND;
  const [owned] = await db.select({ mime: uploadedFiles.mimeType }).from(uploadedFiles).where(and(eq(uploadedFiles.storageKey, key), eq(uploadedFiles.userUid, uid))).limit(1);
  if (!owned) return NOT_FOUND;

  let input: Buffer;
  try {
    input = await readFile(key, IMAGE_LIMITS.maxFileBytes);
  } catch (err) {
    if ((err as { code?: string }).code === 'TOO_LARGE') return { ok: false, status: 413, error: 'That image is too large for Slate (15 MB max).' };
    return NOT_FOUND;
  }

  // Decode for real: the stored type and file name aren't trusted.
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: IMAGE_LIMITS.maxInputPixels }).metadata();
  } catch {
    return { ok: false, status: 415, error: 'Slate can only look at JPEG, PNG, WebP or GIF images.' };
  }
  if (!meta.format || !['jpeg', 'png', 'webp', 'gif'].includes(meta.format) || !meta.width || !meta.height) {
    return { ok: false, status: 415, error: 'Slate can only look at JPEG, PNG, WebP or GIF images.' };
  }
  if (meta.width * meta.height > IMAGE_LIMITS.maxInputPixels) return { ok: false, status: 413, error: 'That image has too many pixels for Slate.' };

  const encode = (quality: number) =>
    sharp(input, { limitInputPixels: IMAGE_LIMITS.maxInputPixels, animated: false })
      .rotate()
      .resize({ width: IMAGE_LIMITS.maxSide, height: IMAGE_LIMITS.maxSide, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  let out = await encode(85);
  if (out.data.length > IMAGE_LIMITS.maxOutputBytes) out = await encode(65);
  if (out.data.length > IMAGE_LIMITS.maxOutputBytes) return { ok: false, status: 413, error: 'That image is too large for Slate.' };

  return {
    ok: true,
    part: { image: { mediaType: 'image/jpeg', data: out.data.toString('base64') } },
    label,
    width: out.info.width,
    height: out.info.height,
    bytes: out.data.length,
  };
}

import fsp from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { contentItems, ideas, uploadedFiles } from '../db/schema.ts';
import type { MediaAsset, PlatformKey, ReferenceAttachment, StatusKey } from './content-logic.ts';

export const UPLOAD_ROOT = path.join(process.cwd(), '.uploads');

const PLATFORMS: PlatformKey[] = [
  'youtube_long',
  'youtube_shorts',
  'instagram_reel',
  'instagram_carousel',
  'other',
];
const STATUSES: StatusKey[] = ['idea', 'scripting', 'editing', 'ready', 'posted'];
const MAX_INT4 = 2_147_483_647;

export class BadRequest extends Error {}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Parses a JSON object body; throws BadRequest on malformed input. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new BadRequest('Request body must be valid JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequest('Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

/** Positive int4 id or null. */
export function parseId(raw: string): number | null {
  if (!/^\d{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_INT4 ? n : null;
}

export function str(value: unknown, max: number, field: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new BadRequest(`${field} must be text.`);
  if (value.length > max) throw new BadRequest(`${field} is too long (max ${max} characters).`);
  return value;
}

export function platform(value: unknown): PlatformKey {
  if (value === undefined) return 'youtube_long';
  if (typeof value === 'string' && PLATFORMS.includes(value as PlatformKey)) {
    return value as PlatformKey;
  }
  throw new BadRequest('Unknown platform.');
}

export function status(value: unknown): StatusKey {
  if (value === undefined) return 'idea';
  if (typeof value === 'string' && STATUSES.includes(value as StatusKey)) {
    return value as StatusKey;
  }
  throw new BadRequest('Unknown stage.');
}

export function tags(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 60) throw new BadRequest('Tags must be a list of up to 60.');
  return value.map((t) => str(t, 80, 'Tag').trim()).filter(Boolean);
}

export function optionalInt(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_INT4) {
    return value;
  }
  throw new BadRequest(`${field} is invalid.`);
}

/** Empty, or an http(s) URL — blocks javascript: and other schemes. */
export function webLink(value: unknown, field: string): string {
  const url = str(value, 2048, field).trim();
  if (url && !/^https?:\/\//i.test(url)) throw new BadRequest(`${field} must start with http:// or https://`);
  return url;
}

/** Only our own file URLs, bundled covers, and http(s) links are accepted as media/screenshot URLs. */
function safeUrl(value: unknown, field: string): string {
  const url = str(value, 2048, field).trim();
  if (!url) return '';
  if (url.startsWith('/api/files/') || url.startsWith('/covers/') || /^https?:\/\//i.test(url)) {
    return url;
  }
  throw new BadRequest(`${field} must be an uploaded file or a web link.`);
}

export function asset(value: unknown, field: string): MediaAsset | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new BadRequest(`${field} is invalid.`);
  const v = value as Record<string, unknown>;
  const size = typeof v.size === 'number' && Number.isFinite(v.size) && v.size >= 0 ? v.size : 0;
  return {
    id: str(v.id, 200, field),
    name: str(v.name, 300, field),
    url: safeUrl(v.url, field),
    mimeType: str(v.mimeType, 120, field),
    size,
    ...(typeof v.order === 'number' ? { order: v.order } : {}),
  };
}

export function assets(value: unknown, field: string): MediaAsset[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) throw new BadRequest(`${field} must be a list of up to 40.`);
  return value.map((a) => asset(a, field)).filter((a): a is MediaAsset => a !== null);
}

export function references(value: unknown): ReferenceAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) throw new BadRequest('References must be a list of up to 40.');
  return value.map((r) => {
    if (!r || typeof r !== 'object') throw new BadRequest('Reference is invalid.');
    const v = r as Record<string, unknown>;
    return {
      id: str(v.id, 200, 'Reference'),
      url: safeUrl(v.url, 'Reference link'),
      title: str(v.title, 300, 'Reference title'),
      note: str(v.note, 4000, 'Reference note'),
      screenshotUrl: safeUrl(v.screenshotUrl, 'Reference screenshot'),
    };
  });
}

export function storageKeyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith('/api/files/')) return null;
  const raw = url.slice('/api/files/'.length).split('?')[0];
  try {
    return path.basename(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** Every storage key referenced by an item/idea-shaped value. */
export function keysIn(value: unknown): string[] {
  const keys = new Set<string>();
  const json = JSON.stringify(value ?? null);
  for (const match of json.matchAll(/\/api\/files\/([^"?\\]+)/g)) {
    const key = storageKeyFromUrl(`/api/files/${match[1]}`);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Rejects references to uploaded files the user does not own. */
export async function assertOwnsFiles(uid: string, value: unknown): Promise<void> {
  const keys = keysIn(value);
  if (!keys.length) return;
  const owned = await db
    .select({ key: uploadedFiles.storageKey })
    .from(uploadedFiles)
    .where(and(eq(uploadedFiles.userUid, uid), inArray(uploadedFiles.storageKey, keys)));
  if (owned.length !== keys.length) {
    throw new BadRequest('One or more attached files were not found.');
  }
}

/**
 * Deletes uploaded files (row + bytes) among `candidateKeys` that are no longer
 * referenced by any of the user's items or ideas. Best-effort: never throws.
 */
export async function collectUnusedFiles(uid: string, candidateKeys: string[]): Promise<void> {
  if (!candidateKeys.length) return;
  try {
    const [items, userIdeas] = await Promise.all([
      db.select().from(contentItems).where(eq(contentItems.userUid, uid)),
      db.select().from(ideas).where(eq(ideas.userUid, uid)),
    ]);
    const stillUsed = new Set(keysIn([items, userIdeas]));
    const unused = candidateKeys.filter((k) => !stillUsed.has(k));
    if (!unused.length) return;

    const removed = await db
      .delete(uploadedFiles)
      .where(and(eq(uploadedFiles.userUid, uid), inArray(uploadedFiles.storageKey, unused)))
      .returning({ key: uploadedFiles.storageKey });

    await Promise.all(
      removed.map(({ key }) => fsp.rm(path.join(UPLOAD_ROOT, path.basename(key)), { force: true }))
    );
  } catch (error) {
    console.error('File cleanup failed:', error);
  }
}

/** Maps thrown errors to responses: BadRequest → 400, anything else → 500 with `fallback`. */
export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof BadRequest) return badRequest(error.message);
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

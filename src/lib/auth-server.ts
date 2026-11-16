import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from './firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string;
}

/** Cookie the client sets so plain <img>/<video> requests to /api/files can be authenticated. */
export const SESSION_COOKIE = 'cv_session';

// Upsert each user once per server process instead of on every request.
const knownUsers = new Set<string>();

function readToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  return cookie || null;
}

/**
 * Resolves the signed-in user, or a ready-made error response.
 * A bad/missing token is 401; a database failure is 503 (not disguised as 401).
 */
export async function requireUser(
  request: NextRequest
): Promise<{ user: AuthenticatedUser; response?: never } | { user?: never; response: NextResponse }> {
  const token = readToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let uid: string;
  let email: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email ?? '';
  } catch {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  if (!knownUsers.has(uid)) {
    try {
      await getOrCreateUser(uid, email);
      knownUsers.add(uid);
    } catch (error) {
      console.error('User sync failed:', error);
      return {
        response: NextResponse.json(
          { error: 'The database is unavailable. Try again shortly.' },
          { status: 503 }
        ),
      };
    }
  }

  return { user: { uid, email } };
}

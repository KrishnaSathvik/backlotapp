import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from './firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';
import { db } from '../db/index.ts';
import { deletionFor } from './account/deletion.ts';
import { errorKind, opsEvent } from './ops-log.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  /** When the user last actually signed in (seconds since epoch), from the ID token. */
  authTime: number;
}

export interface RequireUserOptions {
  /**
   * Account-deletion status only: let a locked (being deleted) account through, and return its
   * deletion. Every other route refuses a locked account.
   */
  allowDeleting?: boolean;
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
  request: NextRequest,
  opts: RequireUserOptions = {}
): Promise<{ user: AuthenticatedUser; response?: never } | { user?: never; response: NextResponse }> {
  const token = readToken(request);
  if (!token) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  let uid: string;
  let email: string;
  let authTime: number;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email ?? '';
    authTime = decoded.auth_time;
  } catch {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  // Account deletion lock. Checked on every request (not cached per instance), before the
  // profile upsert, so a deleted account can't be recreated by a token that's still valid.
  if (!opts.allowDeleting) {
    try {
      const deletion = await deletionFor(db, uid);
      if (deletion) {
        return {
          response: NextResponse.json(
            { error: 'This account is being deleted.', code: 'account_deleting' },
            { status: 403 }
          ),
        };
      }
    } catch (error) {
      opsEvent('db.unavailable', { route: 'auth_deletion_check', error: errorKind(error) }, 'ERROR');
      return { response: NextResponse.json({ error: 'The database is unavailable. Try again shortly.' }, { status: 503 }) };
    }
  }

  if (opts.allowDeleting) return { user: { uid, email, authTime } };

  if (!knownUsers.has(uid)) {
    try {
      await getOrCreateUser(uid, email);
      knownUsers.add(uid);
    } catch (error) {
      opsEvent('db.unavailable', { route: 'auth_user_sync', error: errorKind(error) }, 'ERROR');
      return {
        response: NextResponse.json(
          { error: 'The database is unavailable. Try again shortly.' },
          { status: 503 }
        ),
      };
    }
  }

  return { user: { uid, email, authTime } };
}

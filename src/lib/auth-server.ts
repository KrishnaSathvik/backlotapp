import { NextRequest, NextResponse } from 'next/server';
import { verifyRequestIdentity } from './supabase/server.ts';
import { getOrCreateUser } from '../db/users.ts';
import { db } from '../db/index.ts';
import { deletionFor } from './account/deletion.ts';
import { errorKind, opsEvent } from './ops-log.ts';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  /** When the user last actually signed in (seconds since epoch), from the verified token's `amr`. */
  authTime: number;
}

export interface RequireUserOptions {
  /**
   * Account-deletion status only: let a locked (being deleted) account through, and return its
   * deletion. Every other route refuses a locked account.
   */
  allowDeleting?: boolean;
}

// Upsert each user once per server process instead of on every request.
const knownUsers = new Set<string>();

/**
 * Resolves the signed-in user, or a ready-made error response.
 * A bad/missing token is 401; a database failure is 503 (not disguised as 401).
 */
export async function requireUser(
  request: NextRequest,
  opts: RequireUserOptions = {}
): Promise<{ user: AuthenticatedUser; response?: never } | { user?: never; response: NextResponse }> {
  // Supabase Auth: the uid comes from the verified access token (Bearer header, or the session
  // cookies for plain <img>/<video> requests), never from the request body or query.
  let identity;
  try {
    identity = await verifyRequestIdentity(request);
  } catch (error) {
    opsEvent('auth.unavailable', { error: errorKind(error) }, 'ERROR');
    return { response: NextResponse.json({ error: 'Sign-in is unavailable. Try again shortly.' }, { status: 503 }) };
  }
  if (!identity) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const { uid, email, authTime } = identity;

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

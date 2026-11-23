import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase/admin.ts';
import type { IdentityProvider } from './deletion.ts';

/** About 100 years: a ban that outlives the account. The user is hard-deleted later anyway. */
const BAN_FOREVER = '876000h';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (err: unknown) => {
  const e = err as { status?: number; code?: string } | null;
  return e?.status === 404 || e?.code === 'user_not_found';
};

/**
 * Supabase Authentication, via the admin API (SUPABASE_SECRET_KEY, server only).
 *
 * - revokeSessions bans the user: Supabase then refuses to refresh any of their sessions or
 *   start a new one. Access tokens already issued stay valid until they expire (at most the JWT
 *   expiry, 1 hour by default), but every Backlot route also refuses a locked account
 *   (requireUser checks account_deletions on each request), so they can't reach any data.
 * - deleteUser hard-deletes the Auth user, which also removes its sessions and Google identity link.
 */
export function supabaseIdentityProvider(client: () => SupabaseClient = () => supabaseAdmin()): IdentityProvider {
  // A uid that isn't a Supabase user id (e.g. from before the move off Firebase) has no
  // Supabase sign-in to revoke or delete; the admin API would reject it as malformed.
  const isSupabaseUid = (uid: string) => UUID.test(uid);
  return {
    async revokeSessions(uid) {
      if (!isSupabaseUid(uid)) return;
      const { error } = await client().auth.admin.updateUserById(uid, { ban_duration: BAN_FOREVER });
      if (error && !notFound(error)) throw error;
    },
    async deleteUser(uid) {
      if (!isSupabaseUid(uid)) return;
      const { error } = await client().auth.admin.deleteUser(uid, false);
      if (error && !notFound(error)) throw error;
    },
    async exists(uid) {
      if (!isSupabaseUid(uid)) return false;
      const { data, error } = await client().auth.admin.getUserById(uid);
      if (error) {
        if (notFound(error)) return false;
        throw error;
      }
      return !!data.user;
    },
  };
}

export const supabaseIdentity: IdentityProvider = supabaseIdentityProvider();

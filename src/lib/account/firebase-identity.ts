import { adminAuth } from '../firebase-admin.ts';
import type { IdentityProvider } from './deletion.ts';

const notFound = (err: unknown) => (err as { code?: string })?.code === 'auth/user-not-found';

/** Firebase Authentication, via the Admin SDK (the Cloud Run service account's credentials). */
export const firebaseIdentity: IdentityProvider = {
  async revokeSessions(uid) {
    try {
      await adminAuth.revokeRefreshTokens(uid);
    } catch (err) {
      if (!notFound(err)) throw err;
    }
  },
  async deleteUser(uid) {
    try {
      await adminAuth.deleteUser(uid);
    } catch (err) {
      if (!notFound(err)) throw err;
    }
  },
  async exists(uid) {
    try {
      await adminAuth.getUser(uid);
      return true;
    } catch (err) {
      if (notFound(err)) return false;
      throw err;
    }
  },
};

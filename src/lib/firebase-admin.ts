import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { firebaseProjectId, readFirebaseAdminCredential } from './firebase-admin-config.ts';

/**
 * Firebase Admin (server-side only; Firebase Authentication stays Backlot's identity system).
 *
 * - Verifying sign-in tokens needs only the project id (Google's public keys).
 * - Revoking sessions and deleting the sign-in during account deletion need a credential.
 *   On Vercel there are no Application Default Credentials, so provide a service account key
 *   for the Firebase project as FIREBASE_SERVICE_ACCOUNT_JSON (the JSON, or base64 of it), or as
 *   FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY. Grant it only "Firebase Authentication Admin".
 *   Without one, Google Cloud ADC is used (old Cloud Run setup, or local `gcloud auth`).
 * - FIREBASE_PROJECT_ID overrides the project in firebase-applet-config.json.
 */

if (!getApps().length) {
  const { credential } = readFirebaseAdminCredential();
  const projectId = firebaseProjectId();
  initializeApp(credential ? { credential: cert({ ...credential, projectId: credential.projectId || projectId }), projectId } : { projectId });
}

export const adminAuth = getAuth();

import type { ServiceAccount } from 'firebase-admin/app';
import { firebasePublicConfig } from './firebase-public-config.ts';

/** Firebase Admin settings, without initializing anything (used by the config check). See firebase-admin.ts. */

type Env = Record<string, string | undefined>;

export function readFirebaseAdminCredential(env: Env = process.env): { credential: ServiceAccount | null; error?: string } {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) {
    try {
      const json = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')) as Record<string, string>;
      if (!json.client_email || !json.private_key) return { credential: null, error: 'FIREBASE_SERVICE_ACCOUNT_JSON lacks client_email or private_key.' };
      return { credential: { projectId: json.project_id, clientEmail: json.client_email, privateKey: json.private_key } };
    } catch {
      return { credential: null, error: 'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON (or base64 JSON).' };
    }
  }
  const email = env.FIREBASE_CLIENT_EMAIL?.trim();
  const key = env.FIREBASE_PRIVATE_KEY?.trim();
  if (email && key) return { credential: { clientEmail: email, privateKey: key.replace(/\\n/g, '\n'), projectId: env.FIREBASE_PROJECT_ID?.trim() } };
  if (email || key) return { credential: null, error: 'Set both FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.' };
  return { credential: null };
}

/** The project the browser signs in to (NEXT_PUBLIC_FIREBASE_CONFIG, else firebase-applet-config.json). */
export function firebaseClientProjectId(env: Env = process.env): string {
  return firebasePublicConfig(env.NEXT_PUBLIC_FIREBASE_CONFIG).projectId;
}

/** The project the server verifies tokens for and administers. */
export function firebaseProjectId(env: Env = process.env): string {
  return env.FIREBASE_PROJECT_ID?.trim() || firebaseClientProjectId(env);
}

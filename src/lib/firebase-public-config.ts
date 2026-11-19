import fileConfig from '../../firebase-applet-config.json' with { type: 'json' };

/**
 * Public Firebase web config (not secret: it identifies the project to the browser).
 *
 * Default: firebase-applet-config.json. NEXT_PUBLIC_FIREBASE_CONFIG (the same JSON, as one line)
 * overrides it per Vercel environment, so a staging Preview can sign in to a separate staging
 * Firebase project. That isolation matters: deleting a staging account deletes its Firebase user,
 * which must never be a production user. Inlined at build time: set it before the build.
 */
export interface FirebasePublicConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  [key: string]: string | undefined;
}

const REQUIRED = ['apiKey', 'authDomain', 'projectId', 'appId'] as const;

export function parseFirebasePublicConfig(raw: string | undefined): { config: FirebasePublicConfig | null; error?: string } {
  if (!raw?.trim()) return { config: null };
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (v && typeof v === 'object' && REQUIRED.every((k) => typeof v[k] === 'string' && v[k])) return { config: v as FirebasePublicConfig };
    return { config: null, error: 'NEXT_PUBLIC_FIREBASE_CONFIG lacks apiKey, authDomain, projectId or appId.' };
  } catch {
    return { config: null, error: 'NEXT_PUBLIC_FIREBASE_CONFIG is not valid JSON.' };
  }
}

// The literal process.env.NEXT_PUBLIC_… reference is what Next.js inlines into the browser bundle.
export function firebasePublicConfig(raw: string | undefined = process.env.NEXT_PUBLIC_FIREBASE_CONFIG): FirebasePublicConfig {
  return parseFirebasePublicConfig(raw).config ?? (fileConfig as FirebasePublicConfig);
}

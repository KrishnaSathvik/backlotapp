/**
 * Google Identity Services (the official "Sign in with Google" button), browser only.
 *
 * Google's button runs on Backlot's own origin and hands back a Google ID token, which
 * supabase.auth.signInWithIdToken() turns into a Supabase session. Google's screens then name
 * Backlot's site, not the Supabase project domain the redirect flow goes through.
 *
 * Replay protection: a fresh random nonce per button. Google gets its SHA-256 (it ends up in the
 * ID token), Supabase gets the raw value and checks that they match.
 *
 * Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID (the same OAuth client configured in Supabase's Google
 * provider), with this site's origin under "Authorized JavaScript origins".
 */

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

export interface GoogleCredential {
  idToken: string;
  /** The raw nonce to give Supabase (Google saw only its hash). */
  nonce: string;
}

interface GsiButtonOptions {
  type: 'standard';
  theme: 'outline' | 'filled_black' | 'filled_blue';
  size: 'large';
  text: 'continue_with' | 'signin_with';
  shape: 'pill';
  logo_alignment: 'left' | 'center';
  width: number;
}

interface GsiId {
  initialize(config: {
    client_id: string;
    callback: (response: { credential?: string }) => void;
    nonce: string;
    ux_mode: 'popup';
    auto_select: boolean;
    cancel_on_tap_outside: boolean;
    use_fedcm_for_button?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(parent: HTMLElement, options: GsiButtonOptions): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiId } };
  }
}

export function googleClientId(): string | null {
  // Literal reference: Next.js inlines it into the browser bundle.
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() || null;
}

let loading: Promise<GsiId> | null = null;

/** Loads Google's script once. Rejects after `timeoutMs` (blocked by an extension, offline…). */
export function loadGoogleIdentity(timeoutMs = 8000): Promise<GsiId> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Browser only.'));
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id);
  if (loading) return loading;
  loading = new Promise<GsiId>((resolve, reject) => {
    const done = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('Google sign-in did not load.')));
    const timer = window.setTimeout(() => reject(new Error('Google sign-in did not load.')), timeoutMs);
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      done();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error('Google sign-in did not load.'));
    };
    document.head.appendChild(script);
  }).catch((err) => {
    loading = null; // allow a retry on the next mount
    throw err;
  });
  return loading;
}

function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Renders Google's button into `parent` with a fresh nonce. `onCredential` runs when the person
 * picks an account. Calling it again (re-render) replaces the nonce and the callback.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  opts: {
    clientId: string;
    dark: boolean;
    text?: 'continue_with' | 'signin_with';
    onCredential: (c: GoogleCredential) => void;
    /** False once a newer render (or unmount) superseded this one. */
    isCurrent?: () => boolean;
  }
): Promise<void> {
  const gsi = await loadGoogleIdentity();
  const nonce = randomNonce();
  const hashed = await sha256Hex(nonce);
  if (opts.isCurrent && !opts.isCurrent()) return;
  gsi.initialize({
    client_id: opts.clientId,
    nonce: hashed,
    ux_mode: 'popup',
    auto_select: false,
    cancel_on_tap_outside: true,
    // Google's popup, not Chrome's FedCM: works in every browser, doesn't depend on Chrome's
    // "third-party sign-in" setting, and shows Google's real error (e.g. origin_mismatch).
    use_fedcm_for_button: false,
    itp_support: true,
    callback: (response) => {
      if (response.credential) opts.onCredential({ idToken: response.credential, nonce });
    },
  });
  parent.replaceChildren();
  gsi.renderButton(parent, {
    type: 'standard',
    theme: opts.dark ? 'outline' : 'filled_black',
    size: 'large',
    text: opts.text ?? 'continue_with',
    shape: 'pill',
    logo_alignment: 'center',
    width: Math.max(200, Math.min(400, Math.floor(parent.clientWidth || 320))),
  });
}

/**
 * The Google account id (`sub`) and email inside an ID token, read without verifying it. Only
 * for checking, before signing in again, that it's the same Google account; Supabase verifies
 * the token itself, and the server trusts nothing but the resulting Supabase token.
 */
export function peekGoogleIdToken(idToken: string): { sub: string; email: string } | null {
  try {
    const part = idToken.split('.')[1];
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='))) as {
      sub?: unknown;
      email?: unknown;
    };
    return typeof json.sub === 'string' ? { sub: json.sub, email: typeof json.email === 'string' ? json.email : '' } : null;
  } catch {
    return null;
  }
}

/**
 * Where the OAuth callback may send the browser afterwards: a path on this site only, so the
 * callback can't be used as an open redirect (`//evil.example`, `/\evil.example`, `https://…`).
 */
export const DEFAULT_AFTER_SIGN_IN = '/app';

export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || raw.length > 512) return DEFAULT_AFTER_SIGN_IN;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return DEFAULT_AFTER_SIGN_IN;
  // Reject control characters and backslashes anywhere (browsers treat `\` like `/`).
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return DEFAULT_AFTER_SIGN_IN;
  try {
    const url = new URL(raw, 'https://backlot.invalid');
    if (url.origin !== 'https://backlot.invalid') return DEFAULT_AFTER_SIGN_IN;
    return url.pathname + url.search + url.hash;
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
}

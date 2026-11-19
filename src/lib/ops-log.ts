/**
 * Structured operational events (Launch L3).
 *
 * One JSON line per event on stdout/stderr. Cloud Run sends it to Cloud Logging, which reads
 * `severity` and `message` and keeps the other fields as `jsonPayload.*`, so alerts and
 * log-based metrics can filter on `jsonPayload.event="slate.provider_failed"` etc.
 *
 * Fields are limited to numbers, booleans, null and short strings, and keys that could carry
 * private data (tokens, keys, URLs, emails, content, prompts) are dropped, so a careless call
 * can't log a secret, a resumable upload URL or a creator's text. Pass ids and counts only.
 * docs/OPERATIONS.md lists the events.
 */

export type Severity = 'DEBUG' | 'INFO' | 'NOTICE' | 'WARNING' | 'ERROR' | 'CRITICAL';
type FieldValue = string | number | boolean | null | undefined;

// "input_tokens" (a count) passes; "status_token", "id_token", "api_key", "session_ref" don't.
const BLOCKED_KEY =
  /token$|token_|secret|password|passwd|(^|_)key$|api_?key|private|authorization|cookie|url|uri|email|content|prompt|message|caption|body|bytes|session_?ref/i;
const MAX_STRING = 200;

export function sanitizeFields(fields: Record<string, FieldValue>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || BLOCKED_KEY.test(k)) continue;
    if (typeof v === 'string') out[k] = v.replace(/[\r\n]+/g, ' ').slice(0, MAX_STRING);
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? v : null;
    else out[k] = v;
  }
  return out;
}

/**
 * Short, safe description of an error: its code (or HTTP status, or class name), never its
 * message. Looks through wrappers (Drizzle keeps the Postgres error, with its SQLSTATE, in `cause`).
 */
export function errorKind(err: unknown): string {
  let raw = '';
  for (let e = err as { code?: unknown; status?: unknown; cause?: unknown } | undefined, i = 0; e && i < 4 && !raw; e = e.cause as typeof e, i++) {
    if (typeof e.code === 'string' || typeof e.code === 'number') raw = String(e.code);
    else if (typeof e.status === 'number') raw = `http_${e.status}`;
  }
  if (!raw) {
    const name = (err as { name?: unknown })?.name;
    raw = typeof name === 'string' ? name : 'error';
  }
  return raw.replace(/[^\w./-]/g, '').slice(0, 60) || 'error';
}

export function opsEvent(event: string, fields: Record<string, FieldValue> = {}, severity: Severity = 'INFO') {
  const line = JSON.stringify({ severity, message: event, event, ...sanitizeFields(fields) });
  if (severity === 'ERROR' || severity === 'CRITICAL' || severity === 'WARNING') console.error(line);
  else console.log(line);
}

/** Joins class names, skipping falsy values. Server-safe (src/components/ui.tsx is a client module). */
export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

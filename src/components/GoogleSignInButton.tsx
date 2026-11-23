'use client';

import React, { useEffect, useRef, useState } from 'react';
import { googleClientId, renderGoogleButton, type GoogleCredential } from '@/src/lib/google-identity';

/**
 * Backlot's own Google button, with Google's real button (Google Identity Services) laid over it,
 * invisible and stretched to the same size. The person sees Backlot's design; the click lands on
 * Google's button, so the sign-in runs on this site (Google's screens say "continue to Backlot").
 *
 * `children` is the visible button. While Google's button is active the visible one is `inert`
 * (no focus, no clicks; keyboard users tab into Google's button). If no client id is configured or
 * Google's script can't load, the overlay never appears and `children` works on its own (redirect
 * sign-in).
 */
export function GoogleSignInButton({
  onCredential,
  children,
  busy = false,
  text = 'continue_with',
  className,
}: {
  onCredential: (credential: GoogleCredential) => void;
  children: React.ReactNode;
  busy?: boolean;
  text?: 'continue_with' | 'signin_with';
  className?: string;
}) {
  const wrapper = useRef<HTMLDivElement>(null);
  const target = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [scale, setScale] = useState({ x: 1, y: 1 });
  const handler = useRef(onCredential);
  useEffect(() => {
    handler.current = onCredential;
  }, [onCredential]);

  // Render Google's button (again on theme changes is unnecessary: it's invisible).
  useEffect(() => {
    const clientId = googleClientId();
    const el = target.current;
    if (!clientId || !el) return;
    let cancelled = false;
    renderGoogleButton(el, {
      clientId,
      dark: false,
      text,
      onCredential: (c) => handler.current(c),
      isCurrent: () => !cancelled,
    })
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => undefined); // stays on the visible (redirect) button
    return () => {
      cancelled = true;
    };
  }, [text]);

  // Stretch Google's button over the visible one, whatever their sizes.
  useEffect(() => {
    const outer = wrapper.current;
    const inner = target.current;
    if (!ready || !outer || !inner) return;
    const fit = () => {
      const w = inner.offsetWidth || 1;
      const h = inner.offsetHeight || 1;
      setScale({ x: outer.offsetWidth / w, y: outer.offsetHeight / h });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(outer);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [ready]);

  return (
    <div ref={wrapper} className={`group relative ${className ?? ''}`} aria-busy={busy}>
      <div inert={ready || undefined}>{children}</div>
      <div
        aria-hidden={!ready || busy}
        className={`absolute inset-0 overflow-hidden opacity-0 ${ready && !busy ? '' : 'pointer-events-none'}`}
      >
        <div
          ref={target}
          className="inline-block origin-top-left"
          style={{ transform: `scale(${scale.x}, ${scale.y})` }}
        />
      </div>
    </div>
  );
}

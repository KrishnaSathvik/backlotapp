'use client';

import React from 'react';
import type { GoogleCredential } from '@/src/lib/google-identity';

/**
 * The visible Google button. A click runs the redirect sign-in on the button itself.
 *
 * An invisible Google Identity Services button used to sit on top of this one. Its iframe
 * rendered at 0×0 and a CSS scale moved the hit target, so the labeled button was inert and
 * most clicks did nothing. The button's own onClick is the sign-in.
 */
export function GoogleSignInButton({
  children,
  busy = false,
  className,
}: {
  onCredential: (credential: GoogleCredential) => void;
  children: React.ReactNode;
  busy?: boolean;
  text?: 'continue_with' | 'signin_with';
  className?: string;
}) {
  return (
    <div className={`group relative ${className ?? ''}`} aria-busy={busy}>
      {children}
    </div>
  );
}

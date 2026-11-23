'use client';

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { AuthPanel, type AuthMode } from './auth/AuthPanel';
import { SiteFooter, SiteHeader } from './site/SiteChrome';

interface AuthGateProps {
  /** Shown first, e.g. a failed or cancelled sign-in redirect (?auth_error=…). */
  errorMessage: string | null;
  onPreview: () => void;
}

/**
 * Full-page sign-in: /app (and /login, which redirects there) when signed out. Direct links,
 * expired sessions and sign-in redirects land here. The landing page uses the same panel in a dialog.
 */
export const AuthGate: React.FC<AuthGateProps> = ({ errorMessage, onPreview }) => {
  const [mode, setMode] = useState<AuthMode>(() =>
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin'
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />

      <main id="main" tabIndex={-1} className="relative flex flex-1 flex-col justify-center outline-none">
        <div className="px-4 py-10 sm:px-6 sm:py-16">
          <div className="mx-auto w-full max-w-md animate-rise">
            <div className="rounded-[28px] border border-border bg-surface p-6 shadow-[0_30px_80px_-40px_rgba(10,20,60,0.35)] sm:p-8">
              <AuthPanel
                key={errorMessage ?? ''}
                mode={mode}
                onModeChange={setMode}
                next={typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/app'}
                // The app's auth listener loads the workspace once the session exists.
                onSignedIn={() => undefined}
                initialError={errorMessage}
                titleAs="h1"
                titleId="auth-page-title"
              />
            </div>

            <button
              type="button"
              onClick={onPreview}
              className="group mx-auto mt-5 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-link transition-colors hover:underline"
            >
              Or explore the demo workspace
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
};

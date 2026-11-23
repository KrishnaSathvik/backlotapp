'use client';

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { DEFAULT_AFTER_SIGN_IN } from '@/src/lib/supabase/redirect';
import { Sheet, SheetCloseButton } from '../ui';
import { AuthPanel, authTitle, type AuthMode } from './AuthPanel';

interface AuthDialogApi {
  open: (mode: AuthMode) => void;
}

const AuthDialogContext = createContext<AuthDialogApi | null>(null);

/** Opens the sign-up / sign-in dialog. Null outside the public pages (e.g. the /app sign-in screen). */
export function useAuthDialog(): AuthDialogApi | null {
  return useContext(AuthDialogContext);
}

/**
 * The public pages' sign-up / sign-in dialog. One instance per page; triggers call
 * useAuthDialog().open('signup' | 'signin'). The dialog (Sheet) traps focus, closes on Escape,
 * the backdrop or ×, and returns focus to the button that opened it.
 *
 * Always opens the form, including when this browser already has a session. "Get started"
 * is the way into an account; the live demo is a separate link.
 */
export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);

  const open = useCallback((next: AuthMode) => {
    setMode(next);
  }, []);

  const api = useMemo(() => ({ open }), [open]);
  const close = useCallback(() => setMode(null), []);

  return (
    <AuthDialogContext.Provider value={api}>
      {children}
      {mode ? (
        <Sheet onClose={close} label={authTitle(mode)} size="md">
          <div className="relative overflow-y-auto px-6 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-6 sm:px-12 sm:pb-11 sm:pt-11">
            <div className="absolute right-3 top-3 sm:right-4 sm:top-4">
              <SheetCloseButton onClick={close} />
            </div>
            <AuthPanel mode={mode} onModeChange={setMode} next={DEFAULT_AFTER_SIGN_IN} titleId="auth-dialog-title" />
          </div>
        </Sheet>
      ) : null}
    </AuthDialogContext.Provider>
  );
}

/** A button that opens the dialog in the given mode (usable from server components). */
export function AuthButton({
  mode,
  className,
  children,
}: {
  mode: AuthMode;
  className?: string;
  children: React.ReactNode;
}) {
  const dialog = useAuthDialog();
  if (!dialog) {
    // Outside the provider: fall back to the full-page sign-in.
    return (
      <a href={DEFAULT_AFTER_SIGN_IN} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={() => dialog.open(mode)} className={className} aria-haspopup="dialog">
      {children}
    </button>
  );
}

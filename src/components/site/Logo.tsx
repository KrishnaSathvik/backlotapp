import React, { useId } from 'react';
import { cx } from '../ui';

/** Brand mark: a midnight tile with an electric-blue play frame and a cantaloupe "record" dot. */
export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a gradient defined inside a hidden copy (e.g. the sidebar on phones) would not render.
  const gid = `cv-mark-${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 32 32" className={cx('h-8 w-8 shrink-0', className)} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5585ff" />
          <stop offset="1" stopColor="#0f3ae6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <rect x="7" y="8.5" width="18" height="15" rx="3.5" fill="none" stroke="#fff" strokeWidth="2.2" />
      <path d="M14 12.6 19.6 16 14 19.4Z" fill="#fff" />
      <circle cx="25" cy="8" r="3.6" fill="#ff9a5a" stroke="#fff" strokeWidth="1.6" />
    </svg>
  );
}

export function Logo({ className, hideWordmark = false }: { className?: string; hideWordmark?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <LogoMark />
      {hideWordmark ? null : (
        <span className="whitespace-nowrap font-display text-[17px] font-bold tracking-tight text-zinc-950 dark:text-white">
          Content Vault
        </span>
      )}
    </span>
  );
}

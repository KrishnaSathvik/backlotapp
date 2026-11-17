import Image from 'next/image';
import React from 'react';
import { cx } from '../ui';

/** Brand mark: the Backlot soundstage tile (public/brand/backlot-mark-*.png). */
export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/backlot-mark-512.png"
      alt=""
      width={64}
      height={64}
      aria-hidden="true"
      className={cx('h-8 w-8 shrink-0 select-none', className)}
      draggable={false}
    />
  );
}

export function Logo({ className, hideWordmark = false }: { className?: string; hideWordmark?: boolean }) {
  return (
    <span className={cx('flex items-center gap-2.5', className)}>
      <LogoMark />
      {hideWordmark ? null : (
        <span className="whitespace-nowrap font-display text-[17px] font-bold tracking-tight text-zinc-950 dark:text-white">
          Backlot
        </span>
      )}
    </span>
  );
}

import Image from 'next/image';
import React from 'react';
import { cx } from '@/src/lib/cx';

/**
 * Slate, the Backlot AI mascot (public/brand/slate-*.png).
 * Sits on a soft light chip so the black clapperboard stays visible in dark mode.
 */
export function SlateAvatar({
  size = 28,
  className,
  chip = true,
  thinking = false,
}: {
  size?: number;
  className?: string;
  chip?: boolean;
  thinking?: boolean;
}) {
  const src = size > 96 ? '/brand/slate-512.png' : '/brand/slate-160.png';
  const img = (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      aria-hidden="true"
      draggable={false}
      className={cx('select-none', thinking && 'animate-slate-think')}
      style={{ width: chip ? size * 0.82 : size, height: chip ? size * 0.82 : size }}
    />
  );
  if (!chip)
    return (
      <span
        className={cx(
          // Rim light so the black board stays visible on midnight backgrounds.
          'inline-flex shrink-0 dark:[filter:drop-shadow(0_0_1px_rgba(255,255,255,0.9))_drop-shadow(0_0_18px_rgba(255,255,255,0.16))]',
          className
        )}
      >
        {img}
      </span>
    );
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-cantaloupe-50 ring-1 ring-cantaloupe-200/70 dark:bg-zinc-100 dark:ring-white/20',
        className
      )}
      style={{ width: size, height: size }}
    >
      {img}
    </span>
  );
}

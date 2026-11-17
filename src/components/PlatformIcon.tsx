import React, { useId } from 'react';
import { Shapes } from 'lucide-react';
import type { PlatformKey } from '@/src/lib/content-logic';
import { cx } from './ui';

// TikTok note glyph (24×24).
const TIKTOK_NOTE =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

/** Small brand mark for a platform. */
export function PlatformIcon({ platform, size = 16, className }: { platform: PlatformKey; size?: number; className?: string }) {
  const gid = `ig-${useId().replace(/:/g, '')}`;
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, className: cx('shrink-0', className) } as const;

  const igGradient = (
    <defs>
      <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stopColor="#FEDA75" />
        <stop offset="0.3" stopColor="#FA7E1E" />
        <stop offset="0.6" stopColor="#D62976" />
        <stop offset="0.85" stopColor="#962FBF" />
        <stop offset="1" stopColor="#4F5BD5" />
      </linearGradient>
    </defs>
  );

  switch (platform) {
    // Same brand mark for every format of a platform; the label says which format.
    case 'youtube_long':
    case 'youtube_shorts':
      return (
        <svg {...common}>
          <rect x="0.5" y="4" width="23" height="16" rx="4.5" fill="#FF0000" />
          <path d="M9.75 8.4 15.9 12l-6.15 3.6Z" fill="#fff" />
        </svg>
      );
    case 'instagram_reel':
    case 'instagram_carousel':
      return (
        <svg {...common}>
          {igGradient}
          <rect width="24" height="24" rx="6.5" fill={`url(#${gid})`} />
          <rect x="5" y="5" width="14" height="14" rx="4.2" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="#fff" strokeWidth="1.7" />
          <circle cx="16.1" cy="7.9" r="1" fill="#fff" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6.5" fill="#000" />
          <g transform="translate(5.2 4.6) scale(0.6)">
            <path d={TIKTOK_NOTE} fill="#25F4EE" transform="translate(-1 -1)" />
            <path d={TIKTOK_NOTE} fill="#FE2C55" transform="translate(1 1)" />
            <path d={TIKTOK_NOTE} fill="#fff" />
          </g>
        </svg>
      );
    default:
      return (
        <span
          className={cx('inline-flex shrink-0 items-center justify-center rounded-[28%] bg-zinc-800 text-white dark:bg-zinc-600', className)}
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <Shapes style={{ width: size * 0.62, height: size * 0.62 }} />
        </span>
      );
  }
}

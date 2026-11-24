import React, { useId } from 'react';
import { Shapes } from 'lucide-react';
import type { PlatformKey } from '@/src/lib/content-logic';
import { cx } from './ui';

// TikTok note glyph (24×24).
const TIKTOK_NOTE =
  'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z';

/** Small platform mark. Channels pass `colored` for the brand mark; everywhere else it stays one colour. */
export function PlatformIcon({
  platform,
  size = 16,
  className,
  colored = false,
}: {
  platform: PlatformKey;
  size?: number;
  className?: string;
  /** Brand colours. Used on channels. */
  colored?: boolean;
}) {
  const gid = `ig-${useId().replace(/:/g, '')}`;
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    'aria-hidden': true as const,
    className: cx('shrink-0', colored ? null : 'text-current', className),
  };

  if (colored) return <BrandIcon platform={platform} size={size} className={className} common={common} gid={gid} />;
  return <MutedIcon platform={platform} size={size} className={className} common={common} />;
}

function MutedIcon({
  platform,
  size,
  className,
  common,
}: {
  platform: PlatformKey;
  size: number;
  className?: string;
  common: { width: number; height: number; viewBox: string; 'aria-hidden': true; className: string };
}) {
  switch (platform) {
    case 'youtube_long':
    case 'youtube_shorts':
      return (
        <svg {...common} fill="none">
          <rect x="1.5" y="5" width="21" height="14" rx="4" stroke="currentColor" strokeWidth="1.7" />
          <path d="M10.2 9.2 15.2 12l-5 2.8Z" fill="currentColor" />
        </svg>
      );
    case 'instagram_reel':
    case 'instagram_carousel':
      return (
        <svg {...common} fill="none">
          <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="3.6" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="16.6" cy="7.4" r="1" fill="currentColor" />
        </svg>
      );
    case 'tiktok':
      return (
        <svg {...common} fill="currentColor">
          <path d={TIKTOK_NOTE} />
        </svg>
      );
    case 'linkedin':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="7.4" cy="8" r="0.9" fill="currentColor" stroke="none" />
          <path d="M7.4 11.1v5.2M11.2 16.3v-3.1c0-1.2.7-1.9 1.7-1.9s1.6.7 1.6 1.9v3.1M11.2 11.1v5.2" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <path d="M13.2 17.5v-3.6h1.2l.2-1.5h-1.4v-.9c0-.4.1-.7.7-.7h.7V9.4c-.2 0-.7-.1-1.2-.1-1.2 0-2 .7-2 2v1.1H10v1.5h1.2v3.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'other':
      return (
        <span
          className={cx('inline-flex shrink-0 items-center justify-center text-current', className)}
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <Shapes style={{ width: size * 0.72, height: size * 0.72 }} />
        </span>
      );
    default: {
      const exhaustive: never = platform;
      return exhaustive;
    }
  }
}

function BrandIcon({
  platform,
  size,
  className,
  common,
  gid,
}: {
  platform: PlatformKey;
  size: number;
  className?: string;
  common: { width: number; height: number; viewBox: string; 'aria-hidden': true; className: string };
  gid: string;
}) {
  switch (platform) {
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
          <defs>
            <linearGradient id={gid} x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#FEDA75" />
              <stop offset="0.3" stopColor="#FA7E1E" />
              <stop offset="0.6" stopColor="#D62976" />
              <stop offset="0.85" stopColor="#962FBF" />
              <stop offset="1" stopColor="#4F5BD5" />
            </linearGradient>
          </defs>
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
    case 'linkedin':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="5" fill="#0A66C2" />
          <rect x="5.1" y="9.3" width="2.5" height="8" fill="#fff" />
          <circle cx="6.35" cy="6.6" r="1.35" fill="#fff" />
          <path d="M10.4 9.3h2.4v1.1c.55-.8 1.45-1.35 2.7-1.35 2.15 0 3.15 1.35 3.15 3.6v4.65h-2.5v-4.1c0-1.1-.35-1.85-1.3-1.85-.9 0-1.4.6-1.65 1.25-.08.2-.1.5-.1.8v3.9h-2.5V9.3Z" fill="#fff" />
        </svg>
      );
    case 'facebook':
      return (
        <svg {...common}>
          <rect width="24" height="24" rx="6" fill="#1877F2" />
          <path d="M13.4 19.2v-5.4h1.8l.3-2.1h-2.1V10.4c0-.6.2-1.1 1-1.1h1.1V7.5c-.2 0-.9-.1-1.7-.1-1.7 0-2.8 1-2.8 2.9v1.4H9.2v2.1h1.8v5.4h2.4Z" fill="#fff" />
        </svg>
      );
    case 'other':
      return (
        <span
          className={cx('inline-flex shrink-0 items-center justify-center rounded-[28%] bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-950', className)}
          style={{ width: size, height: size }}
          aria-hidden="true"
        >
          <Shapes style={{ width: size * 0.62, height: size * 0.62 }} />
        </span>
      );
    default: {
      const exhaustive: never = platform;
      return exhaustive;
    }
  }
}

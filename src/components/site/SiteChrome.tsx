'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { ThemeToggle } from '../ThemeToggle';
import { cx } from '../ui';
import { Logo } from './Logo';

/** Landing / sign-in header: logo and theme switch. */
export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={cx(
        'sticky top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-300',
        scrolled
          ? 'border-b border-zinc-200/70 bg-white/90 shadow-[0_1px_20px_-12px_rgba(10,20,60,0.25)] backdrop-blur-xl dark:border-zinc-800/70 dark:bg-zinc-950/90'
          : 'border-b border-transparent'
      )}
    >
      <a
        href="#main"
        className="sr-only rounded-lg bg-electric-600 px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" aria-label="Backlot home" className="rounded-lg">
          <Logo />
        </Link>

        <div className="ml-auto flex items-center">
          <ThemeToggle className="hidden md:flex" />
          <ThemeToggle compact className="md:hidden" />
        </div>
      </div>
    </header>
  );
}

const FOOTER_LINKS: Array<[href: string, label: string]> = [
  ['/slate', 'Slate'],
  ['/support', 'Help'],
  ['/privacy', 'Privacy'],
  ['/terms', 'Terms'],
];

/** Minimal footer: brand on the left, public pages and copyright on the right. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-zinc-200/80 dark:border-zinc-800/80">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 pb-[calc(2rem+env(safe-area-inset-bottom))] text-center sm:flex-row sm:px-6 sm:text-left">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden text-sm text-zinc-500 md:inline dark:text-zinc-400">· Every post, one backlot.</span>
        </div>
        <div className="flex flex-col items-center gap-3 text-xs text-zinc-600 sm:flex-row sm:gap-5 dark:text-zinc-400">
          <nav aria-label="Footer">
            <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
              {FOOTER_LINKS.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="rounded underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <p>© {year} Backlot. Your content stays yours.</p>
        </div>
      </div>
    </footer>
  );
}

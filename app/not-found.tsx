import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicPage } from '@/src/components/site/PublicPage';

// Served with HTTP 404 for any unknown URL; Next.js adds the noindex tag itself.
export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <PublicPage>
      <p className="text-sm font-medium text-electric-700 dark:text-electric-400">404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">This page isn’t on the backlot.</h1>
      <p className="mt-4 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">
        The link may be old or mistyped. Try the <Link className="font-medium text-electric-700 underline underline-offset-2 dark:text-electric-400" href="/">home page</Link> or{' '}
        <Link className="font-medium text-electric-700 underline underline-offset-2 dark:text-electric-400" href="/support">Help &amp; support</Link>.
      </p>
    </PublicPage>
  );
}

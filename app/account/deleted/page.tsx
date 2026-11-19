import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/src/components/site/SiteChrome';
import { DeletionStatus } from '@/src/components/DeletionStatus';
import { NOINDEX } from '@/src/lib/seo';

export const metadata: Metadata = {
  title: { absolute: 'Account deletion · Backlot' },
  robots: NOINDEX,
  // Browsers never send the fragment (where the status token is); this also keeps the fact that
  // someone visited this page out of Referer headers for links followed from it.
  referrer: 'no-referrer',
};

export default function AccountDeletedPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-20 pt-10 sm:px-6">
        <DeletionStatus />
      </main>
      <SiteFooter />
    </div>
  );
}

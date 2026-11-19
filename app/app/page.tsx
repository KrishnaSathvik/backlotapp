import type { Metadata } from 'next';
import { ContentVaultApp } from '@/src/components/ContentVaultApp';
import { NOINDEX } from '@/src/lib/seo';

// The signed-in workspace and the demo: never indexed (also sent as an X-Robots-Tag header).
export const metadata: Metadata = {
  title: { absolute: 'Backlot' },
  robots: NOINDEX,
};

export default function AppPage() {
  return <ContentVaultApp />;
}

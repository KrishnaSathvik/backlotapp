import type { Metadata } from 'next';
import { ContentVaultApp } from '@/src/components/ContentVaultApp';

export const metadata: Metadata = {
  title: 'Content Vault',
};

export default function AppPage() {
  return <ContentVaultApp />;
}

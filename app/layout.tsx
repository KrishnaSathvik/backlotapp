import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'Content Vault — Creator Content Tracker',
  description:
    'Private creator content vault and PWA for YouTube videos, Shorts, Instagram Reels, carousels, captions, tags, and ideas.',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Content Vault',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Content Vault — Creator Content Tracker',
    description:
      'Organize YouTube videos, Shorts, Reels, carousels, captions, tags, and ideas in one private PWA.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Content Vault — Creator Content Tracker',
    description:
      'Organize YouTube videos, Shorts, Reels, carousels, captions, tags, and ideas in one private PWA.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

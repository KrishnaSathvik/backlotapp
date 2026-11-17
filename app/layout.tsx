import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plus-jakarta',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-bricolage',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-jetbrains-mono',
});

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#07080c' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
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
      className={`${plusJakarta.variable} ${bricolage.variable} ${jetbrainsMono.variable}`}
    >
      <body suppressHydrationWarning>
        {/* Apply the saved theme before first paint to avoid a light/dark flash. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('slatevault_theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark')}catch(e){}`}
        </Script>
        {children}
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import Script from 'next/script';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, siteUrl } from '@/src/lib/site';
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

// Metadata depends on SITE_URL and the privacy contact, which are set per deployment at runtime,
// not at build time, so pages are rendered per request.
export const dynamic = 'force-dynamic';

export function generateMetadata(): Metadata {
  const site = siteUrl();
  const title = `${SITE_NAME} — ${SITE_TAGLINE}`;
  return {
    ...(site ? { metadataBase: new URL(site) } : {}),
    title: { default: title, template: `%s · ${SITE_NAME}` },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: SITE_NAME,
    },
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      ],
      apple: '/apple-touch-icon.png',
    },
    openGraph: { type: 'website', siteName: SITE_NAME, title, description: SITE_DESCRIPTION, locale: 'en_US' },
    twitter: { card: 'summary', title, description: SITE_DESCRIPTION },
  };
}

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
        {/* Without JavaScript, show scroll-reveal content instead of leaving it transparent. */}
        <noscript>
          <style>{'[data-reveal]{opacity:1!important;transform:none!important}'}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}

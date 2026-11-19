import Link from 'next/link';
import React from 'react';
import { contactEmail } from '@/src/lib/site';
import { SiteFooter, SiteHeader } from './SiteChrome';

/** Shell for public text pages (Slate, Support, Privacy, Terms): header, one <main>, footer. */
export function PublicPage({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <SiteHeader />
      <main id="main" tabIndex={-1} className={`mx-auto w-full flex-1 px-4 pb-20 pt-10 outline-none sm:px-6 ${wide ? 'max-w-4xl' : 'max-w-3xl'}`}>
        {children}
        <p className="mt-12 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">
            ← Back to Backlot
          </Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

export function PageIntro({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header>
      {eyebrow ? <p className="text-sm font-medium text-electric-700 dark:text-electric-400">{eyebrow}</p> : null}
      <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      {children ? <div className="mt-4 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">{children}</div> : null}
    </header>
  );
}

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export function Toc({ items }: { items: Array<[id: string, label: string]> }) {
  return (
    <nav aria-label="On this page" className="mt-8 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-zinc-700 underline-offset-2 hover:text-electric-700 hover:underline dark:text-zinc-300 dark:hover:text-electric-400">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const linkClass = 'font-medium text-electric-700 underline underline-offset-2 dark:text-electric-400';

/** The published contact address (PRIVACY_CONTACT_EMAIL), or neutral wording until it's set. */
export function ContactLink({ fallback = 'the contact address listed on this page once it is published' }: { fallback?: string }) {
  const email = contactEmail();
  return email ? (
    <a className={linkClass} href={`mailto:${email}`}>
      {email}
    </a>
  ) : (
    <span className="font-medium">{fallback}</span>
  );
}

export function A({ href, children }: { href: string; children: React.ReactNode }) {
  const external = /^https?:/.test(href);
  return external ? (
    <a className={linkClass} href={href} rel="noopener noreferrer" target="_blank">
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  ) : (
    <Link className={linkClass} href={href}>
      {children}
    </Link>
  );
}

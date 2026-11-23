import Link from 'next/link';
import React from 'react';
import { contactEmail } from '@/src/lib/site';
import { AuthDialogProvider } from '../auth/AuthDialog';
import { cx } from '@/src/lib/cx';
import { SiteFooter, SiteHeader } from './SiteChrome';

/**
 * Shell for public pages (Slate, Help, Privacy, Terms): header, one <main>, footer, the auth
 * dialog, and a soft brand wash behind the top of the page. Children set their own widths.
 */
export function PublicPage({ children, wash = true }: { children: React.ReactNode; wash?: boolean }) {
  return (
    <AuthDialogProvider>
      <div className="relative flex min-h-dvh flex-col overflow-x-clip bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
        {wash ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[460px] overflow-hidden">
            <div className="absolute -left-32 -top-44 h-80 w-[560px] rounded-full bg-electric-400/12 blur-3xl dark:bg-electric-600/12" />
            <div className="absolute -top-52 right-0 h-72 w-96 rounded-full bg-cantaloupe-300/14 blur-3xl dark:bg-cantaloupe-500/8" />
          </div>
        ) : null}
        <SiteHeader />
        <main id="main" tabIndex={-1} className="relative w-full flex-1 pb-24 outline-none">
          {children}
        </main>
        <SiteFooter />
      </div>
    </AuthDialogProvider>
  );
}

export function Container({ children, className, width = 'wide' }: { children: React.ReactNode; className?: string; width?: 'wide' | 'text' }) {
  return <div className={cx('mx-auto w-full px-4 sm:px-6', width === 'wide' ? 'max-w-6xl' : 'max-w-3xl', className)}>{children}</div>;
}

export function Eyebrow({ children, tone = 'electric' }: { children: React.ReactNode; tone?: 'electric' | 'cantaloupe' }) {
  return (
    <p
      className={cx(
        'text-xs font-semibold uppercase tracking-[0.18em]',
        tone === 'electric' ? 'text-electric-700 dark:text-electric-400' : 'text-cantaloupe-600 dark:text-cantaloupe-400'
      )}
    >
      {children}
    </p>
  );
}

/** Top of a product page (Slate, Help): eyebrow, big title, intro, optional actions. */
export function PageHero({
  eyebrow,
  title,
  children,
  actions,
  aside,
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Container className={cx('pt-6 sm:pt-10', aside ? 'grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]' : '')}>
      <header className={cx('animate-rise', !aside && 'max-w-3xl')}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1
          className={cx(
            'font-display mt-4 text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-balance sm:text-6xl',
            aside ? 'lg:text-[52px]' : null
          )}
        >
          {title}
        </h1>
        {children ? <div className="mt-6 max-w-2xl text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-400">{children}</div> : null}
        {actions ? <div className="mt-8 flex flex-col gap-3 sm:flex-row">{actions}</div> : null}
      </header>
      {aside ? <div className="animate-rise [animation-delay:120ms]">{aside}</div> : null}
    </Container>
  );
}

/** A titled block of a product page. */
export function Block({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx('scroll-mt-24', className)}>
      <Container>
        <div className="max-w-2xl">
          {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
          <h2 id={`${id}-title`} className={cx('font-display text-3xl font-bold leading-[1.08] tracking-tight text-balance sm:text-4xl', eyebrow && 'mt-3')}>
            {title}
          </h2>
          {intro ? <div className="mt-4 text-[15px] leading-relaxed text-zinc-600 sm:text-base dark:text-zinc-400">{intro}</div> : null}
        </div>
        <div className="mt-10">{children}</div>
      </Container>
    </section>
  );
}

const ACCENTS = {
  electric: 'bg-electric-50 text-electric-600 dark:bg-electric-950/60 dark:text-electric-400',
  cantaloupe: 'bg-cantaloupe-50 text-cantaloupe-600 dark:bg-cantaloupe-950/60 dark:text-cantaloupe-400',
};

/** Icon + title + text card used on product pages. */
export function InfoCard({
  icon: Icon,
  title,
  children,
  accent = 'electric',
  href,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  accent?: keyof typeof ACCENTS;
  href?: string;
}) {
  const body = (
    <>
      <span className={cx('flex h-11 w-11 items-center justify-center rounded-2xl', ACCENTS[accent])}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <h3 className="mt-5 font-display text-lg font-bold tracking-tight">{title}</h3>
      <div className="mt-2 text-[14.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
    </>
  );
  const cls =
    'block h-full rounded-3xl border border-zinc-200/80 bg-white p-6 transition-all duration-300 dark:border-zinc-800 dark:bg-zinc-900/50';
  return href ? (
    <a href={href} className={cx(cls, 'hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-xl hover:shadow-zinc-950/5 dark:hover:border-zinc-700')}>
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** A question and its answer inside a Section. */
export function FaqItem({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="pt-2">
      <h3 className="font-semibold text-zinc-950 dark:text-zinc-50">{q}</h3>
      <div className="mt-1 space-y-3">{children}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Document pages (Help, Privacy, Terms)                             */
/* ------------------------------------------------------------------ */

/**
 * Help, Privacy and Terms: one document style. A restrained title block, then plain sections.
 */
export function DocLayout({
  eyebrow = 'Legal',
  title,
  effective,
  intro,
  children,
}: {
  eyebrow?: string;
  title: string;
  effective?: string;
  intro: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Container className="pt-6 sm:pt-10">
      <header className="max-w-3xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="font-display mt-3 text-4xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
        {effective ? <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">Effective {effective}</p> : null}
        <div className="mt-6 text-base leading-relaxed text-zinc-700 dark:text-zinc-300">{intro}</div>
      </header>

      <div className="mt-10 max-w-3xl space-y-12 lg:mt-12">{children}</div>
    </Container>
  );
}

/** A section of prose (legal pages and the plainer parts of product pages). */
export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24 space-y-3">
      <h2 id={`${id}-title`} className="font-display text-[22px] font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
        {title}
      </h2>
      <div className="space-y-3 text-[15.5px] leading-7 text-zinc-700 dark:text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] dark:[&_code]:bg-zinc-800 [&_li]:pl-1 [&_strong]:text-zinc-900 dark:[&_strong]:text-zinc-100">
        {children}
      </div>
    </section>
  );
}

/** Callout for owner/legal notes or important caveats inside a document. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-cantaloupe-200 bg-cantaloupe-50/60 px-4 py-3 text-[14.5px] leading-relaxed text-zinc-700 dark:border-cantaloupe-900/50 dark:bg-cantaloupe-950/20 dark:text-zinc-300">
      {children}
    </div>
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

/** Standard CTA button styles for public pages. */
export const ctaStyles = {
  primary:
    'group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-electric-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-electric-600/25 transition-all hover:-translate-y-0.5 hover:bg-electric-500',
  secondary:
    'inline-flex h-12 items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-6 text-[15px] font-semibold text-zinc-900 transition-all hover:-translate-y-0.5 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:border-zinc-500',
};

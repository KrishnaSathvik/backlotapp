'use client';

import React, { useEffect } from 'react';
import {
  ArrowRight,
  Briefcase,
  CalendarClock,
  CalendarDays,
  Check,
  Clapperboard,
  Copy,
  Images,
  Layers,
  Lightbulb,
  Plus,
  Search,
  Smartphone,
  Tv,
} from 'lucide-react';
import { SlateAvatar } from '../SlateAvatar';
import { cx } from '../ui';
import { AuthButton, AuthDialogProvider } from '../auth/AuthDialog';
import { HeroShowcase } from './Showcase';
import { SiteFooter, SiteHeader } from './SiteChrome';
import { SlateConversation } from './SlateDemo';

const MARQUEE = [
  'YouTube Long',
  'Shorts',
  'Instagram Reels',
  'TikTok',
  'Instagram posts',
  'LinkedIn',
  'Facebook',
  'Thumbnails',
  'Captions',
  'Hashtags',
  'Hooks',
  'Scripts',
  'Ideas',
  'Post dates',
  'Live links',
];

const FEATURES: Array<{
  key: string;
  icon: React.ElementType;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  accent: 'electric' | 'cantaloupe';
}> = [
  {
    key: 'library',
    icon: Layers,
    eyebrow: 'Library',
    title: 'Every post, with everything it needs.',
    body: 'Each video’s files, caption, hashtags and stage live together. Filter by channel or stage to find anything fast.',
    points: ['YouTube, Shorts, Reels, TikTok, Instagram, LinkedIn and Facebook', 'Planned, Made and Posted', 'A channel for every account you run'],
    accent: 'electric',
  },
  {
    key: 'ideas',
    icon: Lightbulb,
    eyebrow: 'Ideas',
    title: 'Catch ideas before they slip away.',
    body: 'Save a link, a screenshot or a quick note the moment inspiration hits. When an idea is ready, turn it into a post and everything comes with it.',
    points: ['Save YouTube, Instagram, LinkedIn and Facebook links', 'Attach screenshots and notes', 'Turning it into a post carries everything over'],
    accent: 'electric',
  },
  {
    key: 'detail',
    icon: Copy,
    eyebrow: 'Post details',
    title: 'Everything you need at posting time.',
    body: 'Open a post to copy its caption or hashtags, download the cover and video, and check its notes, references and target date.',
    points: ['One-tap copy for caption and tags', 'Download one file or everything as a .zip', 'Add the live link once it’s posted'],
    accent: 'cantaloupe',
  },
  {
    key: 'calendar',
    icon: CalendarDays,
    eyebrow: 'Calendar',
    title: 'See what’s planned and what’s posted.',
    body: 'Posts land on their target or posted date, so gaps and pile-ups are obvious before they happen.',
    points: ['Month view on phone and desktop', 'Filter by channel', 'Open any post from its day'],
    accent: 'cantaloupe',
  },
];

const STEPS = [
  {
    n: '01',
    title: 'Capture',
    body: 'Drop a link, a screenshot or a half-formed thought into Ideas the second it hits you, on your phone or laptop.',
    icon: Lightbulb,
  },
  {
    n: '02',
    title: 'Organize & prepare',
    body: 'Turn the idea into a post. Attach the cover, video and slides, write the caption, and move it through its stages until it’s ready.',
    icon: Clapperboard,
  },
  {
    n: '03',
    title: 'Track & reuse',
    body: 'Post it on the platform as usual, then mark it Posted with the live link. Months later, find it and reuse what worked.',
    icon: Search,
  },
];

const PERSONAS = [
  {
    icon: Tv,
    title: 'YouTubers',
    blurb: 'Long-form videos with thumbnails, chapters and descriptions to keep straight.',
    uses: ['Store thumbnail options next to the final cut', 'Keep descriptions and tags ready to paste', 'Track every video from script to upload'],
    accent: 'electric',
  },
  {
    icon: Smartphone,
    title: 'Shorts, Reels & TikTok',
    blurb: 'High volume, vertical, fast. You post often and can’t lose a hook.',
    uses: ['Batch ideas from saved reels and links', 'Reuse captions that worked', 'See what’s still planned at a glance'],
    accent: 'cantaloupe',
  },
  {
    icon: Images,
    title: 'Carousel designers',
    blurb: 'Photographers and educators building multi-slide Instagram posts.',
    uses: ['Keep every slide in order with the caption', 'Save reference screenshots for layouts', 'Copy hashtags in one tap'],
    accent: 'electric',
  },
  {
    icon: Briefcase,
    title: 'LinkedIn & Facebook',
    blurb: 'Posts and updates you write before you publish them.',
    uses: ['Draft the post with its images and notes', 'Keep a date on it until you publish', 'Copy it out when it’s time to post'],
    accent: 'electric',
  },
  {
    icon: Layers,
    title: 'Multi-channel creators',
    blurb: 'A main channel, a clips channel, a side project. One backlot for all of it.',
    uses: ['Filter by channel', 'One library across every account', 'Ask Slate to plan the week'],
    accent: 'cantaloupe',
  },
  {
    icon: CalendarDays,
    title: 'Weekly planners',
    blurb: 'You pick the day before you publish, and you want to see the month.',
    uses: [
      'Put a date on a post while it’s still planned',
      'See gaps and pile-ups before the week starts',
      'Move a post to another day when plans change',
    ],
    accent: 'electric',
  },
];

export interface LandingLimits {
  /** e.g. "30 MB" */
  image: string;
  video: string;
  storage: string;
}

function faq(limits: LandingLimits) {
  return [
    {
      q: 'What is Backlot?',
      a: 'A private workspace for creators. You keep each post’s files, caption, hashtags, notes and stage in one place, save ideas as they come, and track what’s planned and what’s posted.',
    },
    {
      q: 'Does Backlot post to my social accounts?',
      a: 'No. Backlot is where you prepare, organize and track your content. It doesn’t connect to YouTube, Instagram, TikTok, LinkedIn or Facebook and never publishes for you. When you’ve posted, mark the post Posted and add its live link.',
    },
    {
      q: 'Which platforms’ content can I organize?',
      a: 'YouTube videos, YouTube Shorts, Instagram Reels, TikTok, Instagram posts, LinkedIn and Facebook, plus an “Other” type for anything else you make.',
    },
    {
      q: 'What files can I upload?',
      a: `Images (JPEG, PNG, WebP, GIF, AVIF and HEIC) up to ${limits.image} each, and videos (MP4, MOV, WebM, M4V and MKV) up to ${limits.video} each. Each account currently has ${limits.storage} of storage.`,
    },
    {
      q: 'Who can see my content?',
      a: 'Only you. Your workspace is private to your account, and uploaded files are served only to the account that uploaded them.',
    },
    {
      q: 'How does Slate work, and what can it access?',
      a: 'Slate is the AI creative partner built into Backlot. It works from your own posts, ideas, channels and saved preferences, and only yours. It sees an image only when you pick one, and never your videos. It suggests changes; nothing happens until you apply them.',
    },
    {
      q: 'Can I try it without signing up?',
      a: 'Yes. Choose “Try the live demo”. It runs in your browser and saves nothing. Create an account with an email and password when you want to keep your own.',
    },
    {
      q: 'Does it work on my phone?',
      a: 'Yes. It’s built mobile-first, and you can add it to your home screen on iPhone or Android so it opens like an app. Saving, uploading and Slate need an internet connection.',
    },
  ];
}

export function Landing({ limits }: { limits: LandingLimits }) {
  // Scroll-reveal for every [data-reveal] element on the page.
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.setAttribute('data-shown', ''));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.setAttribute('data-shown', '');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <AuthDialogProvider>
    <div className="relative min-h-dvh overflow-x-clip">
      <SiteHeader />

      <main id="main" tabIndex={-1} className="outline-none">
        {/* ---------------- Hero ---------------- */}
        <section className="relative">
          <div className="mx-auto max-w-6xl px-4 pb-20 pt-10 text-center sm:px-6 sm:pt-16">
            <a
              href="/slate"
              className="group inline-flex animate-rise items-center gap-2 rounded-full border border-zinc-200 bg-white/70 py-1 pl-1 pr-3 text-[12.5px] font-medium text-zinc-600 shadow-xs backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70 dark:text-zinc-300"
            >
              <span className="rounded-full bg-cantaloupe-500 px-2 py-0.5 text-[11px] font-bold text-white">New</span>
              Meet Slate, your AI creative partner
              <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </a>

            <h1 className="font-display mx-auto mt-7 max-w-4xl animate-rise text-[44px] font-extrabold leading-[0.98] tracking-[-0.04em] text-balance [animation-delay:80ms] sm:text-7xl lg:text-[80px]">
              Every video, reel & caption.{' '}
              <span className="relative inline-block whitespace-nowrap text-electric-600 dark:text-electric-400">
                One backlot.
                <svg
                  aria-hidden="true"
                  viewBox="0 0 300 20"
                  preserveAspectRatio="none"
                  className="absolute -bottom-2 left-0 h-3 w-full sm:-bottom-3 sm:h-4"
                >
                  <path
                    d="M3 14 C 60 4, 120 4, 170 10 S 260 16, 297 6"
                    fill="none"
                    stroke="var(--color-cantaloupe-400)"
                    strokeWidth="6"
                    strokeLinecap="round"
                    pathLength={1}
                    strokeDasharray="1"
                    className="animate-draw [animation-delay:700ms]"
                  />
                </svg>
              </span>
            </h1>

            <p className="mx-auto mt-7 max-w-xl animate-rise text-base leading-relaxed text-zinc-600 [animation-delay:160ms] sm:text-lg dark:text-zinc-400">
              Backlot is the private workspace for creators. Keep covers, cuts, slides, captions and ideas together, and track every
              post from first idea to posted.
            </p>

            <div className="mt-9 flex animate-rise flex-col items-center justify-center gap-3 [animation-delay:240ms] sm:flex-row">
              <a
                href="/app?autostart=1"
                className="group flex h-12 w-full items-center justify-center gap-2 rounded-full bg-electric-600 px-6 text-[15px] font-semibold text-white shadow-lg shadow-electric-600/30 transition-all hover:-translate-y-0.5 hover:bg-electric-500 hover:shadow-xl hover:shadow-electric-600/30 sm:w-auto"
              >
                Try the live demo
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </a>
              <AuthButton
                mode="signup"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-zinc-300 bg-white px-6 text-[15px] font-semibold text-zinc-900 transition-all hover:-translate-y-0.5 hover:border-zinc-400 sm:w-auto dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:hover:border-zinc-500"
              >
                Get started
              </AuthButton>
            </div>

            <div className="mt-12 animate-rise [animation-delay:380ms] sm:mt-14">
              <HeroShowcase />
            </div>
          </div>
        </section>

        {/* ---------------- Marquee ---------------- */}
        <section aria-label="What you can store" className="border-y border-zinc-200/80 bg-zinc-50/60 py-5 dark:border-zinc-800/80 dark:bg-zinc-900/30">
          <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_12%,black_88%,transparent)]">
            <div className="flex w-max animate-marquee gap-10 pr-10 hover:[animation-play-state:paused]">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span
                  key={`${m}-${i}`}
                  aria-hidden={i >= MARQUEE.length}
                  className="flex items-center gap-10 whitespace-nowrap font-display text-xl font-semibold tracking-tight text-zinc-500 dark:text-zinc-400"
                >
                  {m}
                  <span className={cx('h-1.5 w-1.5 rounded-full', i % 2 ? 'bg-cantaloupe-400' : 'bg-electric-500')} />
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Features (real screens) ---------------- */}
        <section id="features" className="scroll-mt-20 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Features"
              title="Built for the way creators actually work."
              body="No spreadsheets, no digging through your notes app. One place for the files, the words and the status of every post."
            />

            <div className="mt-14 grid gap-4 sm:mt-20 sm:gap-5 md:grid-cols-2">
              {FEATURES.map((f, i) => (
                <FeatureCard key={f.key} feature={f} delay={i * 80} />
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- Slate spotlight (light in light mode, midnight in dark) ---------------- */}
        <section id="studio" className="scroll-mt-20 px-4 sm:px-6">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[32px] px-6 py-16 sm:px-14 sm:py-20 grain bg-gradient-to-br from-white via-zinc-50 to-electric-50/60 text-zinc-950 ring-1 ring-zinc-200/80 shadow-[0_30px_80px_-40px_rgba(10,20,60,0.25)] dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-950 dark:text-white dark:ring-white/10 dark:shadow-none">
            <div aria-hidden="true" className="absolute -right-32 -top-32 h-96 w-96 animate-glow rounded-full bg-cantaloupe-300/30 blur-3xl dark:bg-cantaloupe-500/30" />
            <div aria-hidden="true" className="absolute -bottom-40 -left-24 h-96 w-96 animate-glow rounded-full bg-electric-300/30 blur-3xl [animation-delay:-3s] dark:bg-electric-600/40" />
            <div className="relative grid items-center gap-12 lg:grid-cols-2">
              <div data-reveal>
                <div className="flex items-center gap-4">
                  <SlateAvatar size={72} className="animate-float" />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cantaloupe-600 dark:text-cantaloupe-400">Meet Slate</p>
                </div>
                <h2 className="font-display mt-4 text-4xl font-bold leading-[1.02] sm:text-5xl">Your AI creative partner, who knows your whole backlot.</h2>
                <p className="mt-5 max-w-md text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Slate works from the posts, ideas and preferences you’ve already saved, so you never paste context into a chat. When it
                  suggests a change, nothing happens until you approve it.
                </p>
                <ul className="mt-7 grid gap-2.5 text-sm text-zinc-700 sm:grid-cols-2 dark:text-zinc-300">
                  {[
                    'Knows your own workspace',
                    'Writes and improves captions',
                    'Finds old posts and ideas',
                    'Suggests new ideas',
                    'Helps plan your week',
                    'Proposes changes you approve',
                  ].map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cantaloupe-100 dark:bg-white/10">
                        <Check className="h-3 w-3 text-cantaloupe-600 dark:text-cantaloupe-400" aria-hidden="true" />
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
                <a
                  href="/slate"
                  className="mt-7 inline-flex items-center gap-1.5 text-sm font-semibold text-electric-700 underline-offset-4 hover:underline dark:text-electric-400"
                >
                  How Slate works
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
              </div>

              <div data-reveal style={{ '--reveal-delay': '120ms' } as React.CSSProperties}>
                <SlateConversation />
              </div>
            </div>
          </div>
        </section>

        {/* ---------------- How it works ---------------- */}
        <section id="how" className="scroll-mt-20 py-24 sm:py-32">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="How it works"
              title="From first idea to posted, in one place."
              body="Backlot is where you prepare, organize and track your content. You still publish on each platform yourself; Backlot never posts for you."
            />
            <ol className="relative mt-16 grid gap-10 sm:grid-cols-3 sm:gap-6">
              <div
                aria-hidden="true"
                className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-zinc-300 to-transparent sm:block dark:via-zinc-700"
              />
              {STEPS.map((s, i) => (
                <li key={s.n} data-reveal style={{ '--reveal-delay': `${i * 120}ms` } as React.CSSProperties} className="relative">
                  <span
                    className={cx(
                      'relative flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg',
                      i === 1 ? 'bg-cantaloupe-500 shadow-cantaloupe-500/30' : 'bg-electric-600 shadow-electric-600/30'
                    )}
                  >
                    <s.icon className="h-6 w-6" aria-hidden="true" />
                  </span>
                  <p className="mt-6 font-mono text-xs font-medium text-zinc-400">{s.n}</p>
                  <h3 className="mt-1 font-display text-2xl font-bold tracking-tight">{s.title}</h3>
                  <p className="mt-2 max-w-xs text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------------- Who it's for ---------------- */}
        <section id="who" className="scroll-mt-20 border-t border-zinc-200/80 bg-zinc-50/60 py-24 sm:py-32 dark:border-zinc-800/80 dark:bg-zinc-900/20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <SectionHeading
              eyebrow="Who it’s for"
              title="Made for people who post, not people who manage."
              body="Solo creators and small studios who make the content themselves and are tired of losing it across apps."
            />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {PERSONAS.map((p, i) => (
                <article
                  key={p.title}
                  data-reveal
                  style={{ '--reveal-delay': `${i * 90}ms` } as React.CSSProperties}
                  className="group flex flex-col rounded-3xl border border-zinc-200 bg-white p-6 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                >
                  <span
                    className={cx(
                      'flex h-11 w-11 items-center justify-center rounded-xl transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110',
                      p.accent === 'electric'
                        ? 'bg-electric-50 text-electric-600 dark:bg-electric-950 dark:text-electric-400'
                        : 'bg-cantaloupe-50 text-cantaloupe-600 dark:bg-cantaloupe-950 dark:text-cantaloupe-400'
                    )}
                  >
                    <p.icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 font-display text-xl font-bold tracking-tight">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{p.blurb}</p>
                  <ul className="mt-5 space-y-2 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                    {p.uses.map((u) => (
                      <li key={u} className="flex gap-2 text-[13px] leading-snug text-zinc-700 dark:text-zinc-300">
                        <Check
                          className={cx(
                            'mt-0.5 h-3.5 w-3.5 shrink-0',
                            p.accent === 'electric' ? 'text-electric-500' : 'text-cantaloupe-500'
                          )}
                          aria-hidden="true"
                        />
                        {u}
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className="scroll-mt-20 py-24 sm:py-32">
          <div className="mx-auto grid max-w-6xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr]">
            <SectionHeading eyebrow="FAQ" title="Questions, answered." align="left" />
            <div className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {faq(limits).map((f) => (
                <details key={f.q} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg font-display text-lg font-semibold tracking-tight">
                    {f.q}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-zinc-200 transition-all duration-300 group-open:rotate-45 group-open:border-electric-500 group-open:bg-electric-500 group-open:text-white dark:border-zinc-800">
                      <Plus className="h-4 w-4" aria-hidden="true" />
                    </span>
                  </summary>
                  <p className="mt-3 max-w-xl animate-fade-in text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ---------------- CTA ---------------- */}
        <section className="px-4 pb-24 sm:px-6">
          <div
            data-reveal
            className="grain relative mx-auto max-w-6xl overflow-hidden rounded-[32px] bg-electric-600 px-6 py-16 text-center text-white sm:py-24"
          >
            <div aria-hidden="true" className="absolute -bottom-24 left-1/2 h-64 w-[640px] -translate-x-1/2 rounded-full bg-electric-300/40 blur-3xl" />
            <div className="relative">
              <CalendarClock className="mx-auto h-10 w-10 text-cantaloupe-200" aria-hidden="true" />
              <h2 className="font-display mx-auto mt-5 max-w-2xl text-4xl font-extrabold leading-[1.02] text-balance sm:text-6xl">
                Stop losing captions in your notes app.
              </h2>
              <p className="mx-auto mt-5 max-w-md text-[15px] text-electric-100">
                It’s already full of sample posts. Create your account when you’re ready to keep your own.
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="/app?autostart=1"
                  className="group flex h-12 w-full items-center justify-center gap-2 rounded-full bg-white px-6 text-[15px] font-semibold text-zinc-950 transition-all hover:-translate-y-0.5 hover:shadow-xl sm:w-auto"
                >
                  Try the live demo
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </a>
                <AuthButton
                  mode="signup"
                  className="flex h-12 w-full items-center justify-center rounded-full border border-white/40 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
                >
                  Create your account
                </AuthButton>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
    </AuthDialogProvider>
  );
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string;
  title: string;
  body?: string;
  align?: 'center' | 'left';
}) {
  return (
    <div data-reveal className={cx('max-w-2xl', align === 'center' && 'mx-auto text-center')}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-electric-600 dark:text-electric-400">{eyebrow}</p>
      <h2 className="font-display mt-3 text-4xl font-bold leading-[1.04] text-balance sm:text-5xl">{title}</h2>
      {body ? <p className="mt-4 text-base leading-relaxed text-zinc-600 sm:text-lg dark:text-zinc-400">{body}</p> : null}
    </div>
  );
}

function FeatureCard({ feature: f, delay }: { feature: (typeof FEATURES)[number]; delay: number }) {
  const electric = f.accent === 'electric';
  return (
    <div
      data-reveal
      style={{ '--reveal-delay': `${delay}ms` } as React.CSSProperties}
      className="group relative overflow-hidden rounded-3xl border border-zinc-200/80 bg-white p-6 transition-shadow hover:shadow-xl hover:shadow-zinc-950/5 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900/50"
    >
      <div
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl transition-opacity group-hover:opacity-100',
          electric ? 'bg-electric-400/15 dark:bg-electric-600/15' : 'bg-cantaloupe-300/20 dark:bg-cantaloupe-500/10'
        )}
      />
      <div
        className={cx(
          'flex h-11 w-11 items-center justify-center rounded-2xl',
          electric ? 'bg-electric-50 text-electric-600 dark:bg-electric-950/60 dark:text-electric-400' : 'bg-cantaloupe-50 text-cantaloupe-600 dark:bg-cantaloupe-950/60 dark:text-cantaloupe-400'
        )}
      >
        <f.icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p
        className={cx(
          'mt-5 text-xs font-semibold uppercase tracking-[0.18em]',
          electric ? 'text-electric-600 dark:text-electric-400' : 'text-cantaloupe-600 dark:text-cantaloupe-400'
        )}
      >
        {f.eyebrow}
      </p>
      <h3 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-balance sm:text-[26px]">{f.title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">{f.body}</p>
      <ul className="mt-5 space-y-2">
        {f.points.map((pt) => (
          <li key={pt} className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-300">
            <span
              className={cx(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                electric ? 'bg-electric-50 text-electric-600 dark:bg-electric-950 dark:text-electric-400' : 'bg-cantaloupe-50 text-cantaloupe-600 dark:bg-cantaloupe-950 dark:text-cantaloupe-400'
              )}
            >
              <Check className="h-3 w-3" aria-hidden="true" />
            </span>
            {pt}
          </li>
        ))}
      </ul>
    </div>
  );
}

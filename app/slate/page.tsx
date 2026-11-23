import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarRange,
  Hash,
  ImageIcon,
  PenLine,
  Repeat2,
  Search,
  ShieldCheck,
  Waypoints,
} from 'lucide-react';
import { AuthButton } from '@/src/components/auth/AuthDialog';
import { JsonLd } from '@/src/components/site/JsonLd';
import { A, Block, Container, ctaStyles, InfoCard, PageHero, PublicPage } from '@/src/components/site/PublicPage';
import { SlateConversation } from '@/src/components/site/SlateDemo';
import { SlateAvatar } from '@/src/components/SlateAvatar';
import { breadcrumbJsonLd, pageMetadata } from '@/src/lib/seo';

/**
 * What Slate, Backlot's AI creative partner, does and doesn't do. Every statement describes
 * implemented behavior (README "Slate (AI)"); update this page when Slate changes.
 */

export function generateMetadata(): Metadata {
  return pageMetadata({
    path: '/slate',
    title: 'Slate, your AI creative partner',
    description:
      'Slate is Backlot’s AI creative partner. It works from your own posts and ideas to write hooks, captions and plans, and suggests changes you approve.',
  });
}

const CAPABILITIES: Array<{ icon: React.ElementType; title: string; body: string; accent: 'electric' | 'cantaloupe' }> = [
  { icon: PenLine, title: 'Hooks and captions', body: 'Write hooks for a post, or rewrite a caption in the tone you’ve saved.', accent: 'electric' },
  { icon: Hash, title: 'Hashtags', body: 'Suggest sets that fit the post and your usual hashtag count.', accent: 'cantaloupe' },
  {
    icon: Search,
    title: 'Finding things',
    body: 'Search your posts and ideas by wording or by meaning, and cite the ones it used so you can open them.',
    accent: 'electric',
  },
  {
    icon: CalendarRange,
    title: 'Planning',
    body: 'Read your calendar (scheduled, overdue and undated work, open days, your posting rhythm) and propose a plan for the week.',
    accent: 'cantaloupe',
  },
  {
    icon: Waypoints,
    title: 'Continuity',
    body: 'Point out recurring topics, possible series, ideas that have been open a long time and posts that have stalled.',
    accent: 'electric',
  },
  {
    icon: Repeat2,
    title: 'Repurposing',
    body: 'Adapt one post or idea into up to five drafts for other platforms, each linked back to its source.',
    accent: 'cantaloupe',
  },
  {
    icon: ImageIcon,
    title: 'Images, when you choose',
    body: 'Look at one cover, slide or idea screenshot you pick with “Show Slate an image”.',
    accent: 'electric',
  },
];

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
          <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-electric-500" aria-hidden="true" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function SlatePage() {
  return (
    <PublicPage>
      <JsonLd data={breadcrumbJsonLd('/slate')} />

      <PageHero
        eyebrow="Slate"
        title={
          <>
            Your AI creative partner, who knows <span className="text-electric-600 dark:text-electric-400">your backlot.</span>
          </>
        }
        actions={
          <>
            <AuthButton mode="signup" className={ctaStyles.primary}>
              Get started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </AuthButton>
            <a href="/app?autostart=1" className={ctaStyles.secondary}>
              Try the live demo
            </a>
          </>
        }
        aside={
          <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-white via-zinc-50 to-electric-50/70 p-5 ring-1 ring-zinc-200/80 shadow-[0_30px_80px_-40px_rgba(10,20,60,0.3)] sm:p-7 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-950 dark:ring-white/10 dark:shadow-none">
            <div aria-hidden="true" className="absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cantaloupe-300/25 blur-3xl dark:bg-cantaloupe-500/15" />
            <SlateConversation className="relative" />
          </div>
        }
      >
        <p>
          Slate is the assistant built into Backlot. It works from your own backlot (the posts, ideas, channels and preferences you’ve
          saved), so you don’t have to paste context into a chat window. It’s available when you’re signed in.
        </p>
      </PageHero>

      <div className="mt-24 space-y-24 sm:mt-32 sm:space-y-32">
        <Block id="does" eyebrow="Capabilities" title="What Slate can help with">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <InfoCard key={c.title} icon={c.icon} title={c.title} accent={c.accent}>
                {c.body}
              </InfoCard>
            ))}
          </div>
        </Block>

        <section id="control" aria-labelledby="control-title" className="scroll-mt-24">
          <Container>
            <div className="grid gap-10 rounded-[32px] border border-zinc-200/80 bg-zinc-50/70 p-6 sm:p-10 lg:grid-cols-2 lg:gap-14 lg:p-14 dark:border-zinc-800 dark:bg-zinc-900/40">
              <div>
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-electric-600 text-white shadow-lg shadow-electric-600/25">
                  <ShieldCheck className="h-5 w-5" aria-hidden="true" />
                </span>
                <h2 id="control-title" className="mt-5 text-3xl font-bold leading-[1.08] tracking-tight sm:text-4xl">
                  You stay in control
                </h2>
                <div className="mt-4 space-y-4 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <p>
                    Slate never changes your workspace on its own. When it has a change in mind (a new caption, a stage, a target date, a
                    new draft post, turning an idea into a post, or a few posts at once), it shows a suggestion card. Nothing happens until
                    you apply it, and each change in a batch is applied separately. Suggestions you don’t act on expire after 24 hours.
                  </p>
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold tracking-tight">Your preferences, only when you save them</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Your creative preferences (tone, caption length, emoji use, hashtag count, language, audience, things to avoid) are saved
                  only when you save them, either in Slate’s preferences or with Save on a card Slate offers. Channel preferences override your
                  global ones for that channel.
                </p>
              </div>
            </div>
          </Container>
        </section>

        <Block id="sees" eyebrow="Context" title="What Slate sees">
          <div className="grid gap-6 lg:grid-cols-2">
            <p className="text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              For each message, Slate gets today’s date, your channels, the post or idea you opened it from, and your saved preferences. It
              looks up anything else it needs from your own workspace, and only yours. It sees an image only when you pick one for that
              message, and it never sees your videos, only their names and sizes.
            </p>
            <p className="text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
              Conversations are saved to your account so you can continue on another device. You can rename, archive or delete them at any
              time. The <A href="/privacy#slate">Privacy Policy</A> explains exactly what is sent to AI providers and how long it’s kept.
            </p>
          </div>
        </Block>

        <section aria-label="Limits and boundaries" className="scroll-mt-24">
          <Container>
            <div className="grid gap-4 lg:grid-cols-2">
              <div id="limits" className="scroll-mt-24 rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
                <h2 className="text-2xl font-bold tracking-tight">Limits</h2>
                <div className="mt-5">
                  <List
                    items={[
                      'There’s a daily limit on Slate messages per account, and up to 30 messages a day can include an image.',
                      'One image per message. JPEG, PNG, WebP and GIF images can be shown to Slate.',
                      'In very long conversations, Slate keeps the recent turns and short notes on earlier ones, so it may not recall exact wording from long ago.',
                      'Like any AI, Slate can be wrong. Check facts, numbers and anything you’ll publish.',
                    ]}
                  />
                </div>
              </div>
              <div id="doesnt" className="scroll-mt-24 rounded-3xl border border-zinc-200/80 bg-white p-6 sm:p-8 dark:border-zinc-800 dark:bg-zinc-900/50">
                <h2 className="text-2xl font-bold tracking-tight">What Slate doesn’t do</h2>
                <div className="mt-5">
                  <List
                    items={[
                      'It doesn’t publish or schedule anything on YouTube, Instagram, TikTok or any other platform, and it isn’t connected to your social accounts or their analytics.',
                      'It doesn’t browse the web.',
                      'It doesn’t see other people’s workspaces, and nobody else sees yours.',
                      'It doesn’t remember anything as a preference unless you save it.',
                    ]}
                  />
                </div>
              </div>
            </div>
          </Container>
        </section>

        <Block id="providers" eyebrow="Under the hood" title="AI providers">
          <p className="max-w-3xl text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
            Slate’s replies are generated by OpenAI. If OpenAI is temporarily unavailable, Anthropic answers instead. Search by meaning uses
            OpenAI embeddings. Backlot doesn’t use Google AI models for Slate. Details are in the <A href="/privacy#slate">Privacy Policy</A>.
          </p>
        </Block>

        <section aria-labelledby="slate-cta-title">
          <Container>
            <div className="grain relative overflow-hidden rounded-[32px] bg-electric-600 px-6 py-14 text-center text-white sm:py-20">
              <div aria-hidden="true" className="absolute -bottom-24 left-1/2 h-64 w-[640px] -translate-x-1/2 rounded-full bg-electric-300/40 blur-3xl" />
              <div className="relative">
                <SlateAvatar size={64} className="mx-auto" />
                <h2 id="slate-cta-title" className="mx-auto mt-5 max-w-xl text-3xl font-extrabold leading-[1.05] text-balance sm:text-5xl">
                  Bring Slate your next post.
                </h2>
                <p className="mx-auto mt-4 max-w-md text-[15px] text-electric-100">
                  Slate is available in your workspace once you’re signed in.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <AuthButton
                    mode="signup"
                    className="flex h-12 w-full items-center justify-center rounded-full bg-white px-6 text-[15px] font-semibold text-zinc-950 transition-all hover:-translate-y-0.5 hover:shadow-xl sm:w-auto"
                  >
                    Create your account
                  </AuthButton>
                  <Link
                    href="/support#slate"
                    className="flex h-12 w-full items-center justify-center rounded-full border border-white/40 px-6 text-[15px] font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
                  >
                    Slate questions
                  </Link>
                </div>
              </div>
            </div>
          </Container>
        </section>
      </div>
    </PublicPage>
  );
}

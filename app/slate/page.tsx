import type { Metadata } from 'next';
import { JsonLd } from '@/src/components/site/JsonLd';
import { A, PageIntro, PublicPage, Section, Toc } from '@/src/components/site/PublicPage';
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
      'Slate answers from the posts and ideas you’ve saved in Backlot: hooks, caption rewrites, hashtags, weekly plans and drafts for other platforms. It suggests changes; you decide what to apply.',
  });
}

export default function SlatePage() {
  return (
    <PublicPage>
      <JsonLd data={breadcrumbJsonLd('/slate')} />
      <PageIntro eyebrow="Slate" title="Slate, your AI creative partner">
        <p>
          Slate is the assistant built into Backlot. It works from your own backlot (the posts, ideas, channels and preferences
          you’ve saved), so you don’t have to paste context into a chat window. It’s available when you’re signed in.
        </p>
      </PageIntro>

      <Toc
        items={[
          ['does', 'What Slate can help with'],
          ['control', 'You stay in control'],
          ['sees', 'What Slate sees'],
          ['limits', 'Limits'],
          ['doesnt', 'What Slate doesn’t do'],
          ['providers', 'AI providers'],
        ]}
      />

      <div className="mt-10 space-y-10">
        <Section id="does" title="What Slate can help with">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Hooks and captions:</strong> write hooks for a post, or rewrite a caption in the tone you’ve saved.</li>
            <li><strong>Hashtags:</strong> suggest sets that fit the post and your usual hashtag count.</li>
            <li><strong>Finding things:</strong> search your posts and ideas by wording or by meaning, and cite the ones it used so you can open them.</li>
            <li><strong>Planning:</strong> read your calendar (scheduled, overdue and undated work, open days, your posting rhythm) and propose a plan for the week.</li>
            <li><strong>Continuity:</strong> point out recurring topics, possible series, ideas that have been open a long time and posts that have stalled.</li>
            <li><strong>Repurposing:</strong> adapt one post or idea into up to five drafts for other platforms, each linked back to its source.</li>
            <li><strong>Images, when you choose:</strong> look at one cover, slide or idea screenshot you pick with “Show Slate an image”.</li>
          </ul>
        </Section>

        <Section id="control" title="You stay in control">
          <p>
            Slate never changes your workspace on its own. When it has a change in mind (a new caption, a stage, a target date, a new draft
            post, turning an idea into a post, or a few posts at once), it shows a suggestion card. Nothing happens until you apply it, and
            each change in a batch is applied separately. Suggestions you don’t act on expire after 24 hours.
          </p>
          <p>
            Your creative preferences (tone, caption length, emoji use, hashtag count, language, audience, things to avoid) are saved only
            when you save them, either in Slate’s preferences or with Save on a card Slate offers. Channel preferences override your global
            ones for that channel.
          </p>
        </Section>

        <Section id="sees" title="What Slate sees">
          <p>
            For each message, Slate gets today’s date, your channels, the post or idea you opened it from, and your saved preferences. It
            looks up anything else it needs from your own workspace, and only yours. It sees an image only when you pick one for that
            message, and it never sees your videos, only their names and sizes.
          </p>
          <p>
            Conversations are saved to your account so you can continue on another device. You can rename, archive or delete them at any
            time. The <A href="/privacy#slate">Privacy Policy</A> explains exactly what is sent to AI providers and how long it’s kept.
          </p>
        </Section>

        <Section id="limits" title="Limits">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>There’s a daily limit on Slate messages per account, and up to 30 messages a day can include an image.</li>
            <li>One image per message. JPEG, PNG, WebP and GIF images can be shown to Slate.</li>
            <li>In very long conversations, Slate keeps the recent turns and short notes on earlier ones, so it may not recall exact wording from long ago.</li>
            <li>Like any AI, Slate can be wrong. Check facts, numbers and anything you’ll publish.</li>
          </ul>
        </Section>

        <Section id="doesnt" title="What Slate doesn’t do">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>It doesn’t publish or schedule anything on YouTube, Instagram, TikTok or any other platform, and it isn’t connected to your social accounts or their analytics.</li>
            <li>It doesn’t browse the web.</li>
            <li>It doesn’t see other people’s workspaces, and nobody else sees yours.</li>
            <li>It doesn’t remember anything as a preference unless you save it.</li>
          </ul>
        </Section>

        <Section id="providers" title="AI providers">
          <p>
            Slate’s replies are generated by OpenAI. If OpenAI is temporarily unavailable, Anthropic answers instead. Search by meaning uses
            OpenAI embeddings. Backlot doesn’t use Google AI models for Slate. Details are in the{' '}
            <A href="/privacy#slate">Privacy Policy</A>.
          </p>
        </Section>
      </div>
    </PublicPage>
  );
}

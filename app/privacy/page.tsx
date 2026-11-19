import type { Metadata } from 'next';
import Link from 'next/link';
import { JsonLd } from '@/src/components/site/JsonLd';
import { SiteFooter, SiteHeader } from '@/src/components/site/SiteChrome';
import { breadcrumbJsonLd, pageMetadata } from '@/src/lib/seo';

export function generateMetadata(): Metadata {
  return pageMetadata({
    path: '/privacy',
    title: 'Privacy Policy',
    description:
      'What Backlot stores, what Slate sends to OpenAI and Anthropic, how uploaded files, conversations and backups are kept, and how to delete your account.',
  });
}

/**
 * Backlot's privacy policy. Every statement here describes behavior implemented in this
 * codebase; update this page whenever data handling changes (see README "Privacy").
 * The contact address comes from PRIVACY_CONTACT_EMAIL so it isn't hard-coded.
 *
 * LEGAL REVIEW REQUIRED before launch (see docs/LAUNCH_PUBLIC.md): the operating entity, legal
 * bases and regional rights (e.g. GDPR/UK GDPR, CCPA), international transfers (Vercel, Supabase,
 * Cloudflare, GitHub, OpenAI, Anthropic and Google may process data outside the creator's
 * country; state the actual hosting regions once the Vercel and Supabase regions are chosen), the
 * backup retention period (30 days is the configured design in docs/BACKUPS.md; publish it only
 * once backups are actually running), the processor agreements (DPAs) with each provider, and the
 * minimum age.
 *
 * Infrastructure (Vercel + Supabase + Cloudflare R2 migration): hosting on Vercel, the database
 * on Supabase (PostgreSQL), files in a private Cloudflare R2 bucket with no soft delete, the job
 * scheduler on Cloudflare Workers, encrypted database backups created by GitHub Actions.
 */

/** Same rule as ledgerRetentionDaysFromEnv (src/lib/account/ledger.ts), without importing storage code. */
function ledgerDays(): number {
  const n = Number(process.env.LEDGER_RETENTION_DAYS);
  return Number.isInteger(n) && n >= 30 && n <= 3650 ? n : 90;
}

const EFFECTIVE = 'November 17, 2026';

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-3">
      <h2 className="text-xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">{title}</h2>
      <div className="space-y-3 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  const contact = process.env.PRIVACY_CONTACT_EMAIL?.trim();
  const contactLine = contact ? (
    <a className="font-medium text-electric-700 underline-offset-2 hover:underline dark:text-electric-400" href={`mailto:${contact}`}>
      {contact}
    </a>
  ) : (
    <span className="font-medium">the contact address listed on this page once it is published</span>
  );

  return (
    <div className="min-h-screen bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <SiteHeader />
      <JsonLd data={breadcrumbJsonLd('/privacy')} />
      <main id="main" tabIndex={-1} className="mx-auto max-w-3xl px-4 pb-20 pt-10 outline-none sm:px-6">
        <p className="text-sm font-medium text-electric-700 dark:text-electric-400">Effective {EFFECTIVE}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Privacy Policy</h1>
        <p className="mt-4 text-[15px] leading-7 text-zinc-700 dark:text-zinc-300">
          Backlot is a private workspace for creators to keep posts, captions, files and ideas. This page explains what Backlot stores,
          how it is used, which service providers process it, and how you can delete it.
        </p>

        <nav aria-label="On this page" className="mt-8 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {[
              ['stores', 'What Backlot stores'],
              ['use', 'How your content is used'],
              ['slate', 'Slate and AI providers'],
              ['conversations', 'Slate conversations'],
              ['files', 'Uploaded media'],
              ['cookies', 'Cookies and browser storage'],
              ['providers', 'Service providers'],
              ['deletion', 'Deleting your content or account'],
              ['contact', 'Contact and privacy requests'],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-zinc-700 hover:text-electric-700 dark:text-zinc-300 dark:hover:text-electric-400">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 space-y-10">
          <Section id="stores" title="What Backlot stores">
            <p>When you sign in, Backlot stores:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Your account:</strong> the user id and email address from your Google sign-in.</li>
              <li><strong>Your workspace:</strong> channels (name and handle), posts (title, platform, stage, caption, hashtags, notes, dates, live link and attached references), and ideas (title, notes, reference link and screenshot).</li>
              <li><strong>Files you upload:</strong> covers, videos, slides and idea screenshots, with their file name, type and size.</li>
              <li><strong>Slate data:</strong> your Slate conversations (see below), search index entries for your posts and ideas, the creative preferences you save, and the changes Slate suggests (the proposed text or dates, and whether you applied or dismissed them), plus a record of those decisions that contains ids, versions and outcomes but not your content.</li>
            </ul>
            <p>The demo doesn’t send anything to Backlot’s servers. It runs on sample data in your browser and resets when you refresh.</p>
          </Section>

          <Section id="use" title="How your content is used">
            <p>
              Your workspace is private to your account. Backlot uses it to show it back to you and, when you use Slate, to answer your
              requests. Backlot has no advertising, does not sell your data, and does not include analytics or tracking scripts.
            </p>
            <p>
              Server logs record operational details such as request timing, which AI provider answered and token counts. They are designed
              not to contain your captions, notes, messages or files. When you delete your account, Backlot also keeps a separate deletion
              record outside its database, holding only your account id and the date you asked (not your email or content), so the deletion
              can be applied again if Backlot ever has to restore its database from a backup (see “Deleting your content or account”).
            </p>
          </Section>

          <Section id="slate" title="Slate and AI providers">
            <p>
              Slate is Backlot’s AI assistant and is only available when you’re signed in. When you send Slate a message, Backlot sends the
              following to an AI provider to generate the reply: your message, the recent turns of the conversation (and, for long
              conversations, Slate’s notes on earlier turns), and the workspace records Slate needs for that request. To write those notes,
              earlier turns of the conversation are also sent to the same providers. Those records can include a post’s title, caption, hashtags, notes, stage and dates, the
              names, types and sizes of its files, your channel names, your ideas and your saved Slate preferences.
            </p>
            <p>
              <strong>Images.</strong> Slate only sees an image when you choose one for a message with “Show Slate an image” (a post’s cover or a
              slide, or an idea’s screenshot). Attaching a post never sends its images. The chosen image is checked to be yours, resized, and
              re-encoded, which removes embedded details such as camera data and location. It is then sent to OpenAI, or to Anthropic if
              OpenAI is unavailable, for that one reply only. Backlot doesn’t keep the processed copy; your chat only records which image you
              chose. Videos are never sent to an AI provider. You can ask about up to 30 images a day.
            </p>
            <p>
              <strong>Search.</strong> To find your posts and ideas by meaning, not just exact words, the text of each post and idea (title,
              hashtags, caption and notes) is sent to OpenAI to create a search index entry (an “embedding”). These entries are stored in
              Backlot’s database for your account only, updated when the text changes, and deleted when the post or idea is deleted.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>OpenAI</strong> processes Slate requests. Backlot asks OpenAI not to store responses for later retrieval (<code>store: false</code>).</li>
              <li><strong>Anthropic</strong> processes a request instead when OpenAI is temporarily unavailable.</li>
            </ul>
            <p>
              Each provider handles the data under its own terms (see{' '}
              <a className="underline underline-offset-2" href="https://openai.com/policies/privacy-policy" rel="noopener noreferrer" target="_blank">OpenAI’s privacy policy</a>{' '}
              and{' '}
              <a className="underline underline-offset-2" href="https://www.anthropic.com/legal/privacy" rel="noopener noreferrer" target="_blank">Anthropic’s privacy policy</a>
              ). Backlot does not use Google AI models for Slate.
            </p>
            <p>
              Slate never changes your workspace on its own. It can suggest a change, which you review and apply yourself. Suggestions expire
              after 24 hours if you don’t act on them. Marking a post as Posted only updates Backlot; Backlot does not publish anything to
              YouTube, Instagram, TikTok or any other platform.
            </p>
          </Section>

          <Section id="conversations" title="Slate conversations">
            <p>
              Your Slate conversations are saved to your account in Backlot’s database, so you can continue them on any device. Each one
              stores your messages, Slate’s replies, and, for long conversations, short notes Slate writes about the earlier parts so it
              can continue without you repeating yourself. Those notes are only used inside the same conversation.
            </p>
            <p>
              Conversations are kept until you delete them. You can rename, archive or delete any conversation from your chat list.
              Deleting one permanently removes its messages and notes. Archiving only hides it from the list.
            </p>
            <p>
              Your saved creative preferences are kept separately from your conversations. Nothing you say in a conversation becomes a
              saved preference unless you choose to save it, and deleting a conversation doesn’t change your preferences. You can review,
              edit or delete preferences at any time in Slate.
            </p>
            <p>
              Suggested changes, including their proposed text, are deleted from Backlot’s database 30 days after you apply or dismiss them or
              after they expire. The record of decisions, which doesn’t contain your content, is kept for 180 days.
            </p>
          </Section>

          <Section id="files" title="Uploaded media">
            <p>
              Files you upload are stored in a private Cloudflare R2 storage bucket. Your browser uploads them directly to that bucket
              using links that work for a few minutes and only for the file being uploaded. A file can only be opened while you’re signed in
              to the account that uploaded it: Backlot checks that it’s yours, then gives your browser a link to that one file that expires
              within minutes. When you remove a file from a post or idea, or delete the post or idea, Backlot deletes any file that’s no
              longer used.
            </p>
            <p>
              <strong>No recovery copy.</strong> Backlot’s file storage doesn’t keep deleted files in a recovery state: a deleted file is
              erased from storage straight away and can’t be recovered, by you or by Backlot.
            </p>
          </Section>

          <Section id="cookies" title="Cookies and browser storage">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Sign-in:</strong> Google’s Firebase Authentication keeps you signed in using your browser’s storage.</li>
              <li><strong><code>cv_session</code> cookie:</strong> a short-lived (one hour) cookie holding your sign-in token, sent only when your browser loads your own files. It’s required for the app to work.</li>
              <li><strong>Browser storage:</strong> your theme choice and which Slate conversation you had open. If you delete your account, the private link to its status page is kept in this browser so you can reopen it.</li>
              <li><strong>Offline support:</strong> when installed as an app, Backlot caches its own app files so it opens faster.</li>
            </ul>
            <p>Backlot doesn’t use advertising or analytics cookies.</p>
          </Section>

          <Section id="providers" title="Service providers">
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Google (Firebase Authentication)</strong> for Google sign-in.</li>
              <li><strong>Vercel</strong> to host and run the Backlot website and app.</li>
              <li><strong>Supabase</strong> to host Backlot’s database (your workspace, Slate conversations and settings).</li>
              <li><strong>Cloudflare</strong> to store uploaded files (R2) and to start Backlot’s scheduled background jobs.</li>
              <li><strong>GitHub</strong> to run Backlot’s database backups, which are encrypted before they’re stored.</li>
              <li><strong>OpenAI</strong> and <strong>Anthropic</strong> for Slate, as described above.</li>
            </ul>
          </Section>

          <Section id="deletion" title="Deleting your content or account">
            <p>
              You can delete any post, idea, Slate conversation or Slate preference in the app at any time. Deleted posts and ideas are
              removed from Backlot’s database along with files no longer in use, and deleted conversations are removed with their
              messages.
            </p>
            <p>
              <strong>Deleting your account.</strong> In the app, open <strong>Settings</strong> and choose <strong>Delete account</strong>.
              You type a confirmation and sign in with Google again to confirm it’s you. Then:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Immediately:</strong> you’re signed out and the account is locked. Nothing in it can be opened or changed from then on, by you or anyone else.</li>
              <li>
                <strong>Usually within 15 minutes:</strong> Backlot deletes your account record, channels, posts (including captions,
                hashtags, notes and dates), ideas and their links, every uploaded file and any unfinished uploads, Slate conversations,
                messages and Slate’s notes on them, saved preferences, search index entries, Slate’s suggested changes and the record of your
                decisions, and your Slate usage records. Backlot’s sign-in record for you in Firebase Authentication is removed last. Your
                Google account itself isn’t affected.
              </li>
              <li>
                <strong>Confirmation:</strong> the deletion is only marked complete after a final check finds nothing left. If a service Backlot
                relies on is unavailable (during the beta, for example, while its database is paused), deletion waits and then resumes on
                its own, so it can take longer than usual. Your account stays locked the whole time. A status page shows the progress and works without
                signing in. It opens from a private link that only you receive; the page shows progress and dates, never your content.
              </li>
            </ul>
            <p>What remains for a limited time:</p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li><strong>Uploaded files</strong> are erased from storage when the deletion runs; there’s no recovery copy (see “Uploaded media”).</li>
              <li><strong>A deletion record</strong> holding your account id and the dates of each step, but no content and no email address, is kept for 30 days so the status page works and the deletion can be confirmed. It’s then removed.</li>
              <li><strong>A deletion ledger entry</strong> holding only your account id and the date you asked is kept outside Backlot’s database for {ledgerDays()} days, so that your deletion can be applied again if a backup is ever restored. It’s then removed.</li>
              <li><strong>Backups</strong> of Backlot’s database are encrypted and used only to recover from failures. They can contain deleted data until they expire on their regular schedule. If a backup is ever restored, accounts deleted after it was taken are locked again before Backlot is back in service, and then deleted again.</li>
            </ul>
            <p>
              Deleting an account can’t be undone, and Backlot can’t restore a deleted account’s content. If you can’t sign in, or prefer to
              ask, you can also request deletion by contacting {contactLine} from the email address you sign in with.
            </p>
          </Section>

          <Section id="contact" title="Contact and privacy requests">
            <p>
              For questions about this policy, or to request access to, correction of or deletion of your data, contact {contactLine}.
            </p>
            <p>If this policy changes, the updated version will be posted on this page with a new effective date.</p>
          </Section>
        </div>

        <p className="mt-12 text-sm text-zinc-600 dark:text-zinc-400">
          <Link href="/" className="underline-offset-2 hover:text-zinc-900 hover:underline dark:hover:text-zinc-200">← Back to Backlot</Link>
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}

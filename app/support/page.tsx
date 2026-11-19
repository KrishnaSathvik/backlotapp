import type { Metadata } from 'next';
import { JsonLd } from '@/src/components/site/JsonLd';
import { A, ContactLink, PageIntro, PublicPage, Section, Toc } from '@/src/components/site/PublicPage';
import { breadcrumbJsonLd, pageMetadata } from '@/src/lib/seo';
import { formatLimit, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@/src/lib/upload-limits';

/** Help, limits and contact. Statements describe implemented behavior (README "Uploads", "Slate"). */

export function generateMetadata(): Metadata {
  return pageMetadata({
    path: '/support',
    title: 'Help & support',
    description:
      'How to get started with Backlot, what it supports, file and storage limits, installing it on your phone, deleting your account, and how to contact support.',
  });
}

/** Same defaults as uploadPolicyFromEnv (src/lib/storage/uploads.ts). */
function concurrentUploads(): number {
  const n = Number(process.env.UPLOAD_MAX_CONCURRENT);
  return Number.isInteger(n) && n > 0 ? n : 2;
}

export default function SupportPage() {
  return (
    <PublicPage>
      <JsonLd data={breadcrumbJsonLd('/support')} />
      <PageIntro eyebrow="Help" title="Help & support">
        <p>Answers to common questions about Backlot, and how to reach us when you need more help.</p>
      </PageIntro>

      <Toc
        items={[
          ['start', 'Getting started'],
          ['platforms', 'What you can keep in Backlot'],
          ['files', 'Files and storage'],
          ['install', 'Installing on your phone'],
          ['limits', 'Current limitations'],
          ['delete', 'Deleting your account'],
          ['contact', 'Contact'],
        ]}
      />

      <div className="mt-10 space-y-10">
        <Section id="start" title="Getting started">
          <p>
            Choose <strong>Try the live demo</strong> on the <A href="/">home page</A> to explore a sample workspace. The demo runs in your
            browser, doesn’t save anything and resets when you refresh. When you want to keep your own work, choose{' '}
            <strong>Sign in with Google</strong>.
          </p>
          <p>
            Add a channel for each account you post to, add posts to the Library, save inspiration in Ideas, and move posts through their
            stages until they’re posted. <A href="/slate">Slate</A>, the AI creative partner, is available once you’re signed in.
          </p>
        </Section>

        <Section id="platforms" title="What you can keep in Backlot">
          <p>
            Posts for YouTube videos, YouTube Shorts, Instagram Reels, TikTok and Instagram posts, plus an “Other” type. Each post can have a
            cover, a video, carousel slides, a title, caption, hashtags, notes, a target date, its stage and the live link once it’s posted.
            Ideas hold a link, a screenshot and notes, and can be turned into a post.
          </p>
          <p>
            Backlot is where you prepare and keep your content. It doesn’t connect to your social accounts and doesn’t publish anything for
            you: marking a post as Posted only updates Backlot.
          </p>
        </Section>

        <Section id="files" title="Files and storage">
          <ul className="list-disc space-y-1.5 pl-5">
            <li><strong>Images:</strong> JPEG, PNG, WebP, GIF, AVIF and HEIC, up to {formatLimit(MAX_IMAGE_BYTES)} each. SVG isn’t accepted.</li>
            <li><strong>Videos:</strong> MP4, MOV, WebM, M4V and MKV, up to {formatLimit(MAX_VIDEO_BYTES)} each.</li>
            <li>Each account has a storage limit, and up to {concurrentUploads()} uploads can be in progress at once. Files upload in pieces, a piece that fails is retried, and an interrupted upload picks up where it stopped when you add the same file again.</li>
            <li>Uploaded files are private: they’re only served to the account that uploaded them.</li>
            <li>From any post you can download its files one at a time or all together as a .zip.</li>
          </ul>
        </Section>

        <Section id="install" title="Installing on your phone">
          <p>
            Backlot is a web app you can add to your home screen. On iPhone, open it in Safari, tap Share, then <strong>Add to Home Screen</strong>.
            On Android or a desktop browser that supports it, choose <strong>Install app</strong> in Backlot’s account menu, or install it from your
            browser’s menu. Backlot caches its own app files so it opens quickly and can load without a connection; saving changes, uploading
            files and Slate need one.
          </p>
        </Section>

        <Section id="limits" title="Current limitations">
          <ul className="list-disc space-y-1.5 pl-5">
            <li>Sign-in is with a Google account only.</li>
            <li>Each workspace belongs to one account; there’s no team sharing yet.</li>
            <li>Backlot doesn’t import from or publish to social platforms.</li>
            <li>Slate has a daily message limit, and up to 30 messages a day can include an image.</li>
          </ul>
        </Section>

        <Section id="delete" title="Deleting your account">
          <p>
            In the app, open <strong>Settings</strong> and choose <strong>Delete account</strong>. You’ll confirm and sign in with Google once
            more. You’re signed out straight away, and your workspace, files and Slate data are deleted, usually within 15 minutes. You get a
            private link to a status page that shows the progress. The <A href="/privacy#deletion">Privacy Policy</A> lists exactly what’s
            deleted and what remains for a limited time.
          </p>
          <p>If you can’t sign in, you can ask for deletion by email from the address you sign in with (see below).</p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            For help, feedback, privacy requests or account deletion, email <ContactLink />. Please don’t send passwords or other secrets by
            email; Backlot will never ask for them.
          </p>
        </Section>
      </div>
    </PublicPage>
  );
}

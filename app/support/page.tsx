import type { Metadata } from 'next';
import { JsonLd } from '@/src/components/site/JsonLd';
import { A, ContactLink, DocLayout, FaqItem, PublicPage, Section } from '@/src/components/site/PublicPage';
import { breadcrumbJsonLd, pageMetadata } from '@/src/lib/seo';
import { concurrentUploads, storageQuotaBytes } from '@/src/lib/storage-quota';
import { formatLimit, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from '@/src/lib/upload-limits';

/** Help, limits and contact. Statements describe implemented behavior (README "Uploads", "Slate"). */

export function generateMetadata(): Metadata {
  return pageMetadata({
    path: '/support',
    title: 'Help & support',
    description:
      'How to get started with Backlot, what it supports, file and storage limits, signing in, installing it on your phone, deleting your account, and how to contact support.',
  });
}

export default function SupportPage() {
  return (
    <PublicPage>
      <JsonLd data={breadcrumbJsonLd('/support')} />
      <DocLayout eyebrow="Help" title="Help & support" intro={<p>Answers to common questions about Backlot.</p>}>
        <Section id="start" title="Getting started">
          <FaqItem q="How do I try Backlot?">
            <p>
              Choose <strong>Try the live demo</strong> on the home page. It runs in your browser, doesn’t save
              anything and resets when you refresh. To keep your own work, choose <strong>Get started</strong> and sign up with an email
              and password.
            </p>
          </FaqItem>
          <FaqItem q="What should I set up first?">
            <p>
              Add a channel for each account you post to, add posts to the Library, save inspiration in Ideas, and move posts through their
              stages until they’re posted.
            </p>
          </FaqItem>
        </Section>

        <Section id="library" title="Library and content">
          <FaqItem q="Which platforms are supported?">
            <p>YouTube videos, YouTube Shorts, Instagram Reels, TikTok, Instagram posts, LinkedIn and Facebook, plus an “Other” type.</p>
          </FaqItem>
          <FaqItem q="What does a post hold?">
            <p>
              A cover, a video, carousel slides, a title, caption, hashtags, notes, a target date, its stage and the live link once it’s
              posted. Ideas hold a link, a screenshot and notes, and can be turned into a post.
            </p>
          </FaqItem>
          <FaqItem q="Does Backlot publish to my social accounts?">
            <p>No. It doesn’t connect to your social accounts. Marking a post as Posted only updates Backlot.</p>
          </FaqItem>
          <FaqItem q="Can I share a workspace with my team?">
            <p>Not yet. Each workspace belongs to one account.</p>
          </FaqItem>
        </Section>

        <Section id="files" title="Uploading and storage">
          <FaqItem q="What can I upload?">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Images: JPEG, PNG, WebP, GIF, AVIF and HEIC, up to {formatLimit(MAX_IMAGE_BYTES)} each. SVG isn’t accepted.</li>
              <li>Videos: MP4, MOV, WebM, M4V and MKV, up to {formatLimit(MAX_VIDEO_BYTES)} each.</li>
              <li>
                {formatLimit(storageQuotaBytes())} of storage per account, with up to {concurrentUploads()} uploads in progress at once.
              </li>
            </ul>
          </FaqItem>
          <FaqItem q="What happens if an upload is interrupted?">
            <p>Add the same file again and it picks up where it stopped.</p>
          </FaqItem>
          <FaqItem q="Who can open my files?">
            <p>Only you. Files are served only to the account that uploaded them.</p>
          </FaqItem>
          <FaqItem q="How do I download my files?">
            <p>From any post, one at a time or all together as a .zip.</p>
          </FaqItem>
        </Section>

        <Section id="slate" title="Slate">
          <FaqItem q="What can Slate do?">
            <p>
              Write hooks and captions, suggest hashtags, find your posts and ideas, plan your week and adapt a post for other platforms.
              Nothing changes until you apply its suggestions. More on the <A href="/slate">Slate page</A>.
            </p>
          </FaqItem>
          <FaqItem q="Are there limits?">
            <p>A daily message limit, and up to 30 messages a day can include an image.</p>
          </FaqItem>
        </Section>

        <Section id="account" title="Sign-in and account">
          <FaqItem q="How do I sign in?">
            <p>With the email and password you signed up with.</p>
          </FaqItem>
          <FaqItem q="Can I install Backlot on my phone?">
            <p>
              Yes. On iPhone, open it in Safari, tap Share, then <strong>Add to Home Screen</strong>. On Android or desktop, choose{' '}
              <strong>Install app</strong> in the account menu or your browser’s menu.
            </p>
          </FaqItem>
        </Section>

        <Section id="delete" title="Deleting your account">
          <p>
            Open <strong>Settings</strong> and choose <strong>Delete account</strong>, then sign in once more to confirm. You’re signed out
            and the account is locked straight away; your data is then deleted in the background, and a status page shows the progress.
            The <A href="/privacy">Privacy Policy</A> lists what’s deleted and what remains for a limited time.
          </p>
          <p>If you can’t sign in, email us from the address you sign in with.</p>
        </Section>

        <Section id="contact" title="Contact">
          <p>
            For help, feedback or privacy requests, email <ContactLink />. We’ll never ask for passwords or other secrets.
          </p>
        </Section>
      </DocLayout>
    </PublicPage>
  );
}

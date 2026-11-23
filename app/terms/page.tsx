import type { Metadata } from 'next';
import { JsonLd } from '@/src/components/site/JsonLd';
import { A, ContactLink, DocLayout, PublicPage, Section } from '@/src/components/site/PublicPage';
import { breadcrumbJsonLd, pageMetadata } from '@/src/lib/seo';

/**
 * Terms of Service.
 *
 * LEGAL REVIEW REQUIRED before launch. This draft describes how Backlot actually works, but it
 * was not written by a lawyer. Items marked "LEGAL REVIEW" below need a decision: the operating
 * entity, minimum age, governing law and venue, liability cap, and any consumer-law carve-outs.
 * docs/LAUNCH_PUBLIC.md lists them.
 */

// OWNER REVIEW: moved from November 17 when "Your account" changed from Google-only to Google or email and password.
const EFFECTIVE = 'November 20, 2026';

export function generateMetadata(): Metadata {
  return pageMetadata({
    path: '/terms',
    title: 'Terms of Service',
    description: 'The terms for using Backlot: your account, your content, Slate’s AI suggestions, acceptable use, limits and account deletion.',
  });
}

export default function TermsPage() {
  return (
    <PublicPage>
      <JsonLd data={breadcrumbJsonLd('/terms')} />
      <DocLayout
        title="Terms of Service"
        effective={EFFECTIVE}
        intro={
          <p>
            These terms apply when you use Backlot, including the demo, the web app and the installed app. By signing in, you agree to them.
            The <A href="/privacy">Privacy Policy</A> explains how your data is handled.
          </p>
        }
      >
        <Section id="account" title="Your account">
          {/* LEGAL REVIEW: minimum age and the operating entity's name. */}
          <p>
            {/* OWNER REVIEW: was Google-only, with the age test tied to Google accounts. Email and password sign-in is also
                supported now; the minimum age is still a LEGAL REVIEW item. */}
            You sign in with an email address and password. You’re responsible for activity on your Backlot
            account and for keeping your password secure. You must be old enough to agree to these
            terms where you live.
          </p>
        </Section>

        <Section id="content" title="Your content">
          <p>
            You keep ownership of everything you add to Backlot: posts, captions, notes, ideas, files and Slate conversations. You give
            Backlot permission to store, process and display that content only to provide the service to you, including sending it to the AI
            providers described in the Privacy Policy when you use Slate. Backlot doesn’t sell your content or use
            it for advertising.
          </p>
          <p>
            Only add content you have the right to use. Keep your own copies of anything important: Backlot is a workspace, not a backup
            service.
          </p>
        </Section>

        <Section id="slate" title="Slate and AI suggestions">
          <p>
            Slate generates suggestions with AI. They can be inaccurate, incomplete or similar to content created for others. Review anything
            before you rely on or publish it; you’re responsible for what you publish. Slate never changes your workspace without your
            approval.
          </p>
        </Section>

        <Section id="use" title="Acceptable use">
          <p>Don’t use Backlot to:</p>
          <ul className="list-disc space-y-1.5 pl-5">
            <li>store or share content that’s illegal or that infringes someone else’s rights;</li>
            <li>upload malware or files disguised as another type;</li>
            <li>access another person’s account or data, or probe, overload or disrupt the service;</li>
            <li>get around limits such as storage quotas or Slate’s daily limits, or use automated means to extract data or AI output at scale;</li>
            <li>use Slate to generate content that violates the usage policies of its AI providers.</li>
          </ul>
        </Section>

        <Section id="service" title="The service and its limits">
          <p>
            Backlot may change, add or remove features. Accounts have limits, such as a storage quota, file size limits and daily Slate limits,
            described in <A href="/support">Help &amp; support</A>. Backlot doesn’t connect to or publish on social platforms. The service may
            occasionally be unavailable, for example during maintenance or outages.
          </p>
          {/* LEGAL REVIEW: pricing. Backlot currently has no paid plans; add billing terms before introducing any. */}
        </Section>

        <Section id="ending" title="Ending your use">
          <p>
            You can stop using Backlot and delete your account at any time from Settings; the Privacy Policy{' '}
            describes what’s deleted and when. Backlot may suspend or close an account that seriously or repeatedly breaks these terms, or
            where required by law, and will tell you when it reasonably can.
          </p>
        </Section>

        <Section id="disclaimers" title="Disclaimers and liability">
          {/* LEGAL REVIEW: warranty disclaimer, liability limit and consumer-law carve-outs for the regions Backlot serves. */}
          <p>
            Backlot is provided “as is” and “as available”. To the extent the law allows, Backlot isn’t liable for indirect or consequential
            losses, or for lost content, profits or opportunities arising from your use of the service. Nothing in these terms limits rights
            you have under laws that can’t be waived.
          </p>
        </Section>

        <Section id="changes" title="Changes and contact">
          {/* LEGAL REVIEW: governing law and venue. */}
          <p>
            If these terms change, the new version will be posted here with a new effective date.
            {/* LEGAL REVIEW: whether and how users are notified of material changes in advance. */} Questions about these terms: <ContactLink />.
          </p>
        </Section>
      </DocLayout>
    </PublicPage>
  );
}

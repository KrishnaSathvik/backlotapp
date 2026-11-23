# Public site, SEO and launch readiness (Launch L4)

How Backlot's public pages are set up for search, AI discoverability, social sharing and accessibility, what still needs a human decision, and what to check at final verification. Nothing here has been verified against production: there's no confirmed domain, and no Search Console or Bing property exists yet.

## Routes

| Route | Kind | Indexed | Notes |
| --- | --- | --- | --- |
| `/` | Marketing landing | Yes | Server-rendered (the full text is in the initial HTML). Organization, WebSite and WebApplication JSON-LD. |
| `/slate` | Product page | Yes | What Slate does, sees and doesn't do; limits; providers. BreadcrumbList. |
| `/support` | Help | Yes | Getting started, platforms, file limits, install, limitations, deletion, contact. BreadcrumbList. |
| `/privacy` | Legal | Yes | BreadcrumbList. Needs legal review (below). |
| `/terms` | Legal | Yes | New draft. Needs legal review (below). |
| `/llms.txt` | AI discoverability | n/a | Markdown summary with links to the pages above. |
| `/robots.txt`, `/sitemap.xml` | Crawlers | n/a | Generated from `src/lib/site.ts` at request time. |
| `/og.png` | Social image | n/a | 1200×630, built once from the brand mark and a real Library screenshot. |
| `/app` (also the demo via `?autostart=1`) | App | **No** | `noindex` meta tag and `X-Robots-Tag` header. |
| `/login` | Redirect to `/app` | **No** | Header. |
| `/account/deleted` | Deletion status | **No** | Meta tag, header, `no-referrer`. The token is in the URL fragment and never reaches the server or logs. |
| `/api/*` | API | **No** | Header and `Disallow` in robots.txt. |
| Anything else | 404 | No | Branded page with a real 404 status. |

Every page is rendered per request (`dynamic = 'force-dynamic'` in the root layout), because `SITE_URL` and `PRIVACY_CONTACT_EMAIL` are runtime settings. Before L4, `/privacy` was prerendered at build time, so its contact address was baked in from the build environment.

## The site URL

The production domain isn't recorded anywhere in this repository, so nothing guesses one. Set **`SITE_URL`** to the real https origin (e.g. `https://example.com`, with no path).

- **Set:** canonical URLs, `og:url`, the social image, sitemap entries, the robots.txt `Sitemap:` line, JSON-LD and absolute links in `/llms.txt` are all emitted.
- **Unset:** pages work but omit those, and production logs a `config.warning`.
- **Invalid** (http, or has a path): the production config check fails and the revision doesn't start.

### Applying the confirmed domain

`getbacklot.app` appears only as decorative text in the hero mock-up. It isn't known to belong to Backlot. Once the real domain is confirmed and owned, apply it in every one of these places:

| Where | What to set | Effect |
| --- | --- | --- |
| Vercel env `SITE_URL` | `https://<domain>` | Canonical URLs, `og:url`/`og:image`, sitemap, robots.txt `Sitemap:`, JSON-LD and `/llms.txt` links all follow automatically. No code change. |
| `src/components/site/Showcase.tsx` (browser-frame label) | `<domain>` | The only hard-coded domain text. Code change and redeploy. |
| Domain mapping or load balancer | Map the domain to the service. Redirect the other host (apex or `www`) and any `*.run.app` URL users might share to it with a 301. | One canonical host. The app doesn't redirect hosts itself. |
| Supabase → Authentication → URL Configuration (`backlot`) | Site URL `https://<domain>`; add `https://<domain>/**` to Redirect URLs | Google sign-in returns to the old Site URL without it. |
| Google OAuth consent screen (the Google Cloud project of Backlot's OAuth client) | Add the domain, privacy URL `https://<domain>/privacy` and terms URL `https://<domain>/terms` | Shown on the Google sign-in consent screen. |
| `INTERNAL_OIDC_AUDIENCE` and the Scheduler job URIs | Keep the `*.run.app` service URL unless the jobs are moved to the domain. They must match each other. | Job authentication (WORKERS.md). |
| `PRIVACY_CONTACT_EMAIL` | Optional override of the default `support@getbacklot.app` | Contact on `/privacy`, `/terms`, `/support` and in the Organization JSON-LD. |
| Google Search Console and Bing Webmaster Tools | Domain property, verified via DNS | See "Search setup". |

Before launch, check with `curl https://<domain>/robots.txt`, `/sitemap.xml`, `/llms.txt` and the page source of `/` that every URL uses the domain and none uses `localhost` or `*.run.app`.

## Metadata

- **Titles:** the root layout sets the template `%s · Backlot`. Home uses the absolute title "Backlot — Every post, one backlot".
- **Per-page metadata:** each public page gets its description, canonical URL, Open Graph and Twitter tags from `pageMetadata()` (`src/lib/seo.ts`).
- **No-index pages:** they use `NOINDEX`, and the response headers come from `next.config.ts`.
- **Social card:** `summary_large_image` with `/og.png` once `SITE_URL` is set, otherwise `summary`.

## Structured data

Only implemented features are described. There's deliberately no price or `offers`, rating, review, user count, award, auto-publishing or social-platform integration.

- **Home:** `Organization` (name, url, logo, and email when `PRIVACY_CONTACT_EMAIL` is set), `WebSite`, and `WebApplication` (category, OS, browser requirements, feature list, screenshot).
- **Other public pages:** `BreadcrumbList`.
- **Not added:**
  - `FAQPage`: Google now shows FAQ results only for authoritative government and health sites.
  - `SearchAction`: there's no public site search.
  - `SoftwareApplication` rich results: Google requires price and rating data, which would be invented.

## AI discoverability and crawler policy

- **`/llms.txt`:** follows the llmstxt.org proposal: an H1, a summary blockquote, then sections covering what it does, limits, privacy and pages. It's optional, and no search engine treats it as a ranking signal. Keep it in sync with the pages; it's in `app/llms.txt/route.ts`.
- **No `ai.txt`:** there's no adopted standard behind it.
- **robots.txt:** allows everything except `/api/`. Private routes aren't disallowed, because a crawler must fetch a page to see its `noindex`. They're protected by sign-in.
- **Search crawlers,** including AI search crawlers such as `OAI-SearchBot` and `Claude-SearchBot`, are always allowed.
- **Model-training crawlers** (`GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `CCBot`) are **disallowed by default** (L4 decision). robots.txt asks them not to crawl the public pages; set `ROBOTS_DISALLOW_AI_TRAINING=false` to allow them. `Google-Extended` is only a control token: it doesn't affect Google Search, AI Overviews or AI Mode, which use Googlebot. robots.txt is a voluntary signal, not access control; private content is protected by sign-in.

## Legal and trust: needs review before launch

Pages are written to match implemented behavior; they're not lawyer-reviewed. `LEGAL REVIEW` comments in the source mark the open points:

- **Operating entity:** name and address for the Terms and Privacy Policy.
- **Contact address:** `support@getbacklot.app` (`SUPPORT_EMAIL` in `src/lib/site.ts`); `PRIVACY_CONTACT_EMAIL` overrides it. Make sure that mailbox receives mail before launch.
- **Minimum age** (Terms and Privacy).
- **Governing law, venue, warranty disclaimer and liability cap** (Terms).
- **Notice of material changes:** whether, and how, users are told in advance.
- **Regional privacy rights and legal bases** (e.g. GDPR/UK GDPR, CCPA/CPRA), and international transfers to OpenAI and Anthropic.
- **Backup, log and deletion-ledger retention periods:** add them once verified or decided in production. The ledger keeps account ids for its retention period (60 days suggested). The policy now says accounts deleted after a backup are locked and deleted again if it's restored, and that deletion logs record the account id. The procedure for both is in BACKUPS.md ("Restore procedure").
- **AI-provider terms:** confirm OpenAI's and Anthropic's API data-retention and training terms for the account actually used, before citing any specifics. The policy currently says only that each handles data under its own terms (and that OpenAI requests use `store: false`).

## Accessibility changes (public pages)

- **Skip link:** a "Skip to content" link in the site header; every public page has one `<main id="main">`.
- **Footer:** the footer navigation is now labelled, with Slate, Help, Privacy and Terms.
- **Hero carousel:** pauses on keyboard focus as well as hover, and stops for good once a screen is picked (WCAG 2.2.2). It already respected reduced motion.
- **No-JavaScript fallback:** content revealed on scroll now shows without JavaScript (`<noscript>` style). Before, it stayed transparent.
- **Contrast:** raised the footer tagline and links, the marquee and the "Back" links from zinc-400 to zinc-500/600.
- **Links that open a new tab** say so to screen readers. Decorative icons are `aria-hidden`.
- **Section structure:** public text pages use labelled sections, one `h1` per page and an "On this page" nav.

## Search setup (manual, after the domain is live)

No verification, indexing or traffic has been claimed or checked.

**Google Search Console**

1. Add a **Domain property** for the production domain. Verify it with the DNS TXT record at the registrar, which needs no code change.
2. Submit `https://<domain>/sitemap.xml` under Sitemaps.
3. Use URL Inspection on `/`, `/slate`, `/support`, `/privacy` and `/terms`. Check that the page is fetchable, the canonical is the same URL, and the rendered HTML contains the page text.
4. Inspect `/app` and confirm it reports "Excluded by noindex".
5. Run the Rich Results Test on `/` and `/slate` (expect Breadcrumb on `/slate`; Organization is shown as detected structured data).
6. **Monitor weekly at first:**
   - Pages report: indexed count, "Excluded by noindex" contains only app routes.
   - Performance report: queries, clicks, CTR.
   - Enhancements: breadcrumbs.

**Bing Webmaster Tools**

1. Import the site from Search Console, or add it and verify it via DNS.
2. Submit the sitemap and check the URL Inspection and Site Explorer reports.
3. Optionally enable IndexNow later. It needs a key file, so it's a code change.

**Analytics:** none added. The privacy policy states there are no analytics or tracking scripts. Adding any needs a product decision and a policy update first.

## Final verification (deferred; not run in L4)

L4 ran only typecheck, lint, unit tests and a local production build, with a curl check of status codes, headers and tags. At final verification, on the deployed site:

- **Status and headers:** `curl -sI` every route in the table above. Check the status codes, `X-Robots-Tag` on the app routes, and that none appears on the public pages.
- **Head tags:** view the source of each public page. Check the title, description, canonical (production origin), `og:image`, and that the JSON-LD parses.
- **Validators:** schema.org validator and the Rich Results Test on `/` and `/slate`; check that `/sitemap.xml` and `/robots.txt` are valid.
- **Social previews:** check the image and text (e.g. Facebook Sharing Debugger, LinkedIn Post Inspector).
- **Keyboard:** tab through `/` and `/privacy`. The skip link appears first, focus is always visible, and the carousel tabs and FAQ items are operable.
- **Screen reader:** a quick pass with VoiceOver or NVDA on `/`: landmarks, headings, image alt text.
- **Contrast and audit:** a Lighthouse or axe audit of the public pages in light and dark mode.
- **Layout and motion:** check 320 px and 375 px widths and reduced motion (the carousel is static, reveals are instant). With JavaScript disabled, the landing text is visible.
- **Content links:** the `/llms.txt` links resolve, and `PRIVACY_CONTACT_EMAIL` shows on `/privacy`, `/terms` and `/support`.

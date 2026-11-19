# Backlot

A private home for YouTube videos, Shorts, Reels, TikToks and Instagram posts: covers, video files, slides, captions, tags and ideas, plus Slate, an AI creative partner grounded in your own workspace.

Next.js 15 · React 19 · Tailwind 4 · Firebase Auth (Google) · Postgres (Drizzle) · OpenAI + Anthropic (Slate).

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run db:migrate -- --apply   # create the tables from src/db/migrations (or db:push on a throwaway db)
npm run dev                  # http://localhost:3000
```

Open **http://localhost:3000**, not 127.0.0.1. Google sign-in only works on domains authorized in the Firebase console, and `localhost` is authorized by default.

**No database?** Choose **Try the demo**. The demo is a read-only sample workspace (`src/lib/demo-data.ts`, photos in `public/demo/`): you can browse, filter, open posts and copy captions, but adding and editing need a signed-in account.

## Pages

| Path | What it is |
| --- | --- |
| `/` | Landing page: product, features, who it's for, FAQ |
| `/app` | The app. Shows the sign-in screen when signed out |
| `/app?autostart=1` | Opens the read-only demo directly |
| `/login` | Redirects to `/app` |
| `/slate`, `/support`, `/privacy`, `/terms` | Public product, help and legal pages |
| `/llms.txt`, `/robots.txt`, `/sitemap.xml`, `/og.png` | Discoverability files and the social preview image |
| `/account/deleted` | Account deletion status (private link, not indexed) |

Public pages need `SITE_URL` (the https origin) for canonical URLs, the sitemap and social previews. See docs/LAUNCH_PUBLIC.md.

The installed PWA opens at `/app`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (`node --test`) |
| `npm run db:migrate` | Dry run of the SQL migrations; `-- --apply` applies them with checksums (the only way to change a real database) |
| `npm run db:push` | Local throwaway databases only: sync `src/db/schema.ts` (no write guard) |
| `npm run restore:reapply-deletions` | After a database restore: re-lock accounts from the deletion ledger (docs/BACKUPS.md) |

Hosting: Vercel + Supabase + Cloudflare R2 + Firebase Auth. Start with `docs/DEPLOYMENT.md`; the migration report is `docs/MIGRATION_REPORT.md`.

## Slate (AI)

Slate is signed-in only. Creators always see "Slate"; which model answered is internal.

**Models.** OpenAI GPT-6.1 Sol (`OPENAI_MODEL`, default `gpt-6.1-sol`) answers every request. Anthropic Claude Opus 5.5 (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) takes over only when OpenAI has a recoverable problem *before any text was sent*: 503/5xx, 429, connection failure, or no first output within the task's deadline. Claude is never used after OpenAI has streamed text, after Stop, or for invalid requests and bad credentials. `SLATE_ENABLE_FALLBACK=false` keeps Slate on OpenAI only. Without `OPENAI_API_KEY`, production refuses to run Slate (rather than silently making Claude the primary) unless `SLATE_ALLOW_FALLBACK_ONLY=true`; in development it logs a warning and uses Claude. A per-instance circuit breaker sends traffic straight to Claude after 3 OpenAI capacity failures within a minute, logs `slate skip provider=openai reason=circuit_open`, and lets one probe through after 30 seconds.

**Refusals.** An OpenAI refusal is a normal reply and never triggers the Claude fallback. Inside a Claude call, Anthropic's server-side refusal fallback (`fallbacks: "default"`, on unless `SLATE_ANTHROPIC_REFUSAL_FALLBACK=false`) re-runs a safety decline on a fallback model Anthropic picks. Such replies are logged with `refusal_fallback=yes` and the model that actually answered, and their cost is not estimated at Opus rates (that reply is billed at the fallback model's rates).

**Context and tools.** The browser sends only the conversation plus ids (`focus: {type, id}`, `channelId`). The server starts each request with a small context for the signed-in user (`src/lib/slate/retrieval.ts`): today's date, channels with ids, the focused post or idea, and the creator's applicable saved preferences. Ids that aren't the user's get a 404. Everything else Slate looks up through tools (`src/lib/slate/tools.ts`), with the user id always taken from the session:

| Tool | Returns |
| --- | --- |
| `search_posts` | Keyword matches over title, caption, tags, notes (title weighted most), with excerpts |
| `search_ideas` | Keyword matches over ideas; `status` open / converted / any |
| `get_post_details` | One post (caption, tags, notes, stage, dates); unknown and foreign ids look the same |
| `list_channels` | Channels with ids and post counts |
| `get_upcoming_content` | Unposted work, soonest real date first, overdue flagged |
| `get_creator_preferences` | Saved preferences, channel values overriding global |
| `get_calendar` | Planning view: schedule by day, open days, overdue/undated work, posting rhythm |
| `get_creative_continuity` | Recurring topics, possible series (real posting gaps), long-open ideas, stalled posts, related unfinished work |
| `propose_repurpose` | Up to 5 platform-specific drafts adapted from a post or idea, for review |
| `propose_preference` | Saves nothing: shows the creator a Save card |
| `propose_post_update` | Suggests a new title, caption, hashtags or notes for one post |
| `propose_stage_change` / `propose_target_date` | Suggests a stage or target date for one post |
| `propose_post_creation` | Suggests a new draft post (stage Planned) |
| `propose_idea_conversion` | Suggests turning an open idea into a post |
| `propose_batch_updates` | Suggests changes to up to 5 posts, each applied separately |

Search (M5) has three parts:

1. Postgres full-text search with English stemming, weighted title > tags > caption and notes, plus escaped substring matching.
2. A typo-corrected retry against the creator's own words, used only when the first search finds nothing.
3. When `OPENAI_API_KEY` is set, OpenAI embeddings (`text-embedding-3-small`, 256 dimensions) stored in `slate_embeddings` and fused with the text results. There is no vector database. See "Search quality" below. Limits: 6 tool rounds (the last round must answer), 6 calls per round, results capped per tool and to 24,000 characters per request. Slate cites records as `[[post:ID]]` / `[[idea:ID]]`; the server keeps only references to the creator's own records and the chat shows them as chips that open the post or idea.

**Creative preferences** (`slate_preferences`): tone, caption length, emoji use, hashtag count, language, audience, things to avoid. Global values apply everywhere; a channel value overrides it for that channel. They're saved only by the creator: in the Slate preferences panel, or by clicking Save on a card Slate proposes in chat. API: `GET/POST /api/slate/preferences`, `PATCH/DELETE /api/slate/preferences/[id]`. Apply the table with `npm run db:push` (or `src/db/migrations/2026-11-17_slate_preferences.sql`).

**Conversations.** Chats are saved per creator in `slate_conversations` and `slate_messages` (`src/lib/slate/conversations-db.ts`), so they continue on any device.

- **Requests:** the browser sends only `{conversationId, message, focus, channelId}`. History comes from the database, so a client can't rewrite earlier turns or invent Slate replies.
- **Context window:** the model sees the newest turns (up to 30 turns or 48,000 characters). Older turns are folded into `<conversation-notes>` by a short summarization call through the same OpenAI → Claude chain (`src/lib/slate/continuity.ts`). The notes are stored and reused, and are treated as reference data.
- **Retries:** a retry reuses the unanswered question instead of duplicating it.
- **Partial replies:** a stopped or cut-off reply is saved and marked as cut short.
- **Management API:**
  - `GET /api/slate/conversations?q=&archived=1` searches titles and message text.
  - `GET`, `PATCH` (`{title}` or `{archived}`) and `DELETE` on `/api/slate/conversations/[id]`. Delete removes the messages and notes.
  - `POST /api/slate/conversations` imports the old browser-only chat once.
- **History sheet:** the chat's history button opens it, with search, rename, archive and delete.

**Search quality.** `npm run bench:search` scores the real search tools on a synthetic workspace with 42 scenarios (`src/lib/slate/search-bench-data.ts`): exact wording, word forms, synonyms, vague references, typos, channel and stage filters, and irrelevant queries.

| Method | Recall@5 | MRR | False positives | Median latency |
| --- | --- | --- | --- | --- |
| Original keyword `ILIKE` | 67.9% | 0.620 | 0/3 | 0.8 ms |
| Full-text + typo correction | 87.2% | 0.842 | 1/3 | 1.4 ms |
| + OpenAI embeddings | 94.9% | 0.923 | 1/3 | ~230 ms |

A test keeps text search at or above its measured floor. To re-measure the embeddings, run `SLATE_BENCH_SEMANTIC=1 npm run bench:search` (it needs `OPENAI_API_KEY`).

How the embeddings stay bounded and current:

- **Sync:** they're refreshed when the text changes, detected by content hash.
- **Deletes:** they're removed with the post or idea, and orphans are pruned on use.
- **Limits:** at most 1,000 records per type per creator are compared in memory, with at most 200 new embeddings per search and a 5-second timeout. Above the cap, or on any error, search uses text only.
- **Fallback:** when OpenAI is unavailable, search is text only (Claude has no embedding model).
- **Settings:** `SLATE_SEMANTIC_SEARCH=off` disables embeddings and `SLATE_EMBEDDING_MODEL` overrides the model.
- **Honest labels:** each search result says which method matched (`keyword`, `keyword+spelling` or `keyword+semantic`), so Slate never claims meaning-based matching it didn't use.

**Repurposing.** `propose_repurpose` adapts one post or idea into up to 5 drafts for other platforms. It uses the normal review cards, so Apply, the version and ownership checks, and at-most-once apply all still hold.

- Drafts keep their source: `repurposed_from_post_id` points to the source post, with a foreign key `ON DELETE SET NULL` so the draft survives if the source is deleted. Drafts made from ideas keep `source_idea_id`.
- Platform guidance is a set of editable defaults. Slate follows, in order: the creator's request, their saved channel preferences, their existing style, then the defaults.

**Images.** Slate sees an image only when the creator picks one with "Show Slate an image": a post's cover or a slide, or an idea's screenshot.

- The server checks that both the record and the uploaded file belong to the creator.
- `sharp` decodes the image to verify it's really JPEG, PNG, WebP or GIF, then enforces 15 MB and 50 megapixels, scales it to at most 1568 px, and re-encodes it as JPEG, which strips EXIF and GPS data.
- It's sent inline (never as a URL) to OpenAI, or to Claude on fallback, and isn't stored. The chat records only the label.
- Limits: one image per message and 30 image messages per user per day.
- Videos are metadata only.
- `SLATE_IMAGE_ANALYSIS=off` disables the feature.
- File reads go through `src/lib/file-storage.ts` and the configured store (`src/lib/storage/`: R2 in production).

**Memory boundaries.** A conversation's turns and notes are only used inside that conversation. Saved preferences are the only memory shared between conversations, and only the creator saves them.

**Planning.** `get_calendar` returns real dates for a range of up to 60 days:

- scheduled posts by day, and open days
- overdue posts, and ready or in-progress posts with no date
- each channel's posting rhythm over the last 8 weeks, from posted dates

Slate builds dated plans on top of it and can propose the dates (up to 5 posts) for review.

**Suggested changes (Creative Actions).** Slate never changes content itself. A `propose_*` tool validates a change and returns a draft; once the reply finishes, the server stores it as a pending row in `slate_actions` (24-hour expiry) and the chat shows a preview card with the before/after, **Apply**, **Edit**, **Regenerate** and **Dismiss** (batches add **Apply all**, with a confirmation). Only the creator's decision, `POST /api/slate/actions/[id]` with `{decision: "apply" | "dismiss", edits?}`, applies anything (`src/lib/slate/actions-db.ts`):

- The action is loaded by id *and* the signed-in uid; another user's action is "not found".
- The stored, server-validated payload is used. The browser can only send edits to fields the action already proposes, and they're re-validated.
- The action row is locked and its status checked in the same transaction as the write, so it applies at most once; a repeat call returns the earlier result.
- Writes go through the versioned update: if the post changed since Slate proposed the change, nothing is written, the action becomes "out of date" (409) and the card offers *Ask Slate again*.
- Any error rolls back the whole transaction (content and action unchanged).
- `slate_action_events` records each proposal and decision with ids, versions and outcome, never content.

Drafts are created as Planned; idea conversions reuse the normal conversion (keeps `sourceIdeaId`, returns the existing post if the idea was already converted). There is no delete or publish tool. `GET /api/slate/actions?ids=…` refreshes the status of cards restored from chat history.

**Limits.** 256 KB per request, 30 turns, 8,000 characters per message, and per-task output caps and deadlines (`src/lib/slate/tasks.ts`, overridable with `SLATE_*` variables).

Each user gets 30 requests per 10 minutes and 2 concurrent replies, **shared by every server instance** (`src/lib/slate/shared-limits.ts`):

- Each request takes a lease row in `slate_usage_leases` inside a transaction that holds a per-user advisory lock, so two instances can't both take the last slot.
- A lease is released when the reply settles, and expires after 150 s regardless, so a crashed or disconnected request never holds a slot.
- Circuit-breaker failures are counted in `slate_breaker_state`, so when OpenAI fails on one instance the others route to Claude too.
- If the database is unreachable, Slate **fails closed**: requests get a short "temporarily unavailable" reply (HTTP 503) instead of falling back to per-instance counters, which would multiply cost and concurrency by the number of instances. This is logged at most once a minute.

**Scheduled jobs.** Two jobs with separate credentials: `POST /api/internal/account-deletions` every 5 minutes, and `POST /api/internal/cleanup` daily, triggered by the Cloudflare Worker in `ops/scheduler` with its own bearer secret per job (Cloud Scheduler OIDC still works). Each is disabled until configured. See docs/WORKERS.md.

- It expires stale pending suggestions.
- It deletes closed suggestions after `SLATE_ACTION_RETENTION_DAYS` (30) and audit events after `SLATE_AUDIT_RETENTION_DAYS` (180).
- It prunes old leases.
- It uses `FOR UPDATE SKIP LOCKED`, so a suggestion being applied at that moment is left alone.

**Streaming.** Replies stream as NDJSON. Stop or a disconnect cancels the provider request. Retries and fallback happen only before the first text, so nothing is duplicated.

**Diagnostics.** One server log line per reply: provider, model (and served model if different), providers skipped by the circuit breaker, attempts, fallback reason, refusal fallback, time to first text, tokens, estimated cost (set `SLATE_PRICE_OPENAI="in,out"` in USD per 1M tokens; Claude Opus 5.5 is built in). No creator content or keys are logged.

Code: `app/api/chat/route.ts`, `src/lib/slate/`. Tests: `npm test`.

### Privacy

The public policy is at `/privacy` (`app/privacy/page.tsx`), linked from the footer, the sign-in card and the account menus. Set `PRIVACY_CONTACT_EMAIL` so it shows a contact address. Update the page whenever data handling changes.

#### AI providers

When a signed-in creator uses Slate, their message, recent chat turns and the relevant workspace records (for example a post's title, caption, tags and notes) are sent to **OpenAI** to generate the reply. If OpenAI is unavailable, the same request is sent to **Anthropic** instead. Slate does not send media files. Backlot does not use Google AI models for Slate. The privacy policy should name OpenAI and Anthropic as AI processors and link to their data-handling terms.

## Stale-edit protection (versions)

`content_items` and `ideas` have `version INTEGER NOT NULL DEFAULT 1`. Every successful change adds 1 in the same SQL statement that checks it (`UPDATE … WHERE id = $1 AND user_uid = $2 AND version = $3`); a save that changes nothing keeps the version (`src/lib/content-mutations.ts`). The workspace load returns each record's version, and the app sends it back as `expectedVersion` on:

- `PATCH /api/items/[id]` (the editor and quick field edits, including stage, dates and *Use as caption*)
- `PATCH /api/ideas/[id]`
- `POST /api/ideas/[id]` (convert to a post; an already converted idea still returns its existing post)

A stale version gets **409** with the latest record. The app shows that version and explains why the edit wasn't saved; nothing is overwritten silently. Another user's id is always 404, never 409. Creates and deletes don't take a version.

**Missing `expectedVersion`** gets **428** ("Backlot was updated. Refresh the page to keep editing."). Tabs opened before this release don't send it. For the rollout window only, `BACKLOT_ALLOW_UNVERSIONED_WRITES_UNTIL=<UTC date>` accepts such writes, logging each one. The date must be at most 30 days ahead, and after it passes the variable is ignored, so it can't become a permanent bypass. See `docs/DEPLOYMENT.md`.

**Migration** (`src/db/migrations/2026-11-18_versions_and_slate_actions.sql`, or `npm run db:push`). It adds both version columns (a metadata-only change on Postgres 11+, so existing rows read as 1) and the `slate_actions` and `slate_action_events` tables. Before running it on a real database:

1. Take a backup.
2. Check the row counts.
3. Apply the migration *before* deploying the new app.
4. Expect instances still running the old code to keep working. Their edits don't bump versions, so full protection begins once every instance runs the new code.

The file includes rollback statements.

## Uploads

Production stores media in a private Cloudflare R2 bucket through `src/lib/storage/`. See `docs/STORAGE.md` for setup, CORS, limits and cleanup.

- Accepted: JPEG, PNG, WebP, GIF, AVIF and HEIC images up to **30 MB**; MP4, MOV, WebM, M4V and MKV video up to **500 MB** (beta limits, configurable). SVG is not accepted.
- Production: the browser uploads parts directly to R2 with short-lived, per-part signed URLs; the server completes the upload from R2's own part list. Locally: 2 MB chunks through `/api/upload/chunk`. Either way, retries never write twice and interrupted uploads resume.
- Each file's first bytes must match its type (a disguised script or web page is refused and deleted).
- Files are served only to the account that uploaded them (a short-lived signed R2 link after the ownership check).
- Each account has a storage quota (`STORAGE_QUOTA_GB`, default 1) and at most 2 uploads in progress at once; an app-wide ceiling (`STORAGE_APP_CEILING_GB`, default 9.5) protects the bill.
- Abandoned partial uploads are cancelled by the daily cleanup after 24 hours; the cleanup also removes bucket objects the database doesn't know about.
- Deleting a post or idea, or replacing its media, deletes files that nothing else uses. R2 keeps no recovery copy.

> **Hosting note.** Production must set `STORAGE_BACKEND=r2` and the `R2_*` settings. It refuses local disk, because a serverless instance's disk isn't durable.

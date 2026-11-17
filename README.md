# Content Vault

A private tracker for YouTube videos, Shorts, Reels and Instagram carousels: covers, video files, slides, captions, tags, ideas and a production board, plus a Gemini-powered "Studio AI" helper.

Next.js 15 · React 19 · Tailwind 4 · Firebase Auth (Google) · Postgres (Drizzle) · Gemini.

## Run locally

```bash
npm install
cp .env.example .env.local   # fill in the values
npm run db:push              # create/update the Postgres tables
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

The installed PWA opens at `/app`.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests (`node --test`) |
| `npm run db:push` | Apply `src/db/schema.ts` to Postgres (uses the `SQL_ADMIN_*` credentials) |

## Studio AI

- Signed-in only. The browser sends the conversation (last 30 messages) plus a compact snapshot of the vault: up to 40 recent posts (platform, stage, channel, dates, tags), up to 20 open ideas, and the focused post's caption when opened from "Ask AI".
- `app/api/chat/route.ts` verifies the user, validates sizes, wraps the snapshot in `<vault>` tags as data (not instructions), and calls Gemini (`GEMINI_MODEL`, default `gemini-4-hydrogen`) with a short system prompt. Busy/rate-limited calls retry twice.
- Limit: 30 messages per user per 10 minutes (in memory, per server instance).
- Chats are saved in the browser per account and cleared on sign-out.

## Uploads

- Accepted: JPEG, PNG, WebP, GIF, AVIF and HEIC images up to **30 MB**; MP4, MOV, WebM, M4V and MKV video up to **10 GB**. SVG is not accepted.
- Files upload in 2 MB chunks. A retried chunk is never written twice.
- Files are stored in `.uploads/` on the server's disk. They are served only to the account that uploaded them.
- Abandoned partial uploads are cleaned up after 24 hours.
- Deleting a post or idea, or replacing its media, deletes files that nothing else uses.

> **Hosting note.** `.uploads/` must be on a persistent disk. On Cloud Run the local disk is wiped on every deploy, so uploaded files would be lost. Mount a volume, or move file storage to an object store before relying on it.

# Backlot

A private workspace for creators. Keep every video, Short, Reel, TikTok and Instagram post together with its files, caption, hashtags and notes, save ideas as they come, and track each post from first idea to posted.

- **Library:** one card per post, filtered by platform, channel or stage
- **Ideas:** links, screenshots and notes, turned into posts in one tap
- **Calendar:** target and posted dates by month
- **Slate:** an AI creative partner that works from your own posts and ideas and suggests changes you approve

Backlot doesn't connect to social platforms or publish anything for you.

## Stack

Next.js 15 · React 19 · Tailwind CSS 4 · Supabase (Auth and Postgres, via Drizzle) · Cloudflare R2 · OpenAI with Anthropic fallback · Vercel

## Run locally

```bash
npm install
cp .env.example .env.local      # fill in the values
npm run db:migrate -- --apply   # create the tables
npm run dev                     # http://localhost:3000
```

No database yet? Open the app and choose **Try the live demo**: a sample workspace that runs in the browser and saves nothing.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm test` | Unit tests |
| `npm run db:migrate` | Dry run of the SQL migrations; add `-- --apply` to apply them |

## Deployment

Step by step: [docs/DEPLOY.md](docs/DEPLOY.md). Background and details: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the rest of [docs/](docs).

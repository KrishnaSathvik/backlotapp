# Costs and capacity (Vercel + Supabase + Cloudflare R2)

A planning model, not a quote. **Every number marked "verify" must be checked against the provider's current pricing page before you rely on it.** Prices and free allowances change. Nothing here promises that Backlot stays free.

## 1. Free allowances vs. spending caps

A **free allowance** is usage the provider doesn't bill. A **spending cap** is a hard stop that prevents a bill. They're different things: most free tiers here stop or degrade at the limit, but paid plans and pay-as-you-go services (R2 beyond its free allowance, OpenAI, Anthropic) keep charging unless you set a cap.

| Service | Free allowance (from the migration plan; verify) | What happens at the limit | Real spending cap available? |
| --- | --- | --- | --- |
| Vercel Hobby | Free hosting, function invocations, bandwidth within Hobby limits | Usage is paused or limited on Hobby; no overage billing | Hobby: no bill. **Hobby is personal, non-commercial use only.** Pro: Spend Management (set an amount, choose whether to pause projects) |
| Supabase Free | 500 MB database; 2 free projects | Database goes read-only or degraded near the limit; **the project pauses after 7 days of low activity** | Free: no bill. Paid: the spend cap (on by default on Pro) stops overage billing |
| Cloudflare R2 | 10 GB-month standard storage, 1 M Class A and 10 M Class B operations per month (verify), **no egress fees**. Enabling R2 requires adding a payment method | Billed beyond the allowance | No hard cap. Billing notifications only, plus Backlot's own app-wide ceiling |
| OpenAI | None | Billed per token | Project/org monthly budget and usage limits in the OpenAI dashboard |
| Anthropic | None | Billed per token | Workspace spend limits in the Anthropic Console |
| Cloudflare Workers (scheduler) | Free plan includes Cron Triggers and a daily request allowance (verify) | ~300 invocations/day is far below any limit | Free plan doesn't bill |
| GitHub Actions (backups) | Free minutes for private repos (verify current monthly quota); public repos are free | Private repo: billed beyond the quota if a payment method is set | Spending limit setting on the GitHub account (default $0) |
| Monitoring | Vercel runtime logs (Hobby keeps them for a short window, verify), Workers Logs, GitHub run history | — | — |

## 2. Controls already in the code

These cap usage no matter what the providers allow. All of them are environment-configurable.

| Control | Default | Setting |
| --- | --- | --- |
| Storage per creator (finished + in-progress) | 1 GB | `STORAGE_QUOTA_GB` |
| Concurrent uploads per creator | 2 | `UPLOAD_MAX_CONCURRENT` |
| Max video file | 500 MB | `NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB` (build-time) |
| Max image file | 30 MB | `NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB` (build-time) |
| App-wide storage warning | 8 GB → `storage.app_usage_high` log | `STORAGE_APP_WARN_GB` |
| App-wide storage ceiling | 9.5 GB → new uploads refused (507) | `STORAGE_APP_CEILING_GB` (`0` = off) |
| Slate rate limit | 30 messages / 10 min per creator | constant in `app/api/chat/route.ts` |
| Slate concurrency | 2 replies at once per creator | same |
| Slate daily ceiling | 200 messages / rolling 24 h per creator | `SLATE_DAILY_MESSAGE_LIMIT` |
| Image analysis | 30 / day per creator, explicit selection only | `SLATE_IMAGE_ANALYSIS=off` disables |
| Semantic search (embeddings) | on | `SLATE_SEMANTIC_SEARCH=off` disables; text search keeps working |
| Limiter failure mode | Fails closed (Slate refuses) if Postgres is unreachable | — |
| Retention | Slate actions 30 days, audit events 180 days | `SLATE_ACTION_RETENTION_DAYS`, `SLATE_AUDIT_RETENTION_DAYS` |

The app-wide ceiling is the only control that keeps R2 inside its free allowance. It's a soft guard: it counts bytes recorded in Postgres, not R2's billing meter. Parts of unfinished uploads count as reserved space at their declared size. If R2 turns out not to enforce the signed part length (RELEASE_CHECKLIST S-UP3), an unfinished upload could briefly hold more than declared until completion rejects it or the 2-day sweep (7-day lifecycle backstop) aborts it. That's a small, bounded cost exposure, not a data risk.

## 3. Provider-side controls to set before launch

- [ ] **OpenAI:** a monthly budget and a hard usage limit on the project whose key Backlot uses. A separate project/key for Backlot only.
- [ ] **Anthropic:** a workspace spend limit for the fallback key.
- [ ] **Cloudflare:** billing notifications for R2 storage and operations. Add a payment method only when you've decided to pay past the free allowance.
- [ ] **Supabase:** on Free, watch the database size in the dashboard. On a paid plan, keep the spend cap on unless you deliberately allow overage.
- [ ] **Vercel:** on Pro, configure Spend Management (amount and pause behaviour). Hobby has no bill, but also no commercial use.
- [ ] **GitHub:** keep the Actions spending limit at $0 unless you choose otherwise.

## 4. Assumptions (tune these)

| # | Assumption | Light | Typical | Heavy |
| --- | --- | --- | --- | --- |
| A1 | Stored media per creator | 200 MB | 600 MB | 1 GB (quota) |
| A2 | Media downloaded/viewed per creator per month | 0.5 GB | 2 GB | 5 GB |
| A3 | Slate messages per creator per active day | 5 | 20 | 60 |
| A4 | Active days per month | 8 | 15 | 25 |
| A5 | Input tokens per message (context, tools, history) | 4k | 8k | 15k |
| A6 | Output tokens per message | 400 | 800 | 1,500 |
| A7 | Share of messages that fall back to Claude | 2% | 5% | 20% (outage) |
| A8 | Posts + ideas per creator | 50 | 200 | 600 |
| A9 | Image analyses per creator per month | 2 | 10 | 40 |
| A10 | Uploads per creator per month | 10 | 30 | 80 |

**Database growth per creator** (rough; Postgres row overhead included, indexes add ~30–50%):

| Data | Size estimate |
| --- | --- |
| Posts and ideas | ~1–3 KB each → A8 × 2 KB |
| Embeddings (256 × `real` = 1 KB vector, plus row overhead and key) | ~1.2 KB per post/idea → A8 × 1.2 KB |
| Slate messages (text, refs, proposals) | ~2–4 KB each → A3 × A4 × 3 KB per month |
| Slate actions + audit events | ~1 KB each, pruned after 30/180 days |
| Uploaded-file and upload-session metadata | ~0.3 KB per file |

Typical creator: 200 × 3.2 KB ≈ 0.6 MB of content and embeddings, plus 20 × 15 × 3 KB ≈ 0.9 MB of chat per month. **Chat history is the part that grows without bound.** Conversations are kept until the creator deletes them; there's no automatic chat retention.

## 5. Formulas

```
R2 storage (GB-month)   = creators × A1
R2 storage cost / month = max(0, creators × A1 − 10 GB) × R2_price_per_GB_month          # verify price
R2 Class A ops / month  ≈ creators × A10 × (parts per file + 3)                           # create, sign/put parts, complete
R2 Class B ops / month  ≈ creators × (A2 / avg file size) × requests per view (range reads)
R2 egress               = $0 (R2 doesn't charge egress; verify)

Slate messages / month  = creators × A3 × A4            (≤ creators × 200 × 30 by the daily cap)
OpenAI cost / month     = messages × (1 − A7) × (A5 × in_price + A6 × out_price) / 1e6
Claude cost / month     = messages × A7 × (A5 × in_price + A6 × out_price) / 1e6
Embedding cost          = (posts/ideas embedded or re-embedded) × tokens per item × embed_price / 1e6
Image analysis          = creators × A9 × (image tokens + A6) at the provider's image pricing

DB size (MB)            ≈ creators × (A8 × 3.2 KB + months × A3 × A4 × 3 KB) / 1024 × 1.4 (indexes)
```

Fill the prices from OpenAI's and Anthropic's current pricing pages, and keep `src/lib/slate/providers.ts` (the price table behind the `est_cost_usd` log field) in sync with them. **No per-token price is stated here as fact.**

Worst case per creator per month (the caps hold): 200 messages/day × 30 days = 6,000 messages. Multiply by your per-message cost to get the maximum AI exposure per creator.

## 6. Scenarios (typical assumptions)

| | 10 creators | 100 creators | 1,000 creators |
| --- | --- | --- | --- |
| R2 storage | ~6 GB (≤10 GB at the 1 GB quota) | ~60 GB typical, ~100 GB at the quota | ~600 GB–1 TB |
| R2 cost | Inside the free allowance | `(100 − 10) GB × price` if everyone fills the quota. **The 9.5 GB ceiling refuses uploads first unless you raise it.** | Paid storage + operations |
| Downloads | ~20 GB/month, no egress fees | ~200 GB/month, no egress fees; Class B operations grow | Class B operations matter |
| Database after 6 months | ~0.6 MB + 10 × 6 × 0.9 MB ≈ 60–80 MB | ~600–800 MB: **over the 500 MB Free limit** at typical chat volume (light usage may fit) | Several GB: paid Supabase |
| Slate messages/month | ~3,000 | ~30,000 | ~300,000 |
| AI cost | `formula × 3,000` | `formula × 30,000` | `formula × 300,000`; budget limits essential |
| Vercel | Hobby limits OK *if non-commercial* | Watch function duration and invocations (every image/video view is a function call that redirects) | Pro or higher |
| Scheduler | Free | Free | Free (same ~300 calls/day) |
| Backups | Dump ≪ 100 MB; a few hundred MB in R2 at 30-day retention | Hundreds of MB × 30 days → counts toward R2 storage | GBs; paid R2 and possibly paid Actions minutes |

### Conclusions

- **10 creators:** likely fits the free tiers, *excluding AI usage*, which is always billed. Two blockers remain even at $0: Vercel Hobby forbids commercial use, and Supabase Free pauses after 7 days of low activity (Slate fails closed and the app is unavailable until it resumes).
- **100 creators:** at 1 GB each, storage is ~100 GB, well past R2's 10 GB-month allowance. Paid R2 storage ≈ `(100 − 10) × price per GB-month`, and the default 9.5 GB ceiling has to be raised deliberately. The database approaches or passes Supabase Free's 500 MB, depending mostly on chat volume. Expect Supabase Pro.
- **1,000 creators:** paid plans everywhere: Vercel Pro (or higher), Supabase Pro with compute sized for it, paid R2, and AI budgets sized from the formulas above.

Backlot is not a permanently free application. The free tiers are a starting point for a small, personal, non-commercial beta.

## 7. What to watch (monitoring)

| Signal | Where |
| --- | --- |
| `storage.app_usage_high`, `storage.app_ceiling_reached` | Vercel runtime logs |
| Database size vs. 500 MB | Supabase dashboard → Database / Usage |
| Project paused | Supabase dashboard; `/api/health?ready=1` returns 503 `database` |
| R2 storage and operations | Cloudflare dashboard → R2 → Metrics; billing notifications |
| AI spend | OpenAI / Anthropic usage dashboards; `slate.reply` events with `est_cost_usd` |
| Backup runs | GitHub Actions run history (failure emails) and `db/latest.json` in the backups bucket |
| Scheduler runs | Cloudflare Workers Logs for `backlot-scheduler` |

Vercel Hobby keeps runtime logs only briefly (verify the current retention). For anything you need to keep, add a log drain (a Pro feature) or rely on the provider dashboards above.

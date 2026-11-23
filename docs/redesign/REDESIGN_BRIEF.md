# Backlot redesign brief (for the local agent)

Mockup to match: https://claude.ai/artifact/Q1QXgmf4XcaEMgeBxz7hcM
(Library + Post, desktop + phone, dark + light.)

Ground rules
- The working tree has uncommitted changes. Do not reset, stash or discard them; build on top.
- Work phase by phase. After each phase: `npm run typecheck && npm run lint && npm test`, then check the app at 375px, 768px and 1280px in both themes.
- Keep every existing feature working (uploads, zip download, copy buttons, Slate, demo mode, optimistic versions).

---

## Phase 1 — Colours and type (midnight black / electric blue / cantaloupe orange)

`app/globals.css` already defines `electric-*`, `cantaloupe-*` and a `zinc-*` scale (zinc-950 = `#07080c` midnight). Keep those. Add semantic tokens and use them instead of ad-hoc translucent greys:

| Token | Light | Dark |
|---|---|---|
| `--bg` page | `#FFFFFF` | `#07080C` |
| `--surface` card | `#FFFFFF` | `#0F1117` |
| `--surface-2` tile / input / chip | `#EEF0F3` | `#171A22` |
| `--border` | `#E2E4E9` | `#232631` |
| `--border-strong` dashed drop zones | `#C9CCD4` | `#30343F` |
| `--text` | `#07080C` | `#F6F7F9` |
| `--muted` | `#4B5060` | `#9298A5` |
| `--faint` meta text | `#6A7080` | `#7F8595` |
| `--accent` primary buttons | `#2E66FF` | `#2E66FF` |
| `--link` Copy links, accent text | `#1A4DFF` | `#8AADFF` |

Changes:
1. `src/components/ui.tsx` `cardStyles`: solid `--surface` + `--border` (drop `dark:bg-zinc-900/60` and the `/80` alpha borders). Cards must sit visibly one step above the page.
2. Remove the two blurred glow blobs in `ContentVaultApp.tsx` (~line 916–917). They make the page title unreadable in dark mode.
3. One font: use Plus Jakarta Sans for headings too (drop Bricolage from `h1, h2` in globals.css and `font-display` in app components; the marketing site under `components/site/` can keep it).
4. Electric blue only for primary buttons, selection, focus, links. Cantaloupe only for the "Made" stage and Slate. No other hues in the app UI (platform icons can go one colour: `--muted`).
5. Selected chips: solid `--text` background with `--bg` text.

## Phase 2 — Three stages: Planned · Made · Posted

Today `StatusKey = 'idea' | 'scripting' | 'editing' | 'ready' | 'posted'`.

1. Keep the DB values. Show three stages only: `idea` = **Planned**, `ready` = **Made**, `posted` = **Posted**.
2. SQL migration (new file in `ops/supabase/manual-setup/` + `src/db/migrations`): `update content_items set status='idea' where status in ('scripting','editing');`
3. Add `normalizeStatus()` in `content-logic.ts` mapping any legacy `scripting`/`editing` to `idea`; use it where items are read and in Slate tools (`src/lib/slate/*`, 22 references to scripting/editing).
4. `STATUS_OPTIONS`, `STAGE_STYLES` (ui.tsx), the stage summary in `AppShell.tsx` (~line 414, "In progress"), `nextStatus`/`prevStatus`, filters and tests: three stages only.
5. Stage colours: Planned = grey pill (`--surface-2` / `--muted`), Made = cantaloupe (light `#FFF5EE` bg / `#C45213` text; dark `rgba(255,133,64,.15)` / `#FF9A5A`), Posted = electric (light `#EAF0FF` / `#1A4DFF`; dark `rgba(46,102,255,.18)` / `#8AADFF`). Remove violet and emerald.
6. Setting a post to Posted fills `postDate` with today if empty and focuses the Live link field.

## Phase 3 — Navigation

- Desktop (lg+): keep the sidebar: Library, Ideas, Calendar, Slate, then Channels.
- Tablet (md): keep the icon rail.
- Phone (< md): replace the ☰ drawer as the main nav with a fixed **bottom tab bar**: Library · Ideas · **+** · Calendar · Slate (44px+ targets, `pb-safe`). Channels move into the Library filter sheet. Keep the drawer only for account/settings.
- **+** (bottom bar on phone, "+ New" button in the page header on desktop/tablet) opens a small chooser: **New post** / **New idea**.

## Phase 4 — Library page

1. Header on one line: page title, search, sort, **+ New**. Remove `QuickPostBar` from the top of the Library (the + button replaces it).
2. Replace the five stage summary cards with one chip row: All · Planned · Made · Posted (with counts). Platform filter as a second, quieter row on desktop; inside the Filters sheet on phone.
3. Posts must be visible in the first screen on a 375×812 phone.
4. Cards: cover tile, title (2 lines), platform + stage pill. A post with no files shows a dashed **"+ Add files"** tile; clicking it opens the file picker directly and uploads into that post (no detour through the post page).
5. Grid: 4 columns desktop, 3 tablet, 2 phone.

## Phase 5 — Post page (`ItemDetailModal.tsx`)

Today files are added through a separate modal (`onEditFiles` → `ItemEditorModal`). Make files inline:

1. Order: title → **files** → caption → tags → details → notes. Desktop: files left (wide), text/details right. Phone: one column.
2. Inline drop zone "Drop images, videos or slides here · or click to browse". Reuse `uploadAssetResumable` from `src/lib/upload-client`; show progress inline. On phone, the picker accepts photos and videos.
3. Slides: thumbnails in order with a number badge, drag to reorder, per-file download button, remove. Cover and video shown above slides.
4. Keep **Download all** (zip with caption + tags) and Copy buttons.
5. Stage switch as a segmented control in the header (Planned / Made / Posted).
6. Phone: sticky bottom bar with **Copy caption** and **Download all**.
7. Label the caption field "Description" for `youtube_long`, "Caption" otherwise.
8. If the post came from an idea (`sourceIdeaId`), show a small "From idea" card linking back.
9. `ItemEditorModal` stays for New post only (or is folded into the inline editor).

## Phase 6 — New post

`NewPostDialog`: title + platform (+ optional channel) → **Create** → open the new post's page immediately with the drop zone ready. No other fields up front.

## Phase 7 — Ideas

1. One capture box at the top (`QuickIdeaBar`): "Paste a link, drop images or type an idea". Enter saves. Dropped/pasted images attach (up to `MAX_IDEA_IMAGES`).
2. Cards by kind: link (preview), images (thumbnails), note (text).
3. Filters: All · Links · Images · Notes · **Used** (ideas with `convertedItemId`).
4. Idea sheet: main button **Turn into post** (rename "Make it a post") → pick platform → creates a Planned post with the idea's images as references and notes copied (existing `convertIdeaVersioned`) → idea shows under Used with "Open post".

## Phase 8 — Calendar

1. Same stage colours as the Library. Made/Planned on `targetDate`, Posted on `postDate`.
2. Drag a post to another day to change `targetDate`; click an empty day to create a post on that date.
3. "Unscheduled" tray: Made posts with no `targetDate`; drag onto a day.
4. Phone: week list instead of the month grid.

## Phase 9 — Slate and Channels

- Slate: unchanged behaviour; restyle with the new tokens; keep "Ask Slate" on posts and ideas; suggested changes stay Apply/Skip cards.
- Channels: name + platform; clicking one opens the Library filtered to it.

## Phase 10 — Import Krishna's existing topics

`docs/redesign/tracker-import.json` holds 85 posts from his old tracker (`title`, `platform`, `status`, `notes`) already mapped to Backlot keys (Planned→`idea`, Made→`ready`, Posted→`posted`). Add a one-off script `scripts/import-tracker.ts` that inserts them for his user (skip titles that already exist). Dry run by default, `--apply` to write.

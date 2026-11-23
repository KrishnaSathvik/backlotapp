# Media storage (Cloudflare R2)

Creator uploads (covers, slides, videos, idea screenshots) live in a **private Cloudflare R2 bucket** in production. Local development uses `.uploads` on disk. The earlier Google Cloud Storage store (`STORAGE_BACKEND=gcs`) is kept as legacy code only, so existing files can be read during a migration. It is not a production default.

**Nothing here has been run against a real R2 bucket yet.** The design has passed local checks with a fake R2 and real SQL (PGlite), in `src/lib/storage/direct.test.ts`. "Unverified against real R2" below lists what still needs the final test cycle.

## How it works

| Step | What happens |
| --- | --- |
| Start | The browser calls `POST /api/upload/session` with `{ uploadId, fileName, mimeType, size }`. The server checks the declared type and size against the limits. It then reserves the creator's quota, a concurrent-upload slot and space under the app-wide ceiling, all in one transaction under transaction-scoped advisory locks (per account, then global). The server picks a random object key and opens a multipart upload in R2. If opening fails, the reservation is removed. The R2 upload id is stored in `upload_sessions` (sealed with `UPLOAD_SESSION_KEY` when set). Local development answers `{ mode: 'chunked' }`, and the browser uses `/api/upload/chunk` instead. |
| Parts | `POST /api/upload/parts { uploadId, partNumbers }` (at most 20 per call) returns presigned PUT URLs. Each URL can write only one part number of that one upload of that server-chosen key, with exactly the signed `Content-Length`, and it expires after `UPLOAD_PART_URL_TTL_SEC` (default 900 s). Parts are 8 MiB, raised as needed to stay under 10,000 parts. The browser PUTs the parts directly to R2, 3 at a time, so video bytes never pass through Vercel. The URLs are bearer capabilities: they're returned only to the signed-in owner and never logged. |
| Complete | `POST /api/upload/complete { uploadId }`. R2's own `ListParts` is the source of truth, not the browser's report. Every part from 1 to N must be present with its exact expected size. Parts are sorted ascending, then the server completes the upload, checks the finished object's size against the declared size, and reads its first 64 bytes for the content-type check (`sniff.ts`). Only then is the `uploaded_files` row (ownership) written. |
| Rejection | Extra parts, a wrong part size, a wrong object size or a disguised file (for example HTML named `.mp4`) all have the same result: the multipart upload is aborted, the object deleted, the session marked `aborted`, and the reservation released. |
| Resume | The same file (name, size, type, last modified) picked again within a day reuses its `uploadId`, kept in `localStorage`. Starting it again returns the parts R2 already has. `409 { missingParts }` from complete tells the browser exactly what to re-send. An expired part URL (403) is signed again in the next round. A refresh, a lost response or a different Vercel instance all resume from R2's state. |
| Repeat / race | Complete is safe to repeat: after completion it returns the same asset. If R2 completed the upload but the database write failed, a retry finds the object, re-checks it and records it. |
| Cancel | `DELETE /api/upload/session?uploadId=…` (the client sends it when its `AbortSignal` fires). It aborts the multipart upload, deletes any bytes that have no file row, and releases the reservation. |
| Serving | `GET /api/files/<key>` checks that the signed-in user owns the row (otherwise 404), then answers 302 to a signed R2 GET. The URL is valid for `FILE_URL_TTL_SEC` (default 300 s), reads only that object, and has the content type and disposition fixed by the server. Video range requests (seeking) go straight to R2. The signed URL is on R2's origin, so a file's bytes can't run as part of Backlot's site. `STORAGE_DELIVERY=proxy` streams through the function instead, with ranges, `nosniff` and a sandboxing CSP (subject to Vercel payload and duration limits). |
| Download all | Zips in the browser from the same URLs. The redirect makes these cross-origin requests to R2, so the bucket needs CORS for GET. Browsers drop the `Authorization` header on a cross-origin redirect. |
| Slate images | Read server-side through the store (`readBuffer`, size-capped). They're decoded, downscaled and stripped of EXIF in memory. They're never posted through a function request body, and videos are never sent to AI. |
| Deleting | Files no longer used by any post or idea are deleted from R2 (`collectUnusedFiles`). Account deletion aborts unfinished uploads and deletes every object (docs/ACCOUNT_DELETION.md). |

Code: `src/lib/storage/` contains `r2.ts` (store), `uploads.ts` (reservation, direct and chunked state machines, cleanup), `sniff.ts`, `local.ts`, `gcs.ts` (legacy) and `types.ts`. No route or component imports the S3 SDK directly.

## Deletion and recovery policy

R2 is used **without soft delete or object versioning**. A deleted object is gone immediately and Backlot can't recover it. `STORAGE_SOFT_DELETE_DAYS` defaults to `0` for R2, so the deletion status page shows no recovery window. Don't set it to anything else unless the bucket's real policy changes. The privacy page must match this (no "recoverable for 7 days" promise).

## Cleanup (daily maintenance job)

| What | Rule |
| --- | --- |
| Expired upload sessions (24 h) | Multipart upload aborted, object deleted if it has no file row, session marked `aborted`. Old finished sessions are forgotten after 7 days. |
| Abandoned multipart uploads | Uploads in R2 older than 2 days with no live session are aborted. |
| Orphan objects | Objects under `R2_PREFIX` that are older than `STORAGE_ORPHAN_MIN_AGE_DAYS` (default 7), have no `uploaded_files` row and have no active session are deleted. Up to 2,000 objects are scanned per run. |
| Safety stop | If more than half of the scanned objects (and more than 10) look orphaned, nothing is deleted and `storage.orphan_sweep_refused` is logged as CRITICAL. That pattern means the app is pointed at the wrong, empty or restored database. |
| Unknown keys | Keys that aren't Backlot's UUID format are counted and reported, never deleted. |
| Transient errors | Deletions happen only after the database has answered. A failed query throws before anything in that batch is deleted. |
| Deletion ledger | Lives under `R2_LEDGER_PREFIX` (default `ledger/account-deletions/`), outside the media prefix, so the sweep never sees it (docs/BACKUPS.md). |

`STORAGE_ORPHAN_SWEEP=off` disables the sweep. Pause the maintenance job during any database restore.

## Configuration

| Variable | Value |
| --- | --- |
| `STORAGE_BACKEND` | `r2` in production; `local` (or unset) for development; `gcs` legacy only |
| `R2_ACCOUNT_ID`, `R2_BUCKET` | Cloudflare account id, media bucket name |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | R2 API token for this bucket only (server-side) |
| `R2_ENDPOINT` | Optional. Default `https://<account>.r2.cloudflarestorage.com`; set the `.eu.` form for an EU-jurisdiction bucket |
| `R2_PREFIX` | Media key prefix, default `uploads/` |
| `R2_LEDGER_PREFIX`, `R2_LEDGER_BUCKET` | Deletion ledger location (default same bucket, `ledger/account-deletions/`) |
| `UPLOAD_SESSION_KEY` | Optional for R2 (an R2 upload id alone can't write anything). Required only with legacy `gcs` |
| `FILE_URL_TTL_SEC` | Signed read URL lifetime, default 300 |
| `STORAGE_DELIVERY` | `proxy` to stream through the app instead of redirecting |
| `STORAGE_SOFT_DELETE_DAYS` | Default 0 for R2. Must match the bucket |

### Private-beta limits (configurable)

| Limit | Default | Variable |
| --- | --- | --- |
| Image file | 30 MB | `NEXT_PUBLIC_UPLOAD_MAX_IMAGE_MB` (build-time; redeploy to change) |
| Video file | 500 MB | `NEXT_PUBLIC_UPLOAD_MAX_VIDEO_MB` (build-time) |
| Storage per creator (finished + in progress) | 1 GB | `STORAGE_QUOTA_GB` |
| Concurrent uploads per creator | 2 | `UPLOAD_MAX_CONCURRENT` |
| App-wide warning (`storage.app_usage_high`) | 8 GB | `STORAGE_APP_WARN_GB` |
| App-wide ceiling (new uploads get 507 with a clear message; existing files are untouched) | 9.5 GB | `STORAGE_APP_CEILING_GB` (`0` turns it off) |
| Part URL lifetime | 900 s | `UPLOAD_PART_URL_TTL_SEC` (60–3600) |
| Orphan sweep / minimum age | on / 7 days | `STORAGE_ORPHAN_SWEEP`, `STORAGE_ORPHAN_MIN_AGE_DAYS` |

The storage layer supports far larger files (up to 10,000 parts). These are cost limits, not technical ones.

Supported types: images (JPEG, PNG, WebP, GIF, AVIF, HEIC/HEIF) and videos (MP4, MOV, M4V, WebM, MKV). SVG is excluded because it can carry script.

## Bucket setup (not done; needs approval)

1. **Create a media bucket** (for example `backlot-media`), private, with a location hint near the Vercel region (`iad1` → Eastern North America). Leave the **r2.dev public URL disabled** and attach **no public custom domain**.
2. **Create an API token**: R2 → Manage API tokens → *Object Read & Write*, **scoped to this bucket only**. Put its key id and secret in Vercel env vars (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`), never in the client.
3. **CORS** (bucket → Settings → CORS policy). List only the real origins; add a preview origin only while testing:

   ```json
   [
     {
       "AllowedOrigins": ["https://backlotapp.vercel.app", "http://localhost:3000"],
       "AllowedMethods": ["GET", "HEAD", "PUT"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

4. **Lifecycle rule:** abort incomplete multipart uploads after 7 days, as a backstop to the app's own 2-day sweep. Add no object-expiration rule on the media bucket.
5. Versioning stays off; there is no soft delete.
6. Use a separate bucket and token for database backups (docs/BACKUPS.md). Never use the media token for them.

Check current R2 pricing and free allowances (storage, Class A/B operations) before launch. Multipart part uploads and listings are billable operations. Verify the numbers; don't assume them.

## Existing files

- `scripts/migrate-uploads-to-gcs.ts` is **legacy** (local disk → Cloud Storage). It doesn't target R2.
- Copying any existing files (from `.uploads` or a GCS bucket) into R2 is a **separate step that needs approval**. No script for it has been written.
- If you do it, keep keys unchanged (`R2_PREFIX + storage_key`) so no database rows change. Verify size and checksum per object, and never delete the source until the copy is reviewed.

## Unverified against real R2

- That R2 **enforces the signed `Content-Length`** on presigned part URLs (the SDK signs `content-length;host`; checked offline only).
- **CORS**: browser PUTs of parts, and the GET that "Download all" makes after the cross-origin redirect.
- **Redirect + Range from `<video>`**: seeking after the 302 to a signed URL, in Safari, Chrome and Firefox (desktop and mobile).
- **`ListParts` / `ListObjectsV2` / `ListMultipartUploads` pagination** on large uploads and buckets.
- That `ResponseContentType` / `ResponseContentDisposition` overrides are honored on signed GETs.
- That no default checksum parameters end up in presigned URLs on the deployed SDK version (`requestChecksumCalculation: 'WHEN_REQUIRED'`).

## Final-verification scenarios (for the test cycle)

1. Upload an image and a 400 MB video. Cut the network mid-upload and confirm it resumes; refresh the page, pick the same file again and confirm it continues from R2's parts; the finished object matches byte-for-byte.
2. Upload two files at once, then try a third and expect the "files at a time" limit.
3. Upload a renamed `.html` as `.png` / `.mp4` and expect the "doesn't look like a valid…" refusal, with no object left in the bucket.
4. Use a part URL for a different part number, a different length, or after it expires: R2 refuses each one.
5. Cancel an upload: the multipart upload is gone from R2 and the quota is released.
6. Thumbnails, cover, slide gallery, idea screenshot, single download and Download all load (302 → R2).
7. Video seeking works after the redirect.
8. Another account requests a known `/api/files/<key>` and gets 404. A signed URL stops working after `FILE_URL_TTL_SEC`. The bucket has no public URL.
9. Replace a cover and delete a post: the unused objects are removed.
10. Slate image analysis on a cover stored in R2.
11. Exceed the per-account quota, and (with a low `STORAGE_APP_CEILING_GB`) the app ceiling: both give clear errors.
12. Abandon an upload: after expiry the maintenance job aborts it. Leave an orphan object older than the minimum age and confirm it's deleted. Point a test deployment at an empty database and confirm the sweep refuses.
13. Account deletion removes every object of that account, including unfinished uploads.

import { relations, sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, real, serial, text, timestamp, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core';

export interface MediaAssetRecord {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  order?: number;
}

export interface ReferenceAttachment {
  id: string;
  url: string;
  title: string;
  note: string;
  screenshotUrl: string;
}

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const channels = pgTable('channels', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  name: text('name').notNull(),
  handle: text('handle').default('').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('channels_user_idx').on(t.userUid)]);

export const contentItems = pgTable('content_items', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  title: text('title').notNull(),
  platform: text('platform').notNull().default('youtube_long'),
  channelId: integer('channel_id'),
  channelName: text('channel_name').default('').notNull(),
  status: text('status').notNull().default('idea'),
  caption: text('caption').default('').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  notes: text('notes').default('').notNull(),
  liveLink: text('live_link').default('').notNull(),
  postDate: text('post_date').default('').notNull(),
  targetDate: text('target_date').default('').notNull(),
  coverAsset: jsonb('cover_asset').$type<MediaAssetRecord | null>().default(null),
  videoAsset: jsonb('video_asset').$type<MediaAssetRecord | null>().default(null),
  slides: jsonb('slides').$type<MediaAssetRecord[]>().default([]).notNull(),
  attachedReferences: jsonb('attached_references').$type<ReferenceAttachment[]>().default([]).notNull(),
  sourceIdeaId: integer('source_idea_id'),
  /**
   * The post this one was adapted from (Slate repurposing). Different from sourceIdeaId
   * (made from a saved idea). If the original is deleted, this becomes null; the adapted
   * post stays.
   */
  repurposedFromPostId: integer('repurposed_from_post_id').references((): AnyPgColumn => contentItems.id, { onDelete: 'set null' }),
  /** Optimistic-concurrency version: starts at 1, +1 on every successful change. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [index('content_items_user_idx').on(t.userUid)]);

export const ideas = pgTable('ideas', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  title: text('title').notNull(),
  linkUrl: text('link_url').default('').notNull(),
  linkTitle: text('link_title').default('').notNull(),
  linkDomain: text('link_domain').default('').notNull(),
  screenshotUrl: text('screenshot_url').default('').notNull(),
  notes: text('notes').default('').notNull(),
  platform: text('platform').notNull().default('youtube_long'),
  channelName: text('channel_name').default('').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]).notNull(),
  targetDate: text('target_date').default('').notNull(),
  convertedItemId: integer('converted_item_id'),
  /** Optimistic-concurrency version: starts at 1, +1 on every successful change. */
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('ideas_user_idx').on(t.userUid)]);

export const uploadedFiles = pgTable('uploaded_files', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  storageKey: text('storage_key').notNull().unique(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('uploaded_files_user_idx').on(t.userUid)]);

/**
 * In-progress chunked uploads. Lets any server instance continue an upload (the storage session
 * lives here, not in memory) and lets cleanup cancel abandoned ones. `sessionRef` is the
 * storage-side upload session (for Cloud Storage, a resumable-upload URI that works like a
 * credential): it never leaves the server.
 */
export const uploadSessions = pgTable('upload_sessions', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  /** Client-generated id for this upload (scoped to the user). */
  uploadId: text('upload_id').notNull(),
  /** Server-generated object key; becomes uploaded_files.storage_key when complete. */
  storageKey: text('storage_key').notNull().unique(),
  sessionRef: text('session_ref').notNull(),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  totalSize: bigint('total_size', { mode: 'number' }).notNull(),
  received: bigint('received', { mode: 'number' }).notNull().default(0),
  /** active | complete | aborted */
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull(),
  updatedAt: timestamp('updated_at').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [uniqueIndex('upload_sessions_user_upload_uq').on(t.userUid, t.uploadId), index('upload_sessions_status_idx').on(t.status, t.expiresAt)]);

/**
 * Slate creative preferences, explicitly saved by the creator (never inferred).
 * channel_id null = applies to every channel; a channel row overrides the global one.
 */
export const slatePreferences = pgTable('slate_preferences', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  channelId: integer('channel_id'),
  key: text('key').notNull(),
  value: text('value').notNull(),
  /** 'user' (set in the preferences panel) or 'slate_confirmed' (proposed in chat, confirmed by the creator). */
  source: text('source').notNull().default('user'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('slate_preferences_user_idx').on(t.userUid),
  uniqueIndex('slate_preferences_scope_key_uq').on(t.userUid, sql`coalesce(${t.channelId}, 0)`, t.key),
]);

/**
 * Changes Slate proposed. Nothing here touches creator content until the creator
 * approves an action; the executor then applies it with a version check.
 */
export const slateActions = pgTable('slate_actions', {
  id: serial('id').primaryKey(),
  /** Unguessable id used by the browser. */
  publicId: text('public_id').notNull().unique(),
  userUid: text('user_uid').notNull(),
  /** post_update | stage_change | target_date | post_create | idea_convert */
  kind: text('kind').notNull(),
  /** Actions proposed together (up to 5) share a batch id. */
  batchId: text('batch_id'),
  /** 'post' | 'idea' | null (new draft). */
  targetType: text('target_type'),
  targetId: integer('target_id'),
  /** The target's version when Slate proposed the change. */
  baseVersion: integer('base_version'),
  /** Server-validated change: { changes } for updates, { draft } for new posts. */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  /** The proposed fields' values at proposal time, for the preview. */
  before: jsonb('before').$type<Record<string, unknown>>().default({}).notNull(),
  targetTitle: text('target_title').default('').notNull(),
  summary: text('summary').default('').notNull(),
  reason: text('reason').default('').notNull(),
  /** pending | applied | dismissed | expired | conflict | failed */
  status: text('status').notNull().default('pending'),
  resultPostId: integer('result_post_id'),
  resultIdeaId: integer('result_idea_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  decidedAt: timestamp('decided_at'),
}, (t) => [index('slate_actions_user_idx').on(t.userUid, t.createdAt)]);

/** Audit trail for Slate actions. Holds ids, versions and outcomes, never content. */
export const slateActionEvents = pgTable('slate_action_events', {
  id: serial('id').primaryKey(),
  actionId: integer('action_id').notNull(),
  userUid: text('user_uid').notNull(),
  /** proposed | edited | applied | dismissed | expired | conflict | failed | already_applied */
  event: text('event').notNull(),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [index('slate_action_events_action_idx').on(t.actionId)]);

/**
 * Slate conversations, stored per creator so they continue across devices.
 * Conversation content is only ever used inside its own conversation; it never becomes a
 * saved preference (those are explicit, in slate_preferences).
 */
export const slateConversations = pgTable('slate_conversations', {
  id: serial('id').primaryKey(),
  /** Unguessable id used by the browser. */
  publicId: text('public_id').notNull().unique(),
  userUid: text('user_uid').notNull(),
  title: text('title').notNull().default('New chat'),
  /** Condensed notes on older turns that no longer fit the model's window. */
  summary: text('summary').notNull().default(''),
  /** Messages with seq <= this are covered by `summary` (1..N); they are never condensed again. */
  summarizedThrough: integer('summarized_through').notNull().default(0),
  summaryUpdatedAt: timestamp('summary_updated_at'),
  archivedAt: timestamp('archived_at'),
  createdAt: timestamp('created_at').notNull(),
  lastMessageAt: timestamp('last_message_at').notNull(),
}, (t) => [index('slate_conversations_user_idx').on(t.userUid, t.lastMessageAt)]);

export const slateMessages = pgTable('slate_messages', {
  id: serial('id').primaryKey(),
  conversationId: integer('conversation_id').notNull(),
  userUid: text('user_uid').notNull(),
  /** 1, 2, 3… within the conversation. */
  seq: integer('seq').notNull(),
  /** 'user' | 'model' */
  role: text('role').notNull(),
  text: text('text').notNull(),
  /** Reply cut short (Stop, error mid-answer or output cap). */
  stopped: integer('stopped').notNull().default(0),
  /** Validated references, preference proposals and suggested-action ids shown with a reply. */
  refs: jsonb('refs').$type<unknown[]>().default([]).notNull(),
  proposals: jsonb('proposals').$type<unknown[]>().default([]).notNull(),
  actionIds: jsonb('action_ids').$type<string[]>().default([]).notNull(),
  /** What the creator attached (e.g. which image Slate looked at): labels only, never the file. */
  attachments: jsonb('attachments').$type<{ kind: 'image'; label: string }[]>().default([]).notNull(),
  createdAt: timestamp('created_at').notNull(),
}, (t) => [
  uniqueIndex('slate_messages_conversation_seq_uq').on(t.conversationId, t.seq),
  index('slate_messages_user_idx').on(t.userUid),
]);

/**
 * Text embeddings of the creator's posts and ideas for meaning-based search (OpenAI, the
 * primary provider). Derived data: rebuilt from the source when its text changes, deleted
 * with it, and never shared between users.
 */
export const slateEmbeddings = pgTable('slate_embeddings', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  /** 'post' | 'idea' */
  targetType: text('target_type').notNull(),
  targetId: integer('target_id').notNull(),
  model: text('model').notNull(),
  /** sha256 of model, dimensions and the embedded text: a mismatch means "re-embed". */
  contentHash: text('content_hash').notNull(),
  vector: real('vector').array().notNull(),
  updatedAt: timestamp('updated_at').notNull(),
}, (t) => [uniqueIndex('slate_embeddings_target_uq').on(t.userUid, t.targetType, t.targetId)]);

/** One row per Slate request, shared by every server instance (see shared-limits.ts). */
export const slateUsageLeases = pgTable('slate_usage_leases', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull(),
  startedAt: timestamp('started_at').notNull(),
  /** An unreleased lease stops counting after this, so a crashed request can't hold a slot. */
  expiresAt: timestamp('expires_at').notNull(),
  releasedAt: timestamp('released_at'),
  /** 'chat' or 'image' (a message with an image, which also has a daily limit). */
  kind: text('kind').notNull().default('chat'),
}, (t) => [index('slate_usage_leases_user_idx').on(t.userUid, t.startedAt)]);

/** Circuit-breaker state per AI provider, shared by every server instance. */
export const slateBreakerState = pgTable('slate_breaker_state', {
  provider: text('provider').primaryKey(),
  failures: integer('failures').notNull().default(0),
  windowStartedAt: timestamp('window_started_at'),
  openUntil: timestamp('open_until'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

/**
 * Account deletion jobs (Launch L2). One row per account. While a row exists the account is
 * locked: every authenticated route refuses it, so nothing new can be written. The job runs in
 * the background (see src/lib/account/deletion.ts), one idempotent step at a time, and is only
 * marked completed after a final check finds nothing left.
 *
 * After completion the row is a tombstone holding the uid, dates and step times (no content,
 * no email), kept `ACCOUNT_DELETION_RECORD_DAYS` (default 30) so the status page works, then
 * removed by the daily cleanup.
 */
export const accountDeletions = pgTable('account_deletions', {
  id: serial('id').primaryKey(),
  userUid: text('user_uid').notNull().unique(),
  /**
   * SHA-256 (hex) of the status-page token. The token itself (32 random bytes) is only ever
   * given to the creator, in the status link; the server can't reconstruct it. It's separate
   * from the uid and the row id, and stops working when this record is removed.
   */
  statusTokenHash: text('status_token_hash').notNull().unique(),
  /** pending (grace period) | running (retries with backoff until done) | completed */
  status: text('status').notNull().default('pending'),
  /** Step name → ISO time it finished. */
  steps: jsonb('steps').$type<Record<string, string>>().default({}).notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** Short error code from the last failed attempt (never content or tokens). */
  lastError: text('last_error'),
  requestedAt: timestamp('requested_at').notNull(),
  nextAttemptAt: timestamp('next_attempt_at').notNull(),
  /** A worker holds the job until this time (so two instances never run it at once). */
  lockedUntil: timestamp('locked_until'),
  updatedAt: timestamp('updated_at').notNull(),
  completedAt: timestamp('completed_at'),
}, (t) => [index('account_deletions_due_idx').on(t.status, t.nextAttemptAt)]);

export const usersRelations = relations(users, ({ many }) => ({
  channels: many(channels),
  contentItems: many(contentItems),
  ideas: many(ideas),
}));

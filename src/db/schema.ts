import { relations } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

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

export const usersRelations = relations(users, ({ many }) => ({
  channels: many(channels),
  contentItems: many(contentItems),
  ideas: many(ideas),
}));

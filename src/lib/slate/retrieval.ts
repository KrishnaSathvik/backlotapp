import { buildContextBlock, type ContextParts } from './context.ts';
import { effectivePreferences, validatePreference, type PreferenceKey } from './preferences.ts';
import { classifyTask, type SlateTask } from './tasks.ts';
import type { EntityRef } from './tools.ts';
import type { ChannelRecord, SlateFocus, SlateStore } from './types.ts';

/**
 * Builds the small starting context for a request, scoped to the authenticated
 * user. Since Milestone 2, Slate fetches anything else it needs through tools,
 * so this no longer includes fixed lists of posts or ideas: just today's date,
 * channels (with ids for tool calls), the channel scope, the focused post or
 * idea, and the creator's applicable saved preferences.
 *
 * Focus and channel ids come from the client but are only honored when they
 * belong to `uid`.
 */

export interface ContextRequest {
  uid: string;
  question: string;
  focus: SlateFocus | null;
  channelId: number | null;
  today: string;
}

export type ContextResult =
  | { ok: true; task: SlateTask; context: string; focusTitle: string | null; knownRefs: EntityRef[] }
  | { ok: false; status: 404; error: string };

export async function gatherContext(store: SlateStore, req: ContextRequest): Promise<ContextResult> {
  const { uid } = req;

  let scope: ChannelRecord | null = null;
  if (req.channelId !== null) {
    scope = await store.getChannel(uid, req.channelId);
    if (!scope) return { ok: false, status: 404, error: 'That channel isn’t in your Backlot.' };
  }
  const focusPost = req.focus?.type === 'post' ? await store.getPost(uid, req.focus.id) : null;
  const focusIdea = req.focus?.type === 'idea' ? await store.getIdea(uid, req.focus.id) : null;
  if (req.focus && !focusPost && !focusIdea) {
    return {
      ok: false,
      status: 404,
      error: req.focus.type === 'post' ? 'That post isn’t in your Backlot.' : 'That idea isn’t in your Backlot.',
    };
  }

  const channels = await store.listChannels(uid);

  // Preferences for the most specific channel in play: scope, else the focused item's channel.
  const focusChannel =
    scope ??
    (focusPost?.channelId ? channels.find((c) => c.id === focusPost.channelId) : undefined) ??
    channels.find((c) => c.name === (focusPost?.channelName || focusIdea?.channelName)) ??
    null;
  const rows = await store.listPreferences(uid);
  const valid = rows.filter((r) => validatePreference(r.key, r.value).ok) as { channelId: number | null; key: PreferenceKey; value: string }[];

  const parts: ContextParts = {
    today: req.today,
    channels,
    scope,
    counts: null,
    focusPost,
    focusIdea,
    posts: null,
    ideas: null,
    preferences: effectivePreferences(valid, focusChannel?.id ?? null),
    preferencesChannel: focusChannel,
  };

  const knownRefs: EntityRef[] = [];
  if (focusPost) knownRefs.push({ type: 'post', id: focusPost.id, title: focusPost.title });
  if (focusIdea) knownRefs.push({ type: 'idea', id: focusIdea.id, title: focusIdea.title });

  return {
    ok: true,
    task: classifyTask(req.question),
    context: buildContextBlock(parts),
    focusTitle: focusPost?.title ?? focusIdea?.title ?? null,
    knownRefs,
  };
}

'use client';

import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, CalendarClock, Check, FilePlus2, Lightbulb, Pencil, RefreshCw, Wand2, X } from 'lucide-react';
import type { ContentItem, IdeaItem } from '@/src/lib/content-logic';
import { marksPosted, POSTED_NOTE, STAGE_KEYS, STAGE_LABEL, type ActionView, type ChangeField, type PostChanges } from '@/src/lib/slate/actions';
import { MenuSelect } from './MenuSelect';
import { cx, useFeedback } from './ui';

/**
 * Preview cards for changes Slate suggested. Nothing changes until the creator presses
 * Apply (or Apply all for a batch); the server re-checks ownership, the stored payload and
 * the post's version before writing.
 */

export type ActionCardState = ActionView & { busy?: boolean; message?: string };

export interface AppliedResult {
  item?: ContentItem;
  idea?: IdeaItem;
}

interface Props {
  actions: ActionCardState[];
  authToken: string | null;
  onChange: (action: ActionCardState) => void;
  onApplied: (result: AppliedResult) => void;
  onRegenerate: (action: ActionView) => void;
  onOpenPost: (postId: number) => void;
}

const FIELD_LABEL: Record<ChangeField, string> = { title: 'Title', caption: 'Caption', tags: 'Hashtags', notes: 'Notes', status: 'Stage', targetDate: 'Target date' };
const FIELD_ORDER: ChangeField[] = ['title', 'caption', 'tags', 'notes', 'status', 'targetDate'];
const CREATE_FIELDS: ChangeField[] = ['title', 'caption', 'tags', 'notes', 'targetDate'];

function show(field: ChangeField, v: unknown): string {
  if (field === 'tags') return Array.isArray(v) && v.length ? v.map((t) => `#${t}`).join(' ') : 'None';
  if (field === 'status') return STAGE_LABEL[String(v)] ?? String(v ?? '');
  if (field === 'targetDate') return v ? String(v) : 'No date';
  return typeof v === 'string' && v.trim() ? v : 'Empty';
}

const KIND_META: Record<ActionView['kind'], { label: string; icon: React.ElementType }> = {
  post_update: { label: 'Suggested change', icon: Wand2 },
  stage_change: { label: 'Suggested stage', icon: ArrowRight },
  target_date: { label: 'Suggested date', icon: CalendarClock },
  post_create: { label: 'Suggested draft', icon: FilePlus2 },
  idea_convert: { label: 'Suggested post', icon: Lightbulb },
};

const STATUS_TEXT: Partial<Record<ActionView['status'], string>> = {
  applied: 'Applied in Backlot',
  dismissed: 'Dismissed',
  expired: 'Expired',
  conflict: 'Out of date',
  failed: 'Unavailable',
};

async function decide(authToken: string, action: ActionView, decision: 'apply' | 'dismiss', edits?: PostChanges) {
  const res = await fetch(`/api/slate/actions/${action.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify(edits && Object.keys(edits).length ? { decision, edits } : { decision }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data: data as { action?: ActionView; item?: ContentItem; idea?: IdeaItem; error?: string } };
}

export const SlateActionCards: React.FC<Props> = ({ actions, authToken, onChange, onApplied, onRegenerate, onOpenPost }) => {
  const { confirm } = useFeedback();
  if (!actions.length) return null;

  const run = async (a: ActionCardState, decision: 'apply' | 'dismiss', edits?: PostChanges) => {
    if (!authToken || a.busy) return false;
    onChange({ ...a, busy: true, message: undefined });
    try {
      const { ok, data } = await decide(authToken, a, decision, edits);
      const next: ActionCardState = { ...a, ...(data.action ?? {}), busy: false, message: ok ? undefined : data.error ?? 'Couldn’t do that. Try again.' };
      onChange(next);
      if (ok && decision === 'apply') onApplied({ item: data.item, idea: data.idea });
      // A conflict carries the latest post, so the Library shows it too.
      if (!ok && data.item) onApplied({ item: data.item });
      return ok;
    } catch {
      onChange({ ...a, busy: false, message: 'Couldn’t reach Backlot. Nothing was changed.' });
      return false;
    }
  };

  // Batches: one header with Apply all; each change still has its own buttons and result.
  const groups: ActionCardState[][] = [];
  for (const a of actions) {
    const g = a.batchId ? groups.find((x) => x[0].batchId === a.batchId) : undefined;
    if (g) g.push(a);
    else groups.push([a]);
  }

  return (
    <div className="mt-3 space-y-3">
      {groups.map((group) => {
        const pending = group.filter((a) => a.status === 'pending');
        const batch = group.length > 1;
        return (
          <div key={group[0].id} className={cx(batch && 'space-y-2 rounded-3xl border border-zinc-200 p-2 dark:border-zinc-800')}>
            {batch ? (
              <div className="flex items-center justify-between gap-3 px-2 pt-1">
                <p className="text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                  {group.length} suggested changes{group[0].reason ? <span className="font-normal text-zinc-500"> · {group[0].reason}</span> : null}
                </p>
                {pending.length > 1 ? (
                  <button
                    type="button"
                    disabled={!authToken || pending.some((a) => a.busy)}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Apply ${pending.length} changes?`,
                        body: `Each post is updated separately in Backlot. Any post that changed since Slate suggested this is skipped, not overwritten.${pending.some((a) => marksPosted(a.changes)) ? ' Marking as Posted doesn’t publish anything.' : ''}`,
                        confirmLabel: 'Apply all',
                      });
                      if (!ok) return;
                      for (const a of pending) await run(a, 'apply');
                    }}
                    className="h-8 shrink-0 rounded-full bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-electric-600 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white"
                  >
                    Apply all
                  </button>
                ) : null}
              </div>
            ) : null}
            {group.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                showReason={!batch}
                disabled={!authToken}
                onApply={(edits) => run(a, 'apply', edits)}
                onDismiss={() => run(a, 'dismiss')}
                onRegenerate={() => onRegenerate(a)}
                onOpenPost={onOpenPost}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};

const ActionCard: React.FC<{
  action: ActionCardState;
  showReason: boolean;
  disabled: boolean;
  onApply: (edits?: PostChanges) => Promise<boolean>;
  onDismiss: () => void;
  onRegenerate: () => void;
  onOpenPost: (postId: number) => void;
}> = ({ action: a, showReason, disabled, onApply, onDismiss, onRegenerate, onOpenPost }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PostChanges>({});
  const meta = KIND_META[a.kind];
  const pending = a.status === 'pending';

  const draftValue = (f: ChangeField) => (a.draft as unknown as Record<string, unknown> | undefined)?.[f];
  const fields: ChangeField[] = a.changes
    ? FIELD_ORDER.filter((f) => f in a.changes!)
    : a.kind === 'post_create'
    ? CREATE_FIELDS.filter((f) => editing || f === 'title' || (Array.isArray(draftValue(f)) ? (draftValue(f) as unknown[]).length > 0 : !!draftValue(f)))
    : [];
  const proposed = (f: ChangeField): unknown => (a.changes ? a.changes[f] : draftValue(f));
  const value = (f: ChangeField): unknown => (f in draft ? (draft as Record<string, unknown>)[f] : proposed(f));

  const startEdit = () => {
    setDraft({});
    setEditing(true);
  };

  const apply = async () => {
    const edits: Record<string, unknown> = {};
    if (editing) {
      for (const [k, v] of Object.entries(draft)) if (JSON.stringify(v) !== JSON.stringify(proposed(k as ChangeField))) edits[k] = v;
    }
    if (await onApply(edits as PostChanges)) setEditing(false);
  };

  const input = (f: ChangeField) => {
    const v = value(f);
    const set = (next: unknown) => setDraft((d) => ({ ...d, [f]: next }));
    const base = 'w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[13.5px] text-zinc-900 focus:border-electric-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
    if (f === 'caption' || f === 'notes') return <textarea value={String(v ?? '')} onChange={(e) => set(e.target.value)} rows={4} maxLength={5000} aria-label={FIELD_LABEL[f]} className={base} />;
    if (f === 'tags')
      return (
        <input
          value={Array.isArray(v) ? v.join(' ') : ''}
          onChange={(e) => set(e.target.value.split(/[\s,]+/).map((t) => t.replace(/^#+/, '')).filter(Boolean))}
          aria-label="Hashtags, separated by spaces"
          className={base}
        />
      );
    if (f === 'status')
      return (
        <MenuSelect value={String(v)} onChange={set} ariaLabel="Stage" options={STAGE_KEYS.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} />
      );
    if (f === 'targetDate') return <input type="date" value={String(v ?? '')} onChange={(e) => set(e.target.value)} aria-label="Target date" className={base} />;
    return <input value={String(v ?? '')} onChange={(e) => set(e.target.value)} maxLength={300} aria-label={FIELD_LABEL[f]} className={base} />;
  };

  return (
    <div
      className={cx(
        'rounded-2xl border px-4 py-3',
        pending ? 'border-electric-200 bg-electric-50/50 dark:border-electric-900/60 dark:bg-electric-950/25' : 'border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/50'
      )}
    >
      <div className="flex items-start gap-2.5">
        <meta.icon className="mt-0.5 h-4 w-4 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-electric-700 dark:text-electric-300">
            {meta.label}
            {STATUS_TEXT[a.status] ? <span className="ml-1.5 text-zinc-500 dark:text-zinc-400">· {STATUS_TEXT[a.status]}</span> : null}
          </p>
          <p className="truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-100">
            {a.target?.title ?? a.draft?.title ?? 'New post'}
          </p>
          <p className="text-[13px] text-zinc-600 dark:text-zinc-400">{a.summary}</p>
        </div>
      </div>

      {fields.length ? (
        <dl className="mt-3 space-y-2.5">
          {fields.map((f) => (
            <div key={f} className="text-[13.5px]">
              <dt className="mb-1 text-[11.5px] font-semibold text-zinc-500 dark:text-zinc-400">{FIELD_LABEL[f]}</dt>
              <dd>
                {editing && pending ? (
                  input(f)
                ) : (
                  <div className="space-y-1">
                    {a.before && f in a.before ? (
                      <p className="line-clamp-3 whitespace-pre-wrap text-zinc-400 line-through decoration-zinc-300 dark:text-zinc-500 dark:decoration-zinc-600">{show(f, a.before[f])}</p>
                    ) : null}
                    <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">{show(f, value(f))}</p>
                  </div>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {marksPosted(editing ? { ...a.changes, ...draft } : a.changes) ? (
        <p className="mt-2 text-[12.5px] text-zinc-600 dark:text-zinc-400">{POSTED_NOTE}</p>
      ) : null}
      {showReason && a.reason ? <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-400">{a.reason}</p> : null}
      {a.message ? (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-[12.5px] font-medium text-red-700 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {a.message}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {pending ? (
          <>
            <button
              type="button"
              onClick={apply}
              disabled={disabled || a.busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-electric-600 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              {a.busy ? 'Applying…' : editing ? 'Apply edited' : 'Apply'}
            </button>
            {fields.length ? (
              <button
                type="button"
                onClick={() => (editing ? setEditing(false) : startEdit())}
                disabled={a.busy}
                className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                {editing ? 'Cancel edit' : 'Edit'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={onRegenerate}
              disabled={a.busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Regenerate
            </button>
            <button
              type="button"
              onClick={onDismiss}
              disabled={disabled || a.busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-500 hover:bg-white dark:text-zinc-400 dark:hover:bg-zinc-800"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Dismiss
            </button>
          </>
        ) : a.status === 'applied' && a.resultPostId ? (
          <button
            type="button"
            onClick={() => onOpenPost(a.resultPostId!)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-link hover:bg-surface"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Open post
          </button>
        ) : a.status === 'conflict' || a.status === 'expired' ? (
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-700 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Ask Slate again
          </button>
        ) : null}
      </div>
    </div>
  );
};

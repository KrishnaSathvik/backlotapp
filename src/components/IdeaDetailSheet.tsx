'use client';

import React, { useState } from 'react';
import { ArrowRight, ExternalLink, Link2, MessageSquare, Trash2 } from 'lucide-react';
import {
  extractDomainAndTitle,
  formatTagsForCopy,
  getPlatformLabel,
  ideaImages,
  parseTagsInput,
  PLATFORM_OPTIONS,
  type ChannelItem,
  type IdeaItem,
  type PlatformKey,
} from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { IdeaReferenceImages } from './IdeaReferenceImages';
import { LinkThumbnail } from './LinkThumbnail';
import { PlatformIcon } from './PlatformIcon';
import {
  ActionMenu,
  buttonStyles,
  cx,
  inputStyles,
  labelStyles,
  Sheet,
  SheetCloseButton,
  sizes,
  useFeedback,
} from './ui';

export type IdeaFieldsPatch = Partial<
  Pick<IdeaItem, 'title' | 'linkUrl' | 'linkTitle' | 'linkDomain' | 'notes' | 'platform' | 'channelName' | 'tags' | 'targetDate' | 'images'>
>;

const isWebLink = (url: string) => /^https?:\/\//i.test(url.trim());

const draftFrom = (idea: IdeaItem) => ({
  title: idea.title,
  linkUrl: idea.linkUrl,
  notes: idea.notes,
  platform: idea.platform,
  channelName: idea.channelName,
  tags: formatTagsForCopy(idea.tags),
  targetDate: idea.targetDate,
});

/** One idea, edited in place. Converting it to a post keeps everything written here. */
export function IdeaDetailSheet({
  idea,
  channels,
  authToken = null,
  onClose,
  onSave,
  onMakePost,
  onAskSlate,
  onDelete,
}: {
  idea: IdeaItem;
  channels: ChannelItem[];
  /** For TikTok thumbnails (looked up; YouTube's need nothing). */
  authToken?: string | null;
  onClose: () => void;
  onSave: (ideaId: number, patch: IdeaFieldsPatch) => Promise<boolean>;
  onMakePost: (idea: IdeaItem, platform?: PlatformKey) => Promise<void>;
  onAskSlate: (idea: IdeaItem) => void;
  onDelete: (idea: IdeaItem) => Promise<void>;
}) {
  const { confirm, toast } = useFeedback();
  const [draft, setDraft] = useState(() => draftFrom(idea));
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const set = <K extends keyof typeof draft>(key: K) => (value: (typeof draft)[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const saved = draftFrom(idea);
  const changed = (Object.keys(draft) as Array<keyof typeof draft>).filter((k) => draft[k] !== saved[k]);
  const dirty = changed.length > 0;

  const leave = async (next: () => void) => {
    if (dirty) {
      const ok = await confirm({
        title: 'Discard your changes?',
        body: 'You have edits on this idea that haven’t been saved.',
        confirmLabel: 'Discard',
        tone: 'danger',
      });
      if (!ok) return;
    }
    next();
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.title.trim()) {
      toast('Give the idea a title', 'error');
      return;
    }
    const patch: IdeaFieldsPatch = {};
    for (const k of changed) {
      if (k === 'tags') patch.tags = parseTagsInput(draft.tags);
      else if (k === 'title') patch.title = draft.title.trim();
      else if (k === 'linkUrl') {
        const link = extractDomainAndTitle(draft.linkUrl);
        if (link.validUrl && !isWebLink(link.validUrl)) {
          toast('Links need to start with http:// or https://', 'error');
          return;
        }
        Object.assign(patch, { linkUrl: link.validUrl, linkDomain: link.domain, linkTitle: link.suggestedTitle });
      } else Object.assign(patch, { [k]: draft[k] });
    }
    setSaving(true);
    try {
      await onSave(idea.id, patch);
    } finally {
      setSaving(false);
    }
  };

  const channelOptions =
    !draft.channelName || channels.some((c) => c.name === draft.channelName)
      ? channels.map((c) => c.name)
      : [draft.channelName, ...channels.map((c) => c.name)];

  return (
    <Sheet onClose={() => leave(onClose)} label={`Idea: ${idea.title}`} size="lg" fullscreenOnMobile>
      <div className="border-b border-zinc-100 px-5 pb-4 pt-3 sm:px-6 sm:pt-5 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
                Idea
              </span>
              <span className="flex items-center gap-1.5 font-semibold text-zinc-700 dark:text-zinc-200">
                <PlatformIcon platform={idea.platform} size={16} />
                {getPlatformLabel(idea.platform)}
              </span>
              {idea.channelName ? <span>· {idea.channelName}</span> : null}
            </div>
            <h2 className="mt-2 text-lg font-bold leading-snug tracking-tight sm:text-xl">{idea.title}</h2>
          </div>
          <SheetCloseButton onClick={() => leave(onClose)} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {picking && !idea.convertedItemId ? (
            PLATFORM_OPTIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                disabled={busy}
                onClick={() =>
                  leave(async () => {
                    setBusy(true);
                    try {
                      await onMakePost(idea, p.key);
                    } finally {
                      setBusy(false);
                    }
                  })
                }
                className={cx(buttonStyles.secondary, 'h-9 px-3 text-xs')}
              >
                <PlatformIcon platform={p.key} size={14} colored />
                {p.shortLabel}
              </button>
            ))
          ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => (idea.convertedItemId ? leave(() => onMakePost(idea)) : setPicking(true))}
            className={cx(idea.convertedItemId ? buttonStyles.secondary : buttonStyles.primary, sizes.sm, 'h-9')}
          >
            {idea.convertedItemId ? 'Open post' : 'Turn into post'}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          )}
          <button type="button" onClick={() => leave(() => onAskSlate(idea))} className={cx(buttonStyles.secondary, sizes.sm, 'h-9')}>
            <MessageSquare className="h-3.5 w-3.5 text-cantaloupe-500" aria-hidden="true" />
            Ask Slate
          </button>
          <ActionMenu
            className="ml-auto"
            items={[{ label: 'Delete idea', icon: Trash2, onSelect: () => onDelete(idea), tone: 'danger' }]}
          />
        </div>
      </div>

      <form id="idea-inline-form" onSubmit={handleSave} className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
        <div className="grid grid-cols-1 gap-5 p-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-6">
          <div className="min-w-0 space-y-5">
            {isWebLink(idea.linkUrl) ? (
              <section aria-label="Link">
                <p className="mb-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">Link</p>
                <a
                  href={idea.linkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex min-w-0 items-center gap-3 rounded-xl border border-zinc-200 p-2 pr-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
                    <LinkThumbnail
                      link={idea.linkUrl}
                      authToken={authToken}
                      className="h-full w-full object-cover"
                      fallback={
                        <span className="flex h-full w-full items-center justify-center text-electric-500">
                          <Link2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                      }
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-zinc-900 dark:text-zinc-100">{idea.linkTitle || idea.linkUrl}</span>
                    <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{idea.linkDomain}</span>
                  </span>
                  <ExternalLink className="h-4 w-4 shrink-0 text-zinc-400 group-hover:text-electric-600 dark:group-hover:text-electric-400" aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </section>
            ) : null}
            <IdeaReferenceImages images={ideaImages(idea)} authToken={authToken} onChange={(images) => onSave(idea.id, { images })} />
          </div>

          <div className="min-w-0 space-y-3">
            <div>
              <label htmlFor="idea-edit-title" className={labelStyles}>Title</label>
              <input
                id="idea-edit-title"
                value={draft.title}
                onChange={(e) => set('title')(e.target.value)}
                maxLength={300}
                className={cx(inputStyles, 'h-11 font-medium')}
              />
            </div>
            <div>
              <label htmlFor="idea-edit-notes" className={labelStyles}>Notes</label>
              <textarea
                id="idea-edit-notes"
                rows={4}
                value={draft.notes}
                onChange={(e) => set('notes')(e.target.value)}
                placeholder="Hook, angle, pacing, shots you want…"
                className={cx(inputStyles, 'py-2.5 leading-relaxed')}
              />
            </div>
            <div>
              <label htmlFor="idea-edit-link" className={labelStyles}>Reference link</label>
              <div className="relative">
                <Link2 className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <input
                  id="idea-edit-link"
                  type="url"
                  value={draft.linkUrl}
                  onChange={(e) => set('linkUrl')(e.target.value)}
                  placeholder="https://"
                  className={cx(inputStyles, 'h-11 pl-10')}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
              <div>
                <label htmlFor="idea-edit-platform" className={labelStyles}>Platform</label>
                <FormSelect id="idea-edit-platform" value={draft.platform} onChange={(e) => set('platform')(e.target.value as PlatformKey)}>
                  {PLATFORM_OPTIONS.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="idea-edit-channel" className={labelStyles}>Channel</label>
                <FormSelect id="idea-edit-channel" value={draft.channelName} onChange={(e) => set('channelName')(e.target.value)}>
                  <option value="">None yet</option>
                  {channelOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </FormSelect>
              </div>
              <div>
                <label htmlFor="idea-edit-tags" className={labelStyles}>Tags</label>
                <input
                  id="idea-edit-tags"
                  value={draft.tags}
                  onChange={(e) => set('tags')(e.target.value)}
                  placeholder="#hook #lighting"
                  autoCapitalize="none"
                  className={cx(inputStyles, 'h-11 font-mono lg:text-xs')}
                />
              </div>
              <div>
                <label htmlFor="idea-edit-date" className={labelStyles}>Target date</label>
                <input
                  id="idea-edit-date"
                  type="date"
                  value={draft.targetDate}
                  onChange={(e) => set('targetDate')(e.target.value)}
                  className={cx(inputStyles, 'h-11')}
                />
              </div>
            </div>
          </div>
        </div>
      </form>

      {dirty ? (
        <div className="animate-pop-in flex items-center justify-between gap-3 border-t border-zinc-100 bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="min-w-0 truncate text-[13px] font-medium text-zinc-500 max-[359px]:sr-only dark:text-zinc-400">Unsaved changes</p>
          <div className="ml-auto flex shrink-0 gap-2">
            <button type="button" onClick={() => setDraft(draftFrom(idea))} disabled={saving} className={cx(buttonStyles.secondary, sizes.md)}>
              Discard
            </button>
            <button type="submit" form="idea-inline-form" disabled={saving} className={cx(buttonStyles.primary, sizes.md)}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}

'use client';

import React, { useState } from 'react';
import { PLATFORM_OPTIONS, type ChannelItem, type PlatformKey } from '@/src/lib/content-logic';
import { FormSelect } from './CustomSelect';
import { PlatformIcon } from './PlatformIcon';
import { buttonStyles, chipClass, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes } from './ui';

/** The + button: a post or an idea. */
export function CreateChooser({ onPost, onIdea, onClose }: { onPost: () => void; onIdea: () => void; onClose: () => void }) {
  return (
    <Sheet onClose={onClose} label="Create" size="sm">
      <div className="flex items-center justify-between px-5 pb-2 pt-4">
        <h2 className="text-lg font-bold tracking-tight">Create</h2>
        <SheetCloseButton onClick={onClose} />
      </div>
      <div className="grid gap-2 px-5 pb-6">
        <button type="button" onClick={onPost} className={cx(buttonStyles.primary, sizes.lg, 'h-12 justify-start px-4')}>
          New post
        </button>
        <button type="button" onClick={onIdea} className={cx(buttonStyles.secondary, sizes.lg, 'h-12 justify-start px-4')}>
          New idea
        </button>
      </div>
    </Sheet>
  );
}

/**
 * New post: a name, then the post opens. From a channel page the platform and channel are already
 * chosen, so the dialog only asks for the name.
 */
export function NewPostDialog({
  channels,
  initialChannel = '',
  onCreate,
  onClose,
}: {
  channels: ChannelItem[];
  /** Set when creating from a channel's page. That channel and its platform are used as-is. */
  initialChannel?: string;
  /** Creates the post; rejects with a message to show. */
  onCreate: (title: string, platform: PlatformKey, channelName: string) => Promise<void>;
  onClose: () => void;
}) {
  const channel = channels.find((c) => c.name === initialChannel) ?? null;
  const [title, setTitle] = useState('');
  const [platform, setPlatform] = useState<PlatformKey>(channel?.platform || 'youtube_long');
  const [channelName, setChannelName] = useState(channel ? channel.name : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(title.trim(), channel?.platform ?? platform, channel?.name ?? channelName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the post. Try again.');
      setSaving(false);
    }
  };

  const chip = (active: boolean) =>
    cx(
      'flex h-10 max-w-full shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition-colors disabled:opacity-50',
      chipClass(active)
    );

  return (
    <Sheet onClose={saving ? () => undefined : onClose} label="New post" size="md" floatOnMobile>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-5 sm:px-8 sm:pt-8">
          <div className="min-w-0">
            <h2 className="text-lg font-bold tracking-tight sm:text-2xl">New post</h2>
            <p className="mt-0.5 text-[13px] text-zinc-500 sm:mt-1 sm:text-sm dark:text-zinc-400">
              {channel ? `Adds to ${channel.name}. Files and caption come next.` : 'Name it and pick where it will go. Files and caption come next.'}
            </p>
          </div>
          <SheetCloseButton onClick={saving ? () => undefined : onClose} />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 sm:px-8 sm:pb-0">
          <div className="mt-5 space-y-5 sm:mt-6 sm:space-y-4">
            <div>
              <label htmlFor="new-post-title" className={labelStyles}>
                Post name
              </label>
              <input
                id="new-post-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. My weekend vlog"
                maxLength={300}
                autoFocus
                enterKeyHint="done"
                autoComplete="off"
                disabled={saving}
                className={cx(inputStyles, 'h-12 sm:h-11 lg:text-[15px]')}
              />
            </div>
            {channel ? null : (
            <fieldset>
              <legend className={labelStyles}>Platform</legend>
              <div className="flex flex-wrap gap-2">
                {PLATFORM_OPTIONS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-pressed={platform === p.key}
                    disabled={saving}
                    onClick={() => setPlatform(p.key)}
                    className={chip(platform === p.key)}
                  >
                    <PlatformIcon platform={p.key} size={16} colored />
                    <span className="truncate">{p.shortLabel}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            )}
            {channel || !channels.length ? null : (
              <>
                {/* Phones and tablets: tap a channel. */}
                <fieldset className="lg:hidden">
                  <legend className={labelStyles}>
                    Channel <span className="font-normal text-zinc-400">· optional</span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {[{ id: -1, name: '' }, ...channels].map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={channelName === c.name}
                        disabled={saving}
                        onClick={() => setChannelName(c.name)}
                        className={chip(channelName === c.name)}
                      >
                        <span className="truncate">{c.name || 'No channel'}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                {/* Desktop: the dropdown. */}
                <div className="hidden lg:block">
                  <label htmlFor="new-post-channel" className={labelStyles}>
                    Channel <span className="font-normal text-zinc-400">· optional</span>
                  </label>
                  <FormSelect id="new-post-channel" value={channelName} onChange={(e) => setChannelName(e.target.value)} disabled={saving}>
                    <option value="">No channel yet</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </FormSelect>
                </div>
              </>
            )}
          </div>

          {error ? (
            <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-3 px-5 pb-5 pt-5 *:flex-1 max-sm:*:h-12 sm:justify-end sm:px-8 sm:pb-8 sm:pt-8 sm:*:flex-none">
          <button type="button" onClick={onClose} disabled={saving} className={cx(buttonStyles.secondary, sizes.md)}>
            Cancel
          </button>
          <button type="submit" disabled={saving || !title.trim()} className={cx(buttonStyles.primary, sizes.md, 'sm:min-w-32')}>
            {saving ? 'Creating…' : 'Create post'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

'use client';

import React, { useState } from 'react';
import type { ChannelItem, PlatformKey } from '@/src/lib/content-logic';
import { PlatformIcon } from './PlatformIcon';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes } from './ui';

/** Where a channel lives. YouTube covers long videos and Shorts; Instagram, Reels and posts. */
const CHANNEL_PLATFORMS: Array<{ key: PlatformKey; label: string }> = [
  { key: 'youtube_long', label: 'YouTube' },
  { key: 'instagram_reel', label: 'Instagram' },
  { key: 'tiktok', label: 'TikTok' },
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'other', label: 'Other' },
];

/** Add a channel, or edit one (`channel` given): its platform, name and handle. */
export function AddChannelDialog({
  channel,
  onClose,
  onAdd,
}: {
  /** Editing this channel. */
  channel?: ChannelItem | null;
  onClose: () => void;
  onAdd: (name: string, handle: string, platform: PlatformKey) => Promise<boolean>;
}) {
  const editing = !!channel;
  const [platform, setPlatform] = useState<PlatformKey | null>(
    channel ? (CHANNEL_PLATFORMS.some((p) => p.key === channel.platform) ? channel.platform! : channel.platform?.startsWith('youtube') ? 'youtube_long' : channel.platform?.startsWith('instagram') ? 'instagram_reel' : 'other') : null
  );
  const [name, setName] = useState(channel?.name ?? '');
  const [handle, setHandle] = useState(channel?.handle ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!platform) {
      setError('Choose where you post it.');
      return;
    }
    if (!name.trim()) {
      setError('Channel name is required.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await onAdd(name.trim(), handle.trim(), platform);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet onClose={onClose} label={editing ? 'Edit channel' : 'Add a channel'} size="md">
      <form onSubmit={submit} className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{editing ? 'Edit channel' : 'Add a channel'}</h2>
            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">{editing ? 'Its posts and ideas stay with it.' : 'An account you post to.'}</p>
          </div>
          <SheetCloseButton onClick={onClose} />
        </div>

        <div className="mt-5 space-y-4">
          <fieldset>
            <legend className={labelStyles}>Where do you post it?</legend>
            <div role="radiogroup" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CHANNEL_PLATFORMS.map((p) => {
                const on = platform === p.key;
                return (
                  <button
                    key={p.key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setPlatform(p.key)}
                    className={cx(
                      'flex h-11 items-center justify-center gap-2 rounded-xl border text-[13.5px] font-semibold transition-colors',
                      on
                        ? 'border-electric-500 bg-electric-50 text-zinc-950 ring-2 ring-electric-500/20 dark:bg-electric-950/40 dark:text-white'
                        : 'border-zinc-200 text-zinc-700 hover:border-zinc-300 dark:border-zinc-800 dark:text-zinc-300 dark:hover:border-zinc-700'
                    )}
                  >
                    <PlatformIcon platform={p.key} size={18} colored />
                    {p.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div>
            <label htmlFor="add-channel-name" className={labelStyles}>
              Channel name
            </label>
            <input
              id="add-channel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={platform === 'instagram_reel' ? 'e.g. Personal' : platform === 'tiktok' ? 'e.g. Clips' : 'e.g. Main channel'}
              maxLength={120}
              className={cx(inputStyles, 'h-11')}
            />
          </div>
          <div>
            <label htmlFor="add-channel-handle" className={labelStyles}>
              Handle <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <input
              id="add-channel-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@yourhandle"
              maxLength={120}
              className={cx(inputStyles, 'h-11')}
            />
          </div>
          {error ? <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={cx(buttonStyles.secondary, sizes.md)}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={cx(buttonStyles.primary, sizes.md)}>
            {saving ? 'Saving…' : editing ? 'Save' : 'Add channel'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

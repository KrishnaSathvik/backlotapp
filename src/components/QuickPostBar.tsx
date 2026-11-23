'use client';

import React, { useState } from 'react';
import type { ChannelItem } from '@/src/lib/content-logic';
import { MenuSelect } from './MenuSelect';
import { buttonStyles, cx, sizes } from './ui';

/**
 * The Library's quick add: name a post, optionally pick a channel, create. The post opens in its
 * details so the rest (media, caption, dates…) can be added whenever.
 */
export function QuickPostBar({
  channels,
  initialChannel = '',
  onCreate,
}: {
  channels: ChannelItem[];
  /** Pre-selected on a channel's page. */
  initialChannel?: string;
  /** Creates the post; rejects with a message to show. */
  onCreate: (title: string, channelName: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [channelName, setChannelName] = useState(initialChannel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError('');
    try {
      await onCreate(title.trim(), channelName);
      setTitle('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Couldn’t create the post. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={create}
      className="rounded-2xl border border-zinc-200 bg-white p-2 shadow-xs transition-colors focus-within:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-700"
    >
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name your next post…"
          aria-label="New post name"
          maxLength={300}
          disabled={saving}
          className="h-11 min-w-0 flex-1 basis-full bg-transparent px-3 text-base text-zinc-950 lg:text-[15px] placeholder:text-zinc-400 focus:outline-none sm:basis-auto dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />
        {channels.length ? (
          <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <MenuSelect
              ariaLabel="Channel"
              value={channelName}
              onChange={setChannelName}
              disabled={saving}
              options={[{ value: '', label: 'No channel' }, ...channels.map((c) => ({ value: c.name, label: c.name }))]}
              className="border-transparent bg-zinc-100 shadow-none hover:border-transparent dark:border-transparent dark:bg-zinc-800"
            />
          </div>
        ) : null}
        <button type="submit" disabled={saving || !title.trim()} className={cx(buttonStyles.primary, sizes.md, 'h-10 shrink-0 px-4')}>
          {saving ? 'Creating…' : 'Create post'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-1 pt-1.5 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}

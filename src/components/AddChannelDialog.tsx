'use client';

import React, { useState } from 'react';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes } from './ui';

/** Small dialog for adding a channel, opened from the sidebar or the mobile channel picker. */
export function AddChannelDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string, handle: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Channel name is required.');
      return;
    }
    setError('');
    setSaving(true);
    const ok = await onAdd(name.trim(), handle.trim());
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Sheet onClose={onClose} label="Add a channel" size="sm">
      <form onSubmit={submit} className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight">Add a channel</h2>
            <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">
              A YouTube channel, Instagram account or brand you post for.
            </p>
          </div>
          <SheetCloseButton onClick={onClose} />
        </div>

        <div className="mt-5 space-y-3">
          <div>
            <label htmlFor="add-channel-name" className={labelStyles}>
              Channel or brand name
            </label>
            <input
              id="add-channel-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Channel"
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
              placeholder="@mainchannel"
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
            {saving ? 'Saving…' : 'Add channel'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ChannelItem } from '@/src/lib/content-logic';
import { PREFERENCE_KEYS, PREFERENCE_SPECS, type PreferenceKey, type PreferenceRecord } from '@/src/lib/slate/preferences';
import { buttonStyles, cx, inputStyles, labelStyles, Sheet, SheetCloseButton, sizes, useFeedback } from './ui';

/** Review, edit, delete and add the creator's saved Slate preferences. */
export function SlatePreferencesSheet({
  authToken,
  channels,
  onClose,
}: {
  authToken: string;
  channels: ChannelItem[];
  onClose: () => void;
}) {
  const { toast, confirm } = useFeedback();
  const [prefs, setPrefs] = useState<PreferenceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | 'new' | null>(null);
  const [draft, setDraft] = useState<{ key: PreferenceKey; channelId: string; value: string }>({ key: 'tone', channelId: '', value: '' });

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, {
        ...init,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}`, ...(init?.headers ?? {}) },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    },
    [authToken]
  );

  useEffect(() => {
    api('/api/slate/preferences')
      .then((d) => setPrefs(d.preferences))
      .catch((e: Error) => setError(e.message));
  }, [api]);

  const channelName = (id: number | null) => (id === null ? 'All channels' : channels.find((c) => c.id === id)?.name ?? 'A removed channel');

  const save = async (p: PreferenceRecord, value: string) => {
    if (value === p.value) return;
    setBusyId(p.id);
    try {
      const { preference } = await api(`/api/slate/preferences/${p.id}`, { method: 'PATCH', body: JSON.stringify({ value }) });
      setPrefs((list) => list?.map((x) => (x.id === p.id ? preference : x)) ?? null);
      toast('Preference updated');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (p: PreferenceRecord) => {
    const ok = await confirm({ title: 'Remove this preference?', body: `${PREFERENCE_SPECS[p.key].label} for ${channelName(p.channelId)}.`, confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    setBusyId(p.id);
    try {
      await api(`/api/slate/preferences/${p.id}`, { method: 'DELETE' });
      setPrefs((list) => list?.filter((x) => x.id !== p.id) ?? null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusyId('new');
    try {
      const { preference } = await api('/api/slate/preferences', {
        method: 'POST',
        body: JSON.stringify({ key: draft.key, value: draft.value, channelId: draft.channelId ? Number(draft.channelId) : null, source: 'user' }),
      });
      setPrefs((list) => [...(list ?? []).filter((x) => x.id !== preference.id), preference]);
      setDraft((d) => ({ ...d, value: '' }));
      toast('Preference saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  const groups = new Map<string, PreferenceRecord[]>();
  for (const p of prefs ?? []) {
    const k = channelName(p.channelId);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === 'All channels' ? -1 : b === 'All channels' ? 1 : a.localeCompare(b)));

  return (
    <Sheet onClose={onClose} label="Creative preferences" size="lg">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-100 px-5 pb-4 pt-3 sm:px-6 sm:pt-5 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-bold tracking-tight">Creative preferences</h2>
          <p className="mt-0.5 text-[13px] text-zinc-500 dark:text-zinc-400">Slate follows these when it writes. Channel settings override “All channels”.</p>
        </div>
        <SheetCloseButton onClick={onClose} />
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:p-6">
        {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
        {prefs === null && !error ? <p className="text-sm text-zinc-500">Loading…</p> : null}
        {prefs?.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No preferences yet. Add one below, or ask Slate to remember something.
          </p>
        ) : null}

        {ordered.map(([group, list]) => (
          <section key={group}>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{group}</h3>
            <ul className="space-y-2">
              {list.map((p) => {
                const spec = PREFERENCE_SPECS[p.key];
                return (
                  <li key={p.id} className="flex items-center gap-3 rounded-xl border border-zinc-200/80 p-3 dark:border-zinc-800">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">{spec.label}</p>
                      {spec.options ? (
                        <select
                          aria-label={spec.label}
                          value={p.value}
                          disabled={busyId === p.id}
                          onChange={(e) => save(p, e.target.value)}
                          className={cx(inputStyles, 'mt-1.5 h-10 dark:[color-scheme:dark]')}
                        >
                          {spec.options.map((o) => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={spec.label}
                          defaultValue={p.value}
                          disabled={busyId === p.id}
                          maxLength={spec.maxLength ?? 3}
                          inputMode={spec.integer ? 'numeric' : undefined}
                          onBlur={(e) => save(p, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                          className={cx(inputStyles, 'mt-1.5 h-10')}
                        />
                      )}
                      {p.source === 'slate_confirmed' ? <p className="mt-1 text-[11px] text-zinc-400">Saved from a Slate suggestion</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(p)}
                      disabled={busyId === p.id}
                      aria-label={`Remove ${spec.label}`}
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <form onSubmit={add} className="rounded-2xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
          <p className="mb-3 text-[13px] font-semibold">Add a preference</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pref-key" className={labelStyles}>Preference</label>
              <select
                id="pref-key"
                value={draft.key}
                onChange={(e) => setDraft({ ...draft, key: e.target.value as PreferenceKey, value: '' })}
                className={cx(inputStyles, 'h-10 dark:[color-scheme:dark]')}
              >
                {PREFERENCE_KEYS.map((k) => (
                  <option key={k} value={k}>{PREFERENCE_SPECS[k].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pref-scope" className={labelStyles}>Applies to</label>
              <select
                id="pref-scope"
                value={draft.channelId}
                onChange={(e) => setDraft({ ...draft, channelId: e.target.value })}
                className={cx(inputStyles, 'h-10 dark:[color-scheme:dark]')}
              >
                <option value="">All channels</option>
                {channels.map((c) => (
                  <option key={c.id} value={String(c.id)}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pref-value" className={labelStyles}>Value</label>
              {PREFERENCE_SPECS[draft.key].options ? (
                <select
                  id="pref-value"
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  className={cx(inputStyles, 'h-10 dark:[color-scheme:dark]')}
                >
                  <option value="">Choose…</option>
                  {PREFERENCE_SPECS[draft.key].options!.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  id="pref-value"
                  value={draft.value}
                  onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                  placeholder={PREFERENCE_SPECS[draft.key].hint}
                  maxLength={PREFERENCE_SPECS[draft.key].maxLength ?? 3}
                  inputMode={PREFERENCE_SPECS[draft.key].integer ? 'numeric' : undefined}
                  className={cx(inputStyles, 'h-10')}
                />
              )}
            </div>
          </div>
          <button type="submit" disabled={!draft.value.trim() || busyId === 'new'} className={cx(buttonStyles.primary, sizes.md, 'mt-4')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {busyId === 'new' ? 'Saving…' : 'Save preference'}
          </button>
        </form>
      </div>
    </Sheet>
  );
}

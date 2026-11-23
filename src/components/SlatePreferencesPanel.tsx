'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ChannelItem } from '@/src/lib/content-logic';
import { PREFERENCE_KEYS, PREFERENCE_SPECS, type PreferenceKey, type PreferenceRecord } from '@/src/lib/slate/preferences';
import { MenuSelect } from './MenuSelect';
import { buttonStyles, cx, inputStyles, labelStyles, sizes, useFeedback } from './ui';

/** Review, edit, delete and add the creator's saved Slate preferences (the Preferences tab of SlateSheet). */
export function SlatePreferencesPanel({ authToken, channels }: { authToken: string; channels: ChannelItem[] }) {
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

  const scopeOptions = [{ value: '', label: 'All channels' }, ...channels.map((c) => ({ value: String(c.id), label: c.name }))];
  const draftSpec = PREFERENCE_SPECS[draft.key];

  return (
    <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-1 sm:px-7 sm:pb-7">
      <p className="text-[13px] text-zinc-500 dark:text-zinc-400">Slate follows these when it writes. A channel’s settings override “All channels”.</p>

      {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
      {prefs === null && !error ? <p className="text-sm text-zinc-500">Loading…</p> : null}
      {prefs?.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-500 dark:text-zinc-400">No preferences yet. Add one below, or ask Slate to remember something.</p>
      ) : null}

      {ordered.map(([group, list]) => (
        <section key={group}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{group}</h3>
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {list.map((p) => {
              const spec = PREFERENCE_SPECS[p.key];
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-medium text-zinc-900 dark:text-zinc-100">{spec.label}</p>
                    {p.source === 'slate_confirmed' ? <p className="text-[11.5px] text-zinc-400">Saved from a Slate suggestion</p> : null}
                  </div>
                  <div className="w-full sm:w-52">
                    {spec.options ? (
                      <MenuSelect
                        ariaLabel={spec.label}
                        value={p.value}
                        disabled={busyId === p.id}
                        onChange={(v) => save(p, v)}
                        options={spec.options.map((o) => ({ value: o, label: o }))}
                      />
                    ) : (
                      <input
                        aria-label={spec.label}
                        defaultValue={p.value}
                        disabled={busyId === p.id}
                        maxLength={spec.maxLength ?? 3}
                        inputMode={spec.integer ? 'numeric' : undefined}
                        onBlur={(e) => save(p, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        className={cx(inputStyles, 'h-10')}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(p)}
                    disabled={busyId === p.id}
                    aria-label={`Remove ${spec.label}`}
                    title="Remove"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <form onSubmit={add} className="rounded-2xl bg-surface-2 p-4 sm:p-5">
        <p className="text-[14px] font-semibold text-zinc-900 dark:text-zinc-100">Add a preference</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pref-key" className={labelStyles}>Preference</label>
            <MenuSelect
              id="pref-key"
              value={draft.key}
              onChange={(v) => setDraft({ ...draft, key: v as PreferenceKey, value: '' })}
              options={PREFERENCE_KEYS.map((k) => ({ value: k, label: PREFERENCE_SPECS[k].label }))}
            />
          </div>
          <div>
            <label htmlFor="pref-scope" className={labelStyles}>Applies to</label>
            <MenuSelect id="pref-scope" value={draft.channelId} onChange={(v) => setDraft({ ...draft, channelId: v })} options={scopeOptions} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="pref-value" className={labelStyles}>Value</label>
            {draftSpec.options ? (
              <MenuSelect
                id="pref-value"
                value={draft.value}
                onChange={(v) => setDraft({ ...draft, value: v })}
                options={draftSpec.options.map((o) => ({ value: o, label: o }))}
              />
            ) : (
              <input
                id="pref-value"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                placeholder={draftSpec.hint}
                maxLength={draftSpec.maxLength ?? 3}
                inputMode={draftSpec.integer ? 'numeric' : undefined}
                className={cx(inputStyles, 'h-10')}
              />
            )}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="submit" disabled={!draft.value.trim() || busyId === 'new'} className={cx(buttonStyles.primary, sizes.md)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {busyId === 'new' ? 'Saving…' : 'Save preference'}
          </button>
        </div>
      </form>
    </div>
  );
}

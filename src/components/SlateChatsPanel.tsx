'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Check, MessageSquare, Pencil, Search, Trash2, X } from 'lucide-react';
import { cx, inputStyles, useFeedback } from './ui';

/** The creator's saved Slate chats: open, search, rename, archive and delete (the Chats tab of SlateSheet). */

export interface ConversationListItem {
  id: string;
  title: string;
  lastMessageAt: string;
  archived: boolean;
  snippet?: string;
}

function when(iso: string): string {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days < 1) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function SlateChatsPanel({
  authToken,
  currentId,
  onOpen,
  onDeleted,
}: {
  authToken: string;
  currentId: string | null;
  onOpen: (id: string) => void;
  /** The open conversation was deleted or archived. */
  onDeleted: (id: string) => void;
}) {
  const { toast, confirm } = useFeedback();
  const [archived, setArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');
      return data;
    },
    [authToken]
  );

  // Search as the creator types (debounced).
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (archived) params.set('archived', '1');
      if (query.trim()) params.set('q', query.trim());
      api(`/api/slate/conversations?${params}`)
        .then((d) => {
          if (live) {
            setItems(d.conversations);
            setError(null);
          }
        })
        .catch((e: Error) => live && setError(e.message));
    }, query ? 250 : 0);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, archived, query]);

  const rename = async () => {
    if (!renaming) return;
    const title = renaming.title.trim();
    if (!title) return;
    setBusy(renaming.id);
    try {
      await api(`/api/slate/conversations/${renaming.id}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      setItems((list) => list?.map((c) => (c.id === renaming.id ? { ...c, title } : c)) ?? null);
      setRenaming(null);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleArchive = async (c: ConversationListItem) => {
    setBusy(c.id);
    try {
      await api(`/api/slate/conversations/${c.id}`, { method: 'PATCH', body: JSON.stringify({ archived: !c.archived }) });
      setItems((list) => list?.filter((x) => x.id !== c.id) ?? null);
      if (!c.archived && c.id === currentId) onDeleted(c.id);
      toast(c.archived ? 'Chat restored' : 'Chat archived');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (c: ConversationListItem) => {
    const ok = await confirm({ title: 'Delete this chat?', body: `“${c.title}” and all its messages will be permanently deleted.`, confirmLabel: 'Delete chat', tone: 'danger' });
    if (!ok) return;
    setBusy(c.id);
    try {
      await api(`/api/slate/conversations/${c.id}`, { method: 'DELETE' });
      setItems((list) => list?.filter((x) => x.id !== c.id) ?? null);
      if (c.id === currentId) onDeleted(c.id);
      toast('Chat deleted');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const iconButton = 'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-white';

  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-3 sm:px-7">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className={cx(inputStyles, 'h-10 pl-9')} />
        </div>
        <div role="tablist" aria-label="Which chats" className="flex shrink-0 gap-0.5 rounded-xl bg-zinc-100 p-1 text-[12.5px] font-semibold dark:bg-zinc-900">
          {[
            { label: 'Active', value: false },
            { label: 'Archived', value: true },
          ].map((t) => (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={archived === t.value}
              onClick={() => setArchived(t.value)}
              className={cx('h-8 rounded-lg px-3 transition-colors', archived === t.value ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white' : 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-1 sm:px-5 sm:pb-5">
        {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null}
        {items === null && !error ? <p className="px-2 py-4 text-sm text-zinc-500">Loading…</p> : null}
        {items?.length === 0 ? (
          <p className="px-2 py-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {query ? `No chats match “${query}”.` : archived ? 'No archived chats.' : 'No chats yet. Ask Slate something to start one.'}
          </p>
        ) : null}
        <ul className="space-y-1">
          {items?.map((c) => (
            <li key={c.id} className={cx('group flex items-center gap-2 rounded-xl px-2.5 py-2 transition-colors', c.id === currentId ? 'bg-electric-50 dark:bg-electric-950/30' : 'hover:bg-zinc-50 dark:hover:bg-zinc-900')}>
              {renaming?.id === c.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    rename();
                  }}
                >
                  <input
                    autoFocus
                    value={renaming.title}
                    maxLength={120}
                    onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                    aria-label="Chat title"
                    className={cx(inputStyles, 'h-9 flex-1')}
                  />
                  <button type="submit" disabled={busy === c.id} aria-label="Save title" className={iconButton}>
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => setRenaming(null)} aria-label="Cancel rename" className={iconButton}>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
              ) : (
                <>
                  <button type="button" onClick={() => onOpen(c.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="truncate text-[14px] font-medium text-zinc-900 dark:text-zinc-100">{c.title}</span>
                        <span className="ml-auto shrink-0 text-[11.5px] text-zinc-400">{when(c.lastMessageAt)}</span>
                      </span>
                      {c.snippet ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] text-zinc-500 dark:text-zinc-400">{c.snippet}</span> : null}
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center opacity-100 lg:pointer-fine:opacity-0 lg:pointer-fine:group-hover:opacity-100 lg:pointer-fine:group-focus-within:opacity-100">
                    <button type="button" onClick={() => setRenaming({ id: c.id, title: c.title })} disabled={busy === c.id} aria-label={`Rename ${c.title}`} title="Rename" className={iconButton}>
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => toggleArchive(c)} disabled={busy === c.id} aria-label={`${c.archived ? 'Restore' : 'Archive'} ${c.title}`} title={c.archived ? 'Restore' : 'Archive'} className={iconButton}>
                      {c.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => remove(c)} disabled={busy === c.id} aria-label={`Delete ${c.title}`} title="Delete" className={cx(iconButton, 'hover:text-red-600 dark:hover:text-red-400')}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

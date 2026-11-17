'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Copy, Lock, RotateCcw, Sparkles, X } from 'lucide-react';
import { getPlatformLabel, type ContentItem, type IdeaItem } from '@/src/lib/content-logic';
import { copyToClipboard, cx } from './ui';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface StudioChatPanelProps {
  items: ContentItem[];
  ideas: IdeaItem[];
  /** localStorage key for this account's chat; null disables saving. */
  historyKey: string | null;
  authToken: string | null;
  focusedItem: ContentItem | null;
  onClearFocus: () => void;
}

const STARTER_PROMPTS = [
  { title: 'Opening hooks', prompt: 'Write 3 opening hooks for my next video' },
  { title: 'Caption + tags', prompt: 'Draft a caption and 8 hashtags for my latest post' },
  { title: 'Posting plan', prompt: 'Suggest a weekly posting order for my posts in progress' },
];

const MAX_SAVED_TURNS = 60;

function loadHistory(key: string | null): ChatTurn[] {
  if (!key) return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((t) => t && (t.role === 'user' || t.role === 'model') && typeof t.text === 'string' && typeof t.id === 'string')
      : [];
  } catch {
    return [];
  }
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export const StudioChatPanel: React.FC<StudioChatPanelProps> = ({ items, ideas, historyKey, authToken, focusedItem, onClearFocus }) => {
  const [messages, setMessages] = useState<ChatTurn[]>(() => loadHistory(historyKey));
  const [input, setInput] = useState(() =>
    focusedItem
      ? `Write a high-retention hook, clean caption, and 8 hashtags for "${focusedItem.title}" (${getPlatformLabel(focusedItem.platform)}).`
      : ''
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const idCounterRef = useRef(1);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  // Keep this account's conversation across refreshes (browser only).
  useEffect(() => {
    if (!historyKey) return;
    try {
      if (messages.length) window.localStorage.setItem(historyKey, JSON.stringify(messages.slice(-MAX_SAVED_TURNS)));
      else window.localStorage.removeItem(historyKey);
    } catch {
      // Storage full or unavailable
    }
  }, [historyKey, messages]);

  // Auto-grow the composer up to ~5 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [input]);

  // Compact snapshot of the vault: most recent posts first, then open ideas.
  const buildVaultContext = () => {
    const posts = [...items]
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, 40)
      .map((i) => {
        const date = i.postDate ? `posted ${i.postDate}` : i.targetDate ? `target ${i.targetDate}` : '';
        const meta = [getPlatformLabel(i.platform), i.status, i.channelName, date].filter(Boolean).join(' · ');
        const tags = i.tags.length ? ` #${i.tags.slice(0, 6).join(' #')}` : '';
        return `- ${clip(i.title, 120)} [${meta}]${tags}`;
      });
    const openIdeas = ideas
      .filter((i) => !i.convertedItemId)
      .slice(0, 20)
      .map((i) => `- ${clip(i.title, 120)} [${getPlatformLabel(i.platform)}${i.targetDate ? ` · target ${i.targetDate}` : ''}]${i.notes ? `: ${clip(i.notes, 160)}` : ''}`);
    const lines = [`Posts (${items.length} total):`, ...posts];
    if (openIdeas.length) lines.push('', `Saved ideas (${openIdeas.length}):`, ...openIdeas);
    if (focusedItem) {
      lines.unshift(
        `Focused item: "${focusedItem.title}" (${getPlatformLabel(focusedItem.platform)}, channel: ${
          focusedItem.channelName || 'none'
        }, current caption: "${clip(focusedItem.caption, 1500)}", tags: ${focusedItem.tags.join(', ')})`,
        ''
      );
    }
    return clip(lines.join('\n'), 18000);
  };

  const sendMessage = async (textOverride?: string, history: ChatTurn[] = messages) => {
    const content = (textOverride ?? input).trim();
    if (!content || sending || !authToken) return;

    setError(null);
    idCounterRef.current += 1;
    const nextHistory = [...history, { id: `u-${idCounterRef.current}`, role: 'user' as const, text: content }];
    setMessages(nextHistory);
    if (textOverride === undefined) setInput('');
    setSending(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, text: m.text })),
          context: buildVaultContext(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to get an AI response.');

      idCounterRef.current += 1;
      setMessages((prev) => [
        ...prev,
        { id: `m-${idCounterRef.current}`, role: 'model', text: data.reply || 'No response text returned.' },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Studio AI right now.');
    } finally {
      setSending(false);
    }
  };

  const retry = () => {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) return;
    sendMessage(messages[lastUserIndex].text, messages.slice(0, lastUserIndex));
  };

  const handleCopy = async (turn: ChatTurn) => {
    if (await copyToClipboard(turn.text)) {
      setCopiedId(turn.id);
      setTimeout(() => setCopiedId((prev) => (prev === turn.id ? null : prev)), 1500);
    }
  };

  const reset = () => {
    setMessages([]);
    setError(null);
    onClearFocus();
  };

  return (
    <section
      aria-label="Studio AI chat"
      className="mx-auto flex h-[calc(100dvh-17rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] min-h-[380px] max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/80 bg-white shadow-xs lg:h-[calc(100dvh-12.5rem)] dark:border-zinc-800 dark:bg-zinc-900/60"
    >
      {focusedItem || messages.length ? (
        <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2.5 dark:border-zinc-800">
          {focusedItem ? (
            <span className="flex min-w-0 items-center gap-2 rounded-full bg-electric-50 py-1 pl-3 pr-1 text-xs font-medium text-electric-800 dark:bg-electric-950/50 dark:text-electric-200">
              <span className="truncate">About: {focusedItem.title}</span>
              <button
                type="button"
                onClick={onClearFocus}
                aria-label="Stop focusing on this post"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full hover:bg-electric-100 dark:hover:bg-electric-900"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ) : (
            <span />
          )}
          {messages.length ? (
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              New chat
            </button>
          ) : null}
        </div>
      ) : null}

      <div ref={threadRef} data-testid="chat-thread" className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cantaloupe-400 to-cantaloupe-600 text-white shadow-lg shadow-cantaloupe-500/30">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">What are we making today?</h2>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Hooks, titles, captions, hashtag sets and posting plans — using what’s in your vault.
            </p>
            {authToken ? (
              <div className="mt-6 grid w-full max-w-xl gap-2 sm:grid-cols-3">
                {STARTER_PROMPTS.map((p) => (
                  <button
                    key={p.title}
                    type="button"
                    onClick={() => sendMessage(p.prompt)}
                    className="rounded-2xl border border-zinc-200 bg-zinc-50/60 p-3.5 text-left transition-colors hover:border-electric-300 hover:bg-electric-50/50 dark:border-zinc-800 dark:bg-zinc-950/40 dark:hover:border-electric-800 dark:hover:bg-electric-950/30"
                  >
                    <span className="block text-[13px] font-semibold">{p.title}</span>
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{p.prompt}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-5">
            {messages.map((turn) =>
              turn.role === 'user' ? (
                <div key={turn.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-electric-600 px-4 py-2.5 text-sm leading-relaxed text-white">
                    {turn.text}
                  </p>
                </div>
              ) : (
                <div key={turn.id} className="flex gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cantaloupe-400 to-cantaloupe-600 text-white">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">{turn.text}</p>
                    <button
                      type="button"
                      onClick={() => handleCopy(turn)}
                      className="mt-2 inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      {copiedId === turn.id ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === turn.id ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )
            )}
            {sending ? (
              <div className="flex gap-3" aria-live="polite">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cantaloupe-400 to-cantaloupe-600 text-white">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-1 py-2" aria-label="Thinking">
                  {[0, 150, 300].map((d) => (
                    <span
                      key={d}
                      className="h-2 w-2 animate-bounce rounded-full bg-zinc-300 dark:bg-zinc-600"
                      style={{ animationDelay: `${d}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {error ? (
        <div
          role="alert"
          className="mx-3 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300"
        >
          <span>{error}</span>
          <button type="button" onClick={retry} className="shrink-0 font-semibold underline-offset-2 hover:underline">
            Retry
          </button>
        </div>
      ) : null}

      {authToken ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="p-3 pt-0"
        >
          <div className="flex items-end gap-2 rounded-3xl border border-zinc-200 bg-zinc-50 p-1.5 pl-4 transition-colors focus-within:border-electric-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-electric-500/10 dark:border-zinc-800 dark:bg-zinc-950 dark:focus-within:border-electric-700">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask for hooks, captions, hashtags…"
              aria-label="Message Studio AI"
              maxLength={8000}
              className="max-h-[140px] flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-6 text-zinc-950 placeholder:text-zinc-400 focus:outline-none sm:text-sm dark:text-zinc-50"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Send message"
              className={cx(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors',
                input.trim() && !sending
                  ? 'bg-electric-600 text-white hover:bg-electric-700'
                  : 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
              )}
            >
              <ArrowUp className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </form>
      ) : (
        <div className="m-3 mt-0 flex items-center gap-3 rounded-2xl bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
          <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sign in with Google to use Studio AI.
        </div>
      )}
    </section>
  );
};

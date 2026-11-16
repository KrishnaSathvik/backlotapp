'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Check, Copy, Send, Trash2 } from 'lucide-react';
import { getPlatformLabel, type ContentItem } from '@/src/lib/content-logic';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface StudioChatPanelProps {
  items: ContentItem[];
  focusedItem: ContentItem | null;
  onClearFocus: () => void;
}

const STARTER_PROMPTS = [
  'Write 3 opening hooks',
  'Draft caption & 8 tags',
  'Suggest weekly posting order',
];

export const StudioChatPanel: React.FC<StudioChatPanelProps> = ({
  items,
  focusedItem,
  onClearFocus,
}) => {
  const [messages, setMessages] = useState<ChatTurn[]>([
    {
      id: 'welcome',
      role: 'model',
      text: 'Ask for video hooks, YouTube titles, Instagram captions, hashtag sets, or production planning across your content vault.',
    },
  ]);
  const [input, setInput] = useState(() =>
    focusedItem
      ? `Write a high-retention hook, clean caption, and 8 hashtags for "${focusedItem.title}" (${getPlatformLabel(focusedItem.platform)}).`
      : ''
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const idCounterRef = useRef(1);

  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const buildVaultContext = () => {
    const lines = items.slice(0, 12).map(
      (i) =>
        `- ${i.title} [${getPlatformLabel(i.platform)} · ${i.status}${
          i.channelName ? ` · ${i.channelName}` : ''
        }]`
    );
    if (focusedItem) {
      lines.unshift(
        `Focused item: "${focusedItem.title}" (${getPlatformLabel(
          focusedItem.platform
        )}, channel: ${focusedItem.channelName || 'none'}, current caption: "${
          focusedItem.caption
        }", tags: ${focusedItem.tags.join(', ')})`
      );
    }
    return lines.join('\n');
  };

  const sendMessage = async (textOverride?: string) => {
    const content = (textOverride ?? input).trim();
    if (!content || sending) return;

    setError(null);
    idCounterRef.current += 1;
    const userTurn: ChatTurn = {
      id: `u-${idCounterRef.current}`,
      role: 'user',
      text: content,
    };

    const nextHistory = [...messages, userTurn];
    setMessages(nextHistory);
    if (!textOverride) setInput('');
    setSending(true);

    try {
      const apiMessages = nextHistory
        .filter((m) => m.id !== 'welcome')
        .map((m) => ({ role: m.role, text: m.text }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          context: buildVaultContext(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to get AI response.');
      }

      idCounterRef.current += 1;
      setMessages((prev) => [
        ...prev,
        {
          id: `m-${idCounterRef.current}`,
          role: 'model',
          text: data.reply || 'No response text returned.',
        },
      ]);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to reach Studio AI right now.'
      );
    } finally {
      setSending(false);
    }
  };

  const handleCopyReply = async (turn: ChatTurn) => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopiedId(turn.id);
      setTimeout(() => setCopiedId((prev) => (prev === turn.id ? null : prev)), 1500);
    } catch {
      // Ignore clipboard failure
    }
  };

  return (
    <section
      aria-label="Studio AI Chat"
      className="mx-auto flex h-[calc(100vh-190px)] min-h-[460px] max-w-4xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
        <div>
          <h2 className="text-base font-semibold text-zinc-950 dark:text-zinc-50">
            Studio AI Strategist
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Multi-turn assistant for hooks, captions, tags, and content flow
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setMessages([
              {
                id: 'welcome',
                role: 'model',
                text: 'Started a fresh conversation. Ask about hooks, captions, tags, or your upcoming uploads.',
              },
            ]);
            setError(null);
            onClearFocus();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      {focusedItem ? (
        <div className="flex items-center justify-between border-b border-zinc-200 bg-blue-50/70 px-5 py-2 text-xs text-blue-800 dark:border-zinc-800 dark:bg-blue-950/30 dark:text-blue-200">
          <span className="truncate">
            Focused on: <strong>{focusedItem.title}</strong>
          </span>
          <button
            type="button"
            onClick={onClearFocus}
            className="ml-2 font-medium hover:underline shrink-0"
          >
            Detach
          </button>
        </div>
      ) : null}

      {/* Scrollable Thread */}
      <div
        ref={threadRef}
        data-testid="chat-thread"
        className="flex-1 space-y-4 overflow-y-auto p-5"
      >
        {messages.map((turn) => (
          <div
            key={turn.id}
            className={`flex flex-col ${
              turn.role === 'user' ? 'items-end' : 'items-start'
            }`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                turn.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'border border-zinc-200 bg-zinc-50 text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100'
              }`}
            >
              <p className="whitespace-pre-wrap">{turn.text}</p>
            </div>
            {turn.role === 'model' && turn.id !== 'welcome' ? (
              <button
                type="button"
                onClick={() => handleCopyReply(turn)}
                className="mt-1 inline-flex items-center gap-1 px-1 text-[11px] font-medium text-zinc-500 hover:text-blue-600 dark:text-zinc-400 dark:hover:text-blue-400"
              >
                {copiedId === turn.id ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy response
                  </>
                )}
              </button>
            ) : null}
          </div>
        ))}

        {sending ? (
          <div className="flex items-start">
            <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              Thinking...
            </div>
          </div>
        ) : null}
      </div>

      {/* Quick Prompts */}
      <div className="flex flex-wrap gap-2 border-t border-zinc-100 px-5 py-2.5 dark:border-zinc-800">
        {STARTER_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => sendMessage(prompt)}
            className="h-8 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-xs font-medium text-zinc-700 hover:border-blue-600 hover:text-blue-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300 whitespace-nowrap shrink-0"
          >
            {prompt}
          </button>
        ))}
      </div>

      {error ? (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-t border-red-200 bg-red-50 px-5 py-2 text-xs font-medium text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              const lastUser = [...messages]
                .reverse()
                .find((m) => m.role === 'user');
              if (lastUser) sendMessage(lastUser.text);
            }}
            className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-semibold hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40 shrink-0"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* Composer */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendMessage();
        }}
        className="flex items-center gap-2 border-t border-zinc-200 p-4 dark:border-zinc-800"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask for hooks, captions, hashtags, or posting ideas..."
          aria-label="Message Studio AI"
          className="h-11 flex-1 rounded-xl border border-zinc-200 bg-white px-4 text-sm text-zinc-950 placeholder:text-zinc-400 focus:border-blue-600 focus:outline-none dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-50"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send message"
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </section>
  );
};

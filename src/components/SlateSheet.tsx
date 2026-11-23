'use client';

import React from 'react';
import type { ChannelItem } from '@/src/lib/content-logic';
import { SlateAvatar } from './SlateAvatar';
import { SlateChatsPanel } from './SlateChatsPanel';
import { SlatePreferencesPanel } from './SlatePreferencesPanel';
import { cx, Sheet, SheetCloseButton } from './ui';

export type SlateSheetTab = 'chats' | 'preferences';

/** One dialog for Slate's saved chats and creative preferences, switched by tabs. */
export function SlateSheet({
  tab,
  onTabChange,
  authToken,
  channels,
  currentConversationId,
  onOpenConversation,
  onConversationDeleted,
  onClose,
}: {
  tab: SlateSheetTab;
  onTabChange: (tab: SlateSheetTab) => void;
  authToken: string;
  channels: ChannelItem[];
  currentConversationId: string | null;
  onOpenConversation: (id: string) => void;
  onConversationDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const tabs: Array<{ key: SlateSheetTab; label: string }> = [
    { key: 'chats', label: 'Chats' },
    { key: 'preferences', label: 'Preferences' },
  ];

  return (
    <Sheet onClose={onClose} label={tab === 'chats' ? 'Your chats with Slate' : 'Creative preferences'} size="md">
      <div className="flex h-[min(80dvh,640px)] flex-col">
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4 sm:px-7 sm:pt-6">
          <div className="flex items-center gap-2.5">
            <SlateAvatar size={30} chip={false} />
            <h2 className="text-xl font-bold tracking-tight">Slate</h2>
          </div>
          <SheetCloseButton onClick={onClose} />
        </div>

        <div role="tablist" aria-label="Slate" className="mx-5 mb-4 flex border-b border-zinc-200 sm:mx-7 dark:border-zinc-800">
          {tabs.map((t) => {
            const on = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => onTabChange(t.key)}
                className={cx(
                  '-mb-px border-b-2 px-1 pb-2.5 text-[14px] font-semibold transition-colors [&:not(:first-child)]:ml-6',
                  on ? 'border-electric-600 text-zinc-950 dark:border-electric-400 dark:text-white' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'chats' ? (
          <SlateChatsPanel authToken={authToken} currentId={currentConversationId} onOpen={onOpenConversation} onDeleted={onConversationDeleted} />
        ) : (
          <SlatePreferencesPanel authToken={authToken} channels={channels} />
        )}
      </div>
    </Sheet>
  );
}

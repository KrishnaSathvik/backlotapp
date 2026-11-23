import React from 'react';
import { Check, Sparkles, X } from 'lucide-react';
import { SlateAvatar } from '../SlateAvatar';
import { cx } from '@/src/lib/cx';

export function Bubble({ me = false, children }: { me?: boolean; children: React.ReactNode }) {
  return (
    <div className={cx('flex items-end gap-3', me && 'justify-end')}>
      {!me ? <SlateAvatar size={34} /> : null}
      <div
        className={cx(
          'max-w-[85%] rounded-2xl px-4 py-3 text-[14px] leading-relaxed',
          me
            ? 'rounded-br-md bg-electric-600 text-white'
            : 'rounded-bl-md bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200 dark:bg-white/[0.07] dark:text-zinc-300 dark:shadow-none dark:ring-white/10'
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** Illustration of a Slate suggestion card: nothing changes until the creator applies it. */
export function SuggestionCard() {
  return (
    <div className="ml-11 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.05] dark:shadow-none">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-cantaloupe-600 dark:text-cantaloupe-400">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Suggested change
      </p>
      <p className="mt-2 text-[13px] font-semibold text-zinc-900 dark:text-white">Update caption · Desk setup tour</p>
      <p className="mt-1 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-400">
        “This $40 light changed every shot. Here’s the full desk, under $300.” #desksetup #creatorgear
      </p>
      <div className="mt-3 flex gap-2" aria-hidden="true">
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-electric-600 px-3 text-[12.5px] font-semibold text-white">
          <Check className="h-3.5 w-3.5" />
          Apply
        </span>
        <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 px-3 text-[12.5px] font-semibold text-zinc-700 dark:border-white/15 dark:text-zinc-300">
          <X className="h-3.5 w-3.5" />
          Dismiss
        </span>
      </div>
    </div>
  );
}

/** Sample Slate conversation (illustrative, not live). */
export function SlateConversation({ className }: { className?: string }) {
  return (
    <figure className={cx('space-y-3', className)}>
      <figcaption className="sr-only">Example conversation with Slate, ending in a suggested caption change to apply or dismiss.</figcaption>
      <Bubble me>Give me 3 hooks for the desk setup video.</Bubble>
      <Bubble>
        <span className="font-semibold text-zinc-950 dark:text-white">Here are three, based on your caption:</span>
        <br />
        1. “I rebuilt my desk for one reason.”
        <br />
        2. “This $40 light changed every shot.”
        <br />
        3. “Stop filming at eye level.”
      </Bubble>
      <Bubble me>Use the second one as the caption, with my usual tags.</Bubble>
      <Bubble>
        This $40 light changed every shot. Here’s the full desk, under $300. #desksetup #creatorgear
      </Bubble>
      <SuggestionCard />
    </figure>
  );
}

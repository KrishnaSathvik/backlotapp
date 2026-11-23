'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Hash,
  History,
  ImageIcon,
  Lightbulb,
  Plus,
  Scissors,
  Search,
  SlidersHorizontal,
  Square,
  SquarePen,
  Tags,
  Type,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import type { ChannelItem, ContentItem, IdeaItem } from '@/src/lib/content-logic';
import { readStreamEvents, stripRefMarkers } from '@/src/lib/slate/events';
import type { EntityRef, PreferenceProposal } from '@/src/lib/slate/tools';
import { SlateSheet, type SlateSheetTab } from './SlateSheet';
import { SlateActionCards, type ActionCardState, type AppliedResult } from './SlateActionCards';
import { PlatformIcon } from './PlatformIcon';
import { SlateAvatar } from './SlateAvatar';
import { ChannelScopeMenu } from './ChannelScopeMenu';
import { SlateMarkdown } from './SlateMarkdown';
import { copyToClipboard, cx, useFeedback } from './ui';

export interface ChatTurn {
  id: string;
  role: 'user' | 'model';
  text: string;
  /** The reply was cut short (Stop, or an error mid-answer). */
  stopped?: boolean;
  /** Validated references to the creator's own posts and ideas. */
  refs?: EntityRef[];
  /** Preferences Slate proposed in this reply; saved only if the creator confirms. */
  proposals?: ProposalState[];
  /** Changes Slate suggested in this reply; applied only when the creator approves. */
  actions?: ActionCardState[];
  /** A short note from the server, e.g. suggestions couldn't be prepared. */
  notice?: string;
  /** What the creator attached to this message (labels only). */
  attachments?: { kind: 'image'; label: string }[];
}

/** One image the creator explicitly chose for the next message. */
interface ImagePick {
  type: 'post' | 'idea';
  id: number;
  slot: 'cover' | 'slide' | 'screenshot';
  index?: number;
  label: string;
  url: string;
}

type ProposalState = PreferenceProposal & { status?: 'saving' | 'saved' | 'dismissed' | 'error' };

/** Shown in the demo so the Slate screen isn’t an empty composer. Not saved. */
const SAMPLE_THREAD: ChatTurn[] = [
  { id: 'demo-1', role: 'user', text: 'Give me 3 hooks for the desk setup video.' },
  {
    id: 'demo-2',
    role: 'model',
    text: 'Here are three, based on your desk setup video:\n\n1. “I rebuilt my desk for one reason.”\n2. “This $40 light changed every shot.”\n3. “Stop filming at eye level.”',
    refs: [{ type: 'post', id: 100, title: 'Minimalist Desk Camera Rig Breakdown 2026' }],
  },
];

/** What Slate is working on: one attached post or idea. */
export type ChatFocus = { kind: 'post'; id: number } | { kind: 'idea'; id: number };

interface StudioChatPanelProps {
  items: ContentItem[];
  ideas: IdeaItem[];
  channels: ChannelItem[];
  /** This account's key for browser storage (the old device-only chat, the open chat id); null when signed out. */
  historyKey: string | null;
  authToken: string | null;
  focus: ChatFocus | null;
  onFocusChange: (focus: ChatFocus | null) => void;
  /** Whether the Slate tab is showing. The panel stays mounted (hidden) on other tabs. */
  active?: boolean;
  /** Demo workspace: open on a sample conversation instead of the empty composer. */
  sample?: boolean;
  /** Explicitly replaces a post's caption with a reply. Never called without the user asking. */
  onApplyCaption: (itemId: number, caption: string) => Promise<boolean>;
  onSignIn?: () => void;
  /** Opens a referenced post or idea in its usual view. */
  onOpenRef?: (ref: EntityRef) => void;
  /** A suggested action was applied (or a conflict returned the latest post). */
  onActionApplied?: (result: AppliedResult) => void;
}

interface Suggestion {
  title: string;
  hint: string;
  icon: React.ElementType;
  prompt: string;
}

const GENERAL: Suggestion[] = [
  { title: 'Write better hooks', hint: 'Attention-grabbing openings', icon: Zap, prompt: 'Write 5 attention-grabbing opening hooks for my next post in progress. Keep each under 15 words.' },
  { title: 'Create captions', hint: 'Captions, tags and titles', icon: Type, prompt: 'Pick my post that most needs work and write a caption, 3 title options and 8 hashtags for it.' },
  { title: 'Develop an idea', hint: 'Turn inspiration into content', icon: Lightbulb, prompt: 'Pick my most promising saved idea and turn it into a post plan: angle, hook, shot list and caption.' },
  { title: 'Plan my content', hint: 'Build a posting plan', icon: CalendarDays, prompt: 'Build a posting plan for the next 2 weeks from my posts in progress and ready posts, with dates.' },
];

const FOR_POST: Suggestion[] = [
  { title: 'Improve the hook', hint: 'Stronger first 3 seconds', icon: Zap, prompt: 'Write 5 stronger opening hooks for the attached post.' },
  { title: 'Shorten the caption', hint: 'Tighter, same voice', icon: Scissors, prompt: 'Rewrite the attached post’s caption to be shorter and punchier. Keep my voice. Reply with only the new caption.' },
  { title: 'Title alternatives', hint: '5 options to test', icon: Type, prompt: 'Give me 5 alternative titles for the attached post.' },
  { title: 'Hashtag set', hint: 'Mix of broad and niche', icon: Tags, prompt: 'Suggest 10 hashtags for the attached post, mixing broad and niche tags.' },
];

const FOR_IDEA: Suggestion[] = [
  { title: 'Develop into a post', hint: 'Angle, hook, shots, caption', icon: Wand2, prompt: 'Develop the attached idea into a post: angle, hook, shot list and a draft caption.' },
  { title: 'Write hooks', hint: '5 ways to open', icon: Zap, prompt: 'Write 5 opening hooks for the attached idea.' },
  { title: 'Draft a caption', hint: 'With hashtags', icon: Type, prompt: 'Draft a caption and 8 hashtags for the attached idea.' },
  { title: 'Best channel and format', hint: 'Where it fits', icon: Hash, prompt: 'Which of my channels and formats would the attached idea fit best, and why?' },
];

/** Chats used to live only in this browser; they're imported to the account once. */
function loadLegacyHistory(key: string | null): ChatTurn[] {
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

export const StudioChatPanel: React.FC<StudioChatPanelProps> = ({
  items,
  ideas,
  channels,
  historyKey,
  authToken,
  focus,
  active = true,
  sample = false,
  onFocusChange,
  onApplyCaption,
  onSignIn,
  onOpenRef,
  onActionApplied,
}) => {
  const { confirm } = useFeedback();
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  /** The saved conversation this thread belongs to (null until the first reply starts). */
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState<SlateSheetTab | null>(null);
  const [imagePick, setImagePick] = useState<ImagePick | null>(null);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const openKey = historyKey ? historyKey.replace(/^cv_chat_/, 'cv_slate_open_') : null;
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  /** 'all' or a channel id, sent to the server as channelId. */
  const [scope, setScope] = useState('all');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [nudge, setNudge] = useState(false);
  /** What Slate is looking up right now, e.g. "Searching your posts". */
  const [toolLabel, setToolLabel] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const idCounterRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);

  // Leaving Slate cancels any reply in progress.
  useEffect(() => () => abortRef.current?.abort(), []);

  // Always read the live record, so edits (or an applied caption) show up here.
  const post = focus?.kind === 'post' ? items.find((i) => i.id === focus.id) ?? null : null;
  const idea = focus?.kind === 'idea' ? ideas.find((i) => i.id === focus.id) ?? null : null;
  const suggestions = post ? FOR_POST : idea ? FOR_IDEA : GENERAL;

  // Images the creator can choose to show Slate (never sent unless picked).
  const imageOptions: ImagePick[] = post
    ? [
        ...(post.coverAsset?.url && post.coverAsset.mimeType.startsWith('image/') ? [{ type: 'post' as const, id: post.id, slot: 'cover' as const, label: `Cover of “${post.title}”`, url: post.coverAsset.url }] : []),
        ...post.slides
          .map((sl, i) => ({ sl, i }))
          .filter(({ sl }) => sl.mimeType.startsWith('image/'))
          .slice(0, 20)
          .map(({ sl, i }) => ({ type: 'post' as const, id: post.id, slot: 'slide' as const, index: i, label: `Slide ${i + 1} of “${post.title}”`, url: sl.url })),
      ]
    : idea?.screenshotUrl
    ? [{ type: 'idea' as const, id: idea.id, slot: 'screenshot' as const, label: `Screenshot in “${idea.title}”`, url: idea.screenshotUrl }]
    : [];
  // A pick belongs to the attached post or idea; drop it if that changes.
  const activePick = imagePick && imageOptions.some((o) => o.url === imagePick.url && o.slot === imagePick.slot && o.index === imagePick.index) ? imagePick : null;

  // The demo opens on a sample conversation. Leaving the demo drops only those messages.
  useEffect(() => {
    if (sample) {
      setMessages(SAMPLE_THREAD);
      return;
    }
    setMessages((current) => (current.some((m) => m.id.startsWith('demo-')) ? [] : current));
  }, [sample]);

  // Jump to the latest message on open, then follow new messages smoothly.
  const scrolledOnceRef = useRef(false);
  useEffect(() => {
    const el = threadRef.current;
    if (!el || !active) return;
    el.scrollTo({ top: el.scrollHeight, behavior: scrolledOnceRef.current && !sending ? 'smooth' : 'auto' });
    scrolledOnceRef.current = true;
  }, [messages, sending, error, active]);

  const setConversationId = useCallback(
    (id: string | null) => {
      setConversationIdState(id);
      if (!openKey) return;
      try {
        if (id) window.localStorage.setItem(openKey, id);
        else window.localStorage.removeItem(openKey);
      } catch {
        // Storage unavailable: the chat is still saved to the account.
      }
    },
    [openKey]
  );

  /** Loads a saved conversation from the account (any device). */
  const openConversation = useCallback(
    async (id: string) => {
      if (!authToken) return;
      abortRef.current?.abort();
      setLoadingThread(true);
      setError(null);
      try {
        const res = await fetch(`/api/slate/conversations/${id}`, { headers: { Authorization: `Bearer ${authToken}` } });
        if (res.status === 404) {
          setConversationId(null);
          setMessages([]);
          return;
        }
        if (!res.ok) throw new Error('Couldn’t open that chat.');
        const data = await res.json();
        setMessages(
          (data.messages as Array<{ seq: number; role: 'user' | 'model'; text: string; stopped: boolean; refs: EntityRef[]; proposals: ProposalState[]; actions: ActionCardState[]; attachments?: { kind: 'image'; label: string }[] }>).map((m) => ({
            id: `s-${id}-${m.seq}`,
            role: m.role,
            text: m.text,
            ...(m.stopped ? { stopped: true } : {}),
            ...(m.refs?.length ? { refs: m.refs } : {}),
            ...(m.proposals?.length ? { proposals: m.proposals } : {}),
            ...(m.actions?.length ? { actions: m.actions } : {}),
            ...(m.attachments?.length ? { attachments: m.attachments } : {}),
          }))
        );
        setConversationId(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t open that chat.');
      } finally {
        setLoadingThread(false);
      }
    },
    [authToken, setConversationId]
  );

  // On sign-in: import the old device-only chat once, otherwise reopen the last chat.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !authToken || !historyKey) return;
    restoredRef.current = true;
    const legacy = loadLegacyHistory(historyKey);
    if (legacy.length) {
      fetch('/api/slate/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ title: 'Earlier chat', messages: legacy.slice(-60).map((m) => ({ role: m.role, text: m.text })) }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { id?: string } | null) => {
          if (!d?.id) return;
          try {
            window.localStorage.removeItem(historyKey);
          } catch {
            // ignore
          }
          openConversation(d.id);
        })
        .catch(() => {});
      return;
    }
    let saved: string | null = null;
    try {
      saved = openKey ? window.localStorage.getItem(openKey) : null;
    } catch {
      saved = null;
    }
    // Deferred so the load (and its state updates) runs after this effect.
    if (saved) Promise.resolve(saved).then(openConversation);
  }, [authToken, historyKey, openKey, openConversation]);

  // Auto-grow the composer up to ~5 lines.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (!pickerRef.current?.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const sendMessage = async (textOverride?: string, history: ChatTurn[] = messages) => {
    const content = (textOverride ?? input).trim();
    if (!content || sending) return;
    if (!authToken) {
      setNudge(true);
      setTimeout(() => setNudge(false), 900);
      return;
    }

    setError(null);
    idCounterRef.current += 1;
    const pick = activePick;
    const userTurn: ChatTurn = { id: `u-${idCounterRef.current}`, role: 'user', text: content, ...(pick ? { attachments: [{ kind: 'image' as const, label: pick.label }] } : {}) };
    setImagePick(null);
    const nextHistory = [...history, userTurn];
    setMessages(nextHistory);
    if (textOverride === undefined) setInput('');
    setSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    idCounterRef.current += 1;
    const replyId = `m-${idCounterRef.current}`;
    let reply = '';
    // One reply bubble per request, created on the first piece of text and updated in place.
    const patchReply = (patch: Partial<ChatTurn>) =>
      setMessages((prev) => {
        const i = prev.findIndex((m) => m.id === replyId);
        if (i === -1) return [...prev, { id: replyId, role: 'model', text: '', ...patch }];
        const copy = prev.slice();
        copy[i] = { ...copy[i], ...patch };
        return copy;
      });
    const showReply = (text: string, stopped?: boolean) => patchReply({ text, ...(stopped ? { stopped: true } : {}) });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        // Only the new message and ids: the server keeps the conversation and looks up the
        // post, idea and channel for this account.
        body: JSON.stringify({
          conversationId,
          message: content,
          focus: focus ? { type: focus.kind, id: focus.id } : null,
          channelId: scope === 'all' ? null : Number(scope),
          // Only when the creator picked one; attaching a post never sends its images.
          ...(pick ? { image: { type: pick.type, id: pick.id, slot: pick.slot, ...(pick.slot === 'slide' ? { index: pick.index } : {}) } } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Slate can’t be reached right now.');
      }
      for await (const event of readStreamEvents(res.body)) {
        if (event.type === 'conversation') {
          setConversationId(event.id);
        } else if (event.type === 'tool') {
          setToolLabel(event.label);
        } else if (event.type === 'delta') {
          setToolLabel(null);
          reply += event.text;
          showReply(reply);
        } else if (event.type === 'refs') {
          patchReply({ refs: event.refs });
        } else if (event.type === 'proposal') {
          const proposal = event.proposal;
          setMessages((prev) =>
            prev.map((m) => (m.id === replyId ? { ...m, proposals: [...(m.proposals ?? []), proposal] } : m))
          );
        } else if (event.type === 'actions') {
          patchReply({ actions: event.actions });
        } else if (event.type === 'notice') {
          patchReply({ notice: event.text });
        } else if (event.type === 'done') {
          // Hit the output cap: keep the text but mark it as cut short.
          if (event.finishReason === 'MAX_TOKENS' && reply) showReply(reply, true);
        } else if (event.type === 'error') {
          if (reply) showReply(reply, true);
          throw new Error(event.error);
        }
      }
      if (!reply) showReply('Slate didn’t return any text. Try rephrasing.');
    } catch (err) {
      if (controller.signal.aborted) {
        if (reply) showReply(reply, true);
      } else {
        setError(err instanceof Error ? err.message : 'Slate can’t be reached right now.');
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setToolLabel(null);
      setSending(false);
    }
  };

  /** Stop cancels the request itself, which closes the model call on the server. */
  const stop = () => abortRef.current?.abort();

  const retry = () => {
    const lastUserIndex = messages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIndex === -1) return;
    // Drop the failed question and any partial reply so nothing is duplicated.
    sendMessage(messages[lastUserIndex].text, messages.slice(0, lastUserIndex));
  };

  const handleCopy = async (turn: ChatTurn) => {
    if (await copyToClipboard(stripRefMarkers(turn.text))) {
      setCopiedId(turn.id);
      setTimeout(() => setCopiedId((prev) => (prev === turn.id ? null : prev)), 1500);
    }
  };

  const applyCaption = async (turn: ChatTurn) => {
    if (!post) return;
    const ok = await confirm({
      title: 'Use this as the caption?',
      body: `This replaces the current caption on “${post.title}”. You can still edit it in the post afterwards.`,
      confirmLabel: 'Replace caption',
    });
    if (!ok) return;
    if (await onApplyCaption(post.id, stripRefMarkers(turn.text).trim())) setAppliedId(turn.id);
  };

  const setProposalStatus = (turnId: string, index: number, status: ProposalState['status']) =>
    setMessages((prev) =>
      prev.map((m) => (m.id === turnId ? { ...m, proposals: m.proposals?.map((p, i) => (i === index ? { ...p, status } : p)) } : m))
    );

  const saveProposal = async (turnId: string, index: number, proposal: ProposalState) => {
    if (!authToken) return;
    setProposalStatus(turnId, index, 'saving');
    try {
      const res = await fetch('/api/slate/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ key: proposal.key, value: proposal.value, channelId: proposal.channelId, source: 'slate_confirmed' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Couldn’t save that preference.');
      setProposalStatus(turnId, index, 'saved');
    } catch (err) {
      setProposalStatus(turnId, index, 'error');
      setError(err instanceof Error ? err.message : 'Couldn’t save that preference.');
    }
  };

  const updateAction = (next: ActionCardState) =>
    setMessages((prev) =>
      prev.map((m) => (m.actions?.some((a) => a.id === next.id) ? { ...m, actions: m.actions.map((a) => (a.id === next.id ? next : a)) } : m))
    );

  const regenerate = (a: ActionCardState) => {
    const what = a.target ? `“${a.target.title}”` : 'that draft';
    sendMessage(`Suggest a different version of that change for ${what} (${a.summary.toLowerCase()}), using its latest saved content.`);
  };

  const newChat = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setError(null);
    setInput('');
  };

  const pick = (next: ChatFocus) => {
    onFocusChange(next);
    setPickerOpen(false);
    setPickerQuery('');
  };

  const pq = pickerQuery.trim().toLowerCase();
  const pickPosts = items.filter((i) => !pq || i.title.toLowerCase().includes(pq)).slice(0, 30);
  const pickIdeas = ideas.filter((i) => !pq || i.title.toLowerCase().includes(pq)).slice(0, 30);

  const attachedTitle = post?.title ?? idea?.title ?? '';

  const empty = messages.length === 0;
  const lastTurn = messages[messages.length - 1];
  const streamingId = sending && lastTurn?.role === 'model' ? lastTurn.id : null;
  const locked = !authToken;
  const scopeLabel = scope === 'all' ? 'All channels' : channels.find((c) => String(c.id) === scope)?.name ?? 'All channels';

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (locked) onSignIn?.();
        else sendMessage();
      }}
      className={cx('mx-auto w-full max-w-3xl shrink-0 px-3 pb-2 sm:px-6 md:pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:pb-4', empty ? 'order-3 lg:order-2' : 'order-3')}
    >
      <div
        ref={pickerRef}
        className={cx(
          'relative rounded-[28px] border border-zinc-200 bg-white shadow-[0_8px_30px_-12px_rgba(10,20,60,0.18)] transition-[box-shadow,border-color] focus-within:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:shadow-black/40 dark:focus-within:border-zinc-700',
          nudge && 'border-electric-400 ring-4 ring-electric-500/20 dark:border-electric-600'
        )}
      >
        {post || idea ? (
          <div className="px-3 pt-3">
            <span className="inline-flex h-8 max-w-full items-center gap-2 rounded-xl bg-zinc-100 pl-2.5 pr-1 text-[13px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              {post ? <PlatformIcon platform={post.platform} size={15} /> : <Lightbulb className="h-4 w-4 text-muted" aria-hidden="true" />}
              <span className="truncate">{attachedTitle}</span>
              <button
                type="button"
                onClick={() => {
                  setImagePick(null);
                  onFocusChange(null);
                }}
                aria-label={`Detach ${attachedTitle}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
            {imageOptions.length && !locked ? (
              activePick ? (
                <span className="ml-1.5 inline-flex h-8 max-w-full items-center gap-2 rounded-xl bg-electric-50 pl-1 pr-1 text-[13px] font-medium text-electric-800 dark:bg-electric-950/40 dark:text-electric-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={activePick.url} alt="" className="h-6 w-6 rounded-md object-cover" />
                  <span className="truncate">Slate will look at: {activePick.label}</span>
                  <button
                    type="button"
                    onClick={() => setImagePick(null)}
                    aria-label="Don’t send this image"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg hover:bg-electric-100 dark:hover:bg-electric-900/50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </span>
              ) : (
                <span className="relative ml-1.5 inline-block">
                  <button
                    type="button"
                    onClick={() => setImageMenuOpen((v) => !v)}
                    aria-expanded={imageMenuOpen}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-2.5 text-[12.5px] font-medium text-zinc-600 hover:border-electric-400 hover:text-electric-700 dark:border-zinc-700 dark:text-zinc-300"
                  >
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Show Slate an image
                  </button>
                  {imageMenuOpen ? (
                    <span className="absolute bottom-full left-0 z-30 mb-2 block w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-zinc-200 bg-white p-2 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
                      <span className="block px-1.5 pb-1.5 text-[11.5px] text-zinc-500">One image per message. Only the one you pick is sent.</span>
                      <span className="grid grid-cols-4 gap-1.5">
                        {imageOptions.map((o) => (
                          <button
                            key={`${o.slot}-${o.index ?? 0}`}
                            type="button"
                            onClick={() => {
                              setImagePick(o);
                              setImageMenuOpen(false);
                            }}
                            title={o.label}
                            aria-label={o.label}
                            className="aspect-square overflow-hidden rounded-lg border border-zinc-200 hover:ring-2 hover:ring-electric-400 dark:border-zinc-700"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={o.url} alt="" className="h-full w-full object-cover" />
                          </button>
                        ))}
                      </span>
                    </span>
                  ) : null}
                </span>
              )
            ) : null}
          </div>
        ) : null}

        <div className="flex items-end gap-1 p-1.5 md:grid md:grid-cols-[auto_minmax(0,1fr)_auto] md:p-0">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-expanded={pickerOpen}
          aria-label="Attach a post or idea"
          title="Attach a post or idea"
          className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-200 text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 md:col-start-1 md:row-start-2 md:mb-2.5 md:ml-2.5 md:mt-1 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>

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
          placeholder={
            post || idea
              ? `Ask about “${clip(attachedTitle, 40)}”…`
              : 'Message Slate'
          }
          aria-label="Message Slate"
          maxLength={8000}
          className="block max-h-[200px] min-w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[16px] leading-6 text-zinc-950 placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed md:col-span-3 md:row-start-1 md:w-full md:flex-none md:px-5 md:pb-1 md:pt-4 lg:text-[15px] dark:text-zinc-50 dark:placeholder:text-zinc-500"
        />

        <div className="mb-0.5 flex shrink-0 items-center gap-1.5 md:col-start-3 md:row-start-2 md:mb-2.5 md:mr-2.5 md:mt-1 md:justify-self-end">
          {locked ? (
            onSignIn && input.trim() ? (
              <button
                type="submit"
                className="ml-auto h-9 shrink-0 rounded-full bg-zinc-950 px-4 text-[13px] font-semibold text-white transition-colors hover:bg-electric-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white"
              >
                Sign in
              </button>
            ) : (
            <button
              type="button"
              disabled
              aria-label="Send message"
              className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
            </button>
            )
          ) : sending ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Stop generating"
              title="Stop"
              className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-950 text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <Square className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              aria-label="Send message"
              className={cx(
                'ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors',
                input.trim()
                  ? 'bg-zinc-950 text-white hover:bg-electric-600 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white'
                  : 'bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500'
              )}
            >
              <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden="true" />
            </button>
          )}
        </div>
        </div>

        {pickerOpen ? (
          <div className="animate-pop-in absolute bottom-full left-0 z-20 mb-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="relative border-b border-zinc-100 dark:border-zinc-800">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input
                autoFocus
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Find a post or idea…"
                aria-label="Find a post or idea"
                className="h-11 w-full bg-transparent pl-9 pr-3 text-base focus:outline-none lg:text-sm"
              />
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5">
              {[
                { label: 'Posts', rows: pickPosts.map((i) => ({ key: `p-${i.id}`, title: i.title, icon: <PlatformIcon platform={i.platform} size={16} />, onPick: () => pick({ kind: 'post', id: i.id }) })) },
                { label: 'Ideas', rows: pickIdeas.map((i) => ({ key: `i-${i.id}`, title: i.title, icon: <Lightbulb className="h-4 w-4 text-muted" aria-hidden="true" />, onPick: () => pick({ kind: 'idea', id: i.id }) })) },
              ].map((group) =>
                group.rows.length ? (
                  <div key={group.label} className="mb-1">
                    <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{group.label}</p>
                    {group.rows.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={r.onPick}
                        className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {r.icon}
                        <span className="truncate">{r.title}</span>
                      </button>
                    ))}
                  </div>
                ) : null
              )}
              {!pickPosts.length && !pickIdeas.length ? (
                <p className="px-3 py-4 text-center text-[13px] text-zinc-500">Nothing matches “{pickerQuery}”.</p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <p className="hidden pt-2 text-center text-[11.5px] text-zinc-400 lg:block dark:text-zinc-500">
        Slate can make mistakes. Check replies before you post.
      </p>
    </form>
  );

  return (
    <section aria-label="Chat with Slate" className="flex min-h-0 flex-1 flex-col">
      {/* Top bar: Slate + channel focus on the left, new chat on the right */}
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 px-3 sm:px-5">
        <ChannelScopeMenu value={scope} onChange={setScope} channels={channels} items={items} />
        <div className="flex shrink-0 items-center gap-1">
          {authToken ? (
            <button
              type="button"
              onClick={() => setSheetTab('chats')}
              aria-label="Chats and preferences"
              title="Chats and preferences"
              className="flex h-10 w-10 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white"
            >
              <History className="h-[19px] w-[19px]" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={newChat}
            disabled={empty && !input}
            aria-label="New chat"
            title="New chat"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white"
          >
            <SquarePen className="h-[19px] w-[19px]" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {empty && loadingThread ? (
          <p className="order-1 my-auto animate-pulse text-center text-[14px] text-zinc-500 dark:text-zinc-400" aria-live="polite">
            Opening chat…
          </p>
        ) : empty ? (
          <>
            <div className="order-1 my-auto px-6 text-center lg:mb-7 lg:mt-auto">
              <SlateAvatar size={56} chip={false} className="mx-auto animate-float" />
              <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-[30px]">
                {post || idea ? 'Let’s work on this together' : 'What’s on your mind?'}
              </h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                {post
                  ? 'I can see this post’s caption, tags and notes.'
                  : idea
                  ? 'I can see this idea’s notes and link.'
                  : 'Ask Slate about your content, ideas, or what you’re planning next.'}
              </p>
            </div>

            <div className="order-2 pb-2 lg:order-3 lg:mb-auto lg:pb-[14vh] lg:pt-4">
              <div className="mx-auto flex max-w-3xl flex-wrap justify-center gap-2 px-4 sm:px-6">
                {suggestions.map((s) => (
                  <button
                    key={s.title}
                    type="button"
                    onClick={() => sendMessage(s.prompt)}
                    className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-zinc-200 px-4 text-[13.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800/70 dark:hover:text-white"
                  >
                    <s.icon className="h-4 w-4 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div ref={threadRef} data-testid="chat-thread" className="order-1 min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto max-w-3xl space-y-8 px-4 pb-6 pt-4 sm:px-6">
              {messages.map((turn) =>
                turn.role === 'user' ? (
                  <div key={turn.id} className="flex flex-col items-end gap-1.5">
                    {turn.attachments?.map((att) => (
                      <span key={att.label} className="inline-flex max-w-[85%] items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-[12px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span className="truncate">{att.label}</span>
                      </span>
                    ))}
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 text-zinc-900 sm:max-w-[75%] dark:bg-zinc-800 dark:text-zinc-100">
                      {turn.text}
                    </p>
                  </div>
                ) : (
                  <div key={turn.id} className="group flex gap-3 sm:gap-4">
                    <SlateAvatar size={28} chip={false} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <SlateMarkdown text={stripRefMarkers(turn.text)} />
                      {turn.id === streamingId && toolLabel ? (
                        <p className="mt-2 animate-pulse text-[13px] text-zinc-500 dark:text-zinc-400" aria-live="polite">{toolLabel}…</p>
                      ) : null}
                      {turn.stopped ? <p className="mt-2 text-xs font-medium text-zinc-400">Reply cut short</p> : null}
                      {turn.refs?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Referenced posts and ideas">
                          {turn.refs.map((r) => (
                            <button
                              key={`${r.type}-${r.id}`}
                              type="button"
                              onClick={() => onOpenRef?.(r)}
                              disabled={r.missing}
                              title={r.missing ? 'Deleted from Backlot' : undefined}
                              className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-[12.5px] font-medium text-zinc-700 transition-colors hover:border-electric-300 hover:text-electric-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-electric-800 dark:hover:text-electric-300 disabled:cursor-default disabled:opacity-60 disabled:hover:border-zinc-200 disabled:hover:text-zinc-700 dark:disabled:hover:border-zinc-800 dark:disabled:hover:text-zinc-300"
                            >
                              {r.type === 'post' ? (
                                <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              ) : (
                                <Lightbulb className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
                              )}
                              <span className={cx('truncate', r.missing && 'line-through')}>{r.title}</span>
                              {r.missing ? <span className="shrink-0 text-[11px] font-normal text-zinc-400">deleted</span> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {turn.proposals?.map((p, i) => (
                        <div
                          key={`${p.key}-${i}`}
                          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-electric-200 bg-electric-50/60 px-4 py-3 dark:border-electric-900/60 dark:bg-electric-950/30"
                        >
                          <SlidersHorizontal className="h-4 w-4 shrink-0 text-electric-600 dark:text-electric-400" aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-electric-700 dark:text-electric-300">
                              {p.status === 'saved' ? 'Preference saved' : 'Save this preference?'}
                            </p>
                            <p className="text-[13.5px] text-zinc-800 dark:text-zinc-200">{p.label}</p>
                          </div>
                          {p.status === 'saved' ? (
                            <Check className="h-4 w-4 text-link" aria-label="Saved" />
                          ) : p.status === 'dismissed' ? (
                            <span className="text-xs text-zinc-400">Dismissed</span>
                          ) : (
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => setProposalStatus(turn.id, i, 'dismissed')}
                                disabled={p.status === 'saving'}
                                className="h-8 rounded-full px-3 text-xs font-semibold text-zinc-600 hover:bg-white dark:text-zinc-300 dark:hover:bg-zinc-800"
                              >
                                Dismiss
                              </button>
                              <button
                                type="button"
                                onClick={() => saveProposal(turn.id, i, p)}
                                disabled={p.status === 'saving' || !authToken}
                                className="h-8 rounded-full bg-zinc-950 px-3.5 text-xs font-semibold text-white hover:bg-electric-600 disabled:opacity-60 dark:bg-white dark:text-zinc-950 dark:hover:bg-electric-500 dark:hover:text-white"
                              >
                                {p.status === 'saving' ? 'Saving…' : p.status === 'error' ? 'Try again' : 'Save'}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                      {turn.actions?.length ? (
                        <SlateActionCards
                          actions={turn.actions}
                          authToken={authToken}
                          onChange={updateAction}
                          onApplied={(r) => onActionApplied?.(r)}
                          onRegenerate={regenerate}
                          onOpenPost={(id) => onOpenRef?.({ type: 'post', id, title: '' })}
                        />
                      ) : null}
                      {turn.notice ? <p className="mt-2 text-[12.5px] text-zinc-500 dark:text-zinc-400">{turn.notice}</p> : null}
                      {turn.id === streamingId ? null : (
                      <div className="-ml-2 mt-2 flex items-center gap-0.5 transition-opacity lg:pointer-fine:opacity-0 lg:pointer-fine:group-hover:opacity-100 lg:pointer-fine:group-focus-within:opacity-100 lg:pointer-fine:[.group:last-child_&]:opacity-100">
                        <button
                          type="button"
                          onClick={() => handleCopy(turn)}
                          aria-label={copiedId === turn.id ? 'Copied' : 'Copy reply'}
                          title="Copy"
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                        >
                          {copiedId === turn.id ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
                        </button>
                        {post ? (
                          <button
                            type="button"
                            onClick={() => applyCaption(turn)}
                            disabled={appliedId === turn.id}
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text disabled:text-text disabled:hover:bg-transparent"
                          >
                            {appliedId === turn.id ? <Check className="h-4 w-4" aria-hidden="true" /> : <FileText className="h-4 w-4" aria-hidden="true" />}
                            {appliedId === turn.id ? 'Caption updated' : 'Use as caption'}
                          </button>
                        ) : null}
                      </div>
                      )}
                    </div>
                  </div>
                )
              )}
              {sending && !streamingId ? (
                <div className="flex gap-3 sm:gap-4" aria-live="polite">
                  <SlateAvatar size={28} chip={false} thinking className="shrink-0" />
                  <span className="animate-pulse pt-0.5 text-[15px] text-zinc-500 dark:text-zinc-400">{toolLabel ? `${toolLabel}…` : 'Thinking…'}</span>
                </div>
              ) : null}
              {error ? (
                <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  <span>{error}</span>
                  <button type="button" onClick={retry} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                    Retry
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {composer}
      </div>
      {sheetTab && authToken ? (
        <SlateSheet
          tab={sheetTab}
          onTabChange={setSheetTab}
          authToken={authToken}
          channels={channels}
          currentConversationId={conversationId}
          onOpenConversation={(id) => {
            setSheetTab(null);
            openConversation(id);
          }}
          onConversationDeleted={() => {
            setConversationId(null);
            setMessages([]);
          }}
          onClose={() => setSheetTab(null)}
        />
      ) : null}
    </section>
  );
};

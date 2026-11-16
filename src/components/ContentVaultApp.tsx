'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns3, LayoutGrid, Lightbulb, MessageSquare, Plus, Sparkles } from 'lucide-react';
import { onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  convertIdeaToPostDraft,
  filterContentItems,
  type ChannelItem,
  type ContentItem,
  type IdeaItem,
  type LibraryFilters,
  type MediaAsset,
  type PlatformKey,
  type StatusKey,
  type ThemePreference,
} from '@/src/lib/content-logic';
import { auth, googleAuthProvider } from '@/src/lib/firebase';
import { loadPreviewWorkspace, savePreviewWorkspace } from '@/src/lib/local-vault';
import { SEED_CHANNELS, SEED_IDEAS, SEED_ITEMS } from '@/src/lib/seed-data';
import { AccountMenu } from './AccountMenu';
import { AuthGate } from './AuthGate';
import { BoardView } from './BoardView';
import { IdeasView } from './IdeasView';
import { ItemDetailModal } from './ItemDetailModal';
import { ItemEditorModal } from './ItemEditorModal';
import { LibraryView } from './LibraryView';
import { OfflineIndicator } from './PWAControls';
import { StudioChatPanel } from './StudioChatPanel';
import { buttonStyles, cx, FeedbackProvider, sizes, useFeedback } from './ui';

type ActiveTab = 'library' | 'ideas' | 'tracker' | 'chat';

const TABS: Array<{ key: ActiveTab; label: string; short: string; icon: React.ElementType }> = [
  { key: 'library', label: 'Library', short: 'Library', icon: LayoutGrid },
  { key: 'ideas', label: 'Ideas', short: 'Ideas', icon: Lightbulb },
  { key: 'tracker', label: 'Tracker', short: 'Tracker', icon: Columns3 },
  { key: 'chat', label: 'Studio AI', short: 'AI', icon: MessageSquare },
];

const PAGE_COPY: Record<ActiveTab, { title: string; subtitle?: string }> = {
  library: { title: 'Library' },
  ideas: { title: 'Ideas', subtitle: 'Save links, screenshots and notes for later.' },
  tracker: { title: 'Tracker', subtitle: 'Move posts from idea to posted.' },
  chat: { title: 'Studio AI', subtitle: 'Hooks, captions, tags and planning help.' },
};

const SESSION_COOKIE = 'cv_session';

function setSessionCookie(token: string | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = token
    ? `${SESSION_COOKIE}=${token}; Path=/api/files; Max-Age=3600; SameSite=Strict${secure}`
    : `${SESSION_COOKIE}=; Path=/api/files; Max-Age=0; SameSite=Strict${secure}`;
}

function readTabFromUrl(): ActiveTab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'ideas' || t === 'tracker' || t === 'chat' ? t : 'library';
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === 'string' ? data.error : fallback;
}

export const ContentVaultApp: React.FC = () => (
  <FeedbackProvider>
    <VaultShell />
  </FeedbackProvider>
);

const VaultShell: React.FC = () => {
  const { toast, confirm } = useFeedback();

  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTabState] = useState<ActiveTab>('library');
  const [themePref, setThemePref] = useState<ThemePreference>('system');

  const [channels, setChannels] = useState<ChannelItem[]>([]);
  const [items, setItems] = useState<ContentItem[]>([]);
  const [ideas, setIdeas] = useState<IdeaItem[]>([]);
  const [loadingWorkspace, setLoadingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  const [filters, setFilters] = useState<LibraryFilters>({
    platform: 'all',
    channel: 'all',
    status: 'all',
    search: '',
  });

  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [chatFocusedItem, setChatFocusedItem] = useState<ContentItem | null>(null);
  const [sharedDraft, setSharedDraft] = useState<{ title: string; text: string; url: string } | null>(
    null
  );

  /* ---------------- Tabs <-> URL (refresh + back button keep the tab) ---------------- */

  const setActiveTab = useCallback((tab: ActiveTab) => {
    setActiveTabState(tab);
    const url = new URL(window.location.href);
    if (tab === 'library') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    if (url.href !== window.location.href) window.history.pushState(null, '', url);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const sync = () => setActiveTabState(readTabFromUrl());
    // Deferred: the URL is only readable after hydration.
    Promise.resolve().then(sync);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  /* ---------------- Theme ---------------- */

  useEffect(() => {
    Promise.resolve().then(() => {
      try {
        const saved = window.localStorage.getItem('slatevault_theme') as ThemePreference | null;
        if (saved === 'light' || saved === 'dark' || saved === 'system') setThemePref(saved);
      } catch {
        // Storage unavailable
      }
    });
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const dark = themePref === 'dark' || (themePref === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', dark);
    };
    applyTheme();
    try {
      window.localStorage.setItem('slatevault_theme', themePref);
    } catch {
      // Storage unavailable
    }
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [themePref]);

  /* ---------------- Preview mode + PWA share target ---------------- */

  const enterPreview = useCallback(() => {
    const snap = loadPreviewWorkspace();
    setChannels(snap.channels);
    setItems(snap.items);
    setIdeas(snap.ideas);
    setPreviewMode(true);
  }, []);


  useEffect(() => {
    Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1' && !auth.currentUser) enterPreview();
      const shareUrl = params.get('share_url') || '';
      const shareTitle = params.get('share_title') || '';
      const shareText = params.get('share_text') || '';
      if (shareUrl || shareTitle || shareText) {
        setSharedDraft({ title: shareTitle, text: shareText, url: shareUrl });
        setActiveTab('ideas');
      }
    });
  }, [setActiveTab, enterPreview]);

  /* ---------------- Auth + workspace ---------------- */

  const loadAuthenticatedWorkspace = useCallback(async (user: User) => {
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/workspace', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(await readError(res, 'Failed to load workspace.'));
      const data = await res.json();
      setChannels(data.channels ?? []);
      setItems(data.items ?? []);
      setIdeas(data.ideas ?? []);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to load workspace.');
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  const loadedUid = useRef<string | null>(null);
  useEffect(() => {
    // Fires on sign-in, sign-out, and every hourly token refresh.
    const unsub = onIdTokenChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        const token = await user.getIdToken();
        setAuthToken(token);
        setSessionCookie(token);
        setPreviewMode(false);
        if (loadedUid.current !== user.uid) {
          loadedUid.current = user.uid;
          await loadAuthenticatedWorkspace(user);
        }
      } else {
        loadedUid.current = null;
        setAuthToken(null);
        setSessionCookie(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [loadAuthenticatedWorkspace]);


  const persistPreview = useCallback(
    (nextChannels: ChannelItem[], nextItems: ContentItem[], nextIdeas: IdeaItem[]) => {
      savePreviewWorkspace({ channels: nextChannels, items: nextItems, ideas: nextIdeas, nextId: Date.now() });
    },
    []
  );

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in popup was closed or blocked.');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (firebaseUser) await signOut(auth);
    setPreviewMode(false);
    setChannels([]);
    setItems([]);
    setIdeas([]);
    const url = new URL(window.location.href);
    url.searchParams.delete('autostart');
    window.history.replaceState(null, '', url);
  };

  const getFreshToken = async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    const token = await firebaseUser.getIdToken();
    setAuthToken(token);
    return token;
  };

  /** Authenticated JSON request. Throws with the server's message on failure. */
  const api = async (token: string, url: string, method: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await readError(res, 'Something went wrong. Try again.'));
    return res.json();
  };

  const fail = (err: unknown, fallback: string) => {
    toast(err instanceof Error ? err.message : fallback, 'error');
  };

  /* ---------------- Mutations ---------------- */

  const handleAddChannel = async (name: string, handle: string): Promise<boolean> => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, '/api/channels', 'POST', { name, handle });
        setChannels((prev) => [...prev, data.channel]);
      } else {
        const nextChannels = [...channels, { id: Date.now(), name, handle }];
        setChannels(nextChannels);
        persistPreview(nextChannels, items, ideas);
      }
      toast(`Channel “${name}” added`);
      return true;
    } catch (err) {
      fail(err, 'Could not add channel.');
      return false;
    }
  };

  const handleSaveItem = async (payload: {
    id?: number;
    title: string;
    platform: PlatformKey;
    channelName: string;
    status: StatusKey;
    caption: string;
    tags: string[];
    notes: string;
    liveLink: string;
    postDate: string;
    targetDate: string;
    coverAsset: MediaAsset | null;
    videoAsset: MediaAsset | null;
    slides: MediaAsset[];
  }) => {
    // Errors propagate to the editor, which shows them inline.
    const token = await getFreshToken();
    const channelId = channels.find((c) => c.name === payload.channelName)?.id ?? null;

    if (token) {
      if (payload.id) {
        const data = await api(token, `/api/items/${payload.id}`, 'PATCH', { ...payload, channelId });
        setItems((prev) => prev.map((i) => (i.id === payload.id ? data.item : i)));
        if (selectedItem?.id === payload.id) setSelectedItem(data.item);
      } else {
        const data = await api(token, '/api/items', 'POST', { ...payload, channelId });
        setItems((prev) => [data.item, ...prev]);
      }
    } else {
      const now = new Date().toISOString();
      let nextItems: ContentItem[];
      if (payload.id) {
        nextItems = items.map((existing) =>
          existing.id === payload.id ? { ...existing, ...payload, channelId, updatedAt: now } : existing
        );
        if (selectedItem?.id === payload.id) {
          setSelectedItem(nextItems.find((i) => i.id === payload.id) ?? null);
        }
      } else {
        const created: ContentItem = {
          ...payload,
          id: Date.now(),
          channelId,
          attachedReferences: [],
          sourceIdeaId: null,
          createdAt: now,
          updatedAt: now,
        };
        nextItems = [created, ...items];
      }
      setItems(nextItems);
      persistPreview(channels, nextItems, ideas);
    }
    toast(payload.id ? 'Post updated' : 'Post created');
  };

  const handleUpdateItemFields = async (
    itemId: number,
    patch: Partial<Pick<ContentItem, 'status' | 'postDate' | 'liveLink' | 'notes'>>,
    { silent = false }: { silent?: boolean } = {}
  ) => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/items/${itemId}`, 'PATCH', patch);
        setItems((prev) => prev.map((i) => (i.id === itemId ? data.item : i)));
        if (selectedItem?.id === itemId) setSelectedItem(data.item);
      } else {
        const nextItems = items.map((item) =>
          item.id === itemId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
        );
        setItems(nextItems);
        if (selectedItem?.id === itemId) setSelectedItem(nextItems.find((i) => i.id === itemId) ?? null);
        persistPreview(channels, nextItems, ideas);
      }
      if (!silent) toast('Saved');
    } catch (err) {
      fail(err, 'Could not save changes.');
    }
  };

  const handleDeleteItem = async (item: ContentItem): Promise<boolean> => {
    const ok = await confirm({
      title: `Delete “${item.title}”?`,
      body: 'The post and its uploaded files will be permanently removed. This can’t be undone.',
      confirmLabel: 'Delete post',
      tone: 'danger',
    });
    if (!ok) return false;
    try {
      const token = await getFreshToken();
      if (token) await api(token, `/api/items/${item.id}`, 'DELETE');
      const nextItems = items.filter((i) => i.id !== item.id);
      setItems(nextItems);
      if (!token) persistPreview(channels, nextItems, ideas);
      toast('Post deleted');
      return true;
    } catch (err) {
      fail(err, 'Could not delete post.');
      return false;
    }
  };

  const handleCaptureIdea = async (payload: {
    title: string;
    linkUrl: string;
    linkTitle: string;
    linkDomain: string;
    screenshotUrl: string;
    notes: string;
    platform: PlatformKey;
    channelName: string;
    tags: string[];
    targetDate: string;
  }): Promise<boolean> => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, '/api/ideas', 'POST', payload);
        setIdeas((prev) => [data.idea, ...prev]);
      } else {
        const created: IdeaItem = {
          id: Date.now(),
          ...payload,
          convertedItemId: null,
          createdAt: new Date().toISOString(),
        };
        const nextIdeas = [created, ...ideas];
        setIdeas(nextIdeas);
        persistPreview(channels, items, nextIdeas);
      }
      toast('Idea saved');
      return true;
    } catch (err) {
      fail(err, 'Could not save idea.');
      return false;
    }
  };

  const handleMakePost = async (idea: IdeaItem) => {
    try {
      const token = await getFreshToken();
      let newItem: ContentItem;
      if (token) {
        const data = await api(token, `/api/ideas/${idea.id}`, 'POST');
        newItem = data.item;
        setItems((prev) => (prev.some((i) => i.id === newItem.id) ? prev : [newItem, ...prev]));
        setIdeas((prev) => prev.map((i) => (i.id === idea.id ? data.idea : i)));
      } else {
        const existing = idea.convertedItemId ? items.find((i) => i.id === idea.convertedItemId) : undefined;
        if (existing) {
          newItem = existing;
        } else {
          const now = new Date().toISOString();
          newItem = { ...convertIdeaToPostDraft(idea), id: Date.now(), createdAt: now, updatedAt: now };
          const nextItems = [newItem, ...items];
          const nextIdeas = ideas.map((i) => (i.id === idea.id ? { ...i, convertedItemId: newItem.id } : i));
          setItems(nextItems);
          setIdeas(nextIdeas);
          persistPreview(channels, nextItems, nextIdeas);
        }
      }
      setActiveTab('library');
      setSelectedItem(newItem);
      toast('Post created from idea');
    } catch (err) {
      fail(err, 'Could not create post.');
    }
  };

  const handleDeleteIdea = async (idea: IdeaItem) => {
    const ok = await confirm({
      title: `Delete “${idea.title}”?`,
      body: 'This idea and its screenshot will be removed.',
      confirmLabel: 'Delete idea',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const token = await getFreshToken();
      if (token) await api(token, `/api/ideas/${idea.id}`, 'DELETE');
      const nextIdeas = ideas.filter((i) => i.id !== idea.id);
      setIdeas(nextIdeas);
      if (!token) persistPreview(channels, items, nextIdeas);
      toast('Idea deleted');
    } catch (err) {
      fail(err, 'Could not delete idea.');
    }
  };

  const handleLoadSample = () => {
    const now = new Date().toISOString();
    const base = Date.now();
    const nextChannels = SEED_CHANNELS.map((c, i) => ({ ...c, id: base + i }));
    const nextItems = SEED_ITEMS.map((it, i) => ({ ...it, id: base + 100 + i, createdAt: now, updatedAt: now }));
    const nextIdeas = SEED_IDEAS.map((it, i) => ({ ...it, id: base + 200 + i, createdAt: now }));
    setChannels(nextChannels);
    setItems(nextItems);
    setIdeas(nextIdeas);
    persistPreview(nextChannels, nextItems, nextIdeas);
    toast('Sample content loaded');
  };

  const filteredItems = useMemo(() => filterContentItems(items, filters), [items, filters]);

  const openEditor = (item: ContentItem | null = null) => {
    setEditingItem(item);
    setEditorOpen(true);
  };

  /* ---------------- Render ---------------- */

  if (!authReady && !previewMode) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
          Loading Content Vault…
        </div>
      </div>
    );
  }

  if (!firebaseUser && !previewMode) {
    return (
      <>
        <AuthGate
          onGoogleSignIn={handleGoogleSignIn}
          onPreview={() => {
            enterPreview();
            const url = new URL(window.location.href);
            url.searchParams.set('autostart', '1');
            window.history.replaceState(null, '', url);
          }}
          isSigningIn={isSigningIn}
          errorMessage={authError}
        />
        <OfflineIndicator />
      </>
    );
  }

  const page = PAGE_COPY[activeTab];
  const librarySubtitle = `${items.length} ${items.length === 1 ? 'post' : 'posts'} · ${ideas.length} ${
    ideas.length === 1 ? 'idea' : 'ideas'
  } · ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'}`;

  return (
    <div className="min-h-dvh pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-16">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150 dark:border-zinc-800/70 dark:bg-zinc-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className="flex shrink-0 items-center gap-2.5 rounded-lg"
            aria-label="Content Vault home"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-sm shadow-blue-600/30">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[15px] font-bold tracking-tight">Content Vault</span>
          </button>

          <nav aria-label="Sections" className="mx-auto hidden md:block">
            <div className="flex items-center gap-1 rounded-full border border-zinc-200/80 bg-zinc-100/70 p-1 dark:border-zinc-800 dark:bg-zinc-900/70">
              {TABS.map(({ key, label, icon: Icon }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    aria-current={isActive ? 'page' : undefined}
                    className={cx(
                      'flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-all',
                      isActive
                        ? 'bg-white text-zinc-950 shadow-sm dark:bg-zinc-800 dark:text-white'
                        : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                    )}
                  >
                    <Icon className={cx('h-3.5 w-3.5', isActive && 'text-blue-600 dark:text-blue-400')} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-2 md:ml-0">
            <div className="hidden md:block">
              <button
                type="button"
                onClick={() => openEditor()}
                className={cx(buttonStyles.primary, 'h-9 px-3.5 text-[13px]')}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                New post
              </button>
            </div>
            <AccountMenu
              email={firebaseUser?.email ?? null}
              isPreview={!firebaseUser}
              theme={themePref}
              onThemeChange={setThemePref}
              onSignOut={handleSignOut}
            />
          </div>
        </div>
      </header>

      {!firebaseUser ? (
        <div className="border-b border-amber-200/70 bg-amber-50 px-4 py-2 text-center text-xs font-medium text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
          Preview mode — everything is saved in this browser only.
        </div>
      ) : null}

      <main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 sm:pt-8">
        <div className="mb-5 sm:mb-6">
          <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{page.title}</h1>
          <p className="mt-1 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
            {activeTab === 'library' ? librarySubtitle : page.subtitle}
          </p>
        </div>

        {workspaceError ? (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            <span>{workspaceError}</span>
            {firebaseUser ? (
              <button
                type="button"
                onClick={() => loadAuthenticatedWorkspace(firebaseUser)}
                className={cx(buttonStyles.secondary, sizes.sm)}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {loadingWorkspace ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-white dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="aspect-[4/3] animate-pulse bg-zinc-100 dark:bg-zinc-800/60" />
                <div className="space-y-2.5 p-4">
                  <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                  <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                  <div className="h-3 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-800" />
                </div>
              </div>
            ))}
          </div>
        ) : activeTab === 'library' ? (
          <LibraryView
            items={filteredItems}
            totalItemsCount={items.length}
            channels={channels}
            filters={filters}
            onFiltersChange={setFilters}
            onSelectItem={setSelectedItem}
            onCreateNew={() => openEditor()}
            onOpenIdeas={() => setActiveTab('ideas')}
            onAddChannel={handleAddChannel}
            onLoadSample={firebaseUser ? undefined : handleLoadSample}
          />
        ) : activeTab === 'ideas' ? (
          <IdeasView
            key={sharedDraft ? 'shared-idea' : 'default-ideas'}
            ideas={ideas}
            channels={channels}
            authToken={authToken}
            initialSharedDraft={sharedDraft}
            onCaptureIdea={handleCaptureIdea}
            onMakePost={handleMakePost}
            onDeleteIdea={handleDeleteIdea}
          />
        ) : activeTab === 'tracker' ? (
          <BoardView
            items={items}
            onSelectItem={setSelectedItem}
            onChangeStatus={(itemId, nextStatus) => handleUpdateItemFields(itemId, { status: nextStatus }, { silent: true })}
            onCreateNew={() => openEditor()}
          />
        ) : (
          <StudioChatPanel
            key={chatFocusedItem ? `chat-${chatFocusedItem.id}` : 'chat-general'}
            items={items}
            authToken={authToken}
            focusedItem={chatFocusedItem}
            onClearFocus={() => setChatFocusedItem(null)}
          />
        )}
      </main>

      {/* Mobile tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200/70 bg-white/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl backdrop-saturate-150 md:hidden dark:border-zinc-800/70 dark:bg-zinc-950/85"
      >
        <div className="grid h-16 grid-cols-5 items-center px-1">
          {TABS.slice(0, 2).map((t) => (
            <MobileTab key={t.key} tab={t} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} />
          ))}
          <div className="flex items-center justify-center">
            <button
              type="button"
              data-testid="mobile-add-btn"
              onClick={() => openEditor()}
              aria-label="New post"
              className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 text-white shadow-lg shadow-blue-600/30 transition-transform active:scale-95"
            >
              <Plus className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>
          {TABS.slice(2).map((t) => (
            <MobileTab key={t.key} tab={t} active={activeTab === t.key} onClick={() => setActiveTab(t.key)} />
          ))}
        </div>
      </nav>

      {selectedItem ? (
        <ItemDetailModal
          key={`detail-${selectedItem.id}`}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onEdit={(item) => {
            setSelectedItem(null);
            openEditor(item);
          }}
          onDelete={async (item) => {
            if (await handleDeleteItem(item)) setSelectedItem(null);
          }}
          onUpdateFields={(id, patch) => handleUpdateItemFields(id, patch)}
          onAskAI={(item) => {
            setSelectedItem(null);
            setChatFocusedItem(item);
            setActiveTab('chat');
          }}
        />
      ) : null}

      {editorOpen ? (
        <ItemEditorModal
          key={`editor-${editingItem?.id ?? 'new'}`}
          isOpen={editorOpen}
          editingItem={editingItem}
          channels={channels}
          authToken={authToken}
          onClose={() => {
            setEditorOpen(false);
            setEditingItem(null);
          }}
          onSave={handleSaveItem}
        />
      ) : null}

      <OfflineIndicator />
    </div>
  );
};

function MobileTab({
  tab,
  active,
  onClick,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
        active ? 'text-blue-600 dark:text-blue-400' : 'text-zinc-500 dark:text-zinc-400'
      )}
    >
      <span
        className={cx(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
          active && 'bg-blue-50 dark:bg-blue-950/60'
        )}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      {tab.short}
    </button>
  );
}

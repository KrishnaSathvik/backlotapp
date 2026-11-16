'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Columns3,
  LayoutGrid,
  Lightbulb,
  LogOut,
  MessageSquare,
  Monitor,
  Moon,
  Plus,
  Sun,
} from 'lucide-react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
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
import { AuthGate } from './AuthGate';
import { BoardView } from './BoardView';
import { IdeasView } from './IdeasView';
import { ItemDetailModal } from './ItemDetailModal';
import { ItemEditorModal } from './ItemEditorModal';
import { LibraryView } from './LibraryView';
import { OfflineIndicator, PWAInstallButton } from './PWAControls';
import { StudioChatPanel } from './StudioChatPanel';

type ActiveTab = 'library' | 'ideas' | 'tracker' | 'chat';

export const ContentVaultApp: React.FC = () => {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('library');
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
  const [sharedDraft, setSharedDraft] = useState<{
    title: string;
    text: string;
    url: string;
  } | null>(null);

  // Sync theme preference (system default + light/dark manual switch)
  useEffect(() => {
    Promise.resolve().then(() => {
      const saved = window.localStorage.getItem('slatevault_theme') as ThemePreference | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setThemePref(saved);
      }
    });
  }, []);

  useEffect(() => {
    const applyTheme = () => {
      const root = document.documentElement;
      const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const shouldBeDark =
        themePref === 'dark' || (themePref === 'system' && systemDark);
      root.classList.toggle('dark', shouldBeDark);
    };

    applyTheme();
    window.localStorage.setItem('slatevault_theme', themePref);

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', applyTheme);
    return () => mq.removeEventListener('change', applyTheme);
  }, [themePref]);

  // Handle ?autostart=1 and PWA Share Target params
  useEffect(() => {
    Promise.resolve().then(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('autostart') === '1') {
        setPreviewMode(true);
      }
      const shareUrl = params.get('share_url') || '';
      const shareTitle = params.get('share_title') || '';
      const shareText = params.get('share_text') || '';
      if (shareUrl || shareTitle || shareText) {
        setSharedDraft({ title: shareTitle, text: shareText, url: shareUrl });
        setActiveTab('ideas');
      }
    });
  }, []);

  const loadAuthenticatedWorkspace = useCallback(async (user: User) => {
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const token = await user.getIdToken();
      setAuthToken(token);
      const res = await fetch('/api/workspace', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load workspace.');
      }
      setChannels(data.channels ?? []);
      setItems(data.items ?? []);
      setIdeas(data.ideas ?? []);
    } catch (err) {
      setWorkspaceError(
        err instanceof Error ? err.message : 'Unable to load workspace.'
      );
    } finally {
      setLoadingWorkspace(false);
    }
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        setPreviewMode(false);
        await loadAuthenticatedWorkspace(user);
      } else {
        setAuthToken(null);
      }
      setAuthReady(true);
    });
    return () => unsub();
  }, [loadAuthenticatedWorkspace]);

  // Load preview workspace when previewMode is active
  useEffect(() => {
    if (!previewMode || firebaseUser) return;
    Promise.resolve().then(() => {
      const snap = loadPreviewWorkspace();
      setChannels(snap.channels);
      setItems(snap.items);
      setIdeas(snap.ideas);
    });
  }, [previewMode, firebaseUser]);

  const persistPreview = useCallback(
    (nextChannels: ChannelItem[], nextItems: ContentItem[], nextIdeas: IdeaItem[]) => {
      const snap = loadPreviewWorkspace();
      savePreviewWorkspace({
        channels: nextChannels,
        items: nextItems,
        ideas: nextIdeas,
        nextId: snap.nextId + 1,
      });
    },
    []
  );

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Google sign-in popup was closed or blocked.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (firebaseUser) {
      await signOut(auth);
    }
    setPreviewMode(false);
    setChannels([]);
    setItems([]);
    setIdeas([]);
  };

  const getFreshToken = async (): Promise<string | null> => {
    if (!firebaseUser) return null;
    const token = await firebaseUser.getIdToken();
    setAuthToken(token);
    return token;
  };

  const handleAddChannel = async (name: string, handle: string) => {
    const token = await getFreshToken();
    if (token) {
      const res = await fetch('/api/channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name, handle }),
      });
      const data = await res.json();
      if (res.ok && data.channel) {
        setChannels((prev) => [...prev, data.channel]);
      }
      return;
    }

    const created: ChannelItem = { id: Date.now(), name, handle };
    const nextChannels = [...channels, created];
    setChannels(nextChannels);
    persistPreview(nextChannels, items, ideas);
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
    const token = await getFreshToken();
    const channelMatch = channels.find((c) => c.name === payload.channelName);

    if (token) {
      if (payload.id) {
        const res = await fetch(`/api/items/${payload.id}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...payload,
            channelId: channelMatch?.id ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update item.');
        setItems((prev) =>
          prev.map((i) => (i.id === payload.id ? data.item : i))
        );
        if (selectedItem?.id === payload.id) setSelectedItem(data.item);
      } else {
        const res = await fetch('/api/items', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            ...payload,
            channelId: channelMatch?.id ?? null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create item.');
        setItems((prev) => [data.item, ...prev]);
      }
      return;
    }

    const now = new Date().toISOString();
    if (payload.id) {
      const nextItems = items.map((existing) =>
        existing.id === payload.id
          ? {
              ...existing,
              ...payload,
              channelId: channelMatch?.id ?? null,
              updatedAt: now,
            }
          : existing
      );
      setItems(nextItems);
      const updated = nextItems.find((i) => i.id === payload.id) ?? null;
      if (selectedItem?.id === payload.id) setSelectedItem(updated);
      persistPreview(channels, nextItems, ideas);
    } else {
      const created: ContentItem = {
        id: Date.now(),
        title: payload.title,
        platform: payload.platform,
        channelId: channelMatch?.id ?? null,
        channelName: payload.channelName,
        status: payload.status,
        caption: payload.caption,
        tags: payload.tags,
        notes: payload.notes,
        liveLink: payload.liveLink,
        postDate: payload.postDate,
        targetDate: payload.targetDate,
        coverAsset: payload.coverAsset,
        videoAsset: payload.videoAsset,
        slides: payload.slides,
        attachedReferences: [],
        sourceIdeaId: null,
        createdAt: now,
        updatedAt: now,
      };
      const nextItems = [created, ...items];
      setItems(nextItems);
      persistPreview(channels, nextItems, ideas);
    }
  };

  const handleUpdateItemFields = async (
    itemId: number,
    patch: Partial<Pick<ContentItem, 'status' | 'postDate' | 'liveLink' | 'notes'>>
  ) => {
    const token = await getFreshToken();
    if (token) {
      const res = await fetch(`/api/items/${itemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setItems((prev) => prev.map((i) => (i.id === itemId ? data.item : i)));
        if (selectedItem?.id === itemId) setSelectedItem(data.item);
      }
      return;
    }

    const nextItems = items.map((item) =>
      item.id === itemId
        ? { ...item, ...patch, updatedAt: new Date().toISOString() }
        : item
    );
    setItems(nextItems);
    if (selectedItem?.id === itemId) {
      setSelectedItem(nextItems.find((i) => i.id === itemId) ?? null);
    }
    persistPreview(channels, nextItems, ideas);
  };

  const handleDeleteItem = async (itemId: number) => {
    const token = await getFreshToken();
    if (token) {
      await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const nextItems = items.filter((i) => i.id !== itemId);
    setItems(nextItems);
    if (!token) persistPreview(channels, nextItems, ideas);
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
  }) => {
    const token = await getFreshToken();
    if (token) {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.idea) {
        setIdeas((prev) => [data.idea, ...prev]);
      }
      return;
    }

    const created: IdeaItem = {
      id: Date.now(),
      ...payload,
      convertedItemId: null,
      createdAt: new Date().toISOString(),
    };
    const nextIdeas = [created, ...ideas];
    setIdeas(nextIdeas);
    persistPreview(channels, items, nextIdeas);
  };

  const handleMakePost = async (idea: IdeaItem) => {
    const token = await getFreshToken();
    if (token) {
      const res = await fetch(`/api/ideas/${idea.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok && data.item) {
        setItems((prev) => [data.item, ...prev]);
        setIdeas((prev) =>
          prev.map((idItem) => (idItem.id === idea.id ? data.idea : idItem))
        );
        setSelectedItem(data.item);
        setActiveTab('library');
      }
      return;
    }

    const draft = convertIdeaToPostDraft(idea);
    const now = new Date().toISOString();
    const newItem: ContentItem = {
      ...draft,
      id: Date.now(),
      createdAt: now,
      updatedAt: now,
    };
    const nextItems = [newItem, ...items];
    const nextIdeas = ideas.map((i) =>
      i.id === idea.id ? { ...i, convertedItemId: newItem.id } : i
    );
    setItems(nextItems);
    setIdeas(nextIdeas);
    persistPreview(channels, nextItems, nextIdeas);
    setSelectedItem(newItem);
    setActiveTab('library');
  };

  const handleDeleteIdea = async (ideaId: number) => {
    const token = await getFreshToken();
    if (token) {
      await fetch(`/api/ideas/${ideaId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    const nextIdeas = ideas.filter((i) => i.id !== ideaId);
    setIdeas(nextIdeas);
    if (!token) persistPreview(channels, items, nextIdeas);
  };

  const filteredItems = useMemo(
    () => filterContentItems(items, filters),
    [items, filters]
  );

  const cycleTheme = () => {
    setThemePref((prev) =>
      prev === 'system' ? 'light' : prev === 'light' ? 'dark' : 'system'
    );
  };

  if (!authReady && !previewMode) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-zinc-950">
        <span className="text-sm font-medium text-zinc-500">Loading Content Vault...</span>
      </div>
    );
  }

  if (!firebaseUser && !previewMode) {
    return (
      <>
        <AuthGate
          onGoogleSignIn={handleGoogleSignIn}
          isSigningIn={isSigningIn}
          errorMessage={authError}
        />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-24 text-zinc-950 md:pb-12 dark:bg-zinc-950 dark:text-zinc-50">
      {/* Desktop & Mobile Top Navigation Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/95">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <Link
            href="/"
            className="text-lg font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0 dark:text-zinc-50"
          >
            Content Vault
          </Link>

          {/* Zone 2: Desktop Single-Line Navigation Links */}
          <nav
            aria-label="Primary sections"
            className="hidden items-center gap-6 md:flex"
          >
            {(
              [
                { key: 'library', label: 'Library' },
                { key: 'ideas', label: 'Ideas' },
                { key: 'tracker', label: 'Tracker' },
                { key: 'chat', label: 'Studio AI' },
              ] as const
            ).map((navItem) => {
              const isActive = activeTab === navItem.key;
              return (
                <button
                  key={navItem.key}
                  type="button"
                  onClick={() => setActiveTab(navItem.key)}
                  className={`h-14 border-b-2 px-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'border-blue-600 text-zinc-950 dark:border-blue-400 dark:text-white'
                      : 'border-transparent text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {navItem.label}
                </button>
              );
            })}
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => {
                setEditingItem(null);
                setEditorOpen(true);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New Post
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container */}
      <main className="mx-auto max-w-7xl px-4 pt-6 sm:px-6">
        {/* Workspace Toolbar (Title + Theme + PWA Install + Account) */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 pb-4 dark:border-zinc-900">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
              {activeTab === 'library'
                ? 'Content Library'
                : activeTab === 'ideas'
                ? 'Ideas & References'
                : activeTab === 'tracker'
                ? 'Production Tracker'
                : 'Studio AI'}
            </h1>
            <p className="text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
              {activeTab === 'tracker'
                ? 'Move posts across stages: Idea → Scripting → Editing → Ready → Posted'
                : activeTab === 'ideas'
                ? `${ideas.length} saved ideas · Capture future links, screenshots & notes`
                : `${items.length} posts · ${ideas.length} ideas · ${channels.length} channels`}
              {firebaseUser?.email ? ` · ${firebaseUser.email}` : ''}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <PWAInstallButton />

            <button
              type="button"
              onClick={cycleTheme}
              aria-label={`Theme mode: ${themePref}. Click to switch`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              {themePref === 'light' ? (
                <Sun className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
              ) : themePref === 'dark' ? (
                <Moon className="h-3.5 w-3.5 text-blue-400" aria-hidden="true" />
              ) : (
                <Monitor className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
              )}
              <span className="capitalize">{themePref}</span>
            </button>

            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>

        {workspaceError ? (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            {workspaceError}
          </div>
        ) : null}

        {loadingWorkspace ? (
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((skeleton) => (
              <div
                key={skeleton}
                className="h-64 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
              />
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
            onCreateNew={() => {
              setEditingItem(null);
              setEditorOpen(true);
            }}
            onOpenIdeas={() => setActiveTab('ideas')}
            onAddChannel={handleAddChannel}
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
            onChangeStatus={(itemId, nextStatus) =>
              handleUpdateItemFields(itemId, { status: nextStatus })
            }
            onCreateNew={() => {
              setEditingItem(null);
              setEditorOpen(true);
            }}
          />
        ) : (
          <StudioChatPanel
            key={chatFocusedItem ? `chat-${chatFocusedItem.id}` : 'chat-general'}
            items={items}
            focusedItem={chatFocusedItem}
            onClearFocus={() => setChatFocusedItem(null)}
          />
        )}
      </main>

      {/* Mobile Bottom Tab Bar with Big "+" Center Action */}
      <nav
        aria-label="Mobile navigation"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 bg-white/95 backdrop-blur-md md:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
      >
        <div className="grid h-16 grid-cols-5 items-center px-2">
          <button
            type="button"
            onClick={() => setActiveTab('library')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              activeTab === 'library'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <LayoutGrid className="h-5 w-5" aria-hidden="true" />
            <span>Library</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('ideas')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              activeTab === 'ideas'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Lightbulb className="h-5 w-5" aria-hidden="true" />
            <span>Ideas</span>
          </button>

          <div className="flex items-center justify-center">
            <button
              type="button"
              data-testid="mobile-add-btn"
              onClick={() => {
                setEditingItem(null);
                setEditorOpen(true);
              }}
              aria-label="Add new content post"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-transform active:scale-95 hover:bg-blue-700"
            >
              <Plus className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveTab('tracker')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              activeTab === 'tracker'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <Columns3 className="h-5 w-5" aria-hidden="true" />
            <span>Tracker</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex min-h-[44px] flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              activeTab === 'chat'
                ? 'text-blue-600 dark:text-blue-400'
                : 'text-zinc-500 dark:text-zinc-400'
            }`}
          >
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            <span>AI</span>
          </button>
        </div>
      </nav>

      {/* Modals */}
      {selectedItem ? (
        <ItemDetailModal
          key={`detail-${selectedItem.id}`}
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onEdit={(item) => {
            setSelectedItem(null);
            setEditingItem(item);
            setEditorOpen(true);
          }}
          onDelete={handleDeleteItem}
          onUpdateFields={handleUpdateItemFields}
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

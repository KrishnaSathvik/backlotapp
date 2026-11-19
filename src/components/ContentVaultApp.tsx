'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onIdTokenChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  convertIdeaToPostDraft,
  channelPlatform,
  filterContentItems,
  type ChannelItem,
  type ContentItem,
  type IdeaItem,
  type LibraryFilters,
  type MediaAsset,
  type PlatformKey,
  type StatusKey,
} from '@/src/lib/content-logic';
import { auth, googleAuthProvider } from '@/src/lib/firebase';
import { AccountSettingsSheet } from './AccountSettingsSheet';
import { DEMO_CHANNELS, DEMO_IDEAS, DEMO_ITEMS } from '@/src/lib/demo-data';
import { useTheme } from '@/src/hooks/useTheme';
import { MobileTabBar, MobileTopBar, Sidebar, StatsStrip, type ActiveTab } from './AppShell';
import { PlatformIcon } from './PlatformIcon';
import { AuthGate } from './AuthGate';
import { IdeasView } from './IdeasView';
import { AddChannelDialog } from './AddChannelDialog';
import { ItemDetailModal, type ItemFieldsPatch } from './ItemDetailModal';
import { ItemEditorModal } from './ItemEditorModal';
import { LibraryView } from './LibraryView';
import { OfflineIndicator } from './PWAControls';
import { StudioChatPanel, type ChatFocus } from './StudioChatPanel';
import { CalendarView } from './CalendarView';
import { DELETION_STATUS_KEY } from './DeletionStatus';
import type { IdeaFieldsPatch } from './IdeaDetailSheet';
import { buttonStyles, cx, FeedbackProvider, sizes, useFeedback } from './ui';


const PAGE_COPY: Record<ActiveTab, { title: string; subtitle?: string }> = {
  library: { title: 'Library' },
  ideas: { title: 'Ideas' },
  calendar: { title: 'Calendar', subtitle: 'Your posts by target and posted date.' },
  chat: { title: 'Slate', subtitle: 'Your AI creative partner: hooks, captions, tags and plans.' },
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
  return t === 'ideas' || t === 'calendar' || t === 'chat' ? t : 'library';
}

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === 'string' ? data.error : fallback;
}

/** A failed API call, with the response body (409 conflicts carry the latest record). */
class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const isConflict = (err: unknown): err is ApiError => err instanceof ApiError && err.status === 409;

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
  const { theme: themePref, setTheme: setThemePref } = useTheme();

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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [chatFocus, setChatFocus] = useState<ChatFocus | null>(null);
  /** An idea to open when the Ideas tab mounts (from a Slate reference chip). */
  const [ideaToOpen, setIdeaToOpen] = useState<number | null>(null);
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

  /* ---------------- Preview mode + PWA share target ---------------- */

  const enterPreview = useCallback(() => {
    // The demo is a working copy of the sample workspace. It lives only in memory:
    // nothing is sent to the server or saved in the browser, and a refresh resets it.
    setChannels(DEMO_CHANNELS);
    setItems(DEMO_ITEMS);
    setIdeas(DEMO_IDEAS);
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

  /**
   * After deletion starts: forget this account on this device, sign out, open the status page.
   * The status token goes in the URL fragment (never sent to the server in a request line) and is
   * remembered on this device so a later visit can find the page again.
   */
  const leaveForDeletionStatus = useCallback(async (uid: string, statusToken: string | null) => {
    let token = statusToken;
    try {
      window.localStorage.removeItem(`cv_chat_${uid}`);
      window.localStorage.removeItem(`cv_slate_open_${uid}`);
      if (token) window.localStorage.setItem(DELETION_STATUS_KEY, token);
      else token = window.localStorage.getItem(DELETION_STATUS_KEY);
    } catch {
      // Storage unavailable
    }
    setSessionCookie(null);
    await signOut(auth).catch(() => undefined);
    window.location.replace(token ? `/account/deleted#${token}` : '/account/deleted');
  }, []);

  const loadAuthenticatedWorkspace = useCallback(async (user: User) => {
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/workspace', { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 403) {
        // This account is being deleted: show its progress instead of the app.
        const data = await res.clone().json().catch(() => ({}));
        if (data.code === 'account_deleting') {
          await leaveForDeletionStatus(user.uid, null);
          return;
        }
      }
      if (!res.ok) throw new Error(await readError(res, 'Failed to load workspace.'));
      const data = await res.json();
      setChannels(data.channels ?? []);
      versions.current.clear();
      (data.items ?? []).forEach((i: ContentItem) => {
        if (typeof i.version === 'number') versions.current.set(`post:${i.id}`, i.version);
      });
      (data.ideas ?? []).forEach((i: IdeaItem) => {
        if (typeof i.version === 'number') versions.current.set(`idea:${i.id}`, i.version);
      });
      setItems(data.items ?? []);
      setIdeas(data.ideas ?? []);
    } catch (err) {
      setWorkspaceError(err instanceof Error ? err.message : 'Unable to load workspace.');
    } finally {
      setLoadingWorkspace(false);
    }
  }, [leaveForDeletionStatus]);

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
    if (firebaseUser) {
      try {
        window.localStorage.removeItem(`cv_chat_${firebaseUser.uid}`);
        window.localStorage.removeItem(`cv_slate_open_${firebaseUser.uid}`);
      } catch {
        // Storage unavailable
      }
      await signOut(auth);
    }
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
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const message = typeof data.error === 'string' ? data.error : 'Something went wrong. Try again.';
      throw new ApiError(message, res.status, data);
    }
    return res.json();
  };

  /* ---------------- Versions (stale-edit protection) ---------------- */

  // The latest server version of each record, updated synchronously with every response,
  // so two quick saves in a row don't send the same (now stale) version.
  const versions = useRef(new Map<string, number>());
  const rememberPost = (item: ContentItem) => {
    if (typeof item.version === 'number') versions.current.set(`post:${item.id}`, item.version);
  };
  const rememberIdea = (idea: IdeaItem) => {
    if (typeof idea.version === 'number') versions.current.set(`idea:${idea.id}`, idea.version);
  };
  const postVersion = (id: number) => versions.current.get(`post:${id}`) ?? items.find((i) => i.id === id)?.version;
  const ideaVersion = (id: number) => versions.current.get(`idea:${id}`) ?? ideas.find((i) => i.id === id)?.version;

  /** Shows the latest server copy after a 409, so nothing is silently overwritten. */
  const applyServerPost = (item: ContentItem) => {
    rememberPost(item);
    setItems((prev) => prev.map((i) => (i.id === item.id ? item : i)));
    setSelectedItem((cur) => (cur?.id === item.id ? item : cur));
  };
  const applyServerIdea = (idea: IdeaItem) => {
    rememberIdea(idea);
    setIdeas((prev) => prev.map((i) => (i.id === idea.id ? idea : i)));
  };
  const handleConflict = (err: ApiError) => {
    if (err.data.item) applyServerPost(err.data.item as ContentItem);
    if (err.data.idea) applyServerIdea(err.data.idea as IdeaItem);
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
        let data;
        try {
          data = await api(token, `/api/items/${payload.id}`, 'PATCH', { ...payload, channelId, expectedVersion: postVersion(payload.id) });
        } catch (err) {
          // The editor keeps the creator's text and shows the message; saving again replaces
          // the newer version on purpose.
          if (isConflict(err)) handleConflict(err);
          throw err;
        }
        rememberPost(data.item);
        setItems((prev) => prev.map((i) => (i.id === payload.id ? data.item : i)));
        if (selectedItem?.id === payload.id) setSelectedItem(data.item);
      } else {
        const data = await api(token, '/api/items', 'POST', { ...payload, channelId });
        rememberPost(data.item);
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
    }
    toast(payload.id ? 'Post updated' : 'Post created');
  };

  const handleUpdateItemFields = async (itemId: number, fields: ItemFieldsPatch): Promise<boolean> => {
    const patch: ItemFieldsPatch & { channelId?: number | null } = { ...fields };
    if (fields.channelName !== undefined) {
      patch.channelId = channels.find((c) => c.name === fields.channelName)?.id ?? null;
    }
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/items/${itemId}`, 'PATCH', { ...patch, expectedVersion: postVersion(itemId) });
        rememberPost(data.item);
        setItems((prev) => prev.map((i) => (i.id === itemId ? data.item : i)));
        if (selectedItem?.id === itemId) setSelectedItem(data.item);
      } else {
        const nextItems = items.map((item) =>
          item.id === itemId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
        );
        setItems(nextItems);
        if (selectedItem?.id === itemId) setSelectedItem(nextItems.find((i) => i.id === itemId) ?? null);
      }
      toast('Saved');
      return true;
    } catch (err) {
      if (isConflict(err)) handleConflict(err);
      fail(err, 'Could not save changes.');
      return false;
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
      toast('Post deleted');
      return true;
    } catch (err) {
      fail(err, 'Could not delete post.');
      return false;
    }
  };

  const handleDuplicateItem = async (item: ContentItem) => {
    const copy = {
      title: `${item.title} (copy)`.slice(0, 200),
      platform: item.platform,
      channelName: item.channelName,
      // A copy starts back in the pipeline: not posted, no live link or post date.
      status: (item.status === 'posted' ? 'ready' : item.status) as StatusKey,
      caption: item.caption,
      tags: item.tags,
      notes: item.notes,
      liveLink: '',
      postDate: '',
      targetDate: item.targetDate,
      coverAsset: item.coverAsset,
      videoAsset: item.videoAsset,
      slides: item.slides,
    };
    try {
      const token = await getFreshToken();
      let created: ContentItem;
      if (token) {
        const data = await api(token, '/api/items', 'POST', { ...copy, channelId: item.channelId ?? null });
        created = data.item;
        rememberPost(created);
      } else {
        const now = new Date().toISOString();
        created = {
          ...copy,
          id: Date.now(),
          channelId: item.channelId ?? null,
          attachedReferences: item.attachedReferences,
          sourceIdeaId: null,
          createdAt: now,
          updatedAt: now,
        };
      }
      setItems((prev) => [created, ...prev]);
      setSelectedItem(created);
      toast('Post duplicated');
    } catch (err) {
      fail(err, 'Could not duplicate post.');
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
        rememberIdea(data.idea);
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
        const data = await api(token, `/api/ideas/${idea.id}`, 'POST', { expectedVersion: ideaVersion(idea.id) });
        newItem = data.item;
        rememberPost(newItem);
        rememberIdea(data.idea);
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
        }
      }
      setActiveTab('library');
      setSelectedItem(newItem);
      toast('Post created from idea');
    } catch (err) {
      if (isConflict(err)) handleConflict(err);
      fail(err, 'Could not create post.');
    }
  };

  const handleUpdateIdea = async (ideaId: number, patch: IdeaFieldsPatch): Promise<boolean> => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/ideas/${ideaId}`, 'PATCH', { ...patch, expectedVersion: ideaVersion(ideaId) });
        rememberIdea(data.idea);
        setIdeas((prev) => prev.map((i) => (i.id === ideaId ? data.idea : i)));
      } else {
        setIdeas((prev) => prev.map((i) => (i.id === ideaId ? { ...i, ...patch } : i)));
      }
      toast('Idea saved');
      return true;
    } catch (err) {
      if (isConflict(err)) handleConflict(err);
      fail(err, 'Could not save idea.');
      return false;
    }
  };

  /** A Slate suggestion the creator approved: show the server's copy everywhere. */
  const handleSlateApplied = ({ item, idea }: { item?: ContentItem; idea?: IdeaItem }) => {
    if (item) {
      rememberPost(item);
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev.map((i) => (i.id === item.id ? item : i)) : [item, ...prev]));
      setSelectedItem((cur) => (cur?.id === item.id ? item : cur));
    }
    if (idea) applyServerIdea(idea);
  };

  const handleDeleteIdea = async (idea: IdeaItem): Promise<boolean> => {
    const ok = await confirm({
      title: `Delete “${idea.title}”?`,
      body: 'This idea and its screenshot will be removed.',
      confirmLabel: 'Delete idea',
      tone: 'danger',
    });
    if (!ok) return false;
    try {
      const token = await getFreshToken();
      if (token) await api(token, `/api/ideas/${idea.id}`, 'DELETE');
      setIdeas((prev) => prev.filter((i) => i.id !== idea.id));
      if (chatFocus?.kind === 'idea' && chatFocus.id === idea.id) setChatFocus(null);
      toast('Idea deleted');
      return true;
    } catch (err) {
      fail(err, 'Could not delete idea.');
      return false;
    }
  };

  const filteredItems = useMemo(() => filterContentItems(items, filters), [items, filters]);

  // The demo uses the same screens and handlers; without a token every change stays in memory.
  const isDemo = !firebaseUser;

  const openEditor = (item: ContentItem | null = null) => {
    setEditingItem(item);
    setEditorOpen(true);
  };

  /* ---------------- Render ---------------- */

  if (!authReady && !previewMode) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex items-center gap-3 text-sm font-medium text-zinc-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-300 border-t-electric-600" />
          Loading Backlot…
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
  const isChat = activeTab === 'chat';
  const librarySubtitle = `${items.length} ${items.length === 1 ? 'post' : 'posts'} · ${ideas.length} ${
    ideas.length === 1 ? 'idea' : 'ideas'
  } · ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'}`;

  // A channel page: header, stats and posts for one channel only.
  const activeChannel =
    activeTab === 'library' && filters.channel !== 'all'
      ? channels.find((c) => c.name.toLowerCase() === filters.channel.toLowerCase()) ?? null
      : null;
  const scopedItems = activeChannel ? items.filter((i) => i.channelName === activeChannel.name) : items;
  const channelIdeas = activeChannel ? ideas.filter((i) => i.channelName === activeChannel.name).length : 0;
  const channelLogo = activeChannel ? channelPlatform(items, activeChannel.name) : null;
  const goTab = (tab: ActiveTab) => {
    // "Library" always means everything; leaving a channel clears its filter.
    if (tab === 'library') setFilters((f) => ({ ...f, channel: 'all' }));
    setActiveTab(tab);
  };

  const account = {
    uid: firebaseUser?.uid ?? null,
    isPreview: !firebaseUser,
  };
  const shellProps = {
    activeTab,
    onTab: goTab,
    onNewPost: () => openEditor(),
    account,
    theme: themePref,
    onThemeChange: setThemePref,
    onSignOut: handleSignOut,
    onSignIn: firebaseUser ? undefined : handleGoogleSignIn,
    onOpenSettings: firebaseUser ? () => setSettingsOpen(true) : undefined,
  };

  return (
    <div
      className={cx(
        'relative isolate lg:pl-[256px]',
        isChat ? 'flex h-dvh flex-col overflow-hidden' : 'min-h-dvh pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-16'
      )}
    >
      <Sidebar
        {...shellProps}
        counts={{ library: items.length, ideas: ideas.filter((i) => !i.convertedItemId).length, calendar: null, chat: null }}
        channels={channels}
        items={items}
        activeChannel={activeChannel?.name ?? 'all'}
        onAddChannel={() => setChannelDialogOpen(true)}
        onChannel={(name) => {
          setFilters((f) => ({ ...f, channel: name, status: 'all', platform: 'all' }));
          setActiveTab('library');
        }}
      />
      <MobileTopBar {...shellProps} />

      <div aria-hidden="true" className={cx('pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden lg:left-[256px]', isChat && 'hidden')}>
        <div className="absolute -left-24 -top-40 h-80 w-[520px] rounded-full bg-electric-400/15 blur-3xl dark:bg-electric-600/15" />
        <div className="absolute -top-48 right-0 h-72 w-96 rounded-full bg-cantaloupe-300/15 blur-3xl dark:bg-cantaloupe-500/10" />
      </div>

      {isChat && !loadingWorkspace ? (
        <main className="flex min-h-0 w-full flex-1 flex-col">
          <StudioChatPanel
            items={items}
            ideas={ideas}
            channels={channels}
            historyKey={firebaseUser ? `cv_chat_${firebaseUser.uid}` : null}
            authToken={authToken}
            focus={chatFocus}
            onFocusChange={setChatFocus}
            onApplyCaption={(itemId, caption) => handleUpdateItemFields(itemId, { caption })}
            onActionApplied={handleSlateApplied}
            onSignIn={firebaseUser ? undefined : handleGoogleSignIn}
            onOpenRef={(ref) => {
              if (ref.type === 'post') {
                const item = items.find((i) => i.id === ref.id);
                if (item) setSelectedItem(item);
                else toast('That post isn’t loaded here. Refresh and try again.', 'error');
              } else if (ideas.some((i) => i.id === ref.id)) {
                setIdeaToOpen(ref.id);
                setActiveTab('ideas');
              } else {
                toast('That idea isn’t loaded here. Refresh and try again.', 'error');
              }
            }}
          />
        </main>
      ) : (
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pt-10">
        {isDemo ? (
          // Desktop shows the same note in the sidebar card.
          <div
            data-preview-badge
            className="mb-5 flex items-center gap-3 rounded-2xl border border-cantaloupe-200/80 bg-cantaloupe-50/70 px-3.5 py-2.5 text-[13px] text-cantaloupe-800 lg:hidden dark:border-cantaloupe-900/50 dark:bg-cantaloupe-950/30 dark:text-cantaloupe-200"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cantaloupe-500" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Demo workspace</span> · Changes reset when you refresh.
            </span>
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={isSigningIn}
              className="shrink-0 text-[13px] font-semibold text-cantaloupe-900 underline-offset-2 hover:underline dark:text-cantaloupe-100"
            >
              Sign in
            </button>
          </div>
        ) : null}
        <div className="mb-5 sm:mb-7">
          {activeChannel ? (
            <div key={`ch-${activeChannel.id}`} className="flex animate-rise items-center gap-3">
              {channelLogo ? <PlatformIcon platform={channelLogo} size={36} className="rounded-xl" /> : null}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-2xl font-extrabold sm:text-[30px] sm:leading-[1.1]">{activeChannel.name}</h1>
                <p className="mt-0.5 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
                  {[
                    activeChannel.handle,
                    `${scopedItems.length} ${scopedItems.length === 1 ? 'post' : 'posts'}`,
                    `${channelIdeas} ${channelIdeas === 1 ? 'idea' : 'ideas'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>
          ) : (
            <>
              <h1 key={activeTab} className="animate-rise text-3xl font-extrabold sm:text-[40px] sm:leading-[1.05]">{page.title}</h1>
              <p className="mt-1 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
                {activeTab === 'library'
                  ? librarySubtitle
                  : activeTab === 'ideas'
                  ? `Your creative inbox · ${ideas.length} saved ${ideas.length === 1 ? 'idea' : 'ideas'}`
                  : page.subtitle}
              </p>
            </>
          )}
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
          <>
          {items.length ? (
            <StatsStrip
              items={scopedItems}
              active={filters.status}
              onSelect={(status) => setFilters((f) => ({ ...f, status }))}
            />
          ) : null}
          <LibraryView
            items={filteredItems}
            totalItemsCount={items.length}
            allItems={items}
            channels={channels}
            filters={filters}
            onFiltersChange={setFilters}
            onSelectItem={setSelectedItem}
            onCreateNew={() => openEditor()}
            onOpenIdeas={() => setActiveTab('ideas')}
            onAddChannel={() => setChannelDialogOpen(true)}
          />
          </>
        ) : activeTab === 'calendar' ? (
          <CalendarView items={items} channels={channels} onSelectItem={setSelectedItem} />
        ) : activeTab === 'ideas' ? (
          <IdeasView
            key={sharedDraft ? 'shared-idea' : 'default-ideas'}
            initialOpenIdeaId={ideaToOpen}
            onInitialIdeaOpened={() => setIdeaToOpen(null)}
            ideas={ideas}
            channels={channels}
            authToken={authToken}
            initialSharedDraft={sharedDraft}
            onCaptureIdea={handleCaptureIdea}
            onUpdateIdea={handleUpdateIdea}
            onMakePost={handleMakePost}
            onDeleteIdea={handleDeleteIdea}
            onAskSlate={(idea) => {
              setChatFocus({ kind: 'idea', id: idea.id });
              setActiveTab('chat');
            }}
          />
        ) : null}
      </main>
      )}

      <MobileTabBar activeTab={activeTab} onTab={setActiveTab} onNewPost={() => openEditor()} />

      {selectedItem ? (
        <ItemDetailModal
          key={`detail-${selectedItem.id}`}
          item={selectedItem}
          channels={channels}
          onClose={() => setSelectedItem(null)}
          onEditFiles={(item) => {
            setSelectedItem(null);
            openEditor(item);
          }}
          onDelete={async (item) => {
            if (await handleDeleteItem(item)) setSelectedItem(null);
          }}
          onDuplicate={(item) => handleDuplicateItem(item)}
          onUpdateFields={(id, patch) => handleUpdateItemFields(id, patch)}
          onAskAI={(item) => {
            setSelectedItem(null);
            setChatFocus({ kind: 'post', id: item.id });
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

      {settingsOpen && firebaseUser ? (
        <AccountSettingsSheet
          user={firebaseUser}
          onClose={() => setSettingsOpen(false)}
          onDeletionStarted={(id) => leaveForDeletionStatus(firebaseUser.uid, id)}
        />
      ) : null}
      {channelDialogOpen ? (
        <AddChannelDialog onClose={() => setChannelDialogOpen(false)} onAdd={handleAddChannel} />
      ) : null}

      <OfflineIndicator />
    </div>
  );
};

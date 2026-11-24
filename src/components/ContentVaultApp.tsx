'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Session } from '@supabase/supabase-js';
import {
  convertIdeaToPostDraft,
  extractDomainAndTitle,
  filterContentItems,
  ideaInChannel,
  platformOfChannel,
  postInChannel,
  type ChannelItem,
  type ContentItem,
  type IdeaItem,
  type LibraryFilters,
  type MediaAsset,
  type PlatformKey,
  type StatusKey,
} from '@/src/lib/content-logic';
import { supabaseBrowser, takeReauthIntent, type AuthUser } from '@/src/lib/supabase/browser';
import { hasLinkPreview } from '@/src/lib/link-preview';
import { fetchLinkPreview } from '@/src/lib/link-preview-client';
import { AccountSettingsSheet } from './AccountSettingsSheet';
import { DEMO_CHANNELS, DEMO_IDEAS, DEMO_ITEMS } from '@/src/lib/demo-data';
import { useTheme } from '@/src/hooks/useTheme';
import { useVisualViewportVars } from '@/src/hooks/useVisualViewport';
import { MobileTopBar, PhoneTabBar, Sidebar, TabletRail, useAppBreakpoint, type ActiveTab, type SidebarProps } from './AppShell';
import { PlatformIcon } from './PlatformIcon';
import { AuthGate } from './AuthGate';
import { IdeasView } from './IdeasView';
import { AddChannelDialog } from './AddChannelDialog';
import { ItemDetailModal, type ItemFieldsPatch } from './ItemDetailModal';
import { ItemEditorModal } from './ItemEditorModal';
import { NewPostDialog } from './NewPostDialog';
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

const toAuthUser = (session: Session | null): AuthUser | null => {
  if (!session?.user) return null;
  const providers = (session.user.identities ?? []).map((i) => i.provider);
  return { uid: session.user.id, email: session.user.email ?? '', hasGoogle: providers.includes('google') };
};

const AUTH_ERRORS: Record<string, string> = {
  cancelled: 'Google sign-in was cancelled.',
  failed: 'Sign-in didn’t complete. Try again.',
};

function readTabFromUrl(): ActiveTab {
  const t = new URLSearchParams(window.location.search).get('tab');
  return t === 'ideas' || t === 'calendar' || t === 'chat' ? t : 'library';
}

/** The live demo link. A signed-in browser still gets the sample workspace, not the account. */
function demoAutostart(): boolean {
  return new URLSearchParams(window.location.search).get('autostart') === '1';
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
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  /** Settings opened straight at Delete account after re-signing in (null: closed normally). */
  const [settingsIntent, setSettingsIntent] = useState<'reauthed' | 'reauth_mismatch' | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Read the tab straight from the URL so a refresh on ?tab=chat never shows Library first. The
  // first render is the loading screen on server and client alike, so this can't mismatch.
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => (typeof window === 'undefined' ? 'library' : readTabFromUrl()));
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
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [newIdeaOpen, setNewIdeaOpen] = useState(false);
  const pendingDate = useRef('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  useVisualViewportVars();
  // Only the shell for this width stays mounted. A hidden copy of the same avatar
  // shares gradient ids and the visible one paints blank.
  const appBreakpoint = useAppBreakpoint();
  const [editingItem, setEditingItem] = useState<ContentItem | null>(null);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelItem | null>(null);
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
      if (params.get('autostart') === '1') enterPreview();
      const authErr = params.get('auth_error');
      if (authErr) {
        setAuthError(AUTH_ERRORS[authErr] ?? AUTH_ERRORS.failed);
        const url = new URL(window.location.href);
        url.searchParams.delete('auth_error');
        window.history.replaceState(null, '', url);
      }
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
    await supabaseBrowser().auth.signOut({ scope: 'local' }).catch(() => undefined);
    window.location.replace(token ? `/account/deleted#${token}` : '/account/deleted');
  }, []);

  const loadAuthenticatedWorkspace = useCallback(async (user: AuthUser) => {
    setLoadingWorkspace(true);
    setWorkspaceError(null);
    try {
      const { data: { session } } = await supabaseBrowser().auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Your session ended. Sign in again.');
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
    let supabase: ReturnType<typeof supabaseBrowser>;
    try {
      supabase = supabaseBrowser();
    } catch (err) {
      Promise.resolve().then(() => {
        setAuthError(err instanceof Error ? err.message : 'Sign-in is not configured.');
        setAuthReady(true);
      });
      return;
    }
    // Fires once with the stored session (INITIAL_SESSION), then on sign-in, sign-out and each
    // automatic token refresh. The session lives in cookies, so it survives a page refresh.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = toAuthUser(session);
      // Don't await other Supabase calls inside this callback (it holds the auth lock): defer.
      setTimeout(() => {
        // /app?autostart=1 is the sample workspace, even on a browser that is already signed in.
        // Applying the session here would replace the demo with the real account.
        if (demoAutostart()) {
          setAuthReady(true);
          return;
        }
        setAuthUser(user);
        setAuthToken(session?.access_token ?? null);
        if (user) {
          setPreviewMode(false);
          if (loadedUid.current !== user.uid) {
            loadedUid.current = user.uid;
            void loadAuthenticatedWorkspace(user);
          }
          // Back from "sign in again to delete": reopen Delete account, but only for the same account.
          const expected = takeReauthIntent();
          if (expected) {
            setSettingsIntent(expected === user.uid ? 'reauthed' : 'reauth_mismatch');
            setSettingsOpen(true);
          }
        } else {
          loadedUid.current = null;
        }
        setAuthReady(true);
      }, 0);
    });
    return () => subscription.unsubscribe();
  }, [loadAuthenticatedWorkspace]);


  /** "Sign in" from the demo: leave the sample workspace. An existing session opens that account. */
  const goToSignIn = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('autostart');
    window.history.replaceState(null, '', url);
    void (async () => {
      let session: Session | null = null;
      try {
        const result = await supabaseBrowser().auth.getSession();
        session = result.data.session;
      } catch {
        session = null;
      }
      const next = toAuthUser(session);
      setChannels([]);
      setItems([]);
      setIdeas([]);
      setPreviewMode(false);
      if (!next) return;
      setLoadingWorkspace(true);
      setAuthUser(next);
      setAuthToken(session?.access_token ?? null);
      loadedUid.current = next.uid;
      void loadAuthenticatedWorkspace(next);
    })();
  };

  const handleSignOut = async () => {
    // The demo is the demo. Signing out here would drop the sample workspace.
    if (previewMode) return;
    let uid = authUser?.uid ?? null;
    if (!uid) {
      try {
        const { data: { session } } = await supabaseBrowser().auth.getSession();
        uid = session?.user?.id ?? null;
      } catch {
        uid = null;
      }
    }
    if (uid) {
      try {
        window.localStorage.removeItem(`cv_chat_${uid}`);
        window.localStorage.removeItem(`cv_slate_open_${uid}`);
      } catch {
        // Storage unavailable
      }
    }
    try {
      await supabaseBrowser().auth.signOut({ scope: 'local' });
    } catch {
      // Sign-in isn't configured, or the session is already gone.
    }
    loadedUid.current = null;
    setAuthUser(null);
    setAuthToken(null);
    setPreviewMode(false);
    setChannels([]);
    setItems([]);
    setIdeas([]);
    const url = new URL(window.location.href);
    url.searchParams.delete('autostart');
    window.history.replaceState(null, '', url);
  };

  /** The current access token; Supabase refreshes it first if it's about to expire. */
  const getFreshToken = async (): Promise<string | null> => {
    if (!authUser) return null;
    const { data: { session } } = await supabaseBrowser().auth.getSession();
    const token = session?.access_token ?? null;
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

  const handleAddChannel = async (name: string, handle: string, platform: PlatformKey): Promise<boolean> => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, '/api/channels', 'POST', { name, handle, platform });
        setChannels((prev) => [...prev, data.channel]);
      } else {
        const nextChannels = [...channels, { id: Date.now(), name, handle, platform }];
        setChannels(nextChannels);
      }
      toast(`Channel “${name}” added`);
      return true;
    } catch (err) {
      fail(err, 'Could not add channel.');
      return false;
    }
  };

  /** Puts server copies of posts and ideas a channel change touched into the workspace. */
  const mergeChanged = (changedItems: ContentItem[] = [], changedIdeas: IdeaItem[] = []) => {
    changedItems.forEach(rememberPost);
    changedIdeas.forEach(rememberIdea);
    if (changedItems.length) setItems((prev) => prev.map((i) => changedItems.find((c) => c.id === i.id) ?? i));
    if (changedIdeas.length) setIdeas((prev) => prev.map((i) => changedIdeas.find((c) => c.id === i.id) ?? i));
  };

  /** Edit a channel. Renaming moves its posts and ideas along with it. */
  const handleEditChannel = async (channel: ChannelItem, name: string, handle: string, platform: PlatformKey): Promise<boolean> => {
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/channels/${channel.id}`, 'PATCH', { name, handle, platform });
        setChannels((prev) => prev.map((c) => (c.id === channel.id ? data.channel : c)));
        mergeChanged(data.items, data.ideas);
      } else {
        setChannels((prev) => prev.map((c) => (c.id === channel.id ? { ...c, name, handle, platform } : c)));
        if (name !== channel.name) {
          setItems((prev) => prev.map((i) => (postInChannel(i, channel, channels) ? { ...i, channelName: name, channelId: channel.id } : i)));
          setIdeas((prev) => prev.map((i) => (ideaInChannel(i, channel, channels) ? { ...i, channelName: name } : i)));
        }
      }
      if (filters.channel.toLowerCase() === channel.name.toLowerCase() && name !== channel.name && !channels.some((c) => c.id !== channel.id && c.name.toLowerCase() === channel.name.toLowerCase())) {
        setFilters((f) => ({ ...f, channel: name }));
      }
      toast('Channel updated');
      return true;
    } catch (err) {
      fail(err, 'Could not update the channel.');
      return false;
    }
  };

  /** Delete a channel. Its posts and ideas stay, without a channel. */
  const handleDeleteChannel = async (channel: ChannelItem) => {
    const ok = await confirm({
      title: `Delete “${channel.name}”?`,
      body: 'Its posts and ideas stay in your library, without a channel.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/channels/${channel.id}`, 'DELETE');
        mergeChanged(data.items, data.ideas);
      } else {
        setItems((prev) => prev.map((i) => (postInChannel(i, channel, channels) ? { ...i, channelName: '', channelId: null } : i)));
        setIdeas((prev) => prev.map((i) => (ideaInChannel(i, channel, channels) ? { ...i, channelName: '' } : i)));
      }
      setChannels((prev) => prev.filter((c) => c.id !== channel.id));
      if (filters.channel === String(channel.id) || (filters.channel.toLowerCase() === channel.name.toLowerCase() && !channels.some((c) => c.id !== channel.id && c.name.toLowerCase() === channel.name.toLowerCase()))) {
        setFilters((f) => ({ ...f, channel: 'all' }));
      }
      toast(`Channel “${channel.name}” deleted`);
    } catch (err) {
      fail(err, 'Could not delete the channel.');
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
    /** Which channel, when two share a name. */
    channelId?: number | null;
  }): Promise<ContentItem | null> => {
    // Errors propagate to the editor, which shows them inline.
    let created: ContentItem | null = null;
    const token = await getFreshToken();
    const named = channels.filter((c) => c.name.toLowerCase() === payload.channelName.trim().toLowerCase());
    const prefer = payload.channelId ?? (payload.id ? items.find((i) => i.id === payload.id)?.channelId : null);
    const channelId = !payload.channelName.trim()
      ? null
      : named.some((c) => c.id === prefer)
        ? prefer ?? null
        : named[0]?.id ?? null;

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
        created = data.item;
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
        const local: ContentItem = {
          ...payload,
          id: Date.now(),
          channelId,
          attachedReferences: [],
          sourceIdeaId: null,
          createdAt: now,
          updatedAt: now,
        };
        created = local;
        nextItems = [local, ...items];
      }
      setItems(nextItems);
    }
    toast(payload.id ? 'Post updated' : 'Post created');
    return created;
  };

  /** Title and platform, then open the new post with the drop zone ready. */
  const handleQuickCreatePost = async (title: string, platform: PlatformKey, channelName: string, channelId: number | null = null) => {
    const date = pendingDate.current;
    pendingDate.current = '';
    const created = await handleSaveItem({
      title,
      platform,
      channelName,
      channelId,
      status: 'idea',
      caption: '',
      tags: [],
      notes: '',
      liveLink: '',
      postDate: '',
      targetDate: date,
      coverAsset: null,
      videoAsset: null,
      slides: [],
    });
    setNewPostOpen(false);
    if (created) setSelectedItem(created);
  };


  const handleUpdateItemFields = async (itemId: number, fields: ItemFieldsPatch): Promise<ContentItem | null> => {
    const patch: ItemFieldsPatch & { channelId?: number | null } = { ...fields };
    if (fields.channelName !== undefined) {
      const named = channels.filter((c) => c.name.toLowerCase() === fields.channelName!.trim().toLowerCase());
      const current = items.find((i) => i.id === itemId)?.channelId;
      patch.channelId = !fields.channelName.trim() ? null : named.some((c) => c.id === current) ? current ?? null : named[0]?.id ?? null;
    }
    try {
      let saved: ContentItem | null = null;
      const token = await getFreshToken();
      if (token) {
        const data = await api(token, `/api/items/${itemId}`, 'PATCH', { ...patch, expectedVersion: postVersion(itemId) });
        saved = data.item as ContentItem;
        rememberPost(saved);
        setItems((prev) => prev.map((i) => (i.id === itemId ? saved ?? i : i)));
        if (selectedItem?.id === itemId) setSelectedItem(saved);
      } else {
        const nextItems = items.map((item) =>
          item.id === itemId ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
        );
        setItems(nextItems);
        saved = nextItems.find((i) => i.id === itemId) ?? null;
        if (selectedItem?.id === itemId) setSelectedItem(saved);
      }
      toast('Saved');
      return saved;
    } catch (err) {
      if (isConflict(err)) handleConflict(err);
      fail(err, 'Could not save changes.');
      return null;
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

  /** Titles Backlot made up for a link idea (from the URL text), which a real title can replace. */
  const isAutoIdeaTitle = (title: string, link: string) =>
    title === extractDomainAndTitle(link).suggestedTitle ||
    title === 'Saved idea' ||
    title === 'Captured idea' ||
    // Older made-up titles, e.g. "YouTube Reference: watch".
    /^(YouTube( Short)? Reference|Instagram (Reel|Post) Reference)(: \S+)?$/.test(title);

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
        // YouTube/TikTok link: use the video's real title (looked up once; saving never waits more than ~4 s).
        if (payload.linkUrl && hasLinkPreview(payload.linkUrl)) {
          const preview = await fetchLinkPreview(payload.linkUrl, token);
          if (preview.title) {
            payload = { ...payload, linkTitle: preview.title, title: isAutoIdeaTitle(payload.title, payload.linkUrl) ? preview.title : payload.title };
          }
        }
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

  const handleMakePost = async (idea: IdeaItem, platform?: PlatformKey) => {
    try {
      const token = await getFreshToken();
      let newItem: ContentItem;
      if (token) {
        const data = await api(token, `/api/ideas/${idea.id}`, 'POST', { expectedVersion: ideaVersion(idea.id), ...(platform ? { platform } : {}) });
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
          newItem = { ...convertIdeaToPostDraft({ ...idea, platform: platform ?? idea.platform }), id: Date.now(), createdAt: now, updatedAt: now };
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

  // Existing YouTube/TikTok link ideas that still have a made-up title ("YouTube Reference: watch")
  // get the video's real title, once per idea per session, quietly (no toast).
  const titledIdeas = useRef(new Set<number>());
  useEffect(() => {
    if (!authToken || loadingWorkspace) return;
    const todo = ideas.filter((i) => i.linkUrl && !titledIdeas.current.has(i.id) && hasLinkPreview(i.linkUrl) && isAutoIdeaTitle(i.title, i.linkUrl));
    if (!todo.length) return;
    todo.forEach((i) => titledIdeas.current.add(i.id));
    void (async () => {
      for (const idea of todo.slice(0, 20)) {
        const preview = await fetchLinkPreview(idea.linkUrl, authToken);
        if (!preview.title) continue;
        try {
          const data = await api(authToken, `/api/ideas/${idea.id}`, 'PATCH', { title: preview.title, linkTitle: preview.title, expectedVersion: ideaVersion(idea.id) });
          rememberIdea(data.idea);
          setIdeas((prev) => prev.map((i) => (i.id === idea.id ? data.idea : i)));
        } catch {
          // A conflict or error: leave the title as it is.
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, loadingWorkspace, ideas]);

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

  const selectedChannel =
    filters.channel !== 'all'
      ? channels.find((c) => String(c.id) === filters.channel) ??
        channels.find((c) => c.name.toLowerCase() === filters.channel.toLowerCase()) ??
        null
      : null;
  const filteredItems = useMemo(() => {
    const list = filterContentItems(items, selectedChannel ? { ...filters, channel: 'all' } : filters);
    return selectedChannel ? list.filter((i) => postInChannel(i, selectedChannel, channels)) : list;
  }, [items, filters, selectedChannel, channels]);

  // The demo uses the same screens and handlers; without a token every change stays in memory.
  const isDemo = !authUser;

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

  if (!authUser && !previewMode) {
    return (
      <>
        <AuthGate
          onPreview={() => {
            enterPreview();
            const url = new URL(window.location.href);
            url.searchParams.set('autostart', '1');
            window.history.replaceState(null, '', url);
          }}
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
  const activeChannel = activeTab === 'library' ? selectedChannel : null;
  const scopedItems = activeChannel ? items.filter((i) => postInChannel(i, activeChannel, channels)) : items;
  const channelIdeas = activeChannel ? ideas.filter((i) => ideaInChannel(i, activeChannel, channels)).length : 0;
  const channelLogo = activeChannel ? platformOfChannel(activeChannel, items, channels) : null;
  const goTab = (tab: ActiveTab) => {
    // "Library" always means everything; leaving a channel clears its filter.
    if (tab === 'library') setFilters((f) => ({ ...f, channel: 'all' }));
    setActiveTab(tab);
  };

  const account = {
    uid: authUser?.uid ?? null,
    isPreview: !authUser,
  };
  const shellProps = {
    activeTab,
    onTab: goTab,
    onNewPost: () => setNewPostOpen(true),
    account,
    theme: themePref,
    onThemeChange: setThemePref,
    onSignOut: handleSignOut,
    onSignIn: authUser ? undefined : goToSignIn,
    onOpenSettings: authUser ? () => setSettingsOpen(true) : undefined,
  };

  const sidebarProps: SidebarProps = {
    ...shellProps,
    counts: { library: items.length, ideas: ideas.filter((i) => !i.convertedItemId).length, calendar: null, chat: null },
    channels,
    items,
    activeChannel: activeChannel ? String(activeChannel.id) : 'all',
    onAddChannel: () => setChannelDialogOpen(true),
    onEditChannel: setEditingChannel,
    onDeleteChannel: handleDeleteChannel,
    onChannel: (name) => {
      setFilters((f) => ({ ...f, channel: name, status: 'all', platform: 'all' }));
      setActiveTab('library');
    },
  };

  return (
    <div
      className={cx(
        'relative isolate md:pl-16 lg:pl-[256px]',
        // Below lg the chat follows the visual viewport so the composer stays above the keyboard.
        isChat
          ? 'flex h-dvh flex-col overflow-hidden max-lg:h-[var(--vv-height,100dvh)] max-md:pb-[calc(45px+env(safe-area-inset-bottom))]'
          : 'min-h-dvh pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-[calc(2.5rem+env(safe-area-inset-bottom))] lg:pb-16'
      )}
    >
      {appBreakpoint === null || appBreakpoint === 'desktop' ? <Sidebar {...sidebarProps} /> : null}
      {appBreakpoint === null || appBreakpoint === 'tablet' ? (
      <TabletRail
        activeTab={activeTab}
        onTab={goTab}
        activeChannel={sidebarProps.activeChannel}
        channels={channels}
        items={items}
        onChannel={sidebarProps.onChannel}
        onAddChannel={sidebarProps.onAddChannel}
        account={account}
        onSignOut={handleSignOut}
        onOpenSettings={shellProps.onOpenSettings}
      />
      ) : null}
      {appBreakpoint === null || appBreakpoint === 'phone' ? <MobileTopBar {...shellProps} /> : null}
      <PhoneTabBar
        activeTab={activeTab}
        onTab={goTab}
        onNew={() => {
          if (activeTab === 'ideas') {
            setNewIdeaOpen(true);
            return;
          }
          setNewPostOpen(true);
        }}
      />
      {/* Slate is always mounted (hidden on other tabs): opening it is instant, a refresh on the
          Slate tab shows the chat straight away (posts and ideas fill in as the workspace loads),
          and switching tabs doesn't reload the conversation. */}
        <main className={cx('min-h-0 w-full flex-1 flex-col', isChat ? 'flex' : 'hidden')} aria-hidden={!isChat || undefined}>
          <StudioChatPanel
            active={isChat}
            items={items}
            ideas={ideas}
            channels={channels}
            historyKey={authUser ? `cv_chat_${authUser.uid}` : null}
            authToken={authToken}
            sample={!authUser}
            focus={chatFocus}
            onFocusChange={setChatFocus}
            onApplyCaption={async (itemId, caption) => (await handleUpdateItemFields(itemId, { caption })) != null}
            onActionApplied={handleSlateApplied}
            onSignIn={authUser ? undefined : goToSignIn}
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
      {isChat ? null : (
      <main className="@container mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 sm:pt-8 lg:px-10 lg:pt-10">
        {isDemo ? (
          // Desktop shows the same note in the sidebar card.
          <div
            data-preview-badge
            className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-surface-2 px-3.5 py-2.5 text-[13px] text-text lg:hidden"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-faint" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Demo workspace</span> · Changes reset when you refresh.
            </span>
            <Link href="/" className="shrink-0 text-[13px] font-semibold text-link underline-offset-2 hover:underline">
              Back to home
            </Link>
            <button
              type="button"
              onClick={goToSignIn}
              className="shrink-0 text-[13px] font-semibold text-link underline-offset-2 hover:underline"
            >
              Sign in
            </button>
          </div>
        ) : null}
        {(activeTab === 'library' || activeTab === 'ideas') && !activeChannel ? null : (
        <div className="mb-5 flex items-start justify-between gap-3 sm:mb-7">
          {activeChannel ? (
            <div key={`ch-${activeChannel.id}`} className="flex min-w-0 flex-1 animate-rise items-center gap-3">
              {channelLogo ? <PlatformIcon platform={channelLogo} size={36} colored className="rounded-xl" /> : null}
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
            <div className="min-w-0 flex-1">
              <h1 key={activeTab} className="animate-rise text-3xl font-extrabold sm:text-[40px] sm:leading-[1.05]">{page.title}</h1>
              <p className="mt-1 text-sm text-zinc-500 tabular-nums dark:text-zinc-400">
                {loadingWorkspace && activeTab !== 'calendar' ? (
                  <span className="inline-block h-3.5 w-44 animate-pulse rounded bg-surface-2 align-middle" aria-label="Loading" />
                ) : activeTab === 'library'
                  ? librarySubtitle
                  : activeTab === 'ideas'
                  ? `Your creative inbox · ${ideas.length} saved ${ideas.length === 1 ? 'idea' : 'ideas'}`
                  : page.subtitle}
              </p>
            </div>
          )}
        </div>
        )}

        {workspaceError ? (
          <div
            role="alert"
            className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300"
          >
            <span>{workspaceError}</span>
            {authUser ? (
              <button
                type="button"
                onClick={() => loadAuthenticatedWorkspace(authUser)}
                className={cx(buttonStyles.secondary, sizes.sm)}
              >
                Try again
              </button>
            ) : null}
          </div>
        ) : null}

        {loadingWorkspace ? (
          <PageSkeleton tab={activeTab} />
        ) : activeTab === 'library' ? (
          <LibraryView
            items={filteredItems}
            totalItemsCount={items.length}
            allItems={scopedItems}
            authToken={authToken}
            filters={filters}
            heading={activeChannel ? null : 'Library'}
            onFiltersChange={setFilters}
            onSelectItem={setSelectedItem}
            onCreateNew={() => setNewPostOpen(true)}
          />
        ) : activeTab === 'calendar' ? (
          <CalendarView
            items={items}
            channels={channels}
            authToken={authToken}
            onSelectItem={setSelectedItem}
            onReschedule={(item, targetDate) => handleUpdateItemFields(item.id, { targetDate })}
            onCreateOnDay={(date) => {
              pendingDate.current = date;
              setNewPostOpen(true);
            }}
          />
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
            heading={activeChannel ? null : 'Ideas'}
            createOpen={newIdeaOpen}
            onCreateClose={() => setNewIdeaOpen(false)}
          />
        ) : null}
      </main>
      )}

      {selectedItem ? (
        <ItemDetailModal
          key={`detail-${selectedItem.id}`}
          item={selectedItem}
          channels={channels}
          authToken={authToken}
          onClose={() => setSelectedItem(null)}
          sourceIdea={ideas.find((i) => i.id === selectedItem.sourceIdeaId) ?? null}
          onOpenIdea={(id) => {
            setSelectedItem(null);
            setIdeaToOpen(id);
            setActiveTab('ideas');
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


      {newPostOpen ? (
        <NewPostDialog
          channels={channels}
          initialChannel={activeChannel ? String(activeChannel.id) : ''}
          onCreate={handleQuickCreatePost}
          onClose={() => setNewPostOpen(false)}
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
          onSave={async (payload) => {
            await handleSaveItem(payload);
          }}
        />
      ) : null}

      {settingsOpen && authUser ? (
        <AccountSettingsSheet
          user={authUser}
          getToken={getFreshToken}
          intent={settingsIntent}
          onClose={() => {
            setSettingsOpen(false);
            setSettingsIntent(null);
          }}
          onDeletionStarted={(id) => leaveForDeletionStatus(authUser.uid, id)}
        />
      ) : null}
      {channelDialogOpen ? (
        <AddChannelDialog onClose={() => setChannelDialogOpen(false)} onAdd={handleAddChannel} />
      ) : null}
      {editingChannel ? (
        <AddChannelDialog
          channel={editingChannel}
          onClose={() => setEditingChannel(null)}
          onAdd={(name, handle, platform) => handleEditChannel(editingChannel, name, handle, platform)}
        />
      ) : null}

      <OfflineIndicator />
    </div>
  );
};

/* ---------------- Loading placeholders, one per page ---------------- */

const shimmer = 'animate-pulse rounded bg-surface-2';

/** Shown while the workspace loads after a refresh: the same shape as the page that's coming. */
function PageSkeleton({ tab }: { tab: ActiveTab }) {
  if (tab === 'calendar') {
    return (
      <div aria-busy="true" aria-label="Loading calendar" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className={cx(shimmer, 'h-6 w-40')} />
          <div className={cx(shimmer, 'h-10 w-48 rounded-full')} />
        </div>
        <div className="overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="grid grid-cols-7 border-b border-zinc-100 py-2.5 dark:border-zinc-800">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className={cx(shimmer, 'mx-auto h-2.5 w-8')} />
            ))}
          </div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 35 }, (_, i) => (
              <div key={i} className="h-20 border-b border-r border-zinc-100 p-2 sm:h-24 dark:border-zinc-800">
                <div className={cx(shimmer, 'h-2.5 w-4')} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  if (tab === 'ideas') {
    return (
      <div aria-busy="true" aria-label="Loading ideas" className="space-y-4">
        <div className="flex items-center gap-2.5">
          <div className={cx(shimmer, 'h-10 flex-1 rounded-xl lg:max-w-md')} />
          <div className={cx(shimmer, 'h-10 w-32 rounded-xl')} />
        </div>
        <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="overflow-hidden rounded-2xl border border-border bg-surface">
              <div className={cx(shimmer, 'aspect-[16/10] rounded-none')} />
              <div className="space-y-2.5 p-4">
                <div className={cx(shimmer, 'h-4 w-3/4')} />
                <div className={cx(shimmer, 'h-3 w-full')} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  // Library
  return (
    <div aria-busy="true" aria-label="Loading library" className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className={cx(shimmer, 'h-[72px] rounded-2xl')} />
        ))}
      </div>
      <div className={cx(shimmer, 'h-10 w-full rounded-xl lg:max-w-xl')} />
      <div className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className={cx(shimmer, 'aspect-[4/3] rounded-none')} />
            <div className="space-y-2.5 p-4">
              <div className={cx(shimmer, 'h-3 w-1/3')} />
              <div className={cx(shimmer, 'h-4 w-4/5')} />
              <div className={cx(shimmer, 'h-3 w-full')} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

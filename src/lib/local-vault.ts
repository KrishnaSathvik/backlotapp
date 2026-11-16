import type { ChannelItem, ContentItem, IdeaItem } from './content-logic';

const STORAGE_KEY = 'slatevault_workspace_v3';
const DB_NAME = 'slatevault_media_db';
const STORE_NAME = 'blobs';

export interface WorkspaceSnapshot {
  channels: ChannelItem[];
  items: ContentItem[];
  ideas: IdeaItem[];
  nextId: number;
}

export function buildInitialPreviewSnapshot(): WorkspaceSnapshot {
  return {
    channels: [],
    items: [],
    ideas: [],
    nextId: 1,
  };
}

export function loadPreviewWorkspace(): WorkspaceSnapshot {
  if (typeof window === 'undefined') {
    return buildInitialPreviewSnapshot();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = buildInitialPreviewSnapshot();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as WorkspaceSnapshot;
    if (!Array.isArray(parsed.items) || !Array.isArray(parsed.channels)) {
      const initial = buildInitialPreviewSnapshot();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    return parsed;
  } catch {
    return buildInitialPreviewSnapshot();
  }
}

export function savePreviewWorkspace(snapshot: WorkspaceSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Ignore storage quota issues for large blobs stored in IndexedDB
  }
}

function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalBlob(key: string, file: Blob): Promise<string> {
  try {
    const db = await openBlobDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(file, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return `idb://${key}`;
  } catch {
    return URL.createObjectURL(file);
  }
}

export async function resolveAssetUrl(url: string): Promise<string> {
  if (!url.startsWith('idb://')) return url;
  const key = url.slice('idb://'.length);
  try {
    const db = await openBlobDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as Blob | undefined);
      req.onerror = () => reject(req.error);
    });
    if (blob) {
      return URL.createObjectURL(blob);
    }
  } catch {
    // Fallback
  }
  return '';
}

export async function fetchAssetAsBlob(url: string): Promise<Blob | null> {
  if (!url) return null;
  if (url.startsWith('idb://')) {
    const key = url.slice('idb://'.length);
    try {
      const db = await openBlobDb();
      const blob = await new Promise<Blob | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => resolve(req.result as Blob | undefined);
        req.onerror = () => reject(req.error);
      });
      return blob ?? null;
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

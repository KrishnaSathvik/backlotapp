// Reads media saved by older demo sessions (idb:// URLs). New demo uploads stay in memory.

const DB_NAME = 'slatevault_media_db';
const STORE_NAME = 'blobs';

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

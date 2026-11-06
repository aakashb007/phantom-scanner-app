import { DocumentRecord, DeletedDocRecord, RecentFileRecord } from '../types/document';

const DB_NAME = 'phantom_scanner_db';
const DB_VERSION = 3;
const DOCS_STORE = 'documents';
const SETTINGS_STORE = 'settings';
const DELETED_STORE = 'deleted_docs';
const RECENT_FILES_STORE = 'recent_files';

// Fired whenever the user changes documents, so Google Drive sync can run ~5 minutes later.
export const DOCS_CHANGED_EVENT = 'phantom:docs-changed';
let suppressChangeEvents = 0;
function notifyDocsChanged() {
  if (suppressChangeEvents > 0) return;
  try {
    window.dispatchEvent(new Event(DOCS_CHANGED_EVENT));
  } catch {
    /* ignore */
  }
}

/** Run DB writes (e.g. from sync) without scheduling another sync. */
export async function withoutChangeEvents<T>(fn: () => Promise<T>): Promise<T> {
  suppressChangeEvents++;
  try {
    return await fn();
  } finally {
    suppressChangeEvents--;
  }
}

export async function removeDeletedDocRecord(docId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DELETED_STORE, 'readwrite');
    tx.objectStore(DELETED_STORE).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Delete a document locally because it was deleted on another device (not recorded for upload). */
export async function deleteDocumentLocalOnly(docId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readwrite');
    tx.objectStore(DOCS_STORE).delete(docId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(DOCS_STORE)) {
        const docStore = db.createObjectStore(DOCS_STORE, { keyPath: 'docId' });
        docStore.createIndex('name', 'name', { unique: false });
        docStore.createIndex('folder', 'folder', { unique: false });
        docStore.createIndex('category', 'category', { unique: false });
        docStore.createIndex('vault', 'vault', { unique: false });
        docStore.createIndex('created', 'created', { unique: false });
        docStore.createIndex('lastChanged', 'lastChanged', { unique: false });
      }

      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(DELETED_STORE)) {
        const delStore = db.createObjectStore(DELETED_STORE, { keyPath: 'docId' });
        delStore.createIndex('deletedAt', 'deletedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(RECENT_FILES_STORE)) {
        const recStore = db.createObjectStore(RECENT_FILES_STORE, { keyPath: 'id' });
        recStore.createIndex('lastOpened', 'lastOpened', { unique: false });
        recStore.createIndex('name', 'name', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllDocuments(): Promise<DocumentRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readonly');
    const store = tx.objectStore(DOCS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      // Sort newest first by lastChanged
      const docs = (request.result as DocumentRecord[]).sort((a, b) => b.lastChanged - a.lastChanged);
      resolve(docs);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getDocument(docId: string): Promise<DocumentRecord | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readonly');
    const store = tx.objectStore(DOCS_STORE);
    const request = store.get(docId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocument(doc: DocumentRecord): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readwrite');
    const store = tx.objectStore(DOCS_STORE);
    const docToSave = {
      ...doc,
      lastChanged: doc.lastChanged || Date.now(),
    };
    const request = store.put(docToSave);
    request.onsuccess = () => {
      notifyDocsChanged();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function recordDeletedDoc(docId: string, name: string = 'Untitled'): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DELETED_STORE, 'readwrite');
    const store = tx.objectStore(DELETED_STORE);
    const rec: DeletedDocRecord = {
      docId,
      name,
      deletedAt: Date.now(),
    };
    store.put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getDeletedDocs(): Promise<DeletedDocRecord[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DELETED_STORE, 'readonly');
    const store = tx.objectStore(DELETED_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDocument(docId: string, name?: string): Promise<void> {
  const db = await openDatabase();
  // Fetch name first if not provided
  let docName = name;
  if (!docName) {
    const existing = await getDocument(docId);
    docName = existing?.name || 'Untitled Document';
  }

  // Record into deleted_docs list for cloud sync tracking
  await recordDeletedDoc(docId, docName);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readwrite');
    const store = tx.objectStore(DOCS_STORE);
    const request = store.delete(docId);
    request.onsuccess = () => {
      notifyDocsChanged();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDocuments(docIds: string[]): Promise<void> {
  const db = await openDatabase();
  for (const id of docIds) {
    const doc = await getDocument(id);
    await recordDeletedDoc(id, doc?.name || 'Untitled Document');
  }

  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOCS_STORE, 'readwrite');
    const store = tx.objectStore(DOCS_STORE);
    docIds.forEach((id) => store.delete(id));
    tx.oncomplete = () => {
      notifyDocsChanged();
      resolve();
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateDocument(docId: string, updates: Partial<DocumentRecord>): Promise<DocumentRecord | null> {
  const existing = await getDocument(docId);
  if (!existing) return null;
  const updated: DocumentRecord = {
    ...existing,
    ...updates,
    lastChanged: Date.now(), // always updates lastChanged
  };
  await saveDocument(updated);
  return updated;
}

/** Update fields that are NOT synced (e.g. OCR text) without changing lastChanged or scheduling a sync. */
export async function updateDocumentSilently(docId: string, updates: Partial<DocumentRecord>): Promise<DocumentRecord | null> {
  const existing = await getDocument(docId);
  if (!existing) return null;
  const updated: DocumentRecord = { ...existing, ...updates, lastChanged: existing.lastChanged };
  await withoutChangeEvents(() => saveDocument(updated));
  return updated;
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  try {
    const db = await openDatabase();
    return new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.get(key);
      request.onsuccess = () => {
        if (request.result && request.result.value !== undefined) {
          resolve(request.result.value as T);
        } else {
          resolve(defaultValue);
        }
      };
      request.onerror = () => resolve(defaultValue);
    });
  } catch {
    return defaultValue;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      const request = store.put({ key, value });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to set setting:', err);
  }
}

// ==========================================
// SECTION 5: RECENT FILES (Max 15 stored in IndexedDB)
// ==========================================

export async function getRecentFiles(): Promise<RecentFileRecord[]> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECENT_FILES_STORE, 'readonly');
      const store = tx.objectStore(RECENT_FILES_STORE);
      const request = store.getAll();
      request.onsuccess = () => {
        const list = (request.result as RecentFileRecord[]) || [];
        // Sort newest first by lastOpened
        list.sort((a, b) => b.lastOpened - a.lastOpened);
        resolve(list.slice(0, 15));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('Failed to get recent files:', err);
    return [];
  }
}

export async function getRecentFile(id: string): Promise<RecentFileRecord | undefined> {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECENT_FILES_STORE, 'readonly');
      const store = tx.objectStore(RECENT_FILES_STORE);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return undefined;
  }
}

export async function saveRecentFile(
  fileData: Omit<RecentFileRecord, 'id'> & { id?: string }
): Promise<RecentFileRecord> {
  const db = await openDatabase();
  const all = await getRecentFiles();

  // If a file with matching name and size exists, reuse its ID and bookmarks
  const existing = all.find((f) => f.name === fileData.name && f.size === fileData.size);
  const id = fileData.id || existing?.id || crypto.randomUUID();

  const record: RecentFileRecord = {
    ...fileData,
    id,
    lastOpened: Date.now(),
    bookmarks: fileData.bookmarks || existing?.bookmarks || [],
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_FILES_STORE, 'readwrite');
    const store = tx.objectStore(RECENT_FILES_STORE);
    store.put(record);

    tx.oncomplete = async () => {
      // Enforce max 15 recent files limit
      const updatedList = await getRecentFiles();
      if (updatedList.length > 15) {
        const toDelete = updatedList.slice(15);
        const delTx = db.transaction(RECENT_FILES_STORE, 'readwrite');
        const delStore = delTx.objectStore(RECENT_FILES_STORE);
        toDelete.forEach((item) => delStore.delete(item.id));
      }
      resolve(record);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateRecentFilePage(id: string, page: number, totalPages?: number): Promise<void> {
  try {
    const db = await openDatabase();
    const existing = await getRecentFile(id);
    if (!existing) return;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECENT_FILES_STORE, 'readwrite');
      const store = tx.objectStore(RECENT_FILES_STORE);
      store.put({
        ...existing,
        lastPageRead: page,
        totalPages: totalPages ?? existing.totalPages,
        lastOpened: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error('Failed to update recent file page:', err);
  }
}

export async function toggleRecentFileBookmark(id: string, page: number): Promise<number[]> {
  try {
    const db = await openDatabase();
    const existing = await getRecentFile(id);
    if (!existing) return [];

    const currentBookmarks = existing.bookmarks || [];
    const newBookmarks = currentBookmarks.includes(page)
      ? currentBookmarks.filter((p) => p !== page)
      : [...currentBookmarks, page].sort((a, b) => a - b);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(RECENT_FILES_STORE, 'readwrite');
      const store = tx.objectStore(RECENT_FILES_STORE);
      store.put({
        ...existing,
        bookmarks: newBookmarks,
        lastOpened: Date.now(),
      });
      tx.oncomplete = () => resolve(newBookmarks);
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return [];
  }
}

export async function deleteRecentFile(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_FILES_STORE, 'readwrite');
    const store = tx.objectStore(RECENT_FILES_STORE);
    store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearRecentFiles(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECENT_FILES_STORE, 'readwrite');
    const store = tx.objectStore(RECENT_FILES_STORE);
    store.clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

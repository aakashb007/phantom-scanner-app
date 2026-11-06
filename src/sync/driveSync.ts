// Google Drive sync, byte-for-byte compatible with the Phantom Scanner Android app.
// See PHANTOM-SCANNER.md section 8, "One Gmail, every device: exact sync format".
import { GOOGLE_CLIENT_ID } from '../config';
import {
  getAllDocuments,
  getDeletedDocs,
  getSetting,
  setSetting,
  saveDocument,
  removeDeletedDocRecord,
  deleteDocumentLocalOnly,
  withoutChangeEvents,
  DOCS_CHANGED_EVENT,
} from '../db/db';
import { DocumentRecord, DocumentPage } from '../types/document';
import { buildDrivePdf, extractJpegPages, renderPdfPages, DriveSize } from './drivePdf';
import { runBackgroundOcr } from '../utils/tesseractOcr';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MAIN_FOLDER = 'Phantom Scanner';
const TRASH_FOLDER = 'Trash';
const SCOPE = 'https://www.googleapis.com/auth/drive.file email';
const AUTO_SYNC_DELAY_MS = 5 * 60 * 1000;

export interface DriveStatus {
  connected: boolean;
  email: string;
  autoSync: boolean;
  size: DriveSize;
  lastSynced: number | null;
  problem: string | null;
  syncing: boolean;
}

interface DriveFile {
  id: string;
  name: string;
  appProperties?: Record<string, string>;
}

// ---------------------------------------------------------------- status

const listeners = new Set<(s: DriveStatus) => void>();
let status: DriveStatus = {
  connected: false,
  email: '',
  autoSync: true,
  size: 'standard',
  lastSynced: null,
  problem: null,
  syncing: false,
};

function setStatus(patch: Partial<DriveStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l(status));
}

export function subscribeDriveStatus(fn: (s: DriveStatus) => void): () => void {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function getDriveStatus(): DriveStatus {
  return status;
}

// ---------------------------------------------------------------- auth (Google Identity Services)

let gisLoaded: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if ((window as any).google?.accounts?.oauth2) return Promise.resolve();
  if (!gisLoaded) {
    gisLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisLoaded = null;
        reject(new Error('Could not load Google sign-in (are you offline?)'));
      };
      document.head.appendChild(s);
    });
  }
  return gisLoaded;
}

async function getStoredToken(): Promise<string | null> {
  const t = await getSetting<{ token: string; exp: number } | null>('drive_token', null);
  if (t && t.token && t.exp > Date.now() + 60_000) return t.token;
  return null;
}

/** Ask Google for an access token. Must be called from a tap/click (it may open a Google window). */
export async function requestAccessToken(interactive: boolean): Promise<string> {
  if (!GOOGLE_CLIENT_ID) throw new Error('Google sign-in is not set up yet (GOOGLE_CLIENT_ID is empty).');
  await loadGis();
  const google = (window as any).google;
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: status.email || undefined,
      prompt: interactive && !status.connected ? 'select_account consent' : '',
      callback: async (resp: any) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error_description || resp.error || 'Sign-in was cancelled'));
          return;
        }
        const exp = Date.now() + (Number(resp.expires_in) || 3600) * 1000;
        await setSetting('drive_token', { token: resp.access_token, exp });
        resolve(resp.access_token);
      },
      error_callback: (err: any) => reject(new Error(err?.message || err?.type || 'Sign-in was cancelled')),
    });
    client.requestAccessToken();
  });
}

export async function connectDrive(): Promise<void> {
  const token = await requestAccessToken(true);
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const info = r.ok ? await r.json() : {};
  await setSetting('drive_connected', true);
  await setSetting('drive_email', info.email || '');
  setStatus({ connected: true, email: info.email || '', problem: null });
  await syncNow(true);
}

export async function disconnectDrive(): Promise<void> {
  const t = await getSetting<{ token: string } | null>('drive_token', null);
  try {
    if (t?.token) (window as any).google?.accounts?.oauth2?.revoke?.(t.token, () => {});
  } catch {
    /* ignore */
  }
  await setSetting('drive_token', null);
  await setSetting('drive_connected', false);
  await setSetting('drive_email', '');
  setStatus({ connected: false, email: '', problem: null });
}

export async function setAutoSync(v: boolean) {
  await setSetting('drive_auto_sync', v);
  setStatus({ autoSync: v });
}

export async function setDriveSize(v: DriveSize) {
  await setSetting('drive_size', v);
  setStatus({ size: v });
}

// ---------------------------------------------------------------- Drive REST helpers

class AuthError extends Error {}

async function api(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (r.status === 401) throw new AuthError('Sign in again');
  if (!r.ok) {
    let msg = `${r.status}`;
    try {
      const j = await r.json();
      msg = j?.error?.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(`Google Drive error: ${msg}`);
  }
  return r;
}

function q(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listAll(token: string, query: string): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,appProperties)',
      pageSize: '1000',
      spaces: 'drive',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const r = await api(token, `${DRIVE}/files?${params}`);
    const j = await r.json();
    out.push(...(j.files || []));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

async function findOrCreateFolder(token: string, name: string, parentId: string | null, create: boolean): Promise<string | null> {
  let query = `name = '${q(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  if (parentId) query += ` and '${parentId}' in parents`;
  const found = await listAll(token, query);
  if (found.length) return found[0].id;
  if (!create) return null;
  const body: any = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const r = await api(token, `${DRIVE}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await r.json()).id;
}

const enc = new TextEncoder();
/** Cut a value so key + value fit Drive's 124-byte appProperties limit (UTF-8). */
function fitProp(key: string, value: string): string {
  const max = 124 - enc.encode(key).length;
  let v = value;
  while (enc.encode(v).length > max) v = v.slice(0, -1);
  return v;
}

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function expiryToString(expiry: number | null): string {
  return expiry ? ymd(new Date(expiry)) : '';
}
function expiryFromString(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function driveFileName(docName: string): string {
  let n = (docName || '').replace(/[\\/:*?"<>|]/g, '_');
  n = Array.from(n).slice(0, 80).join('');
  if (!n.trim()) n = 'document';
  return `${n}.pdf`;
}

function appPropsFor(doc: DocumentRecord): Record<string, string> {
  const props: Record<string, string> = {
    docId: doc.docId,
    m: String(Math.trunc(doc.lastChanged)),
    created: String(Math.trunc(doc.created)),
    name: doc.name || '',
    folder: doc.folder || '',
    category: doc.category || '',
    expiry: expiryToString(doc.expiry),
    vault: doc.vault ? 'true' : 'false',
  };
  for (const k of Object.keys(props)) props[k] = fitProp(k, props[k]);
  return props;
}

function multipartBody(metadata: object, pdf: Uint8Array): { body: Blob; contentType: string } {
  const boundary = `phantom${Math.random().toString(36).slice(2)}`;
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
    pdf as BlobPart,
    `\r\n--${boundary}--`,
  ]);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

async function uploadDoc(token: string, doc: DocumentRecord, mainId: string, existingId: string | null, size: DriveSize) {
  const pdf = await buildDrivePdf(
    doc.pages.map((p) => p.dataUrl),
    size
  );
  const meta: any = { name: driveFileName(doc.name), appProperties: appPropsFor(doc) };
  if (existingId) {
    const { body, contentType } = multipartBody(meta, pdf);
    await api(token, `${UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`, {
      method: 'PATCH',
      headers: { 'Content-Type': contentType },
      body,
    });
  } else {
    meta.mimeType = 'application/pdf';
    meta.parents = [mainId];
    const { body, contentType } = multipartBody(meta, pdf);
    await api(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
  }
}

async function downloadDoc(token: string, file: DriveFile, existing?: DocumentRecord): Promise<DocumentRecord> {
  const r = await api(token, `${DRIVE}/files/${file.id}?alt=media`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let images = await extractJpegPages(bytes);
  if (!images.length) images = await renderPdfPages(bytes);
  const p = file.appProperties || {};
  const pages: DocumentPage[] = images.map((dataUrl, i) => ({
    id: crypto.randomUUID(),
    dataUrl,
    rotation: 0,
    label: `Page ${i + 1}`,
  }));
  const m = Number(p.m) || Date.now();
  return {
    docId: p.docId,
    name: p.name || file.name.replace(/\.pdf$/i, '') || 'document',
    folder: p.folder || '',
    category: p.category || existing?.category || '',
    expiry: expiryFromString(p.expiry),
    vault: p.vault === 'true',
    created: Number(p.created) || m,
    lastChanged: m,
    pages,
  };
}

// ---------------------------------------------------------------- the sync algorithm

let running: Promise<void> | null = null;
let onDocsUpdated: (() => void) | null = null;

export function setDocsUpdatedHandler(fn: () => void) {
  onDocsUpdated = fn;
}

/** Sync now. interactive=true when the user tapped a button (allows a Google sign-in window). */
export async function syncNow(interactive = false): Promise<void> {
  if (running) return running;
  running = (async () => {
    if (!status.connected) return;
    setStatus({ syncing: true });
    try {
      let token = await getStoredToken();
      if (!token) {
        if (!interactive) {
          setStatus({ problem: 'Sign in again: tap Sync Now' });
          return;
        }
        token = await requestAccessToken(true);
      }
      try {
        await runSync(token);
      } catch (e) {
        if (e instanceof AuthError && interactive) {
          token = await requestAccessToken(true);
          await runSync(token);
        } else throw e;
      }
      const now = Date.now();
      await setSetting('drive_last_synced', now);
      setStatus({ lastSynced: now, problem: null });
    } catch (e: any) {
      console.error('Drive sync failed', e);
      setStatus({ problem: e instanceof AuthError ? 'Sign in again: tap Sync Now' : e?.message || 'Sync failed' });
    } finally {
      setStatus({ syncing: false });
      running = null;
    }
  })();
  return running;
}

async function runSync(token: string) {
  const size = status.size;
  let changedLocal = false;

  const mainId = (await findOrCreateFolder(token, MAIN_FOLDER, null, true))!;

  // 1. List the main folder; ignore files without docId; remove app duplicates (keep larger m).
  const mainFiles = (await listAll(token, `'${mainId}' in parents and trashed = false and mimeType != '${FOLDER_MIME}'`)).filter(
    (f) => f.appProperties?.docId
  );
  const byDocId = new Map<string, DriveFile>();
  for (const f of mainFiles) {
    const id = f.appProperties!.docId;
    const prev = byDocId.get(id);
    if (!prev) {
      byDocId.set(id, f);
      continue;
    }
    const keep = Number(f.appProperties!.m || 0) > Number(prev.appProperties!.m || 0) ? f : prev;
    const drop = keep === f ? prev : f;
    await api(token, `${DRIVE}/files/${drop.id}`, { method: 'DELETE' });
    byDocId.set(id, keep);
  }

  // 2. Documents deleted on this device: move their PDF into Trash with today's date in front. Never delete.
  const deleted = await getDeletedDocs();
  let trashId: string | null = null;
  if (deleted.length) {
    for (const d of deleted) {
      const f = byDocId.get(d.docId);
      if (f) {
        if (!trashId) trashId = await findOrCreateFolder(token, TRASH_FOLDER, mainId, true);
        await api(token, `${DRIVE}/files/${f.id}?addParents=${trashId}&removeParents=${mainId}&fields=id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `${ymd(new Date())} · ${f.name}` }),
        });
        byDocId.delete(d.docId);
      }
      await removeDeletedDocRecord(d.docId);
    }
  }

  // 3. List the Trash folder the same way (the app never restores from it).
  if (!trashId) trashId = await findOrCreateFolder(token, TRASH_FOLDER, mainId, false);
  const trashByDocId = new Map<string, DriveFile>();
  if (trashId) {
    const trashFiles = await listAll(token, `'${trashId}' in parents and trashed = false`);
    for (const f of trashFiles) {
      const id = f.appProperties?.docId;
      if (!id) continue;
      const prev = trashByDocId.get(id);
      if (!prev || Number(f.appProperties!.m || 0) > Number(prev.appProperties!.m || 0)) trashByDocId.set(id, f);
    }
  }

  // 4. Each document on this device.
  const localDocs = await getAllDocuments();
  const localIds = new Set(localDocs.map((d) => d.docId));
  for (const doc of localDocs) {
    const f = byDocId.get(doc.docId);
    const local = Math.trunc(doc.lastChanged || 0);
    if (!f) {
      const t = trashByDocId.get(doc.docId);
      if (t && Number(t.appProperties!.m || 0) >= local) {
        // Deleted on another device: remove here too (it stays in Drive's Trash folder).
        await deleteDocumentLocalOnly(doc.docId);
        changedLocal = true;
      } else if (doc.pages?.length) {
        await uploadDoc(token, doc, mainId, null, size);
      }
      continue;
    }
    const m = Number(f.appProperties!.m || 0);
    if (local > m) {
      if (doc.pages?.length) await uploadDoc(token, doc, mainId, f.id, size);
    } else if (m > local) {
      const fresh = await downloadDoc(token, f, doc);
      await withoutChangeEvents(() => saveDocument(fresh));
      runBackgroundOcr(fresh.docId, () => onDocsUpdated?.(), false);
      changedLocal = true;
    }
  }

  // 5. Files in the main folder whose docId isn't on this device: new documents from another device.
  for (const [docId, f] of byDocId) {
    if (localIds.has(docId)) continue;
    const fresh = await downloadDoc(token, f);
    await withoutChangeEvents(() => saveDocument(fresh));
    runBackgroundOcr(fresh.docId, () => onDocsUpdated?.(), false);
    changedLocal = true;
  }

  if (changedLocal) onDocsUpdated?.();
}

// ---------------------------------------------------------------- startup + automatic sync

let autoTimer: number | null = null;

export async function initDriveSync(docsUpdated: () => void) {
  onDocsUpdated = docsUpdated;
  const connected = await getSetting<boolean>('drive_connected', false);
  setStatus({
    connected,
    email: await getSetting<string>('drive_email', ''),
    autoSync: await getSetting<boolean>('drive_auto_sync', true),
    size: await getSetting<DriveSize>('drive_size', 'standard'),
    lastSynced: await getSetting<number | null>('drive_last_synced', null),
  });

  window.addEventListener(DOCS_CHANGED_EVENT, () => {
    if (!status.connected || !status.autoSync) return;
    // Several changes in the next 5 minutes go up together.
    if (autoTimer !== null) return;
    autoTimer = window.setTimeout(() => {
      autoTimer = null;
      syncNow(false);
    }, AUTO_SYNC_DELAY_MS);
  });

  // Sync when the app opens (and again when it comes back after a long time).
  if (connected && status.autoSync) syncNow(false);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (status.connected && status.autoSync && hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000) syncNow(false);
  });
}

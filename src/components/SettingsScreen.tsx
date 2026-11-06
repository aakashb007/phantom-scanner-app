import React, { useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  Moon,
  Sun,
  Smartphone,
  Cloud,
  RefreshCw,
  LogOut,
  Download,
  Upload,
  Lock,
  Bell,
  Sparkles,
  PenTool,
  Wand2,
  Info,
  Trash2,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { IOSSegmentedControl } from './ui/IOSSegmentedControl';
import { IOSSwitch } from './ui/IOSSwitch';
import { IOSAlert } from './ui/IOSAlert';
import { ViewfinderIcon } from './ViewfinderIcon';
import { LockScreen } from './LockScreen';
import { SignaturesModal } from './SignaturesModal';
import { triggerHaptic } from '../utils/haptics';
import { usePWA } from '../hooks/usePWA';
import { getAllDocuments, saveDocument, deleteDocuments, getSetting, setSetting } from '../db/db';
import { DocumentRecord } from '../types/document';
import { GROQ_MODELS, DEFAULT_GROQ_MODEL } from '../utils/askAi';
import { isLockConfigured, clearPin, clearPasskey } from '../utils/security';
import {
  DriveStatus,
  subscribeDriveStatus,
  connectDrive,
  disconnectDrive,
  syncNow,
  setAutoSync,
  setDriveSize,
} from '../sync/driveSync';
import { GOOGLE_CLIENT_ID, APP_VERSION } from '../config';

interface SettingsScreenProps {
  onBack?: () => void;
  onRefreshDocs?: () => void;
}

const Section: React.FC<{ title: string; footer?: React.ReactNode; children: React.ReactNode }> = ({ title, footer, children }) => (
  <section>
    <h2 className="text-[13px] font-normal text-gray-500 dark:text-gray-400 uppercase px-4 mb-1.5">{title}</h2>
    <div className="bg-white dark:bg-[#1C1C1E] rounded-xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#38383A]">{children}</div>
    {footer && <p className="text-[12px] text-gray-500 dark:text-gray-400 px-4 mt-1.5 leading-snug">{footer}</p>}
  </section>
);

const Row: React.FC<{
  icon?: React.ElementType;
  iconBg?: string;
  label: React.ReactNode;
  detail?: React.ReactNode;
  right?: React.ReactNode;
  onClick?: () => void;
  danger?: boolean;
}> = ({ icon: Icon, iconBg = 'bg-[#5856D6]', label, detail, right, onClick, danger }) => {
  const Tag: any = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 min-h-[44px] text-left ${onClick ? 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ios-press' : ''}`}
    >
      {Icon && (
        <span className={`w-7 h-7 rounded-md ${iconBg} text-white flex items-center justify-center shrink-0`}>
          <Icon className="w-4 h-4" />
        </span>
      )}
      <span className="flex-1 min-w-0">
        <span className={`block text-[16px] ${danger ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{label}</span>
        {detail && <span className="block text-[12px] text-gray-500 dark:text-gray-400 truncate">{detail}</span>}
      </span>
      {right}
      {onClick && !right && <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />}
    </Tag>
  );
};

function timeAgo(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString();
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onRefreshDocs }) => {
  const { themeMode, setThemeMode } = useTheme();
  const { isStandalone, isIOS, isInstallable, installDesktopOrAndroid } = usePWA();
  const [drive, setDrive] = useState<DriveStatus | null>(null);
  const [driveError, setDriveError] = useState('');
  const [groqKey, setGroqKey] = useState('');
  const [groqSavedKey, setGroqSavedKey] = useState('');
  const [groqModel, setGroqModel] = useState(DEFAULT_GROQ_MODEL);
  const [smartNaming, setSmartNaming] = useState(true);
  const [appLock, setAppLock] = useState(false);
  const [expiryReminders, setExpiryReminders] = useState(true);
  const [lockSetup, setLockSetup] = useState(false);
  const [showSignatures, setShowSignatures] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const restoreRef = useRef<HTMLInputElement>(null);

  const say = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => subscribeDriveStatus(setDrive), []);
  useEffect(() => {
    (async () => {
      const k = await getSetting<string>('groq_api_key', '');
      setGroqKey(k);
      setGroqSavedKey(k);
      setGroqModel(await getSetting<string>('groq_model', DEFAULT_GROQ_MODEL));
      setSmartNaming(await getSetting<boolean>('smart_naming', true));
      setAppLock(await getSetting<boolean>('app_lock', false));
      setExpiryReminders(await getSetting<boolean>('expiry_reminders', true));
    })();
  }, []);

  // ---------------- Google Drive
  const onConnect = async () => {
    setDriveError('');
    try {
      await connectDrive();
      triggerHaptic('success');
    } catch (e: any) {
      setDriveError(e?.message || 'Could not connect');
    }
  };

  // ---------------- Backup file (one zip)
  const saveBackup = async () => {
    const docs = await getAllDocuments();
    const zip = new JSZip();
    zip.file('phantom-scanner-backup.json', JSON.stringify({ app: 'Phantom Scanner', version: APP_VERSION, documents: docs }));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const d = new Date();
    const name = `Phantom Scanner backup ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;
    const file = new File([blob], name, { type: 'application/zip' });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: name });
        return;
      } catch {
        /* fall back to download */
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    say(`Backup saved: ${docs.length} documents`);
  };

  const restoreBackup = async (f?: File) => {
    if (!f) return;
    try {
      let json: any;
      if (f.name.toLowerCase().endsWith('.zip')) {
        const zip = await JSZip.loadAsync(f);
        const entry = zip.file('phantom-scanner-backup.json');
        if (!entry) throw new Error('Not a Phantom Scanner backup');
        json = JSON.parse(await entry.async('string'));
      } else json = JSON.parse(await f.text());
      const docs: DocumentRecord[] = Array.isArray(json) ? json : json.documents || [];
      const existing = new Map((await getAllDocuments()).map((d) => [d.docId, d]));
      let n = 0;
      for (const d of docs) {
        if (!d?.docId || !Array.isArray(d.pages)) continue;
        const cur = existing.get(d.docId);
        if (cur && cur.lastChanged >= d.lastChanged) continue; // keep the newer copy
        await saveDocument(d);
        n++;
      }
      triggerHaptic('success');
      onRefreshDocs?.();
      say(`Restored ${n} documents`);
    } catch (e: any) {
      say(e?.message || 'Could not read the backup file');
    }
  };

  // ---------------- Privacy
  const toggleAppLock = async (v: boolean) => {
    if (v && !(await isLockConfigured())) {
      setLockSetup(true);
      return;
    }
    setAppLock(v);
    await setSetting('app_lock', v);
  };

  const resetLock = async () => {
    await clearPin();
    await clearPasskey();
    setLockSetup(true);
  };

  // ---------------- Groq
  const saveGroq = async () => {
    await setSetting('groq_api_key', groqKey.trim());
    setGroqSavedKey(groqKey.trim());
    triggerHaptic('success');
    say(groqKey.trim() ? 'Groq key saved. ✨ Ask AI is on.' : 'Groq key removed. Ask AI is hidden.');
    onRefreshDocs?.();
  };

  const clearAll = async () => {
    const docs = await getAllDocuments();
    await deleteDocuments(docs.map((d) => d.docId));
    setShowClearConfirm(false);
    onRefreshDocs?.();
    say('All documents deleted');
  };

  const driveStatusLine = !drive
    ? ''
    : drive.syncing
    ? 'Syncing…'
    : drive.problem
    ? drive.problem
    : drive.lastSynced
    ? `Last synced ${timeAgo(drive.lastSynced)}`
    : 'Not synced yet';

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-28 max-w-2xl mx-auto w-full px-4 sm:px-6 pt-4 space-y-7 select-none">
      <h1 className="text-[34px] font-bold tracking-tight text-gray-900 dark:text-white">Settings</h1>
      {toast && (
        <div className="fixed top-4 inset-x-4 mt-safe max-w-sm mx-auto z-50 bg-[#1C1C1E]/95 text-white text-sm font-medium px-4 py-2.5 rounded-full shadow-2xl text-center">
          {toast}
        </div>
      )}

      {/* GOOGLE DRIVE */}
      <Section
        title="Google Drive"
        footer={
          drive?.connected
            ? 'Each document is kept as one PDF in "Phantom Scanner" in your own Drive. Deleted documents move to "Phantom Scanner/Trash"; empty it yourself. Use the same Gmail on Android, iPhone and computer.'
            : 'Sync with your own Google Drive, shared with the Android app. Only files this app creates are visible to it.'
        }
      >
        {!drive?.connected ? (
          <Row icon={Cloud} iconBg="bg-[#34A853]" label="Connect Google Drive" detail={driveError || (GOOGLE_CLIENT_ID ? undefined : 'Not set up yet')} onClick={onConnect} />
        ) : (
          <>
            <Row icon={Cloud} iconBg="bg-[#34A853]" label="Account" detail={drive.email || 'Connected'} />
            <Row
              icon={RefreshCw}
              iconBg="bg-[#007AFF]"
              label="Sync Now"
              detail={driveStatusLine}
              onClick={() => syncNow(true)}
              right={drive.syncing ? <RefreshCw className="w-4 h-4 text-gray-400 animate-spin" /> : undefined}
            />
            <Row label="Auto Sync" detail="About 5 minutes after changes, and when the app opens" right={<IOSSwitch checked={drive.autoSync} onChange={setAutoSync} />} />
            <div className="px-4 py-3 space-y-2">
              <span className="block text-[16px] text-gray-900 dark:text-white">Size in Drive</span>
              <IOSSegmentedControl
                size="sm"
                value={drive.size}
                onChange={setDriveSize}
                options={[
                  { value: 'small', label: 'Small' },
                  { value: 'standard', label: 'Standard' },
                  { value: 'hd', label: 'HD' },
                ]}
              />
            </div>
            <Row icon={LogOut} iconBg="bg-gray-500" label="Disconnect" danger onClick={disconnectDrive} />
          </>
        )}
      </Section>

      {/* BACKUP FILE */}
      <Section title="Backup file" footer="One zip file with all documents. In the file picker you can choose iCloud Drive or Google Drive.">
        <Row icon={Download} iconBg="bg-[#5856D6]" label="Save Backup File…" onClick={saveBackup} />
        <Row icon={Upload} iconBg="bg-[#5856D6]" label="Restore from Backup File…" onClick={() => restoreRef.current?.click()} />
        <input ref={restoreRef} type="file" accept=".zip,.json,application/zip,application/json" className="hidden" onChange={(e) => { restoreBackup(e.target.files?.[0]); e.target.value = ''; }} />
      </Section>

      {/* PRIVACY */}
      <Section title="Privacy" footer="App Lock asks for Face ID, fingerprint or your PIN when the app opens, and again after a minute away.">
        <Row icon={Lock} iconBg="bg-[#FF3B30]" label="App Lock" right={<IOSSwitch checked={appLock} onChange={toggleAppLock} />} />
        <Row icon={ShieldCheck} iconBg="bg-gray-500" label="Change PIN / Face ID" onClick={resetLock} />
        <Row
          icon={Bell}
          iconBg="bg-[#FF9500]"
          label="Expiry Reminders"
          detail="Shown on the home screen 30 days and 7 days before, and on the day"
          right={<IOSSwitch checked={expiryReminders} onChange={async (v) => { setExpiryReminders(v); await setSetting('expiry_reminders', v); onRefreshDocs?.(); }} />}
        />
      </Section>

      {/* GROQ AI */}
      <Section
        title="Groq AI"
        footer={
          <>
            Used only for ✨ Ask AI. Get a free key at console.groq.com → API Keys, and paste it here. It is stored only in this browser. Vault
            documents are never sent.
          </>
        }
      >
        <Row icon={Sparkles} iconBg="bg-[#FF9500]" label="Status" detail={groqSavedKey ? 'Your own key · no daily limit from this app' : 'No key yet · Ask AI is hidden'} />
        <div className="px-4 py-3 flex items-center gap-2">
          <input
            type="password"
            value={groqKey}
            onChange={(e) => setGroqKey(e.target.value)}
            placeholder="Paste your Groq key (gsk_…)"
            autoComplete="off"
            className="flex-1 min-w-0 bg-black/5 dark:bg-white/10 rounded-lg px-3 py-2 text-base font-mono focus:outline-none focus:ring-2 focus:ring-[#5856D6]"
          />
          <button onClick={saveGroq} className="px-4 py-2 rounded-lg bg-[#5856D6] text-white text-sm font-semibold ios-press">
            Save
          </button>
        </div>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[16px] text-gray-900 dark:text-white">Model</span>
          <select
            value={groqModel}
            onChange={async (e) => { setGroqModel(e.target.value); await setSetting('groq_model', e.target.value); }}
            className="bg-transparent text-right text-base text-gray-500 dark:text-gray-400 focus:outline-none max-w-[60%]"
          >
            {GROQ_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
      </Section>

      {/* AI & SCANNING */}
      <Section title="AI & Scanning">
        <Row icon={Wand2} iconBg="bg-[#AF52DE]" label="Smart Naming" detail="Name new scans from their first line of text" right={<IOSSwitch checked={smartNaming} onChange={async (v) => { setSmartNaming(v); await setSetting('smart_naming', v); }} />} />
        <Row icon={PenTool} iconBg="bg-[#34C759]" label="Signatures" onClick={() => setShowSignatures(true)} />
      </Section>

      {/* APPEARANCE */}
      <Section title="Appearance">
        <div className="px-4 py-3">
          <IOSSegmentedControl
            value={themeMode}
            onChange={(v) => setThemeMode(v)}
            options={[
              { value: 'system', label: <span className="flex items-center gap-1.5"><Smartphone className="w-3.5 h-3.5" />System</span> },
              { value: 'light', label: <span className="flex items-center gap-1.5"><Sun className="w-3.5 h-3.5" />Light</span> },
              { value: 'dark', label: <span className="flex items-center gap-1.5"><Moon className="w-3.5 h-3.5" />Dark</span> },
            ]}
          />
        </div>
      </Section>

      {/* INSTALL */}
      {!isStandalone && (isInstallable || isIOS) && (
        <Section title="Install" footer={isIOS ? 'In Safari: tap Share → Add to Home Screen → Add.' : undefined}>
          {isInstallable ? (
            <Row icon={Download} iconBg="bg-[#5856D6]" label="Install Phantom Scanner as an app" onClick={installDesktopOrAndroid} />
          ) : (
            <Row icon={Smartphone} iconBg="bg-[#5856D6]" label="Add to Home Screen" detail="Opens full screen, like a normal app" />
          )}
        </Section>
      )}

      {/* ABOUT + PRIVACY PROMISES */}
      <Section title="About">
        <div className="flex items-center gap-3 px-4 py-3">
          <ViewfinderIcon className="w-12 h-12 rounded-xl" />
          <div>
            <p className="text-[17px] font-semibold text-gray-900 dark:text-white">Phantom Scanner</p>
            <p className="text-xs text-gray-500">Version {APP_VERSION} · Built by Aakash Saleem</p>
          </div>
        </div>
        <div className="px-4 py-3 text-[13px] text-gray-600 dark:text-gray-300 space-y-1.5">
          <p className="flex gap-2"><Info className="w-4 h-4 shrink-0 text-[#5856D6]" />Scans, OCR text, signatures and settings stay in this browser on your device.</p>
          <p className="flex gap-2"><Info className="w-4 h-4 shrink-0 text-[#5856D6]" />Documents leave the device only when you share them, sync them to your own Google Drive, or ask Ask AI a question.</p>
          <p className="flex gap-2"><Info className="w-4 h-4 shrink-0 text-[#5856D6]" />No ads, no analytics, no trackers. The developer never receives your documents.</p>
        </div>
      </Section>

      <Section title="Storage">
        <Row icon={Trash2} iconBg="bg-[#FF3B30]" label="Delete All Documents" danger onClick={() => setShowClearConfirm(true)} />
      </Section>

      <IOSAlert
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Delete all documents?"
        description="They are removed from this device. With Google Drive connected, their PDFs move to Phantom Scanner/Trash on the next sync."
        buttons={[
          { label: 'Cancel', variant: 'cancel', onClick: () => setShowClearConfirm(false) },
          { label: 'Delete All', variant: 'destructive', onClick: clearAll },
        ]}
      />

      {lockSetup && (
        <LockScreen
          fullScreen
          title="App Lock"
          onUnlock={async () => {
            setLockSetup(false);
            setAppLock(true);
            await setSetting('app_lock', true);
            say('App Lock is on');
          }}
          onCancel={() => setLockSetup(false)}
        />
      )}
      <SignaturesModal isOpen={showSignatures} onClose={() => setShowSignatures(false)} />
    </div>
  );
};

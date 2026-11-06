import React, { useState, useEffect } from 'react';
import {
  Moon,
  Sun,
  Smartphone,
  Info,
  ShieldCheck,
  Download,
  Upload,
  Trash2,
  Share2,
  HardDrive,
  CheckCircle,
  ExternalLink,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { IOSSegmentedControl } from './ui/IOSSegmentedControl';
import { ViewfinderIcon } from './ViewfinderIcon';
import { triggerHaptic } from '../utils/haptics';
import { usePWA } from '../hooks/usePWA';
import { getAllDocuments, saveDocument, deleteDocuments, getSetting, setSetting } from '../db/db';
import { DocumentRecord } from '../types/document';
import { IOSAlert } from './ui/IOSAlert';
import { IOSSwitch } from './ui/IOSSwitch';

interface SettingsScreenProps {
  onBack?: () => void;
  onRefreshDocs?: () => void;
}

export const SettingsScreen: React.FC<SettingsScreenProps> = ({ onRefreshDocs }) => {
  const { themeMode, setThemeMode } = useTheme();
  const { isStandalone, isIOS, isInstallable, installDesktopOrAndroid } = usePWA();
  const [docCount, setDocCount] = useState<number>(0);
  const [totalPageCount, setTotalPageCount] = useState<number>(0);
  const [showClearConfirm, setShowClearConfirm] = useState<boolean>(false);
  const [showIOSInstallGuide, setShowIOSInstallGuide] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [groqKey, setGroqKey] = useState<string>('');
  const [isGroqSaved, setIsGroqSaved] = useState<boolean>(false);
  const [smartNaming, setSmartNaming] = useState<boolean>(true);

  const refreshStats = async () => {
    const docs = await getAllDocuments();
    setDocCount(docs.length);
    const pages = docs.reduce((acc, d) => acc + (d.pages?.length || 0), 0);
    setTotalPageCount(pages);
    const savedGroq = await getSetting<string>('groq_api_key', '');
    setGroqKey(savedGroq);
    const savedSmartNaming = await getSetting<boolean>('smart_naming', true);
    setSmartNaming(savedSmartNaming);
  };

  const handleToggleSmartNaming = async (val: boolean) => {
    setSmartNaming(val);
    await setSetting('smart_naming', val);
    triggerHaptic('light');
  };

  useEffect(() => {
    refreshStats();
  }, []);

  const handleSaveGroqKey = async () => {
    triggerHaptic('success');
    await setSetting('groq_api_key', groqKey.trim());
    setIsGroqSaved(true);
    setStatusMessage(groqKey.trim() ? 'Groq Key saved! ✨ Ask AI unlocked.' : 'Groq Key cleared.');
    setTimeout(() => {
      setIsGroqSaved(false);
      setStatusMessage(null);
    }, 3000);
    if (onRefreshDocs) onRefreshDocs();
  };

  const handleExportBackup = async () => {
    triggerHaptic('light');
    const docs = await getAllDocuments();
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(docs, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `phantom_scanner_backup_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();

    setStatusMessage('Backup exported successfully');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const json = JSON.parse(evt.target?.result as string);
        if (Array.isArray(json)) {
          for (const item of json) {
            if (item.docId && item.name) {
              await saveDocument(item as DocumentRecord);
            }
          }
          triggerHaptic('success');
          await refreshStats();
          if (onRefreshDocs) onRefreshDocs();
          setStatusMessage(`Restored ${json.length} documents`);
          setTimeout(() => setStatusMessage(null), 3000);
        }
      } catch (err) {
        alert('Invalid backup JSON file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearAll = async () => {
    const docs = await getAllDocuments();
    await deleteDocuments(docs.map((d) => d.docId));
    triggerHaptic('warning');
    setShowClearConfirm(false);
    await refreshStats();
    if (onRefreshDocs) onRefreshDocs();
    setStatusMessage('All documents cleared');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-24 max-w-3xl mx-auto w-full p-4 sm:p-6 space-y-6 select-none">
      {/* Toast Notification */}
      {statusMessage && (
        <div className="flex items-center gap-2 p-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 rounded-2xl text-sm font-medium animate-in fade-in">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* SECTION 1: APPEARANCE */}
      <div>
        <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
          Appearance
        </h2>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[15px] font-medium text-gray-900 dark:text-white">Theme</span>
            <span className="text-xs text-gray-400 capitalize">{themeMode}</span>
          </div>

          <IOSSegmentedControl
            value={themeMode}
            onChange={(val) => setThemeMode(val)}
            options={[
              {
                value: 'system',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>System</span>
                  </span>
                ),
              },
              {
                value: 'light',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </span>
                ),
              },
              {
                value: 'dark',
                label: (
                  <span className="flex items-center gap-1.5">
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </span>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* SECTION: SCANNER PREFERENCES */}
      <div>
        <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
          Scanner Preferences
        </h2>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E]">
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <span className="text-[15px] font-medium text-gray-900 dark:text-white block">
                Smart Document Naming
              </span>
              <p className="text-xs text-gray-400 mt-0.5">
                Automatically name new scans from the title-like first line of OCR text instead of &quot;Scan date time&quot;.
              </p>
            </div>
            <IOSSwitch checked={smartNaming} onChange={handleToggleSmartNaming} />
          </div>
        </div>
      </div>

      {/* SECTION 2: AI INTEGRATION (OPTIONAL GROQ KEY) */}
      <div>
        <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
          AI Features (Optional)
        </h2>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E] space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-[15px] font-medium text-gray-900 dark:text-white block">
                ✨ Ask AI Integration
              </span>
              <p className="text-xs text-gray-400 mt-0.5">
                Provide a Groq API key to unlock the Ask AI smart document queries button.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="password"
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              className="flex-1 bg-black/5 dark:bg-white/10 text-gray-900 dark:text-white px-3 py-2 rounded-xl text-xs font-mono border border-gray-200 dark:border-white/10 focus:outline-none focus:border-[#5856D6]"
            />
            <button
              onClick={handleSaveGroqKey}
              className="ios-press px-4 py-2 rounded-xl bg-[#5856D6] text-white text-xs font-semibold shadow-xs hover:bg-[#6866E6]"
            >
              {isGroqSaved ? 'Saved' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 2: WEB APP / INSTALLATION */}
      {!isStandalone && (
        <div>
          <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
            Home Screen & Installation
          </h2>
          <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-4 shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E]">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">
                  Install Phantom Scanner
                </h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                  Run edge-to-edge with no browser bars and full offline capability on iPhone, iPad,
                  Mac, or PC.
                </p>

                <div className="mt-3">
                  {isIOS ? (
                    <button
                      onClick={() => setShowIOSInstallGuide(true)}
                      className="ios-press px-4 py-2 rounded-xl bg-[#5856D6] text-white text-xs font-semibold shadow-xs"
                    >
                      Show iPhone Safari Instructions
                    </button>
                  ) : isInstallable ? (
                    <button
                      onClick={installDesktopOrAndroid}
                      className="ios-press px-4 py-2 rounded-xl bg-[#5856D6] text-white text-xs font-semibold shadow-xs"
                    >
                      Install Desktop App
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 italic">
                      Use browser menu → &quot;Install app&quot; or &quot;Add to Home Screen&quot;.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 3: LOCAL STORAGE & DATA */}
      <div>
        <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
          Local Storage & Privacy
        </h2>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E] divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E]">
          {/* Storage stats */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gray-100 dark:bg-white/10 text-gray-600 dark:text-gray-300">
                <HardDrive className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[15px] font-medium text-gray-900 dark:text-white block">
                  Browser IndexedDB
                </span>
                <span className="text-xs text-gray-400">100% private on this device</span>
              </div>
            </div>
            <div className="text-right">
              <span className="text-sm font-semibold text-gray-900 dark:text-white block">
                {docCount} docs
              </span>
              <span className="text-xs text-gray-400">{totalPageCount} pages</span>
            </div>
          </div>

          {/* Backup Export */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF]">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[15px] font-medium text-gray-900 dark:text-white block">
                  Export Backup
                </span>
                <span className="text-xs text-gray-400">Save all documents as a JSON file</span>
              </div>
            </div>
            <button
              onClick={handleExportBackup}
              className="ios-press px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-xs font-medium text-gray-800 dark:text-gray-200"
            >
              Export
            </button>
          </div>

          {/* Backup Import */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-500/10 text-blue-500">
                <Upload className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[15px] font-medium text-gray-900 dark:text-white block">
                  Restore Backup
                </span>
                <span className="text-xs text-gray-400">Load previously exported documents</span>
              </div>
            </div>
            <label className="ios-press px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/10 hover:bg-gray-200 dark:hover:bg-white/20 text-xs font-medium text-gray-800 dark:text-gray-200 cursor-pointer">
              Restore
              <input
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>
          </div>

          {/* Delete All Data */}
          <div className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-500/10 text-red-500">
                <Trash2 className="w-4 h-4" />
              </div>
              <div>
                <span className="text-[15px] font-medium text-red-600 dark:text-red-400 block">
                  Clear Database
                </span>
                <span className="text-xs text-gray-400">Delete all local records & cache</span>
              </div>
            </div>
            <button
              onClick={() => {
                triggerHaptic('warning');
                setShowClearConfirm(true);
              }}
              className="ios-press px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs font-medium text-red-600 dark:text-red-400"
            >
              Reset
            </button>
          </div>
        </div>
      </div>

      {/* SECTION 4: ABOUT PHANTOM SCANNER */}
      <div>
        <h2 className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider px-3 mb-2">
          About
        </h2>
        <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl p-5 shadow-xs border border-[#E5E5EA] dark:border-[#2C2C2E] text-center flex flex-col items-center">
          <ViewfinderIcon size={64} rounded="rounded-2xl" className="mb-3" />

          <h3 className="text-[18px] font-bold text-gray-900 dark:text-white">
            Phantom Scanner
          </h3>
          <p className="text-xs font-medium text-[#5856D6] dark:text-[#7D7AFF] mt-0.5">
            Version 1.7.3
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-medium">
            Built by Aakash Saleem
          </p>

          <div className="mt-4 pt-4 border-t border-[#E5E5EA] dark:border-[#2C2C2E] w-full text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
            <div className="flex items-center justify-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Zero-Server Private Storage</span>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              No telemetry. No account required. All scans, vault files, and records remain entirely on your device.
            </p>
          </div>
        </div>
      </div>

      {/* Clear Confirmation Alert */}
      <IOSAlert
        isOpen={showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Clear All Documents?"
        description="This will permanently remove all scanned pages and vault files from this browser. This cannot be undone."
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setShowClearConfirm(false),
            variant: 'cancel',
          },
          {
            label: 'Delete All',
            onClick: handleClearAll,
            variant: 'destructive',
            isBold: true,
          },
        ]}
      />

      {/* iOS Safari Guide Alert */}
      <IOSAlert
        isOpen={showIOSInstallGuide}
        onClose={() => setShowIOSInstallGuide(false)}
        title="Add to Home Screen"
        description="To install Phantom Scanner on your iPhone:"
        buttons={[
          {
            label: 'Done',
            onClick: () => setShowIOSInstallGuide(false),
            variant: 'default',
            isBold: true,
          },
        ]}
      >
        <div className="space-y-2 text-xs text-gray-600 dark:text-gray-300 py-1">
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#5856D6] text-white flex items-center justify-center font-bold text-[10px]">
              1
            </span>
            <span>Tap the <strong>Share</strong> button in Safari toolbar.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#5856D6] text-white flex items-center justify-center font-bold text-[10px]">
              2
            </span>
            <span>Scroll down and select <strong>Add to Home Screen</strong>.</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-5 h-5 rounded-full bg-[#5856D6] text-white flex items-center justify-center font-bold text-[10px]">
              3
            </span>
            <span>Tap <strong>Add</strong> in the top right corner.</span>
          </div>
        </div>
      </IOSAlert>
    </div>
  );
};

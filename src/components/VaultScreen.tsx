import React, { useState } from 'react';
import { Lock, Unlock, Shield, KeyRound, Plus, FileText } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { DocumentCard } from './DocumentCard';
import { triggerHaptic } from '../utils/haptics';

interface VaultScreenProps {
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
  onContextMenu: (e: React.MouseEvent, doc: DocumentRecord) => void;
  onScanToVault: () => void;
}

export const VaultScreen: React.FC<VaultScreenProps> = ({
  documents,
  onOpenDocument,
  onContextMenu,
  onScanToVault,
}) => {
  const [isUnlocked, setIsUnlocked] = useState<boolean>(true);
  const vaultDocs = documents.filter((d) => d.vault);

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-24 p-4 sm:p-6 select-none">
      {/* Vault Header Card */}
      <div className="bg-gradient-to-r from-amber-500/15 to-orange-500/10 dark:from-amber-500/20 dark:to-orange-500/15 border border-amber-500/30 rounded-2xl p-4 sm:p-5 mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Lock className="w-6 h-6 stroke-[2]" />
          </div>
          <div>
            <h3 className="text-[17px] font-bold text-gray-900 dark:text-white flex items-center gap-2">
              <span>Secure Vault</span>
              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-semibold">
                {vaultDocs.length} items
              </span>
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Confidential records and identity cards stored exclusively on your device.
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            triggerHaptic('light');
            onScanToVault();
          }}
          className="ios-press hidden sm:flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 text-white text-xs font-semibold shadow-xs hover:bg-amber-600"
        >
          <Plus className="w-4 h-4" />
          <span>Add to Vault</span>
        </button>
      </div>

      {vaultDocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-16 px-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center mb-3">
            <Lock className="w-8 h-8" />
          </div>
          <h4 className="text-base font-semibold text-gray-800 dark:text-gray-200">
            Your Vault is Empty
          </h4>
          <p className="text-xs text-gray-500 dark:text-gray-400 max-w-sm mt-1 mb-5">
            Keep sensitive documents like passports, tax records, and medical cards in your private vault.
          </p>
          <button
            onClick={onScanToVault}
            className="ios-press flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#5856D6] text-white text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Scan to Vault</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
          {vaultDocs.map((doc) => (
            <DocumentCard
              key={doc.docId}
              document={doc}
              onClick={() => onOpenDocument(doc)}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  );
};

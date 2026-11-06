import React, { useState } from 'react';
import { Folder, FolderPlus, ChevronRight, FileText, ArrowLeft } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { DocumentCard } from './DocumentCard';
import { triggerHaptic } from '../utils/haptics';
import { IOSAlert } from './ui/IOSAlert';

interface FoldersScreenProps {
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
  onContextMenu: (e: React.MouseEvent, doc: DocumentRecord) => void;
  onScanInFolder: (folderName: string) => void;
}

export const FoldersScreen: React.FC<FoldersScreenProps> = ({
  documents,
  onOpenDocument,
  onContextMenu,
  onScanInFolder,
}) => {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [customFolders, setCustomFolders] = useState<string[]>(['Personal', 'Work', 'Finance', 'Medical']);

  // Extract all existing folders from documents + defaults
  const allFolders = Array.from(
    new Set(['Default', ...customFolders, ...documents.map((d) => d.folder || 'Default')])
  );

  const getFolderCount = (f: string) => documents.filter((d) => (d.folder || 'Default') === f).length;

  const handleCreateFolder = () => {
    if (newFolderName.trim() && !customFolders.includes(newFolderName.trim())) {
      setCustomFolders((prev) => [...prev, newFolderName.trim()]);
      setNewFolderName('');
      setIsNewFolderOpen(false);
      triggerHaptic('success');
    }
  };

  if (selectedFolder) {
    const folderDocs = documents.filter((d) => (d.folder || 'Default') === selectedFolder);
    return (
      <div className="flex-1 overflow-y-auto ios-scroll pb-24 p-4 sm:p-6 select-none">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => {
              triggerHaptic('light');
              setSelectedFolder(null);
            }}
            className="ios-press flex items-center gap-1 text-[#5856D6] dark:text-[#7D7AFF] font-medium text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>All Folders</span>
          </button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {folderDocs.length} {folderDocs.length === 1 ? 'document' : 'documents'}
          </span>
        </div>

        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Folder className="w-5 h-5 text-[#5856D6] dark:text-[#7D7AFF]" />
          <span>{selectedFolder}</span>
        </h2>

        {folderDocs.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-sm">No documents in this folder.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
            {folderDocs.map((doc) => (
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
  }

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-24 p-4 sm:p-6 select-none max-w-3xl mx-auto w-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Folders</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Organize documents into categorized folders
          </p>
        </div>
        <button
          onClick={() => {
            triggerHaptic('light');
            setIsNewFolderOpen(true);
          }}
          className="ios-press flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] text-xs font-semibold hover:bg-[#5856D6]/20"
        >
          <FolderPlus className="w-4 h-4" />
          <span>New Folder</span>
        </button>
      </div>

      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl border border-[#E5E5EA] dark:border-[#2C2C2E] shadow-xs divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E]">
        {allFolders.map((f) => {
          const count = getFolderCount(f);
          return (
            <div
              key={f}
              onClick={() => {
                triggerHaptic('light');
                setSelectedFolder(f);
              }}
              className="p-4 flex items-center justify-between hover:bg-black/2 dark:hover:bg-white/5 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#5856D6]/10 text-[#5856D6] dark:text-[#7D7AFF] flex items-center justify-center">
                  <Folder className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-[15px] font-semibold text-gray-900 dark:text-white">{f}</h4>
                  <span className="text-xs text-gray-400">
                    {count} {count === 1 ? 'file' : 'files'}
                  </span>
                </div>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </div>
          );
        })}
      </div>

      <IOSAlert
        isOpen={isNewFolderOpen}
        onClose={() => setIsNewFolderOpen(false)}
        title="New Folder"
        description="Enter a name for this folder:"
        buttons={[
          {
            label: 'Cancel',
            onClick: () => setIsNewFolderOpen(false),
            variant: 'cancel',
          },
          {
            label: 'Create',
            onClick: handleCreateFolder,
            variant: 'default',
            isBold: true,
          },
        ]}
      >
        <input
          type="text"
          autoFocus
          value={newFolderName}
          onChange={(e) => setNewFolderName(e.target.value)}
          placeholder="Folder name..."
          className="w-full mt-2 px-3 py-2 rounded-lg bg-black/5 dark:bg-white/10 border border-gray-300 dark:border-white/15 text-sm text-gray-900 dark:text-white focus:outline-none focus:border-[#5856D6]"
        />
      </IOSAlert>
    </div>
  );
};

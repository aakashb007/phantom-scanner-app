import React, { useState } from 'react';
import { UserSquare, FileCog, Layers, Lock, PenTool, ChevronRight } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { triggerHaptic } from '../utils/haptics';
import { PassportPhotoModal } from './PassportPhotoModal';
import { MergePdfsModal } from './MergePdfsModal';
import { SignaturesModal } from './SignaturesModal';

interface ToolsScreenProps {
  documents: DocumentRecord[];
  onOpenDocument: (doc: DocumentRecord) => void;
  /** Opens the Files sheet so the user can pick a PDF and use the viewer's Tools. */
  onOpenPdfToolkit: () => void;
  onOpenVault: () => void;
}

export const ToolsScreen: React.FC<ToolsScreenProps> = ({ onOpenPdfToolkit, onOpenVault }) => {
  const [open, setOpen] = useState<'passport' | 'merge' | 'signatures' | null>(null);

  const tools = [
    {
      key: 'passport',
      icon: UserSquare,
      color: 'bg-sky-500',
      title: 'Passport Photo Maker',
      text: 'Background removed automatically. 35×45 mm, 2×2 in, 33×48 mm, 4×6 print sheet.',
      action: () => setOpen('passport'),
    },
    {
      key: 'toolkit',
      icon: FileCog,
      color: 'bg-red-500',
      title: 'PDF Toolkit',
      text: 'Open a PDF to compress, extract pages, rotate, merge or save pages as images.',
      action: onOpenPdfToolkit,
    },
    {
      key: 'merge',
      icon: Layers,
      color: 'bg-purple-500',
      title: 'Merge PDFs',
      text: 'Join PDFs in your order. Text stays sharp.',
      action: () => setOpen('merge'),
    },
    {
      key: 'vault',
      icon: Lock,
      color: 'bg-amber-500',
      title: 'Phantom Vault',
      text: 'Hidden from the list, search and AI. Opens with Face ID, fingerprint or your PIN.',
      action: onOpenVault,
    },
    {
      key: 'signatures',
      icon: PenTool,
      color: 'bg-emerald-500',
      title: 'Signatures',
      text: 'Draw one, or photograph one on paper. Used by the Sign tool.',
      action: () => setOpen('signatures'),
    },
  ];

  return (
    <div className="flex-1 overflow-y-auto ios-scroll pb-28 p-4 sm:p-6 select-none max-w-3xl mx-auto w-full">
      <h1 className="text-[34px] font-bold tracking-tight text-gray-900 dark:text-white mb-4">Tools</h1>
      <div className="bg-white dark:bg-[#1C1C1E] rounded-2xl overflow-hidden divide-y divide-[#E5E5EA] dark:divide-[#2C2C2E]">
        {tools.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              triggerHaptic('light');
              t.action();
            }}
            className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04] ios-press"
          >
            <span className={`w-10 h-10 rounded-xl ${t.color} text-white flex items-center justify-center shrink-0`}>
              <t.icon className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[16px] font-semibold text-gray-900 dark:text-white">{t.title}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.text}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
          </button>
        ))}
      </div>

      <PassportPhotoModal isOpen={open === 'passport'} onClose={() => setOpen(null)} />
      <MergePdfsModal isOpen={open === 'merge'} onClose={() => setOpen(null)} />
      <SignaturesModal isOpen={open === 'signatures'} onClose={() => setOpen(null)} />
    </div>
  );
};

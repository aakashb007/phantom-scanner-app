import React, { useRef, useState } from 'react';
import { PDFDocument } from 'pdf-lib';
import { X, Plus, ArrowUp, ArrowDown, Trash2, Loader2, Layers } from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';
import { shareOrDownloadFiles } from '../utils/exportEngine';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

/** Joins PDFs by copying their pages (text stays sharp, nothing is turned into images). */
export const MergePdfsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const add = (list: FileList | null) => {
    if (!list) return;
    setFiles((f) => [...f, ...Array.from(list).filter((x) => x.type === 'application/pdf' || x.name.toLowerCase().endsWith('.pdf'))]);
  };
  const move = (i: number, d: number) =>
    setFiles((f) => {
      const n = [...f];
      const j = i + d;
      if (j < 0 || j >= n.length) return f;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const merge = async () => {
    setBusy(true);
    setError('');
    try {
      const out = await PDFDocument.create();
      for (const f of files) {
        const src = await PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
      }
      const bytes = await out.save();
      const name = `${files[0].name.replace(/\.pdf$/i, '')} (merged).pdf`;
      triggerHaptic('success');
      await shareOrDownloadFiles([new File([bytes as BlobPart], name, { type: 'application/pdf' })], name);
    } catch (e: any) {
      setError(e?.message?.includes('encrypt') ? 'One of the PDFs is password protected.' : e?.message || 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end lg:items-center justify-center">
      <div className="w-full lg:max-w-lg max-h-[90dvh] bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-t-3xl lg:rounded-3xl overflow-hidden flex flex-col pb-safe text-gray-900 dark:text-white">
        <header className="flex items-center justify-between px-5 py-4 border-b border-black/5 dark:border-white/10">
          <h2 className="text-lg font-bold">Merge PDFs</h2>
          <button onClick={() => { setFiles([]); onClose(); }} className="p-2 rounded-full bg-black/5 dark:bg-white/10 ios-press" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto ios-scroll p-5 space-y-3">
          {files.length === 0 && (
            <p className="text-sm text-gray-500 text-center py-6">Add two or more PDFs. They are joined in this order.</p>
          )}
          {files.map((f, i) => (
            <div key={`${f.name}-${i}`} className="flex items-center gap-2 bg-white dark:bg-[#2C2C2E] rounded-xl px-3 py-2.5">
              <span className="w-6 text-xs font-bold text-gray-400">{i + 1}</span>
              <span className="flex-1 text-sm truncate">{f.name}</span>
              <button onClick={() => move(i, -1)} className="p-1.5 ios-press" aria-label="Move up"><ArrowUp className="w-4 h-4" /></button>
              <button onClick={() => move(i, 1)} className="p-1.5 ios-press" aria-label="Move down"><ArrowDown className="w-4 h-4" /></button>
              <button onClick={() => setFiles((x) => x.filter((_, k) => k !== i))} className="p-1.5 ios-press text-red-500" aria-label="Remove"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <button onClick={() => inputRef.current?.click()} className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl border-2 border-dashed border-[#5856D6]/40 text-[#5856D6] dark:text-[#7D7AFF] text-sm font-semibold ios-press">
            <Plus className="w-4 h-4" /> Add PDFs
          </button>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <div className="p-5 border-t border-black/5 dark:border-white/10">
          <button
            disabled={files.length < 2 || busy}
            onClick={merge}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[#5856D6] text-white text-sm font-semibold disabled:opacity-40 ios-press"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            Merge {files.length > 1 ? `${files.length} PDFs` : ''}
          </button>
        </div>
      </div>
    </div>
  );
};

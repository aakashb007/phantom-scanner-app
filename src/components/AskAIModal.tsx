import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Loader2, ArrowUp, FileText } from 'lucide-react';
import { DocumentRecord } from '../types/document';
import { askGroq, AskResult, DEFAULT_GROQ_MODEL } from '../utils/askAi';
import { getSetting } from '../db/db';

interface Props {
  isOpen: boolean;
  initialQuestion?: string;
  documents: DocumentRecord[];
  onClose: () => void;
  onOpenDocument: (doc: DocumentRecord) => void;
}

export const AskAIModal: React.FC<Props> = ({ isOpen, initialQuestion, documents, onClose, onOpenDocument }) => {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const key = await getSetting<string>('groq_api_key', '');
      const model = await getSetting<string>('groq_model', DEFAULT_GROQ_MODEL);
      if (!key) throw new Error('Add your free Groq key in Settings first.');
      setResult(await askGroq(key, model, q, documents));
    } catch (e: any) {
      setError(e?.message || 'Ask AI failed');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    setResult(null);
    setError('');
    setQuestion(initialQuestion || '');
    if (initialQuestion) ask(initialQuestion);
    else setTimeout(() => inputRef.current?.focus(), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuestion]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-black/50 flex items-end lg:items-center justify-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full lg:max-w-xl max-h-[85dvh] bg-[#F2F2F7] dark:bg-[#1C1C1E] rounded-t-3xl lg:rounded-3xl overflow-hidden flex flex-col pb-safe text-gray-900 dark:text-white"
      >
        <header className="flex items-center justify-between px-5 py-4">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#FF9500]" /> Ask AI
          </h2>
          <button onClick={onClose} className="p-2 rounded-full bg-black/5 dark:bg-white/10 ios-press" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(question);
          }}
          className="px-5 flex gap-2"
        >
          <input
            ref={inputRef}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='e.g. "When does my passport expire?"'
            className="flex-1 bg-white dark:bg-[#2C2C2E] rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#5856D6]"
          />
          <button type="submit" disabled={busy || !question.trim()} className="w-12 rounded-xl bg-[#5856D6] text-white flex items-center justify-center disabled:opacity-40 ios-press" aria-label="Ask">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowUp className="w-5 h-5" />}
          </button>
        </form>
        <div className="flex-1 overflow-y-auto ios-scroll p-5 space-y-4">
          {error && <p className="text-sm text-red-500">{error}</p>}
          {result && (
            <>
              <p className="text-[15px] leading-relaxed bg-white dark:bg-[#2C2C2E] rounded-2xl p-4">{result.answer}</p>
              {result.docs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase text-gray-500">Matching documents</p>
                  {result.docs.map((d) => (
                    <button
                      key={d.docId}
                      onClick={() => onOpenDocument(d)}
                      className="w-full flex items-center gap-3 bg-white dark:bg-[#2C2C2E] rounded-xl p-2.5 text-left ios-press"
                    >
                      {d.pages?.[0]?.dataUrl ? (
                        <img src={d.pages[0].dataUrl} alt="" className="w-10 h-12 object-cover rounded-md bg-gray-100" />
                      ) : (
                        <FileText className="w-10 h-10 text-gray-400" />
                      )}
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold truncate">{d.name}</span>
                        <span className="block text-xs text-gray-500">{d.pages?.length || 0} pages · {d.folder || d.category}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {!result && !error && !busy && (
            <p className="text-xs text-gray-500">
              Only short excerpts of up to 12 matching documents are sent to Groq with your key. Vault documents are never sent.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

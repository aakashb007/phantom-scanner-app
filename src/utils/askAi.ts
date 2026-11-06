// Ask AI (Groq) with the user's own free key. Only the up-to-12 best-matching documents are sent,
// each as a short excerpt (~500 characters), at most ~8,000 characters per question.
// Vault documents are never sent.
import { DocumentRecord } from '../types/document';

export const GROQ_MODELS = [
  { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (best)' },
  { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (fastest)' },
  { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B' },
  { id: 'qwen/qwen3-32b', label: 'Qwen 3 32B' },
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout' },
];
export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;

const MAX_DOCS = 12;
const EXCERPT = 500;
const MAX_TOTAL = 8000;

const STOP = new Set(
  'a an the is are was were be my me i you of to in on for and or with what when where which who how show find do does did have has my all any about from this that it its'.split(' ')
);

function words(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1 && !STOP.has(w));
}

function docText(d: DocumentRecord): string {
  return (d.pages || []).map((p) => p.ocrText || '').join('\n');
}

function fmtDate(ms: number | null) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Pick the documents that best match the question and cut a short excerpt from each. */
export function pickDocuments(question: string, docs: DocumentRecord[]) {
  const q = words(question);
  const scored = docs
    .filter((d) => !d.vault)
    .map((d) => {
      const meta = `${d.name} ${d.category} ${d.folder}`.toLowerCase();
      const text = docText(d);
      const low = text.toLowerCase();
      let score = 0;
      let bestPos = 0;
      let bestHits = -1;
      for (const w of q) {
        if (meta.includes(w)) score += 5;
        let idx = low.indexOf(w);
        let hits = 0;
        while (idx !== -1 && hits < 20) {
          hits++;
          if (hits === 1 && hits > bestHits) {
            bestHits = hits;
            bestPos = idx;
          }
          idx = low.indexOf(w, idx + w.length);
        }
        score += Math.min(hits, 5);
      }
      if (d.expiry) score += 0.5; // expiry questions are common
      const start = Math.max(0, bestPos - 150);
      const excerpt = text.slice(start, start + EXCERPT).replace(/\s+/g, ' ').trim();
      return { d, score, excerpt };
    })
    .sort((a, b) => b.score - a.score || b.d.lastChanged - a.d.lastChanged)
    .slice(0, MAX_DOCS);

  let total = 0;
  const picked: { d: DocumentRecord; excerpt: string }[] = [];
  for (const s of scored) {
    const header = `${s.d.name} | category: ${s.d.category || '-'} | folder: ${s.d.folder || '-'} | expiry: ${fmtDate(s.d.expiry) || '-'} | created: ${fmtDate(s.d.created)}`;
    const chunk = `${header}\n${s.excerpt}`;
    if (total + chunk.length > MAX_TOTAL) break;
    total += chunk.length;
    picked.push({ d: s.d, excerpt: chunk });
  }
  return picked;
}

export interface AskResult {
  answer: string;
  docs: DocumentRecord[];
}

export async function askGroq(key: string, model: string, question: string, allDocs: DocumentRecord[]): Promise<AskResult> {
  const picked = pickDocuments(question, allDocs);
  const context = picked.map((p, i) => `[${i + 1}] ${p.excerpt}`).join('\n\n');
  const today = fmtDate(Date.now());
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 600,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            `You help the user find things in their scanned documents. Today is ${today}. ` +
            'Answer only from the numbered document excerpts. Be short (1-3 sentences). ' +
            'Reply as JSON: {"answer": "...", "documents": [numbers of the matching documents]}. ' +
            'If nothing matches, say so and return an empty list.',
        },
        { role: 'user', content: `Documents:\n${context || '(no documents)'}\n\nQuestion: ${question}` },
      ],
    }),
  });
  if (r.status === 401) throw new Error('Your Groq key was not accepted. Check it in Settings.');
  if (r.status === 429) throw new Error('Groq free limit reached for now. Try again in a minute.');
  if (!r.ok) throw new Error(`Groq error ${r.status}`);
  const j = await r.json();
  let content = j.choices?.[0]?.message?.content || '';
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = { answer: content, documents: [] };
  }
  const nums: number[] = Array.isArray(parsed.documents) ? parsed.documents.map(Number) : [];
  const docs = nums.map((n) => picked[n - 1]?.d).filter(Boolean) as DocumentRecord[];
  return { answer: String(parsed.answer || '').trim() || 'No answer.', docs };
}

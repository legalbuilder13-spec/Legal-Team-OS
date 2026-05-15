'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

// Global ⌘K palette: cross-table semantic search across playbooks,
// knowledge, rules, templates, patterns, and matters. Uses voyage-law-2
// embeddings via the search.global tRPC router; falls back to keyword
// match when Voyage isn't available or no embedded rows match.
//
// Mounts in the authed layout so it's reachable from anywhere with
// ⌘K (Mac) / Ctrl+K (everyone else). Esc closes; arrow keys navigate;
// Enter opens the focused result in the right detail surface.

const ENTITY_LABELS: Record<string, string> = {
  playbook: 'Playbook',
  knowledge_article: 'Knowledge',
  rule: 'Rule',
  template: 'Template',
  execution_pattern: 'Pattern',
  matter: 'Matter',
};

const ENTITY_TONE: Record<string, string> = {
  playbook: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  knowledge_article: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  rule: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  template: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  execution_pattern: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  matter: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
};

interface Result {
  type: keyof typeof ENTITY_LABELS;
  id: string;
  title: string;
  subtitle: string | null;
  snippet: string | null;
}

function hrefFor(r: Result): string {
  switch (r.type) {
    case 'matter':
      return `/matters/${r.id}`;
    case 'playbook':
      return `/admin/playbooks`;
    case 'knowledge_article':
      return `/admin/knowledge`;
    case 'rule':
      return `/admin/rules`;
    case 'template':
      return `/admin/templates`;
    case 'execution_pattern':
      return `/admin/patterns`;
    default:
      return '/dashboard';
  }
}

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const trimmed = query.trim();
  const { data, isFetching } = trpc.search.global.useQuery(
    { query: trimmed, perKindLimit: 4 },
    { enabled: open && trimmed.length >= 2 },
  );
  const results = (data?.results ?? []) as Result[];

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open) return;
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
        return;
      }
      if (e.key === 'Enter' && results[activeIdx]) {
        const r = results[activeIdx]!;
        router.push(hrefFor(r));
        setOpen(false);
        setQuery('');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, activeIdx, router]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      setActiveIdx(0);
    }
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [data]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh] px-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-ink-200 dark:border-ink-800 px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search playbooks, knowledge, rules, templates, patterns, matters…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder-ink-400 dark:placeholder-ink-500"
          />
          <span className="text-[10px] font-mono text-ink-400 dark:text-ink-500 px-1.5 py-0.5 border rounded">
            ESC
          </span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {trimmed.length < 2 && (
            <div className="px-4 py-8 text-xs text-center text-ink-400 dark:text-ink-500">
              Type at least 2 characters to search.
            </div>
          )}
          {trimmed.length >= 2 && isFetching && results.length === 0 && (
            <div className="px-4 py-6 text-xs text-center text-ink-500 dark:text-ink-400">
              Searching…
            </div>
          )}
          {trimmed.length >= 2 && !isFetching && results.length === 0 && (
            <div className="px-4 py-6 text-xs text-center text-ink-500 dark:text-ink-400">
              No matches.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.type}:${r.id}`}
              type="button"
              onClick={() => {
                router.push(hrefFor(r));
                setOpen(false);
                setQuery('');
              }}
              onMouseEnter={() => setActiveIdx(i)}
              className={`w-full text-left px-3 py-2 border-b border-ink-100 dark:border-ink-800 last:border-b-0 ${
                i === activeIdx ? 'bg-ink-50 dark:bg-ink-800' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                    ENTITY_TONE[r.type] ?? ''
                  }`}
                >
                  {ENTITY_LABELS[r.type] ?? r.type}
                </span>
                <span className="font-medium text-sm truncate">{r.title}</span>
                {r.subtitle && (
                  <span className="text-xs text-ink-400 dark:text-ink-500 shrink-0">
                    · {r.subtitle}
                  </span>
                )}
              </div>
              {r.snippet && (
                <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5 line-clamp-2">
                  {r.snippet}
                </div>
              )}
            </button>
          ))}
        </div>
        {data && (
          <div className="px-3 py-1.5 text-[10px] text-ink-400 dark:text-ink-500 bg-ink-50 dark:bg-ink-950 border-t border-ink-200 dark:border-ink-800 flex justify-between">
            <span>↑↓ navigate · ↵ open · esc close</span>
            <span>{data.semantic ? 'semantic search' : 'keyword fallback'}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function GlobalSearchTrigger() {
  return (
    <button
      type="button"
      onClick={() => {
        const ev = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
        window.dispatchEvent(ev);
      }}
      className="w-full flex items-center justify-between gap-2 text-xs px-2.5 py-1.5 border rounded-md text-ink-500 dark:text-ink-400 hover:bg-ink-50 dark:hover:bg-ink-800"
      title="Search everything (⌘K)"
    >
      <span>Search…</span>
      <span className="font-mono text-[10px] px-1 py-0.5 border rounded">⌘K</span>
    </button>
  );
}

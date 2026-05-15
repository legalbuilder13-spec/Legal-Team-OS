'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';

// Live duplicate-check banner for create forms. Watches a title input
// (debounced) and queries the global semantic search to find existing
// entries across ALL FIVE content tables that look similar. Surfaces
// them as a small "did you mean to edit one of these?" prompt above
// the title field. Only renders when there's at least one match.
//
// Reduces the most common failure mode of a multi-table content
// system: the same idea getting re-encoded as a fresh entry
// (knowledge article + playbook + template) with three slightly
// different wordings.

const KIND_LABEL: Record<string, string> = {
  playbook: 'Playbook',
  knowledge_article: 'Knowledge',
  rule: 'Rule',
  template: 'Template',
  execution_pattern: 'Pattern',
  matter: 'Matter',
};

const KIND_TONE: Record<string, string> = {
  playbook: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  knowledge_article: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  rule: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  template: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  execution_pattern: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  matter: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
};

const KIND_HREF: Record<string, string> = {
  playbook: '/admin/playbooks',
  knowledge_article: '/admin/knowledge',
  rule: '/admin/rules',
  template: '/admin/templates',
  execution_pattern: '/admin/patterns',
  matter: '/matters',
};

interface Props {
  title: string;
  /** The kind currently being created — excluded from results. */
  currentKind:
    | 'playbook'
    | 'knowledge_article'
    | 'rule'
    | 'template'
    | 'execution_pattern';
  /** Hide the banner (e.g. when editing an existing record). */
  disabled?: boolean;
}

export function DuplicateCheck({ title, currentKind, disabled }: Props) {
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    if (disabled) return;
    const t = setTimeout(() => setDebounced(title.trim()), 300);
    return () => clearTimeout(t);
  }, [title, disabled]);

  const enabled = !disabled && debounced.length >= 4;
  const { data } = trpc.search.global.useQuery(
    { query: debounced, perKindLimit: 3 },
    { enabled },
  );

  if (disabled) return null;
  const matches = (data?.results ?? []).filter((r) => r.type !== 'matter');
  if (matches.length === 0) return null;

  return (
    <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 rounded-lg p-3 mb-3">
      <div className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1.5">
        Similar items already exist — edit one of these instead?
      </div>
      <ul className="space-y-1">
        {matches.slice(0, 5).map((r) => (
          <li key={`${r.type}:${r.id}`} className="text-xs">
            <Link
              href={KIND_HREF[r.type] ?? '/admin'}
              className="inline-flex items-center gap-1.5 hover:underline"
            >
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                  KIND_TONE[r.type] ?? ''
                }`}
              >
                {KIND_LABEL[r.type] ?? r.type}
              </span>
              <span className="font-medium">{r.title}</span>
              {r.subtitle && (
                <span className="text-ink-500 dark:text-ink-400">· {r.subtitle}</span>
              )}
              {r.type === currentKind && (
                <span className="text-[10px] text-amber-700 dark:text-amber-400">
                  (same type)
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <div className="text-[10px] text-amber-700 dark:text-amber-400 mt-1.5">
        Continue typing to create a new entry, or click an existing one above
        to edit it instead.
      </div>
    </div>
  );
}

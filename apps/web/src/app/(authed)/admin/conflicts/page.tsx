'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PR #7 / M8 — Conflict review queue. Renders detected_conflicts
// rows with admin actions: dismiss (not a real conflict) or resolve
// (the underlying issue is fixed, e.g., one of the duplicates was
// archived).
//
// The weekly Sunday cron auto-populates this page. "Run detection
// now" enqueues an out-of-band cycle for impatient admins.

const KIND_LABEL: Record<string, string> = {
  duplicate_canonical_clause: 'Duplicate canonical clause',
  rule_priority_collision: 'Rule priority collision',
  near_duplicate_playbook: 'Near-duplicate playbook',
  kb_playbook_drift: 'KB ↔ Playbook drift',
};

const SEVERITY_TONE: Record<string, string> = {
  high: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900',
  medium: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900',
  low: 'bg-ink-50 text-ink-600 dark:bg-ink-900 dark:text-ink-400 border-ink-200 dark:border-ink-800',
};

const ENTITY_HREF: Record<string, string> = {
  playbook: '/admin/playbooks',
  knowledge_article: '/admin/knowledge',
  rule: '/admin/rules',
  template: '/admin/templates',
  clause: '/admin/clauses',
  execution_pattern: '/admin/patterns',
};

type Status = 'active' | 'dismissed' | 'resolved';

export default function ConflictsAdminPage() {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<Status>('active');
  const { data: conflicts = [], isLoading } = trpc.conflicts.list.useQuery({ status });
  const dismiss = trpc.conflicts.dismiss.useMutation({
    onSuccess: () => utils.conflicts.list.invalidate(),
  });
  const resolve = trpc.conflicts.resolve.useMutation({
    onSuccess: () => utils.conflicts.list.invalidate(),
  });
  const runNow = trpc.conflicts.runNow.useMutation({
    onSuccess: () => utils.conflicts.list.invalidate(),
  });

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Conflicts</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 max-w-2xl">
          Structural contradictions across the content tables — duplicate
          canonical clauses, rule priority collisions, near-duplicate
          playbooks. The weekly Sunday cron populates this queue. AI-
          based deep checks (semantic playbook contradiction, KB drift)
          will land in a follow-up.
        </p>
      </header>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1 border-b border-ink-200 dark:border-ink-800">
          {(['active', 'dismissed', 'resolved'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`text-sm px-3 py-2 border-b-2 -mb-px capitalize ${
                status === s
                  ? 'border-brand-500 text-brand-700 dark:text-brand-400 font-medium'
                  : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
        >
          {runNow.isPending ? 'Enqueued…' : 'Run detection now'}
        </button>
      </div>

      {isLoading && (
        <div className="text-sm text-ink-500 dark:text-ink-400">Loading…</div>
      )}
      {!isLoading && conflicts.length === 0 && (
        <div className="text-center text-sm text-ink-500 dark:text-ink-400 py-8 border rounded-lg">
          No {status} conflicts.
        </div>
      )}

      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li key={c.id} className={`border rounded-lg p-3 ${SEVERITY_TONE[c.severity]}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide font-medium">
                    {c.severity}
                  </span>
                  <span className="text-xs font-medium">
                    {KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                </div>
                <div className="text-sm">{c.summary}</div>
                <div className="text-[11px] mt-1 flex items-center gap-2">
                  <a
                    href={ENTITY_HREF[c.entityAType] ?? '#'}
                    className="underline hover:no-underline"
                  >
                    {c.entityAType}:{c.entityAId.slice(0, 8)}
                  </a>
                  {c.entityBType && c.entityBId && (
                    <>
                      <span>↔</span>
                      <a
                        href={ENTITY_HREF[c.entityBType] ?? '#'}
                        className="underline hover:no-underline"
                      >
                        {c.entityBType}:{c.entityBId.slice(0, 8)}
                      </a>
                    </>
                  )}
                </div>
                <div className="text-[10px] mt-1 opacity-75">
                  detected {new Date(c.createdAt).toLocaleDateString()} · {c.detectorVersion}
                </div>
                {c.resolutionNote && (
                  <div className="text-xs mt-1 italic opacity-90">
                    "{c.resolutionNote}"
                  </div>
                )}
              </div>
              {status === 'active' && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const reason = prompt(
                        'Why is this not a real conflict? (optional)',
                      ) ?? undefined;
                      dismiss.mutate({ id: c.id, reason: reason || undefined });
                    }}
                    className="text-xs px-2 py-1 border rounded hover:bg-white dark:hover:bg-ink-900"
                  >
                    Dismiss
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const note = prompt('How was this resolved? (required)');
                      if (note?.trim()) {
                        resolve.mutate({ id: c.id, resolutionNote: note.trim() });
                      }
                    }}
                    className="text-xs px-2 py-1 border rounded bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    Resolved
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

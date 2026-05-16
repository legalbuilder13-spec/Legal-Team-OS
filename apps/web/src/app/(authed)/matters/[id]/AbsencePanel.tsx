'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PR-6 — Questions-to-ask-before-answering panel. The most lawyerly
// move in the tool: surface the facts the lawyer should clarify before
// taking a position. how-lawyers-think V.13 — the most often missing
// operation in current legal AI.

interface AbsenceRow {
  id: string;
  missingFact: string;
  whyDispositive: string;
  severity: 'high' | 'medium' | 'low';
  suggestedClarifyingQuestion: string;
  resolved: boolean;
  dismissed: boolean;
  resolvedValue: string | null;
}

interface Props {
  matterId: string;
  findings: AbsenceRow[];
}

const SEVERITY_TONE: Record<AbsenceRow['severity'], string> = {
  high: 'border-rose-500 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-400',
  medium: 'border-amber-500 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-400',
  low: 'border-ink-300 bg-ink-50 dark:bg-ink-900/50 dark:border-ink-600',
};

const SEVERITY_LABEL: Record<AbsenceRow['severity'], string> = {
  high: 'Dispositive',
  medium: 'Material',
  low: 'Nice to have',
};

export function AbsencePanel({ matterId, findings }: Props) {
  const open = findings.filter((f) => !f.resolved && !f.dismissed);
  if (open.length === 0) return null;

  return (
    <div className="border rounded-md p-3 space-y-2 bg-white dark:bg-ink-900">
      <div className="text-xs font-medium text-ink-600 dark:text-ink-400">
        Questions to ask before answering · {open.length}
      </div>
      {open.map((finding) => (
        <AbsenceRow key={finding.id} matterId={matterId} finding={finding} />
      ))}
    </div>
  );
}

function AbsenceRow({ matterId, finding }: { matterId: string; finding: AbsenceRow }) {
  const [value, setValue] = useState('');
  const utils = trpc.useUtils();
  const mut = trpc.analysis.resolveAbsence.useMutation({
    onSuccess: () => utils.analysis.forMatter.invalidate({ matterId }),
  });

  return (
    <div className={`border-l-2 rounded-r-md p-2.5 ${SEVERITY_TONE[finding.severity]}`}>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-sm font-medium">{finding.missingFact}</div>
        <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/60 dark:bg-ink-800/60 shrink-0">
          {SEVERITY_LABEL[finding.severity]}
        </span>
      </div>
      <p className="text-xs text-ink-700 dark:text-ink-300 mb-1.5">{finding.whyDispositive}</p>
      <p className="text-xs italic text-ink-600 dark:text-ink-400 mb-2">
        Ask: {finding.suggestedClarifyingQuestion}
      </p>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Answer once you know..."
          className="flex-1 text-xs px-2 py-1 rounded border bg-white dark:bg-ink-800 border-ink-300 dark:border-ink-600"
        />
        <button
          type="button"
          disabled={mut.isPending || !value.trim()}
          onClick={() =>
            mut.mutate({ findingId: finding.id, action: { kind: 'resolve', value } })
          }
          className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
        >
          Resolve
        </button>
        <button
          type="button"
          disabled={mut.isPending}
          onClick={() =>
            mut.mutate({ findingId: finding.id, action: { kind: 'dismiss' } })
          }
          className="text-xs px-2 py-1 rounded border border-ink-300 dark:border-ink-600 hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-40"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

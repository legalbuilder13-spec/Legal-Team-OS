'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PRD §6.1 — trace drawer for an analysis stage. Click to expand;
// shows the structured stage output and the source rows the stage
// relied upon (lazy-loaded on expand).

interface Props {
  stageId: string;
  stageName: string;
  status: string;
  confidence: string;
  outputJson: Record<string, unknown>;
  durationMs: number;
}

function Confidence({ value }: { value: string }) {
  const tone =
    value === 'HIGH'
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900'
      : value === 'MEDIUM'
        ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900'
        : value === 'LOW'
          ? 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900'
          : 'bg-ink-50 text-ink-600 border-ink-200 dark:bg-ink-800 dark:text-ink-400 dark:border-ink-700';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>{value}</span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'complete'
      ? 'text-emerald-600 dark:text-emerald-400'
      : status === 'failed'
        ? 'text-red-600 dark:text-red-400'
        : status === 'skipped'
          ? 'text-ink-500 dark:text-ink-400'
          : status === 'deferred'
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-blue-600 dark:text-blue-400';
  return <span className={`text-[10px] font-mono uppercase ${tone}`}>{status}</span>;
}

export function StageTraceDrawer({
  stageId,
  stageName,
  status,
  confidence,
  outputJson,
  durationMs,
}: Props) {
  const [open, setOpen] = useState(false);
  const { data: sources, isLoading: sourcesLoading } = trpc.analysis.stageSources.useQuery(
    { stageId },
    { enabled: open },
  );

  const label =
    {
      pre_merits: 'Pre-merits checklist',
      guidance: 'Playbook / guidance check',
      statutory: 'Statutory & regulatory research',
      case_law: 'Case-law research',
      deconstruct: 'Deconstruction + draft memo',
    }[stageName] ?? stageName;

  return (
    <div className="border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 bg-ink-50/50 dark:bg-ink-800/40 hover:bg-ink-100 dark:hover:bg-ink-800 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-ink-400 dark:text-ink-500 text-xs">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium truncate">{label}</span>
          <StatusBadge status={status} />
          <Confidence value={confidence} />
        </div>
        <span className="text-[10px] font-mono text-ink-400 dark:text-ink-500 shrink-0">
          {durationMs}ms
        </span>
      </button>
      {open && (
        <div className="px-3 py-3 space-y-3 border-t bg-white dark:bg-ink-900">
          <details>
            <summary className="text-xs font-medium text-ink-600 dark:text-ink-400 cursor-pointer">
              Stage output (JSON)
            </summary>
            <pre className="mt-2 text-[11px] font-mono bg-ink-50 dark:bg-ink-800/60 p-2 rounded overflow-x-auto max-h-96">
              {JSON.stringify(outputJson, null, 2)}
            </pre>
          </details>
          <div>
            <div className="text-xs font-medium text-ink-600 dark:text-ink-400 mb-2">
              Sources retrieved
            </div>
            {sourcesLoading && (
              <div className="text-xs text-ink-400 dark:text-ink-500">Loading…</div>
            )}
            {sources && sources.length === 0 && (
              <div className="text-xs text-ink-400 dark:text-ink-500">No source rows.</div>
            )}
            {sources && sources.length > 0 && (
              <ul className="space-y-1.5">
                {sources.map((s) => (
                  <li key={s.id} className="text-xs flex items-start gap-2 min-w-0">
                    <span className="text-ink-400 dark:text-ink-500 font-mono shrink-0">
                      [{s.sourceType}]
                    </span>
                    <div className="min-w-0">
                      <div className="truncate">
                        {s.url ? (
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-brand-700 dark:text-brand-300 hover:underline"
                          >
                            {s.citation}
                          </a>
                        ) : (
                          s.citation
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-ink-400 dark:text-ink-500">
                        verification: {s.verificationStatus}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

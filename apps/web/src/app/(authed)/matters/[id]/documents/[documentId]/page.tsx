'use client';

import Link from 'next/link';
import { use, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CircleAlert,
  Circle,
  Loader2,
  Pencil,
  RefreshCw,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';

const TAG_TONE: Record<string, string> = {
  STANDARD: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
  MODIFIED: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
  FLAGGED: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900',
};

const DECISION_TONE: Record<string, string> = {
  APPROVED: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
  MODIFIED: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
  FLAGGED: 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200',
};

type Row = {
  clauseId: string;
  ordinal: number;
  headingPath: string | null;
  clauseText: string;
  pageNumber: number | null;
  analysisId: string | null;
  tag: 'STANDARD' | 'MODIFIED' | 'FLAGGED' | null;
  reasoning: string | null;
  suggestedRedline: string | null;
  attorneyDecision: string | null;
  attorneyModifiedRedline: string | null;
  decidedAt: Date | null;
  citations: Array<{ source: string; identifier: string; excerpt?: string }> | null;
  positionTopic: string | null;
  positionId: string | null;
};

export default function DocumentReviewPage({
  params,
}: {
  params: Promise<{ id: string; documentId: string }>;
}) {
  const { id: matterId, documentId } = use(params);
  const utils = trpc.useUtils();
  const { data: documents = [] } = trpc.documents.listForMatter.useQuery({ matterId });
  const document = documents.find((d) => d.id === documentId);
  const { data: rows = [], isLoading } = trpc.documents.listClausesWithAnalysis.useQuery(
    { documentId },
    { refetchInterval: (q) => {
        const data = (q.state.data ?? []) as Row[];
        const allAnalyzed = data.length > 0 && data.every((r) => r.tag !== null);
        return allAnalyzed ? false : 3000;
      },
    },
  );
  const decide = trpc.documents.decideClause.useMutation({
    onSuccess: () => utils.documents.listClausesWithAnalysis.invalidate({ documentId }),
  });
  const reanalyze = trpc.documents.reanalyze.useMutation({
    onSuccess: () => utils.documents.listClausesWithAnalysis.invalidate({ documentId }),
  });

  const [selectedClauseId, setSelectedClauseId] = useState<string | null>(null);
  const [editedRedline, setEditedRedline] = useState<string>('');

  const counts = useMemo(() => {
    const r = rows as Row[];
    return {
      total: r.length,
      analyzed: r.filter((row) => row.tag !== null).length,
      standard: r.filter((row) => row.tag === 'STANDARD').length,
      modified: r.filter((row) => row.tag === 'MODIFIED').length,
      flagged: r.filter((row) => row.tag === 'FLAGGED').length,
      decided: r.filter((row) => row.attorneyDecision !== null).length,
    };
  }, [rows]);

  const selected = (rows as Row[]).find((r) => r.clauseId === selectedClauseId) ?? null;

  if (isLoading) return <div className="text-ink-500 dark:text-ink-400">Loading…</div>;

  return (
    <div className="max-w-[110rem]">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <Link
            href={`/matters/${matterId}`}
            className="inline-flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400 hover:underline mb-1"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to matter
          </Link>
          <h1 className="text-xl font-semibold truncate">
            {document?.filename ?? 'Document'}
          </h1>
          <div className="text-xs text-ink-500 dark:text-ink-400 flex items-center gap-3 mt-1">
            <span>{counts.total} clauses</span>
            <span>·</span>
            <span>
              {counts.analyzed}/{counts.total} analyzed
            </span>
            <span>·</span>
            <span>{counts.decided} reviewed</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => reanalyze.mutate({ documentId })}
          disabled={reanalyze.isPending || document?.parseStatus !== 'parsed'}
          className="inline-flex items-center gap-1.5 text-xs border rounded px-2.5 py-1 hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {reanalyze.isPending ? 'Enqueuing…' : 'Re-analyze'}
        </button>
      </header>

      <div className="flex items-center gap-3 mb-4 text-xs">
        <span className={`px-2 py-0.5 rounded border ${TAG_TONE.STANDARD}`}>
          STANDARD {counts.standard}
        </span>
        <span className={`px-2 py-0.5 rounded border ${TAG_TONE.MODIFIED}`}>
          MODIFIED {counts.modified}
        </span>
        <span className={`px-2 py-0.5 rounded border ${TAG_TONE.FLAGGED}`}>
          FLAGGED {counts.flagged}
        </span>
        {counts.analyzed < counts.total && (
          <span className="inline-flex items-center gap-1 text-ink-500 dark:text-ink-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            analyzing {counts.total - counts.analyzed} remaining
          </span>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-5 max-h-[calc(100vh-220px)] overflow-y-auto space-y-1.5 pr-1">
          {(rows as Row[]).map((row) => (
            <button
              key={row.clauseId}
              type="button"
              onClick={() => {
                setSelectedClauseId(row.clauseId);
                setEditedRedline(row.attorneyModifiedRedline ?? row.suggestedRedline ?? '');
              }}
              className={`w-full text-left rounded border p-2.5 hover:bg-ink-50 dark:hover:bg-ink-800 ${
                selectedClauseId === row.clauseId
                  ? 'border-brand-500 bg-brand-50/30 dark:bg-brand-950/20'
                  : 'border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="text-[11px] text-ink-500 dark:text-ink-400 font-mono">
                  #{row.ordinal + 1}
                  {row.headingPath && ` · ${row.headingPath}`}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {row.attorneyDecision && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${DECISION_TONE[row.attorneyDecision] ?? ''}`}
                    >
                      {row.attorneyDecision === 'APPROVED' ? '✓' : row.attorneyDecision[0]}
                    </span>
                  )}
                  {row.tag ? (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${TAG_TONE[row.tag]}`}
                    >
                      {row.tag}
                    </span>
                  ) : (
                    <Loader2 className="h-3 w-3 text-ink-400 animate-spin" />
                  )}
                </div>
              </div>
              <div className="text-xs text-ink-700 dark:text-ink-300 mt-1 line-clamp-2">
                {row.clauseText}
              </div>
            </button>
          ))}
        </aside>

        <section className="col-span-7 space-y-3">
          {!selected ? (
            <div className="rounded border border-dashed border-ink-200 dark:border-ink-800 p-8 text-center text-sm text-ink-500 dark:text-ink-400">
              Select a clause to review.
            </div>
          ) : (
            <>
              <div className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-ink-500 dark:text-ink-400 font-mono">
                    Clause #{selected.ordinal + 1}
                    {selected.headingPath && ` · ${selected.headingPath}`}
                  </div>
                  {selected.tag && (
                    <span
                      className={`text-[11px] px-2 py-0.5 rounded border ${TAG_TONE[selected.tag]}`}
                    >
                      {selected.tag}
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap text-ink-800 dark:text-ink-200">
                  {selected.clauseText}
                </p>
              </div>

              {selected.analysisId ? (
                <>
                  <div className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium">AI analysis</h3>
                      {selected.positionTopic && (
                        <span className="text-[11px] text-ink-500 dark:text-ink-400">
                          against: {selected.positionTopic}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink-700 dark:text-ink-300 italic">
                      {selected.reasoning}
                    </p>
                    {selected.suggestedRedline && (
                      <div className="mt-3 border-t border-ink-100 dark:border-ink-800 pt-3">
                        <div className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1">
                          Suggested redline
                        </div>
                        <pre className="text-xs whitespace-pre-wrap text-ink-700 dark:text-ink-300 bg-ink-50 dark:bg-ink-950 rounded p-2 font-sans">
                          {selected.suggestedRedline}
                        </pre>
                      </div>
                    )}
                  </div>

                  <div className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4">
                    <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                      <Pencil className="h-3.5 w-3.5 text-ink-500 dark:text-ink-400" />
                      Your decision
                    </h3>
                    <textarea
                      value={editedRedline}
                      onChange={(e) => setEditedRedline(e.target.value)}
                      placeholder="Modified redline (only used when you click MODIFIED)…"
                      className="w-full text-sm border border-ink-200 dark:border-ink-700 rounded px-2 py-1.5 bg-transparent min-h-[80px] font-mono"
                    />
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        type="button"
                        onClick={() =>
                          decide.mutate({
                            analysisId: selected.analysisId!,
                            decision: 'APPROVED',
                          })
                        }
                        disabled={decide.isPending}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          decide.mutate({
                            analysisId: selected.analysisId!,
                            decision: 'MODIFIED',
                            modifiedRedline: editedRedline,
                          })
                        }
                        disabled={decide.isPending || !editedRedline.trim()}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-50"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Modify
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          decide.mutate({
                            analysisId: selected.analysisId!,
                            decision: 'FLAGGED',
                          })
                        }
                        disabled={decide.isPending}
                        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
                      >
                        <CircleAlert className="h-3.5 w-3.5" />
                        Flag
                      </button>
                      {selected.attorneyDecision && (
                        <span className="ml-auto text-xs text-ink-500 dark:text-ink-400">
                          Last decision: {selected.attorneyDecision}
                          {selected.decidedAt &&
                            ` · ${new Date(selected.decidedAt).toLocaleString()}`}
                        </span>
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded border border-dashed border-ink-200 dark:border-ink-800 p-6 text-center text-sm text-ink-500 dark:text-ink-400">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                  Analyzing this clause…
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PRD §6.1 / §7.6 / §7.7 / §12 — lawyer toolbar. Three buttons that
// invoke the research tools. Buttons surface availability + a
// suggestion indicator when the matter looks like a fit. Disabled
// buttons explain why in their tooltip (and confirmation dialog).

interface Props {
  matterId: string;
  defaultJurisdiction?: string;
}

type ToolKind = 'statutory' | 'case_law' | 'deconstruct';

const TOOL_LABEL: Record<ToolKind, string> = {
  statutory: 'Run Statutory & Regulatory Research',
  case_law: 'Run Case-Law Research',
  deconstruct: 'Run Deconstruction + Draft Memo',
};

const TOOL_TIME_ESTIMATE: Record<ToolKind, string> = {
  statutory: '~2–8 min',
  case_law: '~3–10 min',
  deconstruct: '~1–3 min',
};

export function LawyerToolbar({ matterId, defaultJurisdiction }: Props) {
  const { data: toolCtx, isLoading } = trpc.tools.context.useQuery({ matterId });
  const [openDialog, setOpenDialog] = useState<ToolKind | null>(null);
  const [jurisdiction, setJurisdiction] = useState(defaultJurisdiction ?? '');
  const [candidates, setCandidates] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const invokeStatutory = trpc.tools.invokeStatutory.useMutation();
  const invokeCaseLaw = trpc.tools.invokeCaseLaw.useMutation();
  const invokeDeconstruct = trpc.tools.invokeDeconstruct.useMutation();

  if (isLoading || !toolCtx) {
    return (
      <div className="text-xs text-ink-400 dark:text-ink-500">Loading toolbar…</div>
    );
  }

  function suggestionPill(kind: ToolKind): string | null {
    if (!toolCtx) return null;
    if (kind === 'statutory') {
      const h = toolCtx.hints.statutory;
      if (h.suggested) {
        const reason = h.citations.length
          ? `${h.citations.length} citation${h.citations.length > 1 ? 's' : ''} detected`
          : h.keywords.length
            ? `${h.keywords.length} statutory keyword${h.keywords.length > 1 ? 's' : ''}`
            : 'practice area match';
        return reason;
      }
    }
    if (kind === 'case_law') {
      const h = toolCtx.hints.caseLaw;
      if (h.suggested) {
        return h.citations.length
          ? `${h.citations.length} case citation${h.citations.length > 1 ? 's' : ''} detected`
          : 'practice area match';
      }
    }
    return null;
  }

  function buttonFor(kind: ToolKind) {
    const avail = toolCtx!.availability[kind];
    const suggestion = suggestionPill(kind);
    const handleClick = () => {
      setErrorMsg(null);
      setOpenDialog(kind);
    };
    return (
      <button
        key={kind}
        onClick={handleClick}
        disabled={!avail.enabled}
        title={avail.enabled ? undefined : avail.reason}
        className={`w-full text-left text-sm border rounded px-3 py-2 ${
          avail.enabled
            ? 'hover:bg-ink-50 dark:hover:bg-ink-800 border-ink-200 dark:border-ink-700'
            : 'opacity-50 cursor-not-allowed border-ink-200 dark:border-ink-700'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{TOOL_LABEL[kind]}</span>
          <span className="text-[10px] font-mono text-ink-400 dark:text-ink-500 shrink-0">
            {TOOL_TIME_ESTIMATE[kind]}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
          {avail.enabled ? (
            suggestion ? (
              <span className="text-amber-700 dark:text-amber-300">Suggested · {suggestion}</span>
            ) : (
              <span className="text-ink-400 dark:text-ink-500">Available</span>
            )
          ) : (
            <span className="text-ink-400 dark:text-ink-500 italic">{avail.reason}</span>
          )}
        </div>
      </button>
    );
  }

  async function submitDialog() {
    if (!openDialog) return;
    setErrorMsg(null);
    try {
      if (openDialog === 'statutory') {
        const list = candidates
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        await invokeStatutory.mutateAsync({
          matterId,
          jurisdiction: jurisdiction || 'unspecified',
          candidateStatutes: list,
        });
      } else if (openDialog === 'case_law') {
        const list = candidates
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean);
        await invokeCaseLaw.mutateAsync({
          matterId,
          jurisdiction: jurisdiction || 'unspecified',
          candidateDoctrines: list,
        });
      } else {
        await invokeDeconstruct.mutateAsync({ matterId });
      }
      setOpenDialog(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Tool invocation failed');
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-ink-600 dark:text-ink-400">Research tools</div>
      {(['statutory', 'case_law', 'deconstruct'] as const).map(buttonFor)}

      {openDialog && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-700 rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-base font-semibold">{TOOL_LABEL[openDialog]}</h3>
              <span className="text-[10px] font-mono text-ink-400 dark:text-ink-500">
                est. {TOOL_TIME_ESTIMATE[openDialog]}
              </span>
            </div>
            <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
              {openDialog === 'deconstruct'
                ? 'Runs the deconstruction + draft memo tool against this matter. Reads prior tool outputs if present.'
                : 'Adjust the inputs below; the tool will execute the methodology, screenshot-verify every cite, and surface the trace.'}
            </p>

            {openDialog !== 'deconstruct' && (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs font-medium text-ink-600 dark:text-ink-400">
                    Jurisdiction
                  </span>
                  <input
                    value={jurisdiction}
                    onChange={(e) => setJurisdiction(e.target.value)}
                    placeholder="e.g. federal, California, NY"
                    className="mt-1 w-full border rounded px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-ink-600 dark:text-ink-400">
                    {openDialog === 'statutory'
                      ? 'Candidate statutes (one per line, or comma-separated)'
                      : 'Candidate doctrines (one per line, or comma-separated)'}
                  </span>
                  <textarea
                    value={candidates}
                    onChange={(e) => setCandidates(e.target.value)}
                    rows={3}
                    placeholder={
                      openDialog === 'statutory'
                        ? '42 U.S.C. § 1395cc\nCal. Civ. Code § 1798.140'
                        : 'Negligence per se\nERISA preemption'
                    }
                    className="mt-1 w-full border rounded px-2 py-1.5 text-xs font-mono"
                  />
                </label>
                {openDialog === 'statutory' &&
                  toolCtx.hints.statutory.citations.length > 0 && (
                    <div className="text-[11px] text-ink-500 dark:text-ink-400">
                      Detected in request:{' '}
                      <span className="font-mono">
                        {toolCtx.hints.statutory.citations.map((c) => c.raw).join(', ')}
                      </span>
                    </div>
                  )}
              </div>
            )}

            {errorMsg && (
              <div className="mt-3 text-xs text-red-600 dark:text-red-400">{errorMsg}</div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                onClick={() => setOpenDialog(null)}
                className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                onClick={submitDialog}
                disabled={
                  invokeStatutory.isPending ||
                  invokeCaseLaw.isPending ||
                  invokeDeconstruct.isPending
                }
                className="text-sm px-3 py-1.5 bg-brand-600 text-white rounded disabled:opacity-50 hover:bg-brand-700"
              >
                Run
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

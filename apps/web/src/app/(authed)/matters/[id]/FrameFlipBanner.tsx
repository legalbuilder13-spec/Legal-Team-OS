'use client';

import { trpc } from '@/lib/trpc';

// PR-A — UI surface for doctrinal-frame flip proposals. Shown above
// the stage cards. Lawyer accepts (rewrites the carried frame) or
// rejects (preserves it). Silent reinterpretation is what we are
// preventing — the model proposed a flip and we made it visible.

interface FlipRow {
  id: string;
  matterAnalysisId: string;
  proposedByStage: string;
  fromFrame: string | null;
  toFrame: string;
  evidence: Record<string, unknown>;
  confidence: string | null;
  lawyerDecision: 'pending' | 'accepted' | 'rejected' | 'escalated';
  createdAt: Date | string;
}

interface Props {
  matterId: string;
  flips: FlipRow[];
}

const STAGE_LABELS: Record<string, string> = {
  stage_0: 'Pre-merits (Stage 0)',
  stage_1: 'Guidance (Stage 1)',
  stage_2a: 'Statutory (Stage 2a)',
  stage_2b: 'Case-law (Stage 2b)',
  stage_3: 'Deconstruct (Stage 3)',
};

export function FrameFlipBanner({ matterId, flips }: Props) {
  const utils = trpc.useUtils();
  const decide = trpc.analysis.decideFrameFlip.useMutation({
    onSuccess: () => utils.analysis.forMatter.invalidate({ matterId }),
  });

  const pending = flips.filter((f) => f.lawyerDecision === 'pending');
  if (pending.length === 0) return null;

  return (
    <div className="space-y-2">
      {pending.map((flip) => {
        const evidence = flip.evidence ?? {};
        const quote = (evidence.evidence_quote as string | undefined) ?? '';
        const citation = (evidence.evidence_citation as string | undefined) ?? null;
        const rationale = (evidence.rationale as string | undefined) ?? '';
        const conf = flip.confidence ? Number(flip.confidence) : null;

        return (
          <div
            key={flip.id}
            className="border-l-2 border-amber-500 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-400 rounded-r-md p-3"
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-xs font-medium text-amber-800 dark:text-amber-200 mb-0.5">
                  Doctrinal-frame flip proposed · {STAGE_LABELS[flip.proposedByStage] ?? flip.proposedByStage}
                </div>
                <div className="text-sm">
                  <span className="font-mono text-ink-700 dark:text-ink-300">
                    {flip.fromFrame ?? '(no carried frame)'}
                  </span>
                  <span className="mx-2 text-ink-400">→</span>
                  <span className="font-mono text-amber-900 dark:text-amber-100 font-semibold">
                    {flip.toFrame}
                  </span>
                  {conf !== null && (
                    <span className="ml-2 text-[10px] font-mono text-amber-700 dark:text-amber-300">
                      conf {conf.toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ flipId: flip.id, decision: 'accepted' })}
                  className="text-xs px-2 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  Accept flip
                </button>
                <button
                  type="button"
                  disabled={decide.isPending}
                  onClick={() => decide.mutate({ flipId: flip.id, decision: 'rejected' })}
                  className="text-xs px-2 py-1 rounded border border-ink-300 dark:border-ink-600 hover:bg-ink-100 dark:hover:bg-ink-800 disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
            {rationale && (
              <p className="text-xs text-ink-700 dark:text-ink-300 mb-1.5">{rationale}</p>
            )}
            {quote && (
              <blockquote className="text-xs italic text-ink-600 dark:text-ink-400 border-l border-amber-300 dark:border-amber-700 pl-2">
                “{quote}”
                {citation && <span className="ml-1 font-mono not-italic">— {citation}</span>}
              </blockquote>
            )}
          </div>
        );
      })}
    </div>
  );
}

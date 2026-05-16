'use client';

import { trpc } from '@/lib/trpc';
import { DEPTH_LABELS, DEPTH_DESCRIPTIONS, type ResearchDepth } from '@legal/types';

// PR-A — depth selector. Sits in the analysis panel header. Changing
// the depth persists to matter_analyses.research_depth; subsequent
// stage re-runs read the new depth from there.

interface Props {
  matterId: string;
  analysisId: string;
  current: ResearchDepth;
}

const DEPTHS: ResearchDepth[] = ['quick_take', 'client_advice', 'filing_grade', 'bet_the_company'];

export function DepthSelector({ matterId, analysisId, current }: Props) {
  const utils = trpc.useUtils();
  const setDepth = trpc.analysis.setDepth.useMutation({
    onSuccess: () => utils.analysis.forMatter.invalidate({ matterId }),
  });

  return (
    <select
      value={current}
      disabled={setDepth.isPending}
      onChange={(e) => setDepth.mutate({ analysisId, depth: e.target.value as ResearchDepth })}
      title={DEPTH_DESCRIPTIONS[current]}
      className="text-[11px] font-medium px-2 py-0.5 rounded border bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-300 border-ink-300 dark:border-ink-600 hover:border-ink-400 dark:hover:border-ink-500 disabled:opacity-50"
    >
      {DEPTHS.map((d) => (
        <option key={d} value={d} title={DEPTH_DESCRIPTIONS[d]}>
          {DEPTH_LABELS[d]}
        </option>
      ))}
    </select>
  );
}

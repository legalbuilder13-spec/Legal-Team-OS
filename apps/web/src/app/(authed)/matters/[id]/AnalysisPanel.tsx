'use client';

import { trpc } from '@/lib/trpc';
import { LawyerToolbar } from './LawyerToolbar';
import { StageTraceDrawer } from './StageTraceDrawer';
import { StatutoryStageCard } from './StatutoryStageCard';
import { CaseLawStageCard } from './CaseLawStageCard';

// PRD §6.1 — the matter detail page's Analysis panel. Two sections:
// the auto-pipeline output (always present once analysis runs), and the
// lawyer toolbar for invoking research tools.

interface Props {
  matterId: string;
}

interface GuidanceOutput {
  verdict: 'matched' | 'related_only' | 'no_hit';
  queriesRun: string[];
  grades: Array<{
    candidate: { title: string; url?: string };
    onPointScore: number;
    jurisdictionMatch: boolean;
    oneLineRationale: string;
  }>;
  topMatch: { candidate: { title: string; url?: string }; onPointScore: number } | null;
  headlineAnswer: { summary: string; citation: string; sourceUrl?: string } | null;
  notesForLawyer?: string;
}

interface PreMeritsOutput {
  practiceArea: string;
  checklistVersion: string;
  findings: Array<{
    id: string;
    status: 'raised' | 'not_raised' | 'cant_tell';
    confidence: number;
    evidenceQuote: string;
    oneLineJustification: string;
  }>;
  raisedHighSeverity: string[];
}

function StatusPill({
  status,
}: {
  status: 'matched' | 'escalated' | 'failed' | 'pending' | 'running';
}) {
  const tone =
    status === 'matched'
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : status === 'escalated'
        ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900'
        : status === 'failed'
          ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900'
          : 'bg-ink-50 text-ink-600 dark:bg-ink-800 dark:text-ink-400 border-ink-200 dark:border-ink-700';
  const label =
    status === 'matched'
      ? 'Matched playbook'
      : status === 'escalated'
        ? 'Escalated for legal review'
        : status === 'failed'
          ? 'Analysis failed'
          : status === 'running'
            ? 'Analysis running'
            : 'Awaiting analysis';
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded border ${tone}`}>{label}</span>
  );
}

export function AnalysisPanel({ matterId }: Props) {
  const { data } = trpc.analysis.forMatter.useQuery(
    { matterId },
    {
      refetchInterval: (q) => {
        const s = q.state.data;
        if (!s) return false;
        if (s.analysis.status === 'running') return 2000;
        if (s.stages.some((st) => st.status === 'running')) return 2000;
        return false;
      },
    },
  );

  if (!data) {
    return (
      <div className="bg-white dark:bg-ink-900 border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-medium">Analysis</h2>
          <StatusPill status="pending" />
        </div>
        <div className="text-sm text-ink-500 dark:text-ink-400">
          The pre-review analysis pipeline has not run for this matter yet.
        </div>
        <div className="mt-4 border-t pt-3">
          <LawyerToolbar matterId={matterId} />
        </div>
      </div>
    );
  }

  const { analysis, stages } = data;
  const preMeritsStage = stages.find((s) => s.stageName === 'pre_merits');
  const guidanceStage = stages.find((s) => s.stageName === 'guidance');
  const statutoryStages = stages.filter((s) => s.stageName === 'statutory');
  const caseLawStages = stages.filter((s) => s.stageName === 'case_law');

  const preMerits = preMeritsStage?.outputJson as PreMeritsOutput | undefined;
  const guidance = guidanceStage?.outputJson as GuidanceOutput | undefined;

  const status: 'matched' | 'escalated' | 'failed' | 'running' =
    analysis.status === 'failed'
      ? 'failed'
      : analysis.status === 'running'
        ? 'running'
        : guidance?.verdict === 'matched'
          ? 'matched'
          : 'escalated';

  const highSeverityIds = preMerits?.raisedHighSeverity ?? [];
  const headline = guidance?.headlineAnswer ?? null;

  return (
    <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-medium">Analysis</h2>
        <div className="flex items-center gap-2">
          <StatusPill status={status} />
          {analysis.overallConfidence !== 'N_A' && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-ink-50 dark:bg-ink-800 text-ink-600 dark:text-ink-400">
              {analysis.overallConfidence}
            </span>
          )}
        </div>
      </div>

      {status === 'matched' && headline && (
        <div className="border-l-2 border-emerald-500 pl-3">
          <div className="text-xs text-emerald-700 dark:text-emerald-300 font-medium mb-1">
            On-point guidance · {headline.citation}
          </div>
          <p className="text-sm text-ink-800 dark:text-ink-200 whitespace-pre-wrap">
            {headline.summary}
          </p>
          {headline.sourceUrl && (
            <a
              href={headline.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs text-brand-700 dark:text-brand-300 hover:underline"
            >
              View source in Notion →
            </a>
          )}
        </div>
      )}

      {status === 'escalated' && (
        <div className="border-l-2 border-amber-500 pl-3">
          <div className="text-xs text-amber-700 dark:text-amber-300 font-medium mb-1">
            No on-point playbook hit — lawyer review needed
          </div>
          {analysis.escalationReason && (
            <p className="text-sm text-ink-700 dark:text-ink-300">{analysis.escalationReason}</p>
          )}
        </div>
      )}

      {highSeverityIds.length > 0 && (
        <div>
          <div className="text-xs font-medium text-ink-600 dark:text-ink-400 mb-2">
            Pre-merits flags ({highSeverityIds.length} high-severity)
          </div>
          <ul className="space-y-1.5">
            {preMerits?.findings
              .filter((f) => highSeverityIds.includes(f.id))
              .map((f) => (
                <li
                  key={f.id}
                  className="text-xs border-l-2 border-red-500 pl-2 py-0.5"
                  title={f.oneLineJustification}
                >
                  <span className="font-mono text-red-700 dark:text-red-300">{f.id}</span>
                  {f.evidenceQuote && (
                    <span className="ml-2 italic text-ink-600 dark:text-ink-400">
                      "{f.evidenceQuote.slice(0, 120)}
                      {f.evidenceQuote.length > 120 ? '…' : ''}"
                    </span>
                  )}
                </li>
              ))}
          </ul>
        </div>
      )}

      {guidance && guidance.grades.length > 0 && status !== 'matched' && (
        <div>
          <div className="text-xs font-medium text-ink-600 dark:text-ink-400 mb-2">
            Closest related guidance
          </div>
          <ul className="space-y-1.5">
            {guidance.grades
              .sort((a, b) => b.onPointScore - a.onPointScore)
              .slice(0, 3)
              .map((g, i) => (
                <li key={i} className="text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {g.candidate.url ? (
                        <a
                          href={g.candidate.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-700 dark:text-brand-300 hover:underline"
                        >
                          {g.candidate.title}
                        </a>
                      ) : (
                        g.candidate.title
                      )}
                    </span>
                    <span className="font-mono text-ink-400 dark:text-ink-500 shrink-0">
                      {Math.round(g.onPointScore * 100)}%
                    </span>
                  </div>
                  <div className="text-ink-500 dark:text-ink-400 italic">{g.oneLineRationale}</div>
                </li>
              ))}
          </ul>
        </div>
      )}

      {statutoryStages.map((s) => (
        <StatutoryStageCard
          key={s.id}
          status={s.status}
          durationMs={s.durationMs}
          output={s.outputJson as unknown as Parameters<typeof StatutoryStageCard>[0]['output']}
        />
      ))}

      {caseLawStages.map((s) => (
        <CaseLawStageCard
          key={s.id}
          status={s.status}
          durationMs={s.durationMs}
          output={s.outputJson as unknown as Parameters<typeof CaseLawStageCard>[0]['output']}
        />
      ))}

      <div className="border-t pt-3 space-y-1.5">
        <div className="text-xs font-medium text-ink-600 dark:text-ink-400">Stage trace</div>
        {stages.map((s) => (
          <StageTraceDrawer
            key={s.id}
            stageId={s.id}
            stageName={s.stageName}
            status={s.status}
            confidence={s.confidence}
            outputJson={s.outputJson as Record<string, unknown>}
            durationMs={s.durationMs}
          />
        ))}
      </div>

      <div className="border-t pt-3">
        <LawyerToolbar matterId={matterId} />
      </div>
    </div>
  );
}

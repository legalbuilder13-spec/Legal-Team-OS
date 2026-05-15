'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc';
import { AnalysisStepsContent } from '../../analysis-steps/steps';

interface Props {
  matterId: string;
}

interface PreMeritsFinding {
  id: string;
  status: 'raised' | 'not_raised' | 'cant_tell';
  confidence: number;
  evidenceQuote: string;
  oneLineJustification: string;
}

interface PreMeritsOutput {
  practiceArea: string;
  checklistVersion: string;
  findings: PreMeritsFinding[];
  raisedHighSeverity: string[];
}

interface GuidanceGrade {
  candidate: { title: string; url?: string };
  onPointScore: number;
  jurisdictionMatch: boolean;
  oneLineRationale: string;
}

interface GuidanceOutput {
  verdict: 'matched' | 'related_only' | 'no_hit';
  queriesRun: string[];
  grades: GuidanceGrade[];
  topMatch: { candidate: { title: string; url?: string }; onPointScore: number } | null;
  headlineAnswer: { summary: string; citation: string; sourceUrl?: string } | null;
}

export function PlainEnglishTrace({ matterId }: Props) {
  const [open, setOpen] = useState(false);
  const { data } = trpc.analysis.forMatter.useQuery({ matterId }, { enabled: open });

  return (
    <div className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-ink-50 dark:hover:bg-ink-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-ink-400 dark:text-ink-500 text-xs">{open ? '▾' : '▸'}</span>
          <span className="text-sm font-medium text-ink-900 dark:text-ink-50">
            How this analysis ran (plain English)
          </span>
        </div>
        <span className="text-[11px] text-ink-500 dark:text-ink-400">
          Step-by-step walkthrough for this matter
        </span>
      </button>

      {open && (
        <div className="border-t border-ink-100 dark:border-ink-800 px-4 py-5 bg-ink-50/30 dark:bg-ink-950/30">
          {!data && (
            <div className="text-sm text-ink-500 dark:text-ink-400">Loading trace…</div>
          )}
          {data && (
            <>
              <p className="text-[12.5px] text-ink-600 dark:text-ink-400 mb-4">
                Each card below explains one step of the pipeline. The highlighted &ldquo;This
                matter&rdquo; section shows what actually happened for this specific analysis.
                For the generic walkthrough,{' '}
                <Link
                  href="/analysis-steps"
                  className="text-brand-700 dark:text-brand-300 hover:underline"
                >
                  see the Analysis Steps tab
                </Link>
                .
              </p>
              <AnalysisStepsContent perMatter={buildPerMatter(data)} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface AnalysisData {
  analysis: {
    status: string;
    overallConfidence: string;
    escalationReason?: string | null;
  };
  stages: Array<{
    stageName: string;
    status: string;
    confidence: string;
    durationMs: number;
    outputJson: unknown;
  }>;
}

function buildPerMatter(data: AnalysisData): {
  step1?: ReactNode;
  step4?: ReactNode;
  step5?: ReactNode;
  step5b?: ReactNode;
  step6?: ReactNode;
  step8?: ReactNode;
} {
  const preMeritsStage = data.stages.find((s) => s.stageName === 'pre_merits');
  const guidanceStage = data.stages.find((s) => s.stageName === 'guidance');
  const preMerits = preMeritsStage?.outputJson as PreMeritsOutput | undefined;
  const guidance = guidanceStage?.outputJson as GuidanceOutput | undefined;

  const out: ReturnType<typeof buildPerMatter> = {};

  out.step1 = (
    <p>
      Analysis ran to completion — the matter had a title and summary ready, so no retry was
      needed.
    </p>
  );

  if (preMerits) {
    const raised = preMerits.findings.filter((f) => f.status === 'raised');
    const cantTell = preMerits.findings.filter((f) => f.status === 'cant_tell');
    const highSev = preMerits.raisedHighSeverity ?? [];
    out.step4 = (
      <div className="space-y-1.5">
        <p>
          Ran the <strong>{preMerits.practiceArea}</strong> checklist (version{' '}
          <code className="font-mono text-[11.5px] bg-ink-100 dark:bg-ink-800 px-1 py-0.5 rounded">
            {preMerits.checklistVersion}
          </code>
          ).
        </p>
        <ul className="list-disc pl-5 space-y-0.5">
          <li>
            <strong>{raised.length}</strong> issue{raised.length === 1 ? '' : 's'} raised
            {highSev.length > 0 && (
              <>
                {' '}
                — <span className="text-red-700 dark:text-red-300">{highSev.length} high-severity</span>
              </>
            )}
          </li>
          {cantTell.length > 0 && (
            <li>
              <strong>{cantTell.length}</strong> item{cantTell.length === 1 ? '' : 's'} the AI
              couldn&apos;t determine from the request text
            </li>
          )}
          <li>Stage confidence: <strong>{preMeritsStage?.confidence}</strong></li>
        </ul>
      </div>
    );
  } else {
    out.step4 = <p className="text-ink-500 dark:text-ink-400">Stage 0 did not run for this matter.</p>;
  }

  if (guidance) {
    const verdictLabel =
      guidance.verdict === 'matched'
        ? 'Matched a playbook'
        : guidance.verdict === 'related_only'
          ? 'Found related guidance only'
          : 'No on-point guidance found';
    out.step5 = (
      <div className="space-y-1.5">
        <p>
          <strong>{verdictLabel}.</strong>{' '}
          {guidance.grades.length} candidate{guidance.grades.length === 1 ? '' : 's'} retrieved
          and graded.
        </p>
        {guidance.queriesRun.length > 0 && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-ink-500 dark:text-ink-400 mt-2 mb-1">
              Queries run
            </div>
            <ul className="list-disc pl-5 space-y-0.5">
              {guidance.queriesRun.map((q, i) => (
                <li key={i}>
                  <code className="font-mono text-[11.5px] bg-ink-100 dark:bg-ink-800 px-1 py-0.5 rounded">
                    {q}
                  </code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {guidance.topMatch && (
          <p className="mt-2">
            <strong>Top match:</strong>{' '}
            {guidance.topMatch.candidate.url ? (
              <a
                href={guidance.topMatch.candidate.url}
                target="_blank"
                rel="noreferrer"
                className="text-brand-700 dark:text-brand-300 hover:underline"
              >
                {guidance.topMatch.candidate.title}
              </a>
            ) : (
              guidance.topMatch.candidate.title
            )}{' '}
            <span className="font-mono text-ink-500 dark:text-ink-400">
              ({Math.round(guidance.topMatch.onPointScore * 100)}%)
            </span>
          </p>
        )}
        {guidance.headlineAnswer && (
          <div className="mt-2 border-l-2 border-emerald-500 pl-2">
            <div className="text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
              Headline answer · {guidance.headlineAnswer.citation}
            </div>
            <p className="text-[13px] mt-0.5">{guidance.headlineAnswer.summary}</p>
          </div>
        )}
        <p className="mt-1">Stage confidence: <strong>{guidanceStage?.confidence}</strong></p>
      </div>
    );

    out.step5b = (
      <p>
        Canon-tier boosts were applied to any candidate that maps to a registered playbook row.
        Whether the boost flipped the top pick depends on the registry state at analysis time —
        see the raw stage JSON in the Stage trace section below for the boosted vs. unboosted
        scores.
      </p>
    );
  } else {
    out.step5 = <p className="text-ink-500 dark:text-ink-400">Stage 1 did not run for this matter.</p>;
  }

  const verdict =
    data.analysis.status === 'failed'
      ? 'failed'
      : data.analysis.status === 'running'
        ? 'still running'
        : guidance?.verdict === 'matched'
          ? 'matched (complete)'
          : 'escalated';
  out.step6 = (
    <div className="space-y-1">
      <p>
        Final verdict: <strong>{verdict}</strong>.
      </p>
      <p>
        Overall confidence: <strong>{data.analysis.overallConfidence}</strong>.
      </p>
      {data.analysis.escalationReason && (
        <p className="text-ink-600 dark:text-ink-400 italic">
          Reason: {data.analysis.escalationReason}
        </p>
      )}
    </div>
  );

  out.step8 = (
    <p className="text-ink-600 dark:text-ink-400">
      No Slack message was posted — the pipeline is running in shadow mode. Once shadow mode is
      lifted, this step will fire automatically on future analyses.
    </p>
  );

  return out;
}

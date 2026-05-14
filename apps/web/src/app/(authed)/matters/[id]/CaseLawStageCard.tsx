'use client';

import { useState } from 'react';
import { StageDecisionBar } from './StageDecisionBar';

// PRD §6.1 / §11. Case-law tool output card. Shows controlling +
// persuasive authority side-by-side, then analogous + anti-analogous
// cases, then mirror-image argument, then verification footer.

type CourtLevel =
  | 'scotus' | 'circuit' | 'district' | 'state_high'
  | 'state_intermediate' | 'state_trial' | 'agency' | 'other';

interface CaseSummary {
  cite: string;
  case_name: string;
  court_level: CourtLevel;
  jurisdiction: string;
  holding: string;
  why_relevant: string;
  treatment: 'good_law' | 'negative_history' | 'overruled' | 'distinguished' | 'unverified';
  depth: 'majority' | 'concurrence' | 'dissent' | 'dicta';
  opinion_id: string;
}

interface AnalogousCase {
  case: CaseSummary;
  analogy_strength: number;
  factual_overlap: string;
}

interface AntiAnalogousCase {
  case: CaseSummary;
  why_distinguishable: string;
  severity_for_matter: 'case_killer' | 'significant' | 'manageable';
}

interface CaseLawOutput {
  controlling_authority: CaseSummary[];
  persuasive_authority: CaseSummary[];
  circuit_split_present: boolean;
  split_summary: string | null;
  analogous_cases: AnalogousCase[];
  anti_analogous_cases: AntiAnalogousCase[];
  mirror_image_argument: string;
  confidence_self_assessment: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_basis: string;
  verify_flags: string[];
  negative_result_strategies: Array<'full_text' | 'jurisdiction_filter' | 'citator_traversal'>;
  verification?: {
    candidates_total: number;
    invented_cites: string[];
    missing_adversarial: boolean;
    missing_mirror_image: boolean;
    negative_strategies: string[];
  };
  worker_confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPLIT' | 'N_A';
}

interface Props {
  output: CaseLawOutput;
  status: string;
  durationMs: number;
  stageId: string;
  matterId: string;
  lawyerDecision: 'pending' | 'accepted' | 'rejected' | 'escalated';
  lawyerDecidedAt?: string | null;
  lawyerDecisionReason?: string | null;
}

function TreatmentPill({ t }: { t: CaseSummary['treatment'] }) {
  const tone =
    t === 'good_law'
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : t === 'negative_history'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
        : t === 'overruled'
          ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900'
          : 'bg-ink-50 dark:bg-ink-800 text-ink-600 dark:text-ink-400 border-ink-200 dark:border-ink-700';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>
      {t.replace(/_/g, ' ')}
    </span>
  );
}

function CaseRow({ c }: { c: CaseSummary }) {
  return (
    <div className="text-xs border-l-2 border-brand-500 pl-2 py-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-brand-700 dark:text-brand-300">{c.cite}</span>
        <span className="italic text-ink-700 dark:text-ink-300">{c.case_name}</span>
        <TreatmentPill t={c.treatment} />
        <span className="text-[10px] uppercase text-ink-400 dark:text-ink-500">{c.depth}</span>
      </div>
      <div className="mt-1 text-ink-800 dark:text-ink-200">{c.holding}</div>
      <div className="mt-0.5 text-ink-500 dark:text-ink-400 italic">{c.why_relevant}</div>
    </div>
  );
}

function Section({
  title,
  children,
  defaultOpen = true,
  count,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-100"
      >
        <span className="text-ink-400">{open ? '▾' : '▸'}</span>
        {title}
        {typeof count === 'number' && (
          <span className="text-ink-400 dark:text-ink-500">({count})</span>
        )}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

export function CaseLawStageCard({
  output,
  status,
  durationMs,
  stageId,
  matterId,
  lawyerDecision,
  lawyerDecidedAt,
  lawyerDecisionReason,
}: Props) {
  if (status === 'failed') {
    return (
      <div className="border rounded-lg p-3 bg-red-50/30 dark:bg-red-950/20 border-red-200 dark:border-red-900">
        <div className="text-sm font-medium text-red-700 dark:text-red-300">
          Case-law research failed
        </div>
        <pre className="mt-1 text-[11px] font-mono text-red-700 dark:text-red-300 overflow-x-auto">
          {JSON.stringify(output, null, 2).slice(0, 400)}
        </pre>
      </div>
    );
  }

  const ver = output.verification;
  const failures: string[] = [];
  if (ver?.invented_cites && ver.invented_cites.length > 0)
    failures.push(`${ver.invented_cites.length} invented cite(s) dropped`);
  if (ver?.missing_adversarial) failures.push('missing adversarial doubling');
  if (ver?.missing_mirror_image) failures.push('missing or trivial mirror-image argument');
  const verified = failures.length === 0;
  const negStrats = ver?.negative_strategies ?? output.negative_result_strategies ?? [];

  return (
    <div className="border rounded-lg p-3 bg-white dark:bg-ink-900 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium">Case-Law Research</h3>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {verified ? (
            <span className="px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
              verified
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              {failures.length} check{failures.length === 1 ? '' : 's'} failed
            </span>
          )}
          <span className="text-ink-400 dark:text-ink-500">{durationMs}ms</span>
        </div>
      </div>

      {negStrats.length === 3 && (
        <div className="border-l-2 border-amber-500 pl-3 text-xs text-amber-700 dark:text-amber-300">
          All three retrieval strategies returned no useful authority. PRD §14.1 considers
          this a negative-result finding, not a pipeline failure — broaden the search or
          escalate.
        </div>
      )}

      {output.circuit_split_present && output.split_summary && (
        <div className="border-l-2 border-amber-500 pl-3 text-xs">
          <span className="font-medium text-amber-700 dark:text-amber-300">Circuit split:</span>{' '}
          <span className="text-ink-800 dark:text-ink-200">{output.split_summary}</span>
        </div>
      )}

      {output.controlling_authority.length > 0 && (
        <Section title="Controlling authority" count={output.controlling_authority.length}>
          {output.controlling_authority.map((c, i) => (
            <CaseRow key={i} c={c} />
          ))}
        </Section>
      )}

      {output.persuasive_authority.length > 0 && (
        <Section
          title="Persuasive authority"
          count={output.persuasive_authority.length}
          defaultOpen={false}
        >
          {output.persuasive_authority.map((c, i) => (
            <CaseRow key={i} c={c} />
          ))}
        </Section>
      )}

      {output.analogous_cases.length > 0 && (
        <Section title="Analogous cases (pro)" count={output.analogous_cases.length}>
          {output.analogous_cases.map((a, i) => (
            <div key={i} className="text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="italic text-ink-700 dark:text-ink-300">{a.case.case_name}</span>
                <span className="font-mono text-ink-400 dark:text-ink-500">
                  {Math.round(a.analogy_strength * 100)}% overlap
                </span>
              </div>
              <div className="text-ink-600 dark:text-ink-400">{a.factual_overlap}</div>
            </div>
          ))}
        </Section>
      )}

      <Section title="Anti-analogous cases (con)" count={output.anti_analogous_cases.length}>
        {output.anti_analogous_cases.length === 0 && (
          <div className="text-xs text-red-700 dark:text-red-300 italic">
            None — adversarial doubling missing. Worker forced confidence to LOW.
          </div>
        )}
        {output.anti_analogous_cases.map((a, i) => (
          <div key={i} className="text-xs border-l-2 border-red-500 pl-2 py-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="italic text-ink-700 dark:text-ink-300">{a.case.case_name}</span>
              <span
                className={`text-[10px] font-mono uppercase px-1 py-0.5 rounded border ${
                  a.severity_for_matter === 'case_killer'
                    ? 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
                    : a.severity_for_matter === 'significant'
                      ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
                      : 'border-ink-200 dark:border-ink-700 text-ink-500 dark:text-ink-400'
                }`}
              >
                {a.severity_for_matter.replace(/_/g, ' ')}
              </span>
            </div>
            <div className="text-ink-700 dark:text-ink-300">{a.why_distinguishable}</div>
          </div>
        ))}
      </Section>

      <Section title="Mirror-image argument">
        <p className="text-xs italic text-ink-700 dark:text-ink-300">
          {output.mirror_image_argument}
        </p>
      </Section>

      {output.verify_flags.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300 mb-1">
            Verify flags
          </div>
          <ul className="text-xs space-y-0.5 list-disc ml-4 text-ink-700 dark:text-ink-300">
            {output.verify_flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!verified && (
        <div className="border-t pt-2 bg-red-50/30 dark:bg-red-950/20 -mx-3 -mb-3 px-3 pb-3">
          <div className="text-[10px] font-medium uppercase text-red-700 dark:text-red-300 mb-1">
            Verification failures
          </div>
          <ul className="text-xs space-y-0.5 ml-3 list-disc text-red-700 dark:text-red-300">
            {failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
            Worker forced confidence to LOW per PRD §11.2 non-negotiables.
          </div>
        </div>
      )}

      <StageDecisionBar
        stageId={stageId}
        currentDecision={lawyerDecision}
        decidedAtIso={lawyerDecidedAt ?? null}
        decisionReason={lawyerDecisionReason ?? null}
        matterId={matterId}
      />
    </div>
  );
}

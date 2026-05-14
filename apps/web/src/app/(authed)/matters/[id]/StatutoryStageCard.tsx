'use client';

import { useState } from 'react';
import { StageDecisionBar } from './StageDecisionBar';

// PRD §6.1 / §8. Dedicated rendering for a 'statutory' stage row from
// the run-statutory tool. Shows the operative provisions with verbatim
// quotes, definitions, both readings (textualist + purposivist) with
// the gap, ambiguities, canons, mirror-image argument, and notable
// absences. Verification banner up top reflects the worker's gate.

interface OperativeProvision {
  citation: string;
  quoted_text: string;
  who_subject: string;
  what_required: string;
  when_applies?: string | null;
}

interface Definition {
  term: string;
  definition_quoted: string;
  scope_effect: 'narrows' | 'expands' | 'clarifies' | 'neutral';
}

interface Ambiguity {
  type: 'semantic' | 'syntactic' | 'latent' | 'vagueness';
  text: string;
  alternative_readings: string[];
  why_ambiguous: string;
}

interface CanonApplication {
  canon_id: string;
  supports_reading: 'A' | 'B' | 'neutral';
  one_line_rationale: string;
  weight: 'high' | 'medium' | 'low';
}

interface NotableAbsence {
  item: string;
  significance: string;
}

interface StatutoryOutput {
  operative_provisions: OperativeProvision[];
  definitions_used: Definition[];
  applicability_to_facts: string;
  ambiguities: Ambiguity[];
  canons_applied: CanonApplication[];
  textualist_reading: string;
  purposivist_reading: string;
  gap_between_readings: string;
  mirror_image_argument: string;
  notable_absences: NotableAbsence[];
  confidence_self_assessment: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_basis: string;
  verify_flags: string[];
  verification?: { passed: boolean; failures: string[] };
  worker_confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPLIT' | 'N_A';
  // PR7 — set by run-statutory; one stage row per jurisdiction.
  jurisdiction?: string;
}

interface Props {
  output: StatutoryOutput;
  status: string;
  durationMs: number;
  stageId: string;
  matterId: string;
  lawyerDecision: 'pending' | 'accepted' | 'rejected' | 'escalated';
  lawyerDecidedAt?: string | null;
  lawyerDecisionReason?: string | null;
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t pt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-xs font-medium text-ink-700 dark:text-ink-300 hover:text-ink-900 dark:hover:text-ink-100"
      >
        <span className="text-ink-400">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open && <div className="mt-2 space-y-2">{children}</div>}
    </div>
  );
}

export function StatutoryStageCard({
  output,
  status,
  durationMs,
  stageId,
  matterId,
  lawyerDecision,
  lawyerDecidedAt,
  lawyerDecisionReason,
}: Props) {
  const verified = output.verification?.passed ?? false;
  const failures = output.verification?.failures ?? [];

  if (status === 'failed') {
    return (
      <div className="border rounded-lg p-3 bg-red-50/30 dark:bg-red-950/20 border-red-200 dark:border-red-900">
        <div className="text-sm font-medium text-red-700 dark:text-red-300">
          Statutory research failed
        </div>
        <pre className="mt-1 text-[11px] font-mono text-red-700 dark:text-red-300 overflow-x-auto">
          {JSON.stringify(output, null, 2).slice(0, 400)}
        </pre>
      </div>
    );
  }

  return (
    <div className="border rounded-lg p-3 bg-white dark:bg-ink-900 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-sm font-medium">Statutory & Regulatory Research</h3>
          {output.jurisdiction && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-brand-200 dark:border-brand-800 bg-brand-50 dark:bg-brand-950/40 text-brand-700 dark:text-brand-300">
              {output.jurisdiction}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {verified ? (
            <span className="px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
              quotes verified
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              {failures.length} quote{failures.length === 1 ? '' : 's'} unverified
            </span>
          )}
          <span className="text-ink-400 dark:text-ink-500">{durationMs}ms</span>
        </div>
      </div>

      <div className="text-sm">
        <div className="text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">Application to facts</div>
        <p className="text-ink-800 dark:text-ink-200 whitespace-pre-wrap">{output.applicability_to_facts}</p>
      </div>

      <Section title={`Operative provisions (${output.operative_provisions.length})`}>
        {output.operative_provisions.map((p, i) => (
          <div key={i} className="text-xs border-l-2 border-brand-500 pl-2 py-1">
            <div className="font-mono text-brand-700 dark:text-brand-300">{p.citation}</div>
            <blockquote className="mt-1 italic text-ink-700 dark:text-ink-300">"{p.quoted_text}"</blockquote>
            <div className="mt-1 text-ink-500 dark:text-ink-400">
              <span className="font-medium">Who:</span> {p.who_subject}
              {' · '}
              <span className="font-medium">Required:</span> {p.what_required}
            </div>
          </div>
        ))}
      </Section>

      {output.definitions_used.length > 0 && (
        <Section title={`Definitions (${output.definitions_used.length})`} defaultOpen={false}>
          {output.definitions_used.map((d, i) => (
            <div key={i} className="text-xs">
              <span className="font-mono text-ink-700 dark:text-ink-300">{d.term}</span>
              <span className="ml-2 text-[10px] px-1 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-400">
                {d.scope_effect}
              </span>
              <blockquote className="mt-0.5 italic text-ink-600 dark:text-ink-400">
                "{d.definition_quoted}"
              </blockquote>
            </div>
          ))}
        </Section>
      )}

      <Section title="Two readings + the gap">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="border rounded p-2">
            <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
              Textualist
            </div>
            <p className="text-ink-800 dark:text-ink-200">{output.textualist_reading}</p>
          </div>
          <div className="border rounded p-2">
            <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
              Purposivist
            </div>
            <p className="text-ink-800 dark:text-ink-200">{output.purposivist_reading}</p>
          </div>
        </div>
        <div className="text-xs">
          <div className="text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300 mb-1">Gap</div>
          <p className="text-ink-700 dark:text-ink-300">{output.gap_between_readings}</p>
        </div>
      </Section>

      {output.ambiguities.length > 0 && (
        <Section title={`Ambiguities (${output.ambiguities.length})`}>
          {output.ambiguities.map((a, i) => (
            <div key={i} className="text-xs border-l-2 border-amber-500 pl-2 py-1">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono uppercase text-amber-700 dark:text-amber-300">
                  {a.type}
                </span>
                <span className="italic text-ink-700 dark:text-ink-300">"{a.text}"</span>
              </div>
              {a.alternative_readings.length > 0 && (
                <ul className="mt-1 ml-3 space-y-0.5 list-disc text-ink-600 dark:text-ink-400">
                  {a.alternative_readings.map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                </ul>
              )}
              <div className="mt-1 text-ink-500 dark:text-ink-400">{a.why_ambiguous}</div>
            </div>
          ))}
        </Section>
      )}

      {output.canons_applied.length > 0 && (
        <Section title={`Canons applied (${output.canons_applied.length})`} defaultOpen={false}>
          <ul className="text-xs space-y-0.5">
            {output.canons_applied.map((c, i) => (
              <li key={i}>
                <span className="font-mono">{c.canon_id}</span>
                <span className="ml-1 text-[10px] text-ink-400">[{c.weight}]</span>
                <span className="ml-1 text-ink-500 dark:text-ink-400">→ {c.one_line_rationale}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Mirror-image argument (strongest reading against)">
        <p className="text-xs text-ink-700 dark:text-ink-300 italic">
          {output.mirror_image_argument}
        </p>
      </Section>

      {output.notable_absences.length > 0 && (
        <Section title={`What the statute doesn't say (${output.notable_absences.length})`} defaultOpen={false}>
          <ul className="text-xs space-y-0.5">
            {output.notable_absences.map((a, i) => (
              <li key={i}>
                <span className="font-medium text-ink-700 dark:text-ink-300">{a.item}</span>
                <span className="ml-1 text-ink-500 dark:text-ink-400">— {a.significance}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

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

      {!verified && failures.length > 0 && (
        <div className="border-t pt-2 bg-red-50/30 dark:bg-red-950/20 -mx-3 -mb-3 px-3 pb-3">
          <div className="text-[10px] font-medium uppercase text-red-700 dark:text-red-300 mb-1">
            Quote-verification failures
          </div>
          <ul className="text-xs space-y-0.5 ml-3 list-disc text-red-700 dark:text-red-300">
            {failures.slice(0, 3).map((f, i) => (
              <li key={i}>{f}</li>
            ))}
            {failures.length > 3 && (
              <li className="italic text-red-600 dark:text-red-400">… and {failures.length - 3} more</li>
            )}
          </ul>
          <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
            Worker forced confidence to LOW. Lawyer review required before delivery.
          </div>
        </div>
      )}

      <StageDecisionBar
        stageId={stageId}
        stageName="statutory"
        workerConfidence={output.worker_confidence}
        currentDecision={lawyerDecision}
        decidedAtIso={lawyerDecidedAt ?? null}
        decisionReason={lawyerDecisionReason ?? null}
        matterId={matterId}
      />
    </div>
  );
}

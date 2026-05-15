'use client';

import { useState } from 'react';

// Decision tree for "where does this go?" — surfaces the right
// content table for a given intent. The five tables (playbooks,
// knowledge, rules, templates, patterns) overlap conceptually and
// authors regularly put the same idea in two places. This guide
// makes the choice explicit at create time.

type Kind = 'playbook' | 'knowledge_article' | 'rule' | 'template' | 'execution_pattern';

const TAXONOMY: Array<{
  question: string;
  kind: Kind;
  description: string;
  examples: string[];
}> = [
  {
    question: 'Is this a position the firm takes on a clause or issue?',
    kind: 'playbook',
    description:
      'Codifies how the firm responds. Cited in Stage 1 of analysis. M4 cron promotes high-acceptance playbooks.',
    examples: [
      'Standard indemnity carve-outs for BAAs',
      'Mutual-only IP cross-license',
      'Auto-renewal terms we never accept',
    ],
  },
  {
    question: 'Is this background information or context the AI should know?',
    kind: 'knowledge_article',
    description:
      'FAQ-style reference. Loaded into the triage prompt + searchable by the copilot. Not actionable on its own.',
    examples: [
      'How HIPAA differs from HITECH',
      'Definition of "common carrier" in our context',
      'When does GDPR apply to US-based vendors?',
    ],
  },
  {
    question: 'Is this conditional logic that should auto-fire on matters?',
    kind: 'rule',
    description:
      'Natural-language conditional. AI compiles to a structured DSL. Four flavors: SLA, routing, triage, playbook trigger. Has a draft → shadow → active → archived lifecycle.',
    examples: [
      'If counterparty mentions HIPAA, route to Sarah',
      'High-priority privacy matters → 4-hour SLA',
      'If matter type = "BAA", auto-attach the BAA playbook',
    ],
  },
  {
    question: 'Is this the actual clause text or document we want in drafts?',
    kind: 'template',
    description:
      'Draft starting point with placeholder variables. Picked from the drafting workspace. Tracks use_count and lastUsedAt.',
    examples: [
      'Standard NDA — bilateral',
      'BAA template for health-tech vendors',
      'Vendor MSA shell with our default clauses',
    ],
  },
  {
    question: 'Is this how the AI should analyze a document type?',
    kind: 'execution_pattern',
    description:
      'Admin/engineer-only. Maps an input type (document, fact_pattern, etc) to an output format (tagged_clauses, issue_memo, etc) with a prompt template.',
    examples: [
      'Vendor MSA → tagged clauses',
      'Privacy incident report → action checklist',
      'Demand letter → issue memo',
    ],
  },
];

const KIND_LABEL: Record<Kind, string> = {
  playbook: 'Playbook',
  knowledge_article: 'Knowledge article',
  rule: 'Rule',
  template: 'Template',
  execution_pattern: 'Execution pattern',
};

const KIND_TONE: Record<Kind, string> = {
  playbook: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  knowledge_article: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  rule: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  template: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  execution_pattern: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
};

interface Props {
  currentKind: Kind;
}

export function TaxonomyGuide({ currentKind }: Props) {
  const [open, setOpen] = useState(false);
  const current = TAXONOMY.find((t) => t.kind === currentKind);
  return (
    <div className="border rounded-lg bg-ink-50/50 dark:bg-ink-900/40 mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs"
      >
        <span className="text-ink-600 dark:text-ink-400">
          <span className="font-medium text-ink-700 dark:text-ink-300">Where does this go?</span>{' '}
          {current && <span>· You&apos;re creating a <span className={`px-1 rounded ${KIND_TONE[currentKind]}`}>{KIND_LABEL[currentKind].toLowerCase()}</span></span>}
        </span>
        <span className="text-ink-400 dark:text-ink-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-ink-200 dark:border-ink-800 space-y-2">
          <div className="text-[11px] text-ink-500 dark:text-ink-400">
            The five content tables overlap. Pick the one that matches your
            intent — the same idea in two places becomes a contradiction
            later.
          </div>
          <ul className="space-y-1.5">
            {TAXONOMY.map((t) => {
              const isCurrent = t.kind === currentKind;
              return (
                <li
                  key={t.kind}
                  className={`text-xs border rounded p-2 ${
                    isCurrent
                      ? 'border-brand-300 dark:border-brand-800 bg-white dark:bg-ink-900'
                      : 'border-ink-200 dark:border-ink-800'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide shrink-0 ${KIND_TONE[t.kind]}`}>
                      {KIND_LABEL[t.kind]}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium">{t.question}</div>
                      <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">
                        {t.description}
                      </div>
                      <div className="text-[11px] text-ink-400 dark:text-ink-500 mt-1 italic">
                        e.g. {t.examples.join(' · ')}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

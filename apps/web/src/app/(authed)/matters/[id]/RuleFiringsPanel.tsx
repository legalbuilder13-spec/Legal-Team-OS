'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PR #5 — "Why this happened" panel. Shows the chain of rules that
// produced this matter's classification, routing, and SLA. Each row
// links to the rule (so the lawyer can see the natural-language
// description) and offers an "Override" button that records a signal
// for the future rule-quality cron.

const ACTION_LABEL: Record<string, string> = {
  'matter.sla_rule_matched': 'SLA rule matched',
  'matter.routing_rule_matched': 'Routing rule matched',
  'matter.routing_default_used': 'No routing rule matched — used practice-area default',
  'matter.triage_rule_matched': 'Triage rule influenced classification',
};

const ACTION_TONE: Record<string, string> = {
  'matter.sla_rule_matched': 'border-amber-200 dark:border-amber-900',
  'matter.routing_rule_matched': 'border-sky-200 dark:border-sky-900',
  'matter.routing_default_used': 'border-ink-200 dark:border-ink-800',
  'matter.triage_rule_matched': 'border-violet-200 dark:border-violet-900',
};

interface Props {
  matterId: string;
}

export function RuleFiringsPanel({ matterId }: Props) {
  const utils = trpc.useUtils();
  const { data: firings = [], isLoading } = trpc.matters.ruleFirings.useQuery({ matterId });
  const override = trpc.matters.overrideRuleFiring.useMutation({
    onSuccess: () => utils.matters.ruleFirings.invalidate({ matterId }),
  });
  const [overridingId, setOverridingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  if (isLoading) return null;
  if (firings.length === 0) return null;

  return (
    <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
      <h2 className="font-medium mb-2">Why this happened</h2>
      <p className="text-xs text-ink-500 dark:text-ink-400 mb-3">
        Rules that ran against this matter and what they decided. Mark a
        firing as wrong to feed the rule-quality signal.
      </p>
      <ul className="space-y-2">
        {firings.map((f) => {
          const details = (f.details ?? {}) as Record<string, unknown>;
          const isOpen = overridingId === f.firingId;
          return (
            <li
              key={f.firingId}
              className={`border-l-4 pl-3 py-1 ${ACTION_TONE[f.action] ?? 'border-ink-200'}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium">
                    {ACTION_LABEL[f.action] ?? f.action}
                  </div>
                  {f.rule ? (
                    <div className="text-xs text-ink-600 dark:text-ink-400 mt-0.5">
                      <span className="font-mono text-[10px] text-ink-400">
                        [{f.rule.kind}]
                      </span>{' '}
                      <span className="font-medium">{f.rule.name}</span>
                      {f.rule.status !== 'active' && (
                        <span className="ml-1 text-[10px] text-amber-600 dark:text-amber-400">
                          ({f.rule.status})
                        </span>
                      )}
                      <div className="italic text-ink-500 dark:text-ink-400 line-clamp-2 mt-0.5">
                        "{f.rule.naturalText}"
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                      {Object.entries(details)
                        .filter(([k]) => k !== 'ruleId')
                        .slice(0, 3)
                        .map(([k, v]) => (
                          <div key={k}>
                            <span className="text-ink-400">{k}:</span>{' '}
                            <span>{String(v)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                  <div className="text-[10px] text-ink-400 dark:text-ink-500 mt-1">
                    {new Date(f.firedAt).toLocaleString()}
                  </div>
                </div>
                <div className="shrink-0">
                  {f.override ? (
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300"
                      title={f.override.reason ?? undefined}
                    >
                      overridden
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setOverridingId(isOpen ? null : f.firingId);
                        setReason('');
                      }}
                      className="text-[11px] text-ink-500 dark:text-ink-400 hover:underline"
                    >
                      {isOpen ? 'Cancel' : 'Override'}
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="mt-2 space-y-1.5">
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="Why was this rule's outcome wrong? (feeds the rule-quality cron)"
                    className="w-full text-xs border rounded px-2 py-1"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setOverridingId(null);
                        setReason('');
                      }}
                      className="text-[11px] px-2 py-0.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!reason.trim() || override.isPending}
                      onClick={() => {
                        override.mutate(
                          {
                            firingId: f.firingId,
                            matterId,
                            reason: reason.trim(),
                          },
                          {
                            onSuccess: () => {
                              setOverridingId(null);
                              setReason('');
                            },
                          },
                        );
                      }}
                      className="text-[11px] px-2 py-0.5 border rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {override.isPending ? 'Saving…' : 'Mark as wrong'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

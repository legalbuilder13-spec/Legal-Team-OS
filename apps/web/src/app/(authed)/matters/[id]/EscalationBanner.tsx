'use client';

// PR-11 — escalation banner. Renders when matter_analyses.escalated_at
// is set + escalation_reason carries the skill-supplied detail. The
// lawyer sees the escalation reason loudly above everything else.
// Visually distinct from frame-flip (amber) and absence (rose/amber/ink)
// — escalation is the highest-priority surface, dark red.

interface Props {
  escalatedAt: Date | string;
  reason: string | null;
}

export function EscalationBanner({ escalatedAt, reason }: Props) {
  const when =
    typeof escalatedAt === 'string'
      ? new Date(escalatedAt).toLocaleString()
      : escalatedAt.toLocaleString();

  // escalation_reason is stored as "<reason>: <detail>". Split for
  // display; fall back to the whole string if it doesn't follow the
  // pattern.
  const parts = (reason ?? 'unknown').split(': ');
  const reasonCode = parts[0] ?? 'unknown';
  const detail = parts.slice(1).join(': ');
  const reasonLabel = reasonCode.replace(/_/g, ' ');

  return (
    <div className="border-l-2 border-red-600 bg-red-50 dark:bg-red-950/40 dark:border-red-500 rounded-r-md p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-red-800 dark:text-red-200">
          Analysis escalated · {reasonLabel}
        </div>
        <span className="text-[10px] font-mono text-red-700/70 dark:text-red-300/70 shrink-0">
          {when}
        </span>
      </div>
      {detail && (
        <p className="text-sm text-ink-800 dark:text-ink-200">{detail}</p>
      )}
      <p className="text-[11px] text-red-700 dark:text-red-300 mt-1">
        Downstream stages were skipped. Resolve the underlying issue (re-route, supply missing facts,
        consult a senior) before re-running the pipeline.
      </p>
    </div>
  );
}

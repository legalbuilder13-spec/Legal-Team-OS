'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PR14 — admin dashboard for the four launch-gate metrics from PRD
// §20.1 + the shadow-mode-metrics.sql queries. Designed to answer
// "are we ready to flip ANALYSIS_PIPELINE_ENABLED from shadow to
// true." Tables only — no charts in v1. Lookback window is
// adjustable.

const WINDOWS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function MetricBlock({
  title,
  status,
  children,
}: {
  title: string;
  status?: 'pass' | 'warn' | 'fail' | 'neutral';
  children: React.ReactNode;
}) {
  const tone =
    status === 'pass'
      ? 'border-emerald-200 dark:border-emerald-900'
      : status === 'warn'
        ? 'border-amber-200 dark:border-amber-900'
        : status === 'fail'
          ? 'border-red-200 dark:border-red-900'
          : 'border-ink-200 dark:border-ink-700';
  return (
    <section className={`border rounded-lg p-4 ${tone}`}>
      <h2 className="text-base font-medium mb-3">{title}</h2>
      {children}
    </section>
  );
}

function Pct({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-ink-400 dark:text-ink-500">—</span>;
  return <span className="font-mono">{value}%</span>;
}

function Num({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-ink-400 dark:text-ink-500">—</span>;
  return <span className="font-mono">{value}</span>;
}

export default function AnalysisMetricsPage() {
  const [days, setDays] = useState(7);
  const { data, isLoading } = trpc.analysisMetrics.summary.useQuery({ lookbackDays: days });
  const { data: rejectionSummary } = trpc.rejectionThemes.summary.useQuery();

  return (
    <div className="max-w-5xl space-y-5">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Analysis pipeline metrics</h1>
          <p className="text-sm text-ink-600 dark:text-ink-400 mt-1">
            Launch-gate dashboard for{' '}
            <code>ANALYSIS_PIPELINE_ENABLED=shadow</code> → <code>true</code>. Live mirror of
            the shadow-mode-metrics SQL.
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              className={`text-xs px-2 py-1 border rounded ${
                w.days === days
                  ? 'bg-brand-600 text-white border-brand-700'
                  : 'hover:bg-ink-50 dark:hover:bg-ink-800'
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </header>

      {rejectionSummary && (rejectionSummary.pendingCount > 0 || rejectionSummary.actionedLast30d > 0) && (
        <a
          href="/admin/rejection-themes"
          className="block border rounded-lg p-3 hover:bg-ink-50 dark:hover:bg-ink-800 transition-colors"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">Rejection themes:</span>{' '}
              <span className="text-amber-700 dark:text-amber-300">
                <Num value={rejectionSummary.pendingCount} /> pending
              </span>
              {rejectionSummary.actionedLast30d > 0 && (
                <span className="text-emerald-700 dark:text-emerald-300 ml-2">
                  · <Num value={rejectionSummary.actionedLast30d} /> actioned in last 30d
                </span>
              )}
              {rejectionSummary.latestRun?.error && (
                <span className="text-red-700 dark:text-red-300 ml-2">
                  · last run errored
                </span>
              )}
            </div>
            <span className="text-xs text-ink-500 dark:text-ink-400">Review →</span>
          </div>
        </a>
      )}

      {isLoading || !data ? (
        <div className="text-ink-500 dark:text-ink-400">Loading…</div>
      ) : (
        <>
          {/* 1. Matched-rate per practice area */}
          <MetricBlock
            title={`Matched-rate by practice area (target > 20%)`}
            status={
              data.matchedRate.some((r) => (r.matched_pct ?? 0) >= 20) ? 'pass' : 'warn'
            }
          >
            {data.matchedRate.length === 0 ? (
              <div className="text-sm text-ink-400 dark:text-ink-500">No analyzed matters in this window.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="text-left font-medium">Practice area</th>
                    <th className="text-right font-medium">Analyzed</th>
                    <th className="text-right font-medium">Matched</th>
                    <th className="text-right font-medium">Match %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matchedRate.map((r) => (
                    <tr key={r.practice_area ?? 'null'} className="border-t">
                      <td className="py-1.5">{r.practice_area ?? '—'}</td>
                      <td className="text-right">
                        <Num value={r.analyzed} />
                      </td>
                      <td className="text-right">
                        <Num value={r.matched} />
                      </td>
                      <td
                        className={`text-right ${
                          (r.matched_pct ?? 0) >= 20
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        <Pct value={r.matched_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MetricBlock>

          {/* 2. LOW-confidence rate */}
          <MetricBlock
            title={`LOW-confidence rate (target < 30%)`}
            status={
              data.lowConfidence.low_pct == null
                ? 'neutral'
                : data.lowConfidence.low_pct < 30
                  ? 'pass'
                  : 'fail'
            }
          >
            <div className="text-sm">
              <Num value={data.lowConfidence.low} /> LOW of <Num value={data.lowConfidence.total} />{' '}
              completed analyses ·{' '}
              <Pct value={data.lowConfidence.low_pct} />
            </div>
          </MetricBlock>

          {/* 3. Latency */}
          <MetricBlock
            title={`End-to-end latency (target p50 < 60s)`}
            status={
              data.latency.p50_seconds == null
                ? 'neutral'
                : data.latency.p50_seconds < 60
                  ? 'pass'
                  : 'warn'
            }
          >
            <div className="text-sm space-x-4">
              <span>
                samples: <Num value={data.latency.samples} />
              </span>
              <span>
                p50:{' '}
                <span className="font-mono">
                  {data.latency.p50_seconds == null ? '—' : data.latency.p50_seconds.toFixed(1)}s
                </span>
              </span>
              <span>
                p95:{' '}
                <span className="font-mono">
                  {data.latency.p95_seconds == null ? '—' : data.latency.p95_seconds.toFixed(1)}s
                </span>
              </span>
            </div>
          </MetricBlock>

          {/* 4. Stage failure rate */}
          <MetricBlock
            title={`Stage failure rate (target < 5% per stage)`}
            status={
              data.stageFailures.length === 0
                ? 'neutral'
                : data.stageFailures.every((r) => (r.failure_pct ?? 0) < 5)
                  ? 'pass'
                  : 'fail'
            }
          >
            <table className="w-full text-sm">
              <thead className="text-xs text-ink-500 dark:text-ink-400">
                <tr>
                  <th className="text-left font-medium">Stage</th>
                  <th className="text-right font-medium">Total</th>
                  <th className="text-right font-medium">Failed</th>
                  <th className="text-right font-medium">Failure %</th>
                </tr>
              </thead>
              <tbody>
                {data.stageFailures.map((r) => (
                  <tr key={r.stage_name} className="border-t">
                    <td className="py-1.5">{r.stage_name}</td>
                    <td className="text-right">
                      <Num value={r.total} />
                    </td>
                    <td className="text-right">
                      <Num value={r.failed} />
                    </td>
                    <td
                      className={`text-right ${
                        (r.failure_pct ?? 0) < 5
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-red-700 dark:text-red-300'
                      }`}
                    >
                      <Pct value={r.failure_pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </MetricBlock>

          {/* 5. Verification-status breakdown */}
          <MetricBlock title="Verification-status breakdown (PRD §9)">
            {data.verificationStatus.length === 0 ? (
              <div className="text-sm text-ink-400 dark:text-ink-500">
                No source rows in this window.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="text-left font-medium">Status</th>
                    <th className="text-right font-medium">Rows</th>
                  </tr>
                </thead>
                <tbody>
                  {data.verificationStatus.map((r) => (
                    <tr key={r.verification_status} className="border-t">
                      <td className="py-1.5 font-mono">{r.verification_status}</td>
                      <td className="text-right">
                        <Num value={r.count} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MetricBlock>

          {/* 6. Lawyer override rate (PR10) */}
          <MetricBlock
            title={`Lawyer override rate (target < 15%, PRD §20.1)`}
            status={
              data.overrideRate.length === 0
                ? 'neutral'
                : data.overrideRate.every((r) => (r.override_pct ?? 0) < 15)
                  ? 'pass'
                  : 'fail'
            }
          >
            {data.overrideRate.length === 0 ? (
              <div className="text-sm text-ink-400 dark:text-ink-500">
                No decided stages yet (post-PR10 signal). The accept/reject controls write
                decisions to this table.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs text-ink-500 dark:text-ink-400">
                  <tr>
                    <th className="text-left font-medium">Stage</th>
                    <th className="text-right font-medium">Decided</th>
                    <th className="text-right font-medium">Accepted</th>
                    <th className="text-right font-medium">Rejected</th>
                    <th className="text-right font-medium">Escalated</th>
                    <th className="text-right font-medium">Override %</th>
                  </tr>
                </thead>
                <tbody>
                  {data.overrideRate.map((r) => (
                    <tr key={r.stage_name} className="border-t">
                      <td className="py-1.5">{r.stage_name}</td>
                      <td className="text-right">
                        <Num value={r.decided} />
                      </td>
                      <td className="text-right text-emerald-700 dark:text-emerald-300">
                        <Num value={r.accepted} />
                      </td>
                      <td className="text-right text-red-700 dark:text-red-300">
                        <Num value={r.rejected} />
                      </td>
                      <td className="text-right text-amber-700 dark:text-amber-300">
                        <Num value={r.escalated} />
                      </td>
                      <td
                        className={`text-right ${
                          (r.override_pct ?? 0) < 15
                            ? 'text-emerald-700 dark:text-emerald-300'
                            : 'text-red-700 dark:text-red-300'
                        }`}
                      >
                        <Pct value={r.override_pct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </MetricBlock>
        </>
      )}
    </div>
  );
}

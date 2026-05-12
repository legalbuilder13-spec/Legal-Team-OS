'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc';

const KIND_LABEL: Record<string, string> = {
  triaged: 'triaged',
  'status.changed': 'status changed',
  assigned: 'assigned',
  'sla.breached': 'SLA breached',
};

export default function DashboardPage() {
  const { data: summary } = trpc.dashboard.summary.useQuery();
  const { data: cycle } = trpc.dashboard.cycleTime.useQuery();
  const { data: trend } = trpc.dashboard.breachTrend.useQuery();
  const { data: attorneys } = trpc.dashboard.byAttorney.useQuery();
  const { data: activity } = trpc.dashboard.recentActivity.useQuery();

  const openCount =
    summary?.byStatus
      .filter((s) => s.status !== 'closed' && s.status !== 'cancelled')
      .reduce((acc, s) => acc + s.count, 0) ?? 0;
  const closedCount = summary?.byStatus.find((s) => s.status === 'closed')?.count ?? 0;

  const trendDelta = (trend?.current ?? 0) - (trend?.prior ?? 0);

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold mb-6">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard
          label="SLA breaches"
          value={summary?.slaBreaches ?? 0}
          tone={summary?.slaBreaches ? 'danger' : 'neutral'}
          sublabel={
            trend
              ? `${trend.current} new in last 7d (${trendDelta >= 0 ? '+' : ''}${trendDelta} vs prior)`
              : undefined
          }
        />
        <StatCard label="Open matters" value={openCount} />
        <StatCard
          label="Closed (30d)"
          value={cycle?.overall.count ?? 0}
          sublabel={
            cycle && cycle.overall.count > 0
              ? `mean cycle: ${formatHours(cycle.overall.avgHours)}`
              : undefined
          }
        />
        <StatCard label="Closed (all time)" value={closedCount} />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2 space-y-6">
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">Attorney load</h2>
            {!attorneys || attorneys.length === 0 ? (
              <div className="text-sm text-gray-500">No attorneys yet.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-gray-500">
                  <tr>
                    <th className="font-normal pb-1">Attorney</th>
                    <th className="font-normal pb-1 text-right">Open</th>
                    <th className="font-normal pb-1 text-right">Overdue</th>
                    <th className="font-normal pb-1 text-right">Closed (30d)</th>
                  </tr>
                </thead>
                <tbody>
                  {attorneys.map((a) => (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="py-1.5">{a.name}</td>
                      <td className="py-1.5 text-right">{a.open_count}</td>
                      <td
                        className={`py-1.5 text-right ${a.overdue_count > 0 ? 'text-red-600 font-medium' : ''}`}
                      >
                        {a.overdue_count}
                      </td>
                      <td className="py-1.5 text-right text-gray-500">{a.closed_30d}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">Cycle time by practice area (last 30d)</h2>
            {!cycle || cycle.byPracticeArea.length === 0 ? (
              <div className="text-sm text-gray-500">No matters closed in the last 30 days.</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {cycle.byPracticeArea.map((row) => (
                  <li
                    key={row.practiceArea ?? 'none'}
                    className="flex justify-between border-b last:border-b-0 border-gray-100 py-1"
                  >
                    <span className="capitalize">
                      {row.practiceArea ?? 'Unclassified'}{' '}
                      <span className="text-gray-400">({row.count})</span>
                    </span>
                    <span className="text-gray-600">{formatHours(row.avgHours)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">Open by practice area</h2>
            <ul className="space-y-1 text-sm">
              {summary?.byPracticeArea.map((row) => (
                <li key={row.practiceArea ?? 'none'} className="flex justify-between">
                  <span className="capitalize">{row.practiceArea ?? 'Unclassified'}</span>
                  <span>{row.count}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <aside className="space-y-4">
          <div className="bg-white border rounded-lg p-4">
            <h2 className="font-medium mb-3">Recent activity</h2>
            {!activity || activity.length === 0 ? (
              <div className="text-sm text-gray-500">Nothing yet.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {activity.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/matters/${e.matterId}`}
                      className="text-brand-700 hover:underline"
                    >
                      {e.matterShortId}
                    </Link>{' '}
                    <span className="text-gray-600">{KIND_LABEL[e.kind] ?? e.kind}</span>
                    <div className="text-xs text-gray-400">
                      {new Date(e.createdAt).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function StatCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
}: {
  label: string;
  value: number;
  sublabel?: string;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        tone === 'danger' ? 'border-red-200 bg-red-50' : 'bg-white'
      }`}
    >
      <div className="text-sm text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sublabel && <div className="text-xs text-gray-500 mt-1">{sublabel}</div>}
    </div>
  );
}

'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import { trpc } from '@/lib/trpc';

const KIND_LABEL: Record<string, string> = {
  triaged: 'AI triaged',
  'status.changed': 'status changed',
  assigned: 'assigned',
  'sla.breached': 'SLA breached',
  'note.added': 'note added',
  'draft.created': 'draft started',
  'draft.updated': 'draft updated',
  'escalation.created': 'escalated',
  'escalation.acknowledged': 'escalation ack',
  'escalation.resolved': 'escalation resolved',
  'notion.saved': 'saved to Notion',
  'drive.saved': 'saved to Drive',
};

const PRIORITY_COLOR: Record<string, string> = {
  urgent: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  medium: 'bg-amber-100 text-amber-800',
  low: 'bg-gray-100 text-gray-700',
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-red-200 bg-red-50',
  medium: 'border-amber-200 bg-amber-50',
  low: 'border-blue-200 bg-blue-50',
};

export default function DashboardPage() {
  const { user } = useUser();
  const { data: mine, isLoading } = trpc.dashboard.mine.useQuery();
  const { data: escalations = [], refetch: refetchEsc } = trpc.escalations.list.useQuery({
    status: 'open',
    mineOnly: true,
    limit: 5,
  });
  const ackEsc = trpc.escalations.acknowledge.useMutation({ onSuccess: () => refetchEsc() });

  const { data: insights = [], refetch: refetchInsights } = trpc.admin.listInsights.useQuery({
    status: 'active',
  });
  const dismissInsight = trpc.admin.dismissInsight.useMutation({
    onSuccess: () => refetchInsights(),
  });

  const firstName = user?.firstName ?? null;
  const stats = mine?.stats;

  return (
    <div className="max-w-7xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">
          {firstName ? `Welcome back, ${firstName}` : 'Dashboard'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Your queue, drafts, and escalations at a glance.
        </p>
      </header>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatCard
          label="Open matters"
          value={stats?.open ?? 0}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="SLA breached"
          value={stats?.breached ?? 0}
          tone={stats?.breached ? 'danger' : 'neutral'}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="Due in 48h"
          value={stats?.dueSoon ?? 0}
          tone={stats?.dueSoon ? 'warning' : 'neutral'}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="Closed (30d)"
          value={stats?.closed30d ?? 0}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2 space-y-6">
          <Card title="My queue" actions={<Link href="/queue" className="text-xs text-brand-600 hover:underline">View all →</Link>}>
            {isLoading ? (
              <Skeleton rows={4} />
            ) : !mine || mine.queue.length === 0 ? (
              <Empty>Nothing on your plate.</Empty>
            ) : (
              <ul className="divide-y">
                {mine.queue.map((m) => {
                  const sla = m.slaDueAt ? new Date(m.slaDueAt) : null;
                  const overdue = sla && sla.getTime() < Date.now();
                  const dueSoon =
                    sla && !overdue && sla.getTime() < Date.now() + 48 * 36e5;
                  return (
                    <li key={m.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/matters/${m.id}`}
                            className="text-sm font-medium text-brand-700 hover:underline"
                          >
                            {m.shortId} — {m.title}
                          </Link>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-xs text-gray-500">{m.status}</span>
                            {m.priority && (
                              <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase ${PRIORITY_COLOR[m.priority] ?? ''}`}>
                                {m.priority}
                              </span>
                            )}
                            {m.practiceArea && (
                              <span className="text-xs text-gray-400">{m.practiceArea}</span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`text-xs whitespace-nowrap ${
                            overdue
                              ? 'text-red-600 font-medium'
                              : dueSoon
                                ? 'text-amber-600'
                                : 'text-gray-500'
                          }`}
                        >
                          {sla ? formatRelativeSLA(sla) : 'no SLA'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Active drafts">
            {isLoading ? (
              <Skeleton rows={2} />
            ) : !mine || mine.drafts.length === 0 ? (
              <Empty>No drafts touched in the last 2 weeks.</Empty>
            ) : (
              <ul className="space-y-2">
                {mine.drafts.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/matters/${d.matterId}/draft`}
                        className="text-sm text-brand-700 hover:underline"
                      >
                        {d.title || 'Draft'}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {d.matterShortId} · v{d.version} · edited {formatAgo(new Date(d.updatedAt))}
                      </div>
                    </div>
                    <Link
                      href={`/matters/${d.matterId}/draft`}
                      className="text-xs border rounded px-2 py-1 hover:bg-gray-50 shrink-0"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {insights.length > 0 && (
            <Card title={`AI-suggested actions (${insights.length})`}>
              <div className="space-y-2">
                {insights.slice(0, 4).map((ins) => (
                  <div
                    key={ins.id}
                    className={`rounded-md border p-3 ${
                      SEVERITY_STYLE[ins.severity] ?? 'bg-white border-gray-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium">{ins.title}</div>
                      <span className="text-[10px] text-gray-400 uppercase shrink-0">
                        {ins.kind.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 mt-1">{ins.body}</p>
                    <div className="flex justify-end gap-3 mt-2">
                      <button
                        onClick={() => dismissInsight.mutate({ id: ins.id, decision: 'actioned' })}
                        className="text-xs text-brand-600 hover:underline"
                      >
                        Mark actioned
                      </button>
                      <button
                        onClick={() => dismissInsight.mutate({ id: ins.id, decision: 'dismissed' })}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </section>

        <aside className="space-y-6">
          <Card
            title="My escalations"
            actions={
              escalations.length > 0 && (
                <Link href="/escalations" className="text-xs text-brand-600 hover:underline">
                  All →
                </Link>
              )
            }
          >
            {escalations.length === 0 ? (
              <Empty>No open escalations.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {escalations.map((e) => (
                  <li key={e.id} className="border-l-2 border-red-400 pl-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITY_COLOR[e.severity] ?? ''}`}>
                        {e.severity}
                      </span>
                      <Link
                        href={`/matters/${e.matterId}`}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        {e.matterShortId}
                      </Link>
                    </div>
                    <div className="text-xs font-medium mt-0.5">{e.title}</div>
                    {e.status === 'open' && (
                      <button
                        onClick={() => ackEsc.mutate({ id: e.id })}
                        className="text-[10px] text-gray-500 hover:underline mt-1"
                      >
                        Acknowledge
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent activity">
            {isLoading ? (
              <Skeleton rows={3} />
            ) : !mine || mine.activity.length === 0 ? (
              <Empty>No recent activity on your matters.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {mine.activity.map((e) => (
                  <li key={e.id}>
                    <Link
                      href={`/matters/${e.matterId}`}
                      className="text-brand-700 hover:underline text-xs"
                    >
                      {e.matterShortId}
                    </Link>{' '}
                    <span className="text-xs text-gray-600">
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <div className="text-[10px] text-gray-400">
                      {formatAgo(new Date(e.createdAt))}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-sm">{title}</h2>
        {actions}
      </div>
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  tone = 'neutral',
  href,
  loading,
}: {
  label: string;
  value: number;
  sublabel?: string;
  tone?: 'neutral' | 'danger' | 'warning';
  href?: string;
  loading?: boolean;
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-200 bg-red-50'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50'
        : 'bg-white';
  const valueClass =
    tone === 'danger' ? 'text-red-700' : tone === 'warning' ? 'text-amber-700' : 'text-gray-900';

  const inner = (
    <div className={`rounded-lg border p-4 transition ${toneClass} ${href ? 'hover:shadow-sm cursor-pointer' : ''}`}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-semibold mt-1 ${valueClass}`}>
        {loading ? <span className="inline-block w-10 h-7 bg-gray-100 rounded animate-pulse" /> : value}
      </div>
      {sublabel && <div className="text-xs text-gray-500 mt-1">{sublabel}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-gray-500">{children}</p>;
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

function formatRelativeSLA(d: Date): string {
  const diffMs = d.getTime() - Date.now();
  const sign = diffMs < 0 ? -1 : 1;
  const abs = Math.abs(diffMs);
  const hours = abs / 36e5;
  if (sign < 0) {
    if (hours < 1) return `overdue ${Math.round(abs / 60000)}m`;
    if (hours < 48) return `overdue ${hours.toFixed(1)}h`;
    return `overdue ${Math.round(hours / 24)}d`;
  }
  if (hours < 1) return `in ${Math.round(abs / 60000)}m`;
  if (hours < 48) return `in ${hours.toFixed(1)}h`;
  return `in ${Math.round(hours / 24)}d`;
}

function formatAgo(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

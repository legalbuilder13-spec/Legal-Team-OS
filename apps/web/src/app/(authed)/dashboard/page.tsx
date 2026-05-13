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
  urgent: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  high: 'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
  medium: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200',
  low: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200',
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-red-200 bg-red-50/60',
  medium: 'border-amber-200 bg-amber-50/60',
  low: 'border-brand-200 bg-brand-50/60',
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
      <header className="mb-10">
        <h1 className="text-4xl font-semibold tracking-tighter2 text-ink-950">
          {firstName ? (
            <>
              Welcome back,{' '}
              <span className="text-brand-600">{firstName}</span>
            </>
          ) : (
            'Dashboard'
          )}
        </h1>
        <p className="text-base text-ink-500 mt-2 max-w-xl">
          Your queue, drafts, and escalations at a glance.
        </p>
      </header>

      <div className="grid grid-cols-4 gap-4 mb-10">
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
          <Card
            title="My queue"
            actions={
              <Link
                href="/queue"
                className="text-xs font-medium text-brand-600 hover:text-brand-700"
              >
                View all →
              </Link>
            }
          >
            {isLoading ? (
              <Skeleton rows={4} />
            ) : !mine || mine.queue.length === 0 ? (
              <Empty>Nothing on your plate.</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 -mx-1">
                {mine.queue.map((m) => {
                  const sla = m.slaDueAt ? new Date(m.slaDueAt) : null;
                  const overdue = sla && sla.getTime() < Date.now();
                  const dueSoon =
                    sla && !overdue && sla.getTime() < Date.now() + 48 * 36e5;
                  return (
                    <li
                      key={m.id}
                      className="py-3 px-1 first:pt-0 last:pb-0 rounded-lg hover:bg-ink-50/60 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <Link
                            href={`/matters/${m.id}`}
                            className="text-sm font-medium text-ink-900 hover:text-brand-700"
                          >
                            {m.shortId} — {m.title}
                          </Link>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[11px] text-ink-500 uppercase tracking-wider">
                              {m.status}
                            </span>
                            {m.priority && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded-md uppercase font-medium tracking-wide ${PRIORITY_COLOR[m.priority] ?? ''}`}
                              >
                                {m.priority}
                              </span>
                            )}
                            {m.practiceArea && (
                              <span className="text-[11px] text-ink-400">
                                {m.practiceArea}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`text-xs whitespace-nowrap font-medium ${
                            overdue
                              ? 'text-red-600'
                              : dueSoon
                                ? 'text-amber-600'
                                : 'text-ink-400'
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
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-ink-50/60 transition-colors"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/matters/${d.matterId}/draft`}
                        className="text-sm font-medium text-ink-900 hover:text-brand-700"
                      >
                        {d.title || 'Draft'}
                      </Link>
                      <div className="text-xs text-ink-500 mt-0.5">
                        {d.matterShortId} · v{d.version} · edited{' '}
                        {formatAgo(new Date(d.updatedAt))}
                      </div>
                    </div>
                    <Link
                      href={`/matters/${d.matterId}/draft`}
                      className="text-xs font-medium border border-ink-200 bg-white rounded-lg px-3 py-1.5 hover:bg-ink-50 hover:border-ink-300 transition shrink-0"
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
              <div className="space-y-2.5">
                {insights.slice(0, 4).map((ins) => (
                  <div
                    key={ins.id}
                    className={`rounded-xl border p-4 ${
                      SEVERITY_STYLE[ins.severity] ?? 'bg-white border-ink-200'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-ink-900">
                        {ins.title}
                      </div>
                      <span className="text-[10px] text-ink-400 uppercase tracking-wider shrink-0">
                        {ins.kind.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-ink-700 mt-1.5 leading-relaxed">
                      {ins.body}
                    </p>
                    <div className="flex justify-end gap-3 mt-3">
                      <button
                        onClick={() =>
                          dismissInsight.mutate({ id: ins.id, decision: 'actioned' })
                        }
                        className="text-xs font-medium text-brand-600 hover:text-brand-700"
                      >
                        Mark actioned
                      </button>
                      <button
                        onClick={() =>
                          dismissInsight.mutate({ id: ins.id, decision: 'dismissed' })
                        }
                        className="text-xs text-ink-500 hover:text-ink-700"
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
                <Link
                  href="/escalations"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  All →
                </Link>
              )
            }
          >
            {escalations.length === 0 ? (
              <Empty>No open escalations.</Empty>
            ) : (
              <ul className="space-y-3">
                {escalations.map((e) => (
                  <li key={e.id} className="border-l-2 border-red-400 pl-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md uppercase font-medium tracking-wide ${PRIORITY_COLOR[e.severity] ?? ''}`}
                      >
                        {e.severity}
                      </span>
                      <Link
                        href={`/matters/${e.matterId}`}
                        className="text-[11px] text-ink-500 hover:text-brand-700"
                      >
                        {e.matterShortId}
                      </Link>
                    </div>
                    <div className="text-xs font-medium mt-1 text-ink-900">
                      {e.title}
                    </div>
                    {e.status === 'open' && (
                      <button
                        onClick={() => ackEsc.mutate({ id: e.id })}
                        className="text-[10px] text-ink-500 hover:text-brand-700 mt-1.5"
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
              <ul className="space-y-2.5">
                {mine.activity.map((e) => (
                  <li key={e.id} className="text-sm">
                    <Link
                      href={`/matters/${e.matterId}`}
                      className="text-xs font-medium text-brand-600 hover:text-brand-700"
                    >
                      {e.matterShortId}
                    </Link>{' '}
                    <span className="text-xs text-ink-700">
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <div className="text-[10px] text-ink-400 mt-0.5">
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
    <div className="bg-white border border-ink-200/70 rounded-xl shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm text-ink-900 tracking-tightish">
          {title}
        </h2>
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
      ? 'border-red-200 bg-red-50/40'
      : tone === 'warning'
        ? 'border-amber-200 bg-amber-50/40'
        : 'bg-white border-ink-200/70';
  const valueClass =
    tone === 'danger'
      ? 'text-red-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : 'text-ink-950';

  const inner = (
    <div
      className={`rounded-xl border p-5 shadow-card transition-all duration-200 ease-snappy ${toneClass} ${href ? 'hover:shadow-cardHover hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div className="text-[11px] text-ink-500 uppercase tracking-wider font-medium">
        {label}
      </div>
      <div className={`text-4xl font-semibold mt-2 tracking-tighter2 ${valueClass}`}>
        {loading ? (
          <span className="inline-block w-12 h-9 bg-ink-100 rounded-md animate-pulse" />
        ) : (
          value
        )}
      </div>
      {sublabel && <div className="text-xs text-ink-500 mt-1.5">{sublabel}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-500">{children}</p>;
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 bg-ink-100 rounded-lg animate-pulse" />
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

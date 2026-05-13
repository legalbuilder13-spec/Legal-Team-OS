'use client';

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import {
  type LucideIcon,
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileEdit,
  Inbox,
  Lightbulb,
  Siren,
  Sparkles,
} from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { ActivityChart } from '@/components/charts';

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
  urgent: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 ring-1 ring-inset ring-red-200 dark:ring-red-900',
  high: 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 ring-1 ring-inset ring-orange-200 dark:ring-orange-900',
  medium: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-200 dark:ring-amber-900',
  low: 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-300 ring-1 ring-inset ring-ink-200 dark:ring-ink-700',
};

const SEVERITY_STYLE: Record<string, string> = {
  high: 'border-red-200 dark:border-red-900 bg-red-50/60 dark:bg-red-950/30',
  medium: 'border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30',
  low: 'border-brand-200 dark:border-brand-900 bg-brand-50/60 dark:bg-brand-950/30',
};

export default function DashboardPage() {
  const { user } = useUser();
  const { data: mine, isLoading } = trpc.dashboard.mine.useQuery();
  const { data: chart = [] } = trpc.dashboard.myActivityChart.useQuery();
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
      <header className="mb-10 -mx-4 -mt-4 px-4 pt-4 pb-2 rounded-2xl bg-hero-mesh">
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/60 ring-1 ring-inset ring-brand-200 dark:ring-brand-900 rounded-full px-2.5 py-1 mb-4">
          <Sparkles size={12} />
          {new Date().toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold tracking-tighter2 text-ink-950 dark:text-ink-50">
          {firstName ? (
            <>
              Welcome back, <span className="text-gradient-brand">{firstName}</span>
            </>
          ) : (
            <span className="text-gradient-brand">Dashboard</span>
          )}
        </h1>
        <p className="text-base text-ink-500 dark:text-ink-400 mt-3 max-w-xl">
          Your queue, drafts, and escalations at a glance.
        </p>
      </header>

      <div className="grid grid-cols-4 gap-4 mb-10">
        <StatCard
          label="Open matters"
          value={stats?.open ?? 0}
          icon={Inbox}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="SLA breached"
          value={stats?.breached ?? 0}
          icon={AlertTriangle}
          tone={stats?.breached ? 'danger' : 'neutral'}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="Due in 48h"
          value={stats?.dueSoon ?? 0}
          icon={Clock}
          tone={stats?.dueSoon ? 'warning' : 'neutral'}
          loading={isLoading}
          href="/queue"
        />
        <StatCard
          label="Closed (30d)"
          value={stats?.closed30d ?? 0}
          icon={CheckCircle2}
          loading={isLoading}
        />
      </div>

      <div className="grid grid-cols-3 gap-6">
        <section className="col-span-2 space-y-6">
          <Card title="Activity (last 14 days)" icon={Activity}>
            {chart.length > 0 ? (
              <ActivityChart data={chart} />
            ) : (
              <Empty>No activity yet.</Empty>
            )}
          </Card>

          <Card
            title="My queue"
            icon={Inbox}
            actions={
              <Link
                href="/queue"
                className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-1"
              >
                View all <ArrowRight size={12} />
              </Link>
            }
          >
            {isLoading ? (
              <Skeleton rows={4} />
            ) : !mine || mine.queue.length === 0 ? (
              <Empty>Nothing on your plate.</Empty>
            ) : (
              <ul className="divide-y divide-ink-100 dark:divide-ink-800 -mx-1">
                {mine.queue.map((m) => {
                  const sla = m.slaDueAt ? new Date(m.slaDueAt) : null;
                  const overdue = sla && sla.getTime() < Date.now();
                  const dueSoon =
                    sla && !overdue && sla.getTime() < Date.now() + 48 * 36e5;
                  return (
                    <li
                      key={m.id}
                      className="py-3 px-1 first:pt-0 last:pb-0 rounded-lg hover:bg-ink-50/60 dark:hover:bg-ink-800/40 transition-colors"
                    >
                      <Link
                        href={`/matters/${m.id}`}
                        className="flex items-start gap-3 group"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink-900 dark:text-ink-100 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                            {m.shortId} — {m.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[11px] text-ink-500 dark:text-ink-400 uppercase tracking-wider">
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
                              <span className="text-[11px] text-ink-400 dark:text-ink-500">
                                {m.practiceArea}
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`text-xs whitespace-nowrap font-medium ${
                            overdue
                              ? 'text-red-600 dark:text-red-400'
                              : dueSoon
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-ink-400 dark:text-ink-500'
                          }`}
                        >
                          {sla ? formatRelativeSLA(sla) : 'no SLA'}
                        </div>
                        <ChevronRight
                          size={14}
                          className="text-ink-300 dark:text-ink-600 group-hover:text-brand-500 transition-colors mt-0.5"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card title="Active drafts" icon={FileEdit}>
            {isLoading ? (
              <Skeleton rows={2} />
            ) : !mine || mine.drafts.length === 0 ? (
              <Empty>No drafts touched in the last 2 weeks.</Empty>
            ) : (
              <ul className="space-y-1">
                {mine.drafts.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg hover:bg-ink-50/60 dark:hover:bg-ink-800/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/matters/${d.matterId}/draft`}
                        className="text-sm font-medium text-ink-900 dark:text-ink-100 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
                      >
                        {d.title || 'Draft'}
                      </Link>
                      <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5">
                        {d.matterShortId} · v{d.version} · edited{' '}
                        {formatAgo(new Date(d.updatedAt))}
                      </div>
                    </div>
                    <Link
                      href={`/matters/${d.matterId}/draft`}
                      className="text-xs font-medium border border-ink-200 dark:border-ink-700 bg-white dark:bg-ink-900 text-ink-700 dark:text-ink-200 rounded-lg px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800 dark:hover:bg-ink-800 hover:border-ink-300 dark:hover:border-ink-600 transition shrink-0"
                    >
                      Open
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {insights.length > 0 && (
            <Card
              title={`AI-suggested actions (${insights.length})`}
              icon={Lightbulb}
            >
              <div className="space-y-2.5">
                {insights.slice(0, 4).map((ins) => (
                  <div
                    key={ins.id}
                    className={`rounded-xl border p-4 ${
                      SEVERITY_STYLE[ins.severity] ??
                      'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-medium text-ink-900 dark:text-ink-100">
                        {ins.title}
                      </div>
                      <span className="text-[10px] text-ink-400 dark:text-ink-500 uppercase tracking-wider shrink-0">
                        {ins.kind.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="text-xs text-ink-700 dark:text-ink-300 mt-1.5 leading-relaxed">
                      {ins.body}
                    </p>
                    <div className="flex justify-end gap-3 mt-3">
                      <button
                        onClick={() =>
                          dismissInsight.mutate({ id: ins.id, decision: 'actioned' })
                        }
                        className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                      >
                        Mark actioned
                      </button>
                      <button
                        onClick={() =>
                          dismissInsight.mutate({ id: ins.id, decision: 'dismissed' })
                        }
                        className="text-xs text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
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
            icon={Siren}
            actions={
              escalations.length > 0 && (
                <Link
                  href="/escalations"
                  className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 inline-flex items-center gap-1"
                >
                  All <ArrowRight size={12} />
                </Link>
              )
            }
          >
            {escalations.length === 0 ? (
              <Empty>No open escalations.</Empty>
            ) : (
              <ul className="space-y-3">
                {escalations.map((e) => (
                  <li key={e.id} className="border-l-2 border-red-400 dark:border-red-500 pl-3">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md uppercase font-medium tracking-wide ${PRIORITY_COLOR[e.severity] ?? ''}`}
                      >
                        {e.severity}
                      </span>
                      <Link
                        href={`/matters/${e.matterId}`}
                        className="text-[11px] text-ink-500 dark:text-ink-400 hover:text-brand-600 dark:hover:text-brand-400"
                      >
                        {e.matterShortId}
                      </Link>
                    </div>
                    <div className="text-xs font-medium mt-1 text-ink-900 dark:text-ink-100">
                      {e.title}
                    </div>
                    {e.status === 'open' && (
                      <button
                        onClick={() => ackEsc.mutate({ id: e.id })}
                        className="text-[10px] text-ink-500 dark:text-ink-400 hover:text-brand-600 dark:hover:text-brand-400 mt-1.5"
                      >
                        Acknowledge
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Recent activity" icon={Activity}>
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
                      className="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300"
                    >
                      {e.matterShortId}
                    </Link>{' '}
                    <span className="text-xs text-ink-700 dark:text-ink-300">
                      {KIND_LABEL[e.kind] ?? e.kind}
                    </span>
                    <div className="text-[10px] text-ink-400 dark:text-ink-500 mt-0.5">
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
  icon: Icon,
  actions,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800/70 dark:border-ink-800 rounded-xl shadow-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-sm text-ink-900 dark:text-ink-100 tracking-tightish inline-flex items-center gap-2">
          {Icon && <Icon size={14} className="text-brand-500 dark:text-brand-400" />}
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
  icon: Icon,
}: {
  label: string;
  value: number;
  sublabel?: string;
  tone?: 'neutral' | 'danger' | 'warning';
  href?: string;
  loading?: boolean;
  icon?: LucideIcon;
}) {
  const toneClass =
    tone === 'danger'
      ? 'border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20'
      : tone === 'warning'
        ? 'border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20'
        : 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-800/70 dark:border-ink-800';
  const valueClass =
    tone === 'danger'
      ? 'text-red-700 dark:text-red-400'
      : tone === 'warning'
        ? 'text-amber-700 dark:text-amber-400'
        : 'text-ink-950 dark:text-ink-50';
  const iconClass =
    tone === 'danger'
      ? 'text-red-500 dark:text-red-400 bg-red-100 dark:bg-red-950/50'
      : tone === 'warning'
        ? 'text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50'
        : 'text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-950/40';

  const inner = (
    <div
      className={`rounded-xl border p-5 shadow-card transition-all duration-200 ease-snappy ${toneClass} ${href ? 'hover:shadow-cardHover hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div className="flex items-start justify-between">
        <div className="text-[11px] text-ink-500 dark:text-ink-400 uppercase tracking-wider font-medium">
          {label}
        </div>
        {Icon && (
          <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${iconClass}`}>
            <Icon size={14} />
          </span>
        )}
      </div>
      <div className={`text-4xl font-semibold mt-2 tracking-tighter2 ${valueClass}`}>
        {loading ? (
          <span className="inline-block w-12 h-9 bg-ink-100 dark:bg-ink-800 rounded-md animate-pulse" />
        ) : (
          value
        )}
      </div>
      {sublabel && <div className="text-xs text-ink-500 dark:text-ink-400 mt-1.5">{sublabel}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-ink-500 dark:text-ink-400">{children}</p>;
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 bg-ink-100 dark:bg-ink-800 rounded-lg animate-pulse" />
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

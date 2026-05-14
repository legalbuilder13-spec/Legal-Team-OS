'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// M1 — Admin proposal queue for clustered lawyer rejection reasons.
// Each cluster is the output of the weekly cron that groups rows from
// audit_log (analysis.stage_rejected / .stage_escalated) into themed
// buckets. The admin reviews each cluster and either materializes
// the proposal (new playbook draft, or domain_config patch) or
// dismisses it.

type ClusterRow = {
  id: string;
  runId: string;
  stageName: string;
  practiceArea: string | null;
  label: string;
  summary: string;
  memberCount: number;
  representativeReasons: Array<{
    audit_log_id: string;
    matter_id: string | null;
    reason: string;
    worker_confidence: string | null;
    decided_at: string;
  }>;
  proposalTarget: 'playbook' | 'domain_config' | 'none';
  proposedPayload: Record<string, unknown>;
  proposalStatus: 'pending' | 'accepted' | 'dismissed' | 'actioned';
  createdAt: string | Date;
  actionedAt: string | Date | null;
  windowStart: string | Date;
  windowEnd: string | Date;
};

type ProposalTarget = 'playbook' | 'domain_config' | 'none';

function StatusBadge({ status }: { status: ClusterRow['proposalStatus'] }) {
  const tone =
    status === 'pending'
      ? 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-300'
      : status === 'accepted'
        ? 'bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-200'
        : status === 'actioned'
          ? 'bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200'
          : 'bg-ink-50 dark:bg-ink-900 text-ink-500 dark:text-ink-400';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${tone}`}>{status}</span>
  );
}

function TargetBadge({ target }: { target: ProposalTarget }) {
  const tone =
    target === 'playbook'
      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
      : target === 'domain_config'
        ? 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
        : 'bg-ink-100 dark:bg-ink-800 text-ink-600 dark:text-ink-400';
  return (
    <span className={`text-xs px-1.5 py-0.5 rounded ${tone}`}>{target.replace('_', ' ')}</span>
  );
}

function fmtDate(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function ClusterCard({ cluster }: { cluster: ClusterRow }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [titleOverride, setTitleOverride] = useState<string>(
    typeof cluster.proposedPayload.title === 'string'
      ? (cluster.proposedPayload.title as string)
      : '',
  );
  const [bodyOverride, setBodyOverride] = useState<string>(
    typeof cluster.proposedPayload.body === 'string'
      ? (cluster.proposedPayload.body as string)
      : '',
  );

  const markStatus = trpc.rejectionThemes.markStatus.useMutation({
    onSuccess: () => utils.rejectionThemes.list.invalidate(),
  });
  const createPlaybook = trpc.rejectionThemes.createPlaybookDraft.useMutation({
    onSuccess: () => utils.rejectionThemes.list.invalidate(),
  });
  const applyDomainConfig = trpc.rejectionThemes.applyDomainConfigPatch.useMutation({
    onSuccess: () => utils.rejectionThemes.list.invalidate(),
  });

  const isActioned = cluster.proposalStatus === 'actioned';
  const isDismissed = cluster.proposalStatus === 'dismissed';

  return (
    <section className="border rounded-lg p-4 space-y-3">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-medium">{cluster.label}</h3>
            <StatusBadge status={cluster.proposalStatus} />
            <TargetBadge target={cluster.proposalTarget} />
          </div>
          <div className="text-xs text-ink-500 dark:text-ink-400 space-x-2">
            <span>stage: {cluster.stageName}</span>
            {cluster.practiceArea && <span>· area: {cluster.practiceArea}</span>}
            <span>· {cluster.memberCount} rejections</span>
            <span>
              · window: {fmtDate(cluster.windowStart)} → {fmtDate(cluster.windowEnd)}
            </span>
          </div>
        </div>
      </header>

      <p className="text-sm text-ink-700 dark:text-ink-300">{cluster.summary}</p>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="text-xs text-brand-600 hover:underline"
      >
        {expanded ? 'Hide' : 'Show'} {cluster.representativeReasons.length} representative reason
        {cluster.representativeReasons.length === 1 ? '' : 's'}
      </button>

      {expanded && (
        <ul className="text-xs space-y-1.5 border-l-2 border-ink-200 dark:border-ink-700 pl-3">
          {cluster.representativeReasons.map((r) => (
            <li key={r.audit_log_id} className="space-y-0.5">
              <div className="text-ink-500 dark:text-ink-400 font-mono">
                {fmtDate(r.decided_at)}
                {r.worker_confidence && <span> · confidence: {r.worker_confidence}</span>}
                {r.matter_id && <span> · matter: {r.matter_id.slice(0, 8)}…</span>}
              </div>
              <div className="text-ink-700 dark:text-ink-300">"{r.reason}"</div>
            </li>
          ))}
        </ul>
      )}

      {cluster.proposalTarget === 'playbook' && !isActioned && !isDismissed && (
        <div className="border rounded p-3 space-y-2 bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900">
          <div className="text-xs font-medium text-blue-900 dark:text-blue-200">
            Proposed playbook draft
          </div>
          {editing ? (
            <>
              <input
                value={titleOverride}
                onChange={(e) => setTitleOverride(e.target.value)}
                className="w-full text-sm border rounded px-2 py-1"
                placeholder="Playbook title"
              />
              <textarea
                value={bodyOverride}
                onChange={(e) => setBodyOverride(e.target.value)}
                rows={8}
                className="w-full text-sm border rounded px-2 py-1 font-mono"
                placeholder="Playbook body (markdown)"
              />
            </>
          ) : (
            <>
              <div className="text-sm font-medium">
                {(cluster.proposedPayload.title as string) ?? '(no title proposed)'}
              </div>
              <div className="text-xs whitespace-pre-wrap text-ink-700 dark:text-ink-300">
                {(cluster.proposedPayload.body as string) ?? '(no body proposed)'}
              </div>
            </>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setEditing((v) => !v)}
              className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              {editing ? 'Cancel edit' : 'Edit before saving'}
            </button>
            <button
              disabled={createPlaybook.isPending}
              onClick={() =>
                createPlaybook.mutate({
                  clusterId: cluster.id,
                  title: editing ? titleOverride : undefined,
                  body: editing ? bodyOverride : undefined,
                })
              }
              className="text-xs px-2 py-1 border rounded bg-blue-600 text-white border-blue-700 hover:bg-blue-700 disabled:opacity-50"
            >
              {createPlaybook.isPending ? 'Saving…' : 'Create playbook'}
            </button>
            <button
              disabled={markStatus.isPending}
              onClick={() =>
                markStatus.mutate({ clusterId: cluster.id, status: 'dismissed' })
              }
              className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Dismiss
            </button>
          </div>
          {createPlaybook.error && (
            <div className="text-xs text-red-700 dark:text-red-300">
              {createPlaybook.error.message}
            </div>
          )}
        </div>
      )}

      {cluster.proposalTarget === 'domain_config' && !isActioned && !isDismissed && (
        <div className="border rounded p-3 space-y-2 bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-900">
          <div className="text-xs font-medium text-purple-900 dark:text-purple-200">
            Proposed domain config patch
          </div>
          <div className="text-xs">
            <span className="text-ink-500 dark:text-ink-400">path: </span>
            <code className="font-mono">
              {(cluster.proposedPayload.patch_path as string) ?? '?'}
            </code>
          </div>
          <pre className="text-xs whitespace-pre-wrap bg-ink-50 dark:bg-ink-900 rounded p-2 font-mono">
            {JSON.stringify(cluster.proposedPayload.patch_value ?? {}, null, 2)}
          </pre>
          {typeof cluster.proposedPayload.rationale === 'string' && (
            <div className="text-xs text-ink-700 dark:text-ink-300">
              {cluster.proposedPayload.rationale as string}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              disabled={applyDomainConfig.isPending}
              onClick={() => applyDomainConfig.mutate({ clusterId: cluster.id })}
              className="text-xs px-2 py-1 border rounded bg-purple-600 text-white border-purple-700 hover:bg-purple-700 disabled:opacity-50"
            >
              {applyDomainConfig.isPending ? 'Applying…' : 'Apply patch'}
            </button>
            <button
              disabled={markStatus.isPending}
              onClick={() =>
                markStatus.mutate({ clusterId: cluster.id, status: 'dismissed' })
              }
              className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Dismiss
            </button>
          </div>
          {applyDomainConfig.error && (
            <div className="text-xs text-red-700 dark:text-red-300">
              {applyDomainConfig.error.message}
            </div>
          )}
        </div>
      )}

      {cluster.proposalTarget === 'none' && !isActioned && !isDismissed && (
        <div className="flex gap-2 pt-1">
          <button
            disabled={markStatus.isPending}
            onClick={() =>
              markStatus.mutate({ clusterId: cluster.id, status: 'dismissed' })
            }
            className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
          >
            Dismiss (no automatic action proposed)
          </button>
        </div>
      )}

      {isActioned && cluster.actionedAt && (
        <div className="text-xs text-emerald-700 dark:text-emerald-300">
          Actioned on {fmtDate(cluster.actionedAt)}.
        </div>
      )}
    </section>
  );
}

export default function RejectionThemesPage() {
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const statuses = includeDismissed
    ? (['pending', 'accepted', 'dismissed', 'actioned'] as const)
    : (['pending', 'accepted'] as const);

  const { data, isLoading } = trpc.rejectionThemes.list.useQuery({
    statuses: [...statuses],
    limit: 50,
  });

  return (
    <div className="max-w-5xl space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Rejection themes</h1>
        <p className="text-sm text-ink-600 dark:text-ink-400">
          Clustered lawyer rejections from the analysis pipeline (PR10 signal). Each cluster
          proposes a follow-up: a new playbook draft, or a domain config patch. Closes the
          self-improvement loop the rejection-reason field was added for.
        </p>
      </header>

      {data?.latestRun && (
        <div className="border rounded-lg p-3 text-xs text-ink-600 dark:text-ink-400 flex items-center justify-between gap-3">
          <span>
            Latest run: {fmtDate(data.latestRun.createdAt)} ·{' '}
            <Num value={data.latestRun.rejectionCount} /> rejections →{' '}
            <Num value={data.latestRun.clusterCount} /> clusters
            {data.latestRun.error && (
              <span className="text-red-700 dark:text-red-300"> · error: {data.latestRun.error}</span>
            )}
          </span>
          <label className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(e) => setIncludeDismissed(e.target.checked)}
            />
            Include dismissed + actioned
          </label>
        </div>
      )}

      {isLoading ? (
        <div className="text-ink-500 dark:text-ink-400">Loading…</div>
      ) : !data || data.clusters.length === 0 ? (
        <div className="border rounded-lg p-6 text-sm text-ink-500 dark:text-ink-400 text-center">
          No rejection clusters yet. The mining cron runs Sunday 09:00 in the digest timezone.
          A cluster requires ≥2 rejections in the lookback window.
        </div>
      ) : (
        <div className="space-y-4">
          {data.clusters.map((c) => (
            <ClusterCard key={c.id} cluster={c as ClusterRow} />
          ))}
        </div>
      )}
    </div>
  );
}

function Num({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-ink-400 dark:text-ink-500">—</span>;
  return <span className="font-mono">{value}</span>;
}

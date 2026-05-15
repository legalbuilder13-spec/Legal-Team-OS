'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// M7 — admin queue of proposed playbook edits. The weekly
// mine-playbook-edits cron writes pending rows by comparing closed
// matters' final summaries against the playbook content that was
// matched in Stage 1. Admins read the proposed edit + rationale,
// then accept (logs to audit_log; pushing the diff back to Notion
// is a follow-up PR) or dismiss with an optional reason.

type Status = 'pending' | 'accepted' | 'dismissed';

export default function PlaybookEditProposalsPage() {
  const [status, setStatus] = useState<Status>('pending');
  const utils = trpc.useUtils();
  const { data: proposals = [], isLoading } = trpc.playbookEditProposals.list.useQuery({
    statuses: [status],
  });
  const accept = trpc.playbookEditProposals.accept.useMutation({
    onSuccess: () => utils.playbookEditProposals.list.invalidate(),
  });
  const dismiss = trpc.playbookEditProposals.dismiss.useMutation({
    onSuccess: () => utils.playbookEditProposals.list.invalidate(),
  });

  return (
    <div className="max-w-4xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Playbook edit proposals</h1>
        <p className="mt-1 text-sm text-ink-600 dark:text-ink-400 max-w-2xl leading-relaxed">
          The weekly M7 cron compares each playbook that matched in Stage 1 against the
          lawyer-accepted output for the matters it informed, then proposes targeted edits.
          Accepting logs your decision in the audit log; pushing the diff back to Notion is
          a follow-up. Dismissing won&apos;t re-propose the same edit until a new pattern
          accumulates.
        </p>
        <div className="mt-3 flex items-center gap-2 text-xs">
          {(['pending', 'accepted', 'dismissed'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`px-2.5 py-1 rounded border ${
                status === s
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white dark:bg-ink-900 border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-800'
              }`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </header>

      {isLoading && <div className="text-ink-500 dark:text-ink-400 text-sm">Loading…</div>}

      {!isLoading && proposals.length === 0 && (
        <div className="border border-dashed border-ink-200 dark:border-ink-800 rounded-lg p-8 text-center">
          <p className="text-sm text-ink-500 dark:text-ink-400">
            {status === 'pending'
              ? 'No pending playbook edit proposals. The M7 cron runs Sundays at 11:00.'
              : `No ${status} proposals.`}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            onAccept={(reason) => accept.mutate({ proposalId: p.id, reason })}
            onDismiss={(reason) => dismiss.mutate({ proposalId: p.id, reason })}
            disabled={accept.isPending || dismiss.isPending}
          />
        ))}
      </div>
    </div>
  );
}

interface ProposalCardProps {
  proposal: {
    id: string;
    playbookId: string | null;
    notionPageId: string | null;
    playbookTitle: string;
    section: string;
    proposedEdit: string;
    rationale: string;
    evidenceMatterIds: string[];
    evidenceCount: number;
    status: 'pending' | 'accepted' | 'dismissed';
    actionedAt: Date | string | null;
    actionedReason: string | null;
    createdAt: Date | string;
    notionAppliedAt: Date | string | null;
    notionBlockId: string | null;
    notionApplyError: string | null;
  };
  onAccept: (reason?: string) => void;
  onDismiss: (reason?: string) => void;
  disabled: boolean;
}

function ProposalCard({ proposal, onAccept, onDismiss, disabled }: ProposalCardProps) {
  const [reason, setReason] = useState('');
  const isPending = proposal.status === 'pending';
  const notionUrl = proposal.notionPageId
    ? `https://www.notion.so/${proposal.notionPageId.replace(/-/g, '')}`
    : null;

  return (
    <article className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-lg overflow-hidden">
      <header className="px-4 py-3 border-b border-ink-100 dark:border-ink-800 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-ink-900 dark:text-ink-50 truncate">
            {proposal.playbookTitle}
          </div>
          <div className="mt-0.5 text-[12px] text-ink-500 dark:text-ink-400">
            Section: <span className="font-mono">{proposal.section}</span>
            {' · '}
            Evidence: {proposal.evidenceCount} matter{proposal.evidenceCount === 1 ? '' : 's'}
            {notionUrl && (
              <>
                {' · '}
                <a
                  href={notionUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand-700 dark:text-brand-300 hover:underline"
                >
                  View playbook in Notion ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {proposal.status === 'accepted' && proposal.notionAppliedAt && (
            <span
              className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-blue-200 text-blue-700 dark:border-blue-900 dark:text-blue-300"
              title={`Applied to Notion as block ${proposal.notionBlockId ?? '(unknown)'}`}
            >
              applied to notion
            </span>
          )}
          {proposal.status === 'accepted' &&
            !proposal.notionAppliedAt &&
            proposal.notionApplyError && (
              <span
                className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-red-200 text-red-700 dark:border-red-900 dark:text-red-300"
                title={proposal.notionApplyError}
              >
                apply failed
              </span>
            )}
          {proposal.status === 'accepted' &&
            !proposal.notionAppliedAt &&
            !proposal.notionApplyError && (
              <span
                className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-400"
                title="Auto-apply is off (M7_AUTO_APPLY_NOTION) or the worker hasn't run yet."
              >
                not applied
              </span>
            )}
          <span
            className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${
              proposal.status === 'pending'
                ? 'border-amber-200 text-amber-700 dark:border-amber-900 dark:text-amber-300'
                : proposal.status === 'accepted'
                  ? 'border-emerald-200 text-emerald-700 dark:border-emerald-900 dark:text-emerald-300'
                  : 'border-ink-200 text-ink-600 dark:border-ink-700 dark:text-ink-400'
            }`}
          >
            {proposal.status}
          </span>
        </div>
      </header>

      <div className="px-4 py-4 space-y-4">
        <Field label="Proposed edit">
          <p className="whitespace-pre-wrap text-[13.5px] text-ink-800 dark:text-ink-200">
            {proposal.proposedEdit}
          </p>
        </Field>

        <Field label="Why">
          <p className="text-[13.5px] text-ink-700 dark:text-ink-300">{proposal.rationale}</p>
        </Field>

        {proposal.evidenceMatterIds.length > 0 && (
          <Field label="Evidence (matter IDs)">
            <ul className="text-[12px] font-mono text-ink-600 dark:text-ink-400 space-y-0.5">
              {proposal.evidenceMatterIds.map((mid) => (
                <li key={mid}>{mid}</li>
              ))}
            </ul>
          </Field>
        )}

        {!isPending && proposal.actionedReason && (
          <Field label="Reviewer note">
            <p className="text-[13px] italic text-ink-700 dark:text-ink-300">
              {proposal.actionedReason}
            </p>
          </Field>
        )}

        {proposal.status === 'accepted' && proposal.notionApplyError && (
          <Field label="Notion apply error">
            <p className="text-[13px] text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap">
              {proposal.notionApplyError}
            </p>
          </Field>
        )}

        {isPending && (
          <div className="border-t border-ink-100 dark:border-ink-800 pt-3 space-y-2">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional: why are you accepting or dismissing?"
              rows={2}
              className="w-full text-[13px] border border-ink-200 dark:border-ink-700 rounded px-2 py-1.5 bg-white dark:bg-ink-950 text-ink-900 dark:text-ink-100"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={disabled}
                onClick={() => onAccept(reason || undefined)}
                className="px-3 py-1.5 text-[13px] font-medium rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Accept
              </button>
              <button
                disabled={disabled}
                onClick={() => onDismiss(reason || undefined)}
                className="px-3 py-1.5 text-[13px] font-medium rounded border border-ink-200 dark:border-ink-700 text-ink-700 dark:text-ink-300 hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Dismiss
              </button>
              <span className="text-[11px] text-ink-500 dark:text-ink-400 ml-auto">
                Accepting logs the decision. Pushing the edit to Notion ships in a follow-up.
              </span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

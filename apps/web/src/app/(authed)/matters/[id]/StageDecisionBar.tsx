'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

// PRD §6.1 + PR10. Accept / reject / escalate controls that mount on
// every stage card (pre-merits, guidance, statutory, case-law,
// deconstruct). Reject + escalate require a reason; the input shows
// inline. Accept is one click.

interface Props {
  stageId: string;
  stageName?: 'pre_merits' | 'guidance' | 'statutory' | 'case_law' | 'deconstruct';
  workerConfidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPLIT' | 'N_A';
  currentDecision: 'pending' | 'accepted' | 'rejected' | 'escalated';
  decidedAtIso?: string | null;
  decidedByName?: string | null;
  decisionReason?: string | null;
  matterId: string;
}

// PR15 — only these stage types are eligible to become playbooks.
// Pre-merits + guidance produce checklist / retrieval output, not
// synthesized content suitable for a future Stage 1 match.
const PLAYBOOK_ELIGIBLE_STAGES = new Set([
  'statutory',
  'case_law',
  'deconstruct',
]);

function decisionTone(d: Props['currentDecision']): string {
  return d === 'accepted'
    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
    : d === 'rejected'
      ? 'border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
      : d === 'escalated'
        ? 'border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
        : 'border-ink-200 dark:border-ink-700 text-ink-500 dark:text-ink-400';
}

export function StageDecisionBar({
  stageId,
  stageName,
  workerConfidence,
  currentDecision,
  decidedAtIso,
  decisionReason,
  matterId,
}: Props) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState<'reject' | 'escalate' | 'playbook' | null>(null);
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // PR15 — save-as-playbook follow-up state.
  const [pbTitle, setPbTitle] = useState('');
  const [pbAlsoSaveNotion, setPbAlsoSaveNotion] = useState(false);
  const [pbSavedMsg, setPbSavedMsg] = useState<string | null>(null);

  const override = trpc.analysis.overrideStage.useMutation({
    onSuccess: () => {
      void utils.analysis.forMatter.invalidate({ matterId });
      // PR8: tools.context reads from audit_log for the historical
      // signal; refreshing it picks up the new decision immediately.
      void utils.tools.context.invalidate({ matterId });
      setOpen(null);
      setReason('');
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const savePlaybook = trpc.analysis.savePlaybookFromStage.useMutation({
    onSuccess: (data) => {
      setOpen(null);
      setPbTitle('');
      setPbAlsoSaveNotion(false);
      setPbSavedMsg(
        `Playbook saved (id ${data.playbookId.slice(0, 8)}…)${
          data.notionUrl ? ' — also written to Notion' : ''
        }. Future similar matters will match this in Stage 1.`,
      );
      setErrorMsg(null);
    },
    onError: (err) => setErrorMsg(err.message),
  });

  const canSaveAsPlaybook =
    currentDecision === 'accepted' &&
    stageName !== undefined &&
    PLAYBOOK_ELIGIBLE_STAGES.has(stageName) &&
    workerConfidence !== 'LOW';

  if (currentDecision !== 'pending') {
    return (
      <div className="border-t pt-2 space-y-2">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className={`font-mono uppercase px-1.5 py-0.5 rounded border ${decisionTone(currentDecision)}`}>
            {currentDecision}
          </span>
          <div className="flex-1 min-w-0 truncate text-ink-500 dark:text-ink-400">
            {decisionReason && <span className="italic">"{decisionReason}"</span>}
            {decidedAtIso && (
              <span className="ml-2 text-ink-400 dark:text-ink-500">
                · {new Date(decidedAtIso).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canSaveAsPlaybook && (
              <button
                onClick={() => {
                  setOpen('playbook');
                  setPbTitle('');
                  setPbAlsoSaveNotion(false);
                  setPbSavedMsg(null);
                  setErrorMsg(null);
                }}
                className="text-[11px] px-2 py-0.5 border rounded border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300 hover:bg-brand-50 dark:hover:bg-brand-950/40"
                title="Save this stage's output as a playbook so future similar matters match in Stage 1"
              >
                Save as playbook…
              </button>
            )}
            <button
              onClick={() => override.mutate({ stageId, decision: 'accepted' })}
              disabled={override.isPending}
              className="text-[11px] px-1.5 py-0.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
              title="Re-mark this stage as accepted (overrides the prior decision)"
            >
              revise → accept
            </button>
          </div>
        </div>
        {pbSavedMsg && (
          <div className="text-[11px] text-emerald-700 dark:text-emerald-300">{pbSavedMsg}</div>
        )}
        {open === 'playbook' && (
          <PlaybookForm
            title={pbTitle}
            onTitleChange={setPbTitle}
            alsoSaveNotion={pbAlsoSaveNotion}
            onAlsoSaveNotionChange={setPbAlsoSaveNotion}
            errorMsg={errorMsg}
            onCancel={() => {
              setOpen(null);
              setErrorMsg(null);
            }}
            onSave={() =>
              savePlaybook.mutate({
                stageId,
                title: pbTitle.trim() || undefined,
                alsoSaveToNotion: pbAlsoSaveNotion,
              })
            }
            saving={savePlaybook.isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div className="border-t pt-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-ink-500 dark:text-ink-400">
          Lawyer decision
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => override.mutate({ stageId, decision: 'accepted' })}
            disabled={override.isPending}
            className="text-[11px] px-2 py-0.5 border rounded border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-50"
          >
            Accept
          </button>
          <button
            onClick={() => {
              setOpen('reject');
              setErrorMsg(null);
            }}
            disabled={override.isPending}
            className="text-[11px] px-2 py-0.5 border rounded border-red-300 dark:border-red-800 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
          >
            Reject…
          </button>
          <button
            onClick={() => {
              setOpen('escalate');
              setErrorMsg(null);
            }}
            disabled={override.isPending}
            className="text-[11px] px-2 py-0.5 border rounded border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
          >
            Escalate…
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-1.5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            placeholder={
              open === 'reject'
                ? 'Why is this stage wrong? (feeds the eval set)'
                : 'What does the senior reviewer need to know?'
            }
            className="w-full border rounded px-2 py-1 text-xs"
          />
          {errorMsg && (
            <div className="text-[11px] text-red-700 dark:text-red-300">{errorMsg}</div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={() => {
                setOpen(null);
                setReason('');
                setErrorMsg(null);
              }}
              className="text-[11px] px-2 py-0.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Cancel
            </button>
            <button
              onClick={() =>
                override.mutate({
                  stageId,
                  decision: open === 'reject' ? 'rejected' : 'escalated',
                  reason: reason.trim(),
                })
              }
              disabled={override.isPending || !reason.trim()}
              className={`text-[11px] px-2 py-0.5 border rounded text-white disabled:opacity-50 ${
                open === 'reject' ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-600 hover:bg-amber-700'
              }`}
            >
              {open === 'reject' ? 'Reject stage' : 'Escalate to senior'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// PR15 — save-as-playbook form. Renders inline below the decision
// pill when the lawyer clicks "Save as playbook…". Title is optional
// (server derives a default from the matter + stage); body is always
// derived from the stage output server-side.
function PlaybookForm({
  title,
  onTitleChange,
  alsoSaveNotion,
  onAlsoSaveNotionChange,
  errorMsg,
  onCancel,
  onSave,
  saving,
}: {
  title: string;
  onTitleChange: (s: string) => void;
  alsoSaveNotion: boolean;
  onAlsoSaveNotionChange: (b: boolean) => void;
  errorMsg: string | null;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div className="border rounded p-2 space-y-2 bg-brand-50/30 dark:bg-brand-950/20">
      <div className="text-[11px] text-ink-600 dark:text-ink-400">
        Save this stage's output as a playbook. Future similar matters will see this in the
        Stage 1 playbook check.
      </div>
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        placeholder="Optional title (default: matter title + stage)"
        className="w-full border rounded px-2 py-1 text-xs"
      />
      <label className="flex items-center gap-1.5 text-[11px] text-ink-700 dark:text-ink-300">
        <input
          type="checkbox"
          checked={alsoSaveNotion}
          onChange={(e) => onAlsoSaveNotionChange(e.target.checked)}
        />
        Also mirror to Notion KB
      </label>
      {errorMsg && <div className="text-[11px] text-red-700 dark:text-red-300">{errorMsg}</div>}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onCancel}
          className="text-[11px] px-2 py-0.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="text-[11px] px-2 py-0.5 border rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save playbook'}
        </button>
      </div>
    </div>
  );
}

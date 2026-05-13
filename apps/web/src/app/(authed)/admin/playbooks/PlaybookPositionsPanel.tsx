'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

type PositionForm = {
  id?: string;
  topic: string;
  trigger: string;
  standardPosition: string;
  acceptableRange: string;
  flaggedConditions: string;
  suggestedRedline: string;
  citation: string;
  isActive: boolean;
};

const emptyPosition = (): PositionForm => ({
  topic: '',
  trigger: '',
  standardPosition: '',
  acceptableRange: '',
  flaggedConditions: '',
  suggestedRedline: '',
  citation: '',
  isActive: true,
});

export function PlaybookPositionsPanel({ playbookId }: { playbookId: string }) {
  const utils = trpc.useUtils();
  const { data: positions = [], isLoading } = trpc.admin.listPlaybookPositions.useQuery({
    playbookId,
  });
  const upsert = trpc.admin.upsertPlaybookPosition.useMutation({
    onSuccess: () => {
      utils.admin.listPlaybookPositions.invalidate({ playbookId });
      setEditing(null);
    },
  });
  const remove = trpc.admin.deletePlaybookPosition.useMutation({
    onSuccess: () => utils.admin.listPlaybookPositions.invalidate({ playbookId }),
  });
  const [editing, setEditing] = useState<PositionForm | null>(null);

  return (
    <div className="mt-3 rounded border border-ink-200 dark:border-ink-800 bg-ink-50 dark:bg-ink-950 p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium uppercase tracking-wider text-ink-500 dark:text-ink-400">
          Executable positions ({positions.length})
        </h4>
        {!editing && (
          <button
            type="button"
            onClick={() => setEditing(emptyPosition())}
            className="text-xs border rounded px-2 py-0.5 hover:bg-ink-100 dark:hover:bg-ink-800"
          >
            + Position
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">Loading…</p>
      ) : positions.length === 0 && !editing ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          No positions yet. Each position defines a clause topic, a standard
          stance, and the conditions under which a clause is FLAGGED.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {positions.map((p) => (
            <li
              key={p.id}
              className="text-xs bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded p-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{p.topic}</div>
                <div className="flex items-center gap-2 shrink-0">
                  {!p.isActive && (
                    <span className="text-[10px] text-ink-400">inactive</span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: p.id,
                        topic: p.topic,
                        trigger: p.trigger,
                        standardPosition: p.standardPosition,
                        acceptableRange: p.acceptableRange ?? '',
                        flaggedConditions: p.flaggedConditions ?? '',
                        suggestedRedline: p.suggestedRedline ?? '',
                        citation: p.citation ?? '',
                        isActive: p.isActive,
                      })
                    }
                    className="text-ink-500 hover:text-ink-800 dark:hover:text-ink-200"
                  >
                    Edit
                  </button>
                </div>
              </div>
              <div className="text-ink-600 dark:text-ink-400 mt-0.5">
                <span className="opacity-70">trigger:</span> {p.trigger}
              </div>
              <div className="text-ink-700 dark:text-ink-300 mt-0.5">
                <span className="opacity-70">standard:</span> {p.standardPosition}
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <form
          className="mt-3 space-y-2 bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded p-3"
          onSubmit={(e) => {
            e.preventDefault();
            upsert.mutate({
              id: editing.id,
              playbookId,
              topic: editing.topic.trim(),
              trigger: editing.trigger.trim(),
              standardPosition: editing.standardPosition.trim(),
              acceptableRange: editing.acceptableRange.trim() || undefined,
              flaggedConditions: editing.flaggedConditions.trim() || undefined,
              suggestedRedline: editing.suggestedRedline.trim() || undefined,
              citation: editing.citation.trim() || undefined,
              isActive: editing.isActive,
            });
          }}
        >
          <input
            type="text"
            placeholder="Topic (e.g. Liability Cap)"
            value={editing.topic}
            onChange={(e) => setEditing({ ...editing, topic: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
            required
          />
          <textarea
            placeholder="Trigger — when does this position apply? (e.g. 'any clause limiting damages or liability')"
            value={editing.trigger}
            onChange={(e) => setEditing({ ...editing, trigger: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[40px]"
            required
          />
          <textarea
            placeholder="Standard position — what we consider acceptable (e.g. '2x annual contract value, mutual')"
            value={editing.standardPosition}
            onChange={(e) => setEditing({ ...editing, standardPosition: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[40px]"
            required
          />
          <textarea
            placeholder="Acceptable range — what variations we accept without escalation (e.g. '1x to 3x; one-way OK if enterprise')"
            value={editing.acceptableRange}
            onChange={(e) => setEditing({ ...editing, acceptableRange: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[40px]"
          />
          <textarea
            placeholder="Flagged conditions — what triggers escalation (e.g. 'uncapped, gross negligence carve-out')"
            value={editing.flaggedConditions}
            onChange={(e) => setEditing({ ...editing, flaggedConditions: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[40px]"
          />
          <textarea
            placeholder="Suggested redline — template language to propose"
            value={editing.suggestedRedline}
            onChange={(e) => setEditing({ ...editing, suggestedRedline: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[40px]"
          />
          <textarea
            placeholder="Citation — why is this our position? (internal policy, prior precedent)"
            value={editing.citation}
            onChange={(e) => setEditing({ ...editing, citation: e.target.value })}
            className="w-full text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent min-h-[30px]"
          />
          <div className="flex items-center justify-between gap-2 pt-1">
            <label className="text-[11px] text-ink-600 dark:text-ink-400 flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
              />
              Active
            </label>
            <div className="flex items-center gap-2">
              {editing.id && (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      editing.id &&
                      confirm('Delete this position? This cannot be undone.')
                    ) {
                      remove.mutate({ id: editing.id });
                      setEditing(null);
                    }
                  }}
                  className="text-xs text-red-600 hover:text-red-800 dark:hover:text-red-400"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 hover:bg-ink-50 dark:hover:bg-ink-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={upsert.isPending}
                className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded px-3 py-1 disabled:opacity-50"
              >
                {upsert.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          {upsert.error && (
            <p className="text-xs text-red-600 dark:text-red-400">{upsert.error.message}</p>
          )}
        </form>
      )}
    </div>
  );
}

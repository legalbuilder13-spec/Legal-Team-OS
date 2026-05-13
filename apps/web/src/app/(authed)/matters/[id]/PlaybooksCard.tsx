'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema } from '@legal/types';

const PRACTICE_AREAS = PracticeAreaSchema.options;

type EditingState = {
  id?: string;
  practiceArea: (typeof PRACTICE_AREAS)[number];
  title: string;
  body: string;
  isActive: boolean;
  changeSummary: string;
};

export function PlaybooksCard({ matterId }: { matterId: string }) {
  const { data: pbs = [], refetch } = trpc.matters.relevantPlaybooks.useQuery({ matterId });
  const upsert = trpc.admin.upsertPlaybook.useMutation({
    onSuccess: () => {
      refetch();
      setEditing(null);
    },
  });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);

  if (pbs.length === 0 && !editing) {
    return (
      <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Playbooks</h2>
        </div>
        <p className="text-xs text-ink-500 dark:text-ink-400 mt-1">
          No active playbooks for this practice area.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium">Playbooks</h2>
        <span className="text-xs text-ink-400 dark:text-ink-500">{pbs.length} active</span>
      </div>

      {editing && (
        <div className="border rounded-md p-3 mb-3 bg-ink-50 dark:bg-ink-900 space-y-2">
          <div className="text-xs text-ink-500 dark:text-ink-400">
            {editing.id ? 'Editing playbook' : 'New playbook'}
          </div>
          <input
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="Title"
            className="w-full border rounded px-2 py-1 text-sm bg-white dark:bg-ink-900"
          />
          <select
            value={editing.practiceArea}
            onChange={(e) =>
              setEditing({
                ...editing,
                practiceArea: e.target.value as EditingState['practiceArea'],
              })
            }
            className="w-full border rounded px-2 py-1 text-sm bg-white dark:bg-ink-900"
          >
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={8}
            placeholder="Markdown body…"
            className="w-full border rounded px-2 py-1 text-xs font-mono bg-white dark:bg-ink-900"
          />
          {editing.id && (
            <input
              value={editing.changeSummary}
              onChange={(e) => setEditing({ ...editing, changeSummary: e.target.value })}
              placeholder="Change summary (optional)"
              className="w-full border rounded px-2 py-1 text-xs bg-white dark:bg-ink-900"
            />
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={editing.isActive}
              onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
            />
            Active
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setEditing(null)} className="text-xs px-3 py-1 border rounded">
              Cancel
            </button>
            <button
              disabled={upsert.isPending || !editing.title.trim() || !editing.body.trim()}
              onClick={() =>
                upsert.mutate({
                  id: editing.id,
                  practiceArea: editing.practiceArea,
                  title: editing.title,
                  body: editing.body,
                  isActive: editing.isActive,
                  changeSummary: editing.id ? editing.changeSummary || undefined : undefined,
                })
              }
              className="bg-brand-600 text-white text-xs px-3 py-1 rounded disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      <ul className="space-y-2">
        {pbs.map((pb) => (
          <li key={pb.id} className="border rounded-md">
            <div className="flex items-center justify-between px-3 py-2">
              <button
                onClick={() => setExpanded(expanded === pb.id ? null : pb.id)}
                className="text-left flex-1 hover:text-brand-700"
              >
                <div className="font-medium">{pb.title}</div>
                <div className="text-xs text-ink-500 dark:text-ink-400">v{pb.version}</div>
              </button>
              <button
                onClick={() =>
                  setEditing({
                    id: pb.id,
                    practiceArea: pb.practiceArea,
                    title: pb.title,
                    body: pb.body,
                    isActive: pb.isActive,
                    changeSummary: '',
                  })
                }
                className="text-xs text-brand-600 hover:underline ml-2"
              >
                Edit
              </button>
            </div>
            {expanded === pb.id && (
              <pre className="text-xs whitespace-pre-wrap font-mono px-3 pb-3 text-ink-700 dark:text-ink-300">
                {pb.body}
              </pre>
            )}
          </li>
        ))}
      </ul>

      {!editing && (
        <button
          onClick={() =>
            setEditing({
              practiceArea: pbs[0]?.practiceArea ?? 'commercial',
              title: '',
              body: '',
              isActive: true,
              changeSummary: '',
            })
          }
          className="mt-3 text-xs text-brand-600 hover:underline"
        >
          + New playbook
        </button>
      )}
    </div>
  );
}

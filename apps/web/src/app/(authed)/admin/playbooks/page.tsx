'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema } from '@legal/types';
import { PlaybookPositionsPanel } from './PlaybookPositionsPanel';
import { formatPracticeArea } from '@/lib/format';

const PRACTICE_AREAS = PracticeAreaSchema.options;

type PlaybookForm = {
  id?: string;
  practiceArea: (typeof PRACTICE_AREAS)[number];
  title: string;
  body: string;
  isActive: boolean;
};

const emptyForm = (): PlaybookForm => ({
  practiceArea: 'commercial',
  title: '',
  body: '',
  isActive: true,
});

export default function PlaybooksAdminPage() {
  const { data: playbooks = [], refetch } = trpc.admin.listPlaybooks.useQuery();
  const upsert = trpc.admin.upsertPlaybook.useMutation({ onSuccess: () => { refetch(); setEditing(null); } });
  const remove = trpc.admin.deletePlaybook.useMutation({ onSuccess: () => refetch() });

  const [editing, setEditing] = useState<PlaybookForm | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [positionsFor, setPositionsFor] = useState<string | null>(null);
  const { data: versions = [] } = trpc.admin.listPlaybookVersions.useQuery(
    { playbookId: historyFor ?? '' },
    { enabled: !!historyFor },
  );

  const byArea = PRACTICE_AREAS.map((area) => ({
    area,
    items: playbooks.filter((p) => p.practiceArea === area),
  })).filter((g) => g.items.length > 0 || editing?.practiceArea === g.area);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Playbooks</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
            Guidance injected into the AI triage prompt for each practice area.
          </p>
        </div>
        <button
          onClick={() => setEditing(emptyForm())}
          className="bg-brand-600 text-white text-sm px-4 py-2 rounded"
        >
          New playbook
        </button>
      </div>

      {editing && (
        <div className="bg-white dark:bg-ink-900 border rounded-lg p-6 mb-6 space-y-4">
          <h2 className="font-medium">{editing.id ? 'Edit playbook' : 'New playbook'}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">Practice area</label>
              <select
                value={editing.practiceArea}
                onChange={(e) =>
                  setEditing({ ...editing, practiceArea: e.target.value as PlaybookForm['practiceArea'] })
                }
                className="w-full border rounded px-3 py-1.5 text-sm"
              >
                {PRACTICE_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {formatPracticeArea(a)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="rounded"
                />
                Active (injected into triage)
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">Title</label>
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="e.g. NDA Review Checklist"
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink-600 dark:text-ink-400 mb-1">
              Guidance body (markdown supported)
            </label>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={10}
              placeholder="Write the checklist or guidance the AI should follow for this practice area…"
              className="w-full border rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditing(null)}
              className="text-sm px-4 py-2 border rounded"
            >
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
                })
              }
              className="bg-brand-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {playbooks.length === 0 && !editing ? (
        <div className="text-sm text-ink-500 dark:text-ink-400 bg-white dark:bg-ink-900 border rounded-lg p-6 text-center">
          No playbooks yet. Create one to start injecting guidance into the AI triage prompt.
        </div>
      ) : (
        <div className="space-y-6">
          {byArea.map(({ area, items }) =>
            items.length === 0 ? null : (
              <div key={area}>
                <h2 className="text-xs uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-2 font-medium">
                  {formatPracticeArea(area)}
                </h2>
                <div className="space-y-3">
                  {items.map((pb) => (
                    <div key={pb.id}>
                    <div
                      className="bg-white dark:bg-ink-900 border rounded-lg p-4 flex items-start justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-sm">{pb.title}</span>
                          {!pb.isActive && (
                            <span className="text-xs bg-ink-100 dark:bg-ink-800 text-ink-500 dark:text-ink-400 px-1.5 py-0.5 rounded">
                              inactive
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-ink-500 dark:text-ink-400 line-clamp-2">{pb.body}</p>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <span className="text-xs text-ink-400 dark:text-ink-500">v{pb.version}</span>
                        <button
                          onClick={() => setPositionsFor(positionsFor === pb.id ? null : pb.id)}
                          className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                        >
                          {positionsFor === pb.id ? 'Hide positions' : 'Positions'}
                        </button>
                        <button
                          onClick={() => setHistoryFor(historyFor === pb.id ? null : pb.id)}
                          className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                        >
                          {historyFor === pb.id ? 'Hide history' : 'History'}
                        </button>
                        <button
                          onClick={() =>
                            setEditing({
                              id: pb.id,
                              practiceArea: pb.practiceArea,
                              title: pb.title,
                              body: pb.body,
                              isActive: pb.isActive,
                            })
                          }
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${pb.title}"?`)) remove.mutate({ id: pb.id });
                          }}
                          className="text-xs text-red-500 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {positionsFor === pb.id && (
                      <PlaybookPositionsPanel playbookId={pb.id} />
                    )}
                    {historyFor === pb.id && (
                      <div className="bg-ink-50 dark:bg-ink-900 border border-t-0 rounded-b-lg p-3 -mt-1">
                        <div className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-2">
                          Version history ({versions.length} prior version{versions.length === 1 ? '' : 's'})
                        </div>
                        {versions.length === 0 ? (
                          <div className="text-xs text-ink-500 dark:text-ink-400">
                            This playbook has not been edited since creation.
                          </div>
                        ) : (
                          <ul className="space-y-2">
                            {versions.map((v) => (
                              <li key={v.id} className="text-xs border-l-2 border-ink-300 pl-2">
                                <div className="flex justify-between items-baseline">
                                  <span className="font-medium">v{v.versionNumber} · {v.title}</span>
                                  <span className="text-ink-400 dark:text-ink-500">
                                    {new Date(v.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                                {v.changeSummary && (
                                  <div className="text-ink-600 dark:text-ink-400 italic mt-0.5">{v.changeSummary}</div>
                                )}
                                <details className="mt-1">
                                  <summary className="text-ink-500 dark:text-ink-400 cursor-pointer">
                                    Show body
                                  </summary>
                                  <pre className="text-ink-700 dark:text-ink-300 whitespace-pre-wrap mt-1 font-mono text-[10px]">
                                    {v.body}
                                  </pre>
                                </details>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}

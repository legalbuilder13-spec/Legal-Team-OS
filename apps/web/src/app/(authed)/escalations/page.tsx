'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const STATUS_OPTIONS = ['open', 'resolved'] as const;
type Status = (typeof STATUS_OPTIONS)[number];

const SEVERITY_COLOR: Record<string, string> = {
  low: 'bg-ink-100 dark:bg-ink-800 text-ink-700 dark:text-ink-300',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export default function EscalationsPage() {
  const [status, setStatus] = useState<Status>('open');
  const [mineOnly, setMineOnly] = useState(false);

  const { data = [], isLoading, refetch } = trpc.escalations.list.useQuery({ status, mineOnly });
  const resolve = trpc.escalations.resolve.useMutation({ onSuccess: () => refetch() });

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Escalations</h1>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
            />
            My matters only
          </label>
          <div className="border rounded text-sm overflow-hidden flex">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`px-3 py-1 ${status === s ? 'bg-brand-600 text-white' : 'bg-white dark:bg-ink-900 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="text-ink-500 dark:text-ink-400">Loading…</div>
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-ink-900 border rounded-lg p-6 text-center text-sm text-ink-500 dark:text-ink-400">
          No {status} escalations{mineOnly ? ' on your matters' : ''}.
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((e) => (
            <li key={e.id} className="bg-white dark:bg-ink-900 border rounded-lg p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded ${SEVERITY_COLOR[e.severity] ?? ''}`}>
                      {e.severity}
                    </span>
                    <span className="text-xs text-ink-500 dark:text-ink-400">{e.kind}</span>
                    {e.createdByKind === 'system' && (
                      <span className="text-xs text-ink-400 dark:text-ink-500">· auto</span>
                    )}
                  </div>
                  <div className="font-medium mt-1">{e.title}</div>
                  <p className="text-sm text-ink-700 dark:text-ink-300 mt-1 whitespace-pre-wrap">{e.body}</p>
                  <div className="text-xs text-ink-500 dark:text-ink-400 mt-2">
                    <Link href={`/matters/${e.matterId}`} className="text-brand-600 hover:underline">
                      {e.matterShortId} — {e.matterTitle}
                    </Link>
                    {e.matterAssigneeName && ` · assigned to ${e.matterAssigneeName}`}
                    {` · ${new Date(e.createdAt).toLocaleString()}`}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {e.status !== 'resolved' && (
                    <button
                      onClick={() => {
                        const note = prompt('Resolution note (optional)') ?? undefined;
                        resolve.mutate({ id: e.id, resolutionNote: note });
                      }}
                      className="text-xs border rounded px-2 py-1 bg-brand-600 text-white hover:bg-brand-700"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

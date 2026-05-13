'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const ACTOR_OPTIONS = ['all', 'user', 'system', 'copilot'] as const;
type Actor = (typeof ACTOR_OPTIONS)[number];

export default function AuditLogPage() {
  const [actor, setActor] = useState<Actor>('all');
  const [actionContains, setActionContains] = useState('');

  const { data = [], isLoading } = trpc.admin.listAuditLog.useQuery({
    actor,
    actionContains: actionContains.trim() || undefined,
    limit: 200,
  });

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4 gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Audit Log</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
            Every state-changing action by users, the AI copilot, and system jobs.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <div className="border rounded text-sm overflow-hidden flex">
          {ACTOR_OPTIONS.map((a) => (
            <button
              key={a}
              onClick={() => setActor(a)}
              className={`px-3 py-1 ${actor === a ? 'bg-brand-600 text-white' : 'bg-white dark:bg-ink-900 hover:bg-ink-50 dark:hover:bg-ink-800'}`}
            >
              {a}
            </button>
          ))}
        </div>
        <input
          value={actionContains}
          onChange={(e) => setActionContains(e.target.value)}
          placeholder="Filter action (e.g. status, escalation, notion)"
          className="border rounded px-2 py-1 text-sm flex-1 max-w-md"
        />
      </div>

      {isLoading ? (
        <div className="text-ink-500 dark:text-ink-400">Loading…</div>
      ) : data.length === 0 ? (
        <div className="text-sm text-ink-500 dark:text-ink-400 bg-white dark:bg-ink-900 border rounded-lg p-6 text-center">
          No matching audit entries.
        </div>
      ) : (
        <div className="bg-white dark:bg-ink-900 border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-ink-50 dark:bg-ink-900 border-b">
              <tr className="text-left text-xs text-ink-500 dark:text-ink-400">
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Matter</th>
                <th className="px-3 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => {
                const details = row.details as Record<string, unknown> | null;
                const source = details?.source as string | undefined;
                return (
                  <tr key={row.id} className="border-b last:border-0 align-top">
                    <td className="px-3 py-2 text-xs text-ink-500 dark:text-ink-400 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div>{row.actorName ?? row.actorKind}</div>
                      <div className="text-xs text-ink-400 dark:text-ink-500">
                        {row.actorKind}
                        {source ? ` · ${source}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <code className="text-xs bg-ink-50 dark:bg-ink-900 border rounded px-1 py-0.5">
                        {row.action}
                      </code>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {row.matterId && (
                        <Link
                          href={`/matters/${row.matterId}`}
                          className="text-brand-600 hover:underline"
                        >
                          {row.matterShortId ?? row.matterId.slice(0, 8)}
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <details>
                        <summary className="text-xs text-ink-500 dark:text-ink-400 cursor-pointer">
                          {Object.keys(details ?? {}).length} field
                          {Object.keys(details ?? {}).length === 1 ? '' : 's'}
                        </summary>
                        <pre className="text-[10px] text-ink-700 dark:text-ink-300 whitespace-pre-wrap mt-1 max-w-md">
                          {JSON.stringify(details ?? {}, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

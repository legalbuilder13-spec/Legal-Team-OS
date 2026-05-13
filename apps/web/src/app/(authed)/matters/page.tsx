'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc';

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_review: 'In Review',
  waiting_on_requester: 'Waiting on Requester',
  waiting_on_third_party: 'Waiting on 3rd Party',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const PRIORITY_COLOR: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-ink-100 text-ink-700',
};

export default function MattersPage() {
  const { data, isLoading } = trpc.matters.list.useQuery({ limit: 100 });

  return (
    <div>
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Matters</h1>
      </header>
      <div className="bg-white rounded-lg border border-ink-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">ID</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Practice Area</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Assignee</th>
              <th className="px-4 py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  Loading…
                </td>
              </tr>
            ) : data?.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-500">
                  No matters yet. Try <code>/legal</code> in Slack.
                </td>
              </tr>
            ) : (
              data?.map((m) => (
                <tr key={m.id} className="border-t border-ink-100 hover:bg-ink-50">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link className="text-brand-600 hover:underline" href={`/matters/${m.id}`}>
                      {m.shortId}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{m.title}</td>
                  <td className="px-4 py-2 capitalize">{m.practiceArea ?? '—'}</td>
                  <td className="px-4 py-2">{STATUS_LABELS[m.status] ?? m.status}</td>
                  <td className="px-4 py-2">
                    {m.priority ? (
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs ${PRIORITY_COLOR[m.priority]}`}
                      >
                        {m.priority}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-2">{m.assigneeName ?? '—'}</td>
                  <td className="px-4 py-2 text-xs text-ink-500">
                    {new Date(m.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

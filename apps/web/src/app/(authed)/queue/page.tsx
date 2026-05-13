'use client';

import Link from 'next/link';
import { trpc } from '@/lib/trpc';

export default function QueuePage() {
  const { data, isLoading } = trpc.matters.myQueue.useQuery();
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">My Queue</h1>
      {isLoading ? (
        <div className="text-ink-500 dark:text-ink-400">Loading…</div>
      ) : data && data.length > 0 ? (
        <ul className="space-y-2">
          {data.map((m) => (
            <li key={m.id} className="bg-white dark:bg-ink-900 border rounded-lg p-4">
              <Link href={`/matters/${m.id}`} className="font-medium text-brand-700">
                {m.shortId} — {m.title}
              </Link>
              <div className="text-xs text-ink-500 dark:text-ink-400 mt-1">
                {m.status}
                {m.slaDueAt && ` · SLA ${new Date(m.slaDueAt).toLocaleString()}`}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-ink-500 dark:text-ink-400">Nothing assigned to you.</div>
      )}
    </div>
  );
}

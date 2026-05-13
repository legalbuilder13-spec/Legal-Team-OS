'use client';

import Link from 'next/link';
import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema } from '@legal/types';

const PRACTICE_AREAS = PracticeAreaSchema.options;

export default function ArchivePage() {
  const [query, setQuery] = useState('');
  const [practiceArea, setPracticeArea] = useState<string>('');
  const [submittedQuery, setSubmittedQuery] = useState('');

  const { data: results = [], isLoading } = trpc.matters.archiveSearch.useQuery({
    query: submittedQuery || undefined,
    practiceArea: practiceArea
      ? (practiceArea as (typeof PRACTICE_AREAS)[number])
      : undefined,
    limit: 50,
  });

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Matter Archive</h1>
        <p className="text-sm text-ink-500 mt-1">
          Search and reference closed matters as precedent for current work.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setSubmittedQuery(query);
        }}
        className="bg-white border rounded-lg p-4 mb-6 flex gap-3 items-end"
      >
        <div className="flex-1">
          <label className="block text-xs font-medium text-ink-600 mb-1">
            Search closed matters
          </label>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. liability cap negotiation"
            className="w-full border rounded px-3 py-1.5 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-600 mb-1">Practice area</label>
          <select
            value={practiceArea}
            onChange={(e) => setPracticeArea(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm"
          >
            <option value="">All</option>
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="bg-brand-600 text-white text-sm px-4 py-1.5 rounded h-[34px]"
        >
          Search
        </button>
      </form>

      {isLoading ? (
        <div className="text-sm text-ink-500">Searching…</div>
      ) : results.length === 0 ? (
        <div className="text-sm text-ink-500 bg-white border rounded-lg p-6 text-center">
          No closed matters match your search.
        </div>
      ) : (
        <div className="bg-white border rounded-lg divide-y">
          {results.map((m) => {
            const id = 'id' in m ? m.id : '';
            const shortId = 'shortId' in m ? m.shortId : 'short_id' in m ? m.short_id : '';
            const title = m.title;
            const summary = m.summary;
            const area = 'practiceArea' in m ? m.practiceArea : 'practice_area' in m ? m.practice_area : null;
            const pri = m.priority;
            const closedAt = 'closedAt' in m ? m.closedAt : 'closed_at' in m ? m.closed_at : null;
            return (
              <Link key={id} href={`/matters/${id}`} className="block p-4 hover:bg-ink-50">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-ink-500 mb-1">{shortId}</div>
                    <div className="font-medium text-sm">{title}</div>
                    {summary && (
                      <p className="text-xs text-ink-500 mt-1 line-clamp-2">{summary}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {area && (
                      <span className="text-xs bg-ink-100 px-1.5 py-0.5 rounded capitalize">
                        {String(area)}
                      </span>
                    )}
                    {pri && (
                      <span className="text-xs bg-ink-100 px-1.5 py-0.5 rounded">
                        {String(pri)}
                      </span>
                    )}
                    {closedAt && (
                      <span className="text-xs text-ink-400">
                        {new Date(closedAt as string | Date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

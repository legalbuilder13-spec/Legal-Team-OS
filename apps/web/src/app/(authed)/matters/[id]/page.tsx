'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { MatterStatusSchema } from '@legal/types';
import { ChatPanel } from './ChatPanel';
import { PlaybooksCard } from './PlaybooksCard';
import { SaveToNotionButton } from './SaveToNotionButton';
import { SaveToDriveButton } from './SaveToDriveButton';
import { EscalationsCard } from './EscalationsCard';

interface SalesforceContext {
  source: 'salesforce';
  fetched_at: string;
  data: {
    configured?: boolean;
    name?: string | null;
    domain?: string | null;
    records?: Array<{
      Id: string;
      Name: string;
      Website?: string | null;
      Industry?: string | null;
      AnnualRevenue?: number | null;
      Owner?: { Name?: string } | null;
    }>;
  };
}

function TriageConfidence({ metadata }: { metadata: Record<string, unknown> }) {
  const practiceConf = metadata.practiceAreaConfidence;
  const priorityConf = metadata.priorityConfidence;
  const needsReview = metadata.requiresHumanReview === true;
  if (typeof practiceConf !== 'number' && typeof priorityConf !== 'number') {
    return null;
  }
  const pct = (n: unknown) => (typeof n === 'number' ? `${Math.round(n * 100)}%` : '—');
  const lowest = Math.min(
    typeof practiceConf === 'number' ? practiceConf : 1,
    typeof priorityConf === 'number' ? priorityConf : 1,
  );
  const tone = needsReview
    ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 border-red-200 dark:border-red-900'
    : lowest >= 0.85
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-900';
  return (
    <div
      className={`text-[11px] px-2 py-1 rounded border font-mono ${tone}`}
      title={typeof metadata.reviewReason === 'string' ? metadata.reviewReason : undefined}
    >
      <span className="opacity-70">area</span> {pct(practiceConf)} ·{' '}
      <span className="opacity-70">priority</span> {pct(priorityConf)}
      {needsReview && <span className="ml-2 font-semibold">· review</span>}
    </div>
  );
}

function SalesforceContextCard({ ctx }: { ctx: SalesforceContext }) {
  const records = ctx.data.records ?? [];
  if (ctx.data.configured === false) {
    return (
      <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
        <h2 className="font-medium mb-1">Salesforce</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Not configured. Add credentials to the AI service to enable counterparty lookups.
        </p>
      </div>
    );
  }
  return (
    <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium">Salesforce</h2>
        <span className="text-xs text-ink-400 dark:text-ink-500">
          {new Date(ctx.fetched_at).toLocaleString()}
        </span>
      </div>
      {records.length === 0 ? (
        <p className="text-xs text-ink-500 dark:text-ink-400">
          No accounts matched {ctx.data.name ?? ctx.data.domain ?? 'this counterparty'}.
        </p>
      ) : (
        <ul className="space-y-3">
          {records.map((r) => (
            <li key={r.Id} className="border-t border-ink-100 dark:border-ink-800 pt-2 first:border-t-0 first:pt-0">
              <div className="font-medium">{r.Name}</div>
              <dl className="text-xs text-ink-600 dark:text-ink-400 space-y-0.5 mt-1">
                {r.Website && (
                  <div className="flex justify-between gap-3">
                    <dt>Website</dt>
                    <dd className="truncate">{r.Website}</dd>
                  </div>
                )}
                {r.Industry && (
                  <div className="flex justify-between gap-3">
                    <dt>Industry</dt>
                    <dd>{r.Industry}</dd>
                  </div>
                )}
                {r.AnnualRevenue != null && (
                  <div className="flex justify-between gap-3">
                    <dt>Revenue</dt>
                    <dd>${r.AnnualRevenue.toLocaleString()}</dd>
                  </div>
                )}
                {r.Owner?.Name && (
                  <div className="flex justify-between gap-3">
                    <dt>SF Owner</dt>
                    <dd>{r.Owner.Name}</dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface CounterpartyMemoryProfile {
  summary?: string;
  totalMatters?: number;
  avgCycleTimeDays?: number;
  lastContactAt?: string;
  practiceAreas?: Array<{ area: string; count: number }>;
  commonRedlines?: string[];
  escalationTriggers?: string[];
  typicalPositions?: string[];
}

export default function MatterDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: matter, isLoading, refetch } = trpc.matters.get.useQuery({ id });
  const { data: similarMatters = [] } = trpc.matters.similarMatters.useQuery(
    { matterId: id },
    { enabled: !!id },
  );
  const { data: counterparty } = trpc.counterparties.get.useQuery(
    { id: matter?.counterpartyId ?? '' },
    { enabled: !!matter?.counterpartyId },
  );
  const addNote = trpc.matters.addNote.useMutation({ onSuccess: () => refetch() });
  const setStatus = trpc.matters.setStatus.useMutation({ onSuccess: () => refetch() });
  const [note, setNote] = useState('');
  const [chatOpen, setChatOpen] = useState(true);

  if (isLoading || !matter) return <div className="text-ink-500 dark:text-ink-400">Loading…</div>;

  return (
    <div className={chatOpen ? 'max-w-[110rem]' : 'max-w-5xl'}>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-mono text-ink-500 dark:text-ink-400">{matter.shortId}</div>
          <h1 className="text-2xl font-semibold">{matter.title}</h1>
          <div className="mt-2 flex items-center gap-3 text-sm text-ink-600 dark:text-ink-400 flex-wrap">
            <span>Status:</span>
            <select
              value={matter.status}
              onChange={(e) =>
                setStatus.mutate({
                  matterId: matter.id,
                  status: MatterStatusSchema.parse(e.target.value),
                })
              }
              className="border rounded px-2 py-1"
            >
              {MatterStatusSchema.options.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            {matter.priority && (
              <span className="px-2 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-xs">{matter.priority}</span>
            )}
            {matter.practiceArea && (
              <span className="px-2 py-0.5 rounded bg-ink-100 dark:bg-ink-800 text-xs capitalize">
                {matter.practiceArea}
              </span>
            )}
            <SaveToNotionButton matterId={matter.id} />
            <SaveToDriveButton matterId={matter.id} />
            <Link
              href={`/matters/${matter.id}/draft`}
              className="text-xs border rounded px-2 py-1 hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Open draft →
            </Link>
          </div>
        </div>
        <button
          onClick={() => setChatOpen((o) => !o)}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800 shrink-0"
        >
          {chatOpen ? 'Hide copilot' : 'Open copilot'}
        </button>
      </header>

      <div className={chatOpen ? 'grid grid-cols-12 gap-6' : 'grid grid-cols-3 gap-6'}>
        <section className={chatOpen ? 'col-span-6 space-y-6' : 'col-span-2 space-y-6'}>
          <div className="bg-white dark:bg-ink-900 border rounded-lg p-4">
            <h2 className="font-medium mb-2">Original Request</h2>
            <p className="text-sm whitespace-pre-wrap text-ink-800 dark:text-ink-200">{matter.requestText}</p>
          </div>

          {matter.summary && (
            <div className="bg-white dark:bg-ink-900 border rounded-lg p-4">
              <h2 className="font-medium mb-2">AI Summary</h2>
              <p className="text-sm text-ink-800 dark:text-ink-200">{matter.summary}</p>
            </div>
          )}

          {Boolean((matter.triageMetadata as Record<string, unknown> | null)?.reasoning) && (
            <div className="bg-white dark:bg-ink-900 border rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-medium">AI Reasoning</h2>
                <TriageConfidence metadata={matter.triageMetadata as Record<string, unknown>} />
              </div>
              <p className="text-sm text-ink-600 dark:text-ink-400 italic">
                {String((matter.triageMetadata as Record<string, unknown>).reasoning)}
              </p>
            </div>
          )}

          <div className="bg-white dark:bg-ink-900 border rounded-lg p-4">
            <h2 className="font-medium mb-2">Notes</h2>
            <div className="space-y-2 mb-3">
              {matter.notes.length === 0 && (
                <div className="text-sm text-ink-500 dark:text-ink-400">No notes yet.</div>
              )}
              {matter.notes.map((n) => (
                <div key={n.id} className="border-l-2 border-brand-500 pl-3 py-1 text-sm">
                  <div className="text-xs text-ink-500 dark:text-ink-400">
                    {new Date(n.createdAt).toLocaleString()} · {n.source}
                  </div>
                  <div className="whitespace-pre-wrap">{n.body}</div>
                </div>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!note.trim()) return;
                addNote.mutate(
                  { matterId: matter.id, body: note },
                  { onSuccess: () => setNote('') },
                );
              }}
              className="flex gap-2"
            >
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note…"
                className="flex-1 border rounded px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={addNote.isPending}
                className="bg-brand-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
              >
                Add
              </button>
            </form>
          </div>
        </section>

        <aside className={chatOpen ? 'col-span-3 space-y-4' : 'space-y-4'}>
          <EscalationsCard matterId={matter.id} />

          <PlaybooksCard matterId={matter.id} />

          <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
            <h2 className="font-medium mb-2">Metadata</h2>
            <dl className="space-y-1">
              <div className="flex justify-between">
                <dt className="text-ink-500 dark:text-ink-400">Requester</dt>
                <dd>{matter.requester?.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500 dark:text-ink-400">Assignee</dt>
                <dd>{matter.assignee?.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500 dark:text-ink-400">Counterparty</dt>
                <dd>{matter.counterparty?.name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500 dark:text-ink-400">SLA Due</dt>
                <dd>{matter.slaDueAt ? new Date(matter.slaDueAt).toLocaleString() : '—'}</dd>
              </div>
            </dl>
          </div>

          {(() => {
            const sf = (matter.context as Record<string, unknown> | null)?.salesforce as
              | SalesforceContext
              | undefined;
            return sf ? <SalesforceContextCard ctx={sf} /> : null;
          })()}

          {counterparty &&
            (() => {
              const profile = (counterparty.behavioralProfile ?? {}) as CounterpartyMemoryProfile;
              if (!profile.summary && (!profile.totalMatters || profile.totalMatters < 2)) {
                return null;
              }
              return (
                <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="font-medium">Counterparty Memory</h2>
                    <span className="text-xs text-ink-400 dark:text-ink-500">{counterparty.name}</span>
                  </div>
                  {profile.summary && (
                    <p className="text-ink-700 dark:text-ink-300 text-xs mb-3">{profile.summary}</p>
                  )}
                  {profile.commonRedlines && profile.commonRedlines.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-1">
                        Negotiation patterns
                      </div>
                      <ul className="text-xs text-ink-700 dark:text-ink-300 space-y-0.5 list-disc list-inside">
                        {profile.commonRedlines.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {profile.escalationTriggers && profile.escalationTriggers.length > 0 && (
                    <div className="mb-2">
                      <div className="text-xs font-medium text-red-600 mb-1">
                        Escalation history
                      </div>
                      <ul className="text-xs text-ink-700 dark:text-ink-300 space-y-0.5 list-disc list-inside">
                        {profile.escalationTriggers.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {profile.practiceAreas && profile.practiceAreas.length > 0 && (
                    <div className="flex gap-1 flex-wrap mt-2 pt-2 border-t border-ink-100 dark:border-ink-800">
                      {profile.practiceAreas.map((p) => (
                        <span
                          key={p.area}
                          className="text-xs bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded capitalize"
                        >
                          {p.area} ({p.count})
                        </span>
                      ))}
                    </div>
                  )}
                  {profile.avgCycleTimeDays != null && (
                    <div className="text-xs text-ink-500 dark:text-ink-400 mt-2">
                      Avg resolution: {profile.avgCycleTimeDays.toFixed(1)} days
                    </div>
                  )}
                </div>
              );
            })()}

          {matter.attachments.length > 0 && (
            <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
              <h2 className="font-medium mb-2">Attachments</h2>
              <ul className="space-y-1">
                {matter.attachments.map((a) => (
                  <li key={a.id}>{a.filename}</li>
                ))}
              </ul>
            </div>
          )}

          {similarMatters.length > 0 && (
            <div className="bg-white dark:bg-ink-900 border rounded-lg p-4 text-sm">
              <h2 className="font-medium mb-3">Similar Past Matters</h2>
              <ul className="space-y-3">
                {similarMatters.map((sm) => (
                  <li key={sm.id} className="border-t border-ink-100 dark:border-ink-800 pt-2 first:border-t-0 first:pt-0">
                    <a
                      href={`/matters/${sm.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {sm.title}
                    </a>
                    <div className="flex items-center gap-2 mt-0.5">
                      {sm.practice_area && (
                        <span className="text-xs bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded capitalize">
                          {sm.practice_area}
                        </span>
                      )}
                      {sm.priority && (
                        <span className="text-xs bg-ink-100 dark:bg-ink-800 px-1.5 py-0.5 rounded">
                          {sm.priority}
                        </span>
                      )}
                      <span className="text-xs text-ink-400 dark:text-ink-500">
                        {Math.round(Number(sm.similarity) * 100)}% match
                      </span>
                    </div>
                    {sm.summary && (
                      <p className="text-xs text-ink-500 dark:text-ink-400 mt-1 line-clamp-2">{sm.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>

        {chatOpen && (
          <aside className="col-span-3">
            <ChatPanel matterId={matter.id} />
          </aside>
        )}
      </div>
    </div>
  );
}

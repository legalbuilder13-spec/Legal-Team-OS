'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema, type PracticeArea } from '@legal/types';
import { formatPracticeArea } from '@/lib/format';

// PR #6 — Clause library admin page. Two tabs:
// 1. Library  — approved clauses, edit / archive / mark canonical
// 2. Pending  — extraction queue: AI-proposed clauses from existing
//               templates awaiting lawyer review (accept / dismiss /
//               edit-then-accept)
//
// Top of page also has the bulk "Run extraction on all templates"
// button so the admin can backfill the queue on first run.

const PRACTICE_AREAS = PracticeAreaSchema.options;
type Tab = 'library' | 'pending';

export default function ClausesAdminPage() {
  const [tab, setTab] = useState<Tab>('library');

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Clauses</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 max-w-2xl">
          Reusable clause library. Templates compose from clauses instead
          of carrying monolithic text — update one canonical clause and
          every template that uses it picks up the change. Pending tab
          shows AI-proposed clauses from existing templates awaiting
          your review.
        </p>
      </header>

      <div className="flex items-center gap-1 border-b border-ink-200 dark:border-ink-800 mb-4">
        {(['library', 'pending'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`text-sm px-3 py-2 border-b-2 -mb-px ${
              tab === t
                ? 'border-brand-500 text-brand-700 dark:text-brand-400 font-medium'
                : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200'
            }`}
          >
            {t === 'library' ? 'Library' : 'Pending review'}
          </button>
        ))}
      </div>

      {tab === 'library' ? <LibraryTab /> : <PendingTab />}
    </div>
  );
}

function LibraryTab() {
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.clauses.list.useQuery({});
  const upsert = trpc.clauses.upsert.useMutation({
    onSuccess: () => {
      utils.clauses.list.invalidate();
      setEditing(null);
    },
  });
  const archive = trpc.clauses.archive.useMutation({
    onSuccess: () => utils.clauses.list.invalidate(),
  });

  const [editing, setEditing] = useState<{
    id?: string;
    practiceArea: PracticeArea;
    name: string;
    body: string;
    jurisdictions: string;
    isCanonical: boolean;
    status: 'draft' | 'approved' | 'archived';
  } | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {isLoading
            ? 'Loading…'
            : `${items.length} clause${items.length === 1 ? '' : 's'} in the library`}
        </span>
        <button
          type="button"
          onClick={() =>
            setEditing({
              practiceArea: 'commercial',
              name: '',
              body: '',
              jurisdictions: '',
              isCanonical: false,
              status: 'draft',
            })
          }
          className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          + New clause
        </button>
      </div>

      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            upsert.mutate({
              id: editing.id,
              practiceArea: editing.practiceArea,
              name: editing.name,
              body: editing.body,
              jurisdictions: editing.jurisdictions
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
              isCanonical: editing.isCanonical,
              status: editing.status,
            });
          }}
          className="border rounded-lg p-4 bg-white dark:bg-ink-900 space-y-3"
        >
          <div className="grid grid-cols-3 gap-3">
            <label className="text-xs">
              <div className="text-ink-500 dark:text-ink-400 mb-1">Practice area</div>
              <select
                value={editing.practiceArea}
                onChange={(e) =>
                  setEditing({ ...editing, practiceArea: e.target.value as PracticeArea })
                }
                className="w-full border rounded px-2 py-1"
              >
                {PRACTICE_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {formatPracticeArea(a)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <div className="text-ink-500 dark:text-ink-400 mb-1">Status</div>
              <select
                value={editing.status}
                onChange={(e) =>
                  setEditing({ ...editing, status: e.target.value as 'draft' | 'approved' | 'archived' })
                }
                className="w-full border rounded px-2 py-1"
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
                <option value="archived">Archived</option>
              </select>
            </label>
            <label className="text-xs flex items-center gap-2 mt-5">
              <input
                type="checkbox"
                checked={editing.isCanonical}
                onChange={(e) => setEditing({ ...editing, isCanonical: e.target.checked })}
              />
              Canonical (firm standard)
            </label>
          </div>
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">Name</div>
            <input
              type="text"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              required
              minLength={3}
              className="w-full border rounded px-2 py-1"
            />
          </label>
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">
              Body (verbatim clause text)
            </div>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              required
              minLength={50}
              rows={8}
              className="w-full border rounded px-2 py-1 font-mono text-[12px]"
            />
          </label>
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">
              Jurisdictions (comma-separated, e.g. "US, CA, NY"; blank = universal)
            </div>
            <input
              type="text"
              value={editing.jurisdictions}
              onChange={(e) =>
                setEditing({ ...editing, jurisdictions: e.target.value })
              }
              className="w-full border rounded px-2 py-1"
            />
          </label>
          {upsert.error && (
            <div className="text-xs text-red-600 dark:text-red-400">{upsert.error.message}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={upsert.isPending}
              className="text-sm px-3 py-1.5 border rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      <ul className="space-y-2">
        {items.map((c) => (
          <li
            key={c.id}
            className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{c.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-ink-100 dark:bg-ink-800">
                    {formatPracticeArea(c.practiceArea)}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      c.status === 'approved'
                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : c.status === 'archived'
                          ? 'bg-ink-50 text-ink-400'
                          : 'bg-ink-100 text-ink-600'
                    }`}
                  >
                    {c.status}
                  </span>
                  {c.isCanonical && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300">
                      canonical
                    </span>
                  )}
                  {(c.jurisdictions ?? []).map((j) => (
                    <span
                      key={j}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                    >
                      {j}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-ink-500 dark:text-ink-400 mt-1 line-clamp-2 font-mono">
                  {c.body}
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setEditing({
                      id: c.id,
                      practiceArea: c.practiceArea,
                      name: c.name,
                      body: c.body,
                      jurisdictions: (c.jurisdictions ?? []).join(', '),
                      isCanonical: c.isCanonical,
                      status: c.status,
                    })
                  }
                  className="text-xs text-brand-600 hover:underline"
                >
                  Edit
                </button>
                {c.status !== 'archived' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Archive "${c.name}"?`)) archive.mutate({ id: c.id });
                    }}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Archive
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PendingTab() {
  const utils = trpc.useUtils();
  const { data: extractions = [], isLoading } = trpc.clauses.listExtractions.useQuery({
    status: 'pending',
  });
  const accept = trpc.clauses.acceptExtraction.useMutation({
    onSuccess: () => utils.clauses.listExtractions.invalidate(),
  });
  const dismiss = trpc.clauses.dismissExtraction.useMutation({
    onSuccess: () => utils.clauses.listExtractions.invalidate(),
  });
  const enqueueAll = trpc.clauses.enqueueExtraction.useMutation({
    onSuccess: () => utils.clauses.listExtractions.invalidate(),
  });

  // Group by source template for readability.
  const byTemplate = new Map<
    string,
    {
      templateName: string | null;
      templatePracticeArea: string | null;
      items: typeof extractions;
    }
  >();
  for (const e of extractions) {
    const existing = byTemplate.get(e.sourceTemplateId);
    if (existing) {
      existing.items.push(e);
    } else {
      byTemplate.set(e.sourceTemplateId, {
        templateName: e.templateName,
        templatePracticeArea: e.templatePracticeArea,
        items: [e],
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {isLoading
            ? 'Loading…'
            : `${extractions.length} pending proposal${extractions.length === 1 ? '' : 's'} across ${byTemplate.size} template${byTemplate.size === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          onClick={() => {
            if (
              confirm(
                'Run AI extraction on all active templates that don\'t already have pending proposals? This calls the AI service for each template.',
              )
            )
              enqueueAll.mutate({});
          }}
          disabled={enqueueAll.isPending}
          className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
        >
          {enqueueAll.isPending ? 'Enqueuing…' : 'Run extraction on all templates'}
        </button>
      </div>
      {enqueueAll.data && (
        <div className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded px-3 py-2">
          Enqueued {enqueueAll.data.enqueued} extraction job
          {enqueueAll.data.enqueued === 1 ? '' : 's'}. Refresh in ~30 seconds to
          see proposals appear.
        </div>
      )}
      {extractions.length === 0 && !isLoading && (
        <div className="text-center text-sm text-ink-500 dark:text-ink-400 py-8 border rounded-lg">
          No pending proposals. Click "Run extraction on all templates" to
          generate some.
        </div>
      )}

      {Array.from(byTemplate.entries()).map(([templateId, group]) => (
        <section
          key={templateId}
          className="border rounded-lg bg-white dark:bg-ink-900 p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-medium text-sm">{group.templateName ?? '(deleted template)'}</div>
              <div className="text-[11px] text-ink-500 dark:text-ink-400">
                {group.templatePracticeArea && formatPracticeArea(group.templatePracticeArea as PracticeArea)} ·{' '}
                {group.items.length} proposal{group.items.length === 1 ? '' : 's'}
              </div>
            </div>
          </div>
          <ul className="space-y-2">
            {group.items.map((e) => (
              <ExtractionRow
                key={e.id}
                e={e}
                onAccept={(payload) =>
                  accept.mutate({ extractionId: e.id, ...payload })
                }
                onDismiss={(reason) =>
                  dismiss.mutate({ extractionId: e.id, reason })
                }
                accepting={accept.isPending}
                dismissing={dismiss.isPending}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface ExtractionRowProps {
  e: {
    id: string;
    proposedName: string;
    proposedBody: string;
    proposedJurisdictions: string[];
    rationale: string | null;
  };
  onAccept: (payload: {
    nameOverride?: string;
    bodyOverride?: string;
    jurisdictionsOverride?: string[];
    markCanonical?: boolean;
  }) => void;
  onDismiss: (reason?: string) => void;
  accepting: boolean;
  dismissing: boolean;
}

function ExtractionRow({ e, onAccept, onDismiss, accepting, dismissing }: ExtractionRowProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(e.proposedName);
  const [body, setBody] = useState(e.proposedBody);
  const [jurisdictions, setJurisdictions] = useState((e.proposedJurisdictions ?? []).join(', '));
  const [canonical, setCanonical] = useState(false);

  return (
    <li className="border rounded p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{e.proposedName}</div>
          <div className="text-xs text-ink-500 dark:text-ink-400 mt-0.5 italic">
            {e.rationale}
          </div>
          {(e.proposedJurisdictions ?? []).length > 0 && (
            <div className="flex gap-1 mt-1">
              {e.proposedJurisdictions.map((j) => (
                <span
                  key={j}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
                >
                  {j}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="text-xs text-ink-500 dark:text-ink-400 hover:underline"
          >
            {open ? 'Hide' : 'Review'}
          </button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 pt-1 border-t border-ink-100 dark:border-ink-800">
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">Name (editable)</div>
            <input
              type="text"
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              className="w-full border rounded px-2 py-1"
            />
          </label>
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">
              Body (editable, verbatim from template)
            </div>
            <textarea
              value={body}
              onChange={(ev) => setBody(ev.target.value)}
              rows={6}
              className="w-full border rounded px-2 py-1 font-mono text-[11px]"
            />
          </label>
          <label className="text-xs block">
            <div className="text-ink-500 dark:text-ink-400 mb-1">Jurisdictions</div>
            <input
              type="text"
              value={jurisdictions}
              onChange={(ev) => setJurisdictions(ev.target.value)}
              className="w-full border rounded px-2 py-1"
            />
          </label>
          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={canonical}
              onChange={(ev) => setCanonical(ev.target.checked)}
            />
            Mark as canonical (firm standard)
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                const reason = prompt('Why dismiss this proposal? (optional)') ?? undefined;
                onDismiss(reason || undefined);
              }}
              disabled={dismissing}
              className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() =>
                onAccept({
                  nameOverride: name !== e.proposedName ? name : undefined,
                  bodyOverride: body !== e.proposedBody ? body : undefined,
                  jurisdictionsOverride: jurisdictions
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  markCanonical: canonical,
                })
              }
              disabled={accepting}
              className="text-xs px-2 py-1 border rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {accepting ? 'Accepting…' : 'Accept as clause'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

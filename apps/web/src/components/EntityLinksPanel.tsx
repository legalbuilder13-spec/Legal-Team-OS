'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

// Reusable cross-references panel — drops into any admin or matter
// surface to show "what does this point to" + "what points to this",
// plus a picker to add new links. Backed by `entityLinks` router.
//
// The panel is intentionally compact (collapsed by default in callers)
// — it's secondary information that should never crowd the primary
// editor.

const ENTITY_LABELS: Record<EntityKind, string> = {
  playbook: 'Playbook',
  knowledge_article: 'Knowledge',
  rule: 'Rule',
  template: 'Template',
  execution_pattern: 'Pattern',
  matter: 'Matter',
};

const ENTITY_TONE: Record<EntityKind, string> = {
  playbook: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300',
  knowledge_article: 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  rule: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  template: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  execution_pattern: 'bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  matter: 'bg-ink-100 text-ink-700 dark:bg-ink-800 dark:text-ink-300',
};

const RELATIONSHIPS = [
  'codifies',
  'implements',
  'triggers',
  'cites',
  'supersedes',
  'derived_from',
  'related_to',
] as const;

type EntityKind =
  | 'playbook'
  | 'knowledge_article'
  | 'rule'
  | 'template'
  | 'execution_pattern'
  | 'matter';

type Relationship = (typeof RELATIONSHIPS)[number];

interface Props {
  entityType: EntityKind;
  entityId: string;
  /** Title shown in the panel header, e.g. the playbook's title. */
  entityTitle?: string;
  /** Optional: limit picker to a subset of types. */
  pickerKinds?: EntityKind[];
  /** Whether the panel is open by default. Defaults to false. */
  defaultOpen?: boolean;
}

export function EntityLinksPanel({
  entityType,
  entityId,
  entityTitle,
  pickerKinds,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const [adding, setAdding] = useState(false);

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.entityLinks.list.useQuery(
    { entityType, entityId },
    { enabled: open },
  );
  const remove = trpc.entityLinks.delete.useMutation({
    onSuccess: () => utils.entityLinks.list.invalidate({ entityType, entityId }),
  });

  const total = (data?.outgoing.length ?? 0) + (data?.incoming.length ?? 0);

  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2 text-left bg-ink-50 dark:bg-ink-900 hover:bg-ink-100 dark:hover:bg-ink-800"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Linked items</span>
          {data && (
            <span className="text-xs text-ink-500 dark:text-ink-400">
              {total === 0 ? 'none' : `${total} link${total === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
        <span className="text-xs text-ink-500 dark:text-ink-400">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="p-4 space-y-3 bg-white dark:bg-ink-900">
          {entityTitle && (
            <div className="text-xs text-ink-500 dark:text-ink-400">
              Links to and from{' '}
              <span className="font-medium text-ink-700 dark:text-ink-200">
                {entityTitle}
              </span>
              .
            </div>
          )}
          {isLoading && (
            <div className="text-xs text-ink-500 dark:text-ink-400">Loading…</div>
          )}
          {data && total === 0 && (
            <div className="text-xs text-ink-500 dark:text-ink-400 italic">
              No links yet. Use "Add link" below to point this to a related
              playbook, knowledge article, rule, template, or pattern.
            </div>
          )}
          {data && data.outgoing.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-1">
                Points to
              </div>
              <ul className="space-y-1">
                {data.outgoing.map((link) => (
                  <LinkRow
                    key={link.id}
                    direction="outgoing"
                    link={link}
                    onDelete={() => remove.mutate({ id: link.id })}
                    deleting={remove.isPending}
                  />
                ))}
              </ul>
            </div>
          )}
          {data && data.incoming.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-400 dark:text-ink-500 mb-1">
                Pointed to by
              </div>
              <ul className="space-y-1">
                {data.incoming.map((link) => (
                  <LinkRow
                    key={link.id}
                    direction="incoming"
                    link={link}
                    onDelete={() => remove.mutate({ id: link.id })}
                    deleting={remove.isPending}
                  />
                ))}
              </ul>
            </div>
          )}
          {!adding ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="text-xs px-2 py-1 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
            >
              + Add link
            </button>
          ) : (
            <AddLinkForm
              entityType={entityType}
              entityId={entityId}
              pickerKinds={pickerKinds}
              onClose={() => setAdding(false)}
              onSaved={() => {
                setAdding(false);
                void utils.entityLinks.list.invalidate({ entityType, entityId });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface LinkRowProps {
  direction: 'outgoing' | 'incoming';
  link: {
    id: string;
    relationship: Relationship;
    note: string | null;
    createdByName: string | null;
    other: {
      type: EntityKind;
      id: string;
      title: string;
      subtitle: string | null;
    } | null;
  };
  onDelete: () => void;
  deleting: boolean;
}

function LinkRow({ direction, link, onDelete, deleting }: LinkRowProps) {
  const verb =
    direction === 'outgoing'
      ? link.relationship.replaceAll('_', ' ')
      : `${link.relationship.replaceAll('_', ' ')} by`;
  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="text-ink-400 dark:text-ink-500 mt-0.5 shrink-0">
        {verb} →
      </span>
      {link.other ? (
        <span className="flex-1 min-w-0">
          <span
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide mr-1 ${
              ENTITY_TONE[link.other.type]
            }`}
          >
            {ENTITY_LABELS[link.other.type]}
          </span>
          <span className="font-medium">{link.other.title}</span>
          {link.other.subtitle && (
            <span className="text-ink-400 dark:text-ink-500"> · {link.other.subtitle}</span>
          )}
          {link.note && (
            <div className="text-ink-500 dark:text-ink-400 italic mt-0.5 line-clamp-1">
              "{link.note}"
            </div>
          )}
        </span>
      ) : (
        <span className="italic text-ink-400 dark:text-ink-500 flex-1">
          (missing target)
        </span>
      )}
      <button
        type="button"
        onClick={onDelete}
        disabled={deleting}
        className="text-ink-400 dark:text-ink-500 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-50 shrink-0"
        title="Remove link"
      >
        ✕
      </button>
    </li>
  );
}

interface AddLinkFormProps {
  entityType: EntityKind;
  entityId: string;
  pickerKinds?: EntityKind[];
  onClose: () => void;
  onSaved: () => void;
}

function AddLinkForm({
  entityType,
  entityId,
  pickerKinds,
  onClose,
  onSaved,
}: AddLinkFormProps) {
  const [query, setQuery] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('related_to');
  const [note, setNote] = useState('');
  const [selected, setSelected] = useState<{
    type: EntityKind;
    id: string;
    title: string;
  } | null>(null);

  const trimmed = query.trim();
  const enabled = trimmed.length >= 2 && !selected;
  const { data: results } = trpc.entityLinks.search.useQuery(
    { query: trimmed, kinds: pickerKinds, limit: 12 },
    { enabled },
  );

  const create = trpc.entityLinks.create.useMutation({ onSuccess: onSaved });

  const filtered = useMemo(
    () =>
      (results ?? []).filter(
        (r) => !(r.type === entityType && r.id === entityId),
      ),
    [results, entityType, entityId],
  );

  return (
    <div className="border rounded p-2 space-y-2 bg-ink-50 dark:bg-ink-900/40">
      <div className="text-[11px] text-ink-600 dark:text-ink-400">
        Search a playbook, knowledge article, rule, template, pattern, or
        matter to link.
      </div>
      {selected ? (
        <div className="flex items-center justify-between gap-2 text-xs">
          <span>
            <span
              className={`inline-block px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide mr-1 ${
                ENTITY_TONE[selected.type]
              }`}
            >
              {ENTITY_LABELS[selected.type]}
            </span>
            <span className="font-medium">{selected.title}</span>
          </span>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="text-ink-400 dark:text-ink-500 hover:underline"
          >
            change
          </button>
        </div>
      ) : (
        <>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name…"
            className="w-full border rounded px-2 py-1 text-xs"
            autoFocus
          />
          {enabled && filtered.length === 0 && results && (
            <div className="text-[11px] text-ink-400 dark:text-ink-500 italic">
              No matches.
            </div>
          )}
          {filtered.length > 0 && (
            <ul className="max-h-40 overflow-y-auto border rounded bg-white dark:bg-ink-900">
              {filtered.map((r) => (
                <li key={`${r.type}:${r.id}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({ type: r.type, id: r.id, title: r.title })
                    }
                    className="w-full text-left text-xs px-2 py-1 hover:bg-ink-50 dark:hover:bg-ink-800 flex items-center gap-2"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wide ${
                        ENTITY_TONE[r.type]
                      }`}
                    >
                      {ENTITY_LABELS[r.type]}
                    </span>
                    <span className="font-medium">{r.title}</span>
                    {r.subtitle && (
                      <span className="text-ink-400 dark:text-ink-500">
                        · {r.subtitle}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <div className="flex items-center gap-2 text-xs">
        <label className="text-ink-600 dark:text-ink-400">Relationship:</label>
        <select
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as Relationship)}
          className="border rounded px-2 py-1 text-xs"
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r} value={r}>
              {r.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (why are these linked?)"
        className="w-full border rounded px-2 py-1 text-xs"
        maxLength={500}
      />
      {create.error && (
        <div className="text-[11px] text-red-700 dark:text-red-300">
          {create.error.message}
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] px-2 py-1 border rounded hover:bg-white dark:hover:bg-ink-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!selected || create.isPending}
          onClick={() => {
            if (!selected) return;
            create.mutate({
              sourceType: entityType,
              sourceId: entityId,
              targetType: selected.type,
              targetId: selected.id,
              relationship,
              note: note.trim() || undefined,
            });
          }}
          className="text-[11px] px-2 py-1 border rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {create.isPending ? 'Linking…' : 'Save link'}
        </button>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { EntityLinksPanel } from '@/components/EntityLinksPanel';

const KINDS = [
  { value: 'sla' as const, label: 'SLA targets' },
  { value: 'routing' as const, label: 'Routing rules' },
  { value: 'triage' as const, label: 'Triage rules' },
  { value: 'playbook_trigger' as const, label: 'Playbook triggers' },
];

const STATUS_TONE: Record<string, string> = {
  draft: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  shadow: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  archived: 'bg-ink-50 text-ink-400 dark:bg-ink-900 dark:text-ink-600',
};

type Form = {
  id?: string;
  kind: (typeof KINDS)[number]['value'];
  name: string;
  naturalText: string;
  priority: number;
};

const emptyForm = (kind: Form['kind']): Form => ({
  kind,
  name: '',
  naturalText: '',
  priority: 100,
});

export default function RulesAdminPage() {
  const utils = trpc.useUtils();
  const [activeKind, setActiveKind] = useState<Form['kind']>('sla');
  const { data: rules = [], isLoading } = trpc.rules.list.useQuery({ kind: activeKind });
  const create = trpc.rules.create.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ kind: activeKind });
      setEditing(null);
    },
  });
  const update = trpc.rules.update.useMutation({
    onSuccess: () => {
      utils.rules.list.invalidate({ kind: activeKind });
      setEditing(null);
    },
  });
  const compile = trpc.rules.compile.useMutation({
    onSuccess: () => utils.rules.list.invalidate({ kind: activeKind }),
  });
  const activate = trpc.rules.activate.useMutation({
    onSuccess: () => utils.rules.list.invalidate({ kind: activeKind }),
  });
  const archive = trpc.rules.archive.useMutation({
    onSuccess: () => utils.rules.list.invalidate({ kind: activeKind }),
  });
  const [editing, setEditing] = useState<Form | null>(null);
  const [showCompiledFor, setShowCompiledFor] = useState<string | null>(null);
  const [linksFor, setLinksFor] = useState<string | null>(null);

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Rules</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 max-w-2xl">
          Natural-language rules for SLA targets, routing, triage, and
          playbook triggers. Type the rule in plain English; the compiler
          produces a structured form an evaluator can run.
        </p>
      </header>

      <div className="flex items-center gap-1 border-b border-ink-200 dark:border-ink-800 mb-4">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => {
              setActiveKind(k.value);
              setEditing(null);
            }}
            className={`text-sm px-3 py-2 border-b-2 -mb-px ${
              activeKind === k.value
                ? 'border-brand-500 text-brand-700 dark:text-brand-400 font-medium'
                : 'border-transparent text-ink-500 dark:text-ink-400 hover:text-ink-700 dark:hover:text-ink-200'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      {editing && editing.kind === activeKind && (
        <RuleEditor
          form={editing}
          onChange={setEditing}
          onSave={() => {
            if (editing.id) {
              update.mutate({
                id: editing.id,
                name: editing.name,
                naturalText: editing.naturalText,
                priority: editing.priority,
              });
            } else {
              create.mutate({
                kind: editing.kind,
                name: editing.name,
                naturalText: editing.naturalText,
                priority: editing.priority,
              });
            }
          }}
          onCancel={() => setEditing(null)}
          saving={create.isPending || update.isPending}
          error={create.error?.message ?? update.error?.message}
        />
      )}

      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(emptyForm(activeKind))}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800 mb-4"
        >
          + New rule
        </button>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No {KINDS.find((k) => k.value === activeKind)?.label.toLowerCase()} yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li
              key={r.id}
              className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{r.name}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${STATUS_TONE[r.status]}`}
                    >
                      {r.status}
                    </span>
                    <span className="text-[10px] text-ink-400 dark:text-ink-500 font-mono">
                      p={r.priority}
                    </span>
                    {r.compileError && (
                      <span className="text-[10px] text-red-600 dark:text-red-400">
                        compile error
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-ink-700 dark:text-ink-300 italic mt-1">
                    {r.naturalText}
                  </div>
                  {showCompiledFor === r.id && r.compiled && (
                    <pre className="mt-2 text-[11px] bg-ink-50 dark:bg-ink-950 rounded p-2 overflow-auto">
                      {JSON.stringify(r.compiled, null, 2)}
                    </pre>
                  )}
                  {r.compileError && showCompiledFor === r.id && (
                    <pre className="mt-2 text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 rounded p-2">
                      {r.compileError}
                    </pre>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() =>
                      setShowCompiledFor(showCompiledFor === r.id ? null : r.id)
                    }
                    className="text-xs text-ink-500 dark:text-ink-400 hover:underline"
                  >
                    {showCompiledFor === r.id ? 'Hide' : 'DSL'}
                  </button>
                  <button
                    type="button"
                    onClick={() => compile.mutate({ id: r.id })}
                    disabled={compile.isPending}
                    className="text-xs text-brand-600 hover:underline disabled:opacity-50"
                  >
                    Compile
                  </button>
                  {r.status === 'draft' && r.compiledAt && !r.compileError && (
                    <button
                      type="button"
                      onClick={() => activate.mutate({ id: r.id })}
                      disabled={activate.isPending}
                      className="text-xs text-emerald-600 hover:underline disabled:opacity-50"
                    >
                      Activate
                    </button>
                  )}
                  {r.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => archive.mutate({ id: r.id })}
                      className="text-xs text-ink-500 dark:text-ink-400 hover:underline"
                    >
                      Archive
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setLinksFor(linksFor === r.id ? null : r.id)}
                    className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                  >
                    {linksFor === r.id ? 'Hide links' : 'Links'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: r.id,
                        kind: r.kind,
                        name: r.name,
                        naturalText: r.naturalText,
                        priority: r.priority,
                      })
                    }
                    className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                  >
                    Edit
                  </button>
                </div>
              </div>
              {linksFor === r.id && (
                <div className="mt-2">
                  <EntityLinksPanel
                    entityType="rule"
                    entityId={r.id}
                    entityTitle={r.name}
                    defaultOpen
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleEditor({
  form,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  form: Form;
  onChange: (f: Form) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-3 rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4 mb-4"
    >
      <label className="text-xs block">
        <div className="text-ink-500 dark:text-ink-400 mb-1">Name</div>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          required
          placeholder="e.g. High priority gets 4-hour SLA"
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
        />
      </label>
      <label className="text-xs block">
        <div className="text-ink-500 dark:text-ink-400 mb-1">
          Rule (English)
        </div>
        <textarea
          value={form.naturalText}
          onChange={(e) => onChange({ ...form, naturalText: e.target.value })}
          required
          placeholder={
            form.kind === 'sla'
              ? "e.g. 'High priority matters resolve in 4 hours' or 'Any privacy matter from EU customers gets 4 hours'"
              : form.kind === 'routing'
                ? "e.g. 'All contracts over \$1M route to Sarah Chen'"
                : form.kind === 'triage'
                  ? "e.g. 'Any subpoena or threatened lawsuit is litigation, regardless of subject'"
                  : "e.g. 'Liability cap clauses below 1x ACV should be FLAGGED'"
          }
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1.5 bg-transparent min-h-[80px] font-sans text-xs"
        />
      </label>
      <div className="flex items-center gap-3">
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Priority</div>
          <input
            type="number"
            value={form.priority}
            onChange={(e) =>
              onChange({ ...form, priority: parseInt(e.target.value, 10) || 100 })
            }
            className="w-24 border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          />
          <div className="text-[10px] text-ink-400 dark:text-ink-500 mt-0.5">
            lower = checked first
          </div>
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink-100 dark:border-ink-800">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs border border-ink-200 dark:border-ink-700 rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="text-xs bg-brand-600 hover:bg-brand-700 text-white rounded px-3 py-1.5 disabled:opacity-50"
        >
          {saving ? 'Saving…' : form.id ? 'Save' : 'Create draft'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-[11px] text-ink-500 dark:text-ink-400 pt-1">
        After saving, click <strong>Compile</strong> to translate the
        English into structured form. If the compile output looks right,
        click <strong>Activate</strong> to make the rule live. Editing
        the English re-sets the rule to draft.
      </p>
    </form>
  );
}

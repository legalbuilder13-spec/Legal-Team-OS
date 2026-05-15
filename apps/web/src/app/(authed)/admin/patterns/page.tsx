'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema, type PracticeArea } from '@legal/types';
import { formatPracticeArea } from '@/lib/format';
import { EntityLinksPanel } from '@/components/EntityLinksPanel';

const PRACTICE_AREAS = PracticeAreaSchema.options;

const INPUT_TYPES = ['document', 'fact_pattern', 'checklist', 'content'] as const;
const OUTPUT_FORMATS = [
  'tagged_clauses',
  'issue_memo',
  'claim_matrix',
  'gap_report',
  'risk_assessment',
  'rewrite_pairs',
  'action_checklist',
] as const;

// Output formats with engines implemented today (others are config-only;
// the surfaced workflow falls back to tagged_clauses or no-op).
const IMPLEMENTED_FORMATS = new Set(['tagged_clauses']);

type PatternForm = {
  id?: string;
  practiceArea: PracticeArea;
  matterType: string;
  inputType: (typeof INPUT_TYPES)[number];
  outputFormat: (typeof OUTPUT_FORMATS)[number];
  name: string;
  description: string;
  promptTemplate: string;
  isDefault: boolean;
  isActive: boolean;
};

const emptyForm = (): PatternForm => ({
  practiceArea: 'commercial',
  matterType: '',
  inputType: 'document',
  outputFormat: 'tagged_clauses',
  name: '',
  description: '',
  promptTemplate: '',
  isDefault: false,
  isActive: true,
});

export default function ExecutionPatternsAdminPage() {
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.admin.listExecutionPatterns.useQuery();
  const upsert = trpc.admin.upsertExecutionPattern.useMutation({
    onSuccess: () => {
      utils.admin.listExecutionPatterns.invalidate();
      setEditing(null);
    },
  });
  const [editing, setEditing] = useState<PatternForm | null>(null);
  const [linksFor, setLinksFor] = useState<string | null>(null);

  return (
    <div className="max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Execution patterns</h1>
        <p className="text-sm text-ink-500 dark:text-ink-400 mt-1 max-w-2xl">
          Per-practice-area configuration of how Stage 4 work execution
          runs. Each practice area has a default pattern mapping input
          type to output format. Only{' '}
          <code className="text-xs">tagged_clauses</code> is fully
          implemented today (via the clause-analysis engine in E3). Other
          output formats are scaffolded — the pattern configuration is
          stored, and the engine for each can be built incrementally.
        </p>
      </header>

      {editing && (
        <PatternEditor
          form={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() =>
            upsert.mutate({
              id: editing.id,
              practiceArea: editing.practiceArea,
              matterType: editing.matterType.trim() || undefined,
              inputType: editing.inputType,
              outputFormat: editing.outputFormat,
              name: editing.name.trim(),
              description: editing.description.trim() || undefined,
              promptTemplate: editing.promptTemplate,
              isDefault: editing.isDefault,
              isActive: editing.isActive,
            })
          }
          saving={upsert.isPending}
          error={upsert.error?.message}
        />
      )}

      {!editing && (
        <button
          type="button"
          onClick={() => setEditing(emptyForm())}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800 mb-4"
        >
          + New pattern
        </button>
      )}

      {isLoading ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No execution patterns yet. The migration seeds one per practice
          area on first deploy; if you see this state, the migration
          hasn't run yet.
        </p>
      ) : (
        <div className="space-y-3">
          {PRACTICE_AREAS.map((area) => {
            const list = items.filter((i) => i.practiceArea === area);
            if (list.length === 0) return null;
            return (
              <section key={area}>
                <h2 className="text-xs uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-1.5 font-medium">
                  {formatPracticeArea(area)}
                </h2>
                <ul className="space-y-1.5">
                  {list.map((p) => (
                    <li
                      key={p.id}
                      className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium text-sm flex items-center gap-2">
                            {p.name}
                            {p.isDefault && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-100 text-brand-800 dark:bg-brand-900/40 dark:text-brand-300">
                                default
                              </span>
                            )}
                            {!IMPLEMENTED_FORMATS.has(p.outputFormat) && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                config-only
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">
                            {p.inputType} → {p.outputFormat}
                            {p.matterType && ` · ${p.matterType}`}
                          </div>
                          {p.description && (
                            <div className="text-xs text-ink-600 dark:text-ink-400 mt-1">
                              {p.description}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setLinksFor(linksFor === p.id ? null : p.id)}
                            className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                          >
                            {linksFor === p.id ? 'Hide links' : 'Links'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                id: p.id,
                                practiceArea: p.practiceArea,
                                matterType: p.matterType ?? '',
                                inputType: p.inputType,
                                outputFormat: p.outputFormat,
                                name: p.name,
                                description: p.description ?? '',
                                promptTemplate: p.promptTemplate,
                                isDefault: p.isDefault,
                                isActive: p.isActive,
                              })
                            }
                            className="text-xs text-brand-600 hover:underline"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                      {linksFor === p.id && (
                        <div className="mt-2">
                          <EntityLinksPanel
                            entityType="execution_pattern"
                            entityId={p.id}
                            entityTitle={p.name}
                            defaultOpen
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PatternEditor({
  form,
  onChange,
  onCancel,
  onSave,
  saving,
  error,
}: {
  form: PatternForm;
  onChange: (f: PatternForm) => void;
  onCancel: () => void;
  onSave: () => void;
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
      <div className="grid grid-cols-4 gap-3">
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Practice area</div>
          <select
            value={form.practiceArea}
            onChange={(e) => onChange({ ...form, practiceArea: e.target.value as PracticeArea })}
            className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          >
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {formatPracticeArea(a)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Input type</div>
          <select
            value={form.inputType}
            onChange={(e) =>
              onChange({ ...form, inputType: e.target.value as PatternForm['inputType'] })
            }
            className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          >
            {INPUT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Output format</div>
          <select
            value={form.outputFormat}
            onChange={(e) =>
              onChange({ ...form, outputFormat: e.target.value as PatternForm['outputFormat'] })
            }
            className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          >
            {OUTPUT_FORMATS.map((f) => (
              <option key={f} value={f}>
                {f}
                {IMPLEMENTED_FORMATS.has(f) ? '' : ' (config-only)'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Matter type (optional)</div>
          <input
            type="text"
            value={form.matterType}
            onChange={(e) => onChange({ ...form, matterType: e.target.value })}
            placeholder="e.g. NDA"
            className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          />
        </label>
      </div>
      <label className="text-xs block">
        <div className="text-ink-500 dark:text-ink-400 mb-1">Name</div>
        <input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          required
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
        />
      </label>
      <label className="text-xs block">
        <div className="text-ink-500 dark:text-ink-400 mb-1">Description</div>
        <input
          type="text"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
        />
      </label>
      <label className="text-xs block">
        <div className="text-ink-500 dark:text-ink-400 mb-1">
          Prompt template (consumed by the per-format engine when it exists)
        </div>
        <textarea
          value={form.promptTemplate}
          onChange={(e) => onChange({ ...form, promptTemplate: e.target.value })}
          required
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1.5 bg-transparent min-h-[140px] font-mono text-xs"
        />
      </label>
      <div className="flex items-center justify-between pt-2 border-t border-ink-100 dark:border-ink-800">
        <div className="flex items-center gap-4">
          <label className="text-xs text-ink-600 dark:text-ink-400 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={form.isDefault}
              onChange={(e) => onChange({ ...form, isDefault: e.target.checked })}
            />
            Default for practice area
          </label>
          <label className="text-xs text-ink-600 dark:text-ink-400 flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
            />
            Active
          </label>
        </div>
        <div className="flex items-center gap-2">
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
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </form>
  );
}

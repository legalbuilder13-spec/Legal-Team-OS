'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema, type PracticeArea } from '@legal/types';
import { EntityLinksPanel } from '@/components/EntityLinksPanel';
import { TaxonomyGuide } from '@/components/TaxonomyGuide';
import { DuplicateCheck } from '@/components/DuplicateCheck';

const PRACTICE_AREAS = PracticeAreaSchema.options;

type Variable = { name: string; description?: string; defaultValue?: string };

type TemplateForm = {
  id?: string;
  practiceArea: PracticeArea;
  matterType: string;
  name: string;
  body: string;
  variables: Variable[];
  isActive: boolean;
};

const emptyForm = (): TemplateForm => ({
  practiceArea: 'commercial',
  matterType: '',
  name: '',
  body: '',
  variables: [],
  isActive: true,
});

export default function TemplatesAdminPage() {
  const utils = trpc.useUtils();
  const { data: items = [], isLoading } = trpc.templates.listAll.useQuery();
  const upsert = trpc.templates.upsert.useMutation({
    onSuccess: () => {
      utils.templates.listAll.invalidate();
      setEditing(null);
    },
  });
  const remove = trpc.templates.delete.useMutation({
    onSuccess: () => utils.templates.listAll.invalidate(),
  });
  const [editing, setEditing] = useState<TemplateForm | null>(null);
  const [linksFor, setLinksFor] = useState<string | null>(null);

  const byArea = PRACTICE_AREAS.map((area) => ({
    area,
    items: items.filter((t) => t.practiceArea === area),
  })).filter((g) => g.items.length > 0 || editing?.practiceArea === g.area);

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Templates</h1>
          <p className="text-sm text-ink-500 dark:text-ink-400 mt-1">
            Pre-authored drafts. Surfaces in the matter drafting workspace,
            filtered by the matter's practice area.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setEditing(emptyForm())}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          + New template
        </button>
      </div>

      {editing && (
        <TemplateEditor
          form={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={() =>
            upsert.mutate({
              id: editing.id,
              practiceArea: editing.practiceArea,
              matterType: editing.matterType.trim() || undefined,
              name: editing.name.trim(),
              body: editing.body,
              variables: editing.variables.filter((v) => v.name.trim()),
              isActive: editing.isActive,
            })
          }
          onDelete={
            editing.id
              ? () => {
                  if (confirm(`Delete "${editing.name}"?`)) {
                    remove.mutate({ id: editing.id! });
                    setEditing(null);
                  }
                }
              : undefined
          }
          saving={upsert.isPending}
          error={upsert.error?.message}
        />
      )}

      {isLoading ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">Loading…</p>
      ) : items.length === 0 && !editing ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No templates yet. Create one above.
        </p>
      ) : (
        <div className="space-y-6 mt-6">
          {byArea.map(({ area, items: list }) => (
            <section key={area}>
              <h2 className="text-xs uppercase tracking-wider text-ink-500 dark:text-ink-400 mb-2 font-medium">
                {area}
              </h2>
              <ul className="space-y-2">
                {list.map((t) => (
                  <li
                    key={t.id}
                    className="rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{t.name}</div>
                        <div className="text-[11px] text-ink-500 dark:text-ink-400 mt-0.5">
                          {t.matterType && <span>{t.matterType} · </span>}
                          {t.useCount} use{t.useCount === 1 ? '' : 's'}
                          {t.lastUsedAt && (
                            <span> · last used {new Date(t.lastUsedAt).toLocaleDateString()}</span>
                          )}
                          {!t.isActive && <span className="ml-2 text-ink-400">inactive</span>}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setLinksFor(linksFor === t.id ? null : t.id)}
                          className="text-xs text-ink-600 dark:text-ink-400 hover:underline"
                        >
                          {linksFor === t.id ? 'Hide links' : 'Links'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditing({
                              id: t.id,
                              practiceArea: t.practiceArea,
                              matterType: t.matterType ?? '',
                              name: t.name,
                              body: t.body,
                              variables: t.variables ?? [],
                              isActive: t.isActive,
                            })
                          }
                          className="text-xs text-brand-600 hover:underline"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                    {linksFor === t.id && (
                      <div className="mt-2">
                        <EntityLinksPanel
                          entityType="template"
                          entityId={t.id}
                          entityTitle={t.name}
                          defaultOpen
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplateEditor({
  form,
  onChange,
  onCancel,
  onSave,
  onDelete,
  saving,
  error,
}: {
  form: TemplateForm;
  onChange: (f: TemplateForm) => void;
  onCancel: () => void;
  onSave: () => void;
  onDelete?: () => void;
  saving: boolean;
  error?: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="space-y-3 rounded border border-ink-200 dark:border-ink-800 bg-white dark:bg-ink-900 p-4"
    >
      {!form.id && <TaxonomyGuide currentKind="template" />}
      <DuplicateCheck title={form.name} currentKind="template" disabled={!!form.id} />
      <div className="grid grid-cols-3 gap-3">
        <label className="text-xs">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Practice area</div>
          <select
            value={form.practiceArea}
            onChange={(e) => onChange({ ...form, practiceArea: e.target.value as PracticeArea })}
            className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
          >
            {PRACTICE_AREAS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs col-span-2">
          <div className="text-ink-500 dark:text-ink-400 mb-1">Matter type (optional)</div>
          <input
            type="text"
            placeholder="e.g. mutual-NDA, vendor-MSA, offer-letter"
            value={form.matterType}
            onChange={(e) => onChange({ ...form, matterType: e.target.value })}
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
        <div className="text-ink-500 dark:text-ink-400 mb-1">
          Body (markdown; variables as <code>{'{{variable_name}}'}</code>)
        </div>
        <textarea
          value={form.body}
          onChange={(e) => onChange({ ...form, body: e.target.value })}
          required
          className="w-full border border-ink-200 dark:border-ink-700 rounded px-2 py-1.5 bg-transparent min-h-[260px] font-mono text-xs"
        />
      </label>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-ink-500 dark:text-ink-400">Variables</span>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...form,
                variables: [...form.variables, { name: '', description: '', defaultValue: '' }],
              })
            }
            className="text-xs text-brand-600 hover:underline"
          >
            + Variable
          </button>
        </div>
        {form.variables.length === 0 ? (
          <p className="text-[11px] text-ink-400 dark:text-ink-500">
            No variables. Use <code>{'{{counterparty}}'}</code>-style placeholders in the
            body and define them here so attorneys see field names when applying.
          </p>
        ) : (
          <ul className="space-y-1">
            {form.variables.map((v, idx) => (
              <li key={idx} className="grid grid-cols-12 gap-2 items-center">
                <input
                  type="text"
                  placeholder="name"
                  value={v.name}
                  onChange={(e) => {
                    const next = [...form.variables];
                    next[idx] = { ...v, name: e.target.value };
                    onChange({ ...form, variables: next });
                  }}
                  className="col-span-3 text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
                />
                <input
                  type="text"
                  placeholder="description"
                  value={v.description ?? ''}
                  onChange={(e) => {
                    const next = [...form.variables];
                    next[idx] = { ...v, description: e.target.value };
                    onChange({ ...form, variables: next });
                  }}
                  className="col-span-5 text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
                />
                <input
                  type="text"
                  placeholder="default value"
                  value={v.defaultValue ?? ''}
                  onChange={(e) => {
                    const next = [...form.variables];
                    next[idx] = { ...v, defaultValue: e.target.value };
                    onChange({ ...form, variables: next });
                  }}
                  className="col-span-3 text-xs border border-ink-200 dark:border-ink-700 rounded px-2 py-1 bg-transparent"
                />
                <button
                  type="button"
                  onClick={() => {
                    const next = form.variables.filter((_, i) => i !== idx);
                    onChange({ ...form, variables: next });
                  }}
                  className="col-span-1 text-xs text-red-500 hover:text-red-700"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-between pt-2 border-t border-ink-100 dark:border-ink-800">
        <label className="text-xs text-ink-600 dark:text-ink-400 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
          />
          Active
        </label>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              className="text-xs text-red-600 hover:underline"
            >
              Delete
            </button>
          )}
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

'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema } from '@legal/types';

const PRACTICE_AREAS = PracticeAreaSchema.options;

type ArticleForm = {
  id?: string;
  practiceArea: (typeof PRACTICE_AREAS)[number];
  title: string;
  body: string;
  tags: string;
  isActive: boolean;
};

const emptyForm = (): ArticleForm => ({
  practiceArea: 'commercial',
  title: '',
  body: '',
  tags: '',
  isActive: true,
});

export default function KnowledgeAdminPage() {
  const { data: articles = [], refetch } = trpc.admin.listKnowledgeArticles.useQuery();
  const upsert = trpc.admin.upsertKnowledgeArticle.useMutation({
    onSuccess: () => {
      refetch();
      setEditing(null);
    },
  });
  const remove = trpc.admin.deleteKnowledgeArticle.useMutation({ onSuccess: () => refetch() });

  const [editing, setEditing] = useState<ArticleForm | null>(null);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-gray-500 mt-1">
            FAQ articles available for self-service responses and as triage context.
          </p>
        </div>
        <button
          onClick={() => setEditing(emptyForm())}
          className="bg-brand-600 text-white text-sm px-4 py-2 rounded"
        >
          New article
        </button>
      </div>

      {editing && (
        <div className="bg-white border rounded-lg p-6 mb-6 space-y-4">
          <h2 className="font-medium">{editing.id ? 'Edit article' : 'New article'}</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Practice area</label>
              <select
                value={editing.practiceArea}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    practiceArea: e.target.value as ArticleForm['practiceArea'],
                  })
                }
                className="w-full border rounded px-3 py-1.5 text-sm"
              >
                {PRACTICE_AREAS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.isActive}
                  onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                  className="rounded"
                />
                Active (eligible for triage / self-service)
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Title</label>
            <input
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="e.g. When do I need a mutual NDA?"
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Tags (comma-separated)
            </label>
            <input
              value={editing.tags}
              onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
              placeholder="nda, template, self-service"
              className="w-full border rounded px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Article body (markdown supported)
            </label>
            <textarea
              value={editing.body}
              onChange={(e) => setEditing({ ...editing, body: e.target.value })}
              rows={12}
              className="w-full border rounded px-3 py-1.5 text-sm font-mono"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditing(null)}
              className="text-sm px-4 py-2 border rounded"
            >
              Cancel
            </button>
            <button
              disabled={upsert.isPending || !editing.title.trim() || !editing.body.trim()}
              onClick={() =>
                upsert.mutate({
                  id: editing.id,
                  practiceArea: editing.practiceArea,
                  title: editing.title,
                  body: editing.body,
                  tags: editing.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean),
                  isActive: editing.isActive,
                })
              }
              className="bg-brand-600 text-white text-sm px-4 py-2 rounded disabled:opacity-50"
            >
              {upsert.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      )}

      {articles.length === 0 && !editing ? (
        <div className="text-sm text-gray-500 bg-white border rounded-lg p-6 text-center">
          No knowledge articles yet. Create one to enable self-service answers and richer triage
          context.
        </div>
      ) : (
        <div className="space-y-3">
          {articles.map((art) => (
            <div
              key={art.id}
              className="bg-white border rounded-lg p-4 flex items-start justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-medium text-sm">{art.title}</span>
                  <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded capitalize">
                    {art.practiceArea}
                  </span>
                  {!art.isActive && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                      inactive
                    </span>
                  )}
                  {art.tags.map((t) => (
                    <span key={t} className="text-xs text-brand-600">
                      #{t}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500 line-clamp-2">{art.body}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() =>
                    setEditing({
                      id: art.id,
                      practiceArea: art.practiceArea,
                      title: art.title,
                      body: art.body,
                      tags: art.tags.join(', '),
                      isActive: art.isActive,
                    })
                  }
                  className="text-xs text-brand-600 hover:underline"
                >
                  Edit
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Delete "${art.title}"?`)) remove.mutate({ id: art.id });
                  }}
                  className="text-xs text-red-500 hover:underline"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

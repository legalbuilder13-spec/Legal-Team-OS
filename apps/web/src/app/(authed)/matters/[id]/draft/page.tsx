'use client';

import Link from 'next/link';
import { use, useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';

function tokenize(s: string): string[] {
  return s.split(/(\s+)/);
}

interface DiffSegment {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

function diffWords(oldText: string, newText: string): DiffSegment[] {
  const oldT = tokenize(oldText);
  const newT = tokenize(newText);
  const m = oldT.length;
  const n = newT.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i]![j] = oldT[i] === newT[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldT[i] === newT[j]) {
      out.push({ kind: 'same', text: oldT[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ kind: 'remove', text: oldT[i]! });
      i++;
    } else {
      out.push({ kind: 'add', text: newT[j]! });
      j++;
    }
  }
  while (i < m) out.push({ kind: 'remove', text: oldT[i++]! });
  while (j < n) out.push({ kind: 'add', text: newT[j++]! });
  return out;
}

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: matter } = trpc.matters.get.useQuery({ id });
  const { data: existingDraft, refetch } = trpc.drafts.get.useQuery({ matterId: id });
  const { data: versions = [], refetch: refetchVersions } = trpc.drafts.listVersions.useQuery({ matterId: id });
  const save = trpc.drafts.save.useMutation({
    onSuccess: () => {
      refetch();
      refetchVersions();
      setDirty(false);
      setLastSavedBody(body);
    },
  });
  const generateInitial = trpc.drafts.generateInitial.useMutation();
  const suggestEdits = trpc.drafts.suggestEdits.useMutation();

  const [title, setTitle] = useState('Draft');
  const [body, setBody] = useState('');
  const [lastSavedBody, setLastSavedBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [pendingBody, setPendingBody] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [compareVersionId, setCompareVersionId] = useState<string | null>(null);

  useEffect(() => {
    if (existingDraft) {
      setTitle(existingDraft.title);
      setBody(existingDraft.body);
      setLastSavedBody(existingDraft.body);
      setDirty(false);
    }
  }, [existingDraft]);

  const compareVersion = useMemo(
    () => versions.find((v) => v.id === compareVersionId) ?? null,
    [versions, compareVersionId],
  );

  const diffAgainst = pendingBody ?? (compareVersion ? compareVersion.body : null);
  const diffSegments = useMemo(() => {
    if (!diffAgainst) return null;
    return diffWords(diffAgainst, body);
  }, [diffAgainst, body]);

  if (!matter) return <div className="text-ink-500 dark:text-ink-400">Loading…</div>;

  return (
    <div className="max-w-[110rem]">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Link href={`/matters/${id}`} className="text-xs text-ink-500 dark:text-ink-400 hover:underline">
            ← {matter.shortId} · {matter.title}
          </Link>
          <h1 className="text-2xl font-semibold">Draft</h1>
        </div>
        <div className="flex items-center gap-2">
          {existingDraft && (
            <span className="text-xs text-ink-500 dark:text-ink-400">v{existingDraft.version}</span>
          )}
          <button
            disabled={save.isPending || !dirty || !title.trim()}
            onClick={() => save.mutate({ matterId: id, title, body })}
            className="bg-brand-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setDirty(true);
          }}
          placeholder="Draft title"
          className="border rounded px-2 py-1 text-sm flex-1 min-w-[200px] max-w-md"
        />
        <button
          disabled={generateInitial.isPending}
          onClick={() => {
            if (body && !confirm('Replace current draft with an AI-generated first draft?')) return;
            generateInitial.mutate(
              { matterId: id },
              {
                onSuccess: (r) => {
                  setBody(r.body);
                  setDirty(true);
                  setPendingBody(null);
                },
              },
            );
          }}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
        >
          {generateInitial.isPending ? 'Generating…' : 'Generate from playbook'}
        </button>
        <button
          onClick={() => setShowDiff((s) => !s)}
          className="text-sm border rounded px-3 py-1.5 hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          {showDiff ? 'Hide diff' : 'Show diff'}
        </button>
        {versions.length > 0 && (
          <select
            value={compareVersionId ?? ''}
            onChange={(e) => setCompareVersionId(e.target.value || null)}
            className="text-sm border rounded px-2 py-1.5"
          >
            <option value="">Compare to…</option>
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.versionNumber} · {new Date(v.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className={showDiff ? 'col-span-6' : 'col-span-9'}>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setDirty(e.target.value !== lastSavedBody);
            }}
            placeholder="Start drafting in Markdown, or generate a first draft from the playbook…"
            className="w-full border rounded font-mono text-sm p-3 min-h-[60vh] bg-white dark:bg-ink-900"
          />

          <div className="mt-3 bg-white dark:bg-ink-900 border rounded-lg p-3">
            <div className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-2">Suggest edits</div>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder='e.g. "Tighten the indemnification clause and cap liability at 12 months fees."'
              rows={2}
              className="w-full border rounded px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-2 mt-2">
              <button
                disabled={suggestEdits.isPending || !instruction.trim() || !body.trim()}
                onClick={() =>
                  suggestEdits.mutate(
                    { matterId: id, instruction },
                    { onSuccess: (r) => setPendingBody(r.body) },
                  )
                }
                className="text-sm bg-brand-600 text-white px-3 py-1 rounded disabled:opacity-50"
              >
                {suggestEdits.isPending ? 'Thinking…' : 'Generate suggested edit'}
              </button>
              {pendingBody && (
                <>
                  <button
                    onClick={() => {
                      setBody(pendingBody);
                      setDirty(true);
                      setPendingBody(null);
                    }}
                    className="text-sm border rounded px-3 py-1 hover:bg-ink-50 dark:hover:bg-ink-800"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => setPendingBody(null)}
                    className="text-sm text-ink-500 dark:text-ink-400 hover:underline"
                  >
                    Discard suggestion
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {showDiff && (
          <div className="col-span-6">
            <div className="bg-white dark:bg-ink-900 border rounded-lg p-3 sticky top-4">
              <div className="text-xs font-medium text-ink-500 dark:text-ink-400 mb-2">
                {pendingBody
                  ? 'Diff: pending suggestion → current'
                  : compareVersion
                    ? `Diff: v${compareVersion.versionNumber} → current`
                    : 'Diff: last saved → current'}
              </div>
              {diffSegments ? (
                <div className="text-sm whitespace-pre-wrap font-mono">
                  {diffSegments.map((seg, i) => (
                    <span
                      key={i}
                      className={
                        seg.kind === 'add'
                          ? 'bg-green-100 text-green-900'
                          : seg.kind === 'remove'
                            ? 'bg-red-100 text-red-900 line-through'
                            : ''
                      }
                    >
                      {seg.text}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-ink-500 dark:text-ink-400">
                  Pick a version to compare, or generate a suggested edit.
                </div>
              )}
            </div>
          </div>
        )}

        <aside className="col-span-3">
          <div className="bg-white dark:bg-ink-900 border rounded-lg p-3 text-sm sticky top-4">
            <h2 className="font-medium mb-2">Version history</h2>
            {versions.length === 0 ? (
              <p className="text-xs text-ink-500 dark:text-ink-400">
                No history yet — versions are saved every time you save changes.
              </p>
            ) : (
              <ul className="space-y-1">
                {versions.map((v) => (
                  <li key={v.id} className="text-xs">
                    <button
                      onClick={() => setCompareVersionId(v.id)}
                      className={`text-left hover:text-brand-700 ${compareVersionId === v.id ? 'text-brand-700 font-medium' : ''}`}
                    >
                      v{v.versionNumber} · {new Date(v.createdAt).toLocaleString()}
                    </button>
                    {v.changeSummary && (
                      <div className="text-ink-500 dark:text-ink-400 italic">{v.changeSummary}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

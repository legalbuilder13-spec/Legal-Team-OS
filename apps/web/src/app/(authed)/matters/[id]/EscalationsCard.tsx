'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const SEVERITY = ['low', 'medium', 'high', 'critical'] as const;

const SEVERITY_COLOR: Record<string, string> = {
  low: 'bg-ink-100 text-ink-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export function EscalationsCard({ matterId }: { matterId: string }) {
  const { data = [], refetch } = trpc.escalations.list.useQuery({ matterId });
  const create = trpc.escalations.create.useMutation({
    onSuccess: () => {
      refetch();
      setComposing(false);
      setTitle('');
      setBody('');
    },
  });
  const ack = trpc.escalations.acknowledge.useMutation({ onSuccess: () => refetch() });
  const resolve = trpc.escalations.resolve.useMutation({ onSuccess: () => refetch() });

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [severity, setSeverity] = useState<(typeof SEVERITY)[number]>('medium');

  const open = data.filter((e) => e.status !== 'resolved');

  return (
    <div className="bg-white border rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-medium">Escalations</h2>
        {!composing && (
          <button
            onClick={() => setComposing(true)}
            className="text-xs text-brand-600 hover:underline"
          >
            + Escalate
          </button>
        )}
      </div>

      {composing && (
        <div className="border rounded-md p-2 mb-2 bg-ink-50 space-y-1">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full border rounded px-2 py-1 text-sm bg-white"
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs senior attention?"
            rows={3}
            className="w-full border rounded px-2 py-1 text-sm bg-white"
          />
          <div className="flex items-center gap-2">
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as typeof severity)}
              className="border rounded px-2 py-1 text-xs bg-white"
            >
              {SEVERITY.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button
              onClick={() => setComposing(false)}
              className="text-xs px-2 py-1 border rounded"
            >
              Cancel
            </button>
            <button
              disabled={create.isPending || !title.trim() || !body.trim()}
              onClick={() =>
                create.mutate({
                  matterId,
                  kind: 'manual',
                  severity,
                  title: title.trim(),
                  body: body.trim(),
                })
              }
              className="text-xs px-2 py-1 bg-brand-600 text-white rounded disabled:opacity-50 ml-auto"
            >
              {create.isPending ? 'Saving…' : 'Escalate'}
            </button>
          </div>
        </div>
      )}

      {open.length === 0 && !composing && (
        <p className="text-xs text-ink-500">No open escalations.</p>
      )}

      <ul className="space-y-2">
        {open.map((e) => (
          <li key={e.id} className="border-l-2 border-red-400 pl-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded ${SEVERITY_COLOR[e.severity] ?? ''}`}>
                {e.severity}
              </span>
              <span className="text-xs text-ink-400">{e.kind}</span>
              {e.createdByKind === 'system' && <span className="text-xs text-ink-400">· auto</span>}
            </div>
            <div className="font-medium text-xs mt-0.5">{e.title}</div>
            <p className="text-xs text-ink-700 whitespace-pre-wrap mt-0.5">{e.body}</p>
            <div className="flex gap-2 mt-1">
              {e.status === 'open' && (
                <button
                  onClick={() => ack.mutate({ id: e.id })}
                  className="text-xs text-ink-600 hover:underline"
                >
                  Ack
                </button>
              )}
              <button
                onClick={() => {
                  const note = prompt('Resolution note (optional)') ?? undefined;
                  resolve.mutate({ id: e.id, resolutionNote: note });
                }}
                className="text-xs text-brand-600 hover:underline"
              >
                Resolve
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

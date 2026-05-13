'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export function SaveToNotionButton({ matterId }: { matterId: string }) {
  const { data: status } = trpc.notion.status.useQuery();
  const save = trpc.notion.saveMatterToNotion.useMutation();
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

  if (!status?.configured) {
    return (
      <span className="text-xs text-ink-400" title="Set NOTION_API_KEY to enable">
        Notion not configured
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() =>
          save.mutate(
            { matterId },
            {
              onSuccess: (r) => setSavedUrl(r.url),
              onError: (e) => alert(e.message),
            },
          )
        }
        disabled={save.isPending}
        className="text-xs border rounded px-2 py-1 hover:bg-ink-50 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save to Notion'}
      </button>
      {savedUrl && (
        <a
          href={savedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand-600 hover:underline"
        >
          Open in Notion ↗
        </a>
      )}
    </div>
  );
}

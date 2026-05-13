'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

export function SaveToDriveButton({ matterId }: { matterId: string }) {
  const { data: status } = trpc.drive.status.useQuery();
  const save = trpc.drive.saveMatterToDrive.useMutation();
  const [savedUrl, setSavedUrl] = useState<string | null>(null);

  if (!status?.configured) {
    return (
      <span className="text-xs text-gray-400" title="Set GOOGLE_SERVICE_ACCOUNT_JSON to enable">
        Drive not configured
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
              onSuccess: (r) => setSavedUrl(r.webViewLink),
              onError: (e) => alert(e.message),
            },
          )
        }
        disabled={save.isPending}
        className="text-xs border rounded px-2 py-1 hover:bg-gray-50 disabled:opacity-50"
      >
        {save.isPending ? 'Saving…' : 'Save to Drive'}
      </button>
      {savedUrl && (
        <a
          href={savedUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-brand-600 hover:underline"
        >
          Open in Drive ↗
        </a>
      )}
    </div>
  );
}

'use client';

import { useRef, useState } from 'react';
import { FileText, Upload, RefreshCw } from 'lucide-react';
import { trpc } from '@/lib/trpc';

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-ink-100 text-ink-600 dark:bg-ink-800 dark:text-ink-300',
  parsing: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  parsed: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  failed: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  // Browser doesn't have Buffer; build base64 manually from the bytes.
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(binary);
}

export function DocumentsCard({ matterId }: { matterId: string }) {
  const utils = trpc.useUtils();
  const { data: documents = [], isLoading } = trpc.documents.listForMatter.useQuery(
    { matterId },
    { refetchInterval: 4000 },
  );
  const upload = trpc.documents.upload.useMutation({
    onSuccess: () => utils.documents.listForMatter.invalidate({ matterId }),
  });
  const reparse = trpc.documents.reparse.useMutation({
    onSuccess: () => utils.documents.listForMatter.invalidate({ matterId }),
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const contentBase64 = await fileToBase64(file);
      await upload.mutateAsync({
        matterId,
        filename: file.name,
        mimeType:
          file.type ||
          (file.name.toLowerCase().endsWith('.docx')
            ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : file.name.toLowerCase().endsWith('.pdf')
              ? 'application/pdf'
              : 'application/octet-stream'),
        contentBase64,
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium flex items-center gap-2">
          <FileText className="h-4 w-4 text-ink-500 dark:text-ink-400" />
          Documents
        </h2>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 text-xs border rounded px-2.5 py-1 hover:bg-ink-50 dark:hover:bg-ink-800 disabled:opacity-50"
        >
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'Uploading…' : 'Upload .docx / .pdf'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          className="hidden"
        />
      </div>

      {isLoading ? (
        <div className="text-sm text-ink-500 dark:text-ink-400">Loading…</div>
      ) : documents.length === 0 ? (
        <p className="text-sm text-ink-500 dark:text-ink-400">
          No documents uploaded. Upload a .docx or .pdf to parse into clauses for
          downstream playbook analysis.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-3 border-t border-ink-100 dark:border-ink-800 pt-2 first:border-t-0 first:pt-0"
            >
              <FileText className="h-4 w-4 text-ink-400 dark:text-ink-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{d.filename}</div>
                <div className="text-[11px] text-ink-500 dark:text-ink-400 flex items-center gap-2">
                  <span>{formatBytes(d.sizeBytes)}</span>
                  <span>·</span>
                  <span>{new Date(d.createdAt).toLocaleString()}</span>
                  {d.parseStatus === 'parsed' && d.clauseCount != null && (
                    <>
                      <span>·</span>
                      <span>{d.clauseCount} clauses</span>
                      {d.pageCount != null && (
                        <>
                          <span>·</span>
                          <span>{d.pageCount} pages</span>
                        </>
                      )}
                    </>
                  )}
                </div>
                {d.parseStatus === 'failed' && d.parseError && (
                  <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 truncate">
                    {d.parseError}
                  </div>
                )}
              </div>
              <span
                className={`text-[10.5px] px-1.5 py-0.5 rounded ${STATUS_TONE[d.parseStatus]}`}
              >
                {d.parseStatus}
              </span>
              {(d.parseStatus === 'failed' || d.parseStatus === 'parsed') && (
                <button
                  type="button"
                  onClick={() => reparse.mutate({ documentId: d.id })}
                  className="text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
                  title="Re-parse"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {upload.error && (
        <p className="text-xs text-red-600 dark:text-red-400 mt-3">{upload.error.message}</p>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName: string | null;
  toolCalls: unknown[] | null;
  createdAt: Date | string;
}

interface ToolEvent {
  id: string;
  name: string;
  input?: unknown;
  result?: string;
}

export function ChatPanel({ matterId }: { matterId: string }) {
  const utils = trpc.useUtils();
  const { data: history = [], refetch } = trpc.chat.list.useQuery({ matterId });
  const clear = trpc.chat.clear.useMutation({ onSuccess: () => refetch() });

  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [activeTools, setActiveTools] = useState<ToolEvent[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [history, streamingText, activeTools.length]);

  async function send() {
    const message = input.trim();
    if (!message || isStreaming) return;
    setInput('');
    setIsStreaming(true);
    setError(null);
    setStreamingText('');
    setActiveTools([]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ matterId, message }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({ error: 'request failed' }));
        throw new Error(data.error ?? 'Request failed');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const block of events) {
          const lines = block.split('\n');
          let evt = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event: ')) evt = line.slice(7).trim();
            else if (line.startsWith('data: ')) dataStr = line.slice(6);
          }
          if (!dataStr) continue;
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (evt === 'text') {
            setStreamingText((t) => t + String(data.delta ?? ''));
          } else if (evt === 'tool_use') {
            setActiveTools((tools) => [
              ...tools,
              { id: String(data.id), name: String(data.name), input: data.input },
            ]);
          } else if (evt === 'tool_result') {
            setActiveTools((tools) =>
              tools.map((t) =>
                t.id === String(data.id) ? { ...t, result: String(data.result ?? '') } : t,
              ),
            );
          } else if (evt === 'error') {
            setError(String(data.message ?? 'error'));
          }
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      setActiveTools([]);
      await refetch();
      // Invalidate matter so any propose_note / propose_status_change results show.
      await utils.matters.get.invalidate({ id: matterId });
    }
  }

  const visible = history.filter((m) => m.role !== 'tool');

  return (
    <div className="bg-white border rounded-lg flex flex-col h-[calc(100vh-10rem)] sticky top-4">
      <header className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Copilot</span>
          <span className="text-xs text-ink-400">Claude · matter-scoped</span>
        </div>
        <button
          onClick={() => {
            if (confirm('Clear chat history for this matter?')) clear.mutate({ matterId });
          }}
          className="text-xs text-ink-500 hover:text-red-600"
        >
          Clear
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
        {visible.length === 0 && !streamingText && (
          <div className="text-ink-500 text-xs">
            Ask anything about this matter. The copilot can search playbooks, the knowledge base,
            similar past matters, Salesforce, and Notion — and can add notes or change status on your
            behalf.
          </div>
        )}

        {visible.map((m) => (
          <MessageBubble key={m.id} message={m as Message} />
        ))}

        {(streamingText || activeTools.length > 0) && (
          <div className="border-l-2 border-brand-500 pl-3">
            {activeTools.map((t) => (
              <div key={t.id} className="text-xs text-ink-500 italic mb-1">
                {t.result ? `✓ ${t.name}` : `… running ${t.name}`}
              </div>
            ))}
            {streamingText && (
              <div className="whitespace-pre-wrap text-ink-800">{streamingText}</div>
            )}
          </div>
        )}

        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="p-2 border-t flex gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Ask the copilot…"
          rows={2}
          disabled={isStreaming}
          className="flex-1 border rounded px-2 py-1.5 text-sm resize-none disabled:bg-ink-50"
        />
        <button
          type="submit"
          disabled={isStreaming || !input.trim()}
          className="bg-brand-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50 self-end"
        >
          {isStreaming ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="bg-brand-50 border border-brand-100 rounded px-3 py-2 whitespace-pre-wrap">
        {message.content}
      </div>
    );
  }
  return (
    <div className="border-l-2 border-brand-500 pl-3">
      {Array.isArray(message.toolCalls) && message.toolCalls.length > 0 && (
        <div className="text-xs text-ink-500 italic mb-1">
          {(message.toolCalls as Array<{ name?: string }>).map((tc, i) => (
            <span key={i}>✓ {tc.name ?? 'tool'}{i < message.toolCalls!.length - 1 ? ' · ' : ''}</span>
          ))}
        </div>
      )}
      {message.content && (
        <div className="whitespace-pre-wrap text-ink-800">{message.content}</div>
      )}
    </div>
  );
}

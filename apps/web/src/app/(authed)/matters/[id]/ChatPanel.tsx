'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema, type PracticeArea } from '@legal/types';

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
  const { data: promotedIds = [] } = trpc.chat.promotedChatMessageIds.useQuery({ matterId });
  const promotedSet = useMemo(() => new Set(promotedIds), [promotedIds]);
  const matter = trpc.matters.get.useQuery({ id: matterId }).data;
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
    <div className="bg-white dark:bg-ink-900 border rounded-lg flex flex-col h-[calc(100vh-10rem)] sticky top-4">
      <header className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">Copilot</span>
          <span className="text-xs text-ink-400 dark:text-ink-500">Claude · matter-scoped</span>
        </div>
        <button
          onClick={() => {
            if (confirm('Clear chat history for this matter?')) clear.mutate({ matterId });
          }}
          className="text-xs text-ink-500 dark:text-ink-400 hover:text-red-600"
        >
          Clear
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm">
        {visible.length === 0 && !streamingText && (
          <div className="text-ink-500 dark:text-ink-400 text-xs">
            Ask anything about this matter. The copilot can search playbooks, the knowledge base,
            similar past matters, Salesforce, and Notion — and can add notes or change status on your
            behalf.
          </div>
        )}

        {visible.map((m, idx) => {
          // Pre-fill the KB modal with the user's preceding question +
          // this assistant message, so the lawyer doesn't have to retype.
          const precedingUser = (() => {
            for (let j = idx - 1; j >= 0; j -= 1) {
              const candidate = visible[j];
              if (candidate?.role === 'user') return candidate.content;
            }
            return null;
          })();
          return (
            <MessageBubble
              key={m.id}
              message={m as Message}
              matterId={matterId}
              precedingUserMessage={precedingUser}
              defaultPracticeArea={(matter?.practiceArea as PracticeArea) ?? 'commercial'}
              alreadyPromoted={promotedSet.has(m.id)}
              onPromoted={() => {
                void utils.chat.promotedChatMessageIds.invalidate({ matterId });
              }}
            />
          );
        })}

        {(streamingText || activeTools.length > 0) && (
          <div className="border-l-2 border-brand-500 pl-3">
            {activeTools.map((t) => (
              <div key={t.id} className="text-xs text-ink-500 dark:text-ink-400 italic mb-1">
                {t.result ? `✓ ${t.name}` : `… running ${t.name}`}
              </div>
            ))}
            {streamingText && (
              <div className="whitespace-pre-wrap text-ink-800 dark:text-ink-200">{streamingText}</div>
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
          className="flex-1 border rounded px-2 py-1.5 text-sm resize-none disabled:bg-ink-50 dark:bg-ink-900"
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

interface BubbleProps {
  message: Message;
  matterId: string;
  precedingUserMessage: string | null;
  defaultPracticeArea: PracticeArea;
  alreadyPromoted: boolean;
  onPromoted: () => void;
}

function MessageBubble({
  message,
  matterId,
  precedingUserMessage,
  defaultPracticeArea,
  alreadyPromoted,
  onPromoted,
}: BubbleProps) {
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
        <div className="text-xs text-ink-500 dark:text-ink-400 italic mb-1">
          {(message.toolCalls as Array<{ name?: string }>).map((tc, i) => (
            <span key={i}>✓ {tc.name ?? 'tool'}{i < message.toolCalls!.length - 1 ? ' · ' : ''}</span>
          ))}
        </div>
      )}
      {message.content && (
        <div className="whitespace-pre-wrap text-ink-800 dark:text-ink-200">{message.content}</div>
      )}
      {message.content && message.content.length > 100 && (
        <PromoteToKbButton
          matterId={matterId}
          chatMessageId={message.id}
          defaultTitle={
            precedingUserMessage
              ? precedingUserMessage.slice(0, 100)
              : 'Knowledge from copilot chat'
          }
          defaultBody={message.content}
          defaultPracticeArea={defaultPracticeArea}
          alreadyPromoted={alreadyPromoted}
          onPromoted={onPromoted}
        />
      )}
    </div>
  );
}

interface PromoteProps {
  matterId: string;
  chatMessageId: string;
  defaultTitle: string;
  defaultBody: string;
  defaultPracticeArea: PracticeArea;
  alreadyPromoted: boolean;
  onPromoted: () => void;
}

function PromoteToKbButton({
  matterId,
  chatMessageId,
  defaultTitle,
  defaultBody,
  defaultPracticeArea,
  alreadyPromoted,
  onPromoted,
}: PromoteProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState(defaultBody);
  const [practiceArea, setPracticeArea] = useState<PracticeArea>(defaultPracticeArea);
  const [tags, setTags] = useState('');

  const promote = trpc.chat.promoteToKnowledge.useMutation({
    onSuccess: () => {
      setOpen(false);
      onPromoted();
    },
  });

  if (alreadyPromoted) {
    return (
      <div className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
        ✓ Already saved as a Knowledge article (review at /admin/knowledge)
      </div>
    );
  }

  return (
    <div className="mt-2">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setTitle(defaultTitle);
            setBody(defaultBody);
            setPracticeArea(defaultPracticeArea);
            setTags('');
            setOpen(true);
          }}
          className="text-[11px] text-ink-500 dark:text-ink-400 hover:underline"
          title="Save this answer as a Knowledge article so the next lawyer with the same question doesn't re-ask"
        >
          + Save as Knowledge
        </button>
      ) : (
        <div className="border rounded p-2 space-y-2 bg-ink-50 dark:bg-ink-900/40">
          <div className="text-[11px] text-ink-600 dark:text-ink-400">
            Saves as a draft Knowledge article (inactive — admin reviews
            before activating). Cross-linked to this matter as
            "derived_from".
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full border rounded px-2 py-1 text-xs"
            maxLength={120}
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full border rounded px-2 py-1 text-xs font-mono"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value as PracticeArea)}
              className="border rounded px-2 py-1 text-xs"
            >
              {PracticeAreaSchema.options.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (comma-separated)"
              className="border rounded px-2 py-1 text-xs"
            />
          </div>
          {promote.error && (
            <div className="text-[11px] text-red-600 dark:text-red-400">
              {promote.error.message}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] px-2 py-1 border rounded hover:bg-white dark:hover:bg-ink-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={promote.isPending || title.trim().length < 3 || body.trim().length < 50}
              onClick={() =>
                promote.mutate({
                  matterId,
                  chatMessageId,
                  title: title.trim(),
                  body: body.trim(),
                  practiceArea,
                  tags: tags
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className="text-[11px] px-2 py-1 border rounded bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {promote.isPending ? 'Saving…' : 'Save as Knowledge'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

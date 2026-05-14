'use client';

import { useState } from 'react';
import {
  Building2,
  GitMerge,
  Brain,
  FileText,
  MessageSquare,
  Files,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import type { InsightCard, InsightCardSource, MatterContext } from '@legal/types';

const SOURCE_META: Record<
  InsightCardSource,
  { label: string; Icon: LucideIcon }
> = {
  salesforce: { label: 'Salesforce', Icon: Building2 },
  similar_matters: { label: 'Similar matters', Icon: GitMerge },
  counterparty_memory: { label: 'Counterparty memory', Icon: Brain },
  notion: { label: 'Notion', Icon: FileText },
  slack: { label: 'Slack', Icon: MessageSquare },
  drive: { label: 'Drive', Icon: Files },
  manual: { label: 'Manual note', Icon: Pencil },
};

// The render order on the matter page. Sources not in this list fall to the
// end alphabetically. Order reflects what's most useful at a glance.
const SOURCE_ORDER: InsightCardSource[] = [
  'salesforce',
  'counterparty_memory',
  'similar_matters',
  'notion',
  'slack',
  'drive',
  'manual',
];

function isInsightCard(value: unknown): value is InsightCard {
  return (
    typeof value === 'object' &&
    value !== null &&
    'source' in value &&
    'fetchedAt' in value &&
    'staleAfter' in value &&
    'primary' in value
  );
}

function ageLabel(fetchedAt: string): string {
  const ms = Date.now() - new Date(fetchedAt).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function isStale(card: InsightCard): boolean {
  return new Date(card.staleAfter).getTime() <= Date.now();
}

function ContextCard({ card }: { card: InsightCard }) {
  const [showRaw, setShowRaw] = useState(false);
  const meta = SOURCE_META[card.source];
  const Icon = meta.Icon;
  const stale = isStale(card);

  return (
    <div className="bg-white dark:bg-ink-900 border border-ink-200 dark:border-ink-800 rounded-lg p-4 text-sm">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-ink-500 dark:text-ink-400 shrink-0" />
          <h3 className="font-medium truncate">{meta.label}</h3>
        </div>
        <span
          className={`text-[10.5px] tabular-nums ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-ink-400 dark:text-ink-500'}`}
          title={`Fetched ${new Date(card.fetchedAt).toLocaleString()}; stale after ${new Date(card.staleAfter).toLocaleString()}`}
        >
          {stale ? `stale · ${ageLabel(card.fetchedAt)}` : ageLabel(card.fetchedAt)}
        </span>
      </div>

      {card.primary.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-ink-700 dark:text-ink-300 mb-2">
          {card.primary.map((p) => (
            <div key={p.label} className="flex items-baseline gap-2 min-w-0">
              <dt className="text-ink-500 dark:text-ink-400 shrink-0">{p.label}</dt>
              <dd className="font-medium truncate">{String(p.value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.summary && (
        <p className="text-xs text-ink-600 dark:text-ink-400 italic">{card.summary}</p>
      )}

      <div className="mt-2 flex items-center gap-3 text-xs">
        {card.drilldownUrl && (
          <a
            href={card.drilldownUrl}
            target={card.drilldownUrl.startsWith('http') ? '_blank' : undefined}
            rel="noreferrer"
            className="underline decoration-dotted underline-offset-2 text-brand-700 dark:text-brand-400"
          >
            Open source →
          </a>
        )}
        {card.raw && Object.keys(card.raw).length > 0 && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="ml-auto text-ink-400 hover:text-ink-700 dark:hover:text-ink-200"
          >
            {showRaw ? 'Hide raw' : 'View raw'}
          </button>
        )}
      </div>

      {showRaw && card.raw && (
        <pre className="mt-2 max-h-64 overflow-auto rounded bg-ink-50 dark:bg-ink-950 p-2 text-[10.5px] leading-tight text-ink-700 dark:text-ink-300">
          {JSON.stringify(card.raw, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ContextCardGrid({
  context,
  hide,
}: {
  context: MatterContext | Record<string, unknown> | null | undefined;
  // Sources to omit from the grid because they're rendered elsewhere on the
  // page (e.g. similar_matters has its own rich list; counterparty_memory is
  // surfaced from the counterparties table, not from matters.context).
  hide?: InsightCardSource[];
}) {
  if (!context) return null;
  const hideSet = new Set(hide ?? []);

  // Filter to only entries that conform to the InsightCard shape. Legacy
  // entries (the {source, fetched_at, data} shape) are silently skipped —
  // they'll be re-emitted in the new shape the next time the worker runs.
  const cards: Array<{ key: InsightCardSource; card: InsightCard }> = [];
  for (const [key, value] of Object.entries(context)) {
    if (hideSet.has(key as InsightCardSource)) continue;
    if (isInsightCard(value)) {
      cards.push({ key: key as InsightCardSource, card: value });
    }
  }

  if (cards.length === 0) return null;

  cards.sort((a, b) => {
    const ai = SOURCE_ORDER.indexOf(a.key);
    const bi = SOURCE_ORDER.indexOf(b.key);
    if (ai === -1 && bi === -1) return a.key.localeCompare(b.key);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {cards.map(({ key, card }) => (
        <ContextCard key={key} card={card} />
      ))}
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';

// PRD §6.1 / §12. Deconstruction + Draft Memo output card. Shows the
// IRAC memo prominently, then the deconstruction tree as a collapsible
// nested view, then verification banner.

type NodeType = 'rule' | 'standard' | 'factor' | 'right' | 'evidence' | 'threshold';
type NodeStatus =
  | 'open'
  | 'closed_by_rule'
  | 'closed_by_stipulation'
  | 'closed_not_dispositive'
  | 'deferred';

interface DeconstructionNode {
  id: string;
  parent_id: string | null;
  question: string;
  type: NodeType;
  status: NodeStatus;
  jurisdiction?: string | null;
  burden_of_production?: string | null;
  burden_of_persuasion?: string | null;
  standard_of_proof?: string | null;
  procedural_posture?: string | null;
  standard_of_review?: string | null;
  facts_assigned?: string | null;
  facts_missing?: string | null;
  anchor_citation?: string | null;
  notes?: string | null;
}

interface IRACMemo {
  issue: string;
  rule: string;
  application: string;
  conclusion: string;
  what_i_dont_know: string;
  mirror_image_argument: string;
  confidence_band: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPLIT';
  confidence_basis: string;
  word_count: number;
}

interface DeconstructOutput {
  nodes: DeconstructionNode[];
  memo: IRACMemo;
  inventory_categories_addressed: string[];
  inventory_items_pruned: string[];
  verify_flags: string[];
  verification?: {
    threshold_ordering_failures: string[];
    missing_mirror_image: boolean;
    missing_confidence_band: boolean;
    missing_dont_know: boolean;
    memo_too_long: boolean;
    invented_cites: string[];
  };
  worker_confidence?: 'HIGH' | 'MEDIUM' | 'LOW' | 'SPLIT' | 'N_A';
}

interface Props {
  output: DeconstructOutput;
  status: string;
  durationMs: number;
}

function ConfidenceBand({ band }: { band: IRACMemo['confidence_band'] }) {
  const tone =
    band === 'HIGH'
      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
      : band === 'MEDIUM'
        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-900'
        : band === 'SPLIT'
          ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-900'
          : 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border-red-200 dark:border-red-900';
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${tone}`}>{band}</span>
  );
}

function NodeTypePill({ t }: { t: NodeType }) {
  const tone =
    t === 'threshold'
      ? 'border-red-300 dark:border-red-800 text-red-700 dark:text-red-300'
      : t === 'rule'
        ? 'border-brand-300 dark:border-brand-800 text-brand-700 dark:text-brand-300'
        : t === 'standard'
          ? 'border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300'
          : t === 'factor'
            ? 'border-ink-300 dark:border-ink-700 text-ink-600 dark:text-ink-400'
            : t === 'right'
              ? 'border-purple-300 dark:border-purple-800 text-purple-700 dark:text-purple-300'
              : 'border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300';
  return (
    <span className={`text-[10px] font-mono uppercase px-1 py-0.5 rounded border ${tone}`}>
      {t}
    </span>
  );
}

function NodeStatusBadge({ s }: { s: NodeStatus }) {
  const label =
    s === 'open'
      ? 'open'
      : s === 'closed_by_rule'
        ? '✓ rule'
        : s === 'closed_by_stipulation'
          ? '✓ stipulated'
          : s === 'closed_not_dispositive'
            ? '✓ moot'
            : 'deferred';
  const tone =
    s === 'open'
      ? 'text-blue-600 dark:text-blue-400'
      : s === 'deferred'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-emerald-600 dark:text-emerald-400';
  return <span className={`text-[10px] font-mono ${tone}`}>{label}</span>;
}

function NodeRow({ node, depth }: { node: DeconstructionNode; depth: number }) {
  const [showDetails, setShowDetails] = useState(false);
  return (
    <div className="text-xs" style={{ marginLeft: `${depth * 14}px` }}>
      <button
        onClick={() => setShowDetails((x) => !x)}
        className="w-full text-left flex items-start gap-2 py-1 hover:bg-ink-50/50 dark:hover:bg-ink-800/30 rounded px-1"
      >
        <span className="text-ink-400 dark:text-ink-500 shrink-0 mt-0.5">
          {showDetails ? '▾' : '▸'}
        </span>
        <NodeTypePill t={node.type} />
        <span className="flex-1 text-ink-800 dark:text-ink-200">{node.question}</span>
        <NodeStatusBadge s={node.status} />
      </button>
      {showDetails && (
        <div className="ml-7 mt-1 mb-1 space-y-0.5 text-[11px] text-ink-600 dark:text-ink-400">
          {node.anchor_citation && (
            <div>
              <span className="font-medium">Anchor:</span>{' '}
              <span className="font-mono">{node.anchor_citation}</span>
            </div>
          )}
          {node.jurisdiction && (
            <div>
              <span className="font-medium">Jurisdiction:</span> {node.jurisdiction}
            </div>
          )}
          {node.procedural_posture && (
            <div>
              <span className="font-medium">Posture:</span> {node.procedural_posture}
            </div>
          )}
          {node.standard_of_review && (
            <div>
              <span className="font-medium">Standard of review:</span> {node.standard_of_review}
            </div>
          )}
          {(node.burden_of_production || node.burden_of_persuasion) && (
            <div>
              <span className="font-medium">Burden:</span> prod={node.burden_of_production ?? '—'}{' '}
              · pers={node.burden_of_persuasion ?? '—'}
              {node.standard_of_proof && ` · proof=${node.standard_of_proof}`}
            </div>
          )}
          {node.facts_assigned && (
            <div>
              <span className="font-medium">Facts assigned:</span> {node.facts_assigned}
            </div>
          )}
          {node.facts_missing && (
            <div className="text-amber-700 dark:text-amber-300">
              <span className="font-medium">Facts missing:</span> {node.facts_missing}
            </div>
          )}
          {node.notes && (
            <div>
              <span className="font-medium">Notes:</span> {node.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface TreeNode extends DeconstructionNode {
  children: TreeNode[];
  depth: number;
}

function buildTree(nodes: DeconstructionNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [], depth: 0 });
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    if (n.parent_id && byId.has(n.parent_id)) {
      const parent = byId.get(n.parent_id)!;
      parent.children.push(n);
      n.depth = parent.depth + 1;
    } else {
      roots.push(n);
    }
  }
  // Threshold-first ordering at every level — PRD §D10.
  function order(list: TreeNode[]) {
    list.sort((a, b) => {
      if (a.type === 'threshold' && b.type !== 'threshold') return -1;
      if (b.type === 'threshold' && a.type !== 'threshold') return 1;
      return 0;
    });
    for (const c of list) order(c.children);
  }
  order(roots);
  return roots;
}

function flattenForRender(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = [];
  function walk(n: TreeNode) {
    out.push(n);
    for (const c of n.children) walk(c);
  }
  for (const n of nodes) walk(n);
  return out;
}

export function DeconstructStageCard({ output, status, durationMs }: Props) {
  const flat = useMemo(() => flattenForRender(buildTree(output.nodes)), [output.nodes]);

  if (status === 'failed') {
    return (
      <div className="border rounded-lg p-3 bg-red-50/30 dark:bg-red-950/20 border-red-200 dark:border-red-900">
        <div className="text-sm font-medium text-red-700 dark:text-red-300">
          Deconstruction failed
        </div>
        <pre className="mt-1 text-[11px] font-mono text-red-700 dark:text-red-300 overflow-x-auto">
          {JSON.stringify(output, null, 2).slice(0, 400)}
        </pre>
      </div>
    );
  }

  const ver = output.verification;
  const failures: string[] = [];
  if (ver?.threshold_ordering_failures && ver.threshold_ordering_failures.length > 0)
    failures.push(`${ver.threshold_ordering_failures.length} threshold ordering issue(s)`);
  if (ver?.missing_mirror_image) failures.push('missing mirror-image argument');
  if (ver?.missing_confidence_band) failures.push('missing confidence band');
  if (ver?.missing_dont_know) failures.push('missing "what I don\'t know" section');
  if (ver?.memo_too_long) failures.push('memo exceeds word budget');
  if (ver?.invented_cites && ver.invented_cites.length > 0)
    failures.push(`${ver.invented_cites.length} invented cite(s)`);
  const verified = failures.length === 0;

  return (
    <div className="border rounded-lg p-3 bg-white dark:bg-ink-900 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-medium">Deconstruction + Draft Memo</h3>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          {verified ? (
            <span className="px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
              checks passed
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
              {failures.length} check{failures.length === 1 ? '' : 's'} failed
            </span>
          )}
          <ConfidenceBand band={output.memo.confidence_band} />
          <span className="text-ink-400 dark:text-ink-500">{durationMs}ms</span>
        </div>
      </div>

      {/* IRAC memo — the lawyer-facing deliverable. */}
      <div className="space-y-2">
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
            Issue
          </div>
          <p className="text-sm text-ink-800 dark:text-ink-200">{output.memo.issue}</p>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
            Rule
          </div>
          <p className="text-sm text-ink-800 dark:text-ink-200 whitespace-pre-wrap">
            {output.memo.rule}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
            Application
          </div>
          <p className="text-sm text-ink-800 dark:text-ink-200 whitespace-pre-wrap">
            {output.memo.application}
          </p>
        </div>
        <div>
          <div className="text-[10px] font-medium uppercase text-ink-500 dark:text-ink-400 mb-1">
            Conclusion
          </div>
          <p className="text-sm text-ink-800 dark:text-ink-200">{output.memo.conclusion}</p>
        </div>
      </div>

      <div className="border-l-2 border-amber-500 pl-3 bg-amber-50/30 dark:bg-amber-950/20 py-2 -mx-1 rounded">
        <div className="text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300 mb-1">
          What I don't know
        </div>
        <p className="text-sm text-ink-800 dark:text-ink-200 whitespace-pre-wrap">
          {output.memo.what_i_dont_know}
        </p>
      </div>

      <div className="border-l-2 border-red-500 pl-3 bg-red-50/20 dark:bg-red-950/10 py-2 -mx-1 rounded">
        <div className="text-[10px] font-medium uppercase text-red-700 dark:text-red-300 mb-1">
          Mirror-image argument (strongest reading against)
        </div>
        <p className="text-sm text-ink-800 dark:text-ink-200 italic">
          {output.memo.mirror_image_argument}
        </p>
      </div>

      <div className="text-[11px] text-ink-500 dark:text-ink-400">
        <span className="font-medium">Confidence basis:</span> {output.memo.confidence_basis}
      </div>

      {/* Deconstruction tree — collapsible nested view. */}
      <details className="border-t pt-2">
        <summary className="text-xs font-medium text-ink-700 dark:text-ink-300 cursor-pointer">
          Deconstruction tree ({output.nodes.length} node{output.nodes.length === 1 ? '' : 's'})
        </summary>
        <div className="mt-2 space-y-0.5">
          {flat.map((n) => (
            <NodeRow key={n.id} node={n} depth={n.depth} />
          ))}
        </div>
      </details>

      {/* Inventory provenance. */}
      <details className="border-t pt-2">
        <summary className="text-xs font-medium text-ink-700 dark:text-ink-300 cursor-pointer">
          Inventory: {output.inventory_categories_addressed.length} addressed,{' '}
          {output.inventory_items_pruned.length} pruned
        </summary>
        <div className="mt-1 text-[11px] text-ink-500 dark:text-ink-400 space-y-1">
          {output.inventory_categories_addressed.length > 0 && (
            <div>
              <span className="font-medium">Addressed:</span>{' '}
              {output.inventory_categories_addressed.join(', ')}
            </div>
          )}
          {output.inventory_items_pruned.length > 0 && (
            <div>
              <span className="font-medium">Pruned:</span>{' '}
              {output.inventory_items_pruned.slice(0, 12).join(', ')}
              {output.inventory_items_pruned.length > 12 &&
                ` … +${output.inventory_items_pruned.length - 12} more`}
            </div>
          )}
        </div>
      </details>

      {output.verify_flags.length > 0 && (
        <div className="border-t pt-2">
          <div className="text-[10px] font-medium uppercase text-amber-700 dark:text-amber-300 mb-1">
            Verify flags
          </div>
          <ul className="text-xs space-y-0.5 list-disc ml-4 text-ink-700 dark:text-ink-300">
            {output.verify_flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      {!verified && (
        <div className="border-t pt-2 bg-red-50/30 dark:bg-red-950/20 -mx-3 -mb-3 px-3 pb-3">
          <div className="text-[10px] font-medium uppercase text-red-700 dark:text-red-300 mb-1">
            Post-check failures
          </div>
          <ul className="text-xs space-y-0.5 ml-3 list-disc text-red-700 dark:text-red-300">
            {failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <div className="mt-1 text-[10px] text-red-600 dark:text-red-400">
            Worker forced confidence to LOW per PRD §12.3 non-negotiables.
          </div>
        </div>
      )}

      <div className="text-[10px] font-mono text-ink-400 dark:text-ink-500 text-right">
        {output.memo.word_count} words
      </div>
    </div>
  );
}

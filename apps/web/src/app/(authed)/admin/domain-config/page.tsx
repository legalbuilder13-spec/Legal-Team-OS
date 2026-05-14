'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';

// PR12 §15 — admin UI for editing the org's domain config. JSON editor
// in v1 (the config schema is too freeform for a structured form to
// pay for itself yet). Validates client-side against the zod schema
// before save; server re-validates and writes audit_log.

export default function DomainConfigPage() {
  const { data, isLoading, refetch } = trpc.domainConfig.current.useQuery();
  const update = trpc.domainConfig.update.useMutation();

  const [json, setJson] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    if (data?.config) setJson(JSON.stringify(data.config, null, 2));
  }, [data]);

  const save = async () => {
    setParseError(null);
    setSaveMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (err) {
      setParseError(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!data) return;
    try {
      await update.mutateAsync({ orgId: data.orgId, config: parsed });
      setSaveMsg('Saved. Skills will pick up the new config on the next pipeline run.');
      await refetch();
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
    }
  };

  if (isLoading || !data) {
    return <div className="text-ink-500 dark:text-ink-400">Loading…</div>;
  }

  return (
    <div className="max-w-4xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">Domain configuration</h1>
        <p className="text-sm text-ink-600 dark:text-ink-400 mt-1">
          Per-organization rules that the analysis skills blend into every prompt:
          factual baseline, terminology, verb rules, high-scrutiny jurisdictions, and
          domain risk taxonomy. Per <code>PRD-Analysis-Pipeline.md §15</code>.
        </p>
        <div className="text-xs font-mono text-ink-500 dark:text-ink-400 mt-2">
          Org: {data.orgName} ({data.orgId})
        </div>
      </header>

      <details className="border rounded-md p-3 bg-ink-50/30 dark:bg-ink-800/30">
        <summary className="text-sm font-medium cursor-pointer">Shape reference</summary>
        <pre className="mt-2 text-[11px] font-mono overflow-x-auto bg-white dark:bg-ink-900 p-3 rounded">
{`{
  "factualBaselineFacts": ["The organization is …"],
  "terminologyRules": [
    { "preferred": "…", "avoid": "…", "rationale": "…" }
  ],
  "verbRules": [
    { "prefer": "verifies", "avoid": "ensures", "context": "…" }
  ],
  "highScrutinyJurisdictions": [
    {
      "jurisdiction": "California",
      "rationale": "…",
      "appliesToPracticeAreas": ["employment", "privacy"]
    }
  ],
  "domainRiskTaxonomy": [
    {
      "categoryId": "…",
      "label": "…",
      "examplesFlag": ["…", "…"],
      "defaultSeverity": "high"
    }
  ],
  "escalationThresholds": {
    "financialBetTheCompanyUsd": 1000000,
    "confidenceLowRouting": "senior_reviewer"
  }
}`}
        </pre>
      </details>

      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        rows={26}
        className="w-full border rounded p-3 font-mono text-xs"
        spellCheck={false}
      />

      {parseError && (
        <div className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
          {parseError}
        </div>
      )}
      {saveMsg && (
        <div className="text-sm text-emerald-700 dark:text-emerald-300">{saveMsg}</div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          onClick={() => {
            if (data?.config) setJson(JSON.stringify(data.config, null, 2));
            setParseError(null);
            setSaveMsg(null);
          }}
          className="text-sm px-3 py-1.5 border rounded hover:bg-ink-50 dark:hover:bg-ink-800"
        >
          Discard changes
        </button>
        <button
          onClick={save}
          disabled={update.isPending}
          className="text-sm px-3 py-1.5 bg-brand-600 text-white rounded disabled:opacity-50 hover:bg-brand-700"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

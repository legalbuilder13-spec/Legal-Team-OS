#!/usr/bin/env tsx
// M3 — Eval corpus builder. Extracts the (input, gold_output,
// rejected_outputs, lawyer_signals) tuples from the production
// database into JSONL files suitable for skill regression-replay.
//
// Usage:
//   DATABASE_URL=... tsx scripts/build-eval-corpus.ts --out eval/v1/
//
// Each output file is one stage_name's worth of tuples. The replay
// runner (apps/ai/src/eval/replay.py) consumes these.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '@legal/db';

interface CliOpts {
  out: string;
  limit: number;
  lookbackDays: number;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { out: 'eval/latest', limit: 500, lookbackDays: 365 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i] ?? opts.out;
    else if (a === '--limit') opts.limit = parseInt(argv[++i] ?? '', 10) || opts.limit;
    else if (a === '--lookback-days') {
      opts.lookbackDays = parseInt(argv[++i] ?? '', 10) || opts.lookbackDays;
    }
  }
  return opts;
}

interface EvalTuple {
  matter_id: string;
  matter_short_id: string;
  stage_name: string;
  practice_area: string | null;
  request_text: string;
  input_hash: string;
  stage_output: Record<string, unknown>;
  confidence: string;
  lawyer_decision: string;
  lawyer_decision_reason: string | null;
  created_at: string;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const db = getDb();

  // Pull every stage row with a non-pending lawyer decision in the
  // lookback. accepted = positive example; rejected/escalated =
  // negative example with attached reason. Group by stage_name so
  // each skill gets its own JSONL.
  const rows = (await db.execute(sql`
    SELECT
      mas.id::text AS stage_id,
      m.id::text AS matter_id,
      m.short_id AS matter_short_id,
      mas.stage_name::text AS stage_name,
      m.practice_area::text AS practice_area,
      m.request_text AS request_text,
      mas.input_hash AS input_hash,
      mas.output_json AS stage_output,
      mas.confidence::text AS confidence,
      mas.lawyer_decision::text AS lawyer_decision,
      mas.lawyer_decision_reason AS lawyer_decision_reason,
      mas.created_at AS created_at
    FROM matter_analysis_stages mas
    JOIN matter_analyses ma ON ma.id = mas.analysis_id
    JOIN matters m ON m.id = ma.matter_id
    WHERE mas.lawyer_decision != 'pending'
      AND mas.created_at > now() - (${opts.lookbackDays} || ' days')::interval
    ORDER BY mas.created_at DESC
    LIMIT ${opts.limit}
  `)) as unknown as Array<EvalTuple & { stage_id: string; created_at: Date }>;

  const byStage = new Map<string, EvalTuple[]>();
  for (const r of rows) {
    const tuple: EvalTuple = {
      matter_id: r.matter_id,
      matter_short_id: r.matter_short_id,
      stage_name: r.stage_name,
      practice_area: r.practice_area,
      request_text: r.request_text ?? '',
      input_hash: r.input_hash,
      stage_output: (r.stage_output ?? {}) as Record<string, unknown>,
      confidence: r.confidence,
      lawyer_decision: r.lawyer_decision,
      lawyer_decision_reason: r.lawyer_decision_reason,
      created_at:
        r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    };
    const arr = byStage.get(tuple.stage_name) ?? [];
    arr.push(tuple);
    byStage.set(tuple.stage_name, arr);
  }

  await mkdir(opts.out, { recursive: true });
  for (const [stage, tuples] of byStage) {
    const path = join(opts.out, `${stage}.jsonl`);
    const body = tuples.map((t) => JSON.stringify(t)).join('\n');
    await writeFile(path, body, 'utf8');
    console.log(`wrote ${tuples.length} tuples → ${path}`);
  }

  // Manifest. Replay reads this to know what files exist.
  const manifest = {
    generated_at: new Date().toISOString(),
    lookback_days: opts.lookbackDays,
    total_tuples: rows.length,
    by_stage: Object.fromEntries(
      Array.from(byStage.entries()).map(([k, v]) => [k, v.length]),
    ),
  };
  await writeFile(
    join(opts.out, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
  console.log(`wrote manifest → ${join(opts.out, 'manifest.json')}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

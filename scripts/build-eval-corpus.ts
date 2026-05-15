#!/usr/bin/env tsx
// M3 — Eval corpus builder. Extracts the (input, gold_output,
// rejected_outputs, lawyer_signals) tuples from the production
// database into JSONL files suitable for skill regression-replay.
//
// Usage (local-only output, e.g. for inspection before commit):
//   DATABASE_URL=... pnpm --filter @legal/worker exec \
//     tsx ../../scripts/build-eval-corpus.ts --out eval/v1/
//
// Usage (local output + upload to s3://${SNAPSHOTS_BUCKET}/${prefix}/):
//   DATABASE_URL=... SNAPSHOTS_BUCKET=my-snapshots \
//   SNAPSHOTS_S3_ENDPOINT=... SNAPSHOTS_S3_REGION=... \
//   SNAPSHOTS_S3_ACCESS_KEY_ID=... SNAPSHOTS_S3_SECRET_ACCESS_KEY=... \
//     pnpm --filter @legal/worker exec \
//       tsx ../../scripts/build-eval-corpus.ts --out eval/v1/ --s3 --s3-prefix eval/v1
//
// Why pnpm --filter @legal/worker exec: this script imports @legal/db
// (for getDb) and dynamically imports @aws-sdk/client-s3 (for --s3
// upload). Both are deps of @legal/worker; running in the worker
// workspace's resolution context makes both findable. Running directly
// via `tsx scripts/...` from repo root fails to resolve @legal/db.
//
// Each output file is one stage_name's worth of tuples. The replay
// runner (apps/ai/src/eval/replay.py) consumes these.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { getDb } from '@legal/db';

interface CliOpts {
  out: string;
  limit: number;
  lookbackDays: number;
  s3: boolean;
  s3Prefix: string | null;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    out: 'eval/latest',
    limit: 500,
    lookbackDays: 365,
    s3: false,
    s3Prefix: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') opts.out = argv[++i] ?? opts.out;
    else if (a === '--limit') opts.limit = parseInt(argv[++i] ?? '', 10) || opts.limit;
    else if (a === '--lookback-days') {
      opts.lookbackDays = parseInt(argv[++i] ?? '', 10) || opts.lookbackDays;
    } else if (a === '--s3') {
      opts.s3 = true;
    } else if (a === '--s3-prefix') {
      opts.s3Prefix = argv[++i] ?? null;
    }
  }
  // Default the S3 prefix to the trimmed --out path so corpus written
  // to eval/v1/ uploads to s3://${SNAPSHOTS_BUCKET}/eval/v1/.
  if (opts.s3 && !opts.s3Prefix) {
    opts.s3Prefix = opts.out.replace(/^\/+|\/+$/g, '');
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
  // Item 8 follow-up — the actual skill request the worker sent.
  // Null for stages run before the skill_input_json column landed.
  // Replay only runs against tuples where this is non-null.
  skill_input: Record<string, unknown> | null;
  stage_output: Record<string, unknown>;
  confidence: string;
  lawyer_decision: string;
  lawyer_decision_reason: string | null;
  created_at: string;
}

// Mirrors snapshot_storage.ts's dynamic-import pattern: don't load
// @aws-sdk/client-s3 unless the operator opts into --s3. Keeps the
// script importable in environments where the SDK isn't installed
// (notably CI without the worker workspace).
interface S3UploadDeps {
  client: unknown;
  PutObjectCommand: new (cfg: Record<string, unknown>) => unknown;
  bucket: string;
}

async function getS3Deps(): Promise<S3UploadDeps | null> {
  const bucket = process.env.SNAPSHOTS_BUCKET;
  if (!bucket) {
    console.warn('--s3 set but SNAPSHOTS_BUCKET is empty; skipping upload');
    return null;
  }
  try {
    const mod = (await import('@aws-sdk/client-s3')) as unknown as {
      S3Client: new (cfg: Record<string, unknown>) => unknown;
      PutObjectCommand: new (cfg: Record<string, unknown>) => unknown;
    };
    const client = new mod.S3Client({
      endpoint: process.env.SNAPSHOTS_S3_ENDPOINT || undefined,
      region: process.env.SNAPSHOTS_S3_REGION || 'us-east-1',
      credentials:
        process.env.SNAPSHOTS_S3_ACCESS_KEY_ID && process.env.SNAPSHOTS_S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.SNAPSHOTS_S3_ACCESS_KEY_ID,
              secretAccessKey: process.env.SNAPSHOTS_S3_SECRET_ACCESS_KEY,
            }
          : undefined,
      // R2 / MinIO need path-style addressing; AWS S3 prefers virtual-
      // host style. SDK auto-detects from endpoint so true is safe.
      forcePathStyle: true,
    });
    return { client, PutObjectCommand: mod.PutObjectCommand, bucket };
  } catch (err) {
    console.warn('--s3 set but @aws-sdk/client-s3 not installed; skipping upload', {
      err: String(err),
    });
    return null;
  }
}

async function putObject(
  deps: S3UploadDeps,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const cmd = new deps.PutObjectCommand({
    Bucket: deps.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
  });
  await (deps.client as { send: (c: unknown) => Promise<unknown> }).send(cmd);
}

async function uploadCorpusToS3(opts: CliOpts, fileNames: string[]): Promise<void> {
  if (!opts.s3) return;
  const deps = await getS3Deps();
  if (!deps) return;
  const prefix = (opts.s3Prefix ?? opts.out).replace(/^\/+|\/+$/g, '');
  for (const name of fileNames) {
    const localPath = join(opts.out, name);
    const body = await readFile(localPath);
    const key = `${prefix}/${name}`;
    const contentType = name.endsWith('.json')
      ? 'application/json'
      : name.endsWith('.jsonl')
        ? 'application/x-ndjson'
        : 'application/octet-stream';
    await putObject(deps, key, body, contentType);
    console.log(`uploaded → s3://${deps.bucket}/${key} (${body.length} bytes)`);
  }
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
      mas.skill_input_json AS skill_input,
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
      skill_input: (r.skill_input as Record<string, unknown> | null) ?? null,
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
  const writtenFileNames: string[] = [];
  for (const [stage, tuples] of byStage) {
    const fileName = `${stage}.jsonl`;
    const path = join(opts.out, fileName);
    const body = tuples.map((t) => JSON.stringify(t)).join('\n');
    await writeFile(path, body, 'utf8');
    console.log(`wrote ${tuples.length} tuples → ${path}`);
    writtenFileNames.push(fileName);
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
  writtenFileNames.push('manifest.json');

  // Optional S3 upload — opt-in via --s3 flag. Local files always
  // remain on disk so the operator can inspect or commit a subset.
  await uploadCorpusToS3(opts, writtenFileNames);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

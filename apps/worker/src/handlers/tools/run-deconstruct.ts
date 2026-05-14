import { eq, desc, asc } from 'drizzle-orm';
import {
  matterAnalyses,
  matterAnalysisStages,
  matters,
  auditLog,
  type Db,
  type Job,
} from '@legal/db';
import {
  PIPELINE_VERSION,
  getPracticeAreaInventory,
  type AnalysisConfidence,
  type PracticeArea,
} from '@legal/types';
import { env } from '../../env.js';
import { hashContent } from '../analyze/sources.js';

// PRD §12 + §7. Deconstruction + Draft Memo tool (lawyer-invoked).
// Synthesizes prior stage outputs into a deconstruction tree + IRAC
// memo. No new external integration — reads matter_analysis_stages
// for the matter and feeds compact summaries to the skill, then runs
// hardcoded post-checks (threshold-first ordering, mirror-image
// required, confidence band present, no invented citations).

interface RunDeconstructPayload {
  matter_id: string;
  invoked_by_user_id: string;
}

interface SkillNode {
  id: string;
  parent_id: string | null;
  question: string;
  type: 'rule' | 'standard' | 'factor' | 'right' | 'evidence' | 'threshold';
  status:
    | 'open'
    | 'closed_by_rule'
    | 'closed_by_stipulation'
    | 'closed_not_dispositive'
    | 'deferred';
  anchor_citation?: string | null;
  [k: string]: unknown;
}

interface SkillMemo {
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

interface DeconstructSkillResult {
  matter_id: string;
  nodes: SkillNode[];
  memo: SkillMemo;
  inventory_categories_addressed: string[];
  inventory_items_pruned: string[];
  verify_flags: string[];
}

// Compact summaries of prior stage outputs. The full structured
// outputs from statutory + case-law stages can be very long; we pass
// only the fields the deconstruct skill needs. Saves tokens and keeps
// the skill focused on synthesis rather than redoing the analysis.
function compactStatutorySummary(output: Record<string, unknown>): Record<string, unknown> {
  return {
    operative_provisions: (output.operative_provisions as Array<Record<string, unknown>> | undefined)?.slice(
      0,
      6,
    ) ?? [],
    ambiguities: (output.ambiguities as unknown[] | undefined)?.slice(0, 6) ?? [],
    textualist_reading: output.textualist_reading,
    purposivist_reading: output.purposivist_reading,
    gap_between_readings: output.gap_between_readings,
    notable_absences: (output.notable_absences as unknown[] | undefined)?.slice(0, 6) ?? [],
    worker_confidence: output.worker_confidence,
  };
}

function compactCaseLawSummary(output: Record<string, unknown>): Record<string, unknown> {
  return {
    controlling_authority: (output.controlling_authority as Array<Record<string, unknown>> | undefined)?.slice(
      0,
      5,
    ) ?? [],
    persuasive_authority: (output.persuasive_authority as Array<Record<string, unknown>> | undefined)?.slice(
      0,
      3,
    ) ?? [],
    circuit_split_present: output.circuit_split_present,
    anti_analogous_cases: (output.anti_analogous_cases as Array<Record<string, unknown>> | undefined)?.slice(
      0,
      5,
    ) ?? [],
    mirror_image_argument: output.mirror_image_argument,
    worker_confidence: output.worker_confidence,
  };
}

// Threshold-types: keep in sync with PRD §D2 + the threshold checklist.
// Used by the post-check to verify threshold nodes are at the top of
// the tree (no parent or parent is another threshold).
const THRESHOLD_TYPES = new Set([
  'threshold',
]);

function thresholdFirstOrderingCheck(nodes: SkillNode[]): string[] {
  const failures: string[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.type !== 'threshold') continue;
    if (!n.parent_id) continue;
    const parent = byId.get(n.parent_id);
    if (!parent) {
      failures.push(`threshold node ${n.id} references missing parent ${n.parent_id}`);
      continue;
    }
    if (!THRESHOLD_TYPES.has(parent.type)) {
      failures.push(
        `threshold node ${n.id} ('${n.question.slice(0, 40)}…') has non-threshold parent ${parent.id} (type=${parent.type}) — PRD §D10`,
      );
    }
  }
  return failures;
}

export async function handleRunDeconstructJob(db: Db, job: Job) {
  const payload = job.payload as unknown as RunDeconstructPayload;
  const matter = await db.query.matters.findFirst({ where: eq(matters.id, payload.matter_id) });
  if (!matter) throw new Error(`matter ${payload.matter_id} not found`);

  // Attach to existing analysis container.
  const existing = await db
    .select()
    .from(matterAnalyses)
    .where(eq(matterAnalyses.matterId, matter.id))
    .orderBy(desc(matterAnalyses.createdAt))
    .limit(1);
  let analysisId: string;
  if (existing[0]) {
    analysisId = existing[0].id;
  } else {
    const [created] = await db
      .insert(matterAnalyses)
      .values({
        matterId: matter.id,
        pipelineVersion: PIPELINE_VERSION,
        status: 'running',
        startedAt: new Date(),
      })
      .returning({ id: matterAnalyses.id });
    analysisId = created!.id;
  }

  const inputHash = hashContent(JSON.stringify(payload));
  const [stage] = await db
    .insert(matterAnalysisStages)
    .values({
      analysisId,
      stageName: 'deconstruct',
      status: 'running',
      inputHash,
      model: 'claude-opus-4-7',
      invokedByUserId: payload.invoked_by_user_id,
    })
    .returning({ id: matterAnalysisStages.id });
  const stageId = stage!.id;

  const startedAt = Date.now();

  try {
    // ----- 1. Load prior stage outputs for this analysis -----

    const priorStages = await db
      .select()
      .from(matterAnalysisStages)
      .where(eq(matterAnalysisStages.analysisId, analysisId))
      .orderBy(asc(matterAnalysisStages.createdAt));

    const preMeritsStage = priorStages.find((s) => s.stageName === 'pre_merits');
    const guidanceStage = priorStages.find((s) => s.stageName === 'guidance');
    // PR7 — multi-jurisdiction. Pull EVERY completed statutory + case-
    // law stage row so the deconstruct skill can harmonize across
    // jurisdictions. Each statutory stage carries its own jurisdiction
    // tag (set by run-statutory's output_json.jurisdiction).
    const statutoryStages = priorStages.filter(
      (s) => s.stageName === 'statutory' && s.status === 'complete',
    );
    const caseLawStage = [...priorStages].reverse().find((s) => s.stageName === 'case_law');

    const preMeritsOutput = (preMeritsStage?.outputJson ?? {}) as Record<string, unknown>;
    const guidanceOutput = (guidanceStage?.outputJson ?? {}) as Record<string, unknown>;

    const highSeverityIds = new Set(
      (preMeritsOutput.raisedHighSeverity as string[] | undefined) ?? [],
    );
    const preMeritsFlags = (
      (preMeritsOutput.findings as Array<Record<string, unknown>> | undefined) ?? []
    )
      .filter((f) => highSeverityIds.has(f.id as string))
      .map((f) => ({
        id: f.id,
        one_line_justification: f.oneLineJustification,
        evidence_quote: f.evidenceQuote,
      }));

    const guidanceTopMatch = guidanceOutput.headlineAnswer ?? null;

    const statutorySummaries = statutoryStages.map((s) => {
      const out = s.outputJson as Record<string, unknown>;
      return {
        jurisdiction: (out.jurisdiction as string | undefined) ?? 'unspecified',
        ...compactStatutorySummary(out),
      };
    });
    const caseLawSummary = caseLawStage?.status === 'complete'
      ? compactCaseLawSummary(caseLawStage.outputJson as Record<string, unknown>)
      : null;

    // ----- 2. Load practice-area inventory -----

    const practiceArea = (matter.practiceArea ?? 'other') as PracticeArea;
    const inventory = getPracticeAreaInventory(practiceArea);

    // ----- 3. Call the deconstruct skill -----

    // PR7 — jurisdictions[] for multi-jurisdiction harmonization.
    // Single-jurisdiction matters land in a one-element array; the
    // skill handles both cases uniformly.
    const jurisdictions = statutorySummaries.length > 0
      ? Array.from(new Set(statutorySummaries.map((s) => s.jurisdiction)))
      : ['unspecified'];

    const skillReq = {
      matter_id: matter.id,
      request_text: matter.requestText,
      jurisdiction: jurisdictions.join(' / '),
      jurisdictions,
      practice_area: practiceArea,
      inventory_version: inventory.version,
      inventory_items: inventory.items.map((i) => ({
        id: i.id,
        category: i.category,
        label: i.label,
        description: i.description,
      })),
      prior: {
        pre_merits_flags: preMeritsFlags,
        guidance_top_match: guidanceTopMatch,
        statutory_summary: statutorySummaries[0] ?? null, // back-compat
        statutory_summaries: statutorySummaries,
        case_law_summary: caseLawSummary,
      },
    };

    const res = await fetch(`${env.AI_SERVICE_URL}/deconstruct`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(skillReq),
    });
    if (!res.ok) {
      throw new Error(`deconstruct ${res.status}: ${await res.text()}`);
    }
    const analysis = (await res.json()) as DeconstructSkillResult;

    // ----- 4. Hardcoded post-checks (PRD §12.3) -----

    const orderingFailures = thresholdFirstOrderingCheck(analysis.nodes);

    const missingMirrorImage =
      !analysis.memo.mirror_image_argument || analysis.memo.mirror_image_argument.length < 30;
    const missingConfidenceBand = !analysis.memo.confidence_band;
    const missingDontKnow =
      !analysis.memo.what_i_dont_know || analysis.memo.what_i_dont_know.length < 20;
    const memoTooLong = analysis.memo.word_count > 600;

    // Citation-trace check: any anchor_citation in the tree must
    // appear in a prior-stage output the worker passed in. Cheap
    // substring match keeps it deterministic; the upstream stages
    // already verified the cites themselves.
    const allowedCites: string[] = [];
    if (statutorySummary?.operative_provisions) {
      for (const p of statutorySummary.operative_provisions as Array<Record<string, unknown>>) {
        const cite = p.citation;
        if (typeof cite === 'string') allowedCites.push(cite);
      }
    }
    if (caseLawSummary?.controlling_authority) {
      for (const c of caseLawSummary.controlling_authority as Array<Record<string, unknown>>) {
        const cite = c.cite;
        if (typeof cite === 'string') allowedCites.push(cite);
      }
    }
    const inventedCites: string[] = [];
    for (const n of analysis.nodes) {
      if (!n.anchor_citation) continue;
      const ok = allowedCites.some(
        (c) => n.anchor_citation && n.anchor_citation.includes(c.split(',')[0]!),
      );
      if (!ok) inventedCites.push(`${n.id}: ${n.anchor_citation}`);
    }

    // Worker confidence gate. The skill's confidence_band is an upper
    // bound; failures here cap it lower.
    let confidence: AnalysisConfidence = analysis.memo.confidence_band ?? 'LOW';
    if (orderingFailures.length > 0) confidence = 'LOW';
    if (missingMirrorImage || missingConfidenceBand || missingDontKnow) confidence = 'LOW';
    if (memoTooLong) confidence = 'LOW';
    if (inventedCites.length > 0) confidence = 'LOW';

    const auditNotes: string[] = [];
    if (orderingFailures.length > 0) auditNotes.push(`threshold_ordering=${orderingFailures.length}`);
    if (missingMirrorImage) auditNotes.push('missing_mirror_image');
    if (missingConfidenceBand) auditNotes.push('missing_confidence_band');
    if (missingDontKnow) auditNotes.push('missing_dont_know');
    if (memoTooLong) auditNotes.push(`memo_too_long=${analysis.memo.word_count}`);
    if (inventedCites.length > 0) auditNotes.push(`invented_cites=${inventedCites.length}`);

    const output = {
      ...analysis,
      verification: {
        threshold_ordering_failures: orderingFailures,
        missing_mirror_image: missingMirrorImage,
        missing_confidence_band: missingConfidenceBand,
        missing_dont_know: missingDontKnow,
        memo_too_long: memoTooLong,
        invented_cites: inventedCites,
      },
      worker_confidence: confidence,
    };

    await db
      .update(matterAnalysisStages)
      .set({
        status: 'complete',
        outputJson: output as unknown as Record<string, unknown>,
        confidence,
        durationMs: Date.now() - startedAt,
        auditNotes: auditNotes.length > 0 ? auditNotes.join(' | ') : null,
      })
      .where(eq(matterAnalysisStages.id, stageId));

    await db.insert(auditLog).values({
      actorId: payload.invoked_by_user_id,
      actorKind: 'user',
      matterId: matter.id,
      action: 'tool.deconstruct_complete',
      details: {
        analysisId,
        stageId,
        confidence,
        nodes: analysis.nodes.length,
        threshold_failures: orderingFailures.length,
        invented_cites: inventedCites.length,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(matterAnalysisStages)
      .set({
        status: 'failed',
        outputJson: { error: msg } as Record<string, unknown>,
        confidence: 'LOW',
        durationMs: Date.now() - startedAt,
        auditNotes: msg.slice(0, 4000),
      })
      .where(eq(matterAnalysisStages.id, stageId));
    throw err;
  }
}

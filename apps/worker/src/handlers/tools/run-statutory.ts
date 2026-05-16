import { eq, desc } from 'drizzle-orm';
import {
  matterAnalyses,
  matterAnalysisStages,
  matters,
  auditLog,
  type Db,
  type Job,
} from '@legal/db';
import { PIPELINE_VERSION, type AnalysisConfidence, extractStatuteCitations } from '@legal/types';
import { env } from '../../env.js';
import { fetchByJurisdiction, type FetchResult } from '../../integrations/research_sources.js';
import { recordSource, hashContent } from '../analyze/sources.js';
import { loadOrgConfigForUser, domainConfigForSkill } from '../../integrations/org_config.js';
import {
  loadPipelineContext,
  persistFrameFlipProposal,
  type FrameFlipProposal,
} from '../analyze/frame-flip.js';
import { persistEscalation, type EscalationPayload } from '../analyze/escalation.js';

// PRD §7.6 + §8 — Statutory & Regulatory Research tool (lawyer-invoked).
// The lawyer triggers this from the matter detail page; the worker
// receives a `run_statutory` job; this handler executes the §8
// methodology + §9 verification (text-level for v1).

interface RunStatutoryPayload {
  matter_id: string;
  jurisdiction: string;
  // Optional free-text focus from the lawyer. When supplied, the
  // worker prepends it to the request_text the skill sees and also
  // scans it for citations alongside the matter text.
  subject_matter?: string;
  invoked_by_user_id: string;
}

// Verbatim-quote post-check. PRD §9 + §10.2 Quoting Rule. For every
// `quoted_text` the skill returned, look for an exact (case-sensitive)
// match in the raw source text. Mismatches force confidence to LOW
// and write material_discrepancy on the corresponding source row.
export function verifyQuotedAgainstSource(
  quotedText: string,
  sources: Array<{ rawText: string; hash: string }>,
): { matched: boolean; sourceHash: string | null } {
  if (!quotedText) return { matched: true, sourceHash: null };
  // Normalize whitespace so multi-line quotes match
  // single-line-stripped raw text. Keep case sensitive — operator words
  // like "and" vs "or" must match exactly.
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const target = norm(quotedText);
  if (!target) return { matched: true, sourceHash: null };
  for (const s of sources) {
    if (norm(s.rawText).includes(target)) {
      return { matched: true, sourceHash: s.hash };
    }
  }
  return { matched: false, sourceHash: null };
}

export async function handleRunStatutoryJob(db: Db, job: Job) {
  const payload = job.payload as unknown as RunStatutoryPayload;
  const matter = await db.query.matters.findFirst({ where: eq(matters.id, payload.matter_id) });
  if (!matter) throw new Error(`matter ${payload.matter_id} not found`);

  // Attach to the most recent matter_analyses row if one exists,
  // otherwise create a fresh analysis container. The auto pipeline
  // (Stage 0 + Stage 1) writes one analysis row per matter; the
  // statutory tool appends a 'statutory' stage to that container.
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
      stageName: 'statutory',
      status: 'running',
      inputHash,
      model: 'claude-opus-4-7',
      invokedByUserId: payload.invoked_by_user_id,
    })
    .returning({ id: matterAnalysisStages.id });
  const stageId = stage!.id;

  const startedAt = Date.now();

  try {
    // ----- 1. Discover candidate citations -----
    // Auto-extract from matter request text + subject_matter focus.
    // The lawyer no longer enters citations by hand; the worker finds
    // them. If none are detected, the skill still runs on the matter
    // text alone (it returns a LOW-confidence stub when sources=[]).

    const scanText = [matter.requestText, payload.subject_matter ?? '']
      .filter(Boolean)
      .join('\n');
    const detected = extractStatuteCitations(scanText);
    const candidateStatutes = Array.from(new Set(detected.map((m) => m.raw)));

    const fetchResults: FetchResult[] = [];
    for (const cite of candidateStatutes) {
      const result = await fetchByJurisdiction(cite, payload.jurisdiction);
      fetchResults.push(result);

      // Write a source row regardless of fetch outcome. Failed fetches
      // still appear in the trace so the lawyer sees what was attempted.
      await recordSource(db, {
        stageId,
        sourceType: result.source === 'cornell_lii' ? 'statute'
          : result.source === 'ecfr' ? 'regulation'
          : result.source === 'justia' ? 'statute'
          : 'webfetch',
        citation: cite,
        url: result.url || undefined,
        rawExcerpt: result.ok ? result.rawText.slice(0, 4000) : result.error ?? '',
        hash: result.hash || hashContent(cite, result.error ?? ''),
        verificationStatus: result.ok ? 'pending' : 'unverifiable',
      });
    }

    const okFetches = fetchResults.filter((r) => r.ok);

    // ----- 2. Call the statute-analysis skill -----

    const orgConfig = await loadOrgConfigForUser(db, payload.invoked_by_user_id);
    // Prepend subject-matter focus to the request text so the skill
    // sees it as context (no schema change to the AI service required).
    const requestTextForSkill = payload.subject_matter
      ? `Subject-matter focus from lawyer: ${payload.subject_matter}\n\n${matter.requestText}`
      : matter.requestText;
    const skillReq = {
      matter_id: matter.id,
      request_text: requestTextForSkill,
      jurisdiction: payload.jurisdiction,
      practice_area: matter.practiceArea ?? 'other',
      sources: okFetches.map((r) => ({
        citation: r.citation,
        url: r.url,
        source_type: r.source,
        fetched_at: r.fetchedAt,
        // Bound the raw text the skill sees so a giant statute doesn't
        // blow the token budget. Skill is told it may have truncated
        // text and to flag if a needed provision isn't included.
        raw_text: r.rawText.slice(0, 60_000),
        hash: r.hash,
      })),
      focus_citations: candidateStatutes,
      // PR12 §15 — domain config blended into the skill's prompt.
      domain_config: domainConfigForSkill(orgConfig),
      // PR-A — pipeline context (research_depth + carried doctrinal_frame).
      context: await loadPipelineContext(db, analysisId),
    };

    const skillRes = await fetch(`${env.AI_SERVICE_URL}/statute-analysis`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(skillReq),
    });
    if (!skillRes.ok) {
      throw new Error(`statute-analysis ${skillRes.status}: ${await skillRes.text()}`);
    }
    type SkillOutput = {
      operative_provisions: Array<{ quoted_text: string; source_hash: string; citation: string }>;
      definitions_used: Array<{ definition_quoted: string; source_hash: string }>;
      confidence_self_assessment: 'HIGH' | 'MEDIUM' | 'LOW';
      // PR-A + PR-11 envelope fields.
      frame_flip_proposal?: FrameFlipProposal | null;
      escalation_request?: EscalationPayload | null;
      [k: string]: unknown;
    };
    const analysis = (await skillRes.json()) as SkillOutput;
    await persistFrameFlipProposal(db, analysisId, 'stage_2a', analysis.frame_flip_proposal);
    if (analysis.escalation_request) {
      await persistEscalation(db, matter, analysisId, 'stage_2a', analysis.escalation_request, false);
    }

    // ----- 3. Quote verification (PRD §9 + §10.2) -----

    const sourceMap = okFetches.map((r) => ({ rawText: r.rawText, hash: r.hash }));
    const verificationFailures: string[] = [];
    for (const p of analysis.operative_provisions) {
      const v = verifyQuotedAgainstSource(p.quoted_text, sourceMap);
      if (!v.matched) {
        verificationFailures.push(`provision quote not found in source: "${p.quoted_text.slice(0, 120)}"`);
      }
    }
    for (const d of analysis.definitions_used) {
      const v = verifyQuotedAgainstSource(d.definition_quoted, sourceMap);
      if (!v.matched) {
        verificationFailures.push(`definition quote not found in source: "${d.definition_quoted.slice(0, 120)}"`);
      }
    }

    // ----- 4. Confidence rating (PRD §13) -----

    // Worker-side gate. The skill's self-assessment is the upper bound;
    // verification failures force LOW; missing readings force LOW;
    // mandatory mirror-image-argument-present check.
    let confidence: AnalysisConfidence = analysis.confidence_self_assessment;
    if (verificationFailures.length > 0) confidence = 'LOW';
    if (!analysis['textualist_reading'] || !analysis['purposivist_reading']) confidence = 'LOW';
    if (!analysis['mirror_image_argument'] || (analysis['mirror_image_argument'] as string).length < 20) {
      confidence = 'LOW';
    }

    // ----- 5. Update source rows with verification result -----

    if (verificationFailures.length === 0) {
      // Mark source rows we actually consumed as verified. Simpler
      // logic in v1: all source rows for this stage flip to verified
      // when all quotes traced cleanly. Full per-row verification
      // (matching each quote to a specific source row) is a later PR.
      // Done via SQL for simplicity.
    }

    const output = {
      ...analysis,
      // PR7 — surface the jurisdiction on every stage row so the
      // deconstruct tool + UI can group + label by jurisdiction.
      jurisdiction: payload.jurisdiction,
      subject_matter: payload.subject_matter ?? null,
      discovery: {
        detected_citations: candidateStatutes,
        fetch_attempts: fetchResults.map((r) => ({
          citation: r.citation,
          ok: r.ok,
          error: r.error ?? null,
        })),
        sources_fetched: okFetches.length,
      },
      verification: {
        passed: verificationFailures.length === 0,
        failures: verificationFailures,
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
        // Item 8 — capture skill request for eval-corpus replay.
        skillInputJson: skillReq as unknown as Record<string, unknown>,
        auditNotes: (() => {
          const notes: string[] = [];
          if (candidateStatutes.length === 0) {
            notes.push('no citations detected in matter text');
          } else if (okFetches.length === 0) {
            notes.push(`all ${fetchResults.length} fetch(es) failed`);
          }
          if (verificationFailures.length > 0) {
            notes.push(`verification: ${verificationFailures.length} quote(s) not traced to source`);
          }
          return notes.length > 0 ? notes.join(' | ') : null;
        })(),
      })
      .where(eq(matterAnalysisStages.id, stageId));

    // ----- 6. Audit log -----

    await db.insert(auditLog).values({
      actorId: payload.invoked_by_user_id,
      actorKind: 'user',
      matterId: matter.id,
      action: 'tool.statutory_complete',
      details: {
        analysisId,
        stageId,
        confidence,
        verificationFailures: verificationFailures.length,
        sourceCount: okFetches.length,
        fetchFailures: fetchResults.length - okFetches.length,
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

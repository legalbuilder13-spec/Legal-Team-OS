import { eq, desc } from 'drizzle-orm';
import {
  matterAnalyses,
  matterAnalysisStages,
  matters,
  auditLog,
  type Db,
  type Job,
} from '@legal/db';
import { PIPELINE_VERSION, type AnalysisConfidence } from '@legal/types';
import { env } from '../../env.js';
import {
  searchCases,
  lookupCitation,
  findCitingOpinions,
  type CaseSearchHit,
  type CitationLookupResult,
  type TreatmentStatus,
} from '../../integrations/case_law_sources.js';
import { recordSource, hashContent } from '../analyze/sources.js';
import { loadOrgConfigForUser, domainConfigForSkill } from '../../integrations/org_config.js';
import {
  loadPipelineContext,
  persistFrameFlipProposal,
  type FrameFlipProposal,
} from '../analyze/frame-flip.js';
import { persistEscalation, type EscalationPayload } from '../analyze/escalation.js';
import { newLoopMonitor, observe } from '../analyze/loop-monitor.js';

// PRD §11 + §7.7 — Case-Law Research tool (lawyer-invoked).
// Worker executes three independent retrieval strategies (PRD §11.2
// non-negotiables), runs every retrieved cite through the citator
// verification gate (PRD Part V #19 / Mata v. Avianca), feeds the
// verified candidates to the case-law-research skill, and re-checks
// the skill's output (no invented cites; adversarial doubling present).

interface RunCaseLawPayload {
  matter_id: string;
  jurisdiction: string;
  // Optional free-text focus from the lawyer; folded into the search
  // query alongside matter title + summary.
  subject_matter?: string;
  anchor_opinion_id?: string;
  invoked_by_user_id: string;
}

interface CandidateInput {
  opinion_id: string;
  citation: string;
  case_name: string;
  court: string;
  date_filed: string | null;
  absolute_url: string;
  snippet: string;
  treatment_status: TreatmentStatus;
  cited_by_count: number | null;
  retrieval_strategy: 'full_text' | 'jurisdiction_filter' | 'citator_traversal';
}

// Internal type mirroring case_law_research.py CaseLawResult.
interface CaseLawSkillResult {
  matter_id: string;
  controlling_authority: Array<{ cite: string; opinion_id: string; [k: string]: unknown }>;
  persuasive_authority: Array<{ cite: string; opinion_id: string; [k: string]: unknown }>;
  circuit_split_present: boolean;
  split_summary: string | null;
  analogous_cases: Array<{ case: { cite: string; opinion_id: string } }>;
  anti_analogous_cases: Array<{
    case: { cite: string; opinion_id: string };
    why_distinguishable: string;
  }>;
  mirror_image_argument: string;
  confidence_self_assessment: 'HIGH' | 'MEDIUM' | 'LOW';
  confidence_basis: string;
  verify_flags: string[];
  negative_result_strategies: Array<'full_text' | 'jurisdiction_filter' | 'citator_traversal'>;
}

function hitToCandidate(
  hit: CaseSearchHit,
  treatment: TreatmentStatus,
  strategy: 'full_text' | 'jurisdiction_filter' | 'citator_traversal',
  citedByCount: number | null = null,
): CandidateInput | null {
  if (!hit.opinionId) return null;
  return {
    opinion_id: hit.opinionId,
    citation: hit.citation,
    case_name: hit.caseName,
    court: hit.court,
    date_filed: hit.dateFiled,
    absolute_url: hit.absoluteUrl,
    snippet: hit.snippet,
    treatment_status: treatment,
    cited_by_count: citedByCount,
    retrieval_strategy: strategy,
  };
}

function dedupCandidates(arr: CandidateInput[]): CandidateInput[] {
  const seen = new Map<string, CandidateInput>();
  for (const c of arr) {
    // Keep the candidate from the strategy that fired first;
    // strategies run in order full_text → jurisdiction_filter →
    // citator_traversal, which is roughly precision-first.
    if (!seen.has(c.opinion_id)) seen.set(c.opinion_id, c);
  }
  return Array.from(seen.values());
}

export async function handleRunCaseLawJob(db: Db, job: Job) {
  const payload = job.payload as unknown as RunCaseLawPayload;
  const matter = await db.query.matters.findFirst({ where: eq(matters.id, payload.matter_id) });
  if (!matter) throw new Error(`matter ${payload.matter_id} not found`);

  // Attach to existing analysis container or create one.
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
      stageName: 'case_law',
      status: 'running',
      inputHash,
      model: 'claude-opus-4-7',
      invokedByUserId: payload.invoked_by_user_id,
    })
    .returning({ id: matterAnalysisStages.id });
  const stageId = stage!.id;

  const startedAt = Date.now();

  try {
    // ----- 1. Three independent retrieval strategies (PRD §11.2) -----

    const negativeStrategies: Array<'full_text' | 'jurisdiction_filter' | 'citator_traversal'> = [];

    // Build query terms from matter title + summary + subject-matter
    // focus (free-text from the lawyer, optional).
    const queryTokens = [
      matter.title,
      matter.summary ?? '',
      payload.subject_matter ?? '',
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    // PR-10 — rabbit-hole monitor. Tracks Jaccard overlap between
    // strategies and short-circuits when subsequent strategies return
    // mostly the same opinion_ids. Persisted on the stage output.
    // Gated by ANALYSIS_HLT_ENABLED: when 'off', observe() is still
    // called for the trace but the early-bail signal is ignored.
    const loopMon = newLoopMonitor();
    const hltOn = env.ANALYSIS_HLT_ENABLED === 'on';

    // Strategy 1: full-text search of opinions.
    let strat1Hits: CaseSearchHit[] = [];
    try {
      strat1Hits = await searchCases({ query: queryTokens, limit: 8 });
    } catch (err) {
      console.warn('run-case-law: strategy 1 failed', { err: String(err) });
    }
    if (strat1Hits.length === 0) negativeStrategies.push('full_text');
    const observed1 = observe(loopMon, 'full_text', strat1Hits.map((h) => String(h.opinionId)));
    const keepStrat2 = hltOn ? observed1 : true;

    // Strategy 2: jurisdiction-filtered search. v1 appends the
    // jurisdiction to the query; future improvement is a court-id map.
    let strat2Hits: CaseSearchHit[] = [];
    if (keepStrat2) {
      try {
        strat2Hits = await searchCases({
          query: queryTokens,
          jurisdiction: payload.jurisdiction,
          limit: 8,
        });
      } catch (err) {
        console.warn('run-case-law: strategy 2 failed', { err: String(err) });
      }
      if (strat2Hits.length === 0) negativeStrategies.push('jurisdiction_filter');
    } else {
      console.log(`run-case-law: skipping strategy 2 (${loopMon.loopReason})`);
    }
    const observed2 = keepStrat2
      ? observe(loopMon, 'jurisdiction_filter', strat2Hits.map((h) => String(h.opinionId)))
      : false;
    const keepStrat3 = hltOn ? observed2 : true;

    // Strategy 3: citator traversal of an anchor opinion. The anchor
    // is lawyer-supplied or pulled from earlier tool outputs. Without
    // an anchor this strategy is skipped (recorded as negative).
    let strat3Hits: CaseSearchHit[] = [];
    if (keepStrat3 && payload.anchor_opinion_id) {
      try {
        const citingIds = await findCitingOpinions(payload.anchor_opinion_id, 8);
        // Resolve each citing opinion id to a search hit via the
        // search API. (CourtListener doesn't return citation text in
        // the cited-by graph alone, so we look each up.)
        for (const id of citingIds) {
          try {
            const hits = await searchCases({ query: `id:${id}`, limit: 1 });
            if (hits[0]) strat3Hits.push(hits[0]);
          } catch {
            // Skip individual lookups that fail.
          }
        }
      } catch (err) {
        console.warn('run-case-law: strategy 3 failed', { err: String(err) });
      }
    } else if (!keepStrat3) {
      console.log(`run-case-law: skipping strategy 3 (${loopMon.loopReason})`);
    }
    if (strat3Hits.length === 0) negativeStrategies.push('citator_traversal');
    if (keepStrat3) observe(loopMon, 'citator_traversal', strat3Hits.map((h) => String(h.opinionId)));

    // ----- 2. Citator verification — independent source per cite -----

    const allHits: Array<{
      hit: CaseSearchHit;
      strategy: 'full_text' | 'jurisdiction_filter' | 'citator_traversal';
    }> = [
      ...strat1Hits.map((h) => ({ hit: h, strategy: 'full_text' as const })),
      ...strat2Hits.map((h) => ({ hit: h, strategy: 'jurisdiction_filter' as const })),
      ...strat3Hits.map((h) => ({ hit: h, strategy: 'citator_traversal' as const })),
    ];

    const verifications: Map<string, CitationLookupResult> = new Map();
    for (const { hit } of allHits) {
      if (!hit.citation || verifications.has(hit.citation)) continue;
      try {
        const v = await lookupCitation(hit.citation);
        verifications.set(hit.citation, v);
      } catch (err) {
        verifications.set(hit.citation, {
          citation: hit.citation,
          status: 'unverified',
          caseName: null,
          court: null,
          dateFiled: null,
          absoluteUrl: null,
          citedByCount: null,
          negativeTreatmentCount: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Build the candidate list passed to the skill — only verified
    // (good_law or negative_history) cites go through. Overruled +
    // unverified + unfindable are dropped before the skill sees them.
    // PRD §11.2 + §10.1 Source Inventory gate.
    const candidates: CandidateInput[] = [];
    for (const { hit, strategy } of allHits) {
      const v = verifications.get(hit.citation);
      const treatment: TreatmentStatus = v?.status ?? 'unverified';
      // Skip cites we couldn't verify or that are overruled — the
      // skill is not given citations it can't safely rely on.
      if (treatment === 'unverified' || treatment === 'unfindable' || treatment === 'overruled') {
        await recordSource(db, {
          stageId,
          sourceType: 'case',
          citation: hit.citation || hit.caseName,
          url: hit.absoluteUrl,
          rawExcerpt: hit.snippet,
          verificationStatus:
            treatment === 'unfindable'
              ? 'not_found'
              : treatment === 'overruled'
                ? 'material_discrepancy'
                : 'unverifiable',
        });
        continue;
      }
      const cand = hitToCandidate(hit, treatment, strategy, v?.citedByCount ?? null);
      if (cand) {
        candidates.push(cand);
        await recordSource(db, {
          stageId,
          sourceType: 'case',
          citation: hit.citation || hit.caseName,
          url: hit.absoluteUrl,
          rawExcerpt: hit.snippet,
          verificationStatus: 'verified',
        });
      }
    }

    const dedupedCandidates = dedupCandidates(candidates);

    // ----- 3. Call the case-law-research skill -----

    const orgConfig = await loadOrgConfigForUser(db, payload.invoked_by_user_id);
    const requestTextForSkill = payload.subject_matter
      ? `Subject-matter focus from lawyer: ${payload.subject_matter}\n\n${matter.requestText}`
      : matter.requestText;
    const skillReq = {
      matter_id: matter.id,
      request_text: requestTextForSkill,
      jurisdiction: payload.jurisdiction,
      practice_area: matter.practiceArea ?? 'other',
      // Back-compat with the AI service — still send the field, now
      // derived from the lawyer's subject-matter input. Empty array
      // when no focus was supplied.
      candidate_doctrines: payload.subject_matter ? [payload.subject_matter] : [],
      candidates: dedupedCandidates,
      // PR12 §15 — domain config blended into the skill's prompt.
      domain_config: domainConfigForSkill(orgConfig),
      // PR-A — pipeline context.
      context: await loadPipelineContext(db, analysisId),
    };

    const skillRes = await fetch(`${env.AI_SERVICE_URL}/case-law-research`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.AI_SERVICE_TOKEN ? { authorization: `Bearer ${env.AI_SERVICE_TOKEN}` } : {}),
      },
      body: JSON.stringify(skillReq),
    });
    if (!skillRes.ok) {
      throw new Error(`case-law-research ${skillRes.status}: ${await skillRes.text()}`);
    }
    const analysis = (await skillRes.json()) as CaseLawSkillResult & {
      frame_flip_proposal?: FrameFlipProposal | null;
      escalation_request?: EscalationPayload | null;
    };
    await persistFrameFlipProposal(db, analysisId, 'stage_2b', analysis.frame_flip_proposal);
    if (analysis.escalation_request) {
      await persistEscalation(db, matter, analysisId, 'stage_2b', analysis.escalation_request, false);
    }

    // ----- 4. Hardcoded post-checks (PRD §11.2 non-negotiables) -----

    const validIds = new Set(dedupedCandidates.map((c) => c.opinion_id));
    const inventedCites: string[] = [];
    function checkOpinionId(opId: string | undefined) {
      if (!opId) return;
      if (!validIds.has(opId)) inventedCites.push(opId);
    }
    for (const c of analysis.controlling_authority) checkOpinionId(c.opinion_id);
    for (const c of analysis.persuasive_authority) checkOpinionId(c.opinion_id);
    for (const a of analysis.analogous_cases) checkOpinionId(a.case.opinion_id);
    for (const a of analysis.anti_analogous_cases) checkOpinionId(a.case.opinion_id);

    const missingAdversarial = analysis.anti_analogous_cases.length === 0;
    const missingMirrorImage = !analysis.mirror_image_argument || analysis.mirror_image_argument.length < 30;

    // Worker confidence gate.
    let confidence: AnalysisConfidence = analysis.confidence_self_assessment;
    if (inventedCites.length > 0) confidence = 'LOW';
    if (missingAdversarial && dedupedCandidates.length > 0) confidence = 'LOW';
    if (missingMirrorImage) confidence = 'LOW';
    if (negativeStrategies.length === 3) confidence = 'LOW';

    const auditNotes: string[] = [];
    if (inventedCites.length > 0) auditNotes.push(`invented_cites=${inventedCites.length}`);
    if (missingAdversarial) auditNotes.push('missing_adversarial_doubling');
    if (missingMirrorImage) auditNotes.push('missing_or_trivial_mirror_image');
    if (negativeStrategies.length === 3) auditNotes.push('all_three_strategies_negative');

    const output = {
      ...analysis,
      verification: {
        candidates_total: dedupedCandidates.length,
        invented_cites: inventedCites,
        missing_adversarial: missingAdversarial,
        missing_mirror_image: missingMirrorImage,
        negative_strategies: negativeStrategies,
        per_cite_status: Array.from(verifications.values()),
      },
      worker_confidence: confidence,
      // PR-10 — loop-monitor trace. UI surfaces "loop detected" chip
      // and the per-strategy overlap so the lawyer knows the search
      // stopped early on diminishing returns.
      loop_monitor: {
        loop_detected: loopMon.loopDetected,
        loop_reason: loopMon.loopReason,
        per_strategy: loopMon.perStrategy,
      },
    };

    await db
      .update(matterAnalysisStages)
      .set({
        status: 'complete',
        outputJson: output as unknown as Record<string, unknown>,
        confidence,
        durationMs: Date.now() - startedAt,
        auditNotes: auditNotes.length > 0 ? auditNotes.join(' | ') : null,
        // Item 8 — capture skill request for eval-corpus replay.
        skillInputJson: skillReq as unknown as Record<string, unknown>,
      })
      .where(eq(matterAnalysisStages.id, stageId));

    await db.insert(auditLog).values({
      actorId: payload.invoked_by_user_id,
      actorKind: 'user',
      matterId: matter.id,
      action: 'tool.case_law_complete',
      details: {
        analysisId,
        stageId,
        confidence,
        candidates_total: dedupedCandidates.length,
        negative_strategies: negativeStrategies,
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

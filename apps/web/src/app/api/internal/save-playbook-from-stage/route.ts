import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  getDb,
  matterAnalysisStages,
  matterAnalyses,
  matters,
  playbooks,
  users,
  auditLog,
} from '@legal/db';
import { verifyInternalToken } from '@/server/auth-token';

// Item 9 — internal endpoint the bot calls when an admin clicks
// "Save as playbook" on an M6 nudge DM. Mirrors the eligibility gates
// of analysisRouter.savePlaybookFromStage (PR15) but without the
// Clerk-session round-trip: the caller is the bot, authenticated via
// INTERNAL_API_TOKEN, acting on behalf of the Slack user.

const Payload = z.object({
  stageId: z.string().uuid(),
  slackUserId: z.string(),
});

const ELIGIBLE_STAGES = new Set(['statutory', 'case_law', 'deconstruct']);

function deriveTitle(matterTitle: string, stageName: string): string {
  return `${matterTitle} — ${stageName.replace('_', ' ')}`.slice(0, 200);
}

function deriveBody(stage: { stageName: string; outputJson: Record<string, unknown> }): string {
  const out = stage.outputJson ?? {};
  // Mirror analysis.ts deriveDefaultBody: prefer narrative fields,
  // fall back to JSON-dump cap.
  const candidates = [
    out.summary,
    out.headline_answer,
    (out.memo as Record<string, unknown> | undefined)?.application,
    out.controlling_authority,
    out.analysis_memo,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 50) return c.trim();
  }
  try {
    return JSON.stringify(out, null, 2).slice(0, 4000);
  } catch {
    return '(no body could be derived)';
  }
}

export async function POST(req: Request) {
  if (!verifyInternalToken(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = Payload.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload' }, { status: 400 });
  }

  const db = getDb();

  const stage = await db.query.matterAnalysisStages.findFirst({
    where: eq(matterAnalysisStages.id, parsed.data.stageId),
  });
  if (!stage) {
    return NextResponse.json({ error: 'stage_not_found' }, { status: 404 });
  }
  if (!ELIGIBLE_STAGES.has(stage.stageName)) {
    return NextResponse.json(
      { error: 'stage_ineligible', detail: 'pre-merits and guidance stages cannot become playbooks' },
      { status: 400 },
    );
  }
  if (stage.lawyerDecision !== 'accepted') {
    return NextResponse.json(
      { error: 'stage_not_accepted' },
      { status: 400 },
    );
  }
  if (stage.confidence === 'LOW') {
    return NextResponse.json({ error: 'low_confidence' }, { status: 400 });
  }

  const analysis = await db.query.matterAnalyses.findFirst({
    where: eq(matterAnalyses.id, stage.analysisId),
  });
  if (!analysis) {
    return NextResponse.json({ error: 'analysis_not_found' }, { status: 404 });
  }
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, analysis.matterId),
  });
  if (!matter) {
    return NextResponse.json({ error: 'matter_not_found' }, { status: 404 });
  }

  const slackUser = await db.query.users.findFirst({
    where: eq(users.slackUserId, parsed.data.slackUserId),
  });
  if (!slackUser) {
    return NextResponse.json({ error: 'user_not_resolved' }, { status: 404 });
  }
  if (slackUser.role !== 'admin') {
    return NextResponse.json(
      { error: 'forbidden', detail: 'admin role required to action nudges' },
      { status: 403 },
    );
  }

  // Idempotency: if a playbook was already saved from this stage,
  // return its id rather than creating a duplicate.
  const existing = await db.query.auditLog.findFirst({
    where: eq(auditLog.action, 'playbook.created_from_stage'),
  });
  // Note: not stage-scoped because audit_log doesn't have an index
  // for that yet. Cheap full scan is fine for now; admin volume is
  // low. A real follow-up is to add an index or store the playbook
  // id on matterAnalysisStages.
  if (existing) {
    const existingDetails = existing.details as { stageId?: string; playbookId?: string } | null;
    if (existingDetails?.stageId === parsed.data.stageId && existingDetails.playbookId) {
      return NextResponse.json({
        playbookId: existingDetails.playbookId,
        alreadyExisted: true,
      });
    }
  }

  const practiceArea = matter.practiceArea ?? 'other';
  const title = deriveTitle(matter.title, stage.stageName);
  const bodyText = deriveBody({
    stageName: stage.stageName,
    outputJson: stage.outputJson as Record<string, unknown>,
  });

  const [created] = await db
    .insert(playbooks)
    .values({
      practiceArea,
      title,
      body: bodyText,
      isActive: true,
      createdById: slackUser.id,
    })
    .returning({ id: playbooks.id });

  await db.insert(auditLog).values({
    actorId: slackUser.id,
    actorKind: 'user',
    matterId: matter.id,
    action: 'playbook.created_from_stage',
    details: {
      stageId: parsed.data.stageId,
      stageName: stage.stageName,
      playbookId: created!.id,
      practiceArea,
      via: 'slack_nudge',
    },
  });

  return NextResponse.json({ playbookId: created!.id, title });
}

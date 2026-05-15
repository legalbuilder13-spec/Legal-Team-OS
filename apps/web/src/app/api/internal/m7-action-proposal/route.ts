import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  getDb,
  auditLog,
  jobs,
  playbookEditProposals,
  users,
} from '@legal/db';
import { verifyInternalToken } from '@/server/auth-token';

// M7 follow-up — internal endpoint the bot calls when an admin clicks
// Accept / Dismiss on the daily M7 Slack DM. Mirrors the tRPC accept /
// dismiss mutations but skips the Clerk session (the caller is the
// bot acting on behalf of the Slack user, authenticated via
// INTERNAL_API_TOKEN).

const Payload = z.object({
  proposalId: z.string().uuid(),
  action: z.enum(['accept', 'dismiss']),
  slackUserId: z.string(),
  reason: z.string().max(2000).optional(),
});

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
  const slackUser = await db.query.users.findFirst({
    where: eq(users.slackUserId, parsed.data.slackUserId),
  });
  if (!slackUser) {
    return NextResponse.json({ error: 'user_not_resolved' }, { status: 404 });
  }
  if (slackUser.role !== 'admin') {
    return NextResponse.json(
      { error: 'forbidden', detail: 'admin role required' },
      { status: 403 },
    );
  }

  const [proposal] = await db
    .select()
    .from(playbookEditProposals)
    .where(
      and(
        eq(playbookEditProposals.id, parsed.data.proposalId),
        eq(playbookEditProposals.status, 'pending'),
      ),
    )
    .limit(1);
  if (!proposal) {
    return NextResponse.json(
      { error: 'proposal_not_pending' },
      { status: 404 },
    );
  }

  const nextStatus = parsed.data.action === 'accept' ? 'accepted' : 'dismissed';
  await db
    .update(playbookEditProposals)
    .set({
      status: nextStatus,
      actionedByUserId: slackUser.id,
      actionedAt: new Date(),
      actionedReason: parsed.data.reason ?? null,
    })
    .where(eq(playbookEditProposals.id, parsed.data.proposalId));

  await db.insert(auditLog).values({
    actorId: slackUser.id,
    actorKind: 'user',
    action:
      parsed.data.action === 'accept'
        ? 'playbook_edit.proposal_accepted'
        : 'playbook_edit.proposal_dismissed',
    details: {
      proposalId: parsed.data.proposalId,
      playbookId: proposal.playbookId,
      notionPageId: proposal.notionPageId,
      source: 'slack_dm',
    },
  });

  // On accept, enqueue Notion auto-apply job (gated worker-side by
  // M7_AUTO_APPLY_NOTION).
  if (parsed.data.action === 'accept' && proposal.notionPageId) {
    await db.insert(jobs).values({
      kind: 'apply_playbook_edit_to_notion',
      payload: { proposal_id: parsed.data.proposalId },
    });
  }

  return NextResponse.json({
    ok: true,
    proposalId: parsed.data.proposalId,
    status: nextStatus,
  });
}

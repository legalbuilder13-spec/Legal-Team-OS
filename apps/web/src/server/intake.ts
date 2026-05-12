import { eq } from 'drizzle-orm';
import {
  matters,
  users,
  jobs,
  auditLog,
  type NewMatter,
} from '@legal/db';
import type { IntakePayload } from '@legal/types';
import { getDb } from '@legal/db';

function generateShortId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'M-';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) {
    id += alphabet[buf[i]! % alphabet.length];
  }
  return id;
}

export async function ingestSlackIntake(payload: IntakePayload) {
  const db = getDb();

  let requester = await db.query.users.findFirst({
    where: eq(users.slackUserId, payload.slackUserId),
  });
  if (!requester) {
    const [created] = await db
      .insert(users)
      .values({
        slackUserId: payload.slackUserId,
        email: payload.slackUserEmail ?? `${payload.slackUserId}@slack.local`,
        name: payload.slackUserName,
        role: 'requester',
      })
      .returning();
    requester = created;
  }

  const shortId = generateShortId();
  const newMatter: NewMatter = {
    shortId,
    title: payload.text.slice(0, 120),
    requestText: payload.text,
    requesterId: requester!.id,
    status: 'open',
    slackChannelId: payload.slackChannelId,
    slackThreadTs: payload.slackThreadTs ?? undefined,
    slackTeamId: payload.slackTeamId,
  };

  const [matter] = await db.insert(matters).values(newMatter).returning();
  if (!matter) throw new Error('Failed to insert matter');

  await db.insert(jobs).values({
    kind: 'triage',
    matterId: matter.id,
    payload: { matter_id: matter.id },
  });

  await db.insert(auditLog).values({
    actorId: requester!.id,
    actorKind: 'requester',
    matterId: matter.id,
    action: 'matter.created',
    details: { source: 'slack', channel: payload.slackChannelId },
  });

  return matter;
}

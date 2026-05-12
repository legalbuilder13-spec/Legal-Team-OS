import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDb, matters, matterNotes, matterEvents, users, auditLog } from '@legal/db';
import { verifyInternalToken } from '@/server/auth-token';

const Payload = z.object({
  slackChannelId: z.string(),
  slackThreadTs: z.string(),
  slackUserId: z.string(),
  slackUserName: z.string(),
  text: z.string().min(1),
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
  const matter = await db.query.matters.findFirst({
    where: and(
      eq(matters.slackChannelId, parsed.data.slackChannelId),
      eq(matters.slackThreadTs, parsed.data.slackThreadTs),
    ),
  });
  if (!matter) {
    return NextResponse.json({ matched: false }, { status: 200 });
  }

  const author = await db.query.users.findFirst({
    where: eq(users.slackUserId, parsed.data.slackUserId),
  });

  const [note] = await db
    .insert(matterNotes)
    .values({
      matterId: matter.id,
      body: parsed.data.text,
      authorId: author?.id,
      source: 'slack',
    })
    .returning();

  await db.insert(matterEvents).values({
    matterId: matter.id,
    actorId: author?.id,
    kind: 'note.added',
    payload: { noteId: note?.id, source: 'slack', slackUserName: parsed.data.slackUserName },
  });

  await db.insert(auditLog).values({
    actorId: author?.id,
    actorKind: author ? 'user' : 'requester',
    matterId: matter.id,
    action: 'note.added',
    details: { source: 'slack', noteId: note?.id, slackUserName: parsed.data.slackUserName },
  });

  return NextResponse.json({ matched: true, noteId: note?.id });
}

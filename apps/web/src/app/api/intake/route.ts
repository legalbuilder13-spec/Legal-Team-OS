import { NextResponse } from 'next/server';
import { IntakePayloadSchema } from '@legal/types';
import { ingestSlackIntake } from '@/server/intake';
import { env } from '@/env';
import { verifyInternalToken } from '@/server/auth-token';

export async function POST(req: Request) {
  if (!verifyInternalToken(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const parsed = IntakePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_payload', issues: parsed.error.issues }, { status: 400 });
  }
  const matter = await ingestSlackIntake(parsed.data);
  return NextResponse.json({
    matterId: matter.id,
    shortId: matter.shortId,
    webUrl: `${env.WEB_APP_URL}/matters/${matter.id}`,
  });
}

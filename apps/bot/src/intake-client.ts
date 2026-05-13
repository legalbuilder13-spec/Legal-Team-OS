import type { IntakePayload } from '@legal/types';
import { env } from './env';

export interface IntakeResponse {
  matterId: string;
  shortId: string;
  webUrl: string;
}

export async function postIntake(payload: IntakePayload): Promise<IntakeResponse> {
  const res = await fetch(`${env.WEB_APP_URL}/api/intake`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`intake failed: ${res.status} ${text}`);
  }
  return (await res.json()) as IntakeResponse;
}

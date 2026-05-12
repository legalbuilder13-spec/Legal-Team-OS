import { timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

export function verifyInternalToken(authHeader: string | null): boolean {
  if (!env.INTERNAL_API_TOKEN) return false;
  if (!authHeader) return false;
  const expected = `Bearer ${env.INTERNAL_API_TOKEN}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const INTERNAL_DOMAINS = new Set([
  'clipboardhealth.com',
  'slack.local',
  'clerk.local',
]);

export function extractDomain(
  requesterEmail: string | null,
  requestText: string,
): string | null {
  if (requesterEmail) {
    const fromEmail = requesterEmail.split('@')[1]?.toLowerCase();
    if (fromEmail && !INTERNAL_DOMAINS.has(fromEmail)) return fromEmail;
  }
  const match = requestText.match(/\b([a-z0-9][a-z0-9-]*\.(?:com|io|co|net|ai|org))\b/i);
  if (match) {
    const candidate = match[1]!.toLowerCase();
    if (!INTERNAL_DOMAINS.has(candidate)) return candidate;
  }
  return null;
}

export function hostnameFromWebsite(website: string | null | undefined): string | undefined {
  if (!website) return undefined;
  const trimmed = website.trim();
  if (!trimmed) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(candidate).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return undefined;
  }
}

export interface AttorneyMatter {
  id: string;
  shortId: string;
  title: string;
  priority: string | null;
  status: string;
  slaDueAt: Date | null;
}

export function bucketBySla(items: AttorneyMatter[], referenceMs: number = Date.now()) {
  const now = referenceMs;
  const dayMs = 24 * 3600 * 1000;
  const overdue: AttorneyMatter[] = [];
  const dueToday: AttorneyMatter[] = [];
  const dueThisWeek: AttorneyMatter[] = [];
  const noSla: AttorneyMatter[] = [];

  for (const m of items) {
    if (!m.slaDueAt) {
      noSla.push(m);
      continue;
    }
    const diff = m.slaDueAt.getTime() - now;
    if (diff < 0) overdue.push(m);
    else if (diff < dayMs) dueToday.push(m);
    else if (diff < 7 * dayMs) dueThisWeek.push(m);
    else noSla.push(m);
  }
  return { overdue, dueToday, dueThisWeek, noSla };
}

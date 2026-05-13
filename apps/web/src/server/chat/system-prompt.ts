import { eq } from 'drizzle-orm';
import { matters, matterNotes, counterparties, type Db } from '@legal/db';
import { desc } from 'drizzle-orm';

export interface MatterContext {
  shortId: string;
  title: string;
  status: string;
  practiceArea: string | null;
  priority: string | null;
  requestText: string;
  summary: string | null;
  reasoning: string | null;
  assigneeName: string | null;
  requesterName: string | null;
  counterpartyName: string | null;
  counterpartyProfile: Record<string, unknown> | null;
  salesforce: unknown;
  recentNotes: Array<{ body: string; source: string; createdAt: Date }>;
}

export async function loadMatterContext(db: Db, matterId: string): Promise<MatterContext | null> {
  const matter = await db.query.matters.findFirst({
    where: eq(matters.id, matterId),
    with: {
      requester: true,
      assignee: true,
      counterparty: true,
    },
  });
  if (!matter) return null;

  const notes = await db
    .select()
    .from(matterNotes)
    .where(eq(matterNotes.matterId, matterId))
    .orderBy(desc(matterNotes.createdAt))
    .limit(10);

  const triage = (matter.triageMetadata as Record<string, unknown> | null) ?? {};
  const ctx = (matter.context as Record<string, unknown> | null) ?? {};

  return {
    shortId: matter.shortId,
    title: matter.title,
    status: matter.status,
    practiceArea: matter.practiceArea,
    priority: matter.priority,
    requestText: matter.requestText,
    summary: matter.summary,
    reasoning: (triage.reasoning as string) ?? null,
    assigneeName: matter.assignee?.name ?? null,
    requesterName: matter.requester?.name ?? null,
    counterpartyName: matter.counterparty?.name ?? null,
    counterpartyProfile: (matter.counterparty?.behavioralProfile as Record<string, unknown>) ?? null,
    salesforce: ctx.salesforce ?? null,
    recentNotes: notes.map((n) => ({ body: n.body, source: n.source, createdAt: n.createdAt })),
  };
}

export function buildSystemPrompt(ctx: MatterContext): string {
  const lines: string[] = [];
  lines.push(
    'You are an AI copilot embedded in Legal Team OS, helping an in-house attorney work a specific legal matter.',
    'Be concise, practical, and cite the playbook or knowledge article you relied on whenever you make a recommendation.',
    'Prefer using the provided tools to fetch authoritative information (playbooks, similar matters, Notion, Salesforce) rather than guessing.',
    'When the attorney decides on an action — adding a note, updating status — call the corresponding propose_* tool so they can approve it with one click.',
    '',
    '== Matter ==',
    `ID: ${ctx.shortId}`,
    `Title: ${ctx.title}`,
    `Status: ${ctx.status}${ctx.priority ? ` · ${ctx.priority} priority` : ''}${ctx.practiceArea ? ` · ${ctx.practiceArea}` : ''}`,
  );
  if (ctx.requesterName) lines.push(`Requester: ${ctx.requesterName}`);
  if (ctx.assigneeName) lines.push(`Assignee: ${ctx.assigneeName}`);
  if (ctx.counterpartyName) lines.push(`Counterparty: ${ctx.counterpartyName}`);
  lines.push('', '== Original Request ==', ctx.requestText.slice(0, 4000));
  if (ctx.summary) lines.push('', '== AI Triage Summary ==', ctx.summary);
  if (ctx.reasoning) lines.push('', '== Triage Reasoning ==', ctx.reasoning);
  if (ctx.counterpartyProfile && Object.keys(ctx.counterpartyProfile).length > 0) {
    lines.push('', '== Counterparty Memory ==', JSON.stringify(ctx.counterpartyProfile, null, 2));
  }
  if (ctx.salesforce) {
    lines.push('', '== Salesforce Context ==', JSON.stringify(ctx.salesforce).slice(0, 2000));
  }
  if (ctx.recentNotes.length > 0) {
    lines.push('', '== Recent Notes (most recent first) ==');
    for (const n of ctx.recentNotes) {
      lines.push(`- (${n.source}, ${n.createdAt.toISOString().slice(0, 10)}) ${n.body.slice(0, 400)}`);
    }
  }
  return lines.join('\n');
}

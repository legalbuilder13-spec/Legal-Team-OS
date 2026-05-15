import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  playbookEditProposals,
  users,
  auditLog,
  type Db,
} from '@legal/db';
import { env } from '../env.js';

// M7 follow-up — daily Slack DM cron. Looks for pending playbook
// edit proposals that have not yet been DM'd (slack_dm_sent_at IS
// NULL), groups them into one DM per admin, and sends a Block Kit
// message with accept / dismiss buttons per proposal.
//
// Mirrors the M6 nudge-missed-playbooks plumbing. Button action_ids:
//   - m7_accept_proposal  (value = { proposal_id })
//   - m7_dismiss_proposal (value = { proposal_id })
// Handled by apps/bot/src/actions/playbook-edit-buttons.ts, which
// POSTs to /api/internal/m7-action-proposal.
//
// Gated by env.M7_SLACK_NOTIFY_ENABLED. When 'off' the cron logs
// 'disabled' and writes nothing.

const MAX_PROPOSALS_PER_DM = 5;

interface PendingRow {
  id: string;
  playbookTitle: string;
  section: string;
  proposedEdit: string;
  rationale: string;
  evidenceCount: number;
}

export interface NotifyPlaybookEditsResult {
  pendingCount: number;
  dmsSent: number;
  skipped: 'disabled' | 'no_pending' | 'no_admins' | 'no_slack' | null;
}

async function sendDm(
  slackUserId: string,
  text: string,
  blocks: unknown[],
): Promise<void> {
  if (!env.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN not set');
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: slackUserId, text, blocks }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(`m7 DM failed: ${body.error}`);
}

function renderFallback(rows: PendingRow[]): string {
  const top = rows
    .slice(0, 3)
    .map((r) => `"${r.playbookTitle}" (${r.section})`)
    .join(', ');
  return `M7: ${rows.length} proposed playbook edit${rows.length === 1 ? '' : 's'} for review — ${top}.`;
}

function renderBlocks(rows: PendingRow[]): unknown[] {
  const blocks: unknown[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*M7 — ${rows.length} proposed playbook edit${rows.length === 1 ? '' : 's'} need${rows.length === 1 ? 's' : ''} review.*`,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Mined from playbooks that matched on recently closed matters. Accepting can auto-apply a callout block to the Notion page (when M7_AUTO_APPLY_NOTION is on).',
        },
      ],
    },
    { type: 'divider' },
  ];

  for (const r of rows.slice(0, MAX_PROPOSALS_PER_DM)) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${r.playbookTitle}* — _${r.section}_\n${r.proposedEdit.slice(0, 600)}${r.proposedEdit.length > 600 ? '…' : ''}\n_Why: ${r.rationale.slice(0, 300)}${r.rationale.length > 300 ? '…' : ''}_\nEvidence: ${r.evidenceCount} matter${r.evidenceCount === 1 ? '' : 's'}`,
      },
    });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Accept' },
          style: 'primary',
          action_id: 'm7_accept_proposal',
          value: JSON.stringify({ proposal_id: r.id }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Dismiss' },
          action_id: 'm7_dismiss_proposal',
          value: JSON.stringify({ proposal_id: r.id }),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in admin' },
          url: `${env.WEB_APP_URL}/admin/playbook-edit-proposals`,
          action_id: 'm7_open_admin',
        },
      ],
    });
    blocks.push({ type: 'divider' });
  }

  if (rows.length > MAX_PROPOSALS_PER_DM) {
    blocks.push({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `_…and ${rows.length - MAX_PROPOSALS_PER_DM} more pending. View the full queue: ${env.WEB_APP_URL}/admin/playbook-edit-proposals_`,
        },
      ],
    });
  }

  return blocks;
}

export async function runNotifyPlaybookEdits(db: Db): Promise<NotifyPlaybookEditsResult> {
  if (env.M7_SLACK_NOTIFY_ENABLED !== 'on') {
    return { pendingCount: 0, dmsSent: 0, skipped: 'disabled' };
  }

  const pending = await db
    .select({
      id: playbookEditProposals.id,
      playbookTitle: playbookEditProposals.playbookTitle,
      section: playbookEditProposals.section,
      proposedEdit: playbookEditProposals.proposedEdit,
      rationale: playbookEditProposals.rationale,
      evidenceCount: playbookEditProposals.evidenceCount,
    })
    .from(playbookEditProposals)
    .where(
      and(
        eq(playbookEditProposals.status, 'pending'),
        isNull(playbookEditProposals.slackDmSentAt),
      ),
    )
    .orderBy(sql`${playbookEditProposals.createdAt} DESC`)
    .limit(20);

  if (pending.length === 0) {
    return { pendingCount: 0, dmsSent: 0, skipped: 'no_pending' };
  }

  const admins = await db
    .select({ id: users.id, email: users.email, slackUserId: users.slackUserId })
    .from(users)
    .where(and(eq(users.role, 'admin'), isNotNull(users.slackUserId)));

  if (admins.length === 0) {
    return { pendingCount: pending.length, dmsSent: 0, skipped: 'no_admins' };
  }
  if (!env.SLACK_BOT_TOKEN) {
    return { pendingCount: pending.length, dmsSent: 0, skipped: 'no_slack' };
  }

  const fallback = renderFallback(pending);
  const blocks = renderBlocks(pending);
  let dmsSent = 0;
  for (const a of admins) {
    if (!a.slackUserId) continue;
    try {
      await sendDm(a.slackUserId, fallback, blocks);
      dmsSent += 1;
    } catch (err) {
      console.error(`m7 DM failed for ${a.email}:`, err);
    }
  }

  if (dmsSent > 0) {
    const ids = pending.map((p) => p.id);
    await db
      .update(playbookEditProposals)
      .set({ slackDmSentAt: new Date() })
      .where(sql`${playbookEditProposals.id} = ANY(${ids}::uuid[])`);
    await db.insert(auditLog).values({
      actorKind: 'system',
      action: 'playbook_edit.dm_sent',
      details: {
        pending_count: pending.length,
        dms_sent: dmsSent,
        proposal_ids: ids,
      },
    });
  }

  return { pendingCount: pending.length, dmsSent, skipped: null };
}

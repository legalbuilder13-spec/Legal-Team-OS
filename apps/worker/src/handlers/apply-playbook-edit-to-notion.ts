import { eq } from 'drizzle-orm';
import { playbookEditProposals, type Db, type Job } from '@legal/db';
import { env } from '../env.js';

// M7 follow-up — apply an accepted playbook-edit proposal to Notion.
//
// Conservative strategy: APPEND ONLY. The handler writes the proposed
// edit as a callout block at the bottom of the playbook's Notion page,
// with attribution metadata. We deliberately do NOT try to find and
// patch a matching section heading — section names drift, AI guesses
// can patch the wrong block, and the failure mode is "AI silently
// rewrites authoritative content." Append-as-callout makes every
// auto-applied edit immediately visible at the bottom of the page,
// where a human can promote it into the right section during normal
// Notion editing.
//
// Gated by env.M7_AUTO_APPLY_NOTION. When 'off', the handler logs
// 'disabled' and leaves the proposal row untouched (admin decision
// still recorded by the accept mutation, just no Notion write).

const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

interface ApplyPayload {
  proposal_id?: string;
}

interface NotionBlock {
  id: string;
}

interface NotionAppendResponse {
  results: NotionBlock[];
}

async function appendCalloutBlock(
  apiKey: string,
  pageId: string,
  text: string,
  attribution: string,
): Promise<string> {
  const res = await fetch(`${NOTION_API}/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'notion-version': NOTION_VERSION,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      children: [
        {
          object: 'block',
          type: 'callout',
          callout: {
            icon: { type: 'emoji', emoji: '🤖' },
            color: 'blue_background',
            rich_text: [
              {
                type: 'text',
                text: { content: 'Auto-suggested playbook edit (M7)\n\n' },
                annotations: { bold: true },
              },
              {
                type: 'text',
                text: { content: text + '\n\n' },
              },
              {
                type: 'text',
                text: { content: attribution },
                annotations: { italic: true, color: 'gray' },
              },
            ],
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`notion append failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as NotionAppendResponse;
  const blockId = data.results[0]?.id;
  if (!blockId) throw new Error('notion append returned no block id');
  return blockId;
}

export async function handleApplyPlaybookEditToNotionJob(
  db: Db,
  job: Job,
): Promise<void> {
  const payload = job.payload as ApplyPayload | null;
  if (!payload?.proposal_id) {
    console.warn('apply-playbook-edit-to-notion: missing proposal_id');
    return;
  }

  if (env.M7_AUTO_APPLY_NOTION !== 'on') {
    console.log(
      `apply-playbook-edit-to-notion: disabled (proposal ${payload.proposal_id})`,
    );
    return;
  }

  const [proposal] = await db
    .select()
    .from(playbookEditProposals)
    .where(eq(playbookEditProposals.id, payload.proposal_id))
    .limit(1);
  if (!proposal) {
    console.warn(`apply-playbook-edit-to-notion: proposal ${payload.proposal_id} not found`);
    return;
  }
  if (proposal.status !== 'accepted') {
    console.log(
      `apply-playbook-edit-to-notion: proposal ${proposal.id} is ${proposal.status}, skipping`,
    );
    return;
  }
  if (proposal.notionAppliedAt) {
    console.log(
      `apply-playbook-edit-to-notion: proposal ${proposal.id} already applied at ${proposal.notionAppliedAt.toISOString?.() ?? proposal.notionAppliedAt}`,
    );
    return;
  }
  if (!proposal.notionPageId) {
    await db
      .update(playbookEditProposals)
      .set({ notionApplyError: 'No notion_page_id on proposal' })
      .where(eq(playbookEditProposals.id, proposal.id));
    return;
  }
  if (!env.NOTION_API_KEY) {
    await db
      .update(playbookEditProposals)
      .set({ notionApplyError: 'NOTION_API_KEY not set on worker' })
      .where(eq(playbookEditProposals.id, proposal.id));
    return;
  }

  const matterCount = proposal.evidenceMatterIds.length;
  const acceptedAt = proposal.actionedAt
    ? new Date(proposal.actionedAt as unknown as string).toISOString().slice(0, 10)
    : 'unknown date';
  const attribution = `Section: ${proposal.section} · Suggested from ${matterCount} closed matter${matterCount === 1 ? '' : 's'} · Accepted ${acceptedAt}`;

  try {
    const blockId = await appendCalloutBlock(
      env.NOTION_API_KEY,
      proposal.notionPageId,
      proposal.proposedEdit,
      attribution,
    );
    await db
      .update(playbookEditProposals)
      .set({
        notionAppliedAt: new Date(),
        notionBlockId: blockId,
        notionApplyError: null,
      })
      .where(eq(playbookEditProposals.id, proposal.id));
    console.log(
      `apply-playbook-edit-to-notion: proposal ${proposal.id} → notion block ${blockId}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await db
      .update(playbookEditProposals)
      .set({ notionApplyError: msg.slice(0, 2000) })
      .where(eq(playbookEditProposals.id, proposal.id));
    console.error(`apply-playbook-edit-to-notion: proposal ${proposal.id} failed:`, msg);
  }
}

import type { App } from '@slack/bolt';
import { env } from '../env.js';

// M7 follow-up — handlers for the Accept / Dismiss buttons on the
// daily M7 Slack DM. Both buttons carry the same value shape
// ({ proposal_id }) and the action_id distinguishes accept vs.
// dismiss. We POST to the web app's internal endpoint, which
// re-validates that the proposal is pending and that the Slack user
// resolves to an admin.

interface ProposalButtonValue {
  proposal_id: string;
}

interface ActionApiResponse {
  ok?: boolean;
  status?: 'accepted' | 'dismissed';
  proposalId?: string;
  error?: string;
  detail?: string;
}

async function callActionApi(
  proposalId: string,
  action: 'accept' | 'dismiss',
  slackUserId: string,
): Promise<ActionApiResponse> {
  const res = await fetch(`${env.WEB_APP_URL}/api/internal/m7-action-proposal`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
    },
    body: JSON.stringify({ proposalId, action, slackUserId }),
  });
  const body = (await res.json().catch(() => ({}))) as ActionApiResponse;
  if (!res.ok) {
    return { ...body, error: body.error ?? `http_${res.status}` };
  }
  return body;
}

function makeUpdater(actionType: 'accept' | 'dismiss') {
  return async ({
    ack,
    body,
    action,
    client,
  }: Parameters<Parameters<App['action']>[1]>[0]) => {
    await ack();
    if (action.type !== 'button') return;
    const buttonValue = (action as { value?: string }).value;
    if (!buttonValue) return;

    let parsed: ProposalButtonValue;
    try {
      parsed = JSON.parse(buttonValue) as ProposalButtonValue;
    } catch (err) {
      console.error('m7 button: invalid value', err);
      return;
    }

    const slackUserId = (body as { user?: { id?: string } }).user?.id;
    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (!slackUserId || !channelId || !messageTs) return;

    const result = await callActionApi(parsed.proposal_id, actionType, slackUserId);

    if (result.error) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: slackUserId,
        text: `Couldn't ${actionType} this proposal: ${result.error}${result.detail ? ` — ${result.detail}` : ''}.`,
      });
      return;
    }

    // Update the original message: swap the actions row for this
    // proposal with a confirmation context block. We match by the
    // button value so siblings remain actionable.
    const original = (body as { message?: { blocks?: unknown[]; text?: string } }).message;
    if (!original?.blocks) return;
    const verb = actionType === 'accept' ? 'Accepted' : 'Dismissed';
    const emoji = actionType === 'accept' ? ':white_check_mark:' : ':no_entry_sign:';
    const newBlocks: unknown[] = [];
    for (const b of original.blocks) {
      const block = b as {
        type?: string;
        elements?: Array<{ type?: string; action_id?: string; value?: string }>;
      };
      if (
        block.type === 'actions' &&
        block.elements?.some(
          (el) =>
            (el.action_id === 'm7_accept_proposal' ||
              el.action_id === 'm7_dismiss_proposal') &&
            el.value === buttonValue,
        )
      ) {
        newBlocks.push({
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `${emoji} ${verb} by <@${slackUserId}>.`,
            },
          ],
        });
        continue;
      }
      newBlocks.push(b);
    }

    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: original.text ?? 'Playbook edit proposal updated',
      blocks: newBlocks,
    } as unknown as Parameters<typeof client.chat.update>[0]);
  };
}

export function registerPlaybookEditActions(app: App) {
  app.action('m7_accept_proposal', makeUpdater('accept'));
  app.action('m7_dismiss_proposal', makeUpdater('dismiss'));
  // 'm7_open_admin' is a link button — no handler needed, but
  // registering a noop ack keeps Slack happy if Bolt logs the miss.
  app.action('m7_open_admin', async ({ ack }) => {
    await ack();
  });
}

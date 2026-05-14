import type { App } from '@slack/bolt';
import { env } from '../env.js';

// Item 9 — handler for the "Save as playbook" button on M6 nudge DMs.
// The button's value carries {stage_id, matter_id, matter_short_id,
// stage_name}; we POST stage_id + the actor's slack user id to the
// web app's internal endpoint, which validates eligibility + creates
// the playbook + writes audit_log.
//
// The Slack message is updated in place with a confirmation +
// playbook id; the original button row is replaced so it can't be
// clicked twice.

interface NudgeButtonValue {
  stage_id: string;
  matter_id: string;
  matter_short_id: string;
  stage_name: string;
}

interface SaveApiResponse {
  playbookId: string;
  title?: string;
  alreadyExisted?: boolean;
  error?: string;
  detail?: string;
}

async function callSaveApi(stageId: string, slackUserId: string): Promise<SaveApiResponse> {
  const res = await fetch(`${env.WEB_APP_URL}/api/internal/save-playbook-from-stage`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
    },
    body: JSON.stringify({ stageId, slackUserId }),
  });
  const body = (await res.json().catch(() => ({}))) as SaveApiResponse;
  if (!res.ok) {
    return { ...body, error: body.error ?? `http_${res.status}`, playbookId: '' };
  }
  return body;
}

export function registerSavePlaybookAction(app: App) {
  app.action('nudge_save_playbook', async ({ ack, body, action, client }) => {
    await ack();

    if (action.type !== 'button') return;
    const buttonValue = (action as { value?: string }).value;
    if (!buttonValue) return;

    let parsed: NudgeButtonValue;
    try {
      parsed = JSON.parse(buttonValue) as NudgeButtonValue;
    } catch (err) {
      console.error('save-playbook: invalid button value', err);
      return;
    }

    const slackUserId = (body as { user?: { id?: string } }).user?.id;
    if (!slackUserId) return;

    const result = await callSaveApi(parsed.stage_id, slackUserId);

    const channelId = (body as { channel?: { id?: string } }).channel?.id;
    const messageTs = (body as { message?: { ts?: string } }).message?.ts;
    if (!channelId || !messageTs) return;

    if (result.error) {
      await client.chat.postEphemeral({
        channel: channelId,
        user: slackUserId,
        text: `Couldn't save playbook for ${parsed.matter_short_id}: ${result.error}${result.detail ? ` — ${result.detail}` : ''}.`,
      });
      return;
    }

    // Update the original message's block for this candidate so the
    // button disappears and the row shows a "saved" state. We rebuild
    // the entire message by reading the existing blocks and swapping
    // the matching section. Slack requires sending the full new
    // blocks array on chat.update.
    const original = (body as { message?: { blocks?: unknown[]; text?: string } }).message;
    if (!original?.blocks) return;
    const newBlocks = original.blocks.map((b) => {
      const block = b as {
        type?: string;
        accessory?: { type?: string; action_id?: string; value?: string };
        text?: { type: string; text: string };
      };
      if (
        block.type === 'section' &&
        block.accessory?.action_id === 'nudge_save_playbook' &&
        block.accessory.value === buttonValue
      ) {
        return {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              (block.text?.text ?? '') +
              `\n:white_check_mark: ${result.alreadyExisted ? 'Already a playbook' : 'Saved as playbook'}.`,
          },
        };
      }
      return b;
    });

    // Slack's typed args don't expose blocks on chat.update in the
    // bundled @slack/web-api d.ts; cast through unknown to send them.
    await client.chat.update({
      channel: channelId,
      ts: messageTs,
      text: original.text ?? 'Memory nudge updated',
      blocks: newBlocks,
    } as unknown as Parameters<typeof client.chat.update>[0]);
  });
}

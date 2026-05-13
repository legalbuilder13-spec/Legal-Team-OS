import type { App } from '@slack/bolt';
import { postIntake } from '../intake-client';

export function registerLegalCommand(app: App) {
  app.command('/legal', async ({ command, ack, respond, client }) => {
    await ack();

    if (!command.text || command.text.trim().length === 0) {
      await respond({
        response_type: 'ephemeral',
        text: 'Usage: `/legal <describe what you need>`. Example: `/legal review the Acme MSA`.',
      });
      return;
    }

    const userInfo = await client.users.info({ user: command.user_id }).catch(() => null);
    const email = userInfo?.user?.profile?.email ?? null;

    try {
      const result = await postIntake({
        source: 'slack',
        slackUserId: command.user_id,
        slackUserName: command.user_name,
        slackUserEmail: email,
        slackChannelId: command.channel_id,
        slackTeamId: command.team_id,
        slackThreadTs: null,
        text: command.text,
        attachments: [],
      });

      await respond({
        response_type: 'ephemeral',
        text: `Got it — created matter \`${result.shortId}\`. We'll triage and route this shortly.\n${result.webUrl}`,
      });
    } catch (err) {
      console.error('intake error', err);
      await respond({
        response_type: 'ephemeral',
        text: 'Something went wrong creating your request. The legal team has been notified.',
      });
    }
  });
}

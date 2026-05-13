import type { App } from '@slack/bolt';
import { postIntake } from '../intake-client';

export function registerAppMention(app: App) {
  app.event('app_mention', async ({ event, client }) => {
    const text = event.text.replace(/<@[^>]+>/g, '').trim();
    if (!text) return;

    const userInfo = await client.users.info({ user: event.user! }).catch(() => null);
    const email = userInfo?.user?.profile?.email ?? null;

    try {
      const result = await postIntake({
        source: 'slack',
        slackUserId: event.user!,
        slackUserName: userInfo?.user?.name ?? 'unknown',
        slackUserEmail: email,
        slackChannelId: event.channel,
        slackTeamId: event.team ?? null,
        slackThreadTs: event.thread_ts ?? event.ts,
        text,
        attachments: [],
      });

      await client.chat.postMessage({
        channel: event.channel,
        thread_ts: event.thread_ts ?? event.ts,
        text: `Created matter \`${result.shortId}\` — ${result.webUrl}`,
      });
    } catch (err) {
      console.error('mention intake error', err);
    }
  });
}

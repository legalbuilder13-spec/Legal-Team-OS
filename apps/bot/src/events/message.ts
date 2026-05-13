import type { App } from '@slack/bolt';
import { env } from '../env.js';

interface ThreadMessageShape {
  type: 'message';
  channel: string;
  user: string;
  text: string;
  ts: string;
  thread_ts?: string;
  bot_id?: string;
}

function isUserThreadMessage(event: unknown): event is ThreadMessageShape {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;
  if ('subtype' in e && e.subtype !== undefined) return false;
  if (e.bot_id) return false;
  return (
    typeof e.user === 'string' &&
    typeof e.text === 'string' &&
    typeof e.channel === 'string' &&
    typeof e.ts === 'string'
  );
}

export function registerMessageEvents(app: App) {
  app.event('message', async ({ event, client }) => {
    if (!isUserThreadMessage(event)) return;
    if (!event.thread_ts || event.thread_ts === event.ts) return;

    const userInfo = await client.users.info({ user: event.user }).catch(() => null);
    const userName = userInfo?.user?.name ?? 'unknown';

    try {
      await fetch(`${env.WEB_APP_URL}/api/internal/thread-reply`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${env.INTERNAL_API_TOKEN}`,
        },
        body: JSON.stringify({
          slackChannelId: event.channel,
          slackThreadTs: event.thread_ts,
          slackUserId: event.user,
          slackUserName: userName,
          text: event.text,
        }),
      });
    } catch (err) {
      console.error('thread-reply post failed', err);
    }
  });
}

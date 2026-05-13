import { eq } from 'drizzle-orm';
import { matters, users, type Db, type Job } from '@legal/db';
import { env } from '../env.js';
import { PermanentJobError } from '../utils.js';

interface SlackNotifyPayload {
  channel?: string;
  thread_ts?: string | null;
  matter_id?: string;
  text: string;
}

const PERMANENT_SLACK_ERRORS = new Set([
  'channel_not_found',
  'user_not_found',
  'not_in_channel',
  'is_archived',
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'no_permission',
  'channel_is_archived',
  'msg_too_long',
  'invalid_arg_name',
]);

async function postSlackMessage(channel: string, text: string, thread_ts?: string | null) {
  if (!env.SLACK_BOT_TOKEN) {
    console.warn('SLACK_BOT_TOKEN not set — skipping slack_notify');
    return;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text, thread_ts: thread_ts ?? undefined }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) {
    const err = body.error ?? 'unknown';
    if (PERMANENT_SLACK_ERRORS.has(err)) {
      throw new PermanentJobError(`slack chat.postMessage failed (permanent): ${err}`);
    }
    throw new Error(`slack chat.postMessage failed: ${err}`);
  }
}

async function resolveFromMatter(db: Db, matterId: string) {
  const matter = await db.query.matters.findFirst({ where: eq(matters.id, matterId) });
  if (!matter) return null;
  if (matter.slackThreadTs && matter.slackChannelId) {
    return { channel: matter.slackChannelId, threadTs: matter.slackThreadTs };
  }
  const requester = matter.requesterId
    ? await db.query.users.findFirst({ where: eq(users.id, matter.requesterId) })
    : null;
  if (requester?.slackUserId) {
    return { channel: requester.slackUserId, threadTs: null };
  }
  return null;
}

export async function handleSlackNotifyJob(db: Db, job: Job) {
  const payload = job.payload as unknown as SlackNotifyPayload;
  let channel = payload.channel;
  let threadTs = payload.thread_ts ?? null;

  if (!channel && payload.matter_id) {
    const resolved = await resolveFromMatter(db, payload.matter_id);
    if (!resolved) {
      console.warn(`slack_notify: matter ${payload.matter_id} has no reachable channel — skipping`);
      return;
    }
    channel = resolved.channel;
    threadTs = resolved.threadTs;
  }

  if (!channel) throw new Error('slack_notify: no channel resolved');
  await postSlackMessage(channel, payload.text, threadTs);
}

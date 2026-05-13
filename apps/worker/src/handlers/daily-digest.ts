import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { matters, users, type Db, type User } from '@legal/db';
import { env } from '../env.js';
import { bucketBySla, type AttorneyMatter } from '../utils.js';

function renderDigest(attorney: User, items: AttorneyMatter[]): string {
  const { overdue, dueToday, dueThisWeek, noSla } = bucketBySla(items);
  const lines = [`*Good morning, ${attorney.name.split(' ')[0] ?? attorney.name}.*`];
  lines.push(`You have *${items.length}* open ${items.length === 1 ? 'matter' : 'matters'}.`);

  function section(label: string, list: AttorneyMatter[]) {
    if (list.length === 0) return;
    lines.push('');
    lines.push(`*${label}* (${list.length})`);
    for (const m of list.slice(0, 8)) {
      const url = `${env.WEB_APP_URL}/matters/${m.id}`;
      lines.push(`• <${url}|${m.shortId}> ${m.title}`);
    }
    if (list.length > 8) lines.push(`  …and ${list.length - 8} more`);
  }

  section('Overdue', overdue);
  section('Due today', dueToday);
  section('Due this week', dueThisWeek);
  section('Later / no SLA', noSla);
  return lines.join('\n');
}

async function sendDm(slackUserId: string, text: string) {
  if (!env.SLACK_BOT_TOKEN) {
    console.warn('SLACK_BOT_TOKEN not set — skipping daily digest DM');
    return;
  }
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel: slackUserId, text }),
  });
  const body = (await res.json()) as { ok: boolean; error?: string };
  if (!body.ok) throw new Error(`daily digest DM failed: ${body.error}`);
}

export async function runDailyDigest(db: Db) {
  const attorneys = await db
    .select()
    .from(users)
    .where(and(inArray(users.role, ['attorney', 'admin']), sql`${users.slackUserId} IS NOT NULL`));

  let dmsSent = 0;
  for (const attorney of attorneys) {
    if (!attorney.slackUserId) continue;

    const open = await db
      .select({
        id: matters.id,
        shortId: matters.shortId,
        title: matters.title,
        priority: matters.priority,
        status: matters.status,
        slaDueAt: matters.slaDueAt,
      })
      .from(matters)
      .where(
        and(
          eq(matters.assigneeId, attorney.id),
          sql`${matters.status} not in ('closed', 'cancelled')`,
        ),
      )
      .orderBy(asc(matters.slaDueAt));

    if (open.length === 0) continue;

    try {
      await sendDm(attorney.slackUserId, renderDigest(attorney, open));
      dmsSent += 1;
    } catch (err) {
      console.error(`daily digest failed for ${attorney.email}:`, err);
    }
  }
  return dmsSent;
}

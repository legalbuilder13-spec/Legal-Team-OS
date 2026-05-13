import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  matters,
  matterEvents,
  matterDrafts,
  users,
} from '@legal/db';
import { protectedProcedure, router } from '../trpc.js';

export const dashboardRouter = router({
  summary: protectedProcedure.query(async ({ ctx }) => {
    const byStatus = await ctx.db
      .select({
        status: matters.status,
        count: sql<number>`count(*)::int`,
      })
      .from(matters)
      .groupBy(matters.status);

    const byPracticeArea = await ctx.db
      .select({
        practiceArea: matters.practiceArea,
        count: sql<number>`count(*)::int`,
      })
      .from(matters)
      .where(sql`${matters.status} != 'closed'`)
      .groupBy(matters.practiceArea);

    const slaBreaches = await ctx.db
      .select({ count: sql<number>`count(*)::int` })
      .from(matters)
      .where(
        sql`${matters.status} not in ('closed', 'cancelled') and ${matters.slaDueAt} < now()`,
      );

    return {
      byStatus,
      byPracticeArea,
      slaBreaches: slaBreaches[0]?.count ?? 0,
    };
  }),

  cycleTime: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        practiceArea: matters.practiceArea,
        count: sql<number>`count(*)::int`,
        avgHours: sql<number>`coalesce(avg(extract(epoch from (${matters.closedAt} - ${matters.createdAt})) / 3600), 0)::float`,
      })
      .from(matters)
      .where(
        sql`${matters.status} = 'closed' and ${matters.closedAt} > now() - interval '30 days'`,
      )
      .groupBy(matters.practiceArea);

    const overall = await ctx.db
      .select({
        count: sql<number>`count(*)::int`,
        avgHours: sql<number>`coalesce(avg(extract(epoch from (${matters.closedAt} - ${matters.createdAt})) / 3600), 0)::float`,
      })
      .from(matters)
      .where(
        sql`${matters.status} = 'closed' and ${matters.closedAt} > now() - interval '30 days'`,
      );

    return {
      byPracticeArea: rows,
      overall: overall[0] ?? { count: 0, avgHours: 0 },
    };
  }),

  breachTrend: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.execute(sql`
      SELECT
        CASE
          WHEN created_at > now() - interval '7 days' THEN 'current'
          ELSE 'prior'
        END AS period,
        count(*)::int AS count
      FROM matter_events
      WHERE kind = 'sla.breached'
        AND created_at > now() - interval '14 days'
      GROUP BY 1
    `);
    let current = 0;
    let prior = 0;
    for (const r of rows as unknown as Array<{ period: string; count: number }>) {
      if (r.period === 'current') current = r.count;
      else prior = r.count;
    }
    return { current, prior };
  }),

  byAttorney: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.execute(sql`
      SELECT
        u.id,
        u.name,
        COUNT(m.id) FILTER (WHERE m.status NOT IN ('closed', 'cancelled'))::int AS open_count,
        COUNT(m.id) FILTER (
          WHERE m.status NOT IN ('closed', 'cancelled')
            AND m.sla_due_at < now()
        )::int AS overdue_count,
        COUNT(m.id) FILTER (
          WHERE m.status = 'closed'
            AND m.closed_at > now() - interval '30 days'
        )::int AS closed_30d
      FROM ${users} u
      LEFT JOIN ${matters} m ON m.assignee_id = u.id
      WHERE u.role IN ('attorney', 'admin')
      GROUP BY u.id, u.name
      ORDER BY open_count DESC, u.name
    `);
    return rows as unknown as Array<{
      id: string;
      name: string;
      open_count: number;
      overdue_count: number;
      closed_30d: number;
    }>;
  }),

  mine: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const [stats] = await ctx.db
      .select({
        open: sql<number>`count(*) filter (where status not in ('closed', 'cancelled'))::int`,
        breached: sql<number>`count(*) filter (where status not in ('closed', 'cancelled') and sla_due_at < now())::int`,
        dueSoon: sql<number>`count(*) filter (where status not in ('closed', 'cancelled') and sla_due_at >= now() and sla_due_at < now() + interval '48 hours')::int`,
        closed30d: sql<number>`count(*) filter (where status = 'closed' and closed_at > now() - interval '30 days')::int`,
        inDraft: sql<number>`count(*) filter (where status = 'drafting')::int`,
      })
      .from(matters)
      .where(eq(matters.assigneeId, userId));

    const queue = await ctx.db
      .select({
        id: matters.id,
        shortId: matters.shortId,
        title: matters.title,
        status: matters.status,
        priority: matters.priority,
        practiceArea: matters.practiceArea,
        slaDueAt: matters.slaDueAt,
        createdAt: matters.createdAt,
      })
      .from(matters)
      .where(
        and(
          eq(matters.assigneeId, userId),
          sql`${matters.status} not in ('closed', 'cancelled')`,
        ),
      )
      .orderBy(
        sql`case when ${matters.slaDueAt} is null then 1 else 0 end`,
        asc(matters.slaDueAt),
        desc(matters.createdAt),
      )
      .limit(10);

    const drafts = await ctx.db
      .select({
        id: matterDrafts.id,
        matterId: matterDrafts.matterId,
        title: matterDrafts.title,
        version: matterDrafts.version,
        updatedAt: matterDrafts.updatedAt,
        matterShortId: matters.shortId,
        matterTitle: matters.title,
      })
      .from(matterDrafts)
      .innerJoin(matters, eq(matters.id, matterDrafts.matterId))
      .where(
        and(
          eq(matters.assigneeId, userId),
          sql`${matterDrafts.updatedAt} > now() - interval '14 days'`,
        ),
      )
      .orderBy(desc(matterDrafts.updatedAt))
      .limit(5);

    const myMatterIdsRows = await ctx.db
      .select({ id: matters.id })
      .from(matters)
      .where(eq(matters.assigneeId, userId));
    const myMatterIds = myMatterIdsRows.map((r) => r.id);

    const activity = myMatterIds.length
      ? await ctx.db
          .select({
            id: matterEvents.id,
            matterId: matterEvents.matterId,
            kind: matterEvents.kind,
            createdAt: matterEvents.createdAt,
            matterShortId: matters.shortId,
            matterTitle: matters.title,
          })
          .from(matterEvents)
          .innerJoin(matters, eq(matters.id, matterEvents.matterId))
          .where(inArray(matterEvents.matterId, myMatterIds))
          .orderBy(desc(matterEvents.createdAt))
          .limit(10)
      : [];

    return {
      stats: stats ?? { open: 0, breached: 0, dueSoon: 0, closed30d: 0, inDraft: 0 },
      queue,
      drafts,
      activity,
    };
  }),

  recentActivity: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: matterEvents.id,
        matterId: matterEvents.matterId,
        kind: matterEvents.kind,
        createdAt: matterEvents.createdAt,
        matterShortId: matters.shortId,
        matterTitle: matters.title,
      })
      .from(matterEvents)
      .innerJoin(matters, sql`${matters.id} = ${matterEvents.matterId}`)
      .orderBy(sql`${matterEvents.createdAt} desc`)
      .limit(15);
    return rows;
  }),
});

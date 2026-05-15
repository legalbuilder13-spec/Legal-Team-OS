import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import {
  matterDrafts,
  matterDraftVersions,
  matters,
  playbooks,
  counterparties,
  matterEvents,
  auditLog,
  jobs,
  users,
} from '@legal/db';
import { staffProcedure, router } from '../trpc.js';
import { getAnthropic, getAnthropicModel } from '../integrations/anthropic.js';

export const draftsRouter = router({
  get: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const existing = await ctx.db.query.matterDrafts.findFirst({
        where: eq(matterDrafts.matterId, input.matterId),
      });
      return existing ?? null;
    }),

  save: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        title: z.string().min(1).max(200),
        body: z.string().max(200_000),
        changeSummary: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.matterDrafts.findFirst({
        where: eq(matterDrafts.matterId, input.matterId),
      });

      if (existing) {
        const changed = existing.body !== input.body || existing.title !== input.title;
        if (changed) {
          await ctx.db.insert(matterDraftVersions).values({
            draftId: existing.id,
            versionNumber: existing.version,
            title: existing.title,
            body: existing.body,
            changeSummary: input.changeSummary ?? null,
            createdById: existing.updatedById ?? existing.createdById ?? ctx.user.id,
          });
        }
        const [updated] = await ctx.db
          .update(matterDrafts)
          .set({
            title: input.title,
            body: input.body,
            version: changed ? existing.version + 1 : existing.version,
            updatedById: ctx.user.id,
            updatedAt: new Date(),
          })
          .where(eq(matterDrafts.id, existing.id))
          .returning();

        if (changed) {
          await ctx.db.insert(matterEvents).values({
            matterId: input.matterId,
            actorId: ctx.user.id,
            kind: 'draft.updated',
            payload: { version: updated?.version, title: updated?.title },
          });
          await ctx.db.insert(auditLog).values({
            actorId: ctx.user.id,
            matterId: input.matterId,
            action: 'draft.updated',
            details: { draftId: updated?.id, version: updated?.version },
          });
        }
        return updated;
      }

      const [created] = await ctx.db
        .insert(matterDrafts)
        .values({
          matterId: input.matterId,
          title: input.title,
          body: input.body,
          createdById: ctx.user.id,
          updatedById: ctx.user.id,
        })
        .returning();
      await ctx.db.insert(matterEvents).values({
        matterId: input.matterId,
        actorId: ctx.user.id,
        kind: 'draft.created',
        payload: { draftId: created?.id },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: input.matterId,
        action: 'draft.created',
        details: { draftId: created?.id },
      });
      return created;
    }),

  listVersions: staffProcedure
    .input(z.object({ matterId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const draft = await ctx.db.query.matterDrafts.findFirst({
        where: eq(matterDrafts.matterId, input.matterId),
      });
      if (!draft) return [];
      return ctx.db
        .select()
        .from(matterDraftVersions)
        .where(eq(matterDraftVersions.draftId, draft.id))
        .orderBy(desc(matterDraftVersions.versionNumber));
    }),

  generateInitial: staffProcedure
    .input(z.object({ matterId: z.string().uuid(), playbookId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const anthropic = getAnthropic();
      if (!anthropic) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ANTHROPIC_API_KEY not configured.' });
      }
      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND' });

      const cp = matter.counterpartyId
        ? await ctx.db.query.counterparties.findFirst({
            where: eq(counterparties.id, matter.counterpartyId),
          })
        : null;

      let pb = null;
      if (input.playbookId) {
        pb = await ctx.db.query.playbooks.findFirst({ where: eq(playbooks.id, input.playbookId) });
      } else if (matter.practiceArea) {
        pb = await ctx.db.query.playbooks.findFirst({
          where: and(eq(playbooks.practiceArea, matter.practiceArea), eq(playbooks.isActive, true)),
        });
      }

      const prompt = [
        'You are drafting an initial legal document for an in-house attorney.',
        'Use the playbook (if provided) as authoritative guidance for clauses and positions.',
        'Output ONLY the draft document body in Markdown. No preface, no explanation, no commentary.',
        '',
        `Matter: ${matter.shortId} — ${matter.title}`,
        matter.practiceArea ? `Practice area: ${matter.practiceArea}` : '',
        cp?.name ? `Counterparty: ${cp.name}` : '',
        '',
        '== Request ==',
        matter.requestText.slice(0, 4000),
        matter.summary ? `\n== Summary ==\n${matter.summary}` : '',
        pb ? `\n== Playbook: ${pb.title} ==\n${pb.body}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const res = await anthropic.messages.create({
        model: getAnthropicModel(),
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const body = res.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
        .trim();
      return { body, playbookTitle: pb?.title ?? null };
    }),

  // Manual handoff: ship the current saved draft back to the requester in
  // the original Slack thread. Deliberately manual (not on status=closed)
  // so working notes don't accidentally get sent.
  sendToSlack: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        note: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const draft = await ctx.db.query.matterDrafts.findFirst({
        where: eq(matterDrafts.matterId, input.matterId),
      });
      if (!draft || !draft.body.trim()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No draft to send.' });
      }

      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      });
      if (!matter) throw new TRPCError({ code: 'NOT_FOUND', message: 'Matter not found.' });
      if (!matter.slackChannelId) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Matter has no Slack channel — cannot send to requester.',
        });
      }

      const requester = matter.requesterId
        ? await ctx.db.query.users.findFirst({ where: eq(users.id, matter.requesterId) })
        : null;
      const mention =
        requester?.slackUserId ? `<@${requester.slackUserId}> ` : '';

      const header = [
        `${mention}Update from legal on *${matter.shortId} — ${matter.title}* (sent by ${ctx.user.name}):`,
        input.note ? `\n_${input.note.trim()}_` : '',
        '',
        `*${draft.title}* _(v${draft.version})_`,
        '',
      ].join('\n');

      // Slack chat.postMessage caps at 40k chars. Trim aggressively and
      // tell the requester to open the matter for the full text.
      const MAX_BODY = 30_000;
      const truncated = draft.body.length > MAX_BODY;
      const bodyText = truncated
        ? `${draft.body.slice(0, MAX_BODY)}\n\n…(truncated — open the matter for the full draft)`
        : draft.body;

      const text = `${header}${bodyText}`;

      await ctx.db.insert(jobs).values({
        kind: 'slack_notify',
        matterId: matter.id,
        payload: {
          matter_id: matter.id,
          text,
        },
      });

      await ctx.db.insert(matterEvents).values({
        matterId: matter.id,
        actorId: ctx.user.id,
        kind: 'draft.sent_to_slack',
        payload: { draftId: draft.id, version: draft.version, truncated },
      });
      await ctx.db.insert(auditLog).values({
        actorId: ctx.user.id,
        matterId: matter.id,
        action: 'draft.sent_to_slack',
        details: {
          draftId: draft.id,
          version: draft.version,
          channel: matter.slackChannelId,
          threadTs: matter.slackThreadTs,
          truncated,
        },
      });

      return { queued: true, truncated, version: draft.version };
    }),

  suggestEdits: staffProcedure
    .input(
      z.object({
        matterId: z.string().uuid(),
        instruction: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const anthropic = getAnthropic();
      if (!anthropic) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'ANTHROPIC_API_KEY not configured.' });
      }
      const draft = await ctx.db.query.matterDrafts.findFirst({
        where: eq(matterDrafts.matterId, input.matterId),
      });
      if (!draft) throw new TRPCError({ code: 'NOT_FOUND', message: 'No draft to edit.' });

      const matter = await ctx.db.query.matters.findFirst({
        where: eq(matters.id, input.matterId),
      });
      const pb = matter?.practiceArea
        ? await ctx.db.query.playbooks.findFirst({
            where: and(eq(playbooks.practiceArea, matter.practiceArea), eq(playbooks.isActive, true)),
          })
        : null;

      const prompt = [
        'You are editing a legal draft. Apply the attorney\'s instruction to the current draft.',
        'Output ONLY the full revised draft in Markdown. Preserve unchanged sections verbatim.',
        '',
        '== Attorney instruction ==',
        input.instruction,
        '',
        pb ? `== Playbook reference: ${pb.title} ==\n${pb.body}\n` : '',
        '== Current draft ==',
        draft.body,
      ]
        .filter(Boolean)
        .join('\n');

      const res = await anthropic.messages.create({
        model: getAnthropicModel(),
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      });
      const body = res.content
        .flatMap((b) => (b.type === 'text' ? [b.text] : []))
        .join('\n')
        .trim();
      return { body };
    }),
});

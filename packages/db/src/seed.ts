import { eq, sql } from 'drizzle-orm';
import {
  users,
  routingRules,
  matters,
  matterEvents,
  counterparties,
  auditLog,
  playbooks,
  knowledgeArticles,
} from './schema';
import { getDb } from './client';

function shortId(prefix = 'M-'): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = prefix;
  for (let i = 0; i < 8; i++) {
    id += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return id;
}

async function upsertUserByEmail(
  db: ReturnType<typeof getDb>,
  values: {
    email: string;
    name: string;
    role: 'admin' | 'attorney' | 'legal_ops' | 'requester';
    slackUserId?: string;
  },
) {
  const existing = await db.query.users.findFirst({ where: eq(users.email, values.email) });
  if (existing) return existing;
  const [created] = await db.insert(users).values(values).returning();
  return created!;
}

async function upsertRoutingRule(
  db: ReturnType<typeof getDb>,
  values: {
    practiceArea: 'commercial' | 'employment' | 'privacy' | 'litigation' | 'corporate';
    defaultAssigneeId: string;
    slaHours: number;
  },
) {
  const existing = await db.query.routingRules.findFirst({
    where: eq(routingRules.practiceArea, values.practiceArea),
  });
  if (existing) {
    const [updated] = await db
      .update(routingRules)
      .set({
        defaultAssigneeId: values.defaultAssigneeId,
        slaHours: values.slaHours,
        updatedAt: new Date(),
      })
      .where(eq(routingRules.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db.insert(routingRules).values(values).returning();
  return created!;
}

async function main() {
  const db = getDb();

  console.log('seeding users…');
  const admin = await upsertUserByEmail(db, {
    email: 'gc@example.com',
    name: 'Gabriela Chen',
    role: 'admin',
  });
  const commercial = await upsertUserByEmail(db, {
    email: 'commercial@example.com',
    name: 'Marcus Lee',
    role: 'attorney',
  });
  const employment = await upsertUserByEmail(db, {
    email: 'employment@example.com',
    name: 'Sofia Patel',
    role: 'attorney',
  });
  const privacy = await upsertUserByEmail(db, {
    email: 'privacy@example.com',
    name: 'Daniel Park',
    role: 'attorney',
  });
  const requester = await upsertUserByEmail(db, {
    email: 'sales-vp@example.com',
    name: 'Jordan Rivera',
    role: 'requester',
    slackUserId: 'U_SEED_REQUESTER',
  });

  console.log('seeding routing rules…');
  await upsertRoutingRule(db, {
    practiceArea: 'commercial',
    defaultAssigneeId: commercial.id,
    slaHours: 48,
  });
  await upsertRoutingRule(db, {
    practiceArea: 'employment',
    defaultAssigneeId: employment.id,
    slaHours: 24,
  });
  await upsertRoutingRule(db, {
    practiceArea: 'privacy',
    defaultAssigneeId: privacy.id,
    slaHours: 24,
  });

  console.log('seeding counterparties…');
  const [acme] = await db
    .insert(counterparties)
    .values({ name: 'Acme Corp', domain: 'acme.com' })
    .onConflictDoNothing()
    .returning();
  const acmeId =
    acme?.id ??
    (await db.query.counterparties.findFirst({ where: eq(counterparties.name, 'Acme Corp') }))!.id;

  console.log('seeding matters…');
  const now = Date.now();
  const samples = [
    {
      title: 'Review the Acme MSA',
      requestText: 'Need a redline on the Acme Corp master services agreement before Friday.',
      practiceArea: 'commercial' as const,
      priority: 'high' as const,
      status: 'in_review' as const,
      assigneeId: commercial.id,
      counterpartyId: acmeId,
      slaOffsetH: 48,
      createdAgoH: 8,
    },
    {
      title: 'New hire offer letter — VP Finance',
      requestText: 'Standard exec offer for VP Finance candidate. Equity grant attached.',
      practiceArea: 'employment' as const,
      priority: 'medium' as const,
      status: 'open' as const,
      assigneeId: employment.id,
      slaOffsetH: -4,
      createdAgoH: 30,
    },
    {
      title: 'GDPR DSR from EU staffing partner',
      requestText: 'A data subject request just came in via privacy@... I need help responding.',
      practiceArea: 'privacy' as const,
      priority: 'high' as const,
      status: 'waiting_on_requester' as const,
      assigneeId: privacy.id,
      slaOffsetH: 12,
      createdAgoH: 4,
    },
    {
      title: 'Vendor NDA — TinyCorp',
      requestText: 'TinyCorp wants us to sign their NDA. Can someone review?',
      practiceArea: 'commercial' as const,
      priority: 'low' as const,
      status: 'closed' as const,
      assigneeId: commercial.id,
      slaOffsetH: 72,
      createdAgoH: 200,
      closedAgoH: 180,
    },
    {
      title: 'Terminated contractor — last-paycheck question',
      requestText:
        'Quick HR question about final paycheck timing for a CA-based contractor we let go yesterday.',
      practiceArea: 'employment' as const,
      priority: 'medium' as const,
      status: 'closed' as const,
      assigneeId: employment.id,
      slaOffsetH: 24,
      createdAgoH: 96,
      closedAgoH: 60,
    },
  ];

  for (const s of samples) {
    const createdAt = new Date(now - s.createdAgoH * 3600 * 1000);
    const slaDueAt = new Date(createdAt.getTime() + s.slaOffsetH * 3600 * 1000);
    const closedAt =
      s.status === 'closed' && 'closedAgoH' in s
        ? new Date(now - (s.closedAgoH as number) * 3600 * 1000)
        : null;

    const existing = await db.query.matters.findFirst({ where: eq(matters.title, s.title) });
    if (existing) continue;

    const [m] = await db
      .insert(matters)
      .values({
        shortId: shortId(),
        title: s.title,
        requestText: s.requestText,
        summary: s.requestText,
        practiceArea: s.practiceArea,
        priority: s.priority,
        status: s.status,
        assigneeId: s.assigneeId,
        requesterId: requester.id,
        counterpartyId: s.counterpartyId ?? null,
        createdAt,
        updatedAt: createdAt,
        closedAt,
        slaDueAt,
      })
      .returning();

    await db.insert(matterEvents).values({
      matterId: m!.id,
      kind: 'triaged',
      payload: { practiceArea: s.practiceArea, priority: s.priority },
      createdAt,
    });

    if (s.status === 'closed' && closedAt) {
      await db.insert(matterEvents).values({
        matterId: m!.id,
        kind: 'status.changed',
        payload: { status: 'closed' },
        createdAt: closedAt,
      });
    }

    if (s.slaOffsetH < 0) {
      const breachAt = new Date(slaDueAt.getTime() + 1000);
      await db.insert(matterEvents).values({
        matterId: m!.id,
        kind: 'sla.breached',
        payload: { slaDueAt },
        createdAt: breachAt,
      });
    }
  }

  console.log('seeding playbooks…');
  const samplePlaybooks = [
    {
      practiceArea: 'commercial' as const,
      title: 'NDA & MSA Review Checklist',
      body: `For all NDAs and MSAs, verify the following before routing to the requester:

1. **Mutual vs. one-way** — Confirm which party receives confidential information. Default to mutual for vendor relationships.
2. **Definition of "Confidential Information"** — Must exclude publicly available info, info independently developed, and info received from third parties without restriction.
3. **Term and survival** — NDA term should not exceed 3 years; confidentiality obligations should survive termination for at least 2 years.
4. **Permitted disclosures** — Confirm carve-outs for legal/regulatory disclosures with notice obligations.
5. **Liability cap** — Flag any uncapped liability provisions for escalation to the GC.
6. **Governing law** — Default to our jurisdiction unless a strong business reason exists for another.
7. **Counterparty risk** — Check the counterparty table for any prior disputes or flagged history before signing off.`,
      isActive: true,
    },
    {
      practiceArea: 'employment' as const,
      title: 'Contractor Classification Checklist',
      body: `Before advising on any contractor or new hire arrangement, check the following:

1. **State of engagement** — California, New York, and Massachusetts have stricter classification tests (ABC test in CA). Flag immediately if the worker is CA-based.
2. **Control test** — Does the company control how the work is done, not just the result? If yes, lean employee.
3. **Integration test** — Is this work integral to the company's core business? If yes, lean employee.
4. **Duration** — Engagements over 12 months with the same contractor warrant reclassification review.
5. **Exclusivity** — Exclusive arrangements signal employment. Flag any exclusivity clause for review.
6. **Equity / benefits** — Contractors must not receive equity, benefits, or expense reimbursements without explicit legal sign-off.
7. **IP assignment** — All contractor agreements must include a work-for-hire clause and IP assignment. Verify before countersigning.`,
      isActive: true,
    },
    {
      practiceArea: 'privacy' as const,
      title: 'Data Subject Request (DSR) Response Protocol',
      body: `For all incoming DSRs (GDPR Article 15-22, CCPA, etc.):

1. **Identify the request type** — Access, deletion, portability, correction, or opt-out of sale. Each has a different response workflow.
2. **Verify jurisdiction** — GDPR applies to EU/EEA residents (30-day SLA). CCPA applies to CA residents (45-day SLA). Log the jurisdiction in the matter.
3. **Verify requester identity** — Do not respond to a DSR without identity verification. Use email confirmation or account login for internal systems.
4. **Search scope** — Confirm with engineering which systems hold the requester's data: production DB, analytics, marketing tools, backups, third-party processors.
5. **Processor notification** — If any sub-processors hold the data, they must be notified within 5 business days of our own response deadline.
6. **Response template** — Use the approved response template in the Legal shared drive. Do not draft freehand.
7. **Log the response** — Record the request date, response date, and outcome in the matter notes for audit purposes.`,
      isActive: true,
    },
  ];

  for (const pb of samplePlaybooks) {
    const existing = await db.query.playbooks.findFirst({
      where: eq(playbooks.title, pb.title),
    });
    if (!existing) {
      await db.insert(playbooks).values({ ...pb, createdById: admin.id });
    }
  }

  console.log('seeding knowledge articles…');
  const sampleArticles = [
    {
      practiceArea: 'commercial' as const,
      title: 'When do I need a mutual NDA vs. a one-way NDA?',
      body: `**Mutual NDA**: Use when both parties will share confidential information (most vendor evaluations, partnership discussions, joint development).

**One-way NDA**: Use when only one party is disclosing (most candidate interviews, due diligence by a buyer, evaluating an unsolicited proposal).

If you're unsure, default to mutual — the legal risk is the same and it's easier to negotiate. Send the standard template via /legal nda <counterparty name>.`,
      tags: ['nda', 'template', 'self-service'],
    },
    {
      practiceArea: 'employment' as const,
      title: 'How do I terminate a contractor?',
      body: `**Standard contractor offboarding (no cause)**:

1. Give written notice per the contractor agreement (typically 14 or 30 days).
2. Confirm the final invoice date — pay through the notice period.
3. Recover any company property (laptop, badge, credentials).
4. Send a termination letter (template in /admin/templates).
5. Disable system access on the effective date.

**For-cause termination** (breach, misconduct): contact Sofia Patel in employment legal first — do NOT terminate before legal review.`,
      tags: ['contractor', 'termination', 'self-service'],
    },
    {
      practiceArea: 'privacy' as const,
      title: 'What do I do if someone reports a data breach?',
      body: `**Immediate steps (within 1 hour of report)**:

1. File a P0 incident in the security tracker.
2. Do NOT delete logs or alter affected systems.
3. Page the on-call privacy attorney (Daniel Park).
4. Document who reported it, when, and what they observed.

**Within 24 hours**:
- Privacy legal will assess notification obligations (GDPR: 72h regulator notification, CCPA: depends on data type).
- Engineering will scope the affected records.
- Comms will prepare a holding statement if needed.

Do not communicate externally about the incident without legal sign-off.`,
      tags: ['breach', 'incident-response', 'urgent'],
    },
    {
      practiceArea: 'commercial' as const,
      title: "What is our standard liability cap?",
      body: `**Default position**: 1x the fees paid in the 12 months preceding the claim.

**Acceptable variations**:
- Up to 2x annual fees for strategic customers (Tier 1 accounts in Salesforce)
- Carve-outs from the cap are acceptable for: indemnification obligations, confidentiality breach, willful misconduct, IP infringement

**Hard line**: Never agree to uncapped liability except for the carve-outs above. If a counterparty pushes for uncapped general liability, escalate to the GC.`,
      tags: ['liability', 'contract-terms', 'negotiation'],
    },
  ];

  for (const art of sampleArticles) {
    const existing = await db.query.knowledgeArticles.findFirst({
      where: eq(knowledgeArticles.title, art.title),
    });
    if (!existing) {
      await db.insert(knowledgeArticles).values({ ...art, createdById: admin.id });
    }
  }

  await db.insert(auditLog).values({
    actorId: admin.id,
    actorKind: 'system',
    action: 'seed.completed',
    details: { at: new Date().toISOString() },
  });

  const counts = await db
    .select({
      users: sql<number>`(select count(*)::int from ${users})`,
      matters: sql<number>`(select count(*)::int from ${matters})`,
      rules: sql<number>`(select count(*)::int from ${routingRules})`,
    })
    .from(sql`(select 1) one`);
  console.log('seed complete:', counts[0]);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

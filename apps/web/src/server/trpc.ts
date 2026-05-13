import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { auth, currentUser } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, users, type User } from '@legal/db';

async function ensureUser(db: ReturnType<typeof getDb>, clerkId: string): Promise<User> {
  const byClerk = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) });
  if (byClerk) return byClerk;

  const clerk = await currentUser().catch(() => null);
  const email =
    clerk?.emailAddresses?.[0]?.emailAddress ?? `${clerkId}@clerk.local`;
  const name =
    [clerk?.firstName, clerk?.lastName].filter(Boolean).join(' ') ||
    clerk?.username ||
    email.split('@')[0]!;

  const byEmail = await db.query.users.findFirst({ where: eq(users.email, email) });
  if (byEmail) {
    const [updated] = await db
      .update(users)
      .set({
        clerkId,
        name: byEmail.name || name,
        role: byEmail.role === 'requester' ? 'attorney' : byEmail.role,
        updatedAt: new Date(),
      })
      .where(eq(users.id, byEmail.id))
      .returning();
    return updated!;
  }

  const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const role = (countRows[0]?.count ?? 0) === 0 ? 'admin' : 'attorney';

  const [created] = await db
    .insert(users)
    .values({ clerkId, email, name, role })
    .returning();
  return created!;
}

export async function createContext() {
  const session = await auth().catch(() => null);
  const db = getDb();
  const dbUser = session?.userId ? await ensureUser(db, session.userId) : null;
  return {
    db,
    userId: session?.userId ?? null,
    user: dbUser,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.userId || !ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId, user: ctx.user } });
});

const STAFF_ROLES = new Set(['attorney', 'legal_ops', 'admin']);

export const staffProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!STAFF_ROLES.has(ctx.user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'attorney, legal_ops, or admin role required' });
  }
  return next({ ctx });
});

const ADMIN_ROLES = new Set(['attorney', 'legal_ops', 'admin']);

export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ADMIN_ROLES.has(ctx.user.role)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'attorney, legal_ops, or admin role required' });
  }
  return next({ ctx });
});

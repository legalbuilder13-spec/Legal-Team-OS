import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import { getDb, users, escalations } from '@legal/db';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const db = getDb();
  const dbUser = userId
    ? await db.query.users.findFirst({ where: eq(users.clerkId, userId) })
    : null;
  const isAdmin =
    dbUser?.role === 'admin' ||
    dbUser?.role === 'legal_ops' ||
    dbUser?.role === 'attorney';

  let openEscalations = 0;
  if (dbUser) {
    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(escalations)
      .where(eq(escalations.status, 'open'));
    openEscalations = rows[0]?.count ?? 0;
  }

  return (
    <div className="min-h-screen flex bg-ink-50">
      <aside className="w-60 bg-white border-r border-ink-200 px-4 py-6 flex flex-col gap-6 sticky top-0 h-screen">
        <Link href="/dashboard" className="flex items-center gap-2 px-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white text-sm font-semibold shadow-soft">
            L
          </span>
          <span className="text-[15px] font-semibold tracking-tightish text-ink-900">
            Legal Team OS
          </span>
        </Link>

        <nav className="flex flex-col gap-0.5 text-[13.5px] text-ink-700">
          <NavLink href="/dashboard" label="Dashboard" />
          <NavLink href="/matters" label="Matters" />
          <NavLink href="/queue" label="My Queue" />
          <NavLink
            href="/escalations"
            label="Escalations"
            badge={openEscalations > 0 ? openEscalations : undefined}
          />
          <NavLink href="/archive" label="Archive" />

          {isAdmin && (
            <>
              <div className="px-2 pt-5 pb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-400">
                Admin
              </div>
              <NavLink href="/admin/playbooks" label="Playbooks" />
              <NavLink href="/admin/knowledge" label="Knowledge Base" />
              <NavLink href="/admin/routing" label="Routing Rules" />
              <NavLink href="/admin/users" label="Users" />
              <NavLink href="/admin/audit" label="Audit Log" />
            </>
          )}
        </nav>

        <div className="mt-auto flex items-center justify-between border-t border-ink-100 pt-4">
          <div className="text-xs text-ink-500 truncate">
            {dbUser?.name ?? 'Signed in'}
          </div>
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </aside>

      <main className="flex-1 px-10 py-10">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  label,
  badge,
}: {
  href: string;
  label: string;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between px-2 py-1.5 rounded-lg text-ink-700 hover:bg-ink-100 hover:text-ink-900 transition-colors duration-150"
    >
      <span>{label}</span>
      {badge !== undefined && (
        <span className="text-[10px] font-medium bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">
          {badge}
        </span>
      )}
    </Link>
  );
}

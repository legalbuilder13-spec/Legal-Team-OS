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
    <div className="min-h-screen flex">
      <aside className="w-56 bg-white border-r border-gray-200 px-4 py-6 flex flex-col gap-4">
        <div className="text-lg font-semibold text-brand-700">Legal Team OS</div>
        <nav className="flex flex-col gap-1 text-sm">
          <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/matters">
            Matters
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/queue">
            My Queue
          </Link>
          <Link
            className="px-2 py-1.5 rounded hover:bg-gray-100 flex items-center justify-between"
            href="/escalations"
          >
            <span>Escalations</span>
            {openEscalations > 0 && (
              <span className="text-[10px] bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">
                {openEscalations}
              </span>
            )}
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/archive">
            Archive
          </Link>
          <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/dashboard">
            Dashboard
          </Link>
          {isAdmin && (
            <>
              <div className="px-2 pt-3 pb-1 text-xs uppercase tracking-wide text-gray-400">
                Admin
              </div>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/playbooks">
                Playbooks
              </Link>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/knowledge">
                Knowledge Base
              </Link>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/routing">
                Routing Rules
              </Link>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/users">
                Users
              </Link>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/audit">
                Audit Log
              </Link>
            </>
          )}
        </nav>
        <div className="mt-auto">
          <UserButton afterSignOutUrl="/sign-in" />
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}

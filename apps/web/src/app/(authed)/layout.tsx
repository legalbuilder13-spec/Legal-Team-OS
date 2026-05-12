import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import { getDb, users } from '@legal/db';

export default async function AuthedLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth();
  const dbUser = userId
    ? await getDb().query.users.findFirst({ where: eq(users.clerkId, userId) })
    : null;
  const isAdmin = dbUser?.role === 'admin' || dbUser?.role === 'legal_ops';

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
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/routing">
                Routing Rules
              </Link>
              <Link className="px-2 py-1.5 rounded hover:bg-gray-100" href="/admin/users">
                Users
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

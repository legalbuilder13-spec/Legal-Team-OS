import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { eq, sql } from 'drizzle-orm';
import {
  type LucideIcon,
  LayoutDashboard,
  Folder,
  Inbox,
  Siren,
  Archive,
  BookOpen,
  GraduationCap,
  Route,
  Users,
  ClipboardList,
  Activity,
  Files,
  Workflow,
  ListChecks,
} from 'lucide-react';
import { getDb, users, escalations } from '@legal/db';
import { ThemeToggle } from '@/components/theme';

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
    <div className="min-h-screen flex bg-ink-50 dark:bg-ink-950">
      <aside className="w-60 bg-white dark:bg-ink-900 border-r border-ink-200 dark:border-ink-800 px-4 py-6 flex flex-col gap-6 sticky top-0 h-screen">
        <Link href="/dashboard" className="flex items-center gap-2 px-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white text-sm font-semibold shadow-soft">
            L
          </span>
          <span className="text-[15px] font-semibold tracking-tightish text-ink-900 dark:text-ink-50">
            Legal Team OS
          </span>
        </Link>

        <nav className="flex flex-col gap-0.5 text-[13.5px]">
          <NavLink href="/dashboard" label="Dashboard" icon={LayoutDashboard} />
          <NavLink href="/matters" label="Matters" icon={Folder} />
          <NavLink href="/queue" label="My Queue" icon={Inbox} />
          <NavLink
            href="/escalations"
            label="Escalations"
            icon={Siren}
            badge={openEscalations > 0 ? openEscalations : undefined}
          />
          <NavLink href="/archive" label="Archive" icon={Archive} />
          <NavLink href="/analysis-steps" label="Analysis Steps" icon={ListChecks} />

          {isAdmin && (
            <>
              <div className="px-2 pt-5 pb-1.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-400 dark:text-ink-500">
                Admin
              </div>
              <NavLink href="/admin/playbooks" label="Playbooks" icon={BookOpen} />
              <NavLink href="/admin/knowledge" label="Knowledge Base" icon={GraduationCap} />
              <NavLink href="/admin/routing" label="Routing Rules" icon={Route} />
              <NavLink href="/admin/users" label="Users" icon={Users} />
              <NavLink href="/admin/templates" label="Templates" icon={Files} />
              <NavLink href="/admin/patterns" label="Patterns" icon={Workflow} />
              <NavLink href="/admin/rules" label="Rules" icon={Route} />
              <NavLink href="/admin/audit" label="Audit Log" icon={ClipboardList} />
              <NavLink href="/admin/system" label="System" icon={Activity} />
            </>
          )}
        </nav>

        <div className="mt-auto space-y-3 border-t border-ink-100 dark:border-ink-800 pt-4">
          <div className="flex justify-center">
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between">
            <div className="text-xs text-ink-500 dark:text-ink-400 truncate">
              {dbUser?.name ?? 'Signed in'}
            </div>
            <UserButton afterSignOutUrl="/sign-in" />
          </div>
        </div>
      </aside>

      <main className="flex-1 px-10 py-10">{children}</main>
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-ink-700 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-ink-800 hover:text-ink-900 dark:hover:text-ink-50 transition-colors duration-150"
    >
      <span className="flex items-center gap-2.5">
        <Icon
          size={15}
          className="text-ink-400 dark:text-ink-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors"
        />
        <span>{label}</span>
      </span>
      {badge !== undefined && (
        <span className="text-[10px] font-medium bg-red-500 text-white rounded-full px-1.5 py-0.5 leading-none">
          {badge}
        </span>
      )}
    </Link>
  );
}

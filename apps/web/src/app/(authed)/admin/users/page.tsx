'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';

const ROLES = ['attorney', 'legal_ops', 'admin', 'requester'] as const;

export default function AdminUsersPage() {
  const { data, isLoading, refetch } = trpc.admin.listUsers.useQuery();
  const create = trpc.admin.createUser.useMutation({ onSuccess: () => refetch() });
  const update = trpc.admin.updateUser.useMutation({ onSuccess: () => refetch() });

  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'attorney' as (typeof ROLES)[number],
    slackUserId: '',
  });

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold mb-6">Users</h1>

      <section className="bg-white dark:bg-ink-900 border rounded-lg p-4 mb-6">
        <h2 className="font-medium mb-3">Add user</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.email || !form.name) return;
            create.mutate(
              {
                email: form.email,
                name: form.name,
                role: form.role,
                slackUserId: form.slackUserId || undefined,
              },
              {
                onSuccess: () =>
                  setForm({ email: '', name: '', role: 'attorney', slackUserId: '' }),
              },
            );
          }}
          className="grid grid-cols-4 gap-2 text-sm"
        >
          <input
            placeholder="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="border rounded px-2 py-1.5"
          />
          <input
            placeholder="name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="border rounded px-2 py-1.5"
          />
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })}
            className="border rounded px-2 py-1.5"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <input
            placeholder="slack user id (optional)"
            value={form.slackUserId}
            onChange={(e) => setForm({ ...form, slackUserId: e.target.value })}
            className="border rounded px-2 py-1.5"
          />
          <button
            type="submit"
            disabled={create.isPending}
            className="col-span-4 bg-brand-600 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50"
          >
            Add
          </button>
        </form>
      </section>

      <section className="bg-white dark:bg-ink-900 border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 dark:bg-ink-900 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Role</th>
              <th className="px-4 py-2 font-medium">Slack ID</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink-500 dark:text-ink-400">
                  Loading…
                </td>
              </tr>
            ) : (
              data?.map((u) => (
                <tr key={u.id} className="border-t border-ink-100 dark:border-ink-800">
                  <td className="px-4 py-2">{u.name}</td>
                  <td className="px-4 py-2 text-ink-600 dark:text-ink-400">{u.email}</td>
                  <td className="px-4 py-2">
                    <select
                      defaultValue={u.role}
                      onChange={(e) =>
                        update.mutate({ id: u.id, role: e.target.value as typeof ROLES[number] })
                      }
                      className="border rounded px-2 py-1"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-ink-500 dark:text-ink-400">
                    {u.slackUserId ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

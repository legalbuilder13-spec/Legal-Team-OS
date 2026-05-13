'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { PracticeAreaSchema, type PracticeArea } from '@legal/types';

const PRACTICE_AREAS = PracticeAreaSchema.options;

const DEFAULT_SLA: Record<PracticeArea, number> = {
  commercial: 48,
  employment: 24,
  privacy: 24,
  litigation: 8,
  corporate: 72,
  regulatory: 48,
  ip: 72,
  real_estate: 72,
  other: 48,
};

export default function AdminRoutingPage() {
  const { data: rules, refetch } = trpc.admin.listRoutingRules.useQuery();
  const { data: users } = trpc.admin.listUsers.useQuery();
  const upsert = trpc.admin.upsertRoutingRule.useMutation({ onSuccess: () => refetch() });

  const assignableUsers =
    users?.filter((u) => u.role === 'attorney' || u.role === 'admin') ?? [];

  const rulesByArea = new Map(rules?.map((r) => [r.practiceArea, r]));

  const [drafts, setDrafts] = useState<
    Record<string, { defaultAssigneeId: string | null; slaHours: number }>
  >({});

  function getDraft(area: PracticeArea) {
    if (drafts[area]) return drafts[area];
    const existing = rulesByArea.get(area);
    return {
      defaultAssigneeId: existing?.defaultAssigneeId ?? null,
      slaHours: existing?.slaHours ?? DEFAULT_SLA[area],
    };
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-semibold mb-2">Routing Rules</h1>
      <p className="text-sm text-ink-600 mb-6">
        Map each practice area to a default attorney and SLA in hours. New matters classified into
        an area get auto-assigned to the listed attorney and inherit the SLA.
      </p>

      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left">
            <tr>
              <th className="px-4 py-2 font-medium">Practice Area</th>
              <th className="px-4 py-2 font-medium">Default Assignee</th>
              <th className="px-4 py-2 font-medium">SLA (hours)</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {PRACTICE_AREAS.map((area) => {
              const draft = getDraft(area);
              const existing = rulesByArea.get(area);
              const changed =
                draft.defaultAssigneeId !== (existing?.defaultAssigneeId ?? null) ||
                draft.slaHours !== (existing?.slaHours ?? DEFAULT_SLA[area]);
              return (
                <tr key={area} className="border-t border-ink-100">
                  <td className="px-4 py-2 capitalize">{area}</td>
                  <td className="px-4 py-2">
                    <select
                      value={draft.defaultAssigneeId ?? ''}
                      onChange={(e) =>
                        setDrafts({
                          ...drafts,
                          [area]: { ...draft, defaultAssigneeId: e.target.value || null },
                        })
                      }
                      className="border rounded px-2 py-1 w-full"
                    >
                      <option value="">— unassigned —</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.role})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      min={1}
                      max={720}
                      value={draft.slaHours}
                      onChange={(e) =>
                        setDrafts({
                          ...drafts,
                          [area]: { ...draft, slaHours: parseInt(e.target.value, 10) || 1 },
                        })
                      }
                      className="border rounded px-2 py-1 w-24"
                    />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      disabled={!changed || upsert.isPending}
                      onClick={() =>
                        upsert.mutate({
                          practiceArea: area,
                          defaultAssigneeId: draft.defaultAssigneeId,
                          slaHours: draft.slaHours,
                        })
                      }
                      className="bg-brand-600 text-white text-xs px-2 py-1 rounded disabled:opacity-30"
                    >
                      Save
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// PR-10 — rabbit-hole monitor.
// Generic Jaccard-overlap loop detector. Tools that fire multiple
// retrieval strategies (case-law: full-text/jurisdiction-filter/
// citator; statutory: multi-jurisdiction fanout) call this between
// strategies. When subsequent strategies return mostly the same
// records as prior ones, we stop early and emit loop_detected.
// how-lawisrs-think Part IV §6 / V.16.

export interface LoopMonitorState {
  // Set of normalized identifiers seen so far across strategies (e.g.,
  // opinion_ids, statute citations, case citations).
  seen: Set<string>;
  // Per-strategy overlap with the cumulative set.
  perStrategy: Array<{ strategy: string; overlap: number; newCount: number; totalCount: number }>;
  loopDetected: boolean;
  loopReason: string | null;
}

export function newLoopMonitor(): LoopMonitorState {
  return { seen: new Set(), perStrategy: [], loopDetected: false, loopReason: null };
}

/** Returns true if the caller should KEEP running additional strategies. */
export function observe(
  state: LoopMonitorState,
  strategy: string,
  identifiers: string[],
  threshold = 0.8,
): boolean {
  const total = identifiers.length;
  let newCount = 0;
  for (const id of identifiers) {
    if (!state.seen.has(id)) {
      state.seen.add(id);
      newCount++;
    }
  }
  const overlap = total === 0 ? 0 : (total - newCount) / total;
  state.perStrategy.push({ strategy, overlap, newCount, totalCount: total });

  // Need at least 2 strategies before we can declare a loop. The
  // threshold check kicks in at strategy 2+.
  if (state.perStrategy.length >= 2 && overlap >= threshold && total >= 3) {
    state.loopDetected = true;
    state.loopReason = `Strategy ${strategy} returned ${(overlap * 100).toFixed(0)}% known items (${total - newCount}/${total}); stopping to avoid rabbit-holing.`;
    return false;
  }
  return true;
}

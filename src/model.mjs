/** Keep ordinary conversations across workspaces, including all settled results. */
export function deriveTaskRows(list, statuses, archivedIds = [], trackingStartedAt = 0) {
  const archived = new Set(archivedIds);
  const seen = new Set();
  const rows = [];
  for (const id of list.ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const summary = list.byId[id];
    if (!summary || summary.origin === 'subagent' || summary.blank || archived.has(id)) continue;
    const status = statuses.get(id);
    const running = (status?.running ?? summary.running) === true;
    const kind = status?.pendingInteraction?.kind;
    const pendingKind = ['approval', 'plan-review', 'question'].includes(kind) ? kind : null;
    const projection = list.projectionsBySession?.[id];
    const values = projection?.values ?? {};
    const outcome = values.localTaskOutcome;
    const children = values.subagentCatalog ?? [];
    const childIds = new Set();
    for (const child of children) {
      if (child.id === id) continue;
      if ((statuses.get(child.id)?.running ?? list.byId[child.id]?.running) === true) childIds.add(child.id);
    }
    const queued = (values.inbox?.['next-turn']?.length ?? 0) + (values.inbox?.['next-step']?.length ?? 0) > 0;
    let phase = 'unknown';
    if (pendingKind) phase = pendingKind;
    else if (running) phase = 'running';
    else if (childIds.size > 0) phase = 'children';
    else if (queued) phase = 'queued';
    else if (outcome && projection?.state !== 'error') {
      // A stopped runtime or an unread-completion flag is NOT proof of success.
      // Also avoid showing an older successful turn as the result of a newer input.
      if (outcome.phase !== 'running' && Number.isFinite(outcome.endedAt)
        && outcome.endedAt >= (summary.updatedAt ?? 0)
        && ['completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked'].includes(outcome.phase)) phase = outcome.phase;
    }
    rows.push({
      id,
      title: summary.title?.trim() ?? '',
      cwd: summary.cwd ?? '',
      updatedAt: Math.max(summary.updatedAt ?? 0, outcome?.startedAt ?? 0, outcome?.endedAt ?? 0),
      running,
      pendingKind,
      runningChildCount: childIds.size,
      phase,
      // Green is an unread NEW completion reminder, not a permanent success dot.
      newCompletion: phase === 'completed' && status?.completionUnread === true && outcome.endedAt >= trackingStartedAt,
      active: Boolean(pendingKind || running || childIds.size > 0 || queued),
      needsOutcome: !outcome && summary.formatStatus !== 'migration-required' && projection?.state !== 'migration-required',
    });
  }
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Ignore snapshot identity; include unread state only through its visible reminder. */
export function sameRows(left, right) {
  return left === right || left.length === right.length && left.every((a, i) => {
    const b = right[i];
    return a.id === b.id && a.title === b.title && a.cwd === b.cwd && a.updatedAt === b.updatedAt
      && a.running === b.running && a.pendingKind === b.pendingKind && a.runningChildCount === b.runningChildCount
      && a.phase === b.phase && a.newCompletion === b.newCompletion && a.active === b.active && a.needsOutcome === b.needsOutcome;
  });
}

export function currentSessionId(list) {
  return list.ids.find(id => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0);
}

export function directoryLabel(path) {
  const trimmed = path.replace(/[/\\]+$/, '');
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path;
}

/** Plugin-owned view state, projected into both additive seats by Slot hooks. */
export function createPopupState() {
  let snapshot = { open: false };
  let active = true;
  const listeners = new Set();
  function set(open) {
    if (!active || snapshot.open === open) return;
    snapshot = { open };
    for (const notify of [...listeners]) notify();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(notify) {
      if (!active) return () => {};
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    show: () => set(true),
    hide: () => set(false),
    dispose() { active = false; snapshot = { open: false }; listeners.clear(); },
  };
}

/** Cold-safe, deduplicated, bounded projection reads. Never retains an Agent/history. */
export function createOutcomeLoader(refresh, { concurrency = 4 } = {}) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new RangeError('concurrency must be a positive integer');
  let active = true;
  let running = 0;
  const requests = new Map();
  const pending = [];
  function pump() {
    while (active && running < concurrency && pending.length) {
      const item = pending.shift();
      running++;
      let operation;
      try { operation = refresh(item.id); } catch (error) { operation = Promise.reject(error); }
      Promise.resolve(operation).then(
        () => item.resolve({ status: 'fulfilled' }),
        error => item.resolve({ status: 'rejected', error }),
      ).finally(() => { running--; pump(); });
    }
  }
  return {
    request(id) {
      if (!active) return Promise.resolve({ status: 'cancelled' });
      const previous = requests.get(id);
      if (previous) return previous;
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      requests.set(id, promise);
      pending.push({ id, resolve });
      pump();
      return promise;
    },
    dispose() {
      active = false;
      for (const item of pending.splice(0)) item.resolve({ status: 'cancelled' });
      requests.clear();
    },
  };
}

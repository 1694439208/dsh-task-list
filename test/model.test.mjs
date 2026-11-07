import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTaskRows, sameRows, currentSessionId, directoryLabel, createPopupState, createOutcomeLoader,
} from '../src/model.mjs';
import { initialTaskOutcome, applyTaskOutcome } from '../src/outcome.mjs';

const summary = (id, props = {}) => ({ id, title: id, running: false, blank: false, updatedAt: 1, ...props });
const list = (...items) => ({
  ids: items.map(item => item.id),
  byId: Object.fromEntries(items.map(item => [item.id, item])),
  projectionsBySession: {},
});
const outcome = (phase = 'completed', props = {}) => ({ phase, turn: 1, startedAt: 1, endedAt: 2, ...props });
function project(value, id, values, state = 'ready') {
  value.projectionsBySession[id] = { state, values };
  return value;
}
function onlyRow(value, statuses = new Map(), trackingStartedAt = 0) {
  const rows = deriveTaskRows(value, statuses, [], trackingStartedAt);
  assert.equal(rows.length, 1);
  return rows[0];
}
const event = (type, time, data = {}) => ({ type, seq: 1, time, data });
const start = (turn = 1, time = 10) => event('turn/start', time, { turn });
const end = (kind = 'completed', turn = 1, time = 20) => event('turn/end', time, { turn, reason: { kind } });
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
// One bounded event-loop turn drains the loader's promise continuations without sleeps or polling.
const tick = () => new Promise(resolve => setImmediate(resolve));

// Task rows remain navigable independently of runtime activity and workspace grouping.
test('retains running, idle and finished ordinary conversations across workspaces in stable newest-first order', () => {
  const value = list(
    summary('b', { running: true, updatedAt: 2, cwd: 'D:\\b' }),
    summary('a', { updatedAt: 2, cwd: 'D:\\a' }),
    summary('c', { updatedAt: 3, cwd: 'E:\\another-project' }),
  );
  project(value, 'c', { localTaskOutcome: outcome('completed', { endedAt: 3 }) });
  const rows = deriveTaskRows(value, new Map());
  assert.deepEqual(rows.map(row => row.id), ['c', 'a', 'b']);
  assert.equal(rows.find(row => row.id === 'a').phase, 'unknown');
  assert.equal(rows.find(row => row.id === 'b').phase, 'running');
  assert.equal(rows.find(row => row.id === 'c').phase, 'completed');
});

test('live false overrides a stale running summary but the same conversation remains listed', () => {
  const row = onlyRow(list(summary('a', { running: true })), new Map([['a', { running: false }]]));
  assert.equal(row.id, 'a');
  assert.equal(row.running, false);
  assert.equal(row.phase, 'unknown');
  assert.equal(row.active, false);
});

test('live true overrides an idle summary and masks an earlier successful outcome', () => {
  const value = project(list(summary('a')), 'a', { localTaskOutcome: outcome() });
  const row = onlyRow(value, new Map([['a', { running: true }]]));
  assert.equal(row.running, true);
  assert.equal(row.phase, 'running');
  assert.equal(row.active, true);
});

test('uses summary running only when the live status has not established that value', () => {
  const value = list(summary('a', { running: true }));
  assert.equal(onlyRow(value).phase, 'running');
  assert.equal(onlyRow(value, new Map([['a', { completionUnread: true }]])).phase, 'running');
});

test('omits archives, blanks, subagents and missing rows, and deduplicates identities without dropping idle tasks', () => {
  const value = list(
    summary('running', { running: true }), summary('idle'),
    summary('archive'), summary('blank', { running: true, blank: true }),
    summary('child', { running: true, origin: 'subagent' }),
    summary('ordinary-fork', { parentId: 'running' }),
  );
  value.ids.push('running', 'idle', 'missing');
  assert.deepEqual(deriveTaskRows(value, new Map(), ['archive']).map(row => row.id), ['idle', 'ordinary-fork', 'running']);
});

test('running to completed keeps the same session id and navigable row after activity ends', () => {
  const value = list(summary('same-session', { running: true, updatedAt: 10, cwd: 'D:\\project' }));
  project(value, 'same-session', { localTaskOutcome: applyTaskOutcome(initialTaskOutcome(), start(4, 10)) });
  const running = onlyRow(value, new Map([['same-session', { running: true }]]), 20);
  assert.equal(running.phase, 'running');
  assert.equal(running.newCompletion, false);
  value.projectionsBySession['same-session'].values.localTaskOutcome = applyTaskOutcome(
    value.projectionsBySession['same-session'].values.localTaskOutcome, end('completed', 4, 30),
  );
  const completed = onlyRow(value, new Map([['same-session', { running: false, completionUnread: true }]]), 20);
  assert.equal(completed.newCompletion, true);
  assert.equal(completed.id, running.id);
  assert.equal(completed.cwd, running.cwd);
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.active, false);
  assert.equal(completed.updatedAt, 30);
  assert.equal(completed.needsOutcome, false);
});

test('viewing a completion clears its new green marker without removing the row or changing its successful outcome', () => {
  const value = project(list(summary('a', { updatedAt: 10 })), 'a', { localTaskOutcome: outcome('completed', { startedAt: 10, endedAt: 20 }) });
  const before = deriveTaskRows(value, new Map([['a', { running: false, completionUnread: true }]]), [], 15);
  value.byId.a = { ...value.byId.a, retainedBy: { mainView: 1 } };
  const after = deriveTaskRows(value, new Map([['a', { running: false, completionUnread: false }]]), [], 15);
  assert.equal(before.length, 1);
  assert.equal(after.length, 1);
  assert.equal(before[0].phase, 'completed');
  assert.equal(after[0].phase, 'completed');
  assert.equal(before[0].newCompletion, true);
  assert.equal(after[0].newCompletion, false);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].active, false);
  assert.equal(sameRows(before, after), false, 'clearing the green marker must repaint the row');
  assert.equal(sameRows([{ ...before[0], newCompletion: false }], after), true);
});

test('reconnect reconstructs completed tasks from durable events without marking old results newly green', () => {
  const events = [start(8, 50), event('assistant/message', 60, { text: 'done' }), end('completed', 8, 70)];
  const durable = events.reduce(applyTaskOutcome, initialTaskOutcome());
  const first = project(list(summary('a', { updatedAt: 50 })), 'a', { localTaskOutcome: durable });
  const reconnected = JSON.parse(JSON.stringify(first));
  const before = deriveTaskRows(first, new Map([['a', { running: false, completionUnread: true }]]), [], 80);
  const after = deriveTaskRows(reconnected, new Map(), [], 80);
  assert.equal(after[0].phase, 'completed');
  assert.equal(after[0].active, false);
  assert.equal(before[0].newCompletion, false);
  assert.equal(after[0].newCompletion, false);
  assert.equal(sameRows(before, after), true);
});

for (const kind of ['approval', 'question', 'plan-review']) {
  test(`${kind} takes precedence over running, children, queue and a saved successful outcome`, () => {
    const value = list(summary('a', { running: true }), summary('child', { running: true, origin: 'subagent' }));
    project(value, 'a', {
      localTaskOutcome: outcome(), subagentCatalog: [{ id: 'child' }], inbox: { 'next-turn': [{ id: 'queued' }] },
    });
    const row = onlyRow(value, new Map([['a', { running: true, pendingInteraction: { kind } }]]));
    assert.equal(row.pendingKind, kind);
    assert.equal(row.phase, kind);
    assert.equal(row.active, true);
  });
}

test('unknown pending-interaction kinds do not invent activity or successful completion', () => {
  const row = onlyRow(list(summary('a')), new Map([['a', { pendingInteraction: { kind: 'other' }, completionUnread: true }]]));
  assert.equal(row.pendingKind, null);
  assert.equal(row.phase, 'unknown');
  assert.equal(row.active, false);
});

test('an idle parent with running direct children stays active without separately listing subagents', () => {
  const value = list(summary('parent'), summary('child', { running: true, origin: 'subagent' }));
  project(value, 'parent', { subagentCatalog: [{ id: 'child' }, { id: 'child' }, { id: 'unknown', running: true }, { id: 'parent' }] });
  const row = onlyRow(value);
  assert.equal(row.id, 'parent');
  assert.equal(row.runningChildCount, 1);
  assert.equal(row.phase, 'children');
  assert.equal(row.active, true);
});

test('a live stopped child does not resurrect activity from a stale summary or catalog hint', () => {
  const value = list(summary('parent'), summary('child', { running: true, origin: 'subagent' }));
  project(value, 'parent', { subagentCatalog: [{ id: 'child', running: true }] });
  const row = onlyRow(value, new Map([['child', { running: false }]]));
  assert.equal(row.runningChildCount, 0);
  assert.equal(row.phase, 'unknown');
  assert.equal(row.active, false);
});

test('a live child start overrides an idle child summary, while an own running turn takes precedence', () => {
  const value = list(summary('parent'), summary('child', { origin: 'subagent' }));
  project(value, 'parent', { subagentCatalog: [{ id: 'child' }] });
  const statuses = new Map([['child', { running: true }]]);
  assert.equal(onlyRow(value, statuses).phase, 'children');
  statuses.set('parent', { running: true });
  assert.equal(onlyRow(value, statuses).phase, 'running');
});

for (const queue of ['next-turn', 'next-step']) {
  test(`${queue} input keeps a non-running task queued and never shows its older completion as current`, () => {
    const value = project(list(summary('a')), 'a', {
      localTaskOutcome: outcome(), inbox: { 'next-turn': [], 'next-step': [], [queue]: [{ id: 'pending-input' }] },
    });
    const row = onlyRow(value);
    assert.equal(row.running, false);
    assert.equal(row.phase, 'queued');
    assert.equal(row.active, true);
  });
}

test('empty queues do not activate a task, and queued input does not override active children', () => {
  const value = project(list(summary('a')), 'a', { inbox: { 'next-turn': [], 'next-step': [] } });
  assert.equal(onlyRow(value).phase, 'unknown');
  value.ids.push('child');
  value.byId.child = summary('child', { running: true, origin: 'subagent' });
  value.projectionsBySession.a.values = { subagentCatalog: [{ id: 'child' }], inbox: { 'next-turn': [{ id: 'queued' }] } };
  assert.equal(onlyRow(value).phase, 'children');
});

for (const phase of ['completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked']) {
  test(`settled ${phase} tasks remain listed with their own durable phase and no runtime activity`, () => {
    const value = project(list(summary('a', { updatedAt: 10 })), 'a', { localTaskOutcome: outcome(phase, { startedAt: 10, endedAt: 20 }) });
    const row = onlyRow(value, new Map([['a', { running: false, completionUnread: phase === 'completed' }]]));
    assert.equal(row.phase, phase);
    assert.equal(row.active, false);
    assert.equal(row.id, 'a');
    if (phase !== 'completed') assert.notEqual(row.phase, 'completed', 'failed/stopped tasks must not receive the green completed phase');
  });
}

test('a successful outcome older than the latest input is unknown rather than a false green result', () => {
  const value = project(list(summary('a', { updatedAt: 30 })), 'a', { localTaskOutcome: outcome('completed', { startedAt: 10, endedAt: 20 }) });
  const row = onlyRow(value);
  assert.equal(row.phase, 'unknown');
  assert.equal(row.active, false);
  assert.equal(row.needsOutcome, false);
});

test('completion at the latest input timestamp is accepted, including a real zero timestamp', () => {
  for (const timestamp of [0, 10]) {
    const value = project(list(summary('a', { updatedAt: timestamp })), 'a', { localTaskOutcome: outcome('completed', { startedAt: timestamp, endedAt: timestamp }) });
    assert.equal(onlyRow(value).phase, 'completed');
  }
});

test('missing, unfinished and unrecognized outcomes never infer success from unread or an idle runtime', () => {
  for (const saved of [undefined, initialTaskOutcome(), outcome('running', { endedAt: null }), outcome('completed', { endedAt: null }), outcome('completed', { endedAt: undefined }), outcome('future-result')]) {
    const value = project(list(summary('a', { updatedAt: 0 })), 'a', saved === undefined ? {} : { localTaskOutcome: saved });
    const row = onlyRow(value, new Map([['a', { running: false, completionUnread: true }]]));
    assert.equal(row.phase, 'unknown');
    assert.equal(row.active, false);
  }
});

test('projection read failure never exposes a cached successful result as completed', () => {
  const value = project(list(summary('a')), 'a', { localTaskOutcome: outcome() }, 'error');
  const row = onlyRow(value, new Map([['a', { completionUnread: true }]]));
  assert.equal(row.phase, 'unknown');
  assert.equal(row.active, false);
});

test('missing outcomes request a cold read, but missing migration-required outcomes do not', () => {
  const value = list(summary('a'));
  assert.equal(onlyRow(value).needsOutcome, true);
  value.projectionsBySession = undefined;
  assert.equal(onlyRow(value).needsOutcome, true);
  value.projectionsBySession = {};
  project(value, 'a', {}, 'error');
  assert.equal(onlyRow(value).needsOutcome, true);
  project(value, 'a', {}, 'migration-required');
  assert.equal(onlyRow(value).needsOutcome, false);
  assert.equal(onlyRow(value).phase, 'unknown');
  project(value, 'a', {});
  value.byId.a.formatStatus = 'migration-required';
  assert.equal(onlyRow(value).needsOutcome, false);
  delete value.byId.a.formatStatus;
  project(value, 'a', { localTaskOutcome: initialTaskOutcome() });
  assert.equal(onlyRow(value).needsOutcome, false);
});

test('ordering uses the maximum of summary activity, turn start and turn end across projects', () => {
  const value = list(summary('summary', { updatedAt: 300 }), summary('start', { updatedAt: 10 }), summary('end', { updatedAt: 20 }));
  project(value, 'start', { localTaskOutcome: outcome('running', { startedAt: 400, endedAt: null }) });
  project(value, 'end', { localTaskOutcome: outcome('completed', { startedAt: 100, endedAt: 500 }) });
  const rows = deriveTaskRows(value, new Map());
  assert.deepEqual(rows.map(row => [row.id, row.updatedAt]), [['end', 500], ['start', 400], ['summary', 300]]);
});

test('normalizes titles and missing projections without mutating frozen catalog, status or outcome inputs', () => {
  const saved = Object.freeze(outcome());
  const value = project(list(Object.freeze(summary('a', { title: '  ' }))), 'a', { localTaskOutcome: saved });
  Object.freeze(value.ids);
  Object.freeze(value.byId);
  Object.freeze(value.projectionsBySession.a.values);
  Object.freeze(value.projectionsBySession.a);
  Object.freeze(value.projectionsBySession);
  Object.freeze(value);
  const statuses = new Map([['a', Object.freeze({ running: false, completionUnread: false })]]);
  const row = onlyRow(value, statuses);
  assert.equal(row.title, '');
  assert.equal(row.phase, 'completed');
  assert.equal(saved.phase, 'completed');
});

test('sameRows ignores unrelated snapshot identity but tracks every task view field including the new green marker', () => {
  const row = onlyRow(list(summary('a', { running: true })));
  assert.equal(sameRows([row], [{ ...row }]), true);
  assert.equal(sameRows([row], [{ ...row, unrelatedSnapshotRevision: 2 }]), true);
  for (const [key, value] of Object.entries({
    id: 'b', title: 'new', cwd: 'D:\\x', updatedAt: 2, running: false,
    pendingKind: 'question', runningChildCount: 1, phase: 'completed', active: false, needsOutcome: false, newCompletion: true,
  })) assert.equal(sameRows([row], [{ ...row, [key]: value }]), false, key);
  assert.equal(sameRows([row], []), false);
  assert.equal(sameRows([], []), true);
  const other = { ...row, id: 'b' };
  assert.equal(sameRows([row, other], [other, row]), false);
});

// A green dot is a new, unread success notification, not the durable completed phase itself.
test('new completion cutoff is inclusive and compares the durable end time rather than turn start time', () => {
  for (const [endedAt, expected] of [[99, false], [100, true], [101, true]]) {
    const value = project(list(summary('a', { updatedAt: 50 })), 'a', {
      localTaskOutcome: outcome('completed', { startedAt: 50, endedAt }),
    });
    const row = onlyRow(value, new Map([['a', { running: false, completionUnread: true }]]), 100);
    assert.equal(row.phase, 'completed');
    assert.equal(row.newCompletion, expected, `endedAt=${endedAt}`);
    assert.equal(row.id, 'a');
  }
});

test('old successful conversations stay completed but cannot become green from a pre-existing unread flag', () => {
  const value = project(list(summary('historical', { updatedAt: 40 })), 'historical', {
    localTaskOutcome: outcome('completed', { startedAt: 40, endedAt: 80 }),
  });
  for (const status of [undefined, { completionUnread: false }, { completionUnread: true }]) {
    const row = onlyRow(value, status ? new Map([['historical', status]]) : new Map(), 100);
    assert.equal(row.phase, 'completed');
    assert.equal(row.newCompletion, false);
    assert.equal(row.active, false);
    assert.equal(row.needsOutcome, false);
  }
});

test('the tracking cutoff changes notifications only, never task inclusion, outcome, activity time or project ordering', () => {
  const value = list(summary('old', { updatedAt: 40, cwd: 'D:\\old-project' }), summary('new', { updatedAt: 90, cwd: 'E:\\new-project' }));
  project(value, 'old', { localTaskOutcome: outcome('completed', { startedAt: 40, endedAt: 80 }) });
  project(value, 'new', { localTaskOutcome: outcome('completed', { startedAt: 90, endedAt: 120 }) });
  const statuses = new Map([['old', { completionUnread: true }], ['new', { completionUnread: true }]]);
  const all = deriveTaskRows(value, statuses, [], 0);
  const tracked = deriveTaskRows(value, statuses, [], 100);
  assert.deepEqual(all.map(row => [row.id, row.phase, row.updatedAt]), tracked.map(row => [row.id, row.phase, row.updatedAt]));
  assert.deepEqual(tracked.map(row => [row.id, row.newCompletion]), [['new', true], ['old', false]]);
  assert.deepEqual(all.map(row => row.newCompletion), [true, true]);
});

test('omitting trackingStartedAt keeps the documented zero cutoff without inventing unread status', () => {
  const value = project(list(summary('a', { updatedAt: 0 })), 'a', {
    localTaskOutcome: outcome('completed', { startedAt: 0, endedAt: 0 }),
  });
  const statuses = new Map([['a', { completionUnread: true }]]);
  assert.deepEqual(deriveTaskRows(value, statuses), deriveTaskRows(value, statuses, [], 0));
  assert.equal(deriveTaskRows(value, statuses)[0].newCompletion, true);
  assert.equal(deriveTaskRows(value, new Map())[0].newCompletion, false);
});

test('a fresh completed outcome needs an explicit true system unread flag before showing a green marker', () => {
  const value = project(list(summary('a', { updatedAt: 50 })), 'a', {
    localTaskOutcome: outcome('completed', { startedAt: 50, endedAt: 150 }),
  });
  for (const status of [undefined, {}, { completionUnread: false }, { completionUnread: null }, { completionUnread: 1 }, { completionUnread: 'true' }]) {
    const row = onlyRow(value, status ? new Map([['a', status]]) : new Map(), 100);
    assert.equal(row.phase, 'completed');
    assert.equal(row.newCompletion, false);
  }
  assert.equal(onlyRow(value, new Map([['a', { completionUnread: true }]]), 100).newCompletion, true);
});

test('a new run clears an old marker, then a newly unread completion can green the same conversation again', () => {
  const value = project(list(summary('same', { updatedAt: 90 })), 'same', {
    localTaskOutcome: outcome('completed', { turn: 1, startedAt: 90, endedAt: 110 }),
  });
  const statuses = new Map([['same', { running: false, completionUnread: true }]]);
  assert.equal(onlyRow(value, statuses, 100).newCompletion, true);
  value.byId.same.updatedAt = 120;
  statuses.set('same', { running: true, completionUnread: true });
  assert.equal(onlyRow(value, statuses, 100).newCompletion, false, 'a stale unread flag cannot green an active run');
  value.projectionsBySession.same.values.localTaskOutcome = applyTaskOutcome(
    value.projectionsBySession.same.values.localTaskOutcome, start(2, 120),
  );
  assert.equal(onlyRow(value, statuses, 100).phase, 'running');
  value.projectionsBySession.same.values.localTaskOutcome = applyTaskOutcome(
    value.projectionsBySession.same.values.localTaskOutcome, end('completed', 2, 140),
  );
  statuses.set('same', { running: false, completionUnread: true });
  const completed = onlyRow(value, statuses, 100);
  assert.equal(completed.id, 'same');
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.newCompletion, true);
  statuses.set('same', { running: false, completionUnread: false });
  const read = onlyRow(value, statuses, 100);
  assert.equal(read.id, completed.id);
  assert.equal(read.phase, 'completed');
  assert.equal(read.newCompletion, false);
});

test('failed, stopped, unknown, unfinished, stale and unreadable outcomes never become newly green', () => {
  for (const phase of ['error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked', 'unknown', 'running', 'future-result']) {
    const value = project(list(summary('a', { updatedAt: 50 })), 'a', {
      localTaskOutcome: outcome(phase, { startedAt: 50, endedAt: 150 }),
    });
    const row = onlyRow(value, new Map([['a', { running: false, completionUnread: true }]]), 100);
    assert.notEqual(row.phase, 'completed', phase);
    assert.equal(row.newCompletion, false, phase);
  }
  for (const [saved, projectionState, updatedAt] of [
    [undefined, 'ready', 50],
    [outcome('completed', { endedAt: null }), 'ready', 0],
    [outcome('completed', { endedAt: 150 }), 'ready', 200],
    [outcome('completed', { endedAt: 150 }), 'error', 50],
  ]) {
    const value = project(list(summary('a', { updatedAt })), 'a', saved ? { localTaskOutcome: saved } : {}, projectionState);
    const row = onlyRow(value, new Map([['a', { completionUnread: true }]]), 100);
    assert.equal(row.phase, 'unknown');
    assert.equal(row.newCompletion, false);
  }
});

test('every active phase suppresses a previous successful unread result even when its end passes the cutoff', () => {
  for (const phase of ['running', 'approval', 'question', 'plan-review', 'children', 'queued']) {
    const value = list(summary('a', { updatedAt: 50 }), summary('child', { origin: 'subagent' }));
    project(value, 'a', {
      localTaskOutcome: outcome('completed', { startedAt: 50, endedAt: 150 }),
      ...(phase === 'children' ? { subagentCatalog: [{ id: 'child' }] } : {}),
      ...(phase === 'queued' ? { inbox: { 'next-turn': [{ id: 'next' }] } } : {}),
    });
    const statuses = new Map([['a', {
      running: phase === 'running', completionUnread: true,
      ...(['approval', 'question', 'plan-review'].includes(phase) ? { pendingInteraction: { kind: phase } } : {}),
    }]]);
    if (phase === 'children') statuses.set('child', { running: true });
    const row = onlyRow(value, statuses, 100);
    assert.equal(row.phase, phase);
    assert.equal(row.active, true);
    assert.equal(row.newCompletion, false, phase);
  }
});

test('sameRows still ignores unread changes when the cutoff suppresses the marker in both snapshots', () => {
  const value = project(list(summary('a', { updatedAt: 50 })), 'a', {
    localTaskOutcome: outcome('completed', { startedAt: 50, endedAt: 80 }),
  });
  const unread = deriveTaskRows(value, new Map([['a', { completionUnread: true }]]), [], 100);
  const read = deriveTaskRows(value, new Map([['a', { completionUnread: false }]]), [], 100);
  assert.equal(unread[0].newCompletion, false);
  assert.equal(read[0].newCompletion, false);
  assert.equal(sameRows(unread, read), true);
});

// Only durable turn boundaries establish a task outcome.
test('task outcome starts explicitly unknown without invented timestamps', () => {
  assert.deepEqual(initialTaskOutcome(), { phase: 'unknown', turn: null, startedAt: null, endedAt: null });
});

test('turn/start opens the new turn and clears any prior settled result', () => {
  const previous = Object.freeze(outcome('completed', { turn: 1, startedAt: 10, endedAt: 20 }));
  const next = applyTaskOutcome(previous, start(2, 30));
  assert.deepEqual(next, { phase: 'running', turn: 2, startedAt: 30, endedAt: null });
  assert.equal(previous.phase, 'completed');
});

for (const phase of ['completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked']) {
  test(`turn/end records ${phase} without rewriting it into success`, () => {
    const running = Object.freeze(applyTaskOutcome(initialTaskOutcome(), start(7, 10)));
    const settled = applyTaskOutcome(running, end(phase, 7, 20));
    assert.deepEqual(settled, { phase, turn: 7, startedAt: 10, endedAt: 20 });
    assert.notEqual(settled, running);
    assert.equal(running.phase, 'running');
  });
}

test('unknown or missing turn-end reasons produce unknown rather than preserving an earlier success', () => {
  for (const reason of [{ kind: 'future-end-reason' }, {}, null, undefined]) {
    const previous = Object.freeze(outcome());
    const result = applyTaskOutcome(previous, event('turn/end', 30, { turn: 2, reason }));
    assert.equal(result.phase, 'unknown');
    assert.equal(result.endedAt, 30);
  }
});

test('an observed end without a start does not fabricate a start timestamp', () => {
  assert.deepEqual(applyTaskOutcome(initialTaskOutcome(), end('completed', 3, 25)), {
    phase: 'completed', turn: 3, startedAt: null, endedAt: 25,
  });
});

test('all non-boundary events return the original outcome reference', () => {
  for (const state of [initialTaskOutcome(), applyTaskOutcome(initialTaskOutcome(), start()), outcome()]) {
    Object.freeze(state);
    for (const type of ['assistant/message', 'tool/call', 'tool/result', 'user/message', 'agent/status', 'unknown/event']) {
      assert.equal(applyTaskOutcome(state, event(type, 100, { running: false, completed: true })), state, type);
    }
  }
});

// Cold projection reads stay bounded, deduplicated and separate from outcome truth.
test('outcome loader defaults to at most four concurrent reads and drains its queue', async t => {
  const gates = new Map(Array.from({ length: 9 }, (_, index) => [String(index), deferred()]));
  const started = [];
  let inFlight = 0;
  let peak = 0;
  const loader = createOutcomeLoader(async id => {
    started.push(id);
    peak = Math.max(peak, ++inFlight);
    try { await gates.get(id).promise; } finally { inFlight--; }
  });
  const requests = [...gates.keys()].map(id => loader.request(id));
  t.after(async () => { loader.dispose(); for (const gate of gates.values()) gate.resolve(); await Promise.all(requests); });
  await tick();
  assert.equal(started.length, 4);
  assert.equal(inFlight, 4);
  gates.get(started[0]).resolve();
  await tick();
  assert.equal(started.length, 5);
  assert.equal(inFlight, 4);
  for (const gate of gates.values()) gate.resolve();
  assert.deepEqual(await Promise.all(requests), requests.map(() => ({ status: 'fulfilled' })));
  await tick();
  assert.equal(started.length, 9);
  assert.equal(new Set(started).size, 9);
  assert.equal(inFlight, 0);
  assert.equal(peak, 4);
});

test('outcome loader deduplicates running, queued and already fulfilled ids to the same Promise', async t => {
  const gates = new Map([['a', deferred()], ['b', deferred()]]);
  const started = [];
  const loader = createOutcomeLoader(id => { started.push(id); return gates.get(id).promise; }, { concurrency: 1 });
  const a = loader.request('a');
  const b = loader.request('b');
  t.after(async () => { loader.dispose(); for (const gate of gates.values()) gate.resolve(); await Promise.all([a, b]); });
  assert.equal(loader.request('a'), a);
  assert.equal(loader.request('b'), b);
  await tick();
  assert.deepEqual(started, ['a']);
  gates.get('a').resolve();
  assert.deepEqual(await a, { status: 'fulfilled' });
  await tick();
  assert.deepEqual(started, ['a', 'b']);
  gates.get('b').resolve();
  assert.deepEqual(await b, { status: 'fulfilled' });
  assert.equal(loader.request('a'), a);
  assert.equal(loader.request('b'), b);
  await tick();
  assert.deepEqual(started, ['a', 'b']);
});

test('outcome loader respects an explicit smaller concurrency limit', async t => {
  const gate = deferred();
  const started = [];
  const loader = createOutcomeLoader(id => { started.push(id); return gate.promise; }, { concurrency: 2 });
  const requests = ['a', 'b', 'c'].map(id => loader.request(id));
  t.after(async () => { loader.dispose(); gate.resolve(); await Promise.all(requests); });
  await tick();
  assert.equal(started.length, 2);
  gate.resolve();
  assert.deepEqual(await Promise.all(requests), requests.map(() => ({ status: 'fulfilled' })));
  assert.equal(started.length, 3);
});

test('synchronous read errors resolve rejected results, release capacity and are cached without retry', async () => {
  const error = new Error('projection read failed');
  const started = [];
  const loader = createOutcomeLoader(id => {
    started.push(id);
    if (id === 'bad') throw error;
  }, { concurrency: 1 });
  try {
    const failed = loader.request('bad');
    const good = loader.request('good');
    assert.deepEqual(await failed, { status: 'rejected', error });
    assert.deepEqual(await good, { status: 'fulfilled' });
    assert.equal(loader.request('bad'), failed);
    const duplicates = Array.from({ length: 20 }, () => loader.request('bad'));
    assert.ok(duplicates.every(promise => promise === failed));
    assert.ok((await Promise.all(duplicates)).every(result => result.status === 'rejected' && result.error === error));
    await tick();
    assert.deepEqual(started, ['bad', 'good']);
  } finally { loader.dispose(); }
});

test('asynchronous read rejection never rejects the public Promise or fabricates a successful task outcome', async () => {
  const error = new Error('network unavailable');
  const value = list(summary('a'));
  let reads = 0;
  const loader = createOutcomeLoader(async () => { reads++; throw error; });
  try {
    const request = loader.request('a');
    const result = await request;
    assert.deepEqual(result, { status: 'rejected', error });
    assert.equal(loader.request('a'), request);
    assert.equal(reads, 1);
    const row = onlyRow(value, new Map([['a', { completionUnread: true }]]));
    assert.equal(row.phase, 'unknown');
    assert.equal(row.needsOutcome, true);
    assert.equal(row.id, 'a');
  } finally { loader.dispose(); }
});

test('dispose cancels reads still queued, lets started reads finish and starts no more work', async t => {
  const gate = deferred();
  const started = [];
  const loader = createOutcomeLoader(id => { started.push(id); return gate.promise; }, { concurrency: 1 });
  const active = loader.request('active');
  const queued = loader.request('queued');
  const anotherQueued = loader.request('another-queued');
  t.after(async () => { loader.dispose(); gate.resolve(); await Promise.all([active, queued, anotherQueued]); });
  await tick();
  assert.deepEqual(started, ['active']);
  loader.dispose();
  loader.dispose();
  assert.deepEqual(await queued, { status: 'cancelled' });
  assert.deepEqual(await anotherQueued, { status: 'cancelled' });
  assert.deepEqual(await loader.request('after-dispose'), { status: 'cancelled' });
  gate.resolve();
  assert.deepEqual(await active, { status: 'fulfilled' });
  await tick();
  assert.deepEqual(started, ['active']);
});

test('immediate disposal never defers a new read until after the loader has been disposed', async t => {
  const gate = deferred();
  const started = [];
  let disposed = false;
  const loader = createOutcomeLoader(id => {
    assert.equal(disposed, false, 'an actual refresh must not start after dispose');
    started.push(id);
    return gate.promise;
  }, { concurrency: 1 });
  const active = loader.request('active');
  const queued = loader.request('queued');
  t.after(async () => { loader.dispose(); gate.resolve(); await Promise.all([active, queued]); });
  loader.dispose();
  disposed = true;
  assert.deepEqual(await queued, { status: 'cancelled' });
  gate.resolve();
  assert.deepEqual(await active, { status: 'fulfilled' });
  await tick();
  assert.deepEqual(started, ['active']);
});

test('an in-flight failure after dispose settles as rejected without reviving queued reads', async t => {
  const gate = deferred();
  const error = new Error('late read failure');
  const started = [];
  const loader = createOutcomeLoader(id => { started.push(id); return gate.promise; }, { concurrency: 1 });
  const active = loader.request('active');
  const queued = loader.request('queued');
  t.after(async () => { loader.dispose(); gate.resolve(); await Promise.all([active, queued]); });
  await tick();
  loader.dispose();
  gate.reject(error);
  assert.deepEqual(await active, { status: 'rejected', error });
  assert.deepEqual(await queued, { status: 'cancelled' });
  await tick();
  assert.deepEqual(started, ['active']);
});

test('disposing before any request prevents all reads', async () => {
  let reads = 0;
  const loader = createOutcomeLoader(() => { reads++; });
  loader.dispose();
  assert.deepEqual(await loader.request('a'), { status: 'cancelled' });
  await tick();
  assert.equal(reads, 0);
});

// Existing view-state, navigation identity and directory-label contracts remain unchanged.
test('selection comes from mainView retention, not from other references', () => {
  assert.equal(currentSessionId(list(summary('a', { retainedBy: { gateway: 1 } }), summary('b', { retainedBy: { mainView: 1 } }))), 'b');
});
test('directory labels support Windows, POSIX and root paths', () => {
  assert.equal(directoryLabel('D:\\wxapp\\'), 'wxapp');
  assert.equal(directoryLabel('/home/user/project/'), 'project');
  assert.equal(directoryLabel('/'), '/');
  assert.equal(directoryLabel('D:\\'), 'D:');
});
test('popup show and hide publish shared immutable snapshots only on changes', () => {
  const popup = createPopupState();
  const initial = popup.getSnapshot();
  let changes = 0;
  popup.subscribe(() => changes++);
  popup.hide();
  assert.equal(popup.getSnapshot(), initial);
  popup.show();
  assert.equal(initial.open, false);
  assert.equal(popup.getSnapshot().open, true);
  const opened = popup.getSnapshot();
  popup.show();
  assert.equal(popup.getSnapshot(), opened);
  popup.hide();
  assert.equal(popup.getSnapshot().open, false);
  assert.equal(changes, 2);
});
test('popup unsubscribe and teardown are idempotent', () => {
  const popup = createPopupState();
  let changes = 0;
  const unsubscribe = popup.subscribe(() => changes++);
  popup.show();
  unsubscribe(); unsubscribe();
  popup.hide();
  assert.equal(changes, 1);
  popup.dispose(); popup.dispose();
  popup.show();
  assert.equal(popup.getSnapshot().open, false);
  assert.equal(changes, 1);
});
test('closed popup state cannot acquire new observers or reopen after disposal', () => {
  const popup = createPopupState();
  popup.show(); popup.dispose();
  let notified = false;
  popup.subscribe(() => { notified = true; });
  popup.show(); popup.hide();
  assert.equal(popup.getSnapshot().open, false);
  assert.equal(notified, false);
});
test('UI registers only additive seats, with no workspace adapter or activation diagnostic', async () => {
  const { readFile } = await import('node:fs/promises');
  const ui = await readFile(new URL('../src/ui.mjs', import.meta.url), 'utf8');
  assert.equal(ui.includes('sidebar.workspaces'), false);
  assert.equal(ui.includes('entriesOfSlot'), false);
  assert.equal(ui.includes('local-rs-error'), false);
  assert.equal(ui.includes("name: 'sidebar.footer.action'"), true);
  assert.equal(ui.includes("name: 'shell.overlay'"), true);
  assert.equal(ui.includes('dialog.showModal()'), true);
  assert.equal(ui.includes('document.body'), false);
});

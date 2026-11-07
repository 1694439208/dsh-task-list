/** Durable last-turn result, folded by the Host projection registry, never the UI. */
export function initialTaskOutcome() {
  return { phase: 'unknown', turn: null, startedAt: null, endedAt: null };
}

export function applyTaskOutcome(state, event) {
  if (event.type === 'turn/start') {
    return { phase: 'running', turn: event.data.turn, startedAt: event.time, endedAt: null };
  }
  if (event.type !== 'turn/end') return state;
  const kind = event.data.reason?.kind;
  const phase = ['completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked'].includes(kind) ? kind : 'unknown';
  return { phase, turn: event.data.turn, startedAt: state.startedAt, endedAt: event.time };
}

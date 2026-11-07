import { z } from 'zod';
import { initialTaskOutcome, applyTaskOutcome } from './src/outcome.mjs';

// Zod is an explicit package dependency, matching the Harness schema runtime.
// The new key only caches facts already in the session log; no events are added.
export const inject = ['sessionProjections'];
export function apply(ctx) {
  const schema = z.object({
    phase: z.enum(['unknown', 'running', 'completed', 'error', 'aborted', 'blocked', 'max-tokens', 'interrupted', 'forked']),
    turn: z.number().int().nonnegative().nullable(),
    startedAt: z.number().nonnegative().nullable(),
    endedAt: z.number().nonnegative().nullable(),
  });
  ctx.sessionProjections.register({
    key: 'localTaskOutcome', stateVersion: 1, stateSchema: schema,
    init: initialTaskOutcome, apply: applyTaskOutcome,
    wire: { viewSchema: schema, view: state => state },
  });
}

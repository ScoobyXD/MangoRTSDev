const localContextSequences = new Map<string, number>();

/** Returns a local monotonic sequence for one shared context stream. */
export function nextLocalContextSequence(contextID: string, now = Date.now()): number {
  const previous = localContextSequences.get(contextID) ?? 0;
  const next = Math.max(previous + 1, now);
  localContextSequences.set(contextID, next);
  return next;
}
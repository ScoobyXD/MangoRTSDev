export type ContextMutationEnvelope = {
  context_id: string;
  source_module_id: string;
  sequence: number;
  timestamp: string;
  user_action_type: string;
};

/**
 * Returns true only when this event is newer than what we already applied.
 */
export function isNewerSequence(lastAppliedSequence: number, incomingSequence: number): boolean {
  return incomingSequence > lastAppliedSequence;
}

/**
 * Detects a missing sequence window.
 */
export function hasSequenceGap(lastAppliedSequence: number, incomingSequence: number): boolean {
  return incomingSequence > lastAppliedSequence + 1;
}

/**
 * Reads sequence only from the canonical envelope.
 * Legacy revision-only payloads are treated as zero (ignored by sequence guards).
 */
export function readIncomingSequence(detail: { envelope?: ContextMutationEnvelope }): number {
  if (detail.envelope && Number.isFinite(detail.envelope.sequence)) return detail.envelope.sequence;
  return 0;
}

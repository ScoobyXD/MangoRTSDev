export type ContextMutationEnvelope = {
  context_id: string;
  source_module_id: string;
  sequence: number;
  timestamp: string;
  user_action_type: string;
};

export type LegacyRevisionDetail = { revision?: number };

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
 * Reads sequence from the new contract envelope and falls back to legacy revision.
 *
 * Junior engineer note:
 * We keep this fallback so old events do not break during migration.
 */
export function readIncomingSequence(detail: { envelope?: ContextMutationEnvelope } & LegacyRevisionDetail): number {
  if (detail.envelope && Number.isFinite(detail.envelope.sequence)) return detail.envelope.sequence;
  return typeof detail.revision === "number" ? detail.revision : 0;
}

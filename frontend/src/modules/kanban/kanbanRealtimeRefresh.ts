export const KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS = 750;
export const KANBAN_REALTIME_REFRESH_DEBOUNCE_MS = 80;

export function kanbanRealtimeCanonicalRefreshDelayMs(
  now: number,
  lastLocalMutationAt: number,
  pendingLocalMutations: number,
): number {
  if (pendingLocalMutations > 0) return KANBAN_REALTIME_REFRESH_DEBOUNCE_MS;
  if (lastLocalMutationAt <= 0) return 0;
  const elapsed = Math.max(0, now - lastLocalMutationAt);
  return Math.max(0, KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS - elapsed);
}
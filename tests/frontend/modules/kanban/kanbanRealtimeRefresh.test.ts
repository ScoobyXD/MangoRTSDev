import test from "node:test";
import assert from "node:assert/strict";
import {
  kanbanRealtimeCanonicalRefreshDelayMs,
  KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS,
  KANBAN_REALTIME_REFRESH_DEBOUNCE_MS,
} from "../../../../frontend/src/modules/kanban/kanbanRealtimeRefresh.js";

test("board realtime refresh waits out local mutations without dropping the pending refresh", () => {
  const now = 10_000;

  assert.equal(kanbanRealtimeCanonicalRefreshDelayMs(now, 0, 0), 0);
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, 0, 1),
    KANBAN_REALTIME_REFRESH_DEBOUNCE_MS,
  );
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, now - 250, 0),
    KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS - 250,
  );
  assert.equal(
    kanbanRealtimeCanonicalRefreshDelayMs(now, now - KANBAN_REALTIME_LOCAL_ECHO_COALESCE_MS, 0),
    0,
  );
});
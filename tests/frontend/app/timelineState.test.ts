import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_TIMELINE_DEFAULT_DURATION_MINUTES,
  alignTimelineMinute,
  createDefaultAppTimelineState,
  setTimelineRange,
  updateTimelineItemTiming,
  upsertTimelineDropsAt,
} from "../../../frontend/src/app/timelineState.js";

test("timeline ranges and item drops snap to 15 minute increments", () => {
  const ranged = setTimelineRange(createDefaultAppTimelineState(), 7 * 60 + 7, 16 * 60 + 52);
  assert.equal(ranged.startMinute, 7 * 60);
  assert.equal(ranged.endMinute, 16 * 60 + 45);
  assert.equal(alignTimelineMinute(8 * 60 + 22), 8 * 60 + 15);

  const next = upsertTimelineDropsAt(ranged, [
    { kind: "node", entityID: "node-1", label: "Draft contract" },
    { kind: "logic_gate", entityID: "gate-1", label: "Approval gate" },
  ], 8 * 60 + 7);

  assert.deepEqual(next.items.map((item) => ({
    kind: item.kind,
    entityID: item.entityID,
    startMinute: item.startMinute,
    endMinute: item.endMinute,
  })), [
    {
      kind: "node",
      entityID: "node-1",
      startMinute: 8 * 60,
      endMinute: 8 * 60 + APP_TIMELINE_DEFAULT_DURATION_MINUTES,
    },
    {
      kind: "logic_gate",
      entityID: "gate-1",
      startMinute: 9 * 60,
      endMinute: 9 * 60 + APP_TIMELINE_DEFAULT_DURATION_MINUTES,
    },
  ]);
});

test("timeline drops upsert by entity and resizing stays inside the workday", () => {
  const state = upsertTimelineDropsAt(createDefaultAppTimelineState(), [
    { kind: "node", entityID: "node-1", label: "Initial title" },
  ], 8 * 60);
  const updated = upsertTimelineDropsAt(state, [
    { kind: "node", entityID: "node-1", label: "Renamed title" },
  ], 10 * 60 + 4);

  assert.equal(updated.items.length, 1);
  assert.equal(updated.items[0]?.label, "Renamed title");
  assert.equal(updated.items[0]?.startMinute, 10 * 60);

  const resized = updateTimelineItemTiming(updated, updated.items[0]?.id ?? "", 4 * 60, 23 * 60);
  assert.equal(resized.items[0]?.startMinute, 8 * 60);
  assert.equal(resized.items[0]?.endMinute, 17 * 60);
});

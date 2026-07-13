import test from "node:test";
import assert from "node:assert/strict";
import {
  APP_TIMELINE_DEFAULT_DURATION_MINUTES,
  alignTimelineMinute,
  createDefaultAppTimelineState,
  rollTimelineStateToDate,
  setTimelineRange,
  updateTimelineItemCompleted,
  updateTimelineItemTiming,
  upsertTimelineDropsAt,
} from "../../../frontend/src/app/timelineState.js";
import {
  isCommittedTitleUpdateForCompany,
  reconcileAppDockTabTitles,
  reconcileAppLogicGateTargetTitle,
  reconcileAppNodePopupTitle,
  reconcileAppSidebarPinTitles,
  resolveCurrentAppSidebarPin,
  reconcileAppTimelineTitles,
} from "../../../frontend/src/app/appCommittedTitleState.js";
import type { AppDockTab } from "../../../frontend/src/app/appDockTabs.js";
import type { SidebarPin } from "../../../frontend/src/app/sidebarPins.js";

import {
  foldLatestCommittedEntityTitles,
  publishCommittedEntityTitleUpdate,
  resetCommittedEntityTitleRegistryForTests,
} from "../../../frontend/src/modules/realtime/committedEntityTitleUpdates.js";
test("timeline ranges and item drops snap to 5 minute increments", () => {
  const ranged = setTimelineRange(createDefaultAppTimelineState(), 7 * 60 + 7, 16 * 60 + 52);
  assert.equal(ranged.startMinute, 7 * 60 + 5);
  assert.equal(ranged.endMinute, 16 * 60 + 50);
  assert.equal(alignTimelineMinute(8 * 60 + 22), 8 * 60 + 20);

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
      startMinute: 8 * 60 + 5,
      endMinute: 8 * 60 + 5 + APP_TIMELINE_DEFAULT_DURATION_MINUTES,
    },
    {
      kind: "logic_gate",
      entityID: "gate-1",
      startMinute: 9 * 60 + 5,
      endMinute: 9 * 60 + 5 + APP_TIMELINE_DEFAULT_DURATION_MINUTES,
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
  assert.equal(updated.items[0]?.startMinute, 10 * 60 + 5);

  const resized = updateTimelineItemTiming(updated, updated.items[0]?.id ?? "", 4 * 60, 23 * 60);
  assert.equal(resized.items[0]?.startMinute, 8 * 60);
  assert.equal(resized.items[0]?.endMinute, 17 * 60);

  const compact = updateTimelineItemTiming(updated, updated.items[0]?.id ?? "", 11 * 60, 11 * 60 + 5);
  assert.equal(compact.items[0]?.startMinute, 11 * 60);
  assert.equal(compact.items[0]?.endMinute, 11 * 60 + 5);
});

test("timeline completion persists on items and daily rollover archives current items", () => {
  const state = upsertTimelineDropsAt(createDefaultAppTimelineState("2026-05-20"), [
    { kind: "node", entityID: "node-1", label: "Write launch plan" },
  ], 10 * 60);
  const itemID = state.items[0]?.id ?? "";
  const completed = updateTimelineItemCompleted(state, itemID, true);

  assert.equal(completed.items[0]?.completed, true);
  assert.equal(typeof completed.items[0]?.completedAt, "number");

  const rolled = rollTimelineStateToDate(completed, "2026-05-21");
  assert.equal(rolled.currentDate, "2026-05-21");
  assert.equal(rolled.items.length, 0);
  assert.equal(rolled.history[0]?.date, "2026-05-20");
  assert.equal(rolled.history[0]?.items[0]?.completed, true);
});

test("committed titles reconcile taskbar storage and popup parent labels", () => {
  const update = { companyID: "company-1", entityType: "node" as const, resourceID: "node-1", title: "Renamed node" };
  assert.equal(isCommittedTitleUpdateForCompany(update, "company-1"), true);
  assert.equal(isCommittedTitleUpdateForCompany(update, "company-2"), false);

  const tabs: AppDockTab[] = [
    { id: "node-tab", kind: "node", entityID: "node-1", label: "Old node", pinned: false, createdAt: 1, updatedAt: 17 },
    { id: "gate-tab", kind: "logic_gate_arena", entityID: "node-1", label: "Unrelated gate", pinned: false, createdAt: 1, updatedAt: 1 },
    { id: "project-tab", kind: "project", entityID: "node-1", label: "Unrelated project", pinned: false, createdAt: 1, updatedAt: 1 },
  ];
  const renamedTabs = reconcileAppDockTabTitles(tabs, update);
  assert.equal(renamedTabs[0]?.label, "Renamed node");
  assert.equal(renamedTabs[0]?.updatedAt, 17, "passive convergence must not reorder dock recency");
  assert.equal(renamedTabs[1]?.label, "Unrelated gate");
  assert.equal(renamedTabs[2]?.label, "Unrelated project");
  assert.equal(reconcileAppDockTabTitles(renamedTabs, update), renamedTabs, "an already reconciled dock must preserve state identity");

  const pins: SidebarPin[] = [
    { pinID: "pin-node", id: "node-1", kind: "node", name: "Old node", position: 0, createdTimestamp: "2026-07-13T00:00:00Z" },
    { pinID: "pin-gate", id: "node-1", kind: "logic_gate", name: "Unrelated gate", position: 1, createdTimestamp: "2026-07-13T00:00:00Z" },
  ];
  const renamedPins = reconcileAppSidebarPinTitles(pins, update);
  assert.deepEqual(renamedPins.map((pin) => pin.name), ["Renamed node", "Unrelated gate"]);
  assert.equal(reconcileAppSidebarPinTitles(renamedPins, update), renamedPins);
  assert.equal(resolveCurrentAppSidebarPin(renamedPins, pins[0] as SidebarPin).name, "Renamed node");
  assert.equal(resolveCurrentAppSidebarPin([], pins[0] as SidebarPin), pins[0], "a missing current prop falls back to the open-menu snapshot");

  let timeline = upsertTimelineDropsAt(createDefaultAppTimelineState("2026-05-20"), [
    { kind: "node", entityID: "node-1", label: "Old node" },
    { kind: "logic_gate", entityID: "gate-1", label: "Old gate" },
  ], 8 * 60);
  timeline = rollTimelineStateToDate(timeline, "2026-05-21");
  timeline = upsertTimelineDropsAt(timeline, [
    { kind: "node", entityID: "node-1", label: "Old node today" },
    { kind: "logic_gate", entityID: "gate-1", label: "Old gate today" },
  ], 8 * 60);
  const renamedTimeline = reconcileAppTimelineTitles(timeline, update);
  assert.equal(renamedTimeline.items.find((item) => item.entityID === "node-1")?.label, "Renamed node");
  assert.equal(renamedTimeline.history[0]?.items.find((item) => item.entityID === "node-1")?.label, "Renamed node");
  assert.equal(renamedTimeline.items.find((item) => item.entityID === "gate-1")?.label, "Old gate today");
  assert.equal(reconcileAppTimelineTitles(renamedTimeline, update), renamedTimeline, "an already reconciled timeline must preserve state identity");

  const popup = { nodeID: "node-1", nodeTitle: "Old node", focusRequestID: 7 };
  assert.deepEqual(reconcileAppNodePopupTitle(popup, update), { ...popup, nodeTitle: "Renamed node" });
  const gateTarget = { logicGateID: "gate-1", label: "Old gate", requestID: 9 };
  assert.equal(reconcileAppLogicGateTargetTitle(gateTarget, update), gateTarget);

  const gateUpdate = { companyID: "company-1", entityType: "logic_gate" as const, resourceID: "gate-1", title: "Renamed gate" };
  assert.deepEqual(reconcileAppLogicGateTargetTitle(gateTarget, gateUpdate), { ...gateTarget, label: "Renamed gate" });
  const gateTimeline = reconcileAppTimelineTitles(renamedTimeline, gateUpdate);
  assert.equal(gateTimeline.items.find((item) => item.entityID === "gate-1")?.label, "Renamed gate");
  assert.equal(gateTimeline.history[0]?.items.find((item) => item.entityID === "gate-1")?.label, "Renamed gate");

  resetCommittedEntityTitleRegistryForTests();
  publishCommittedEntityTitleUpdate(update, new EventTarget());
  const stalePinResponse: SidebarPin[] = [
    { pinID: "pin-node", id: "node-1", kind: "node", name: "Persisted stale node", position: 0, createdTimestamp: "2026-07-13T00:00:00Z" },
    { pinID: "pin-project", id: "node-1", kind: "project", name: "Project stays unchanged", position: 1, createdTimestamp: "2026-07-13T00:00:00Z" },
  ];
  assert.deepEqual(
    foldLatestCommittedEntityTitles(stalePinResponse, "company-1", reconcileAppSidebarPinTitles).map((pin) => pin.name),
    ["Renamed node", "Project stays unchanged"],
    "persisted pin responses cannot restore an older locally committed title",
  );
  resetCommittedEntityTitleRegistryForTests();
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { orderedUpdateSelection, resolveUpdateClickSelection, resolveUpdateSeenPresentation, resolveUpdateSeenSuccessor, updatesNotificationEventRequiresReload } from "../../../../frontend/src/pages/home/updatesSelection.js";
import { resolveCurrentUpdateLogicGateGroupValue, resolveCurrentUpdateLogicGateLabel, resolveUpdateLogicGateID } from "../../../../frontend/src/pages/home/updatesCurrentEntityLabels.js";
import { createSeenUpdatesDateWindow, moveSeenUpdatesDateWindow, seenUpdatesDateBounds, seenUpdatesDateQuery } from "../../../../frontend/src/pages/home/updatesSeenHistory.js";

test("update selection uses single-click, ctrl-click, and additive shift-click semantics", () => {
  const orderedIDs = ["a", "b", "c", "d"];
  const first = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: new Set(),
    anchorID: "",
    clickedID: "b",
    shiftKey: false,
    ctrlKey: false,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, first.selectedIDs), ["b"]);
  assert.equal(first.anchorID, "b");

  const toggled = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: first.selectedIDs,
    anchorID: first.anchorID,
    clickedID: "d",
    shiftKey: false,
    ctrlKey: true,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, toggled.selectedIDs), ["b", "d"]);
  assert.equal(toggled.anchorID, "d");

  const ranged = resolveUpdateClickSelection({
    orderedIDs,
    previousSelectedIDs: toggled.selectedIDs,
    anchorID: toggled.anchorID,
    clickedID: "a",
    shiftKey: true,
    ctrlKey: false,
  });
  assert.deepEqual(orderedUpdateSelection(orderedIDs, ranged.selectedIDs), ["a", "b", "c", "d"]);
  assert.equal(ranged.anchorID, "d");
});

test("seen advances from the exact clicked row to the next remaining row below", () => {
  const orderedRows = [
    { rowKey: "project-a:first", notificationKey: "first" },
    { rowKey: "project-a:shared", notificationKey: "shared" },
    { rowKey: "project-b:shared", notificationKey: "shared" },
    { rowKey: "project-b:next", notificationKey: "next" },
  ];

  assert.equal(
    resolveUpdateSeenSuccessor(orderedRows, "project-b:shared", new Set(["shared"])),
    "project-b:next",
  );
  assert.equal(
    resolveUpdateSeenSuccessor(orderedRows, "project-a:first", new Set(["first", "shared"])),
    "project-b:next",
  );
});

test("seen does not jump upward when there is no remaining row below", () => {
  const orderedRows = [
    { rowKey: "first", notificationKey: "first" },
    { rowKey: "last", notificationKey: "last" },
  ];

  assert.equal(resolveUpdateSeenSuccessor(orderedRows, "last", new Set(["last"])), "");
  assert.equal(resolveUpdateSeenSuccessor(orderedRows, "missing", new Set()), "");
});

test("Seen advances both selection and node preview to the next remaining row", () => {
  const orderedRows = [
    { rowKey: "clicked-node", notificationKey: "clicked" },
    { rowKey: "next-node", notificationKey: "next" },
  ];
  assert.deepEqual(resolveUpdateSeenPresentation(orderedRows, "clicked-node", new Set(["clicked"])), {
    previewRowKey: "next-node",
    successorRowKey: "next-node",
  });
  assert.deepEqual(resolveUpdateSeenPresentation(orderedRows, "next-node", new Set(["next"])), {
    previewRowKey: "next-node",
    successorRowKey: "",
  });
});

test("Updates Seen selects and opens the successor row, retaining the clicked preview only at the bottom", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  assert.ok(source.includes("if (updateRowNodeID(nextRow)) openUpdateNodePanel(nextRow)"));
  assert.ok(source.includes("options.previewRow && retainedClickedPreview"));
  assert.ok(source.includes("if (!retainedClickedPreview) setActiveNodePanel(null)"));
  assert.ok(source.includes("{ advanceFromRowKey: row.rowKey, previewRow: row }"));
});

test("local Seen events do not reload Updates, while external same-company events do", () => {
  const localSeenSource = "updates-local-seen";
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-a",
    source: localSeenSource,
    localSeenSource,
    summaryOnlySource: "realtime-accepted-summary",
  }), false);
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-b",
    source: "",
    localSeenSource,
    summaryOnlySource: "realtime-accepted-summary",
  }), false);
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-a",
    source: "realtime-accepted-summary",
    localSeenSource,
    summaryOnlySource: "realtime-accepted-summary",
  }), false);
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-a",
    source: "realtime",
    localSeenSource,
    summaryOnlySource: "realtime-accepted-summary",
  }), true);
});

test("Updates resolves current Logic Gate labels without rewriting historical notification text", () => {
  const item = {
    entity_type: "logic_gate" as const,
    entity_id: "gate-entity",
    logic_gate_id: "gate-current",
    title: "Historical notification title",
    body_preview: "Historical notification body",
  };
  const row = { item, logicGate: { id: "gate-grouped", label: "Grouped gate" } };

  assert.equal(resolveUpdateLogicGateID(row), "gate-current");
  assert.equal(resolveUpdateLogicGateID({
    item: { entity_type: "node", entity_id: "node-1", logic_gate_id: "" },
    logicGate: { id: "gate-grouped", label: "Grouped gate" },
  }), "gate-grouped");
  assert.equal(resolveUpdateLogicGateID({
    item: { entity_type: "logic_gate", entity_id: "gate-entity", logic_gate_id: "" },
  }), "gate-entity");

  assert.equal(resolveCurrentUpdateLogicGateLabel({
    currentDetails: { title: "Current renamed gate" },
    groupedLabel: "Grouped gate",
    historicalEntityLabel: "Historical gate",
  }), "Current renamed gate");
  assert.equal(resolveCurrentUpdateLogicGateLabel({ groupedLabel: "Grouped gate", historicalEntityLabel: "Historical gate" }), "Grouped gate");
  assert.equal(resolveCurrentUpdateLogicGateLabel({ historicalEntityLabel: "Historical gate" }), "Historical gate");
  assert.deepEqual(resolveCurrentUpdateLogicGateGroupValue({
    row,
    currentDetails: { title: "Zulu Current Gate" },
    historicalEntityLabel: "Historical gate",
  }), {
    id: "gate-current",
    label: "Zulu Current Gate",
    sortValue: "zulu current gate",
  });
});

test("seen Updates date sliders default to a bounded window and never query more than 90 days", () => {
  const bounds = seenUpdatesDateBounds({
    oldest_created_timestamp: "2025-01-01T12:00:00Z",
    newest_created_timestamp: "2026-07-21T18:00:00Z",
  });
  if (!bounds) {
    throw new Error("expected a seen Updates date range");
  }
  const initial = createSeenUpdatesDateWindow(bounds);
  assert.deepEqual(seenUpdatesDateQuery(initial), {
    fromDate: "2026-06-22",
    toDate: "2026-07-21",
  });

  const movedStart = moveSeenUpdatesDateWindow(initial, "start", bounds.oldestDay);
  assert.equal(movedStart.endDay - movedStart.startDay + 1, 90);
  assert.equal(seenUpdatesDateQuery(movedStart).fromDate, "2025-01-01");

  const movedEnd = moveSeenUpdatesDateWindow(movedStart, "end", bounds.newestDay);
  assert.equal(movedEnd.endDay - movedEnd.startDay + 1, 90);
  assert.equal(seenUpdatesDateQuery(movedEnd).toDate, "2026-07-21");
});

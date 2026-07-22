import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { orderedUpdateSelection, resolveUpdateClickSelection, resolveUpdateSeenPresentation, resolveUpdateSeenSuccessor, updateNotificationVisibleInView, updatesNotificationEventRequiresReload } from "../../../../frontend/src/pages/home/updatesSelection.js";
import { resolveCurrentUpdateLogicGateGroupValue, resolveCurrentUpdateLogicGateLabel, resolveUpdateLogicGateID } from "../../../../frontend/src/pages/home/updatesCurrentEntityLabels.js";
import { resolveUpdateActorLabel, resolveUpdateBodyPreview } from "../../../../frontend/src/pages/home/updatesActorLabel.js";
import { createSeenUpdatesDateWindow, displayDateToUTCDay, moveSeenUpdatesDateWindow, seenUpdatesDateBounds, seenUpdatesDateQuery, utcDayToDisplayDate } from "../../../../frontend/src/pages/home/updatesSeenHistory.js";

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

test("seen Updates date fields default to a bounded window and never query more than 90 days", () => {
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

test("seen Updates accepts ranges that begin before the oldest stored row", () => {
  const bounds = seenUpdatesDateBounds({
    oldest_created_timestamp: "2026-07-10T12:00:00Z",
    newest_created_timestamp: "2026-07-22T18:00:00Z",
  });
  if (!bounds) {
    throw new Error("expected a seen Updates date range");
  }
  const earlierDay = displayDateToUTCDay("06/05/2026");
  if (earlierDay === null) {
    throw new Error("expected a valid earlier date");
  }

  const movedStart = moveSeenUpdatesDateWindow(createSeenUpdatesDateWindow(bounds), "start", earlierDay);
  assert.deepEqual(seenUpdatesDateQuery(movedStart), {
    fromDate: "2026-06-05",
    toDate: "2026-07-22",
  });
});

test("seen Updates dates use strict MM/DD/YYYY entry without timezone drift", () => {
  const leapDay = displayDateToUTCDay("02/29/2024");
  assert.notEqual(leapDay, null);
  assert.equal(utcDayToDisplayDate(leapDay!), "02/29/2024");
  assert.equal(displayDateToUTCDay("02/29/2023"), null);
  assert.equal(displayDateToUTCDay("2024-02-29"), null);
  assert.equal(displayDateToUTCDay("2/29/2024"), null);

  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  assert.ok(source.includes('"Seen updates from date"'));
  assert.ok(source.includes('"Seen updates to date"'));
  assert.ok(source.includes('placeholder="MM/DD/YYYY"'));
  assert.ok(!source.includes("SeenUpdatesDateSlider"));
});

test("seen Updates retain read notifications while current Updates retain unread notifications", () => {
  assert.equal(updateNotificationVisibleInView({}, "current"), true);
  assert.equal(updateNotificationVisibleInView({ read_timestamp: "2026-07-22T12:00:00Z" }, "current"), false);
  assert.equal(updateNotificationVisibleInView({}, "seen"), false);
  assert.equal(updateNotificationVisibleInView({ read_timestamp: "2026-07-22T12:00:00Z" }, "seen"), true);
});

test("Updates never replaces a readable mention actor with a raw user UUID", () => {
  const actorID = "1955a2ed-cdfb-0845-b344-f176783824c2";
  const notification = {
    actor_user_id: actorID,
    title: "Test User mentioned you in Account - Deal Flow Management",
    body_preview: "",
  };

  assert.equal(resolveUpdateActorLabel(notification, () => actorID), "Test User");
  assert.equal(resolveUpdateActorLabel(notification, () => "Jonathan Kim"), "Jonathan Kim");
  assert.equal(resolveUpdateActorLabel({ ...notification, title: `${actorID} mentioned you` }, () => actorID), "Someone");
});

test("Updates replaces stored recipient UUID mention previews with the display name", () => {
  const recipientID = "955a2eed-cdfb-9845-b344-f87683824ca2";
  const notification = {
    title: "Test User mentioned you",
    recipient_user_id: recipientID,
    body_preview: `!${recipientID} please review this`,
  };

  assert.equal(resolveUpdateBodyPreview(notification, () => "Jonathan Kim"), "!Jonathan Kim please review this");
  assert.equal(resolveUpdateBodyPreview({ ...notification, body_preview: `@${recipientID}` }, () => "Jonathan Kim"), "@Jonathan Kim");
});

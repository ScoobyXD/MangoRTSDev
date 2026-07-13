import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { orderedUpdateSelection, resolveUpdateClickSelection, resolveUpdateSeenSuccessor, updatesNotificationEventRequiresReload } from "../../../../frontend/src/pages/home/updatesSelection.js";
import { resolveCurrentUpdateLogicGateGroupValue, resolveCurrentUpdateLogicGateLabel, resolveUpdateLogicGateID } from "../../../../frontend/src/pages/home/updatesCurrentEntityLabels.js";

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

test("local Seen events do not reload Updates, while external same-company events do", () => {
  const localSeenSource = "updates-local-seen";
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-a",
    source: localSeenSource,
    localSeenSource,
  }), false);
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-b",
    source: "",
    localSeenSource,
  }), false);
  assert.equal(updatesNotificationEventRequiresReload({
    activeCompanyID: "company-a",
    eventCompanyID: "company-a",
    source: "realtime",
    localSeenSource,
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
  const historicalText = { title: item.title, bodyPreview: item.body_preview };
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
  assert.deepEqual({ title: item.title, bodyPreview: item.body_preview }, historicalText);
});

test("Home passes its current Logic Gate cache through Updates actions, panels, and saved grouping labels", () => {
  const homeSource = readFileSync("frontend/src/pages/home/HomePage.tsx", "utf8");
  const updatesSource = readFileSync("frontend/src/pages/home/UpdatesView.tsx", "utf8");
  assert.match(homeSource, /resolveLogicGateDetails=\{\(logicGateID\) => \{/);
  assert.match(homeSource, /const logicGate = logicGateByID\.get\(logicGateID\)/);
  assert.match(updatesSource, /currentDetails: resolveLogicGateDetails\?\.\(resourceID\)/);
  assert.match(updatesSource, /const logicGateID = resolveUpdateLogicGateID\(row\)/);
  assert.match(updatesSource, /updateRowLogicGateLabel\(row, logicGateDetails\)/);
  assert.match(updatesSource, /buildUpdateDisplayGroups\(updateRows, selectedSetting\.groupings, resolveNodeDetails, resolveLogicGateDetails\)/);
  assert.match(updatesSource, /getUpdateGroupValues\(row, field, resolveNodeDetails, resolveLogicGateDetails\)/);
  assert.match(updatesSource, /currentDetails: resolveLogicGateDetails\?\.\(logicGateID\)/);
});

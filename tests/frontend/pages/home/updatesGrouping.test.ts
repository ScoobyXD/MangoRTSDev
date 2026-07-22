import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_UPDATE_GROUPINGS,
  UPDATE_GROUPING_FIELDS,
  normalizeUpdateGroupingStack,
  resolveUpdatePriorityGroupOrder,
  sortUpdateItemsNewestFirst,
  withBuiltInUpdateGroupingSetting,
} from "../../../../frontend/src/pages/home/updatesGrouping.js";
import {
  UPDATES_NODE_PANEL_DEFAULT_MAIN_RATIO,
  nudgeUpdatesNodePanelMainRatio,
  normalizeUpdatesNodePanelMainRatio,
  resolveUpdatesNodePanelMainRatio,
  updatesNodePanelGridTemplate,
} from "../../../../frontend/src/pages/home/updatesLayout.js";
import { buildUniversalNestedGroups } from "../../../../frontend/src/modules/grouping/universalGrouping.js";
import {
  collectAllUpdateGroupIDs,
  reconcileExpandedUpdateGroupIDs,
} from "../../../../frontend/src/pages/home/updatesExpansion.js";
import { logicGateGVICRolePresentation } from "../../../../frontend/src/modules/logic-gate-map/gvicPresentation.js";
import { resolveUpdateGroupSemanticPresentation } from "../../../../frontend/src/pages/home/updatesGroupPresentation.js";

test("the built-in Updates grouping chain is Date, GVIC, Priority, then Logic Gate", () => {
  assert.deepEqual(DEFAULT_UPDATE_GROUPINGS.map((grouping) => grouping.field), [
    "date",
    "gvic",
    "priority",
    "logic_gate",
  ]);
  assert.equal(UPDATE_GROUPING_FIELDS.some((field) => field.value === "priority" && field.label === "Priority"), true);
  assert.deepEqual(normalizeUpdateGroupingStack(undefined), DEFAULT_UPDATE_GROUPINGS);
});

test("explicit custom Updates grouping stacks and the valid empty stack are preserved", () => {
  assert.deepEqual(normalizeUpdateGroupingStack([
    { field: "project", direction: "desc" },
    { field: "status", direction: "asc" },
  ]), [
    { field: "project", direction: "desc" },
    { field: "status", direction: "asc" },
  ]);
  assert.deepEqual(normalizeUpdateGroupingStack([]), []);
});

test("priority grouping orders 1 through 5 and keeps unassigned last", () => {
  const assigned = [1, 2, 3, 4, 5].map((priority) => resolveUpdatePriorityGroupOrder(priority));
  assert.deepEqual(assigned.map((group) => group.sortValue), [1, 2, 3, 4, 5]);
  assert.equal(assigned.every((group) => group.sortLast !== true), true);
  assert.deepEqual(resolveUpdatePriorityGroupOrder(0), { sortValue: 99, sortLast: true });
  assert.deepEqual(resolveUpdatePriorityGroupOrder(null), { sortValue: 99, sortLast: true });

  const orderPriorities = (direction: "asc" | "desc") => buildUniversalNestedGroups(
    [0, 3, 1, 5, 2, 4],
    [{ field: "priority" as const, direction }],
    {
      rootID: "priority-order",
      rowKey: (priority) => String(priority),
      getValues: (priority) => [{
        key: `priority:${priority}`,
        label: String(priority),
        ...resolveUpdatePriorityGroupOrder(priority),
      }],
      sortRows: (priorities) => priorities,
    },
  ).map((group) => Number(group.key.slice("priority:".length)));
  assert.deepEqual(orderPriorities("asc"), [1, 2, 3, 4, 5, 0]);
  assert.deepEqual(orderPriorities("desc"), [5, 4, 3, 2, 1, 0]);

  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  assert.match(source, /const priorityOrder = resolveUpdatePriorityGroupOrder\(priority\)/);
  assert.match(source, /label: option\.label\.replace\(\/\\u00a0\/g, " "\), \.\.\.priorityOrder/);
  assert.match(source, /updatePriorityValue\(item\.priority \?\? nodeDetails\?\.priority\)/);
  assert.match(source, /updatePriorityValue\(row\.item\.priority \?\? \(nodeID \? resolveNodeDetails\?\.\(nodeID\)\?\.priority : null\)\)/);
  assert.match(source, /if \(typeof value !== "number" \|\| !Number\.isFinite\(value\)\) return null;/);
});

test("the built-in Updates setting remains first without rewriting custom settings", () => {
  const builtIn = { setting_id: "built-in", groupings: DEFAULT_UPDATE_GROUPINGS };
  const custom = { setting_id: "custom", groupings: [{ field: "status", direction: "desc" }] };

  const settings = withBuiltInUpdateGroupingSetting(builtIn, [custom]);
  assert.deepEqual(settings.map((setting) => setting.setting_id), ["built-in", "custom"]);
  assert.deepEqual(settings[1], custom);
});

test("Updates rows are always sorted newest first within their rendered group", () => {
  const rows = [
    { id: "older", created: "2026-07-18T12:00:00Z" },
    { id: "invalid", created: "not-a-timestamp" },
    { id: "newest-b", created: "2026-07-20T12:00:00Z" },
    { id: "newest-a", created: "2026-07-20T12:00:00Z" },
  ];
  assert.deepEqual(
    sortUpdateItemsNewestFirst(rows, (row) => row.created, (row) => row.id).map((row) => row.id),
    ["newest-a", "newest-b", "older", "invalid"],
  );

  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  assert.match(source, /function flattenUpdateRows[\s\S]*return sortUpdateRows\(rows\)/);
  assert.match(source, /sortRows: sortUpdateRows/);
  assert.match(source, /const sortedRows = sortUpdateRows\(group\.rows\)/);
  assert.match(source, /return sortUpdateItemsNewestFirst\(/);
});

test("Updates node panel split clamps, nudges, and emits a two-pane grid", () => {
  assert.equal(normalizeUpdatesNodePanelMainRatio(undefined), UPDATES_NODE_PANEL_DEFAULT_MAIN_RATIO);
  assert.equal(normalizeUpdatesNodePanelMainRatio(0.05), 0.2);
  assert.equal(normalizeUpdatesNodePanelMainRatio(0.95), 0.8);
  assert.equal(nudgeUpdatesNodePanelMainRatio(0.55, -1), 0.525);
  assert.ok(Math.abs(nudgeUpdatesNodePanelMainRatio(0.55, 1) - 0.575) < 0.000001);
  assert.equal(resolveUpdatesNodePanelMainRatio({
    pointerClientX: 610,
    containerLeft: 100,
    containerWidth: 1000,
    paddingLeft: 10,
    paddingRight: 10,
  }), 0.5154639175257731);
  assert.equal(resolveUpdatesNodePanelMainRatio({
    pointerClientX: -500,
    containerLeft: 100,
    containerWidth: 1600,
  }), 0.22641509433962265);
  assert.equal(resolveUpdatesNodePanelMainRatio({
    pointerClientX: 5000,
    containerLeft: 100,
    containerWidth: 1600,
  }), 0.7358490566037736);
  assert.equal(updatesNodePanelGridTemplate(0.6), "minmax(0, 0.6fr) 10px minmax(0, 0.4fr)");

  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  assert.match(source, /role="separator"[\s\S]*aria-label="Resize Updates and node panels"/);
  assert.match(source, /aria-orientation="vertical"/);
  assert.match(source, /onPointerDown=\{startNodePanelResize\}[\s\S]*onPointerMove=\{moveNodePanelResize\}[\s\S]*onPointerUp=\{finishNodePanelResize\}/);
  assert.match(source, /cursor: "col-resize"/);
  assert.match(source, /storeUpdatesNodePanelMainRatio/);
});

test("GVIC and Priority group titles reuse their semantic raised surfaces", () => {
  assert.deepEqual([
    logicGateGVICRolePresentation("generated").accent,
    logicGateGVICRolePresentation("verified").accent,
    logicGateGVICRolePresentation("consulted").accent,
    logicGateGVICRolePresentation("informed").accent,
  ], ["#0891b2", "#db2777", "#7c3aed", "#059669"]);

  const other = resolveUpdateGroupSemanticPresentation({ field: "gvic", key: "gvic:other", label: "Other" });
  assert.equal(other?.kind, "gvic");
  assert.equal(other?.iconLabel, "O");
  assert.equal(other?.iconColor, "#64748b");
  assert.match(String(other?.surfaceStyle.background), /padding-box[\s\S]*border-box/);
  assert.match(String(other?.surfaceStyle.boxShadow), /4px 4px 12px/);

  const priority = resolveUpdateGroupSemanticPresentation({ field: "priority", key: "priority:2", label: "2 By end of day" });
  assert.equal(priority?.kind, "priority");
  assert.equal(priority?.iconLabel, "P");
  assert.equal(priority?.iconColor, "#7c2d12");
  assert.equal(priority?.surfaceStyle.background, "linear-gradient(135deg, rgba(255, 247, 237, 0.96), rgba(254, 240, 138, 0.68))");
  assert.match(String(priority?.surfaceStyle.boxShadow), /rgba\(234, 88, 12, 0\.11\)/);
  assert.equal(resolveUpdateGroupSemanticPresentation({ field: "date", key: "date:2026-07-14", label: "2026-07-14" }), null);
});

test("individual Updates rows omit Logic Gate presentation without removing Logic Gate grouping or navigation", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const rowCopyStart = source.indexOf("function UpdateCanonicalRowCopy(");
  const rowCopyEnd = source.indexOf("function UpdateInlineEntity(", rowCopyStart);
  assert.ok(rowCopyStart >= 0 && rowCopyEnd > rowCopyStart);
  const rowCopy = source.slice(rowCopyStart, rowCopyEnd);

  assert.match(rowCopy, /const nodeEntity = <UpdateInlineEntity kind="node"/);
  assert.doesNotMatch(rowCopy, /logicGateEntity|logicGateLabel|resolveLogicGateDetails|kind="logic_gate"/);
  assert.match(rowCopy, /item\.entity_type === "logic_gate"[\s\S]*"urgently mentioned you" : "mentioned you"/);
  assert.match(source, /if \(field === "logic_gate"\)[\s\S]*resolveCurrentUpdateLogicGateGroupValue/);
  assert.match(source, /group\.resource_type === "project" \|\| group\.resource_type === "logic_gate" \|\| group\.resource_type === "node"/);
  assert.match(source, /onOpenLogicGate\(resourceID, resolveCurrentUpdateLogicGateLabel/);
});

test("Updates groups expand completely on first activation and keep explicit collapses during refresh", () => {
  const groups = [{
    id: "date:today",
    groups: [{
      id: "gvic:generated",
      groups: [{ id: "priority:urgent", groups: [] }],
    }],
  }];

  assert.deepEqual(collectAllUpdateGroupIDs(groups), new Set([
    "date:today",
    "gvic:generated",
    "priority:urgent",
  ]));
  assert.deepEqual(reconcileExpandedUpdateGroupIDs({
    groups,
    manuallyCollapsedGroupIDs: new Set(["gvic:generated"]),
    reset: true,
  }), new Set([
    "date:today",
    "gvic:generated",
    "priority:urgent",
  ]));
  assert.deepEqual(reconcileExpandedUpdateGroupIDs({
    groups,
    manuallyCollapsedGroupIDs: new Set(["gvic:generated"]),
    reset: false,
  }), new Set([
    "date:today",
    "priority:urgent",
  ]));
});

test("Updates exposes all-group controls and a split three-cell live counter surface", () => {
  const updatesView = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const appSidebar = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");

  assert.match(updatesView, /aria-label="Collapse all Update groups"[\s\S]*onClick={collapseAllGroups}/);
  assert.match(updatesView, /aria-label="Expand all Update groups"[\s\S]*onClick={expandAllGroups}/);
  assert.match(appSidebar, /label="Updates"[\s\S]*splitTrailing[\s\S]*<SidebarNotificationBadges large/);
  assert.match(appSidebar, /gridTemplateColumns: splitTrailing \? "repeat\(2, minmax\(0, 1fr\)\)"/);
  assert.match(appSidebar, /gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(appSidebar, /!large \|\| normalizeSidebarNotificationCount\(badge\.count\) > 0/);
  assert.match(appSidebar, /if \(!highlighted\) return/);
  assert.match(appSidebar, /gridTemplateRows: "16px 12px"[\s\S]*rowGap: 3/);
  assert.match(appSidebar, /appSidebarNotificationBadgeCountStyle\(large\)/);
  assert.match(appSidebar, /rgba\(255, 247, 237, 0\.98\) 0%[\s\S]*rgba\(234, 88, 12, 0\.88\) 100%/);
  assert.match(appSidebar, /rgba\(236, 254, 255, 0\.98\) 0%[\s\S]*rgba\(14, 165, 233, 0\.86\) 100%/);
  assert.match(appSidebar, /rgba\(255, 251, 235, 0\.98\) 0%[\s\S]*rgba\(249, 115, 22, 0\.88\) 100%/);
});

test("Updates rows keep their width while node titles consume the available title-line space", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/UpdatesView.tsx"), "utf8");
  const rowStyleStart = source.indexOf("function updateRowStyle(");
  const rowStyleEnd = source.indexOf("function updateRowIconStyle(", rowStyleStart);
  const entityStyleStart = source.indexOf("const updateInlineEntityStyle");
  const entityStyleEnd = source.indexOf("const updateInlineEntityLabelStyle", entityStyleStart);
  assert.ok(rowStyleStart >= 0 && rowStyleEnd > rowStyleStart);
  assert.ok(entityStyleStart >= 0 && entityStyleEnd > entityStyleStart);

  const rowStyle = source.slice(rowStyleStart, rowStyleEnd);
  const entityStyle = source.slice(entityStyleStart, entityStyleEnd);
  assert.match(rowStyle, /width: `min\(860px, calc\(100% -/);
  assert.match(entityStyle, /flex: "1 1 230px"/);
  assert.match(entityStyle, /maxWidth: "100%"/);
  assert.doesNotMatch(entityStyle, /maxWidth: 230/);
});

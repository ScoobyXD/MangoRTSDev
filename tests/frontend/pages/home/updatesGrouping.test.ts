import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  DEFAULT_UPDATE_GROUPINGS,
  UPDATE_GROUPING_FIELDS,
  normalizeUpdateGroupingStack,
  withBuiltInUpdateGroupingSetting,
} from "../../../../frontend/src/pages/home/updatesGrouping.js";
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

test("the built-in Updates setting remains first without rewriting custom settings", () => {
  const builtIn = { setting_id: "built-in", groupings: DEFAULT_UPDATE_GROUPINGS };
  const custom = { setting_id: "custom", groupings: [{ field: "status", direction: "desc" }] };

  const settings = withBuiltInUpdateGroupingSetting(builtIn, [custom]);
  assert.deepEqual(settings.map((setting) => setting.setting_id), ["built-in", "custom"]);
  assert.deepEqual(settings[1], custom);
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

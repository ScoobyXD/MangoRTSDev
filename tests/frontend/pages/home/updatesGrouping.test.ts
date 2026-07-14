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

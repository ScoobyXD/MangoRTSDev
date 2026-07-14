import assert from "node:assert/strict";
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

import test from "node:test";
import assert from "node:assert/strict";
import { buildChoiceFieldConfig } from "../../../../frontend/src/modules/entities/entitiesChoiceConfig.js";

test("Choice relabeling preserves stable keys and the current default", () => {
  const config = buildChoiceFieldConfig(
    { default: "pending", options: [{ key: "pending", label: "Pending" }, { key: "done", label: "Done" }] },
    [{ key: "pending", label: "Waiting" }, { key: "done", label: "Finished" }],
    [],
  );

  assert.deepEqual(config, {
    default: "pending",
    options: [{ key: "pending", label: "Waiting" }, { key: "done", label: "Finished" }],
  });
});

test("Choice removal and same-save re-addition never reuse the removed key", () => {
  const config = buildChoiceFieldConfig(
    { default: "blocked", options: [{ key: "blocked", label: "Blocked" }, { key: "done", label: "Done" }] },
    [{ key: "done", label: "Done" }],
    ["Blocked", "Blocked"],
  );

  assert.deepEqual(config, {
    default: null,
    options: [
      { key: "done", label: "Done" },
      { key: "blocked_2", label: "Blocked" },
      { key: "blocked_3", label: "Blocked" },
    ],
  });
});

test("new Choice keys are valid, collision-safe, and appended in entry order", () => {
  const config = buildChoiceFieldConfig(
    { default: null, options: [{ key: "option_123", label: "Old number" }] },
    [{ key: "option_123", label: "Old number" }],
    ["123", "Needs review"],
  );

  assert.deepEqual(config.options, [
    { key: "option_123", label: "Old number" },
    { key: "option_123_2", label: "123" },
    { key: "needs_review", label: "Needs review" },
  ]);
});

test("Action Item Status keeps its exact three stable keys", () => {
  const current = {
    default: "in_progress",
    options: [
      { key: "in_progress", label: "In progress" },
      { key: "pending", label: "Pending" },
      { key: "done", label: "Done" },
    ],
  };
  const config = buildChoiceFieldConfig(current, [
    { key: "in_progress", label: "Started" },
    { key: "pending", label: "Waiting" },
    { key: "done", label: "Finished" },
  ], [], "status");

  assert.deepEqual(config.options?.map((option) => option.key), ["in_progress", "pending", "done"]);
  assert.equal(config.default, "in_progress");
  assert.throws(
    () => buildChoiceFieldConfig(current, [{ key: "in_progress", label: "Started" }, { key: "done", label: "Finished" }], [], "status"),
    /three required choices/,
  );
});

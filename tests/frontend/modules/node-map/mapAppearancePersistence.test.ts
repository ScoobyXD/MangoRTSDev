// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultMyTeraCardState,
  effectiveMyTeraCardSize,
  restoreLogicGateMapRelationshipRoleColors,
  restoreMyTeraCardStates,
  restoreNodeMapRelationshipRoleColors,
  restoreNodeSizes,
} from "../../../../frontend/src/modules/node-map/mapAppearancePersistence.js";

test("relationship role colors restore exact valid saved values and fall back per role", () => {
  assert.deepEqual(
    restoreNodeMapRelationshipRoleColors({ parent: "#ABCDEF", peer: "invalid", child: "#123456" }),
    { parent: "#abcdef", peer: "#475569", child: "#123456" },
  );
  assert.deepEqual(
    restoreLogicGateMapRelationshipRoleColors({ input: "#FEDCBA" }),
    { input: "#fedcba", output: "#64748b" },
  );
});

test("expanded MyTera contributes its panel to the real card footprint", () => {
  const disabled = createDefaultMyTeraCardState();
  assert.deepEqual(effectiveMyTeraCardSize({ w: 148, h: 96 }, disabled), { w: 148, h: 96 });
  assert.deepEqual(
    effectiveMyTeraCardSize(
      { w: 148, h: 96 },
      { ...disabled, enabled: true, expanded: true, panelHeight: 264 },
    ),
    { w: 300, h: 360 },
  );
});

test("appearance persistence sanitizes sizes and MyTera fields without losing valid state", () => {
  const sizes = restoreNodeSizes({
    "node-a": { w: 115, h: 73 },
    "node-b": { w: Number.NaN, h: 96 },
    constructor: { w: 400, h: 400 },
  }, 1200, 900);
  assert.deepEqual({ ...sizes }, { "node-a": { w: 120, h: 72 } });

  const states = restoreMyTeraCardStates({
    "node-a": {
      enabled: true,
      expanded: true,
      rules: "Keep this",
      exclusions: "Not this",
      relatedControls: ["parent", " parent ", "child"],
      panelHeight: 231,
    },
    prototype: { enabled: true },
  }, 900);
  assert.deepEqual({ ...states }, {
    "node-a": {
      enabled: true,
      expanded: true,
      rules: "Keep this",
      exclusions: "Not this",
      relatedControls: ["parent", "child"],
      panelHeight: 228,
    },
  });
});

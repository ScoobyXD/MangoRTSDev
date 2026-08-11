import assert from "node:assert/strict";
import test from "node:test";

import { APIHTTPError } from "../../../../frontend/src/modules/api/requestJSON.js";
import { logicGateConversionErrorMessage } from "../../../../frontend/src/modules/huddles/logicGateConversion.js";

function blocked(blockers: { editor?: boolean; kanban_work?: boolean; kpis?: boolean }): APIHTTPError {
  return new APIHTTPError(409, "Conflict", JSON.stringify({ error: "logic_gate_conversion_blocked", blockers }));
}

test("Logic Gate conversion names each individual blocker exactly", () => {
  assert.equal(logicGateConversionErrorMessage(blocked({ editor: true })), "Conversion is blocked. Empty the editor, then try again.");
  assert.equal(logicGateConversionErrorMessage(blocked({ kanban_work: true })), "Conversion is blocked. Remove Kanban work, then try again.");
  assert.equal(logicGateConversionErrorMessage(blocked({ kpis: true })), "Conversion is blocked. Remove KPIs, then try again.");
});

test("Logic Gate conversion names only present blocker combinations", () => {
  assert.equal(
    logicGateConversionErrorMessage(blocked({ editor: true, kpis: true })),
    "Conversion is blocked. Empty the editor and remove KPIs, then try again.",
  );
  assert.equal(
    logicGateConversionErrorMessage(blocked({ editor: true, kanban_work: true, kpis: true })),
    "Conversion is blocked. Empty the editor, remove Kanban work, and remove KPIs, then try again.",
  );
});

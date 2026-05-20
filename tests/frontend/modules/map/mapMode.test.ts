import test from "node:test";
import assert from "node:assert/strict";
import { contextTimestamp, resolveInitialMapMode, resolveMapModeFromLiveSelection } from "../../../../frontend/src/modules/map/mapMode.js";

test("contextTimestamp returns finite stored timestamps only", () => {
  assert.equal(contextTimestamp(JSON.stringify({ ts: 42 })), 42);
  assert.equal(contextTimestamp(JSON.stringify({ ts: "42" })), 0);
  assert.equal(contextTimestamp("not-json"), 0);
  assert.equal(contextTimestamp(null), 0);
});

test("resolveInitialMapMode keeps default without stored map context", () => {
  assert.equal(resolveInitialMapMode({
    initialMode: "logic_gate",
    nodeContextValue: null,
    logicGateContextValue: null,
  }), "logic_gate");
});

test("resolveInitialMapMode picks the newest stored explorer context", () => {
  assert.equal(resolveInitialMapMode({
    initialMode: "node",
    nodeContextValue: JSON.stringify({ ts: 100 }),
    logicGateContextValue: JSON.stringify({ ts: 101 }),
  }), "logic_gate");
  assert.equal(resolveInitialMapMode({
    initialMode: "logic_gate",
    nodeContextValue: JSON.stringify({ ts: 102 }),
    logicGateContextValue: JSON.stringify({ ts: 101 }),
  }), "node");
});

test("resolveMapModeFromLiveSelection ignores stale selections behind explorer context", () => {
  assert.equal(resolveMapModeFromLiveSelection({
    companyID: "company-1",
    changedAt: 50,
    entityKind: "logic_gate",
  }, {
    companyID: "company-1",
    nodeContextValue: JSON.stringify({ ts: 75 }),
    logicGateContextValue: null,
  }), null);
});

test("resolveMapModeFromLiveSelection maps current selection entity and folder kinds", () => {
  assert.equal(resolveMapModeFromLiveSelection({
    companyID: "company-1",
    changedAt: 100,
    entityKind: "logic_gate",
  }, {
    companyID: "company-1",
    nodeContextValue: null,
    logicGateContextValue: null,
  }), "logic_gate");
  assert.equal(resolveMapModeFromLiveSelection({
    companyID: "company-1",
    changedAt: 100,
    folderKind: "node",
  }, {
    companyID: "company-1",
    nodeContextValue: null,
    logicGateContextValue: null,
  }), "node");
});

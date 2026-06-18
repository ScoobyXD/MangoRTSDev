import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLogicGateRoute,
  buildNodeRoute,
  buildRacioRoute,
  parseDeepLinkRoute,
  racioRoleForViewID,
  racioViewIDForRole,
} from "../../../frontend/src/app/deepLinkRoutes.js";

describe("deepLinkRoutes", () => {
  it("round-trips canonical Logic Gate routes", () => {
    const path = buildLogicGateRoute("logic gate/1");
    assert.equal(path, "/logic-gates/logic%20gate%2F1");
    assert.deepEqual(parseDeepLinkRoute(path), {
      kind: "logic_gate",
      logicGateID: "logic gate/1",
    });
  });

  it("round-trips Logic Gate node context routes", () => {
    const path = buildLogicGateRoute("lg-1", "node 1");
    assert.equal(path, "/logic-gates/lg-1/nodes/node%201");
    assert.deepEqual(parseDeepLinkRoute(`${path}?ignored=true`), {
      kind: "logic_gate",
      logicGateID: "lg-1",
      nodeID: "node 1",
    });
  });

  it("round-trips canonical node routes", () => {
    const path = buildNodeRoute("node/42");
    assert.equal(path, "/nodes/node%2F42");
    assert.deepEqual(parseDeepLinkRoute(path), {
      kind: "node",
      nodeID: "node/42",
    });
  });

  it("round-trips RACIO node routes with existing role and view IDs", () => {
    assert.equal(racioViewIDForRole("generated"), "r-inbox");
    assert.equal(racioRoleForViewID("r-inbox"), "generated");

    const path = buildRacioRoute("generated", "node-1");
    assert.equal(path, "/racio/generated/nodes/node-1");
    assert.deepEqual(parseDeepLinkRoute(path), {
      kind: "racio",
      role: "generated",
      viewID: "r-inbox",
      nodeID: "node-1",
    });
  });

  it("accepts RACIO view IDs as aliases for existing role IDs", () => {
    assert.deepEqual(parseDeepLinkRoute("/racio/a-inbox/nodes/node-2"), {
      kind: "racio",
      role: "verified",
      viewID: "a-inbox",
      nodeID: "node-2",
    });
  });

  it("rejects incomplete or unknown dynamic routes", () => {
    assert.equal(parseDeepLinkRoute("/logic-gates/lg-1/nodes"), null);
    assert.equal(parseDeepLinkRoute("/nodes/"), null);
    assert.equal(parseDeepLinkRoute("/racio/unknown/nodes/node-1"), null);
  });
});

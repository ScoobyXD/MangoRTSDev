import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLogicGateRoute,
  buildProjectLogicGateNavigationPlan,
  buildNodeRoute,
  buildGvicRoute,
  parseDeepLinkRoute,
  gvicRoleForViewID,
  gvicViewIDForRole,
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

  it("preserves the exact project route before pushing a Logic Gate route", () => {
    assert.deepEqual(
      buildProjectLogicGateNavigationPlan("/projects/project-1", "project-1", "gate-1"),
      { replacePath: "", pushPath: "/logic-gates/gate-1" },
    );
    assert.deepEqual(
      buildProjectLogicGateNavigationPlan("/project-management", "project-1", "gate-1"),
      { replacePath: "/projects/project-1", pushPath: "/logic-gates/gate-1" },
    );
  });

  it("round-trips GVIC node routes with existing role and view IDs", () => {
    assert.equal(gvicViewIDForRole("generated"), "r-inbox");
    assert.equal(gvicRoleForViewID("r-inbox"), "generated");

    const path = buildGvicRoute("generated", "node-1");
    assert.equal(path, "/gvic/generated/nodes/node-1");
    assert.deepEqual(parseDeepLinkRoute(path), {
      kind: "gvic",
      role: "generated",
      viewID: "r-inbox",
      nodeID: "node-1",
    });
  });

  it("accepts GVIC view IDs as aliases for existing role IDs", () => {
    assert.deepEqual(parseDeepLinkRoute("/gvic/a-inbox/nodes/node-2"), {
      kind: "gvic",
      role: "verified",
      viewID: "a-inbox",
      nodeID: "node-2",
    });
  });

  it("rejects incomplete or unknown dynamic routes", () => {
    assert.equal(parseDeepLinkRoute("/logic-gates/lg-1/nodes"), null);
    assert.equal(parseDeepLinkRoute("/nodes/"), null);
    assert.equal(parseDeepLinkRoute("/gvic/unknown/nodes/node-1"), null);
  });
});

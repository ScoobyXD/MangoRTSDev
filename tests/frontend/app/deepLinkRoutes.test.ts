import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import {
  buildProjectWorkPanelHistoryState,
  projectWorkPanelTabFromHistoryState,
  replaceProjectWorkPanelHistoryState,
} from "../../../frontend/src/app/projectRouteHistory.js";

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

  it("restores the Project work-panel tab only from the matching history entry", () => {
    const state = buildProjectWorkPanelHistoryState({ unrelated: "preserved" }, {
      projectID: " project-1 ",
      workPanelTab: "relationships",
    });
    assert.deepEqual(state, {
      unrelated: "preserved",
      mangortsProjectWorkPanel: {
        projectID: "project-1",
        workPanelTab: "relationships",
      },
    });
    assert.equal(projectWorkPanelTabFromHistoryState(state, "project-1"), "relationships");
    assert.equal(projectWorkPanelTabFromHistoryState(state, "project-2"), "relationships");
    assert.equal(projectWorkPanelTabFromHistoryState({}, "project-1"), "relationships");
  });

  it("writes the return tab onto the current Project history entry", () => {
    let replacement: { data: unknown; url: string | URL | null | undefined } | null = null;
    const history = {
      state: { unrelated: "preserved" },
      replaceState: (data: unknown, _unused: string, url?: string | URL | null) => {
        replacement = { data, url };
      },
    };
    replaceProjectWorkPanelHistoryState(history, "http://localhost/projects/project-1", {
      projectID: "project-1",
      workPanelTab: "relationships",
    });
    assert.deepEqual(replacement, {
      data: {
        unrelated: "preserved",
        mangortsProjectWorkPanel: {
          projectID: "project-1",
          workPanelTab: "relationships",
        },
      },
      url: "http://localhost/projects/project-1",
    });
  });

  it("wires Project relationship and critical-path openers to distinct return tabs", () => {
    const summary = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
    const appLayout = readFileSync(resolve(process.cwd(), "frontend/src/app/applayout.tsx"), "utf8");
    assert.match(summary, /useState<ProjectWorkPanelTab>\(\(\) => \([\s\S]*projectWorkPanelTabFromHistoryState/);
    assert.match(summary, /const selectRightPanelTab = useCallback[\s\S]*replaceProjectWorkPanelHistoryState/);
    assert.match(summary, /onClick=\{\(\) => selectRightPanelTab\("critical-path"\)\}/);
    assert.match(summary, /onClick=\{\(\) => selectRightPanelTab\("relationships"\)\}/);
    assert.match(summary, /workPanelTab: "relationships"/);
    assert.match(summary, /workPanelTab: "critical-path"/);
    assert.match(appLayout, /if \(navigation\.replacePath\) onNavigate[\s\S]*replaceProjectWorkPanelHistoryState[\s\S]*onNavigate\(navigation\.pushPath\)/);
    assert.ok(
      summary.indexOf('selectRightPanelTab("relationships")') < summary.indexOf('selectRightPanelTab("critical-path")'),
      "Logic Gates / Nodes must be the left-most Project work-panel tab",
    );
    assert.match(appLayout, /if \(!deepLinkProjectID\)[\s\S]*initialPage === "project-management"[\s\S]*setProjectManagementTarget\(null\)/);
    assert.match(summary, /onProjectUpdated\?\.\(renamedProject\)/);
  });

  it("round-trips RACI node routes with existing role and view IDs", () => {
    assert.equal(gvicViewIDForRole("responsible"), "r-inbox");
    assert.equal(gvicRoleForViewID("r-inbox"), "responsible");

    const path = buildGvicRoute("responsible", "node-1");
    assert.equal(path, "/gvic/responsible/nodes/node-1");
    assert.deepEqual(parseDeepLinkRoute(path), {
      kind: "gvic",
      role: "responsible",
      viewID: "r-inbox",
      nodeID: "node-1",
    });
  });

  it("accepts RACI view IDs as aliases for existing role IDs", () => {
    assert.deepEqual(parseDeepLinkRoute("/gvic/a-inbox/nodes/node-2"), {
      kind: "gvic",
      role: "accountable",
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

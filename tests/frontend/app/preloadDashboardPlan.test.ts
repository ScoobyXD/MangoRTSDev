import test from "node:test";
import assert from "node:assert/strict";
import { planLikelyDashboardPreload } from "../../../frontend/src/app/preloadDashboardPlan.js";

test("planLikelyDashboardPreload limits home route preloads to the home surface", () => {
  assert.deepEqual(planLikelyDashboardPreload({
    page: "home",
    frames: [
      { kind: "map" },
      { kind: "editor" },
    ],
  }), {
    moduleKinds: ["home"],
    routeSurfaces: ["home"],
  });
});

test("planLikelyDashboardPreload preloads only visible dashboard frame kinds", () => {
  assert.deepEqual(planLikelyDashboardPreload({
    frames: [
      { kind: "map" },
      { kind: "map" },
      { kind: "company-explorer" },
    ],
  }), {
    moduleKinds: ["map", "company-explorer"],
    routeSurfaces: [],
  });
});

test("planLikelyDashboardPreload keeps logic-gate arena on editor and kanban only", () => {
  assert.deepEqual(planLikelyDashboardPreload({
    page: "logic-gate-arena",
    frames: [],
  }), {
    moduleKinds: ["editor", "kanban"],
    routeSurfaces: ["logic-gate-arena"],
  });
});

test("planLikelyDashboardPreload falls back to default dashboard modules without a tab", () => {
  assert.deepEqual(planLikelyDashboardPreload(null), {
    moduleKinds: ["map", "company-explorer", "editor"],
    routeSurfaces: [],
  });
});

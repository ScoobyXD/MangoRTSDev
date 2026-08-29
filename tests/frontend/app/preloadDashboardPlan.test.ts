import test from "node:test";
import assert from "node:assert/strict";
import { planLikelyDashboardPreload } from "../../../frontend/src/app/preloadDashboardPlan.js";

test("planLikelyDashboardPreload limits home route preloads to the Home surface", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "home", frames: [{ kind: "editor" }, { kind: "kanban" }] }), {
    moduleKinds: ["home"],
    routeSurfaces: ["home"],
  });
});

test("planLikelyDashboardPreload preloads only visible dashboard frame kinds", () => {
  assert.deepEqual(planLikelyDashboardPreload({
    frames: [{ kind: "editor" }, { kind: "editor" }, { kind: "company-explorer" }],
  }), {
    moduleKinds: ["editor", "company-explorer"],
    routeSurfaces: [],
  });
});

test("planLikelyDashboardPreload keeps Logic Gate Arena on Editor and Kanban only", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "logic-gate-arena", frames: [] }), {
    moduleKinds: ["editor", "kanban"],
    routeSurfaces: ["logic-gate-arena"],
  });
});

test("planLikelyDashboardPreload falls back to Home without a tab", () => {
  assert.deepEqual(planLikelyDashboardPreload(null), {
    moduleKinds: ["home"],
    routeSurfaces: [],
  });
});

test("planLikelyDashboardPreload loads Entities as a route surface without dashboard modules", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "entities", frames: [{ kind: "editor" }] }), {
    moduleKinds: [],
    routeSurfaces: ["entities"],
  });
});

test("planLikelyDashboardPreload loads Process Map as a route surface without dashboard modules", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "process-map", frames: [] }), {
    moduleKinds: [],
    routeSurfaces: ["process-map"],
  });
});

test("planLikelyDashboardPreload loads My Work as its own lazy route surface", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "my-work", frames: [{ kind: "editor" }] }), {
    moduleKinds: [],
    routeSurfaces: ["my-work"],
  });
});

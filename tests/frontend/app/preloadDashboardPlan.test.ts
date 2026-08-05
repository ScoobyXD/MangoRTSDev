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

test("planLikelyDashboardPreload isolates the Fields entity surface", () => {
  assert.deepEqual(planLikelyDashboardPreload({ page: "fields", frames: [{ kind: "editor" }, { kind: "fields" }] }), {
    moduleKinds: ["fields"],
    routeSurfaces: ["fields"],
  });
});
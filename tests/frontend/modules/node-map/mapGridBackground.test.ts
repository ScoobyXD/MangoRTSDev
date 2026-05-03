import test from "node:test";
import assert from "node:assert/strict";
import { adaptivePlusGridWorldStep, buildPlusGridBackgroundStyle } from "../../../../frontend/src/modules/node-map/shared.js";

test("adaptivePlusGridWorldStep keeps plus grid detail readable across zoom levels", () => {
  assert.equal(adaptivePlusGridWorldStep(0.45), 96);
  assert.equal(adaptivePlusGridWorldStep(1), 48);
  assert.equal(adaptivePlusGridWorldStep(2.7), 12);
});

test("buildPlusGridBackgroundStyle uses repeated SVG tiles instead of per-cell DOM", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light" });

  assert.equal(style.backgroundRepeat, "repeat, repeat");
  assert.equal(style.backgroundSize, "48px 48px, 192px 192px");
  assert.match(String(style.backgroundImage), /data:image\/svg\+xml/);
  assert.match(String(style.backgroundImage), /%3Csvg/);
});

test("buildPlusGridBackgroundStyle coarsens background tiles when zoomed out", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 0.45, accent: "#00aabb", theme: "dark" });

  assert.equal(style.backgroundSize, "96px 96px, 384px 384px");
  assert.match(String(style.backgroundColor), /rgba/);
});

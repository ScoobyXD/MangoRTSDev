import test from "node:test";
import assert from "node:assert/strict";
import { adaptivePlusGridWorldStep, buildPlusGridBackgroundStyle } from "../../../../frontend/src/modules/node-map/shared.js";

test("adaptivePlusGridWorldStep keeps plus grid detail readable across zoom levels", () => {
  assert.equal(adaptivePlusGridWorldStep(0.45), 96);
  assert.equal(adaptivePlusGridWorldStep(1), 48);
  assert.equal(adaptivePlusGridWorldStep(2.7), 12);
});

test("buildPlusGridBackgroundStyle uses repeated gradients instead of per-cell DOM", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light" });

  assert.equal(style.backgroundRepeat, "repeat, repeat");
  assert.equal(style.backgroundSize, "192px 192px, 192px 192px");
  assert.equal(style.backgroundPosition, "24px 24px, 24px 24px");
  assert.match(String(style.backgroundImage), /linear-gradient\(to right/);
  assert.match(String(style.backgroundImage), /linear-gradient\(to bottom/);
});

test("buildPlusGridBackgroundStyle anchors square lines to the old plus centers", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light" });
  const [horizontalSize, verticalSize] = String(style.backgroundSize).split(", ").map((value) => Number.parseFloat(value));
  const [horizontalPosition, verticalPosition] = String(style.backgroundPosition).split(", ");

  assert.equal(horizontalSize, verticalSize);
  assert.equal(Number.parseFloat(horizontalPosition), 24);
  assert.equal(Number.parseFloat(verticalPosition), 24);
});

test("buildPlusGridBackgroundStyle coarsens background tiles when zoomed out", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 0.45, accent: "#00aabb", theme: "dark" });

  assert.equal(style.backgroundSize, "384px 384px, 384px 384px");
  assert.equal(style.backgroundPosition, "48px 48px, 48px 48px");
  assert.match(String(style.backgroundColor), /rgba/);
});

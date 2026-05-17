import test from "node:test";
import assert from "node:assert/strict";
import { adaptivePlusGridWorldStep, buildPlusGridBackgroundStyle } from "../../../../frontend/src/modules/node-map/shared.js";

test("adaptivePlusGridWorldStep keeps plus grid detail readable across zoom levels", () => {
  assert.equal(adaptivePlusGridWorldStep(0.45), 96);
  assert.equal(adaptivePlusGridWorldStep(1), 48);
  assert.equal(adaptivePlusGridWorldStep(2.7), 12);
});

test("buildPlusGridBackgroundStyle uses repeated SVG plus tiles instead of per-cell DOM", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light" });

  assert.equal(style.backgroundRepeat, "repeat, repeat");
  assert.equal(style.backgroundSize, "48px 48px, 240px 240px");
  assert.equal(style.backgroundPosition, "0 0, -96px -96px");
  assert.match(String(style.backgroundImage), /data:image\/svg\+xml/);
  assert.match(String(style.backgroundImage), /%3Csvg/);
});

test("buildPlusGridBackgroundStyle aligns major pluses with minor plus axes", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light" });
  const [minorSize, majorSize] = String(style.backgroundSize).split(", ").map((value) => Number.parseFloat(value));
  const [, majorPosition] = String(style.backgroundPosition).split(", ");
  const majorOffset = Number.parseFloat(majorPosition);

  assert.equal(majorOffset + majorSize / 2, minorSize / 2);
});

test("buildPlusGridBackgroundStyle coarsens background tiles when zoomed out", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 0.45, accent: "#00aabb", theme: "dark" });

  assert.equal(style.backgroundSize, "96px 96px, 480px 480px");
  assert.equal(style.backgroundPosition, "0 0, -192px -192px");
  assert.match(String(style.backgroundColor), /rgba/);
});

test("buildPlusGridBackgroundStyle pans the major plus layer with the viewport", () => {
  const style = buildPlusGridBackgroundStyle({ zoom: 1, accent: "#00aabb", theme: "light", pan: { x: 50, y: -25 } });

  assert.equal(style.backgroundSize, "48px 48px, 240px 240px");
  assert.equal(style.backgroundPosition, "2px -25px, -46px -121px");
});

import test from "node:test";
import assert from "node:assert/strict";
import { confirmationDisplayNameMatches } from "../../../frontend/src/app/ConfirmActionMenu.js";
import { clampFrameRightClickMenuPosition } from "../../../frontend/src/app/framerightclickmenu.js";

test("confirmation display name matching ignores case but still requires the full name", () => {
  assert.equal(confirmationDisplayNameMatches("  jOnAtHaN kIm  ", "Jonathan Kim"), true);
  assert.equal(confirmationDisplayNameMatches("Jonathan", "Jonathan Kim"), false);
  assert.equal(confirmationDisplayNameMatches("jonathan kim", ""), false);
});

test("confirmation menu position clamps to viewport bottom after content grows", () => {
  assert.deepEqual(
    clampFrameRightClickMenuPosition({
      x: 290,
      y: 425,
      menuWidth: 326,
      menuHeight: 150,
      viewportWidth: 818,
      viewportHeight: 563,
      margin: 8,
    }),
    { x: 290, y: 405 },
  );
});

test("context menu position stays inside the left and top viewport edges", () => {
  assert.deepEqual(
    clampFrameRightClickMenuPosition({
      x: -50,
      y: -30,
      menuWidth: 240,
      menuHeight: 120,
      viewportWidth: 320,
      viewportHeight: 240,
      margin: 8,
    }),
    { x: 8, y: 8 },
  );
});

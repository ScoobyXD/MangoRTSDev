import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { sidebarPinNodePopupLaunch } from "../../../frontend/src/app/sidebarPinPopup.js";
import type { SidebarPin } from "../../../frontend/src/app/sidebarPins.js";

function pin(kind: SidebarPin["kind"]): SidebarPin {
  return {
    pinID: "pin-1",
    id: "resource-1",
    kind,
    parentFolderID: "",
    name: "Pinned resource",
    position: 1000,
    createdTimestamp: "2026-08-05T00:00:00Z",
  };
}

describe("sidebarPinNodePopupLaunch", () => {
  it("opens only pinned Nodes as inset fullscreen popups and gives each open a fresh instance identity", () => {
    assert.deepEqual(sidebarPinNodePopupLaunch(pin("node"), 101), {
      nodeID: "resource-1",
      nodeTitle: "Pinned resource",
      initialFullscreen: true,
      popupInstanceID: 101,
    });
    assert.equal(sidebarPinNodePopupLaunch(pin("logic_gate"), 102), null);
    assert.equal(sidebarPinNodePopupLaunch(pin("project"), 103), null);
    assert.notEqual(sidebarPinNodePopupLaunch(pin("node"), 101)?.popupInstanceID, sidebarPinNodePopupLaunch(pin("node"), 102)?.popupInstanceID);
  });

  it("uses the same inset fullscreen modal layout as a Process Node", () => {
    const source = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");

    assert.match(source, /initialFullscreen \? fullscreenNodeEditorPopupRect\(\) : defaultNodeEditorPopupRect\(\)/);
    assert.match(source, /initialFullscreen \? "fullscreen" : "windowed"/);
    assert.match(source, /return fullscreenNodeEditorViewportRect\(\)/);
    assert.match(source, /<AppModalPortal onRequestClose=\{onClose\}>/);
    assert.match(source, /role="dialog"/);
    assert.match(source, /ariaModal/);
    assert.match(source, /style=\{nodeEditorPopupBackdropStyle\}/);
    assert.match(source, /left: popupRect\.left, top: popupRect\.top, width: popupRect\.width, height: popupRect\.height/);
    assert.doesNotMatch(source, /sidebar-fill|sidebarFillNodeEditorPopupRect|initialSidebarFill/);
  });
});

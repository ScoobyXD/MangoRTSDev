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
  it("opens only pinned Nodes beside the sidebar and gives each open a fresh instance identity", () => {
    assert.deepEqual(sidebarPinNodePopupLaunch(pin("node"), 101), {
      nodeID: "resource-1",
      nodeTitle: "Pinned resource",
      initialSidebarFill: true,
      popupInstanceID: 101,
    });
    assert.equal(sidebarPinNodePopupLaunch(pin("logic_gate"), 102), null);
    assert.equal(sidebarPinNodePopupLaunch(pin("project"), 103), null);
    assert.notEqual(sidebarPinNodePopupLaunch(pin("node"), 101)?.popupInstanceID, sidebarPinNodePopupLaunch(pin("node"), 102)?.popupInstanceID);
  });

  it("fills only the viewport beside the sidebar until the user chooses full screen", () => {
    const source = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");

    assert.match(source, /const left = Math\.max\(0, Math\.min\(window\.innerWidth, Math\.ceil\(nodeEditorPopupSidebarBoundary\(\) \?\? 0\)\)\)/);
    assert.match(source, /width: Math\.max\(0, window\.innerWidth - left\)/);
    assert.match(source, /height: Math\.max\(0, window\.innerHeight\)/);
    assert.match(source, /<AppModalPortal trapFocus=\{!popupSidebarFill\} onRequestClose=\{onClose\}>/);
    assert.match(source, /role=\{popupSidebarFill \? "group" : "dialog"\}/);
    assert.match(source, /ariaModal=\{!popupSidebarFill\}/);
    assert.match(source, /left: popupSidebarFill \? popupRect\.left : 0/);
    assert.doesNotMatch(source, /const nodeEditorPopupBackdropStyle[\s\S]*?\binset:\s*0[\s\S]*?const nodeEditorPopupStyle/);
    assert.match(source, /left: popupSidebarFill \? 0 : popupRect\.left/);
    assert.match(source, /restoredViewMode === "sidebar-fill"\s*\? sidebarFillNodeEditorPopupRect\(\)/);
  });
});

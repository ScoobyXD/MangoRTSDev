import assert from "node:assert/strict";
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
  it("opens only pinned Nodes at their normal size and gives each open a fresh instance identity", () => {
    assert.deepEqual(sidebarPinNodePopupLaunch(pin("node"), 101), {
      nodeID: "resource-1",
      nodeTitle: "Pinned resource",
      initialFullscreen: false,
      popupInstanceID: 101,
    });
    assert.equal(sidebarPinNodePopupLaunch(pin("logic_gate"), 102), null);
    assert.equal(sidebarPinNodePopupLaunch(pin("project"), 103), null);
    assert.notEqual(sidebarPinNodePopupLaunch(pin("node"), 101)?.popupInstanceID, sidebarPinNodePopupLaunch(pin("node"), 102)?.popupInstanceID);
  });
});

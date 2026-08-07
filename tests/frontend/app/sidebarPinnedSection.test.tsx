import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { Simulate } from "react-dom/test-utils";
import type { SidebarPinTree } from "../../../frontend/src/app/sidebarPins.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

test("Pinned renders one compact elevated surface with recursive hairline folders, one-click rename, a flat-row bump, and a red remove hover", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLButtonElement", "HTMLInputElement", "HTMLFieldSetElement", "HTMLLegendElement",
    "Event", "EventTarget", "MouseEvent", "PointerEvent", "KeyboardEvent", "FocusEvent",
  ] as const;
  for (const name of browserGlobals) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  const legacyInputPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
  legacyInputPrototype.attachEvent = () => undefined;
  legacyInputPrototype.detachEvent = () => undefined;
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { AppSidebarPinnedSection }] = await Promise.all([
      import("react-dom/client"),
      import("../../../frontend/src/app/AppSidebarPinnedSection.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const tree: SidebarPinTree = {
      folders: [
        { folderID: "folder-a", parentFolderID: "", name: "Folder A", position: 1000, createdTimestamp: "2026-08-06T00:00:00Z", updatedTimestamp: "2026-08-06T00:00:00Z" },
        { folderID: "folder-b", parentFolderID: "folder-a", name: "Folder B", position: 1000, createdTimestamp: "2026-08-06T00:00:01Z", updatedTimestamp: "2026-08-06T00:00:01Z" },
      ],
      pins: [
        { pinID: "pin-root", parentFolderID: "", kind: "node", id: "node-root", name: "Root Node", position: 2000, createdTimestamp: "2026-08-06T00:00:02Z" },
        { pinID: "pin-nested", parentFolderID: "folder-b", kind: "logic_gate", id: "gate-1", name: "Nested Gate", position: 1000, createdTimestamp: "2026-08-06T00:00:03Z" },
      ],
    };
    let openedPinID = "";
    await act(async () => root.render(
      <AppSidebarPinnedSection
        tree={tree}
        dropActive={false}
        dropSuccess=""
        pinnedResourceDropBusy={false}
        onPinOpen={(pin) => { openedPinID = pin.pinID; }}
        onPinOpenInNewTab={() => undefined}
        onPinRemove={() => undefined}
        onCreateFolder={async () => null}
        onRenameFolder={async () => undefined}
        onDeleteFolder={async () => undefined}
        onMoveEntry={() => undefined}
        onGroupPins={async () => null}
        onExternalDrop={() => undefined}
        pinAcceptsResourceDrag={() => false}
        onPinnedResourceDrop={() => false}
        onPinDragEnter={() => undefined}
        onPinDragLeave={() => undefined}
      />,
    ));

    const surface = container.querySelector<HTMLElement>('[data-sidebar-pinned-surface="elevated"]');
    assert.ok(surface);
    assert.notEqual(surface.style.boxShadow, "", "the whole Pinned section owns the elevation");

    const folderA = container.querySelector<HTMLFieldSetElement>('fieldset[data-pin-folder-frame="folder-a"]');
    assert.ok(folderA);
    assert.equal(folderA.style.borderTopWidth, "1px");
    assert.equal(folderA.style.boxShadow, "none", "folder outlines are not elevated surfaces");
    const folderALegend = folderA.querySelector<HTMLLegendElement>("legend");
    assert.ok(folderALegend);
    assert.equal(folderALegend.style.marginLeft, "11px", "the folder title begins after a short leading rule");
    assert.equal(folderALegend.style.gap, "1px", "the disclosure arrow stays close to the folder title");
    assert.equal(folderALegend.querySelectorAll("svg").length, 1, "the legend has only its disclosure icon, not a folder icon");

    const folderATitle = container.querySelector<HTMLButtonElement>('button[data-pin-folder-title="folder-a"]');
    assert.ok(folderATitle);
    await act(async () => Simulate.click(folderATitle));
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Pinned folder name"]');
    assert.ok(renameInput, "one click on a folder title starts inline rename");
    assert.equal(renameInput.value, "Folder A");
    await act(async () => Simulate.keyDown(renameInput, { key: "Escape" }));

    const folderAContents = container.querySelector<HTMLElement>('[data-pin-folder-contents="folder-a"]');
    const folderB = container.querySelector<HTMLFieldSetElement>('fieldset[data-pin-folder-frame="folder-b"]');
    assert.ok(folderAContents && folderB && folderAContents.contains(folderB), "nested folders render as indented recursive outlines");
    assert.equal(folderAContents.style.paddingLeft, "10px");

    const pinEntry = container.querySelector<HTMLElement>('[data-pin-entry-id="pin-root"]');
    const pinButton = pinEntry?.querySelector<HTMLButtonElement>("button");
    assert.ok(pinEntry && pinButton);
    assert.match(pinButton.getAttribute("style") ?? "", /border: 0px/);
    assert.match(pinButton.getAttribute("style") ?? "", /background: transparent/);
    await act(async () => Simulate.mouseEnter(pinButton));
    assert.equal(pinEntry.dataset.pinRaised, "true");
    assert.equal(pinEntry.style.transform, "translateY(-2px)");
    await act(async () => Simulate.click(pinButton));
    assert.equal(openedPinID, "pin-root");

    const removeButton = pinEntry.querySelector<HTMLButtonElement>('button[aria-label="Unpin Root Node"]');
    assert.ok(removeButton);
    await act(async () => Simulate.mouseEnter(removeButton));
    assert.equal(removeButton.dataset.pinRemoveActive, "true");
    assert.equal(removeButton.style.color, "rgb(255, 32, 32)");
    assert.equal(removeButton.style.borderColor, "rgb(255, 32, 32)");
    await act(async () => Simulate.mouseLeave(removeButton));
    assert.equal(removeButton.dataset.pinRemoveActive, undefined);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

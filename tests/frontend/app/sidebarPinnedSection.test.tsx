import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { Simulate } from "react-dom/test-utils";
import { APP_SIDEBAR_PIN_DRAG_MIME } from "../../../frontend/src/app/sidebarPinDrops.js";
import type { SidebarPinEntryRef, SidebarPinTree } from "../../../frontend/src/app/sidebarPins.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

class FakeDataTransfer {
  private readonly values = new Map<string, string>();
  effectAllowed = "all";
  dropEffect = "none";

  get types(): string[] {
    return Array.from(this.values.keys());
  }

  getData(type: string): string {
    return this.values.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.values.set(type, value);
  }
}

function dataTransfer(): DataTransfer {
  return new FakeDataTransfer() as unknown as DataTransfer;
}

test("Pinned renders Company Explorer-style folders, previews deliberate pin grouping, and preserves exact nested drag identity", async () => {
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
        { pinID: "pin-notes", parentFolderID: "folder-a", kind: "node", id: "node-notes", name: "Notes Node", position: 2000, createdTimestamp: "2026-08-06T00:00:04Z" },
      ],
    };
    let openedPinID = "";
    const moves: Array<{ moving: SidebarPinEntryRef; target: SidebarPinEntryRef | null; placement: string }> = [];
    const groups: Array<{ draggedPinID: string; targetPinID: string }> = [];
    await act(async () => root.render(
      <AppSidebarPinnedSection
        tree={tree}
        logicGateStatusCountsByID={{ "gate-1": { request: 12, pending: 3, inProgress: 4, review: 5 } }}
        dropActive={false}
        dropSuccess=""
        pinnedResourceDropBusy={false}
        onPinOpen={(pin) => { openedPinID = pin.pinID; }}
        onPinOpenInNewTab={() => undefined}
        onPinRemove={() => undefined}
        onCreateFolder={async () => null}
        onRenameFolder={async () => undefined}
        onDeleteFolder={async () => undefined}
        onMoveEntry={(moving, target, placement) => { moves.push({ moving, target, placement }); }}
        onGroupPins={async (dragged, target) => {
          groups.push({ draggedPinID: dragged.pinID, targetPinID: target.pinID });
          return null;
        }}
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
    assert.equal(folderA.style.borderTopWidth, "0px", "folder frames have no continuous top edge");
    assert.equal(folderA.style.borderBottomWidth, "0px", "folder frames have no continuous bottom edge");
    assert.equal(folderA.style.borderLeftWidth, "0px", "folder frames have no continuous left edge");
    assert.equal(folderA.style.borderRightWidth, "0px", "folder frames have no continuous right edge");
    assert.equal(folderA.style.backgroundImage.match(/linear-gradient/g)?.length, 8, "four corners each draw one horizontal and one vertical segment");
    assert.equal(folderA.style.backgroundPosition, "left top, left top, right top, right top, left bottom, left bottom, right bottom, right bottom");
    assert.equal(folderA.style.backgroundSize, "6px 1px, 1px 5px, 6px 1px, 1px 5px, 6px 1px, 1px 5px, 6px 1px, 1px 5px");
    assert.equal(folderA.style.width, "calc(100% - 4px)", "folder corners are inset from both outer edges");
    assert.equal(folderA.style.margin, "0px 2px");
    assert.equal(folderA.style.boxShadow, "none", "folder outlines are not elevated surfaces");
    const folderAEntry = folderA.closest<HTMLElement>('[data-pin-entry="folder"]');
    assert.ok(folderAEntry);
    await act(async () => Simulate.mouseEnter(folderAEntry));
    assert.equal(folderA.dataset.pinFolderRaised, "true", "hovering anywhere in a folder elevates its complete frame");
    assert.equal(folderA.style.transform, "translateY(-2px)");
    assert.notEqual(folderA.style.boxShadow, "none");
    await act(async () => Simulate.mouseLeave(folderAEntry, { relatedTarget: surface }));
    assert.equal(folderA.dataset.pinFolderRaised, undefined);
    assert.equal(folderA.style.transform, "translateY(0)");
    const folderALegend = folderA.querySelector<HTMLLegendElement>("legend");
    assert.ok(folderALegend);
    assert.equal(folderALegend.style.marginLeft, "6px", "the folder title begins after the shortened top-left corner");
    assert.equal(folderALegend.style.gap, "2px", "the disclosure arrow stays close to the folder title");
    assert.equal(folderALegend.querySelectorAll("svg").length, 2, "the folder title uses the same disclosure and folder icons as Company Explorer");

    const folderRequest = folderA.querySelector<HTMLElement>('[data-pin-folder-status-column] [data-pin-status="request"]');
    const folderPending = folderA.querySelector<HTMLElement>('[data-pin-folder-status-column] [data-pin-status="pending"]');
    const folderInProgress = folderA.querySelector<HTMLElement>('[data-pin-folder-status-column] [data-pin-status="inProgress"]');
    const folderReview = folderA.querySelector<HTMLElement>('[data-pin-folder-status-column] [data-pin-status="review"]');
    assert.equal(folderRequest?.dataset.pinStatusCount, "12", "the collapsed parent shows its nested Logic Gate request total");
    assert.equal(folderPending?.dataset.pinStatusCount, "3");
    assert.equal(folderInProgress?.dataset.pinStatusCount, "4");
    assert.equal(folderReview?.dataset.pinStatusCount, "5", "the collapsed parent shows its nested Logic Gate review total");
    assert.equal(folderRequest?.style.backgroundColor, "rgb(250, 204, 21)");
    assert.equal(folderInProgress?.style.backgroundColor, "rgb(254, 155, 70)");
    assert.equal(folderReview?.style.backgroundColor, "rgb(25, 168, 255)");
    assert.equal(folderRequest?.style.backgroundImage, "linear-gradient(135deg, rgb(255, 251, 209) 0%, rgb(255, 242, 77) 42%, rgb(250, 204, 21) 100%)");
    assert.equal(folderInProgress?.style.backgroundImage, "none");
    assert.equal(folderReview?.style.backgroundImage, "linear-gradient(180deg, rgb(51, 221, 213) 0%, rgb(25, 168, 255) 100%)");
    for (const box of [folderRequest, folderPending, folderInProgress, folderReview]) {
      assert.equal(box?.style.width, "17px", "every count box has the same fixed width regardless of digit count");
      assert.equal(box?.style.padding, "0px");
    }
    const folderStatusColumn = folderA.querySelector<HTMLElement>("[data-pin-folder-status-column]");
    const folderStatusGrid = folderStatusColumn?.querySelector<HTMLElement>("[data-pin-status-counts]");
    assert.ok(folderStatusColumn && folderStatusGrid);
    assert.equal(folderStatusColumn.parentElement, folderALegend, "folder totals stay on the same row as the folder title");
    assert.equal(folderALegend.style.width, "calc(100% - 24px)", "folder totals reach the same right-side columns as pin totals after shortening the corner");
    assert.equal(folderALegend.style.gridTemplateColumns, "14px minmax(0, 1fr) 74px");
    assert.equal(folderStatusGrid.style.gridTemplateColumns, "repeat(4, 17px)");
    assert.equal(folderRequest?.parentElement?.dataset.pinStatusSlot, "request");
    assert.equal(folderReview?.parentElement?.dataset.pinStatusSlot, "review");

    const folderATitle = container.querySelector<HTMLButtonElement>('button[data-pin-folder-title="folder-a"]');
    assert.ok(folderATitle);
    assert.equal(container.querySelector('[data-pin-folder-contents="folder-a"]'), null, "the folder starts collapsed");
    await act(async () => Simulate.focus(folderATitle));
    assert.equal(folderATitle.style.background, "transparent", "folder focus does not draw a gray title rectangle");
    assert.equal(folderATitle.style.boxShadow, "none");
    assert.equal(folderATitle.style.borderRadius, "0px");
    assert.equal(folderATitle.style.outline, "none");
    assert.equal(folderATitle.dataset.pinFolderTitleFocused, undefined, "folder focus has no special rectangle state");
    await act(async () => Simulate.click(folderATitle));
    assert.equal(container.querySelector('input[aria-label="Pinned folder name"]'), null, "one click does not rename a folder");
    assert.ok(container.querySelector('[data-pin-folder-contents="folder-a"]'), "clicking the folder name expands it like Company Explorer");
    await act(async () => Simulate.doubleClick(folderATitle));
    assert.equal(container.querySelector('input[aria-label="Pinned folder name"]'), null, "double click does not rename a folder");
    await act(async () => Simulate.contextMenu(folderATitle, { clientX: 42, clientY: 55 }));
    const folderMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Pinned folder actions"]');
    assert.ok(folderMenu, "right click opens the folder action menu");
    assert.equal(folderMenu.style.width, "158px");
    assert.equal(folderMenu.style.minWidth, "158px");
    assert.equal(folderMenu.style.maxWidth, "158px");
    const renameAction = Array.from(folderMenu.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Rename");
    assert.ok(renameAction);
    await act(async () => Simulate.click(renameAction));
    const renameInput = container.querySelector<HTMLInputElement>('input[aria-label="Pinned folder name"]');
    assert.ok(renameInput, "the explicit Rename action starts inline rename");
    assert.equal(renameInput.value, "Folder A");
    await act(async () => Simulate.keyDown(renameInput, { key: "Escape" }));

    const folderAContents = container.querySelector<HTMLElement>('[data-pin-folder-contents="folder-a"]');
    const folderB = container.querySelector<HTMLFieldSetElement>('fieldset[data-pin-folder-frame="folder-b"]');
    assert.ok(folderAContents && folderB && folderAContents.contains(folderB), "nested folders render as indented recursive outlines");
    const folderADropAnchor = folderA.querySelector<HTMLElement>('[data-pin-drop-anchor="folder:folder-a"]');
    assert.ok(folderADropAnchor && !folderADropAnchor.contains(folderB), "the expanded subtree is outside the folder header drop hitbox");
    assert.equal(folderAContents.style.paddingLeft, "10px");
    assert.equal(folderAContents.style.marginRight, "-6px", "each nested level restores the parent's right-side action columns after the corner inset");

    const folderBLegend = folderB.querySelector<HTMLLegendElement>("legend");
    assert.ok(folderBLegend);
    assert.equal(folderB.querySelector<HTMLElement>('[data-pin-folder-status-column] [data-pin-status="request"]')?.dataset.pinStatusCount, "12");
    const folderBDisclosure = folderB.querySelector<HTMLButtonElement>('button[aria-label="Expand Folder B"]');
    assert.ok(folderBDisclosure);
    await act(async () => Simulate.click(folderBDisclosure));
    const logicGateEntry = container.querySelector<HTMLElement>('[data-pin-entry-id="pin-nested"]');
    assert.ok(logicGateEntry, "expanding the nested folder reveals the counted Logic Gate row");
    assert.equal(logicGateEntry.querySelector<HTMLElement>('[data-pin-status="request"]')?.dataset.pinStatusCount, "12");
    assert.equal(logicGateEntry.querySelector<HTMLElement>('[data-pin-status="review"]')?.dataset.pinStatusCount, "5");
    assert.equal(logicGateEntry.querySelector<HTMLElement>('[data-pin-status-counts]')?.style.gridTemplateColumns, "repeat(4, 17px)");

    const pinEntry = container.querySelector<HTMLElement>('[data-pin-entry-id="pin-root"]');
    const pinButton = pinEntry?.querySelector<HTMLButtonElement>("button");
    assert.ok(pinEntry && pinButton);
    const rootNodeStatusSlots = pinEntry.querySelectorAll('[data-pin-status-slot]');
    assert.equal(rootNodeStatusSlots.length, 4, "non-Logic-Gate rows reserve the same four status columns");
    assert.equal(pinEntry.querySelector('[data-pin-status]'), null, "reserved Node slots contain no status square");
    assert.match(pinButton.getAttribute("style") ?? "", /border: 0px/);
    assert.match(pinButton.getAttribute("style") ?? "", /background: transparent/);
    await act(async () => Simulate.mouseEnter(pinButton));
    assert.equal(pinEntry.dataset.pinRaised, "true", "individual pin rows elevate on hover");
    assert.equal(pinEntry.style.transform, "translateY(-2px)");
    assert.notEqual(pinEntry.style.boxShadow, "none");
    await act(async () => Simulate.mouseLeave(pinButton));
    assert.equal(pinEntry.dataset.pinRaised, undefined);
    await act(async () => Simulate.click(pinButton));
    assert.equal(openedPinID, "pin-root");

    const removeButton = pinEntry.querySelector<HTMLButtonElement>('button[aria-label="Unpin Root Node"]');
    assert.ok(removeButton);
    assert.equal(removeButton.dataset.pinRemoveColumn, "true");
    await act(async () => Simulate.mouseEnter(removeButton));
    assert.equal(removeButton.dataset.pinRemoveActive, "true");
    assert.equal(removeButton.style.color, "rgb(255, 32, 32)");
    assert.equal(removeButton.style.borderColor, "rgb(255, 32, 32)");
    await act(async () => Simulate.mouseLeave(removeButton));
    assert.equal(removeButton.dataset.pinRemoveActive, undefined);

    const notesEntry = container.querySelector<HTMLElement>('[data-pin-entry-id="pin-notes"]');
    const folderBEntry = container.querySelector<HTMLElement>('[data-pin-entry-id="folder-b"]');
    assert.ok(notesEntry && folderBEntry);

    await act(async () => Simulate.dragStart(notesEntry, { dataTransfer: dataTransfer() }));
    await act(async () => Simulate.dragOver(pinEntry, { dataTransfer: dataTransfer(), clientY: 0 }));
    await act(async () => Simulate.drop(pinEntry, { dataTransfer: dataTransfer(), clientY: 0 }));
    assert.deepEqual(groups, [], "releasing before the one-second hover does not group pins");
    assert.equal(container.querySelector('[data-pin-group-preview]'), null);

    await act(async () => Simulate.dragStart(notesEntry, { dataTransfer: dataTransfer() }));
    await act(async () => Simulate.dragOver(pinEntry, { dataTransfer: dataTransfer(), clientY: 0 }));
    await act(async () => new Promise((resolveDelay) => setTimeout(resolveDelay, 1050)));
    assert.deepEqual(groups, [], "the armed preview does not write before mouse release");
    const preview = container.querySelector<HTMLElement>('[data-pin-group-preview="pin-root"]');
    assert.ok(preview, "one continuous second over a pin previews a New Folder");
    assert.equal(preview.getAttribute("aria-label"), "New Folder preview");
    assert.deepEqual(
      Array.from(preview.querySelectorAll<HTMLElement>("[data-pin-group-preview-entry]")).map((entry) => entry.dataset.pinGroupPreviewEntry),
      ["pin-root", "pin-notes"],
      "the preview places the target first and dragged pin second",
    );
    assert.equal(notesEntry.style.display, "none", "the dragged pin temporarily appears inside the preview instead of twice");
    await act(async () => Simulate.dragLeave(pinEntry, { dataTransfer: dataTransfer(), relatedTarget: surface }));
    assert.equal(container.querySelector('[data-pin-group-preview]'), null, "moving away immediately restores the normal tree");
    assert.notEqual(notesEntry.style.display, "none");
    assert.deepEqual(groups, [], "canceling the preview performs no grouping command");

    await act(async () => Simulate.dragStart(notesEntry, { dataTransfer: dataTransfer() }));
    await act(async () => Simulate.dragOver(pinEntry, { dataTransfer: dataTransfer(), clientY: 0 }));
    await act(async () => new Promise((resolveDelay) => setTimeout(resolveDelay, 1050)));
    assert.ok(container.querySelector('[data-pin-group-preview="pin-root"]'));
    const payloadWithheldAtGroupDrop = dataTransfer();
    payloadWithheldAtGroupDrop.setData(APP_SIDEBAR_PIN_DRAG_MIME, "");
    await act(async () => Simulate.drop(pinEntry, { dataTransfer: payloadWithheldAtGroupDrop, clientY: 0 }));
    assert.deepEqual(groups, [{ draggedPinID: "pin-notes", targetPinID: "pin-root" }], "only releasing while the preview is armed creates the folder");
    assert.equal(container.querySelector('[data-pin-group-preview]'), null);

    const startTransfer = dataTransfer();
    await act(async () => Simulate.dragStart(notesEntry, { dataTransfer: startTransfer }));
    const payloadWithheldAtFolderDrop = dataTransfer();
    payloadWithheldAtFolderDrop.setData(APP_SIDEBAR_PIN_DRAG_MIME, "");
    await act(async () => Simulate.drop(folderBEntry, { dataTransfer: payloadWithheldAtFolderDrop, clientY: 0 }));
    assert.deepEqual(moves[0], {
      moving: { entryType: "pin", entryID: "pin-notes" },
      target: { entryType: "folder", entryID: "folder-b" },
      placement: "inside",
    }, "the exact child pin moves into its sibling folder instead of its draggable parent replacing the payload");

    await act(async () => Simulate.dragStart(notesEntry, { dataTransfer: dataTransfer() }));
    const payloadWithheldAtRootDrop = dataTransfer();
    payloadWithheldAtRootDrop.setData(APP_SIDEBAR_PIN_DRAG_MIME, "");
    await act(async () => Simulate.drop(surface, { dataTransfer: payloadWithheldAtRootDrop }));
    assert.deepEqual(moves[1], {
      moving: { entryType: "pin", entryID: "pin-notes" },
      target: null,
      placement: "after",
    }, "the retained internal payload moves a nested pin back to the Pinned root");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

test("Pinned appears above Tower in the sidebar", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/app/AppSidebarChrome.tsx"), "utf8");
  const pinnedIndex = source.indexOf("<AppSidebarPinnedSection");
  const towerIndex = source.indexOf('aria-label="Tower"');
  assert.ok(pinnedIndex >= 0 && towerIndex > pinnedIndex);
});

import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { Simulate } from "react-dom/test-utils";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

test("GVIC assignment people list opens immediately on hover and closes when the pointer leaves", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLSpanElement", "HTMLButtonElement", "HTMLInputElement",
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
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  dom.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
  dom.window.cancelAnimationFrame = (handle) => clearTimeout(handle);
  installGlobal("requestAnimationFrame", dom.window.requestAnimationFrame, restores);
  installGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { EditorLinkedDocumentPanels }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const noop = () => undefined;
    const editingTitleRef = React.createRef<HTMLSpanElement>();
    const editingTitleDraftRef = { current: "" };
    await act(async () => root.render(
      <EditorLinkedDocumentPanels
        activeTab="editor"
        linkedEntityKind="logic_gate"
        linkedNodeTitle="Daily Huddles"
        linkedNodeInfoPreview={[]}
        linkedNodeMetadataRows={[]}
        linkedNodeHistoryRows={[]}
        canEdit
        canEditGVIC
        nodePresetFields={null}
        gvicFields={{
          assignments: [{
            company_id: "company-1",
            logic_gate_id: "logic-gate-1",
            role: "informed",
            principal_type: "user",
            principal_id: "user-1",
            user_id: "user-1",
            user_display_name: "Jonathan Kim",
            user_email: "jonathankim829@gmail.com",
          }],
        }}
        companyUsers={[]}
        companyUserGroups={[]}
        companyUserGroupMembers={[]}
        isEditingTitle={false}
        editingTitleRef={editingTitleRef}
        editingTitleDraftRef={editingTitleDraftRef}
        accent="#2563eb"
        titleTextColor="#111827"
        panelBackground="#ffffff"
        ruleColor="#cbd5e1"
        onSetIsEditingTitle={noop}
        onUpdateTitle={async () => undefined}
        onCommitNodeStatus={noop}
        onSetNodePriorityDraft={noop}
        onCommitNodePriorityDraft={noop}
        onCommitNodeAccountIDs={noop}
        onSetNodeDueDateDraft={noop}
        onCommitNodeDueDateDraft={noop}
        onAddGVICPrincipal={noop}
        onRemoveGVICPrincipal={noop}
      />,
    ));

    const peopleButton = container.querySelector<HTMLButtonElement>('button[aria-label="Informed people"]');
    assert.ok(peopleButton);
    assert.equal(peopleButton.textContent?.includes("People (1)"), true);
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null);

    await act(async () => Simulate.mouseEnter(peopleButton));

    const peopleList = dom.window.document.querySelector<HTMLElement>('[role="listbox"][aria-label="Informed people and groups"]');
    assert.ok(peopleList, "merely hovering the count must open the assigned people list");
    assert.equal(peopleList.parentElement, dom.window.document.body, "the hovered list escapes clipping editor containers");
    assert.match(peopleList.textContent ?? "", /Jonathan Kim/);
    assert.match(peopleList.textContent ?? "", /jonathankim829@gmail\.com/);

    await act(async () => {
      Simulate.mouseLeave(peopleButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null, "leaving the People count closes a hover-only preview");

    await act(async () => Simulate.mouseEnter(peopleButton));
    const interactivePeopleList = dom.window.document.querySelector<HTMLElement>('[role="listbox"][aria-label="Informed people and groups"]');
    assert.ok(interactivePeopleList);
    await act(async () => {
      Simulate.mouseLeave(peopleButton);
      Simulate.mouseEnter(interactivePeopleList);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), "the preview stays open while the pointer is over its list");

    await act(async () => {
      Simulate.mouseLeave(interactivePeopleList);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null, "leaving the list closes the hover preview");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

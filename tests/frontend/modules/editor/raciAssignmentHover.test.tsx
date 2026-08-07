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

test("RACI cards keep Add on top, show every assignment on one line, and preserve the hover list", async () => {
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
    const informedNames = ["Jonathan Kim", "Christina Phan", "Maya Patel", "Andre Silva", "Rina Cho"];
    await act(async () => root.render(
      <EditorLinkedDocumentPanels
        activeTab="editor"
        linkedEntityKind="logic_gate"
        linkedNodeTitle="Daily Huddles"
        linkedNodeInfoPreview={[]}
        linkedNodeMetadataRows={[]}
        linkedNodeHistoryRows={[]}
        canEdit
        canEditRACI
        nodePresetFields={null}
        gvicFields={{
          assignments: informedNames.map((name, index) => ({
            company_id: "company-1",
            logic_gate_id: "logic-gate-1",
            role: "informed" as const,
            principal_type: "user" as const,
            principal_id: `user-${index + 1}`,
            user_id: `user-${index + 1}`,
            user_display_name: name,
            user_email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
          })),
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
        onAddRACIPrincipal={noop}
        onRemoveRACIPrincipal={noop}
      />,
    ));

    const assignmentButton = container.querySelector<HTMLButtonElement>('button[aria-label="Informed people and groups"]');
    assert.ok(assignmentButton);
    assert.equal(assignmentButton.textContent?.includes("Jonathan Kim"), true);
    const informedCard = container.querySelector<HTMLElement>('[data-raci-role-card="informed"]');
    const addButton = informedCard?.querySelector<HTMLButtonElement>('button[data-raci-add-principal="informed"]');
    assert.ok(informedCard && addButton);
    assert.equal(addButton.parentElement?.style.gridRow, "1", "Add stays in the top role-heading row");
    assert.equal(assignmentButton.parentElement?.style.gridRow, "2", "the name surface receives the full second row");
    assert.match(informedCard.getAttribute("style") ?? "", /radial-gradient/, "role cards use the stronger Kanban-style layered gradient");
    const assignmentNameRows = Array.from(assignmentButton.querySelectorAll<HTMLElement>('[data-raci-assignment-name="informed"]'));
    assert.deepEqual(assignmentNameRows.map((row) => row.textContent?.trim()), informedNames);
    assert.equal(assignmentNameRows.every((row) => row.style.whiteSpace === "nowrap"), true, "each assigned principal owns one unwrapped line");
    const responsibleEmptyRow = container.querySelector<HTMLElement>('[data-raci-assignment-empty="responsible"]');
    assert.ok(responsibleEmptyRow);
    assert.equal(responsibleEmptyRow.textContent, "No assignments");
    assert.equal(responsibleEmptyRow.style.whiteSpace, "nowrap", "an empty single entry never becomes a two-line pill");
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null);

    await act(async () => Simulate.mouseEnter(assignmentButton));

    const assignmentList = dom.window.document.querySelector<HTMLElement>('[role="listbox"][aria-label="Informed people and groups"]');
    assert.ok(assignmentList, "merely hovering the names must open the assigned people and groups list");
    assert.equal(assignmentList.parentElement, dom.window.document.body, "the hovered list escapes clipping editor containers");
    assert.match(assignmentList.textContent ?? "", /Jonathan Kim/);
    assert.match(assignmentList.textContent ?? "", /jonathan\.kim@example\.com/);

    await act(async () => {
      Simulate.mouseLeave(assignmentButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null, "leaving the assignment names closes a hover-only preview");

    await act(async () => Simulate.mouseEnter(assignmentButton));
    const interactiveAssignmentList = dom.window.document.querySelector<HTMLElement>('[role="listbox"][aria-label="Informed people and groups"]');
    assert.ok(interactiveAssignmentList);
    await act(async () => {
      Simulate.mouseLeave(assignmentButton);
      Simulate.mouseEnter(interactiveAssignmentList);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.ok(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), "the preview stays open while the pointer is over its list");

    await act(async () => {
      Simulate.mouseLeave(interactiveAssignmentList);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(dom.window.document.querySelector('[role="listbox"][aria-label="Informed people and groups"]'), null, "leaving the list closes the hover preview");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

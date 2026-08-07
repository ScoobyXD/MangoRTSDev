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

test("RACI cards resolve directory names, place two assignments per row, and preserve the hover list", async () => {
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
    const informedUserIDs = [
      "019e090c-e62f-781b-b123-000000000001",
      "955a2eed-cdfb-9845-b123-000000000002",
      "c8cb539d-7a62-4bc8-b123-000000000003",
      "ec114c8d-46b5-4ee0-b123-000000000004",
      "f2ae47cb-e499-4818-b123-000000000005",
    ];
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
          assignments: informedNames.map((_name, index) => ({
            company_id: "company-1",
            logic_gate_id: "logic-gate-1",
            role: "informed" as const,
            principal_type: "user" as const,
            principal_id: informedUserIDs[index],
            user_id: informedUserIDs[index],
            user_email: `${informedNames[index].toLowerCase().replace(/\s+/g, ".")}@example.com`,
          })),
        }}
        companyUsers={informedNames.map((name, index) => ({
          user_id: informedUserIDs[index],
          display_name: name,
          email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        }))}
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
    assert.match(informedCard.getAttribute("style") ?? "", /radial-gradient/, "role cards use a layered Kanban-color gradient");
    const expectedLightRoleColors = new Map([
      ["responsible", "rgba(240, 138, 36, 0.14)"],
      ["accountable", "rgba(25, 200, 121, 0.14)"],
      ["consulted", "rgba(25, 168, 255, 0.14)"],
      ["informed", "rgba(139, 92, 246, 0.14)"],
    ]);
    for (const [role, expectedColor] of expectedLightRoleColors) {
      const roleCard = container.querySelector<HTMLElement>(`[data-raci-role-card="${role}"]`);
      assert.ok(roleCard);
      assert.equal(roleCard.getAttribute("style")?.includes(expectedColor), true, `${role} uses its light Kanban palette color`);
      assert.doesNotMatch(roleCard.getAttribute("style") ?? "", /, 0\.(?:42|54|86)\)/, `${role} does not restore the dark gradient`);
    }
    const assignmentNameRows = Array.from(assignmentButton.querySelectorAll<HTMLElement>('[data-raci-assignment-name="informed"]'));
    assert.deepEqual(assignmentNameRows.map((row) => row.textContent?.trim()), informedNames);
    assert.equal(informedUserIDs.some((userID) => assignmentButton.textContent?.includes(userID)), false, "internal user IDs never appear as RACI labels");
    const assignmentNamesGrid = assignmentButton.querySelector<HTMLElement>('[data-raci-assignment-names="informed"]');
    assert.equal(assignmentNamesGrid?.style.gridTemplateColumns, "repeat(2, minmax(0, 1fr))", "two equal name columns share each assignment row");
    assert.equal(assignmentNameRows.every((row) => row.style.whiteSpace === "nowrap"), true, "each assigned principal owns one unwrapped line");
    assert.equal(assignmentNameRows.slice(0, -1).every((row) => row.dataset.raciAssignmentRowWidth === "half" && row.style.gridColumn === ""), true, "complete pairs share their row equally");
    assert.equal(assignmentNameRows.at(-1)?.dataset.raciAssignmentRowWidth, "full", "the fifth assignment owns the final row by itself");
    assert.equal(assignmentNameRows.at(-1)?.style.gridColumn, "1 / -1", "an unpaired final name receives the full card width");
    const roleGrid = container.querySelector<HTMLElement>('[aria-label="RACI assignments"]');
    assert.equal(roleGrid?.style.gridTemplateColumns, "repeat(4, minmax(170px, 1fr))", "all four expanded RACI cards retain equal widths");
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

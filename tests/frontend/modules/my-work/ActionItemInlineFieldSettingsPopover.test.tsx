import assert from "node:assert/strict";
import test from "node:test";
import React, { act, useState } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import type {
  ActionItemInlineFieldDefinition,
  ActionItemInlineFieldSettingsProps,
} from "../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.js";

type FieldID =
  | "person_in_charge"
  | "assigned_by"
  | "created_timestamp"
  | "source"
  | "color"
  | "analysis_due_date"
  | "completion_due_date"
  | "status"
  | "huddle_process"
  | "details"
  | "title";

const FIELDS: ReadonlyArray<ActionItemInlineFieldDefinition<FieldID>> = [
  { id: "person_in_charge", label: "Person in charge" },
  { id: "assigned_by", label: "Assigned by" },
  { id: "created_timestamp", label: "Created date" },
  { id: "source", label: "Source" },
  { id: "color", label: "Color" },
  { id: "analysis_due_date", label: "Analysis due date" },
  { id: "completion_due_date", label: "Completion due date" },
  { id: "status", label: "Status" },
  { id: "huddle_process", label: "Huddle Board" },
  { id: "details", label: "Details" },
  { id: "title", label: "Title" },
];

const DEFAULT_MINE: FieldID[] = ["assigned_by", "completion_due_date"];
const DEFAULT_DELEGATED: FieldID[] = ["person_in_charge", "completion_due_date"];

type Restore = () => void;

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

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

type HarnessProps = Pick<
  ActionItemInlineFieldSettingsProps<FieldID>,
  "fields"
> & {
  initialMine?: FieldID[];
  initialDelegated?: FieldID[];
  mode?: "wrapper" | "section" | "row";
};

function Harness({
  fields,
  initialMine = DEFAULT_MINE,
  initialDelegated = DEFAULT_DELEGATED,
  mode = "wrapper",
}: HarnessProps) {
  const [mineFieldIDs, setMineFieldIDs] = useState<FieldID[]>(initialMine);
  const [delegatedFieldIDs, setDelegatedFieldIDs] = useState<FieldID[]>(initialDelegated);
  const [openedItemID, setOpenedItemID] = useState("");
  if (mode === "section") {
    return (
      <ActionItemInlineFieldSettingsSectionForTest
        fields={fields}
        fieldIDs={mineFieldIDs}
        onFieldIDsChange={setMineFieldIDs}
        label="Huddle"
        sectionID="huddle"
        accent="#EA84E5"
      />
    );
  }
  if (mode === "row") {
    return (
      <>
        <ActionItemRowForTest
          item={{
            entity_id: "action-1",
            name: "Confirm launch date",
            color: "red",
            completion_due_date: "2026-08-30",
          }}
          displayedFields={["completion_due_date"]}
          onOpen={(item) => setOpenedItemID(item.entity_id)}
        />
        <output data-opened-action-item={openedItemID} />
      </>
    );
  }
  return (
    <ActionItemInlineFieldSettingsForTest
      fields={fields}
      mineFieldIDs={mineFieldIDs}
      delegatedFieldIDs={delegatedFieldIDs}
      onMineFieldIDsChange={setMineFieldIDs}
      onDelegatedFieldIDsChange={setDelegatedFieldIDs}
      accent="#EA84E5"
    />
  );
}

let ActionItemInlineFieldSettingsForTest:
  typeof import("../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.js").ActionItemInlineFieldSettings;
let ActionItemInlineFieldSettingsSectionForTest:
  typeof import("../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.js").ActionItemInlineFieldSettingsSection;
let ActionItemRowForTest:
  typeof import("../../../../frontend/src/modules/action-items/ActionItemRow.js").ActionItemRow;

type MountedHarness = {
  dom: JSDOM;
  root: { unmount(): void };
  restores: Restore[];
};

async function mountHarness(input: Omit<HarnessProps, "fields"> = {}): Promise<MountedHarness> {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLSpanElement", "Event", "EventTarget", "MouseEvent", "PointerEvent", "KeyboardEvent", "FocusEvent",
    "CustomEvent", "MutationObserver",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const [{ createRoot }, componentModule, rowModule] = await Promise.all([
    import("react-dom/client"),
    import("../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.tsx"),
    import("../../../../frontend/src/modules/action-items/ActionItemRow.tsx"),
  ]);
  ActionItemInlineFieldSettingsForTest = componentModule.ActionItemInlineFieldSettings;
  ActionItemInlineFieldSettingsSectionForTest = componentModule.ActionItemInlineFieldSettingsSection;
  ActionItemRowForTest = rowModule.ActionItemRow;
  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  await act(async () => root.render(<Harness fields={FIELDS} {...input} />));
  await act(async () => { await Promise.resolve(); });
  return { dom, root, restores };
}

async function unmountHarness({ dom, root, restores }: MountedHarness) {
  await act(async () => root.unmount());
  for (const restore of restores.reverse()) restore();
  dom.window.close();
}

function field(
  document: Document,
  perspective: string,
  location: "tray" | "bank",
  fieldID: FieldID,
): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-action-item-inline-field-perspective="${perspective}"]`
      + `[data-action-item-inline-field-location="${location}"]`
      + `[data-action-item-inline-field-id="${fieldID}"]`,
  );
  assert.ok(element, `${perspective} ${location} should contain ${fieldID}`);
  return element;
}

function insertion(document: Document, perspective: string, index: number): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-action-item-inline-field-insertion-perspective="${perspective}"]`
      + `[data-action-item-inline-field-insertion-index="${index}"]`,
  );
  assert.ok(element, `${perspective} should expose insertion index ${index}`);
  return element;
}

function bank(document: Document, perspective: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-action-item-inline-field-bank="${perspective}"]`);
  assert.ok(element, `${perspective} should expose a field bank`);
  return element;
}

function trayFieldIDs(document: Document, perspective: string): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(
    `[data-action-item-inline-field-perspective="${perspective}"]`
      + `[data-action-item-inline-field-location="tray"]`,
  )).map((element) => element.dataset.actionItemInlineFieldId ?? "");
}

async function drag(source: HTMLElement, target: HTMLElement, assertPreview = false) {
  const transfer = dataTransfer();
  await act(async () => Simulate.dragStart(source, { dataTransfer: transfer }));
  await act(async () => {
    Simulate.dragEnter(target, { dataTransfer: transfer });
    Simulate.dragOver(target, { dataTransfer: transfer });
  });
  if (assertPreview) {
    assert.equal(target.dataset.actionItemInlineFieldInsertionActive, "true");
    assert.equal(target.style.width, "34px", "active insertion makes room so surrounding tray fields reflow");
  }
  await act(async () => Simulate.drop(target, { dataTransfer: transfer }));
  await act(async () => Simulate.dragEnd(source, { dataTransfer: transfer }));
}

test("embedded Action Item row-field settings expose the Mine and Delegated quadrants, use the pink accent, allow an empty tray, and exclude Details and Title", async () => {
  const mounted = await mountHarness({ initialMine: [] });
  try {
    const { document } = mounted.dom.window;
    const sections = Array.from(document.querySelectorAll<HTMLElement>("[data-action-item-inline-field-section]"));
    assert.deepEqual(
      sections.map((section) => section.dataset.actionItemInlineFieldSection),
      ["mine", "delegated"],
    );
    assert.deepEqual(
      sections.map((section) => section.dataset.actionItemViewQuadrant),
      ["mine", "delegated"],
      "the embedded sections identify the top-right Mine and bottom-right Delegated quadrants",
    );
    assert.deepEqual(
      sections.map((section) => section.style.gridArea),
      ["mine", "delegated"],
      "the combined popover grid can place Mine above Delegated in the right column",
    );
    assert.ok(
      sections.every((section) => /rgb\(234, 132, 229\)/.test(section.style.borderTop)),
      "both inline-field quadrants use #EA84E5 as their accent",
    );
    assert.match(document.body.textContent ?? "", /Mine inline row fields[\s\S]*Shown on row[\s\S]*Field bank[\s\S]*Delegated inline row fields/);
    assert.doesNotMatch(document.body.textContent ?? "", /Details|Title/);
    assert.equal(document.querySelector('input[type="checkbox"]'), null, "field visibility is not represented by checkmarks");
    assert.doesNotMatch(document.body.textContent ?? "", /✓|✔/);
    assert.equal(trayFieldIDs(document, "mine").length, 0);
    assert.equal(insertion(document, "mine", 0).textContent, "No fields shown");
    assert.equal(field(document, "mine", "bank", "assigned_by").tabIndex, -1, "drag fields are pointer-only, not keyboard reorder controls");
  } finally {
    await unmountHarness(mounted);
  }
});

test("the reusable single-scope section keeps the mandatory drag-only tray and bank behavior", async () => {
  const mounted = await mountHarness({ mode: "section" });
  try {
    const { document } = mounted.dom.window;
    assert.equal(document.querySelectorAll("[data-action-item-inline-field-section]").length, 1);
    assert.equal(document.querySelector("[data-action-item-inline-field-section]")?.getAttribute("data-action-item-inline-field-section"), "huddle");
    assert.deepEqual(trayFieldIDs(document, "huddle"), DEFAULT_MINE);
    assert.equal(document.querySelector('input[type="checkbox"]'), null);
    await drag(field(document, "huddle", "bank", "status"), insertion(document, "huddle", 1));
    assert.deepEqual(trayFieldIDs(document, "huddle"), ["assigned_by", "status", "completion_due_date"]);
  } finally {
    await unmountHarness(mounted);
  }
});

test("the shared Action Item row keeps semantic presentation and renders a static completion date without a live editor", async () => {
  const mounted = await mountHarness({ mode: "row" });
  try {
    const { document } = mounted.dom.window;
    const row = document.querySelector<HTMLElement>('[data-action-item-row="action-1"]');
    assert.ok(row);
    assert.equal(row.dataset.myWorkRow, "action-item", "My Work keeps its existing row contract");
    assert.equal(row.dataset.actionItemColor, "red");
    assert.equal(row.querySelector('[data-action-item-title="true"]')?.classList.contains("my-work-action-item-title--red"), true);
    assert.equal(
      row.querySelector('[data-action-item-field="completion_due_date"]')?.getAttribute("aria-label"),
      "Completion due: 08/30/2026",
    );
    const openTarget = row.querySelector<HTMLButtonElement>('[data-action-item-target="action-1"]');
    assert.ok(openTarget);
    await act(async () => Simulate.click(openTarget));
    assert.equal(document.querySelector("output")?.getAttribute("data-opened-action-item"), "action-1");
  } finally {
    await unmountHarness(mounted);
  }
});

test("dragging a bank field into an exact insertion gap reflows and inserts between shown fields", async () => {
  const mounted = await mountHarness();
  try {
    const { document } = mounted.dom.window;
    assert.deepEqual(trayFieldIDs(document, "mine"), DEFAULT_MINE);
    await drag(field(document, "mine", "bank", "color"), insertion(document, "mine", 1), true);
    assert.deepEqual(trayFieldIDs(document, "mine"), ["assigned_by", "color", "completion_due_date"]);
    assert.equal(document.querySelector('[data-action-item-inline-field-perspective="mine"][data-action-item-inline-field-location="bank"][data-action-item-inline-field-id="color"]'), null);
  } finally {
    await unmountHarness(mounted);
  }
});

test("dragging within the shown tray reorders fields without any click-to-move behavior", async () => {
  const mounted = await mountHarness();
  try {
    const { document } = mounted.dom.window;
    const assignedBy = field(document, "mine", "tray", "assigned_by");
    await act(async () => Simulate.click(assignedBy));
    assert.deepEqual(trayFieldIDs(document, "mine"), DEFAULT_MINE, "clicking a field does not move it");
    await drag(field(document, "mine", "tray", "completion_due_date"), insertion(document, "mine", 0));
    assert.deepEqual(trayFieldIDs(document, "mine"), ["completion_due_date", "assigned_by"]);
  } finally {
    await unmountHarness(mounted);
  }
});

test("dragging a shown field back to its bank hides it and makes it available again", async () => {
  const mounted = await mountHarness();
  try {
    const { document } = mounted.dom.window;
    await drag(field(document, "mine", "tray", "assigned_by"), bank(document, "mine"));
    assert.deepEqual(trayFieldIDs(document, "mine"), ["completion_due_date"]);
    assert.equal(field(document, "mine", "bank", "assigned_by").textContent?.includes("Assigned by"), true);
  } finally {
    await unmountHarness(mounted);
  }
});

test("Mine and Delegated field orders change independently and reject cross-perspective drops", async () => {
  const mounted = await mountHarness();
  try {
    const { document } = mounted.dom.window;
    await drag(field(document, "delegated", "bank", "status"), insertion(document, "delegated", 1));
    assert.deepEqual(trayFieldIDs(document, "delegated"), ["person_in_charge", "status", "completion_due_date"]);
    assert.deepEqual(trayFieldIDs(document, "mine"), DEFAULT_MINE);

    await drag(field(document, "mine", "tray", "assigned_by"), insertion(document, "delegated", 0));
    assert.deepEqual(trayFieldIDs(document, "delegated"), ["person_in_charge", "status", "completion_due_date"]);
    assert.deepEqual(trayFieldIDs(document, "mine"), DEFAULT_MINE);
  } finally {
    await unmountHarness(mounted);
  }
});

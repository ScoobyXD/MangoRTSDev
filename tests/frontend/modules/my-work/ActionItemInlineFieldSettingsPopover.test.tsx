import assert from "node:assert/strict";
import test from "node:test";
import React, { act, useRef, useState } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import type {
  ActionItemInlineFieldDefinition,
  ActionItemInlineFieldSettingsPopoverProps,
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
  { id: "huddle_process", label: "Huddle process" },
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
  ActionItemInlineFieldSettingsPopoverProps<FieldID>,
  "fields"
> & {
  initialMine?: FieldID[];
  initialDelegated?: FieldID[];
};

function Harness({
  fields,
  initialMine = DEFAULT_MINE,
  initialDelegated = DEFAULT_DELEGATED,
}: HarnessProps) {
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const [mineFieldIDs, setMineFieldIDs] = useState<FieldID[]>(initialMine);
  const [delegatedFieldIDs, setDelegatedFieldIDs] = useState<FieldID[]>(initialDelegated);
  return (
    <>
      <button ref={anchorRef} type="button" aria-haspopup="dialog">Fields</button>
      <ActionItemInlineFieldSettingsPopoverForTest
        open
        anchorRef={anchorRef}
        fields={fields}
        mineFieldIDs={mineFieldIDs}
        delegatedFieldIDs={delegatedFieldIDs}
        onMineFieldIDsChange={setMineFieldIDs}
        onDelegatedFieldIDsChange={setDelegatedFieldIDs}
        onRequestClose={() => undefined}
      />
    </>
  );
}

let ActionItemInlineFieldSettingsPopoverForTest:
  typeof import("../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.js").ActionItemInlineFieldSettingsPopover;

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
  const [{ createRoot }, componentModule] = await Promise.all([
    import("react-dom/client"),
    import("../../../../frontend/src/modules/my-work/ActionItemInlineFieldSettingsPopover.tsx"),
  ]);
  ActionItemInlineFieldSettingsPopoverForTest = componentModule.ActionItemInlineFieldSettingsPopover;
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
  perspective: "mine" | "delegated",
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

function insertion(document: Document, perspective: "mine" | "delegated", index: number): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `[data-action-item-inline-field-insertion-perspective="${perspective}"]`
      + `[data-action-item-inline-field-insertion-index="${index}"]`,
  );
  assert.ok(element, `${perspective} should expose insertion index ${index}`);
  return element;
}

function bank(document: Document, perspective: "mine" | "delegated"): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-action-item-inline-field-bank="${perspective}"]`);
  assert.ok(element, `${perspective} should expose a field bank`);
  return element;
}

function trayFieldIDs(document: Document, perspective: "mine" | "delegated"): string[] {
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

test("Action Item row-field settings render Mine above Delegated, allow an empty tray, and exclude Details and Title", async () => {
  const mounted = await mountHarness({ initialMine: [] });
  try {
    const { document } = mounted.dom.window;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"][data-action-item-inline-field-settings="true"]');
    assert.ok(dialog);
    assert.deepEqual(
      Array.from(dialog.querySelectorAll<HTMLElement>("[data-action-item-inline-field-section]"))
        .map((section) => section.dataset.actionItemInlineFieldSection),
      ["mine", "delegated"],
    );
    assert.match(dialog.textContent ?? "", /Mine[\s\S]*Shown on row[\s\S]*Field bank[\s\S]*Delegated/);
    assert.doesNotMatch(dialog.textContent ?? "", /Details|Title/);
    assert.equal(dialog.querySelector('input[type="checkbox"]'), null, "field visibility is not represented by checkmarks");
    assert.doesNotMatch(dialog.textContent ?? "", /✓|✔/);
    assert.equal(trayFieldIDs(document, "mine").length, 0);
    assert.equal(insertion(document, "mine", 0).textContent, "No fields shown");
    assert.equal(field(document, "mine", "bank", "assigned_by").tabIndex, -1, "drag fields are pointer-only, not keyboard reorder controls");
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

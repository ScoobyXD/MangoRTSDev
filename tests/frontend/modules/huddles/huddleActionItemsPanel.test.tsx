import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { Entity } from "../../../../frontend/src/modules/entities/entitiesApi.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function actionItem(entityID: string, name: string, color = "red", status = "in_progress"): Entity {
  return {
    company_id: "company-1",
    entity_id: entityID,
    entity_type_id: "action-item-type",
    entity_type_name: "Action Item",
    name,
    position: 0,
    revision: 1,
    created_timestamp: "2026-08-28T12:00:00Z",
    entity_fields: [
      {
        company_id: "company-1", entity_field_id: `${entityID}-person`, entity_id: entityID,
        system_key: "person_in_charge", name: "Person in charge", field_type: "person", config: {},
        value: "user-1", position: 0, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
      {
        company_id: "company-1", entity_field_id: `${entityID}-due`, entity_id: entityID,
        system_key: "completion_due_date", name: "Completion due date", field_type: "date", config: {},
        value: "2026-09-03", position: 1, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
      {
        company_id: "company-1", entity_field_id: `${entityID}-color`, entity_id: entityID,
        system_key: "color", name: "Color", field_type: "color", config: {},
        value: color, position: 2, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
      {
        company_id: "company-1", entity_field_id: `${entityID}-status`, entity_id: entityID,
        system_key: "status", name: "Status", field_type: "choice", config: {},
        value: status, position: 3, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
    ],
    source: { resource_type: "huddle_node", resource_id: "node-1", name: "Weekly Huddle" },
  } as Entity;
}

test("Huddle Board hides completed rows until checked and keeps green completion separate from light color", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: "http://localhost/", pretendToBeVisual: true,
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLInputElement", "Event", "EventTarget", "MouseEvent", "CustomEvent", "MutationObserver",
  ] as const) {
    installGlobal(name, name === "window" || name === "self" ? dom.window : name === "document"
      ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name], restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("localStorage", dom.window.localStorage, restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { HuddleActionItemsPanel }] = await Promise.all([
      import("react-dom/client"), import("../../../../frontend/src/modules/huddles/HuddleActionItemsPanel.tsx"),
    ]);
    const items = [
      actionItem("open-red", "Open red"),
      actionItem("done-red", "Done red", "red", "done"),
      actionItem("done-yellow", "Done yellow", "yellow", "completed"),
    ];
    const reads: string[] = [];
    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      assert.ok(!init?.method, "temporary completion filtering must not write a saved view");
      reads.push(path);
      return Promise.resolve((path.startsWith("/v1/saved-views?") ? { saved_views: [{
        saved_view_id: "view-1", surface: "huddle_logic_gate_action_items", groupings: [{ field: "color", direction: "desc" }], settings: {},
      }] } : { action_items: items }) as T);
    };
    const container = dom.window.document.getElementById("root")!;
    const root = createRoot(container);
    mountedRoot = root;
    const panel = (resourceID: string, view: "huddle_logic_gate" | "huddle_node_created" = "huddle_logic_gate") => (
      <HuddleActionItemsPanel companyID="company-1" currentUserID="user-1"
        scope={{ resourceType: view === "huddle_logic_gate" ? "huddle_logic_gate" : "huddle_node", resourceID }}
        view={view} companyUsers={[]} requestJSON={requestJSON} refreshToken={0} />
    );
    await act(async () => root.render(panel("board-1")));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    assert.ok(checkbox);
    assert.equal(checkbox.checked, false);
    assert.equal(checkbox.closest("label")?.textContent?.trim(), "Show completed");
    assert.deepEqual([...container.querySelectorAll<HTMLElement>("[data-action-item-row]")].map((row) => row.dataset.actionItemRow), ["open-red"]);
    const groupingControl = container.querySelector('button[aria-label="Group, order, and choose Action Item row fields"]');
    assert.ok(groupingControl);
    assert.equal(checkbox.closest("label")?.nextElementSibling?.contains(groupingControl), true, "completion toggle sits beside the existing grouping control");
    const initialReads = reads.length;
    await act(async () => checkbox.click());
    assert.equal(reads.length, initialReads, "completion filtering uses the loaded Board rollup");
    assert.deepEqual([...container.querySelectorAll<HTMLElement>("[data-huddle-action-item-group-key]")].map((group) => group.dataset.huddleActionItemGroupKey), ["yellow", "red"]);
    for (const color of ["red", "yellow"]) {
      const row = container.querySelector<HTMLElement>(`[data-action-item-row="done-${color}"]`);
      assert.ok(row);
      assert.equal(row.dataset.actionItemCompleted, "true");
      assert.equal(row.dataset.actionItemColor, color);
      assert.match(row.style.background, /187,\s*247,\s*208/);
      assert.ok(row.querySelector(`.mango-editor-action-item--${color} .mango-editor-action-item-icon`));
    }
    assert.equal(container.querySelector<HTMLElement>('[data-action-item-row="open-red"]')?.dataset.actionItemCompleted, "false");
    await act(async () => checkbox.click());
    assert.equal(container.querySelector('[data-action-item-row="done-red"]'), null);
    await act(async () => checkbox.click());
    await act(async () => root.render(panel("board-2")));
    assert.equal(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked, false, "opening another Board defaults to incomplete items");
    await act(async () => root.render(panel("node-1", "huddle_node_created")));
    assert.equal(container.querySelector('input[type="checkbox"]'), null);
    assert.equal(container.querySelectorAll("[data-action-item-row]").length, 3, "created-in-Node history still includes completed items");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("Huddle Action Item panel honors a refresh during initial load and ignores the stale response", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLInputElement", "Event", "EventTarget", "MouseEvent", "CustomEvent", "MutationObserver",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("localStorage", dom.window.localStorage, restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { HuddleActionItemsPanel }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/huddles/HuddleActionItemsPanel.tsx"),
    ]);
    const pending: Array<(value: { action_items: Entity[] }) => void> = [];
    const savedViewReads: string[] = [];
    const savedViewWrites: Array<{ path: string; json: unknown }> = [];
    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (path.startsWith("/v1/saved-views?") && !init?.method) {
        savedViewReads.push(path);
        return Promise.resolve({ saved_views: [] } as T);
      }
      if (path.startsWith("/v1/saved-views/") && init?.method === "PUT") {
        savedViewWrites.push({ path, json: init.json });
        return Promise.resolve(init.json as T);
      }
      return new Promise((resolve) => {
        pending.push((value) => resolve(value as T));
      });
    };
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const panel = (refreshToken: number) => (
      <HuddleActionItemsPanel
        companyID="company-1"
        currentUserID="user-1"
        scope={{ resourceType: "huddle_node", resourceID: "node-1" }}
        view="huddle_node_created"
        companyUsers={[]}
        requestJSON={requestJSON}
        refreshToken={refreshToken}
      />
    );

    await act(async () => root.render(panel(0)));
    await act(async () => { await Promise.resolve(); });
    assert.equal(pending.length, 1);
    assert.match(savedViewReads[0] ?? "", /surface=huddle_node_created_action_items/);

    await act(async () => root.render(panel(1)));
    assert.equal(pending.length, 2, "a saved-reference refresh must not be dropped during initial load");

    await act(async () => {
      pending[1]?.({ action_items: [actionItem("entity-new", "Newest result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Newest result/);

    await act(async () => {
      pending[0]?.({ action_items: [actionItem("entity-old", "Stale result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Newest result/);
    assert.doesNotMatch(container.textContent ?? "", /Stale result/);

    const slots = [...container.querySelectorAll<HTMLElement>("[data-action-item-inline-field-slot]")];
    assert.deepEqual(slots.map((slot) => slot.dataset.actionItemInlineFieldSlot), ["person_in_charge", "completion_due_date"]);
    const rail = container.querySelector<HTMLElement>('[data-action-item-inline-fields="true"]');
    assert.equal(rail?.style.marginLeft, "auto");
    assert.equal(rail?.style.flexWrap, "nowrap");
    assert.equal(rail?.style.overflowX, "auto");
    assert.match(container.textContent ?? "", /Red/);
    assert.match(container.textContent ?? "", /user-1/);

    let openedEntityID = "";
    dom.window.addEventListener("mangorts:editor-entity-reference-open", (event) => {
      openedEntityID = (event as CustomEvent<{ entity?: { entityID?: string } }>).detail.entity?.entityID ?? "";
    }, { once: true });
    const rowButton = container.querySelector<HTMLButtonElement>('[data-action-item-target="entity-new"]');
    assert.ok(rowButton);
    await act(async () => rowButton.click());
    assert.equal(openedEntityID, "entity-new");

    const viewButton = container.querySelector<HTMLButtonElement>('button[aria-label="Group, order, and choose Action Item row fields"]');
    assert.ok(viewButton);
    await act(async () => viewButton.click());
    const directionButton = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for grouping level 1"]');
    assert.ok(directionButton);
    await act(async () => {
      directionButton.click();
      await Promise.resolve();
    });
    assert.equal(savedViewWrites.length, 1);
    const savedPayload = savedViewWrites[0]?.json as { surface?: string; groupings?: Array<{ field?: string; direction?: string }> };
    assert.equal(savedPayload.surface, "huddle_node_created_action_items");
    assert.deepEqual(savedPayload.groupings?.[0], { field: "color", direction: "desc" });

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent("mangorts:editor-entity-reference-presentation", {
        detail: { isActionItem: true, entityID: "entity-new" },
      }));
      await Promise.resolve();
    });
    assert.equal(pending.length, 3, "a local Action Item presentation change refreshes filtered membership");
    await act(async () => {
      pending[2]?.({ action_items: [actionItem("entity-local", "Local edit result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Local edit result/);

    await act(async () => {
      dom.window.dispatchEvent(new dom.window.Event("focus"));
      await Promise.resolve();
    });
    assert.equal(pending.length, 4, "focus recovery reconciles Action Item lists without a manual refresh");
    await act(async () => {
      pending[3]?.({ action_items: [actionItem("entity-focus", "Focus recovery result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Focus recovery result/);

    await act(async () => {
      dom.window.document.body.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(pending.length, 4, "ordinary typing does not reload Action Item lists");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("Huddle date controls restore failed edits and distinguish selected, reference, and today dates", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLInputElement", "Event", "EventTarget", "MouseEvent", "CustomEvent", "MutationObserver",
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

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { EditorCalendarDateInput }, { HuddleNodeDateControl }, { HUDDLE_CALENDAR_THEME }, { HuddleActionItemsPanel }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/EditorFieldControls.tsx"),
      import("../../../../frontend/src/modules/huddles/HuddleNodeDateControl.tsx"),
      import("../../../../frontend/src/modules/huddles/huddleCalendarTheme.ts"),
      import("../../../../frontend/src/modules/huddles/HuddleActionItemsPanel.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;

    let rejectCommit: ((cause: Error) => void) | undefined;
    await act(async () => root.render(
      <HuddleNodeDateControl
        date="2026-08-31"
        saving={false}
        onCommit={() => new Promise<void>((_resolve, reject) => { rejectCommit = reject; })}
      />,
    ));
    const persistedDateInput = container.querySelector<HTMLInputElement>('input[aria-label="Huddle Node date"]');
    assert.equal(persistedDateInput?.value, "8/31/2026");
    const persistedDateTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Choose huddle node date"]');
    assert.ok(persistedDateTrigger);
    await act(async () => persistedDateTrigger.click());
    const changedDateButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .find((button) => button.getAttribute("aria-label")?.startsWith("September 2, 2026"));
    assert.ok(changedDateButton);
    await act(async () => {
      changedDateButton.click();
      await Promise.resolve();
    });
    assert.equal(persistedDateInput?.value, "9/2/2026", "the pending date is visible optimistically");
    await act(async () => {
      rejectCommit?.(new Error("date save failed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(persistedDateInput?.value, "8/31/2026", "a failed save restores the displayed draft");

    const localDate = (date: Date) => `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    const isoDate = (date: Date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const labelDate = (date: Date) => date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
    const today = new Date();
    const reference = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1, 12);
    const selected = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 12);

    function CalendarHarness() {
      const [value, setValue] = React.useState(localDate(selected));
      return (
        <EditorCalendarDateInput
          value={value}
          ariaLabel="Due or Overdue viewing date"
          iconOnly
          allowClear={false}
          referenceDate={isoDate(reference)}
          referenceLabel="Huddle Node date"
          theme={HUDDLE_CALENDAR_THEME}
          floatingPortalTarget={dom.window.document.body}
          onChange={setValue}
        />
      );
    }
    await act(async () => root.render(<CalendarHarness />));
    const viewingDateTrigger = container.querySelector<HTMLButtonElement>('button[aria-label="Choose due or overdue viewing date"]');
    assert.ok(viewingDateTrigger);
    assert.equal(container.querySelector("input"), null, "compact mode renders only the calendar icon");
    await act(async () => viewingDateTrigger.click());

    const selectedDay = dom.window.document.querySelector<HTMLButtonElement>(`button[aria-label^="${labelDate(selected)}"]`);
    assert.equal(selectedDay?.getAttribute("aria-pressed"), "true", "the temporary viewing date is the selected day");
    const referenceDay = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .find((button) => button.getAttribute("aria-label")?.startsWith(labelDate(reference)));
    assert.match(referenceDay?.getAttribute("aria-label") ?? "", /Huddle Node date/);
    assert.match(referenceDay?.style.boxShadow ?? "", /7c3aed|124, 58, 237/i, "the persisted Node date has a separate reference ring");
    const todayDay = dom.window.document.querySelector<HTMLButtonElement>('button[aria-current="date"]');
    assert.match(todayDay?.getAttribute("aria-label") ?? "", /Today/);
    assert.equal(todayDay?.getAttribute("aria-pressed"), "false", "today remains distinct from the selected date");
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /Clear|Reset|Use Huddle Node date/);

    const todayAction = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Today");
    assert.ok(todayAction);
    await act(async () => todayAction.click());
    assert.equal(viewingDateTrigger.getAttribute("aria-expanded"), "false");
    await act(async () => viewingDateTrigger.click());
    const newlySelectedToday = dom.window.document.querySelector<HTMLButtonElement>('button[aria-current="date"]');
    assert.equal(newlySelectedToday?.getAttribute("aria-pressed"), "true");
    assert.equal(newlySelectedToday?.getAttribute("aria-label")?.startsWith(labelDate(today)), true);

    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (path.startsWith("/v1/saved-views?")) return Promise.resolve({ saved_views: [] } as T);
      if (path.startsWith("/v1/saved-views/") && init?.method === "PUT") return Promise.resolve(init.json as T);
      return Promise.resolve({ action_items: [] } as T);
    };
    function DuePanelHarness() {
      const [value, setValue] = React.useState("2026-09-03");
      return (
        <HuddleActionItemsPanel
          companyID="company-1"
          currentUserID="user-1"
          scope={{ resourceType: "huddle_node", resourceID: "node-1" }}
          view="huddle_node_due"
          title="Due or Overdue"
          companyUsers={[]}
          requestJSON={requestJSON}
          refreshToken={0}
          viewingDate={value}
          referenceDate="2026-09-01"
          onViewingDateChange={setValue}
        />
      );
    }
    await act(async () => {
      root.render(<DuePanelHarness />);
      await Promise.resolve();
      await Promise.resolve();
    });
    const viewingDateControl = container.querySelector<HTMLElement>('[data-huddle-viewing-date-control="true"]');
    const dueCalendarButton = viewingDateControl?.querySelector<HTMLButtonElement>('button[aria-label="Choose due or overdue viewing date"]');
    const viewingDateLabel = viewingDateControl?.querySelector<HTMLElement>('[data-huddle-viewing-date-label="true"]');
    const groupingButton = container.querySelector<HTMLButtonElement>('button[aria-label="Group, order, and choose Action Item row fields"]');
    assert.ok(viewingDateControl);
    assert.ok(dueCalendarButton);
    assert.ok(viewingDateLabel);
    assert.ok(groupingButton);
    assert.equal(viewingDateControl.querySelector("input"), null, "the header keeps a compact icon-only calendar");
    assert.equal(viewingDateLabel.textContent, "9/3/2026", "the active viewing date is written beside the calendar");
    assert.equal(viewingDateLabel.getAttribute("role"), "status");
    assert.equal(viewingDateLabel.getAttribute("aria-label"), "Active viewing date 9/3/2026");
    assert.ok(Boolean(dueCalendarButton.compareDocumentPosition(viewingDateLabel) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), "the calendar precedes the visible date");
    assert.ok(Boolean(viewingDateLabel.compareDocumentPosition(groupingButton) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), "the date precedes the grouping control");

    await act(async () => dueCalendarButton.click());
    const newViewingDateButton = [...dom.window.document.querySelectorAll<HTMLButtonElement>('button[aria-label]')]
      .find((button) => button.getAttribute("aria-label")?.startsWith("September 5, 2026"));
    assert.ok(newViewingDateButton);
    await act(async () => {
      newViewingDateButton.click();
      await Promise.resolve();
    });
    assert.equal(container.querySelector('[data-huddle-viewing-date-label="true"]')?.textContent, "9/5/2026", "calendar selection updates the visible viewing date");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

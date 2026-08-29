import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { MyWorkResponse } from "../../../../frontend/src/modules/my-work/myWorkApi.js";
import { getQDBusinessDate } from "../../../../frontend/src/modules/logic-gates/qdRatingsApi.js";

type Restore = () => void;

const businessDateKey = getQDBusinessDate().dateKey;

function dateKeyAfter(days: number): string {
  const [year, month, day] = businessDateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

const emptyProcessStatusCounts = { request: 0, pending: 0, in_progress: 0, review: 0 };

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function installMyWorkDOMGlobals(dom: JSDOM, restores: Restore[]) {
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLSelectElement", "SVGElement", "Event", "EventTarget", "MouseEvent", "KeyboardEvent", "FocusEvent", "CustomEvent",
    "MutationObserver", "PopStateEvent",
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
}

function response(overrides: Partial<MyWorkResponse> = {}): MyWorkResponse {
  return {
    company_id: "company-1",
    user_id: "viewer-1",
    action_items: {
      perspective: "mine",
      items: [
        { entity_id: "action-red", name: "Red Action", color: "red", completion_due_date: dateKeyAfter(0), completion_due_date_field_id: "field-red" },
        { entity_id: "action-yellow", name: "Yellow Action", color: "yellow", completion_due_date: dateKeyAfter(1), completion_due_date_field_id: "field-yellow" },
      ],
      next_cursor: "actions-old-cursor",
      has_more: true,
    },
    nodes: {
      role: "responsible",
      items: [
        {
          node_id: "node-context",
          name: "Context Node",
          priority: 1,
          due_date: dateKeyAfter(3),
          process: { logic_gate_id: "process-inline", name: "Visible Process" },
          project: { project_id: "project-inline", name: "Visible Project" },
        },
        { node_id: "node-private-context", name: "Context Hidden Node", priority: null, due_date: null },
      ],
      next_cursor: "nodes-page-2",
      has_more: true,
    },
    processes: {
      role: "responsible",
      items: [{
        logic_gate_id: "process-responsible",
        name: "Responsible Process",
        status_counts: { request: 12, pending: 0, in_progress: 7, review: 2 },
      }],
      next_cursor: "processes-page-2",
      has_more: true,
    },
    projects: {
      items: [{ project_id: "project-team", name: "Team Project" }],
      next_cursor: "projects-page-2",
      has_more: true,
    },
    ...overrides,
  };
}

function setScrollPosition(element: HTMLElement, { scrollHeight, clientHeight, scrollTop }: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
    scrollTop: { configurable: true, writable: true, value: scrollTop },
  });
}

function setElementSize(element: HTMLElement, { clientWidth, scrollWidth, clientHeight }: { clientWidth?: number; scrollWidth?: number; clientHeight?: number }) {
  if (clientWidth !== undefined) Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
  if (scrollWidth !== undefined) Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  if (clientHeight !== undefined) Object.defineProperty(element, "clientHeight", { configurable: true, value: clientHeight });
}

test("My Work due-date labels cover the first four Los Angeles date offsets only", async () => {
  const { myWorkRelativeDueDateLabel } = await import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(0), businessDateKey), "Due Today");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(1), businessDateKey), "Due Tomorrow");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(2), businessDateKey), "Due in two days");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(3), businessDateKey), "Due in three days");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(4), businessDateKey), "");
  assert.equal(myWorkRelativeDueDateLabel(dateKeyAfter(-1), businessDateKey), "");
});

test("My Work keeps sections isolated, removes stale role rows, and opens exact independent targets", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installMyWorkDOMGlobals(dom, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { MyWorkContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx"),
    ]);
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const pendingRoles = new Map<string, (value: MyWorkResponse) => void>();
    let resolveActionGrouping: ((value: MyWorkResponse) => void) | undefined;
    let resolveNodeLoadMore: ((value: MyWorkResponse) => void) | undefined;
    let projectAppendAttempts = 0;
    const requestJSON = <T,>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      const url = new URL(path, "http://api.test");
      const section = url.searchParams.get("section");
      if (!section) return Promise.resolve(response() as T);
      if (section === "action_items" && url.searchParams.get("cursor")) {
        return Promise.resolve(response({
          nodes: undefined,
          processes: undefined,
          projects: undefined,
          action_items: {
            items: [
              { entity_id: "action-red", name: "Duplicate Red", color: "red", completion_due_date_field_id: "field-red" },
              { entity_id: "action-page-2", name: "Second Action", color: "yellow", completion_due_date: "2026-09-04", completion_due_date_field_id: "field-page-2" },
            ],
            has_more: false,
          },
        }) as T);
      }
      if (section === "action_items" && url.searchParams.get("perspective") === "delegated") {
        return Promise.resolve(response({
          nodes: undefined,
          processes: undefined,
          projects: undefined,
          action_items: {
            perspective: "delegated",
            items: [{ entity_id: "action-delegated", name: "Delegated Action", color: "red", completion_due_date_field_id: "field-delegated" }],
            has_more: false,
          },
        }) as T);
      }
      if (section === "action_items" && url.searchParams.has("grouping")) {
        return new Promise<T>((resolve) => {
          resolveActionGrouping = (value) => resolve(value as T);
        });
      }
      if (section === "nodes" && url.searchParams.get("cursor")) {
        return new Promise<T>((resolve) => {
          resolveNodeLoadMore = (value) => resolve(value as T);
        });
      }
      if (section === "nodes" && url.searchParams.get("role") === "accountable") {
        return Promise.resolve(response({
          action_items: undefined,
          processes: undefined,
          projects: undefined,
          nodes: { role: "accountable", items: [{ node_id: "node-accountable", name: "Accountable Node" }], has_more: false },
        }) as T);
      }
      if (section === "processes" && url.searchParams.get("cursor")) {
        return Promise.resolve(response({
          action_items: undefined,
          nodes: undefined,
          projects: undefined,
          processes: { role: "responsible", items: [{ logic_gate_id: "process-page-2", name: "Second Process", status_counts: emptyProcessStatusCounts }], has_more: false },
        }) as T);
      }
      if (section === "projects" && url.searchParams.get("cursor")) {
        projectAppendAttempts += 1;
        if (projectAppendAttempts === 1) return Promise.reject(new Error("Project append failed"));
        return Promise.resolve(response({
          action_items: undefined,
          nodes: undefined,
          processes: undefined,
          projects: { items: [{ project_id: "project-page-2", name: "Second Project" }], has_more: false },
        }) as T);
      }
      if (section === "processes") {
        const role = url.searchParams.get("role") ?? "responsible";
        return new Promise<T>((resolve) => {
          pendingRoles.set(role, (value) => resolve(value as T));
        });
      }
      return Promise.resolve(response({
        ...(section === "action_items" ? { nodes: undefined, processes: undefined, projects: undefined } : {}),
        ...(section === "nodes" ? { action_items: undefined, processes: undefined, projects: undefined } : {}),
        ...(section === "projects" ? { action_items: undefined, nodes: undefined, processes: undefined } : {}),
      }) as T);
    };

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    let myWorkUpdateCommits = 0;
    await act(async () => {
      root.render(
        <React.Profiler
          id="my-work"
          onRender={(_id, phase) => {
            if (phase === "update") myWorkUpdateCommits += 1;
          }}
        >
          <MyWorkContent companyID="company-1" subjectID="viewer-1" requestJSON={requestJSON} />
        </React.Profiler>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0]?.path ?? "", "http://api.test").searchParams.has("section"), false);
    assert.equal(container.querySelector("h1")?.textContent, "My Work");
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLElement>("[data-my-work-section]")).map((section) => section.dataset.myWorkSection),
      ["action_items", "nodes", "processes", "projects"],
    );
    const groupButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Group "]'));
    assert.deepEqual(groupButtons.map((button) => button.getAttribute("aria-label")), ["Group Action Items", "Group Nodes"]);
    assert.deepEqual(groupButtons.map((button) => button.textContent), ["", ""], "both section groupers are icon-only");
    const historyButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed][data-my-work-history-selected]'));
    assert.deepEqual(historyButtons.map((button) => button.getAttribute("aria-label")), ["Open History", "Open History"]);
    assert.deepEqual(historyButtons.map((button) => button.textContent?.trim()), ["History", "History"], "the existing visible History labels remain beside their icons");
    assert.deepEqual(historyButtons.map((button) => button.getAttribute("aria-pressed")), ["false", "false"]);
    assert.match(container.querySelector<HTMLElement>('[data-my-work-columns="true"]')?.style.gridTemplateColumns ?? "", /minmax\(360px,/, "the left column has enough capacity for the established controls and new selectors");
    assert.equal(container.querySelectorAll("[data-my-work-section-icon]").length, 4, "every major section has its exact resource icon");
    const actionItemsSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    const actionHeaderIconPaths = actionItemsSection?.querySelectorAll<SVGPathElement>('[data-my-work-section-icon="action_items"] svg path');
    assert.equal(actionHeaderIconPaths?.[0]?.getAttribute("stroke"), "#facc15", "only the Action Items header target uses the established yellow outer ring");
    assert.equal(actionHeaderIconPaths?.[1]?.getAttribute("stroke"), "#ef4444", "the Action Items header target uses the established red inner ring");
    assert.equal(container.querySelectorAll('[data-my-work-group-field="completion_due_date"], [data-my-work-group-field="due_date"]').length, 0, "date ordering never renders a date group header");
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Red Action"]')?.value, "Due Today");
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Yellow Action"]')?.value, "Due Tomorrow");
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Node"]')?.value, "Due in three days");
    assert.equal(container.querySelectorAll('[data-my-work-due-date="true"] button[aria-haspopup="dialog"]').length, 4, "every relative or regular due-date form keeps its calendar control");
    const todayInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Red Action"]');
    const tomorrowInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Yellow Action"]');
    const soonInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Node"]');
    const standardInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Hidden Node"]');
    assert.equal(todayInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "urgent");
    assert.equal(tomorrowInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "urgent");
    assert.equal(soonInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "soon");
    assert.equal(standardInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "standard");
    assert.equal(todayInput?.style.color, "rgb(185, 28, 28)", "Due Today text is red");
    assert.equal(tomorrowInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#ef4444", "Due Tomorrow calendar is red");
    assert.equal(soonInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#eab308", "two- and three-day calendars are yellow");
    assert.equal(standardInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#8b5cf6", "ordinary and empty dates keep the purple calendar");
    assert.equal(todayInput?.style.gridColumn, "2", "due-date text follows the calendar control");
    assert.equal(todayInput?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.style.gridColumn, "1", "the calendar button is the left column");
    assert.match(standardInput?.value ?? "", /^Due Date: /, "ordinary dates keep the label after the left-side calendar");
    assert.equal(todayInput?.parentElement?.style.width, "116px", "relative labels use the compact width");
    assert.equal(standardInput?.parentElement?.style.width, "126px", "ordinary dates fit their complete icon-first label without extra outer spacing");
    const relativeCalendarButton = container.querySelector<HTMLButtonElement>('[data-my-work-row="action-item"][data-my-work-action-item-color="red"] [data-my-work-due-date="true"] button[aria-haspopup="dialog"]');
    assert.ok(relativeCalendarButton);
    await act(async () => {
      relativeCalendarButton.click();
      await Promise.resolve();
    });
    assert.ok(dom.window.document.querySelector('[data-editor-calendar-popover="Due Date for Red Action"]'), "a relative label keeps its calendar clickable");
    await act(async () => {
      relativeCalendarButton.click();
      await Promise.resolve();
    });
    const myWorkPage = container.querySelector<HTMLElement>('[data-my-work-page="true"]');
    assert.equal(myWorkPage?.style.zoom, "0.9", "one page-level scale matches the 90% reference");
    assert.equal(myWorkPage?.style.width, `${100 / 0.9}%`, "the scaled page still fills the complete workspace width");

    const processCounts = container.querySelector<HTMLElement>('[data-my-work-target="process"] [data-my-work-process-status-counts="true"]');
    assert.ok(processCounts);
    assert.equal(processCounts.style.gridTemplateColumns, "repeat(4, 22px)", "every Process row reserves the same four aligned columns");
    assert.equal(processCounts.querySelectorAll("[data-my-work-process-status-slot]").length, 4);
    assert.deepEqual(
      Array.from(processCounts.querySelectorAll<HTMLElement>("[data-my-work-process-status-count]")).map((count) => [count.dataset.myWorkProcessStatus, count.dataset.myWorkProcessStatusCount]),
      [["request", "12"], ["pending", "0"], ["inProgress", "7"], ["review", "2"]],
      "all four Process status squares render even when a count is zero",
    );
    assert.doesNotMatch(container.textContent ?? "", /\bPrevious\b|\bNext\b|Page \d/, "cursor pages are never exposed as page controls");

    const redActionRow = container.querySelector<HTMLElement>('[data-my-work-target="action-item"][data-my-work-action-item-color="red"]');
    const yellowActionRow = container.querySelector<HTMLElement>('[data-my-work-target="action-item"][data-my-work-action-item-color="yellow"]');
    assert.equal(redActionRow?.querySelectorAll(".mango-editor-action-item--red").length, 1, "the red icon keeps the one-second raised Huddle pulse");
    assert.equal(yellowActionRow?.querySelectorAll(".mango-editor-action-item--yellow").length, 1, "the yellow icon keeps the two-second raised Huddle pulse");
    const redActionTitle = redActionRow?.querySelector<HTMLElement>('[data-my-work-action-item-title="true"]');
    const yellowActionTitle = yellowActionRow?.querySelector<HTMLElement>('[data-my-work-action-item-title="true"]');
    assert.equal(redActionTitle?.classList.contains("my-work-action-item-title--red"), true);
    assert.equal(yellowActionTitle?.classList.contains("my-work-action-item-title--yellow"), true);
    assert.equal(redActionTitle?.style.background, "", "Action Item titles stay plain text instead of raised chips");
    assert.equal(redActionTitle?.style.fontSize, "13px", "resource row text uses the larger My Work type scale");
    assert.equal(container.querySelectorAll(".my-work-resource-row").length, 6, "every resource row uses the shared lift interaction");

    const perspectiveGroup = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Action Item perspective"]');
    const perspectiveRadios = Array.from(perspectiveGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(perspectiveRadios.map((button) => button.textContent), ["Mine", "Delegated"]);
    assert.deepEqual(perspectiveRadios.map((button) => button.getAttribute("aria-checked")), ["true", "false"]);
    assert.equal(perspectiveGroup?.previousElementSibling?.tagName, "H2", "Mine / Delegated sits immediately to the right of the Action Items title");
    assert.deepEqual(perspectiveRadios.map((button) => button.style.height), ["27px", "27px"], "the perspective segments use the larger target");
    assert.match(perspectiveRadios[0]?.style.background ?? "", /239, 246, 255/, "the selected perspective uses the light-blue gradient");
    assert.equal(perspectiveRadios[0]?.style.color, "rgb(29, 78, 216)", "the selected perspective avoids the former dark fill");
    const nodeRoleGroup = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Node RACI role"]');
    const nodeRadios = Array.from(nodeRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(nodeRadios.map((button) => button.getAttribute("aria-label")), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(nodeRadios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"]);
    assert.equal(nodeRoleGroup?.nextElementSibling?.getAttribute("data-my-work-history-selected"), "false", "Node RACI is immediately left of History");
    const processRoleGroup = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Process RACI role"]');
    const radios = Array.from(processRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(radios.map((button) => button.getAttribute("aria-label")), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(radios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"]);
    assert.deepEqual(radios.map((button) => button.tabIndex), [0, -1, -1, -1]);
    assert.deepEqual(radios.map((button) => [button.style.width, button.style.height]), Array.from({ length: 4 }, () => ["27px", "26px"]), "the shared selector preserves the established Process dimensions");
    assert.deepEqual(nodeRadios.map((button) => [button.style.width, button.style.height]), Array.from({ length: 4 }, () => ["27px", "26px"]), "Nodes reuse that exact established selector");
    assert.match(radios[0]?.getAttribute("style") ?? "", /240, 138, 36/, "Responsible uses the canonical orange RACI color");
    assert.match(radios[1]?.getAttribute("style") ?? "", /25, 200, 121/, "Accountable uses the canonical green RACI color");
    assert.match(radios[2]?.getAttribute("style") ?? "", /25, 168, 255/, "Consulted uses the canonical blue RACI color");
    assert.match(radios[3]?.getAttribute("style") ?? "", /139, 92, 246/, "Informed uses the canonical purple RACI color");

    const separators = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="separator"]'));
    assert.deepEqual(separators.map((separator) => separator.getAttribute("aria-label")), [
      "Resize Action Items and Nodes",
      "Resize Action Items and Nodes column and Processes column",
      "Resize Processes and Projects columns",
    ]);
    assert.deepEqual(separators.map((separator) => separator.getAttribute("aria-orientation")), ["horizontal", "vertical", "vertical"]);
    assert.equal(separators.every((separator) => separator.tabIndex === 0 && Boolean(separator.getAttribute("aria-controls"))), true);

    const columns = container.querySelector<HTMLElement>('[data-my-work-columns="true"]');
    const leftColumn = container.querySelector<HTMLElement>('[data-my-work-left-column="true"]');
    assert.ok(columns && leftColumn);
    setElementSize(columns, { clientWidth: 1200, scrollWidth: 1200 });
    setElementSize(leftColumn, { clientHeight: 800 });
    const columnsBefore = columns.style.gridTemplateColumns;
    const rowsBefore = leftColumn.style.gridTemplateRows;
    await act(async () => {
      separators[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
      separators[1]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.notEqual(leftColumn.style.gridTemplateRows, rowsBefore);
    assert.notEqual(columns.style.gridTemplateColumns, columnsBefore);
    assert.ok(dom.window.localStorage.getItem("mangorts.my-work.layout.v1:company-1"));

    const projectDivider = separators[2];
    assert.ok(projectDivider);
    const capturedPointers: number[] = [];
    const releasedPointers: number[] = [];
    let activePointer: number | null = null;
    Object.defineProperties(projectDivider, {
      setPointerCapture: { configurable: true, value: (pointerID: number) => { activePointer = pointerID; capturedPointers.push(pointerID); } },
      hasPointerCapture: { configurable: true, value: (pointerID: number) => activePointer === pointerID },
      releasePointerCapture: { configurable: true, value: (pointerID: number) => { activePointer = null; releasedPointers.push(pointerID); } },
    });
    const pointerEvent = (type: string, clientX: number, pointerID: number) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, button: 0, clientX });
      Object.defineProperty(event, "pointerId", { configurable: true, value: pointerID });
      return event;
    };
    const columnsAfterKeyboard = columns.style.gridTemplateColumns;
    const storageAfterKeyboard = dom.window.localStorage.getItem("mangorts.my-work.layout.v1:company-1");
    const commitsBeforePointerDrag = myWorkUpdateCommits;
    await act(async () => {
      projectDivider.dispatchEvent(pointerEvent("pointerdown", 800, 7));
      projectDivider.dispatchEvent(pointerEvent("pointermove", 780, 7));
      projectDivider.dispatchEvent(pointerEvent("pointermove", 760, 7));
      projectDivider.dispatchEvent(pointerEvent("pointermove", 740, 7));
    });
    const pointerPreviewColumns = columns.style.gridTemplateColumns;
    const pointerPreviewValue = projectDivider.getAttribute("aria-valuenow");
    assert.notEqual(pointerPreviewColumns, columnsAfterKeyboard, "pointer dragging updates the visible columns immediately");
    assert.notEqual(pointerPreviewValue, null, "the pointer preview keeps the separator value current for assistive technology");
    assert.equal(myWorkUpdateCommits, commitsBeforePointerDrag, "pointer movement previews layout without committing React state");
    assert.equal(
      dom.window.localStorage.getItem("mangorts.my-work.layout.v1:company-1"),
      storageAfterKeyboard,
      "pointer movement does not persist an unfinished layout",
    );
    await act(async () => {
      projectDivider.dispatchEvent(pointerEvent("pointerup", 740, 7));
    });
    assert.equal(myWorkUpdateCommits, commitsBeforePointerDrag + 1, "pointer release commits the preview exactly once");
    assert.equal(columns.style.gridTemplateColumns, pointerPreviewColumns, "the committed layout matches the pointer preview without jumping");
    assert.equal(projectDivider.getAttribute("aria-valuenow"), pointerPreviewValue);
    await act(async () => {
      projectDivider.dispatchEvent(pointerEvent("pointerdown", 740, 8));
      projectDivider.dispatchEvent(pointerEvent("pointercancel", 740, 8));
    });
    assert.deepEqual(capturedPointers, [7, 8]);
    assert.deepEqual(releasedPointers, [7, 8]);
    assert.notEqual(dom.window.localStorage.getItem("mangorts.my-work.layout.v1:company-1"), storageAfterKeyboard, "pointer release persists the layout");

    const nodeRows = Array.from(container.querySelectorAll<HTMLElement>('[data-my-work-row="node"]'));
    assert.equal(nodeRows.length, 2);
    assert.equal(nodeRows[0]?.querySelector("button button"), null, "inline context targets are siblings, never nested buttons");
    assert.deepEqual(
      Array.from(nodeRows[0]?.querySelectorAll<HTMLButtonElement>("button[data-my-work-target]") ?? []).map((button) => button.dataset.myWorkTarget),
      ["node", "process", "project"],
    );
    assert.deepEqual(
      Array.from(nodeRows[1]?.querySelectorAll<HTMLButtonElement>("button[data-my-work-target]") ?? []).map((button) => button.dataset.myWorkTarget),
      ["node"],
      "a Node with hidden inline context exposes no context placeholder or target",
    );

    let actionItemOpened = "";
    let actionItemAnchor: { left?: number; top?: number; right?: number; bottom?: number } | undefined;
    dom.window.addEventListener("mangorts:editor-entity-reference-open", ((event: CustomEvent) => {
      actionItemOpened = event.detail?.entity?.entityID ?? "";
      actionItemAnchor = event.detail?.anchor;
    }) as EventListener, { once: true });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-target="action-item"]')?.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true,
        clientX: 314,
        clientY: 286,
        detail: 1,
      }));
    });
    assert.equal(actionItemOpened, "action-red");
    assert.deepEqual(actionItemAnchor, { left: 314, top: 286, right: 314, bottom: 286 }, "pointer opens the Action Item overlay at the click point");

    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="node"]')?.click());
    assert.equal(dom.window.location.pathname, "/nodes/node-context");
    dom.window.history.replaceState({}, "", "/my-work");
    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="process"]')?.click());
    assert.equal(dom.window.location.pathname, "/logic-gates/process-inline");
    dom.window.history.replaceState({}, "", "/my-work");
    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="project"]')?.click());
    assert.equal(dom.window.location.pathname, "/projects/project-inline");
    dom.window.history.replaceState({}, "", "/my-work");

    const actionScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="action_items"]');
    const nodeScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="nodes"]');
    const processScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    const projectScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="projects"]');
    assert.ok(actionScroll && nodeScroll && processScroll && projectScroll);
    for (const scrollBody of [actionScroll, nodeScroll, processScroll, projectScroll]) {
      setScrollPosition(scrollBody, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 });
    }

    await act(async () => {
      actionScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    const actionLoadCall = calls.find((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "actions-old-cursor");
    const actionLoadURL = new URL(actionLoadCall?.path ?? "", "http://api.test");
    assert.equal(actionLoadURL.searchParams.get("section"), "action_items");
    assert.equal(actionLoadURL.searchParams.get("grouping"), "color:asc,completion_due_date:asc");
    assert.match(actionScroll.textContent ?? "", /Red Action/);
    assert.match(actionScroll.textContent ?? "", /Second Action/);
    assert.doesNotMatch(actionScroll.textContent ?? "", /Duplicate Red/, "cursor overlap is de-duplicated by exact typed ID");

    const nodeCursorCallsBefore = calls.filter((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "nodes-page-2").length;
    await act(async () => {
      nodeScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      nodeScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    assert.equal(
      calls.filter((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "nodes-page-2").length,
      nodeCursorCallsBefore + 1,
      "two rapid scroll events issue only one request for the same cursor",
    );
    const nodeLoadCall = calls.find((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "nodes-page-2");
    const nodeLoadURL = new URL(nodeLoadCall?.path ?? "", "http://api.test");
    assert.equal(nodeLoadURL.searchParams.get("section"), "nodes");
    assert.equal(nodeLoadURL.searchParams.get("grouping"), "priority:asc,due_date:asc");
    await act(async () => {
      resolveNodeLoadMore?.(response({
        action_items: undefined,
        processes: undefined,
        projects: undefined,
        nodes: {
          items: [
            { node_id: "node-context", name: "Duplicate Context Node" },
            { node_id: "node-page-2", name: "Second Page Node", priority: 2, due_date: "2026-09-05" },
          ],
          has_more: false,
        },
      }));
      await Promise.resolve();
    });
    assert.match(nodeScroll.textContent ?? "", /Context Node/);
    assert.match(nodeScroll.textContent ?? "", /Second Page Node/);
    assert.doesNotMatch(nodeScroll.textContent ?? "", /Duplicate Context Node/);

    await act(async () => {
      processScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      projectScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    const processLoadCall = calls.find((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "processes-page-2");
    const projectLoadCall = calls.find((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "projects-page-2");
    const processLoadURL = new URL(processLoadCall?.path ?? "", "http://api.test");
    const projectLoadURL = new URL(projectLoadCall?.path ?? "", "http://api.test");
    assert.equal(processLoadURL.searchParams.get("section"), "processes");
    assert.equal(processLoadURL.searchParams.get("role"), "responsible");
    assert.equal(projectLoadURL.searchParams.get("section"), "projects");
    assert.equal(projectLoadURL.searchParams.has("role"), false);
    assert.match(processScroll.textContent ?? "", /Responsible Process/);
    assert.match(processScroll.textContent ?? "", /Second Process/);
    assert.match(projectScroll.textContent ?? "", /Team Project/);
    assert.doesNotMatch(projectScroll.textContent ?? "", /Second Project/, "a failed append preserves the accumulated Project rows");
    const projectSection = container.querySelector<HTMLElement>('[data-my-work-section="projects"]');
    assert.match(projectSection?.querySelector('[role="alert"]')?.textContent ?? "", /Project append failed/);
    const projectCursorCallsBeforeRetry = calls.filter((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "projects-page-2").length;
    await act(async () => {
      projectSection?.querySelector<HTMLButtonElement>('[role="alert"] button')?.click();
      await Promise.resolve();
    });
    assert.equal(
      calls.filter((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "projects-page-2").length,
      projectCursorCallsBeforeRetry + 1,
      "Retry repeats the failed Project cursor instead of replacing the list with page one",
    );
    assert.match(projectScroll.textContent ?? "", /Team Project/);
    assert.match(projectScroll.textContent ?? "", /Second Project/);

    await act(async () => {
      radios[0]?.focus();
      radios[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.equal(processRoleGroup?.querySelector<HTMLButtonElement>('[aria-label="Accountable"]')?.getAttribute("aria-checked"), "true");
    assert.equal(dom.window.document.activeElement?.getAttribute("aria-label"), "Accountable");
    assert.deepEqual(
      Array.from(processRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []).map((button) => button.tabIndex),
      [-1, 0, -1, -1],
      "the radio group keeps exactly one keyboard tab stop",
    );
    assert.doesNotMatch(container.textContent ?? "", /Responsible Process/, "the previous role is cleared before the new role returns");
    const accountableCall = calls.at(-1);
    assert.equal(new URL(accountableCall?.path ?? "", "http://api.test").searchParams.get("section"), "processes");
    assert.equal(new URL(accountableCall?.path ?? "", "http://api.test").searchParams.get("role"), "accountable");

    await act(async () => processRoleGroup?.querySelector<HTMLButtonElement>('[aria-label="Consulted"]')?.click());
    assert.equal(accountableCall?.init?.signal?.aborted, true, "a later role request cancels the stale role request");
    await act(async () => {
      pendingRoles.get("accountable")?.(response({
        action_items: undefined,
        nodes: undefined,
        projects: undefined,
        processes: { role: "accountable", items: [{ logic_gate_id: "process-responsible", name: "Stale Accountable", status_counts: emptyProcessStatusCounts }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.doesNotMatch(container.textContent ?? "", /Stale Accountable/);
    await act(async () => {
      pendingRoles.get("consulted")?.(response({
        action_items: undefined,
        nodes: undefined,
        projects: undefined,
        processes: { role: "consulted", items: [{ logic_gate_id: "process-responsible", name: "Consulted Process", status_counts: emptyProcessStatusCounts }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Consulted Process/, "the new role may return an ID loaded by the prior role");

    const beforeGroupingCalls = calls.length;
    await act(async () => groupButtons[0]?.click());
    const actionGroupingDialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Action Item grouping"]');
    assert.equal(actionGroupingDialog?.parentElement, dom.window.document.body, "the grouping dialog is portaled above the clipped section");
    assert.equal(actionGroupingDialog?.style.position, "fixed");
    assert.equal(actionGroupingDialog?.style.borderRadius, "14px", "the grouping dialog uses the raised surface treatment");
    assert.match(actionGroupingDialog?.style.boxShadow ?? "", /14px 16px 38px/);
    const firstGroupingRow = actionGroupingDialog?.querySelector<HTMLSelectElement>('select[aria-label="Grouping level 1 field"]')?.parentElement?.parentElement;
    assert.equal(firstGroupingRow?.style.borderRadius, "10px", "grouping rows and their level tags are raised surfaces");
    const directionButton = actionGroupingDialog?.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for grouping level 1"]');
    assert.ok(directionButton);
    await act(async () => {
      directionButton.click();
      await Promise.resolve();
    });
    assert.equal(calls.length, beforeGroupingCalls + 1);
    const actionGroupingURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(actionGroupingURL.searchParams.get("section"), "action_items");
    assert.equal(actionGroupingURL.searchParams.get("grouping"), "color:desc,completion_due_date:asc");
    const actionSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    assert.doesNotMatch(actionSection?.textContent ?? "", /Red Action|Yellow Action/, "regrouping clears the old rows immediately");
    assert.doesNotMatch(actionSection?.textContent ?? "", /\bPrevious\b|\bNext\b|Page \d/, "My Work never exposes page controls");
    await act(async () => {
      resolveActionGrouping?.(response({
        nodes: undefined,
        processes: undefined,
        projects: undefined,
        action_items: { items: [{ entity_id: "action-red", name: "Regrouped Red Action", color: "red", completion_due_date_field_id: "field-red" }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.match(actionSection?.textContent ?? "", /Regrouped Red Action/, "regrouping may return an ID from the replaced section with fresh presentation data");

    const beforeNodeGroupingCalls = calls.length;
    await act(async () => groupButtons[1]?.click());
    const nodeGroupingDialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Node grouping"]');
    const removeNodeDueDate = nodeGroupingDialog?.querySelector<HTMLButtonElement>('button[aria-label="Remove grouping level 2"]');
    assert.ok(removeNodeDueDate);
    await act(async () => {
      removeNodeDueDate.click();
      await Promise.resolve();
    });
    assert.equal(calls.length, beforeNodeGroupingCalls + 1);
    const nodeGroupingURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(nodeGroupingURL.searchParams.get("section"), "nodes");
    assert.equal(nodeGroupingURL.searchParams.get("grouping"), "priority:asc");
    assert.equal(nodeGroupingURL.searchParams.has("cursor"), false);
    const nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    assert.match(nodeSection?.textContent ?? "", /Context Node/, "regrouping replaces the section with its first cursor page");
    assert.doesNotMatch(nodeSection?.textContent ?? "", /Second Page Node/, "regrouping does not reuse the prior cursor");
    assert.doesNotMatch(nodeSection?.textContent ?? "", /\bPrevious\b|\bNext\b|Page \d/, "Nodes use continuous scrolling instead of paging controls");

    await act(async () => {
      perspectiveRadios[0]?.focus();
      perspectiveRadios[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    const delegatedURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(delegatedURL.searchParams.get("section"), "action_items");
    assert.equal(delegatedURL.searchParams.get("perspective"), "delegated");
    assert.equal(delegatedURL.searchParams.get("grouping"), "color:desc,completion_due_date:asc", "perspective preserves the grouping stack");
    assert.match(actionSection?.textContent ?? "", /Delegated Action/);
    assert.equal(perspectiveRadios[1]?.getAttribute("aria-checked"), "true");
    assert.equal(dom.window.document.activeElement, perspectiveRadios[1]);

    await act(async () => {
      nodeRadios[0]?.focus();
      nodeRadios[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    const accountableNodeURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(accountableNodeURL.searchParams.get("section"), "nodes");
    assert.equal(accountableNodeURL.searchParams.get("role"), "accountable");
    assert.equal(accountableNodeURL.searchParams.get("grouping"), "priority:asc", "Node role preserves the grouping stack");
    assert.match(nodeSection?.textContent ?? "", /Accountable Node/);
    assert.equal(nodeRadios[1]?.getAttribute("aria-checked"), "true");
    assert.match(container.textContent ?? "", /Consulted Process/, "Node role changes reload only Nodes");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("My Work toggles completed History in place, refreshes Action Item edits, and saves inline due dates", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installMyWorkDOMGlobals(dom, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { Simulate }, { MyWorkContent }, { EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION }] = await Promise.all([
      import("react-dom/client"),
      import("react-dom/test-utils"),
      import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx"),
      import("../../../../frontend/src/modules/editor/editorEntityLinks.js"),
    ]);
    const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
    let activeActionName = "Active Action";
    let activeActionDue = "2026-09-01";
    let activeActionVisible = true;
    let nodeDue = "2026-09-02";
    let holdNextActionDueSave = false;
    let releaseActionDueSave: (() => void) | undefined;
    const actionDueWrites: Array<string | null> = [];
    const actionPage = (): MyWorkResponse["action_items"] => ({
      items: activeActionVisible ? [{
        entity_id: "action-active",
        name: activeActionName,
        completion_due_date: activeActionDue || null,
        completion_due_date_field_id: "field-action-due",
      }] : [],
      has_more: false,
    });
    const nodePage = (): MyWorkResponse["nodes"] => ({
      items: [{ node_id: "node-active", name: "Active Node", due_date: nodeDue || null }],
      has_more: false,
    });
    const requestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      calls.push({ path, init });
      if (path.startsWith("/v1/entities/") && init?.method === "PUT") {
        const payload = JSON.parse(String(init.body)) as { value?: string | null };
        const nextDueDate = payload.value ?? null;
        actionDueWrites.push(nextDueDate);
        if (holdNextActionDueSave) {
          holdNextActionDueSave = false;
          await new Promise<void>((resolve) => { releaseActionDueSave = resolve; });
        }
        activeActionDue = nextDueDate ?? "";
        return { entity_field: {} } as T;
      }
      if (path.startsWith("/v1/nodes/") && init?.method === "PUT") {
        const payload = init.json as { due_date?: string | null };
        nodeDue = payload.due_date ?? "";
        return {} as T;
      }
      const url = new URL(path, "http://api.test");
      const section = url.searchParams.get("section");
      if (!section) return response({
        action_items: actionPage(),
        nodes: nodePage(),
        processes: { role: "responsible", items: [], has_more: false },
        projects: { items: [], has_more: false },
      }) as T;
      if (section === "action_items") return response({
        action_items: url.searchParams.get("history") === "true" ? {
          items: [
            { entity_id: "action-new", name: "Newest completed Action", completion_due_date_field_id: "field-new", completed_timestamp: "2026-08-29T12:00:00Z" },
            { entity_id: "action-old", name: "Older completed Action", completion_due_date_field_id: "field-old", completed_timestamp: "2026-08-28T12:00:00Z" },
          ],
          has_more: false,
        } : actionPage(),
        nodes: undefined,
        processes: undefined,
        projects: undefined,
      }) as T;
      if (section === "nodes") return response({
        action_items: undefined,
        nodes: url.searchParams.get("history") === "true" ? {
          items: [
            { node_id: "node-new", name: "Newest completed Node", completed_timestamp: "2026-08-29T11:00:00Z" },
            { node_id: "node-old", name: "Older completed Node", completed_timestamp: "2026-08-27T11:00:00Z" },
          ],
          has_more: false,
        } : nodePage(),
        processes: undefined,
        projects: undefined,
      }) as T;
      return response() as T;
    };

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" subjectID="viewer-1" requestJSON={requestJSON} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const actionSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    const nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    assert.ok(actionSection && nodeSection);
    const actionHistory = actionSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]');
    const nodeHistoryButton = nodeSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]');
    assert.ok(actionHistory && nodeHistoryButton);
    await act(async () => {
      actionHistory.click();
      await Promise.resolve();
    });
    assert.equal(actionHistory.getAttribute("aria-pressed"), "true");
    assert.equal(actionSection.querySelector<HTMLButtonElement>('button[aria-label="Group Action Items"]')?.disabled, true);
    assert.deepEqual(
      Array.from(actionSection.querySelectorAll<HTMLElement>('[data-my-work-target="action-item"]')).map((row) => row.textContent?.trim()),
      ["Newest completed Action", "Older completed Action"],
    );
    const actionHistoryURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(actionHistoryURL.searchParams.get("history"), "true");
    assert.equal(actionHistoryURL.searchParams.get("limit"), "12");
    assert.equal(actionHistoryURL.searchParams.has("grouping"), false);
    await act(async () => {
      actionHistory.click();
      await Promise.resolve();
    });
    assert.equal(actionSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]')?.getAttribute("aria-pressed"), "false");
    assert.match(actionSection.textContent ?? "", /Active Action/);

    await act(async () => {
      nodeHistoryButton.click();
      await Promise.resolve();
    });
    const nodeHistoryURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(nodeHistoryURL.searchParams.get("history"), "true");
    assert.equal(nodeHistoryURL.searchParams.get("limit"), "12");
    assert.deepEqual(
      Array.from(nodeSection.querySelectorAll<HTMLElement>('[data-my-work-target="node"]')).map((row) => row.textContent?.trim()),
      ["Newest completed Node", "Older completed Node"],
    );
    await act(async () => {
      nodeSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]')?.click();
      await Promise.resolve();
    });

    activeActionName = "Renamed Action";
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, {
        detail: { entityID: "action-active", label: activeActionName, isActionItem: true, actionItemColor: null },
      }));
      await Promise.resolve();
    });
    assert.match(actionSection.textContent ?? "", /Renamed Action/, "successful same-page edits refresh the current row immediately");
    activeActionVisible = false;
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, {
        detail: { entityID: "action-active", label: activeActionName, isActionItem: true, actionItemColor: null },
      }));
      await Promise.resolve();
    });
    assert.doesNotMatch(actionSection.textContent ?? "", /Renamed Action/, "a newly completed Action Item leaves the normal list immediately");

    activeActionVisible = true;
    await act(async () => {
      dom.window.dispatchEvent(new dom.window.CustomEvent(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, {
        detail: { entityID: "action-active", label: activeActionName, isActionItem: true, actionItemColor: null },
      }));
      await Promise.resolve();
    });
    const actionDateInput = actionSection.querySelector<HTMLInputElement>('input[aria-label="Due Date for Renamed Action"]');
    assert.ok(actionDateInput);
    await act(async () => {
      actionDateInput.click();
      await Promise.resolve();
    });
    const actionCalendar = dom.window.document.querySelector<HTMLElement>('[data-editor-calendar-popover="Due Date for Renamed Action"]');
    assert.ok(actionCalendar, "clicking the inline field opens the shared calendar");
    const valueSetter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
    assert.ok(valueSetter);
    await act(async () => {
      valueSetter.call(actionDateInput, "9/10/2026");
      Simulate.change(actionDateInput, { target: { value: "9/10/2026" } });
      await Promise.resolve();
    });
    holdNextActionDueSave = true;
    await act(async () => {
      Simulate.blur(actionDateInput);
      await Promise.resolve();
    });
    await act(async () => {
      Array.from(actionCalendar.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Clear")?.click();
      await Promise.resolve();
    });
    assert.deepEqual(actionDueWrites, ["2026-09-10"], "the selected calendar value waits behind the in-flight typed-date save");
    assert.ok(releaseActionDueSave);
    await act(async () => {
      releaseActionDueSave?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    for (let attempt = 0; attempt < 10 && actionDueWrites.length < 2; attempt += 1) {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    }
    assert.deepEqual(actionDueWrites, ["2026-09-10", null], "the later calendar choice is always the final serialized write");
    assert.equal(activeActionDue, "", "clearing the Action Item date writes null to its exact Completion due date field");
    assert.equal(actionSection.querySelector<HTMLInputElement>('input[aria-label="Due Date for Renamed Action"]')?.value, "Due Date: No date");

    const nodeDateInput = nodeSection.querySelector<HTMLInputElement>('input[aria-label="Due Date for Active Node"]');
    assert.ok(nodeDateInput);
    await act(async () => {
      nodeDateInput.click();
      await Promise.resolve();
    });
    const nodeCalendar = dom.window.document.querySelector<HTMLElement>('[data-editor-calendar-popover="Due Date for Active Node"]');
    assert.ok(nodeCalendar);
    await act(async () => {
      Array.from(nodeCalendar.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "Clear")?.click();
      await Promise.resolve();
    });
    assert.equal(nodeDue, "", "clearing the Node date writes null to the exact Node");
    assert.equal(nodeSection.querySelector<HTMLInputElement>('input[aria-label="Due Date for Active Node"]')?.value, "Due Date: No date");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("My Work windows a thousand rows while keeping focused and late exact resources reachable", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installMyWorkDOMGlobals(dom, restores);

  const rectDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "getBoundingClientRect");
  const offsetHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "offsetHeight");
  const offsetWidthDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "offsetWidth");
  Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: HTMLElement) {
      const height = this.dataset.myWorkScroll
        ? 600
        : Number(this.dataset.myWorkEstimatedSize) || 48;
      return new dom.window.DOMRect(0, 0, 800, height);
    },
  });
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.myWorkScroll
          ? 600
          : Number(this.dataset.myWorkEstimatedSize) || 48;
      },
    },
    offsetWidth: { configurable: true, get: () => 800 },
  });
  restores.push(() => {
    if (rectDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "getBoundingClientRect", rectDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
    if (offsetHeightDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "offsetHeight", offsetHeightDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    if (offsetWidthDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "offsetWidth", offsetWidthDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
  });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { MyWorkContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx"),
    ]);
    const processes = Array.from({ length: 1_000 }, (_, index) => ({
      logic_gate_id: `process-${index}`,
      name: `Process ${index}`,
      status_counts: emptyProcessStatusCounts,
    }));
    const requestJSON = <T,>(_path: string, _init?: RequestInit): Promise<T> => Promise.resolve(response({
      action_items: { items: [], has_more: false },
      nodes: { items: [], has_more: false },
      processes: { role: "responsible", items: processes, has_more: false },
      projects: { items: [], has_more: false },
    }) as T);

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" subjectID="viewer-1" requestJSON={requestJSON} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const processSection = container.querySelector<HTMLElement>('[data-my-work-section="processes"]');
    const processScroll = processSection?.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    const virtualList = processSection?.querySelector<HTMLElement>('[data-my-work-windowed-list="true"]');
    assert.ok(processScroll && virtualList);
    assert.equal(virtualList.dataset.myWorkTotalEntries, "1000");
    const initiallyMounted = virtualList.querySelectorAll('[data-my-work-entry-kind="row"]').length;
    assert.ok(initiallyMounted > 0 && initiallyMounted < 100, `expected a bounded initial window, mounted ${initiallyMounted}`);
    assert.equal(virtualList.querySelector('[data-my-work-entry-id="row:process-950"]'), null, "a late row starts outside the mounted window");

    const focusedButton = virtualList.querySelector<HTMLButtonElement>(
      '[data-my-work-entry-id="row:process-0"] [data-my-work-target="process"]',
    );
    assert.ok(focusedButton);
    await act(async () => {
      focusedButton.focus();
      await Promise.resolve();
    });
    assert.equal(dom.window.document.activeElement, focusedButton);

    const requestedScrollTop = 950 * 47;
    await act(async () => {
      processScroll.scrollTop = requestedScrollTop;
      processScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });

    const lateEntry = virtualList.querySelector<HTMLElement>('[data-my-work-entry-id="row:process-950"]');
    const lateButton = lateEntry?.querySelector<HTMLButtonElement>('[data-my-work-target="process"]');
    assert.ok(lateButton, "scrolling mounts a late exact Process target");
    assert.equal(processScroll.scrollTop, requestedScrollTop, "window measurement does not jump the section scroll position");
    assert.equal(focusedButton.isConnected, true, "the focused row remains mounted outside the visible window");
    assert.equal(dom.window.document.activeElement, focusedButton, "window changes preserve keyboard focus");
    const mountedAfterScroll = virtualList.querySelectorAll('[data-my-work-entry-kind="row"]').length;
    assert.ok(mountedAfterScroll < 100, `expected scrolling to keep a bounded row window, mounted ${mountedAfterScroll}`);

    await act(async () => lateButton.click());
    assert.equal(dom.window.location.pathname, "/logic-gates/process-950", "the late virtual row opens its exact resource");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("My Work reloads the same resource ID when the subject changes", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
  installMyWorkDOMGlobals(dom, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { MyWorkContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx"),
    ]);
    let initialRequests = 0;
    const requestJSON = <T,>(_path: string, _init?: RequestInit): Promise<T> => {
      initialRequests += 1;
      const subjectLabel = initialRequests === 1 ? "First Subject Process" : "Second Subject Process";
      return Promise.resolve(response({
        action_items: { items: [], has_more: false },
        nodes: { items: [], has_more: false },
        processes: {
          role: "responsible",
          items: [{ logic_gate_id: "shared-process", name: subjectLabel, status_counts: emptyProcessStatusCounts }],
          has_more: false,
        },
        projects: { items: [], has_more: false },
      }) as T);
    };

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" subjectID="viewer-1" requestJSON={requestJSON} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.match(container.textContent ?? "", /First Subject Process/);

    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" subjectID="viewer-2" requestJSON={requestJSON} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(initialRequests, 2);
    assert.doesNotMatch(container.textContent ?? "", /First Subject Process/);
    assert.match(container.textContent ?? "", /Second Subject Process/, "a new subject may return the same ID with fresh presentation data");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

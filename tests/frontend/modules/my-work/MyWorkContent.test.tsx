import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import type { MyWorkResponse } from "../../../../frontend/src/modules/my-work/myWorkApi.js";
import { getQDBusinessDate } from "../../../../frontend/src/modules/logic-gates/qdRatingsApi.js";

type Restore = () => void;

class FakeDataTransfer {
  private readonly values = new Map<string, string>();
  effectAllowed = "all";
  dropEffect = "none";
  getData(type: string): string { return this.values.get(type) ?? ""; }
  setData(type: string, value: string): void { this.values.set(type, value); }
}

async function dragMyWorkField(source: HTMLElement, target: HTMLElement): Promise<void> {
  const transfer = new FakeDataTransfer() as unknown as DataTransfer;
  await act(async () => Simulate.dragStart(source, { dataTransfer: transfer }));
  await act(async () => {
    Simulate.dragEnter(target, { dataTransfer: transfer });
    Simulate.dragOver(target, { dataTransfer: transfer });
    Simulate.drop(target, { dataTransfer: transfer });
  });
  await act(async () => Simulate.dragEnd(source, { dataTransfer: transfer }));
}

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
        { entity_id: "action-red", name: "Red Action", color: "red", huddle_process: { huddle_logic_gate_id: "huddle-weekly", name: "Weekly Huddle" }, assigned_by_user_id: "assigner-1", assigned_by_name: "Avery Assignor", created_timestamp: "2026-08-20T12:00:00Z", completion_due_date: dateKeyAfter(0), completion_due_date_field_id: "field-red", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One" },
        { entity_id: "action-yellow", name: "Yellow Action", color: "yellow", huddle_process: { huddle_logic_gate_id: "huddle-weekly", name: "Weekly Huddle" }, assigned_by_user_id: "assigner-1", assigned_by_name: "Avery Assignor", created_timestamp: "2026-08-21T12:00:00Z", completion_due_date: dateKeyAfter(1), completion_due_date_field_id: "field-yellow", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One" },
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
    const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
    const pendingRoles = new Map<string, (value: MyWorkResponse) => void>();
    let resolveActionGrouping: ((value: MyWorkResponse) => void) | undefined;
    let resolveNodeLoadMore: ((value: MyWorkResponse) => void) | undefined;
    let projectAppendAttempts = 0;
    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      calls.push({ path, init });
      const url = new URL(path, "http://api.test");
      if (url.pathname === "/v1/saved-views") return Promise.resolve({ saved_views: [] } as T);
      const section = url.searchParams.get("section");
      if (!section) return Promise.resolve(response() as T);
      if (section === "action_items" && url.searchParams.get("cursor")) {
        return Promise.resolve(response({
          nodes: undefined,
          processes: undefined,
          projects: undefined,
          action_items: {
            items: [
              { entity_id: "action-red", name: "Duplicate Red", color: "red", completion_due_date_field_id: "field-red", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One" },
              { entity_id: "action-page-2", name: "Second Action", color: "yellow", completion_due_date: "2026-09-04", completion_due_date_field_id: "field-page-2", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One" },
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
            items: [{ entity_id: "action-delegated", name: "Delegated Action", color: "red", completion_due_date: dateKeyAfter(2), completion_due_date_field_id: "field-delegated", person_in_charge_user_id: "person-alex", person_in_charge_name: "Alex Morgan" }],
            has_more: false,
          },
        }) as T);
      }
      if (
        section === "action_items"
        && url.searchParams.get("grouping") === "color:asc,huddle_process:asc"
        && url.searchParams.get("ordering") === "completion_due_date:asc"
      ) {
        return Promise.resolve(response({ nodes: undefined, processes: undefined, projects: undefined }) as T);
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    assert.equal(calls.filter((call) => call.path.startsWith("/v1/saved-views?")).length, 2, "Mine and Delegated preferences load independently");
    assert.equal(calls.filter((call) => call.path.startsWith("/v1/my-work?")).length, 2, "the initial read is followed by one preference-shaped Mine read");
    assert.equal(new URL(calls[0]?.path ?? "", "http://api.test").searchParams.has("section"), false);
    assert.equal(container.querySelector("h1")?.textContent, "My Work");
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLElement>("[data-my-work-section]")).map((section) => section.dataset.myWorkSection),
      ["action_items", "processes", "projects"],
      "My Work starts with exactly three active full-height sections",
    );
    const middleViewToggle = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="My Work middle view"]');
    const middleViewButtons = Array.from(middleViewToggle?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    const middleViewIcons = Array.from(middleViewToggle?.querySelectorAll<HTMLElement>('[data-my-work-middle-view-icon]') ?? []);
    const actionItemsTitle = container.querySelector<HTMLElement>('[data-my-work-section="action_items"] h2');
    const actionItemsTitleIcon = container.querySelector<HTMLElement>('[data-my-work-section-icon="action_items"]');
    assert.equal(middleViewToggle?.getAttribute("data-my-work-middle-view-toggle"), "true");
    assert.ok(actionItemsTitle && actionItemsTitleIcon);
    assert.deepEqual(middleViewButtons.map((button) => button.textContent?.trim()), ["Processes", "Nodes"]);
    assert.deepEqual(middleViewButtons.map((button) => button.getAttribute("aria-checked")), ["true", "false"], "Processes is the default middle view");
    assert.deepEqual(
      middleViewButtons.map((button) => button.querySelector<HTMLElement>("[data-my-work-middle-view-icon]")?.dataset.myWorkMiddleViewIcon),
      ["processes", "nodes"],
      "both toggle choices keep their existing resource icon",
    );
    assert.deepEqual(middleViewButtons.map((button) => button.style.height), ["36px", "36px"], "both toggle choices are large enough for normal header icons");
    assert.deepEqual(middleViewButtons.map((button) => button.style.fontSize), [actionItemsTitle.style.fontSize, actionItemsTitle.style.fontSize], "toggle labels match the normal section-title scale");
    assert.equal(middleViewToggle?.style.flex, "0 0 auto", "the complete toggle cannot shrink around its header-sized contents");
    assert.deepEqual(
      middleViewIcons.map((icon) => [icon.style.width, icon.style.height, icon.style.borderRadius, icon.style.border, icon.style.background, icon.style.boxShadow]),
      Array.from({ length: 2 }, () => [
        actionItemsTitleIcon.style.width,
        actionItemsTitleIcon.style.height,
        actionItemsTitleIcon.style.borderRadius,
        actionItemsTitleIcon.style.border,
        actionItemsTitleIcon.style.background,
        actionItemsTitleIcon.style.boxShadow,
      ]),
      "both toggle icons use the complete normal section-title icon surface",
    );
    assert.notEqual(middleViewButtons[0]?.style.border, "1px solid transparent", "the selected Processes option has a visible border");
    assert.equal(middleViewButtons[1]?.style.border, "1px solid transparent", "the unselected Nodes option has no selected border");
    const groupButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Group"]'));
    assert.deepEqual(groupButtons.map((button) => button.getAttribute("aria-label")), ["Group, order, and choose Action Item row fields"]);
    assert.deepEqual(groupButtons.map((button) => button.textContent), [""], "the active section grouper is icon-only");
    const historyButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-pressed][data-my-work-history-selected]'));
    assert.deepEqual(historyButtons.map((button) => button.getAttribute("aria-label")), ["Open History"]);
    assert.deepEqual(historyButtons.map((button) => button.textContent?.trim()), ["History"], "the existing Action Item History label remains beside its icon");
    assert.deepEqual(historyButtons.map((button) => button.getAttribute("aria-pressed")), ["false"]);
    assert.match(container.querySelector<HTMLElement>('[data-my-work-columns="true"]')?.style.gridTemplateColumns ?? "", /minmax\(360px,/, "the left column has enough capacity for the established controls and new selectors");
    assert.match(container.querySelector<HTMLElement>('[data-my-work-columns="true"]')?.style.gridTemplateColumns ?? "", /minmax\(512px,/, "the middle column keeps a safety margin around the full one-row Nodes header");
    const actionItemsSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    const actionHeaderIconPaths = actionItemsSection?.querySelectorAll<SVGPathElement>('[data-my-work-section-icon="action_items"] svg path');
    assert.equal(actionHeaderIconPaths?.[0]?.getAttribute("stroke"), "#22d3ee", "the Action Items header target uses the cyan outer ring");
    assert.equal(actionHeaderIconPaths?.[1]?.getAttribute("stroke"), "#6366f1", "the Action Items header target uses the indigo inner ring");
    assert.equal(container.querySelectorAll('[data-my-work-group-field="completion_due_date"]').length, 0, "Completion due date orders rows without creating a visible group header");
    assert.equal(container.querySelectorAll('[data-my-work-group-field="due_date"]').length, 0, "Node due dates retain their compact hidden-heading presentation");
    assert.equal(container.querySelectorAll('button[data-my-work-group-field="huddle_process"][data-my-work-group-key="huddle-weekly"]').length, 2, "permission-safe Huddle process groups are clickable");
    assert.equal(container.querySelector('[data-my-work-action-item-field-settings="true"]'), null, "the separate row-field gear is removed");
    const huddleHeading = container.querySelector<HTMLElement>('button[data-my-work-group-field="huddle_process"]');
    assert.ok(huddleHeading?.querySelector('[data-my-work-huddle-group-label="true"] svg'), "the official Huddle Process icon appears before its name");
    assert.equal(huddleHeading?.style.fontFamily, "var(--mango-font-family)", "Huddle headings use the app font");
    assert.ok(container.querySelector('[data-my-work-huddle-surface-id][data-my-work-huddle-surface-edge="first"]'), "each Huddle bucket begins an elevated surface");
    let openedHuddle: unknown;
    dom.window.addEventListener("mangorts:huddle-open", ((event: CustomEvent) => { openedHuddle = event.detail; }) as EventListener, { once: true });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[data-my-work-group-field="huddle_process"][data-my-work-group-key="huddle-weekly"]')?.click();
    });
    assert.deepEqual(openedHuddle, { resourceType: "huddle_logic_gate", resourceID: "huddle-weekly", name: "Weekly Huddle" });
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Red Action"]')?.value, "Due Today");
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Yellow Action"]')?.value, "Due Tomorrow");
    assert.equal(container.querySelectorAll('[data-my-work-due-date="true"] button[aria-haspopup="dialog"]').length, 2, "the active Action Item forms keep their calendar controls");
    const todayInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Red Action"]');
    const tomorrowInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Yellow Action"]');
    assert.equal(todayInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "urgent");
    assert.equal(tomorrowInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "urgent");
    assert.equal(todayInput?.style.color, "rgb(185, 28, 28)", "Due Today text is red");
    assert.equal(tomorrowInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#ef4444", "Due Tomorrow calendar is red");
    assert.equal(todayInput?.style.gridColumn, "2", "due-date text follows the calendar control");
    assert.equal(todayInput?.parentElement?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.style.gridColumn, "1", "the calendar button is the left column");
    assert.equal(todayInput?.parentElement?.style.width, "120px", "relative labels have enough room for the complete phrase");
    assert.equal(todayInput?.closest<HTMLElement>('[data-my-work-due-date]')?.style.width, "130px", "the complete relative due-date pill is measured inside its row");
    assert.equal(todayInput?.closest<HTMLElement>('[data-my-work-due-date]')?.style.boxSizing, "border-box", "due-date pill chrome is included in its measured width");
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
    assert.equal(container.querySelectorAll(".my-work-resource-row").length, 4, "every resource row in the three active sections uses the shared lift interaction");

    const perspectiveGroup = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Action Item perspective"]');
    const perspectiveRadios = Array.from(perspectiveGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(perspectiveRadios.map((button) => button.textContent), ["Mine", "Delegated"]);
    assert.deepEqual(perspectiveRadios.map((button) => button.getAttribute("aria-checked")), ["true", "false"]);
    assert.equal(perspectiveGroup?.previousElementSibling?.tagName, "H2", "Mine / Delegated sits immediately to the right of the Action Items title");
    assert.deepEqual(perspectiveRadios.map((button) => button.style.height), ["27px", "27px"], "the perspective segments use the larger target");
    assert.match(perspectiveRadios[0]?.style.background ?? "", /240, 249, 255/, "the selected perspective uses the soft light-blue gradient");
    assert.equal(perspectiveRadios[0]?.style.color, "rgb(51, 65, 85)", "the selected perspective uses calm slate text");
    const initialProcessRoleGroup = container.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Process RACI role"]');
    const initialProcessRadios = Array.from(initialProcessRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(initialProcessRadios.map((button) => button.getAttribute("aria-label")), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(initialProcessRadios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"]);
    assert.deepEqual(initialProcessRadios.map((button) => button.tabIndex), [0, -1, -1, -1]);
    assert.deepEqual(initialProcessRadios.map((button) => [button.style.width, button.style.height]), Array.from({ length: 4 }, () => ["27px", "26px"]), "the Process selector preserves the established dimensions");
    assert.match(initialProcessRadios[0]?.getAttribute("style") ?? "", /240, 138, 36/, "Responsible uses the canonical orange RACI color");
    assert.match(initialProcessRadios[1]?.getAttribute("style") ?? "", /25, 200, 121/, "Accountable uses the canonical green RACI color");
    assert.match(initialProcessRadios[2]?.getAttribute("style") ?? "", /25, 168, 255/, "Consulted uses the canonical blue RACI color");
    assert.match(initialProcessRadios[3]?.getAttribute("style") ?? "", /139, 92, 246/, "Informed uses the canonical purple RACI color");
    assert.equal(container.querySelector('[role="radiogroup"][aria-label="Node RACI role"]'), null, "Process view hides Node RACI controls");
    assert.equal(container.querySelector('button[aria-label="Group Nodes"]'), null, "Process view hides Node grouping controls");
    assert.equal(container.querySelector('[data-my-work-section="processes"] button[data-my-work-history-selected]'), null, "Processes has no History control");

    const separators = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="separator"]'));
    assert.deepEqual(separators.map((separator) => separator.getAttribute("aria-label")), [
      "Resize Action Items and work view columns",
      "Resize work view and Projects columns",
    ]);
    assert.deepEqual(separators.map((separator) => separator.getAttribute("aria-orientation")), ["vertical", "vertical"], "only the two column dividers remain");
    assert.equal(separators.every((separator) => separator.tabIndex === 0 && Boolean(separator.getAttribute("aria-controls"))), true);
    for (const separator of separators) {
      assert.match(separator.querySelector<HTMLElement>(".my-work-resizer__grip")?.style.background ?? "", /34, 211, 238/, "vertical resize marks start cyan on the neutral track");
      assert.match(separator.querySelector<HTMLElement>(".my-work-resizer__grip")?.style.background ?? "", /168, 85, 247/, "vertical resize marks finish purple");
    }
    assert.equal(container.querySelector('[data-my-work-left-column="true"]'), null, "the full-height Action Items column has no nested height split");
    assert.equal(container.querySelector('[data-my-work-resizer="horizontal"]'), null, "no horizontal split handle remains");

    const columns = container.querySelector<HTMLElement>('[data-my-work-columns="true"]');
    assert.ok(columns);
    setElementSize(columns, { clientWidth: 1200, scrollWidth: 1200 });
    const columnsBefore = columns.style.gridTemplateColumns;
    await act(async () => {
      separators[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.notEqual(columns.style.gridTemplateColumns, columnsBefore);
    assert.ok(dom.window.localStorage.getItem("mangorts.my-work.layout.v1:company-1"));

    const projectDivider = separators[1];
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

    const initialProcessScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    assert.ok(initialProcessScroll);
    initialProcessScroll.scrollTop = 137;
    await act(async () => {
      middleViewButtons[1]?.click();
      await Promise.resolve();
    });
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLElement>("[data-my-work-section]")).map((section) => section.dataset.myWorkSection),
      ["action_items", "nodes", "projects"],
      "switching selects Nodes as the only middle section",
    );
    const nodeViewButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-my-work-middle-view-toggle="true"] [role="radio"]'));
    const nodeViewIcons = Array.from(container.querySelectorAll<HTMLElement>('[data-my-work-middle-view-toggle="true"] [data-my-work-middle-view-icon]'));
    assert.deepEqual(nodeViewButtons.map((button) => button.getAttribute("aria-checked")), ["false", "true"]);
    assert.deepEqual(
      nodeViewButtons.map((button, index) => [button.style.height, button.style.fontSize, button.style.padding, nodeViewIcons[index]?.style.width, nodeViewIcons[index]?.style.height]),
      middleViewButtons.map((button, index) => [button.style.height, button.style.fontSize, button.style.padding, middleViewIcons[index]?.style.width, middleViewIcons[index]?.style.height]),
      "switching views never resizes either header-sized toggle choice",
    );
    assert.equal(nodeViewButtons[0]?.style.border, "1px solid transparent");
    assert.notEqual(nodeViewButtons[1]?.style.border, "1px solid transparent", "the selected Nodes option gains the visible border");
    assert.equal(container.querySelector('[role="radiogroup"][aria-label="Process RACI role"]'), null, "Nodes view hides Process RACI controls");
    assert.equal(container.querySelector('[data-my-work-target="process"] [data-my-work-process-status-counts="true"]'), null, "Processes content is not rendered behind Nodes");
    let nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    assert.ok(nodeSection);
    const initialNodeRoleGroup = nodeSection.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Node RACI role"]');
    const initialNodeRadios = Array.from(initialNodeRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.deepEqual(initialNodeRadios.map((button) => button.getAttribute("aria-label")), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(initialNodeRadios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"]);
    assert.deepEqual(initialNodeRadios.map((button) => [button.style.width, button.style.height]), Array.from({ length: 4 }, () => ["27px", "26px"]), "Nodes reuse the established RACI selector");
    assert.equal(initialNodeRoleGroup?.style.flex, "0 0 auto", "the Node RACI buttons cannot compress at the middle-column minimum");
    assert.equal(initialNodeRoleGroup?.nextElementSibling?.getAttribute("data-my-work-history-selected"), "false", "Node RACI is immediately left of History");
    assert.equal(nodeSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]')?.textContent?.trim(), "History");
    assert.equal(nodeSection.querySelector<HTMLButtonElement>('button[aria-label="Group Nodes"]')?.textContent, "", "Node grouping remains icon-only");
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Group"]')).map((button) => button.getAttribute("aria-label")),
      ["Group, order, and choose Action Item row fields", "Group Nodes"],
      "Nodes-only grouping controls appear with the Nodes view",
    );
    assert.equal(container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Node"]')?.value, "Due in three days");
    assert.equal(container.querySelectorAll('[data-my-work-due-date="true"] button[aria-haspopup="dialog"]').length, 4, "Action Item and active Node forms keep their calendar controls");
    const soonInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Node"]');
    const standardInput = container.querySelector<HTMLInputElement>('input[aria-label="Due Date for Context Hidden Node"]');
    assert.equal(soonInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "soon");
    assert.equal(standardInput?.closest<HTMLElement>('[data-my-work-due-date]')?.dataset.myWorkDueDateTone, "standard");
    assert.equal(soonInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#eab308", "two- and three-day calendars are yellow");
    assert.equal(standardInput?.parentElement?.querySelector("svg path")?.getAttribute("stroke"), "#8b5cf6", "ordinary and empty dates keep the purple calendar");
    assert.match(standardInput?.value ?? "", /^Due Date: /, "ordinary dates keep the label after the left-side calendar");
    assert.equal(standardInput?.parentElement?.style.width, "136px", "ordinary dates have enough room for a complete icon-first label");
    assert.equal(standardInput?.closest<HTMLElement>('[data-my-work-due-date]')?.style.width, "146px", "the complete ordinary due-date pill is measured inside its row");

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
    const nodeViewProjectScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="projects"]');
    assert.ok(actionScroll && nodeScroll && nodeViewProjectScroll);
    assert.equal(nodeScroll.scrollTop, 0, "Nodes starts at its own saved scroll position instead of inheriting Processes");
    assert.equal(container.querySelector('[data-my-work-scroll="processes"]'), null);
    for (const scrollBody of [actionScroll, nodeScroll, nodeViewProjectScroll]) {
      setScrollPosition(scrollBody, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 });
    }

    await act(async () => {
      actionScroll.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
      await Promise.resolve();
    });
    const actionLoadCall = calls.find((call) => new URL(call.path, "http://api.test").searchParams.get("cursor") === "actions-old-cursor");
    const actionLoadURL = new URL(actionLoadCall?.path ?? "", "http://api.test");
    assert.equal(actionLoadURL.searchParams.get("section"), "action_items");
    assert.equal(actionLoadURL.searchParams.get("grouping"), "color:asc,huddle_process:asc");
    assert.equal(actionLoadURL.searchParams.get("ordering"), "completion_due_date:asc");
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
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="processes"]')?.click();
      await Promise.resolve();
    });
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLElement>("[data-my-work-section]")).map((section) => section.dataset.myWorkSection),
      ["action_items", "processes", "projects"],
      "switching back restores Processes as the only middle section",
    );
    const processSection = container.querySelector<HTMLElement>('[data-my-work-section="processes"]');
    const processScroll = processSection?.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    const projectScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="projects"]');
    const processRoleGroup = processSection?.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Process RACI role"]');
    const radios = Array.from(processRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    assert.ok(processSection && processScroll && projectScroll && processRoleGroup);
    assert.equal(processScroll.scrollTop, 137, "Processes restores its own scroll position after a Nodes round trip");
    assert.deepEqual(radios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"], "the Process RACI state survives a Nodes round trip");
    assert.match(processSection.textContent ?? "", /Responsible Process/, "the loaded Process rows return after switching back");
    assert.equal(container.querySelector('[role="radiogroup"][aria-label="Node RACI role"]'), null);
    setScrollPosition(processScroll, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 });
    setScrollPosition(projectScroll, { scrollHeight: 1000, clientHeight: 300, scrollTop: 600 });
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

    const beforeGroupingCalls = calls.filter((call) => call.path.startsWith("/v1/my-work?")).length;
    await act(async () => groupButtons[0]?.click());
    const actionGroupingDialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Action Item view"]');
    assert.equal(actionGroupingDialog?.parentElement, dom.window.document.body, "the grouping dialog is portaled above the clipped section");
    assert.equal(actionGroupingDialog?.style.position, "fixed");
    assert.equal(actionGroupingDialog?.style.borderRadius, "14px", "the grouping dialog uses the raised surface treatment");
    assert.match(actionGroupingDialog?.style.boxShadow ?? "", /14px 16px 38px/);
    assert.equal(actionGroupingDialog?.firstElementChild?.nextElementSibling?.getAttribute("style")?.includes('grid-template-areas: "group mine" "order delegated"'), true, "the combined popover is a fixed two-by-two quadrant grid");
    assert.deepEqual(
      Array.from(actionGroupingDialog?.querySelectorAll<HTMLElement>('[data-action-item-view-quadrant]') ?? []).map((quadrant) => quadrant.dataset.actionItemViewQuadrant),
      ["group", "order", "mine", "delegated"],
      "the four quadrants are Group, Order, Mine fields, and Delegated fields",
    );
    assert.ok(actionGroupingDialog?.querySelector('[data-my-work-action-item-ordering="true"]'), "one popover contains a separate Order items by section");
    assert.match(actionGroupingDialog?.querySelector<HTMLSelectElement>('select[aria-label="Add grouping level"]')?.style.border ?? "", /234, 132, 229|#ea84e5/i, "Action Item grouping controls use the pink accent");
    const firstGroupingRow = actionGroupingDialog?.querySelector<HTMLSelectElement>('select[aria-label="Grouping level 1 field"]')?.parentElement?.parentElement;
    assert.equal(firstGroupingRow?.style.borderRadius, "10px", "grouping rows and their level tags are raised surfaces");
    const directionButton = actionGroupingDialog?.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for grouping level 1"]');
    assert.ok(directionButton);
    await act(async () => {
      directionButton.click();
      await Promise.resolve();
    });
    assert.equal(calls.filter((call) => call.path.startsWith("/v1/my-work?")).length, beforeGroupingCalls + 1);
    const actionGroupingCall = calls.filter((call) => call.path.startsWith("/v1/my-work?")).at(-1);
    const actionGroupingURL = new URL(actionGroupingCall?.path ?? "", "http://api.test");
    assert.equal(actionGroupingURL.searchParams.get("section"), "action_items");
    assert.equal(actionGroupingURL.searchParams.get("grouping"), "color:desc,huddle_process:asc");
    assert.equal(actionGroupingURL.searchParams.get("ordering"), "completion_due_date:asc");
    const actionSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    assert.doesNotMatch(actionSection?.textContent ?? "", /Red Action|Yellow Action/, "regrouping clears the old rows immediately");
    assert.doesNotMatch(actionSection?.textContent ?? "", /\bPrevious\b|\bNext\b|Page \d/, "My Work never exposes page controls");
    await act(async () => {
      resolveActionGrouping?.(response({
        nodes: undefined,
        processes: undefined,
        projects: undefined,
        action_items: { items: [{ entity_id: "action-red", name: "Regrouped Red Action", color: "red", completion_due_date_field_id: "field-red", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One" }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.match(actionSection?.textContent ?? "", /Regrouped Red Action/, "regrouping may return an ID from the replaced section with fresh presentation data");
    await act(async () => groupButtons[0]?.click());

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="nodes"]')?.click();
      await Promise.resolve();
    });
    nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    assert.ok(nodeSection);
    assert.equal(container.querySelector('[data-my-work-section="processes"]'), null, "Processes stays unmounted while Node controls are used");
    const beforeNodeGroupingCalls = calls.filter((call) => call.path.startsWith("/v1/my-work?")).length;
    await act(async () => nodeSection?.querySelector<HTMLButtonElement>('button[aria-label="Group Nodes"]')?.click());
    const nodeGroupingDialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Node grouping"]');
    const removeNodeDueDate = nodeGroupingDialog?.querySelector<HTMLButtonElement>('button[aria-label="Remove grouping level 2"]');
    assert.ok(removeNodeDueDate);
    await act(async () => {
      removeNodeDueDate.click();
      await Promise.resolve();
    });
    assert.equal(calls.filter((call) => call.path.startsWith("/v1/my-work?")).length, beforeNodeGroupingCalls + 1);
    const nodeGroupingURL = new URL(calls.filter((call) => call.path.startsWith("/v1/my-work?")).at(-1)?.path ?? "", "http://api.test");
    assert.equal(nodeGroupingURL.searchParams.get("section"), "nodes");
    assert.equal(nodeGroupingURL.searchParams.get("grouping"), "priority:asc");
    assert.equal(nodeGroupingURL.searchParams.has("cursor"), false);
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
    assert.equal(delegatedURL.searchParams.get("grouping"), "color:asc,person_in_charge:asc,huddle_process:asc", "Delegated loads Color, Person in charge, then Huddle process");
    assert.equal(delegatedURL.searchParams.get("ordering"), "completion_due_date:asc", "Delegated orders leaf items by Completion due date");
    assert.match(actionSection?.textContent ?? "", /Delegated Action/);
    assert.match(actionSection?.textContent ?? "", /Alex Morgan/, "Delegated shows the Person in charge inline");
    const delegatedPersonLabel = actionSection?.querySelector<HTMLElement>('[data-my-work-person-in-charge="true"]');
    assert.ok(delegatedPersonLabel?.querySelector('[data-my-work-person-in-charge-icon="true"] svg'), "the Person in charge label shows a person icon");
    assert.equal(
      delegatedPersonLabel?.closest('[data-my-work-action-item-inline-field-slot]')?.nextElementSibling
        ?.querySelector('[data-my-work-due-date="true"]')?.getAttribute("data-my-work-due-date"),
      "true",
      "the Person in charge label sits immediately left of the due date",
    );
    assert.ok(actionSection?.querySelector('[data-my-work-group-field="person_in_charge"]'), "Person in charge renders as Delegated grouping level two");
    assert.equal(actionSection?.querySelector('[data-my-work-entry-kind="row"]')?.getAttribute("style")?.includes("padding-left: 76px"), true, "Delegated rows sit beneath the visible three-level hierarchy");
    assert.equal(perspectiveRadios[1]?.getAttribute("aria-checked"), "true");
    assert.equal(dom.window.document.activeElement, perspectiveRadios[1]);

    await act(async () => groupButtons[0]?.click());
    const delegatedGroupingDialog = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Action Item view"]');
    const personDirectionButton = delegatedGroupingDialog?.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for item ordering 1"]');
    assert.ok(personDirectionButton, "Delegated exposes an independent Asc/Desc leaf-order control for Completion due date");
    await act(async () => {
      personDirectionButton.click();
      await Promise.resolve();
    });
    const personDirectionURL = new URL(calls.filter((call) => call.path.startsWith("/v1/my-work?")).at(-1)?.path ?? "", "http://api.test");
    assert.equal(personDirectionURL.searchParams.get("grouping"), "color:asc,person_in_charge:asc,huddle_process:asc");
    assert.equal(personDirectionURL.searchParams.get("ordering"), "completion_due_date:desc");

    await act(async () => {
      perspectiveRadios[0]?.click();
      await Promise.resolve();
    });
    const mineURL = new URL(calls.filter((call) => call.path.startsWith("/v1/my-work?")).at(-1)?.path ?? "", "http://api.test");
    assert.equal(mineURL.searchParams.get("perspective"), "mine");
    assert.equal(mineURL.searchParams.get("grouping"), "color:desc,huddle_process:asc", "Mine restores its independent two-level grouping stack");
    assert.equal(mineURL.searchParams.get("ordering"), "completion_due_date:asc");
    await act(async () => {
      resolveActionGrouping?.(response({ nodes: undefined, processes: undefined, projects: undefined }));
      await Promise.resolve();
    });
    assert.equal(actionSection?.querySelector('[data-my-work-person-in-charge="true"]'), null, "Mine does not show the delegated person label");

    const currentNodeRoleGroup = nodeSection?.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Node RACI role"]');
    const currentNodeRadios = Array.from(currentNodeRoleGroup?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? []);
    await act(async () => {
      currentNodeRadios[0]?.focus();
      currentNodeRadios[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await Promise.resolve();
    });
    const accountableNodeURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(accountableNodeURL.searchParams.get("section"), "nodes");
    assert.equal(accountableNodeURL.searchParams.get("role"), "accountable");
    assert.equal(accountableNodeURL.searchParams.get("grouping"), "priority:asc", "Node role preserves the grouping stack");
    assert.match(nodeSection?.textContent ?? "", /Accountable Node/);
    assert.equal(currentNodeRadios[1]?.getAttribute("aria-checked"), "true");
    assert.doesNotMatch(container.textContent ?? "", /Consulted Process/, "the inactive Process rows are never shown beside Nodes");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="processes"]')?.click();
      await Promise.resolve();
    });
    const restoredProcessSection = container.querySelector<HTMLElement>('[data-my-work-section="processes"]');
    const restoredProcessRoleGroup = restoredProcessSection?.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Process RACI role"]');
    assert.match(restoredProcessSection?.textContent ?? "", /Consulted Process/, "switching back restores the last Process rows");
    assert.equal(restoredProcessRoleGroup?.querySelector<HTMLButtonElement>('[aria-label="Consulted"]')?.getAttribute("aria-checked"), "true", "switching back restores the selected Process RACI role");
    assert.equal(container.querySelector('[role="radiogroup"][aria-label="Node RACI role"]'), null);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

test("My Work loads and persists independent Mine and Delegated row-field orders", async () => {
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
    const savedWrites: Array<Record<string, unknown>> = [];
    const item = {
      entity_id: "action-fields",
      name: "Field Order Action",
      color: "red",
      completion_due_date: "2026-09-01",
      completion_due_date_field_id: "field-due",
      person_in_charge_user_id: "person-1",
      person_in_charge_name: "Person One",
      assigned_by_user_id: "assigner-1",
      assigned_by_name: "Assignor One",
      created_timestamp: "2026-08-20T10:00:00Z",
      source: { resource_type: "huddle_node", resource_id: "node-1", name: "Source Node", parent_resource_id: "huddle-1" },
      huddle_process: { huddle_logic_gate_id: "huddle-1", name: "Weekly Huddle" },
      status: "in_progress",
    };
    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const url = new URL(path, "http://api.test");
      if (url.pathname === "/v1/saved-views" && init?.method !== "PUT") {
        const surface = url.searchParams.get("surface");
        const delegated = surface === "my_work_action_items_delegated";
        return Promise.resolve({
          saved_views: [{
            company_id: "company-1",
            saved_view_id: delegated ? "delegated-view" : "mine-view",
            surface,
            principal: "user",
            principal_id: "viewer-1",
            name: delegated ? "My Work Delegated" : "My Work Mine",
            groupings: [
              { field: "color", direction: "asc" },
              { field: "huddle_process", direction: "asc" },
              { field: "completion_due_date", direction: "asc" },
            ],
            settings: {
              ordering: delegated ? [{ field: "person_in_charge", direction: "asc" }] : [],
              displayed_fields: delegated
                ? ["huddle_process", "person_in_charge"]
                : ["source", "assigned_by"],
            },
            position: 1000,
          }],
        } as T);
      }
      if (url.pathname.startsWith("/v1/saved-views/") && init?.method === "PUT") {
        savedWrites.push(init.json as Record<string, unknown>);
        return Promise.resolve(init.json as T);
      }
      const perspective = url.searchParams.get("perspective") === "delegated" ? "delegated" : "mine";
      const actionPage = { perspective, items: [item], has_more: false };
      if (url.searchParams.get("section") === "action_items") {
        return Promise.resolve(response({
          action_items: actionPage,
          nodes: undefined,
          processes: undefined,
          projects: undefined,
        }) as T);
      }
      return Promise.resolve(response({
        action_items: actionPage,
        nodes: { items: [], has_more: false },
        processes: { role: "responsible", items: [], has_more: false },
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
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const actionSection = container.querySelector<HTMLElement>('[data-my-work-section="action_items"]');
    assert.ok(actionSection);
    const visibleFieldIDs = () => Array.from(actionSection.querySelectorAll<HTMLElement>(
      '[data-my-work-row="action-item"] [data-my-work-action-item-field]',
    )).map((field) => field.dataset.myWorkActionItemField);
    assert.deepEqual(visibleFieldIDs(), ["source", "assigned_by"], "Mine uses its saved left-to-right field order");
    const inlineRail = actionSection.querySelector<HTMLElement>('[data-my-work-action-item-inline-fields="true"]');
    assert.equal(inlineRail?.style.flexWrap, "nowrap", "row labels never stack vertically");
    assert.equal(inlineRail?.style.justifyContent, "flex-start", "overflow starts with the first saved label while the complete rail stays right-aligned");
    assert.equal(inlineRail?.tabIndex, 0, "a multi-label rail can receive keyboard focus for horizontal scrolling");
    assert.equal(inlineRail?.style.overflowX, "auto", "too many selected labels stay on one horizontal rail");
    assert.equal(inlineRail?.style.marginLeft, "auto", "the inline label rail stays against the right edge");
    assert.equal(inlineRail?.style.flex, "0 1 auto", "the rail keeps its natural width unless the complete field list is too wide");
    assert.equal(inlineRail?.style.maxWidth, "62%", "oversized label lists leave usable room for the Action Item title");
    const actionItemRow = inlineRail?.closest<HTMLElement>('[data-my-work-row="action-item"]');
    assert.equal(actionItemRow?.style.display, "flex", "the row measures the rail cap against the whole row instead of its own grid slot");
    assert.equal(actionItemRow?.querySelector<HTMLElement>('[data-my-work-target="action-item"]')?.style.flex, "1 1 0%", "the title yields only the space that the right-pinned labels need");
    const settingsButton = actionSection.querySelector<HTMLButtonElement>('button[aria-label="Group, order, and choose Action Item row fields"]');
    assert.equal(actionSection.querySelector('[data-my-work-action-item-field-settings="true"]'), null, "row-field settings live only in the grouper");

    const delegatedButton = Array.from(actionSection.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((button) => button.textContent === "Delegated");
    await act(async () => {
      delegatedButton?.click();
      await Promise.resolve();
    });
    assert.deepEqual(visibleFieldIDs(), ["huddle_process", "person_in_charge"], "Delegated uses its own saved field order");

    await act(async () => settingsButton?.click());
    assert.ok(dom.window.document.querySelector('[role="dialog"][aria-label="Action Item view"] [data-action-item-view-quadrant="mine"]'));
    assert.ok(dom.window.document.querySelector('[role="dialog"][aria-label="Action Item view"] [data-action-item-view-quadrant="delegated"]'));
    const huddleField = dom.window.document.querySelector<HTMLElement>(
      '[data-action-item-inline-field-perspective="delegated"]'
        + '[data-action-item-inline-field-location="tray"]'
        + '[data-action-item-inline-field-id="huddle_process"]',
    );
    const insertion = dom.window.document.querySelector<HTMLElement>(
      '[data-action-item-inline-field-insertion-perspective="delegated"]'
        + '[data-action-item-inline-field-insertion-index="2"]',
    );
    assert.ok(huddleField && insertion);
    await dragMyWorkField(huddleField, insertion);
    await act(async () => { await Promise.resolve(); });
    assert.deepEqual(visibleFieldIDs(), ["person_in_charge", "huddle_process"], "dragging the settings tray updates row placement immediately");
    const delegatedWrite = savedWrites.at(-1);
    assert.equal(delegatedWrite?.surface, "my_work_action_items_delegated");
    assert.deepEqual((delegatedWrite?.settings as { displayed_fields?: string[] }).displayed_fields, ["person_in_charge", "huddle_process"]);
    assert.deepEqual((delegatedWrite?.settings as { ordering?: unknown[] }).ordering, [{ field: "person_in_charge", direction: "asc" }]);
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
    const [{ createRoot }, { MyWorkContent }, { EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION }] = await Promise.all([
      import("react-dom/client"),
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
        person_in_charge_user_id: "viewer-1",
        person_in_charge_name: "Viewer One",
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
      if (url.pathname === "/v1/saved-views") return { saved_views: [] } as T;
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
            { entity_id: "action-new", name: "Newest completed Action", completion_due_date_field_id: "field-new", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One", completed_timestamp: "2026-08-29T12:00:00Z" },
            { entity_id: "action-old", name: "Older completed Action", completion_due_date_field_id: "field-old", person_in_charge_user_id: "viewer-1", person_in_charge_name: "Viewer One", completed_timestamp: "2026-08-28T12:00:00Z" },
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
    assert.ok(actionSection);
    assert.equal(container.querySelector('[data-my-work-section="nodes"]'), null, "History starts in the default Processes view");
    const actionHistory = actionSection.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]');
    assert.ok(actionHistory);
    await act(async () => {
      actionHistory.click();
      await Promise.resolve();
    });
    assert.equal(actionHistory.getAttribute("aria-pressed"), "true");
    assert.equal(actionSection.querySelector<HTMLButtonElement>('button[aria-label="Group, order, and choose Action Item row fields"]')?.disabled, true);
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
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="nodes"]')?.click();
      await Promise.resolve();
    });
    const nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    const nodeHistoryButton = nodeSection?.querySelector<HTMLButtonElement>('button[data-my-work-history-selected]');
    assert.ok(nodeSection && nodeHistoryButton, "Nodes is active before its History behavior is exercised");
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
    const requestJSON = <T,>(path: string, _init?: RequestInit): Promise<T> => {
      const url = new URL(path, "http://api.test");
      if (url.pathname === "/v1/saved-views") return Promise.resolve({ saved_views: [] } as T);
      if (url.searchParams.get("section") === "action_items") {
        return Promise.resolve(response({
          action_items: { items: [], has_more: false },
          nodes: undefined,
          processes: undefined,
          projects: undefined,
        }) as T);
      }
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
    const firstSubjectProcessScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    assert.ok(firstSubjectProcessScroll);
    firstSubjectProcessScroll.scrollTop = 245;

    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" subjectID="viewer-2" requestJSON={requestJSON} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(initialRequests, 2);
    assert.doesNotMatch(container.textContent ?? "", /First Subject Process/);
    assert.match(container.textContent ?? "", /Second Subject Process/, "a new subject may return the same ID with fresh presentation data");
    const secondSubjectProcessScroll = container.querySelector<HTMLElement>('[data-my-work-scroll="processes"]');
    assert.equal(secondSubjectProcessScroll?.scrollTop, 0, "a new subject resets the already-selected Processes scroll position");

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="nodes"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-middle-view="processes"]')?.click();
      await Promise.resolve();
    });
    assert.equal(
      container.querySelector<HTMLElement>('[data-my-work-scroll="processes"]')?.scrollTop,
      0,
      "the reset Processes offset remains zero after a middle-view round trip",
    );
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

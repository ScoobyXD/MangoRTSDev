import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { MyWorkResponse } from "../../../../frontend/src/modules/my-work/myWorkApi.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function response(overrides: Partial<MyWorkResponse> = {}): MyWorkResponse {
  return {
    company_id: "company-1",
    user_id: "viewer-1",
    action_items: {
      items: [
        { entity_id: "action-red", name: "Red Action", color: "red", completion_due_date: "2026-09-01" },
        { entity_id: "action-yellow", name: "Yellow Action", color: "yellow", completion_due_date: "2026-09-02" },
      ],
      next_cursor: "actions-old-cursor",
      has_more: true,
    },
    nodes: {
      items: [
        {
          node_id: "node-context",
          name: "Context Node",
          priority: 1,
          due_date: "2026-09-03",
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
      items: [{ logic_gate_id: "process-responsible", name: "Responsible Process" }],
      has_more: false,
    },
    projects: {
      items: [{ project_id: "project-team", name: "Team Project" }],
      has_more: false,
    },
    ...overrides,
  };
}

test("My Work keeps sections isolated, removes stale role rows, and opens exact independent targets", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/my-work",
  });
  const restores: Restore[] = [];
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

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { MyWorkContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/my-work/MyWorkContent.tsx"),
    ]);
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const pendingRoles = new Map<string, (value: MyWorkResponse) => void>();
    let resolveActionGrouping: ((value: MyWorkResponse) => void) | undefined;
    const requestJSON = <T,>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      const url = new URL(path, "http://api.test");
      const section = url.searchParams.get("section");
      if (!section) return Promise.resolve(response() as T);
      if (section === "action_items" && url.searchParams.has("grouping")) {
        return new Promise<T>((resolve) => {
          resolveActionGrouping = (value) => resolve(value as T);
        });
      }
      if (section === "processes") {
        const role = url.searchParams.get("role") ?? "responsible";
        return new Promise<T>((resolve) => {
          pendingRoles.set(role, (value) => resolve(value as T));
        });
      }
      if (section === "nodes" && url.searchParams.get("cursor")) {
        return Promise.resolve(response({
          action_items: undefined,
          processes: undefined,
          projects: undefined,
          nodes: { items: [{ node_id: "node-page-2", name: "Second Page Node" }], has_more: false },
        }) as T);
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
    await act(async () => {
      root.render(<MyWorkContent companyID="company-1" requestJSON={requestJSON} />);
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

    const radios = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    assert.deepEqual(radios.map((button) => button.getAttribute("aria-label")), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(radios.map((button) => button.getAttribute("aria-checked")), ["true", "false", "false", "false"]);
    assert.deepEqual(radios.map((button) => button.tabIndex), [0, -1, -1, -1]);

    const nodeRows = Array.from(container.querySelectorAll<HTMLElement>('[data-my-work-row="node"]'));
    assert.equal(nodeRows.length, 2);
    assert.equal(nodeRows[0]?.querySelector("button button"), null, "inline context targets are siblings, never nested buttons");
    assert.deepEqual(
      Array.from(nodeRows[0]?.querySelectorAll<HTMLButtonElement>("button") ?? []).map((button) => button.dataset.myWorkTarget),
      ["node", "process", "project"],
    );
    assert.deepEqual(
      Array.from(nodeRows[1]?.querySelectorAll<HTMLButtonElement>("button") ?? []).map((button) => button.dataset.myWorkTarget),
      ["node"],
      "a Node with hidden inline context exposes no context placeholder or target",
    );

    let actionItemOpened = "";
    dom.window.addEventListener("mangorts:editor-entity-reference-open", ((event: CustomEvent) => {
      actionItemOpened = event.detail?.entity?.entityID ?? "";
    }) as EventListener, { once: true });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-my-work-target="action-item"]')?.click();
    });
    assert.equal(actionItemOpened, "action-red");

    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="node"]')?.click());
    assert.equal(dom.window.location.pathname, "/nodes/node-context");
    dom.window.history.replaceState({}, "", "/my-work");
    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="process"]')?.click());
    assert.equal(dom.window.location.pathname, "/logic-gates/process-inline");
    dom.window.history.replaceState({}, "", "/my-work");
    await act(async () => nodeRows[0]?.querySelector<HTMLButtonElement>('[data-my-work-target="project"]')?.click());
    assert.equal(dom.window.location.pathname, "/projects/project-inline");
    dom.window.history.replaceState({}, "", "/my-work");

    await act(async () => {
      radios[0]?.focus();
      radios[0]?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    assert.equal(container.querySelector<HTMLButtonElement>('[aria-label="Accountable"]')?.getAttribute("aria-checked"), "true");
    assert.equal(dom.window.document.activeElement?.getAttribute("aria-label"), "Accountable");
    assert.deepEqual(
      Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).map((button) => button.tabIndex),
      [-1, 0, -1, -1],
      "the radio group keeps exactly one keyboard tab stop",
    );
    assert.doesNotMatch(container.textContent ?? "", /Responsible Process/, "the previous role is cleared before the new role returns");
    const accountableCall = calls.at(-1);
    assert.equal(new URL(accountableCall?.path ?? "", "http://api.test").searchParams.get("section"), "processes");
    assert.equal(new URL(accountableCall?.path ?? "", "http://api.test").searchParams.get("role"), "accountable");

    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Consulted"]')?.click());
    assert.equal(accountableCall?.init?.signal?.aborted, true, "a later role request cancels the stale role request");
    await act(async () => {
      pendingRoles.get("accountable")?.(response({
        action_items: undefined,
        nodes: undefined,
        projects: undefined,
        processes: { role: "accountable", items: [{ logic_gate_id: "stale", name: "Stale Accountable" }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.doesNotMatch(container.textContent ?? "", /Stale Accountable/);
    await act(async () => {
      pendingRoles.get("consulted")?.(response({
        action_items: undefined,
        nodes: undefined,
        projects: undefined,
        processes: { role: "consulted", items: [{ logic_gate_id: "consulted", name: "Consulted Process" }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Consulted Process/);

    const beforeGroupingCalls = calls.length;
    await act(async () => groupButtons[0]?.click());
    const directionButton = container.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for grouping level 1"]');
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
    const actionNextWhileRegrouping = Array.from(actionSection?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.trim() === "Next");
    assert.equal(actionNextWhileRegrouping?.disabled, true, "the old cursor cannot be used with the new grouping while regrouping");
    await act(async () => {
      resolveActionGrouping?.(response({
        nodes: undefined,
        processes: undefined,
        projects: undefined,
        action_items: { items: [{ entity_id: "action-regrouped", name: "Regrouped Action", color: "red" }], has_more: false },
      }));
      await Promise.resolve();
    });
    assert.match(actionSection?.textContent ?? "", /Regrouped Action/);

    const beforeNodeGroupingCalls = calls.length;
    await act(async () => groupButtons[1]?.click());
    const nodeGroupingDialog = container.querySelector<HTMLElement>('[role="dialog"][aria-label="Node grouping"]');
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

    const beforePagingCalls = calls.length;
    const nodeSection = container.querySelector<HTMLElement>('[data-my-work-section="nodes"]');
    const nextButton = Array.from(nodeSection?.querySelectorAll<HTMLButtonElement>("button") ?? [])
      .find((button) => button.textContent?.trim() === "Next");
    assert.ok(nextButton);
    await act(async () => {
      nextButton.click();
      await Promise.resolve();
    });
    assert.equal(calls.length, beforePagingCalls + 1);
    const pageURL = new URL(calls.at(-1)?.path ?? "", "http://api.test");
    assert.equal(pageURL.searchParams.get("section"), "nodes");
    assert.equal(pageURL.searchParams.get("cursor"), "nodes-page-2");
    assert.equal(pageURL.searchParams.get("grouping"), "priority:asc", "cursor requests retain the exact active grouping stack");
    assert.match(nodeSection?.textContent ?? "", /Second Page Node/);
    assert.doesNotMatch(container.querySelector('[data-my-work-section="action_items"]')?.textContent ?? "", /Second Page Node/);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

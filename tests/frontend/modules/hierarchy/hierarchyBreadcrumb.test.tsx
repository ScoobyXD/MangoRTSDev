import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import {
  emitDashboardEvent,
  emitExplorerContextUpdated,
  EVENT_COMPANY_EXPLORER_FIND_REQUESTED,
  EVENT_HUDDLE_EXPLORER_FIND_REQUESTED,
} from "../../../../frontend/src/modules/dashboardEvents.js";
import { HierarchyBreadcrumb } from "../../../../frontend/src/modules/hierarchy/HierarchyBreadcrumb.js";
import { hierarchyPathRequestPath } from "../../../../frontend/src/modules/hierarchy/hierarchyPathApi.js";
import { HuddleExplorerSection } from "../../../../frontend/src/modules/huddles/HuddleExplorerSection.js";
import { useExplorerSearchQuery } from "../../../../frontend/src/modules/hierarchy/useExplorerSearchQuery.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("hierarchy path requests use the exact typed Company and Huddle endpoints", () => {
  assert.equal(hierarchyPathRequestPath({
    companyID: "company one",
    kind: "company_explorer",
    resourceType: "node",
    resourceID: "node/one",
  }), "/v1/company-explorer/location-path?company_id=company+one&resource_type=node&resource_id=node%2Fone");
  assert.equal(hierarchyPathRequestPath({
    companyID: "company-huddle",
    kind: "huddle_explorer",
    resourceType: "huddle_node",
    resourceID: "huddle-node-1",
  }), "/v1/huddle-explorer/location-path?company_id=company-huddle&resource_type=huddle_node&resource_id=huddle-node-1");
});

test("breadcrumb fetches on mount, exposes the full accessible path, and uses existing navigation events", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/nodes/current-node",
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "Event", "EventTarget", "MouseEvent", "CustomEvent", "PopStateEvent",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const originalFetch = globalThis.fetch;
  const requestedURLs: string[] = [];
  const requestedCacheModes: Array<RequestCache | undefined> = [];
  globalThis.fetch = (async (input, init) => {
    requestedURLs.push(input.toString());
    requestedCacheModes.push(init?.cache);
    const resourceID = new URL(input.toString()).searchParams.get("resource_id");
    return new Response(JSON.stringify(resourceID === "hidden-node" ? {
      kind: "company_explorer",
      status: "omitted",
      segments: [],
    } : {
      kind: "company_explorer",
      status: "resolved",
      segments: [
        { entity_type: "folder", entity_id: "folder-a", name: "Operations" },
        { entity_type: "folder", entity_id: "folder-b", name: "Fulfillment" },
        { entity_type: "logic_gate", entity_id: "gate-entity", resource_id: "gate-1", name: "Order Intake" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<HierarchyBreadcrumb apiBase="https://api.test" companyID="company-1" kind="company_explorer" resourceType="node" resourceID="current-node" />);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(requestedURLs.length, 1, "mount performs one uncached path read");
    assert.equal(requestedURLs[0], "https://api.test/v1/company-explorer/location-path?company_id=company-1&resource_type=node&resource_id=current-node");
    assert.deepEqual(requestedCacheModes, ["no-store"]);

    const nav = container.querySelector<HTMLElement>('nav[data-hierarchy-path="company_explorer"]');
    assert.ok(nav);
    assert.equal(nav.getAttribute("aria-label"), "Hierarchy path: Workspace / Operations / Fulfillment / Order Intake");
    assert.equal(nav.title, "Workspace / Operations / Fulfillment / Order Intake");
    assert.equal(nav.textContent?.includes("current-node"), false, "the current title/id is not a breadcrumb segment");
    assert.equal(nav.querySelectorAll('span[aria-hidden="true"]').length, 3);

    let findDetail: Record<string, unknown> | null = null;
    dom.window.addEventListener(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, (event) => {
      findDetail = (event as CustomEvent<Record<string, unknown>>).detail;
    });
    const buttons = nav.querySelectorAll<HTMLButtonElement>("button");
    assert.equal(buttons.length, 4);
    buttons[0]?.click();
    assert.equal(findDetail?.selectRoot, true);
    buttons[2]?.click();
    assert.deepEqual(findDetail?.folderPathIDs, ["folder-a", "folder-b"]);

    buttons[3]?.click();
    assert.equal(dom.window.location.pathname, "/logic-gates/gate-1", "resource segments use the existing resource route");

    let beforeNavigateCalls = 0;
    await act(async () => {
      root.render(
        <HierarchyBreadcrumb
          apiBase="https://api.test"
          companyID="company-1"
          kind="company_explorer"
          resourceType="node"
          resourceID="current-node"
          onBeforeNavigate={() => { beforeNavigateCalls += 1; }}
        />,
      );
    });
    findDetail = null;
    container.querySelectorAll<HTMLButtonElement>("button")[1]?.click();
    assert.equal(beforeNavigateCalls, 1);
    assert.equal(findDetail, null, "focus-trapped owners close before Explorer navigation is dispatched");
    await act(async () => {
      await new Promise<void>((resolvePromise) => dom.window.requestAnimationFrame(() => resolvePromise()));
    });
    assert.deepEqual(findDetail?.folderPathIDs, ["folder-a"]);

    await act(async () => {
      emitExplorerContextUpdated({ companyID: "company-1", kind: "company_explorer" });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(requestedURLs.length, 2, "a committed hierarchy mutation refetches the mounted path");

    await act(async () => {
      root.render(<HierarchyBreadcrumb apiBase="https://api.test" companyID="company-1" kind="company_explorer" resourceType="node" resourceID="hidden-node" />);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(container.querySelector("nav[data-hierarchy-path]"), null, "omitted ancestry renders no partial breadcrumb");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("Huddle breadcrumb root, folder, and owner Huddle Board are clickable", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  for (const name of ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement", "Event", "EventTarget", "MouseEvent", "CustomEvent"] as const) {
    const value = name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    kind: "huddle_explorer",
    status: "resolved",
    segments: [
      { entity_type: "huddle_explorer_folder", entity_id: "huddle-folder", name: "Daily" },
      { entity_type: "huddle_logic_gate", entity_id: "huddle-gate", resource_id: "huddle-gate", name: "Standup" },
    ],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<HierarchyBreadcrumb apiBase="https://api.test" companyID="company-1" kind="huddle_explorer" resourceType="huddle_node" resourceID="huddle-node" />);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    let revealDetail: Record<string, unknown> | null = null;
    let openDetail: Record<string, unknown> | null = null;
    dom.window.addEventListener(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, (event) => { revealDetail = (event as CustomEvent<Record<string, unknown>>).detail; });
    dom.window.addEventListener("mangorts:huddle-open", (event) => { openDetail = (event as CustomEvent<Record<string, unknown>>).detail; });
    const buttons = container.querySelectorAll<HTMLButtonElement>("button");
    assert.equal(buttons.length, 3);
    buttons[0]?.click();
    assert.equal(revealDetail?.selectRoot, true);
    buttons[1]?.click();
    assert.deepEqual(revealDetail?.folderPathIDs, ["huddle-folder"]);
    buttons[2]?.click();
    assert.deepEqual(openDetail, { resourceType: "huddle_logic_gate", resourceID: "huddle-gate", name: "Standup" });
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("Huddle folder reveal survives an in-flight tree load and focuses after the modal can close", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "Event", "EventTarget", "MouseEvent", "CustomEvent",
  ] as const) {
    const value = name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const scrollDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  restores.push(() => {
    if (scrollDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  const originalFetch = globalThis.fetch;
  let resolveTree: ((response: Response) => void) | null = null;
  globalThis.fetch = (async () => new Promise<Response>((resolveResponse) => { resolveTree = resolveResponse; })) as typeof fetch;
  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  try {
    act(() => {
      root.render(<HuddleExplorerSection apiBase="https://api.test" companyID="company-1" currentUserID="user-1" />);
    });
    await act(async () => {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.ok(resolveTree, "the Huddle tree read started");

    act(() => {
      emitDashboardEvent(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, {
        companyID: "company-1",
        folderPathIDs: ["folder-a"],
      });
    });
    assert.equal(container.querySelector('[data-huddle-folder-id="folder-a"]'), null);

    await act(async () => {
      resolveTree?.(new Response(JSON.stringify({
        folders: [{ company_id: "company-1", folder_id: "folder-a", parent_folder_id: null, name: "Daily" }],
        items: [],
      }), { status: 200, headers: { "content-type": "application/json" } }));
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    await act(async () => {
      await new Promise<void>((resolvePromise) => dom.window.requestAnimationFrame(() => resolvePromise()));
    });
    const folderButton = container.querySelector<HTMLButtonElement>('[data-huddle-folder-id="folder-a"]');
    assert.ok(folderButton);
    assert.equal(folderButton.getAttribute("aria-current"), "location");
    assert.equal(dom.window.document.activeElement, folderButton);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("matching Huddle breadcrumb navigation clears active Explorer search without losing the reveal", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "Event", "EventTarget", "MouseEvent", "CustomEvent",
  ] as const) {
    const value = name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const scrollDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  restores.push(() => {
    if (scrollDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    folders: [{ company_id: "company-1", folder_id: "folder-a", parent_folder_id: null, name: "Daily" }],
    items: [],
  }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;

  const SearchHarness: React.FC = () => {
    const [query, setQuery] = useExplorerSearchQuery("company-1");
    const active = query.trim().length > 0;
    return (
      <>
        <button type="button" data-start-search="true" onClick={() => setQuery("daily")}>Search</button>
        <span data-search-query="true">{query}</span>
        <div data-huddle-host="true" hidden={active}>
          <HuddleExplorerSection apiBase="https://api.test" companyID="company-1" currentUserID="user-1" />
        </div>
      </>
    );
  };

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<SearchHarness />);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    const host = container.querySelector<HTMLElement>('[data-huddle-host="true"]');
    assert.ok(host);
    act(() => container.querySelector<HTMLButtonElement>('[data-start-search="true"]')?.click());
    assert.equal(host.hidden, true);

    act(() => {
      emitDashboardEvent(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, { companyID: "company-2", folderPathIDs: ["folder-a"] });
    });
    assert.equal(host.hidden, true, "another company's reveal does not clear this search");

    act(() => {
      emitDashboardEvent(EVENT_HUDDLE_EXPLORER_FIND_REQUESTED, { companyID: "company-1", folderPathIDs: ["folder-a"] });
    });
    await act(async () => {
      await new Promise<void>((resolvePromise) => dom.window.requestAnimationFrame(() => resolvePromise()));
    });
    assert.equal(container.querySelector('[data-search-query="true"]')?.textContent, "");
    assert.equal(host.hidden, false);
    const folderButton = container.querySelector<HTMLButtonElement>('[data-huddle-folder-id="folder-a"]');
    assert.ok(folderButton);
    assert.equal(folderButton.getAttribute("aria-current"), "location");
    assert.equal(dom.window.document.activeElement, folderButton);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("Huddle Boards tree uses context menus and canonical root/folder reparent commands", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "Event", "EventTarget", "MouseEvent", "KeyboardEvent", "CustomEvent",
  ] as const) {
    const value = name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const scrollDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  restores.push(() => {
    if (scrollDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", scrollDescriptor);
    else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
  });

  const calls: Array<{ path: string; method: string; json?: Record<string, unknown> }> = [];
  const tree = {
    folders: [
      { company_id: "company-1", folder_id: "folder-a", parent_folder_id: null, name: "Operations" },
      { company_id: "company-1", folder_id: "folder-b", parent_folder_id: "folder-a", name: "Daily" },
      { company_id: "company-1", folder_id: "folder-empty", parent_folder_id: null, name: "Empty" },
    ],
    items: [{ company_id: "company-1", item_id: "item-board", parent_folder_id: null as string | null, resource_type: "huddle_logic_gate", resource_id: "board-1", name: "Weekly Board" }],
  };
  let rejectNextBoardMove = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ path: url.pathname, method, json: body });
    if (method === "PUT" && url.pathname === "/v1/huddle-explorer/items/item-board") {
      if (rejectNextBoardMove) {
        rejectNextBoardMove = false;
        return new Response(JSON.stringify({ error: "Board move denied" }), { status: 403, headers: { "content-type": "application/json" } });
      }
      tree.items[0].parent_folder_id = String(body?.parent_folder_id ?? "") || null;
    }
    const payload = method === "GET" && url.pathname === "/v1/huddle-explorer" ? tree : { status: "ok" };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const openCalls: Array<[string | URL | undefined, string | undefined, string | undefined]> = [];
  const openDescriptor = Object.getOwnPropertyDescriptor(dom.window, "open");
  Object.defineProperty(dom.window, "open", {
    configurable: true,
    value: (url?: string | URL, target?: string, features?: string) => {
      openCalls.push([url, target, features]);
      return null;
    },
  });

  const dataTransfer = () => {
    const values = new Map<string, string>();
    return {
      effectAllowed: "uninitialized",
      dropEffect: "none",
      getData: (type: string) => values.get(type) ?? "",
      setData: (type: string, value: string) => { values.set(type, value); },
    } as unknown as DataTransfer;
  };
  const dispatchDrag = (target: Element, type: string, transfer: DataTransfer) => {
    const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { configurable: true, value: transfer });
    target.dispatchEvent(event);
  };

  const container = dom.window.document.getElementById("root");
  assert.ok(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(<HuddleExplorerSection apiBase="https://api.test" companyID="company-1" currentUserID="user-1" />);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });

    const section = container.querySelector<HTMLElement>('section[aria-label="Huddle Boards"]');
    assert.ok(section);
    assert.match(section.textContent ?? "", /Huddle Boards/);
    assert.match(section.textContent ?? "", /\+ Board/);
    assert.match(section.textContent ?? "", /\+ Folder/);
    assert.equal(section.querySelector("select"), null, "row Root selectors are removed");
    let boardRow = section.querySelector<HTMLElement>('[data-huddle-explorer-row="huddle_logic_gate"]');
    const folderARow = section.querySelector<HTMLElement>('[data-huddle-explorer-row="folder"]');
    assert.ok(boardRow && folderARow);
    assert.equal(boardRow.querySelectorAll(":scope > button").length, 1, "a Board row has no inline remove or edit buttons");
    assert.equal(folderARow.querySelectorAll(":scope > button").length, 2, "a folder row keeps only disclosure and title controls");

    await act(async () => {
      boardRow.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
    });
    let boardMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Huddle Board actions"]');
    assert.ok(boardMenu);
    assert.deepEqual(Array.from(boardMenu.querySelectorAll("button")).map((button) => button.textContent?.trim()), [
      "Open in new browser tab", "Rename", "Move to…", "Remove from Huddle Boards",
    ]);
    await act(async () => {
      Array.from(boardMenu.querySelectorAll("button")).find((button) => button.textContent?.includes("Open in new"))?.click();
    });
    assert.deepEqual(openCalls[0], ["/huddle-logic-gates/board-1", "_blank", "noopener,noreferrer"]);

    const openMoveMenu = async () => {
      const currentBoard = section.querySelector<HTMLElement>('[data-huddle-explorer-row="huddle_logic_gate"]');
      assert.ok(currentBoard);
      await act(async () => {
        currentBoard.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
      });
      await act(async () => {
        Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('[aria-label="Huddle Board actions"] button'))
          .find((button) => button.textContent === "Move to…")?.click();
      });
      const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Move Huddle Board"]');
      assert.ok(menu);
      return menu;
    };
    let moveMenu = await openMoveMenu();
    assert.equal(moveMenu.querySelector<HTMLButtonElement>("button")?.disabled, true, "the Board's current root is disabled");
    await act(async () => {
      Array.from(moveMenu.querySelectorAll("button")).find((button) => button.textContent === "Operations / Daily")?.click();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(tree.items[0].parent_folder_id, "folder-b", "the menu persists the exact selected nested folder");
    assert.equal(tree.items.length, 1, "moving keeps one placement for the same Board");
    boardRow = section.querySelector<HTMLElement>('[data-huddle-explorer-row="huddle_logic_gate"]');
    const nestedFolderRow = section.querySelector('[data-huddle-folder-id="folder-b"]')?.closest('[data-huddle-explorer-row="folder"]');
    assert.ok(boardRow && nestedFolderRow?.parentElement?.contains(boardRow), "saved nested placement is visible with both ancestors expanded");

    moveMenu = await openMoveMenu();
    assert.equal(Array.from(moveMenu.querySelectorAll("button")).find((button) => button.textContent === "Operations / Daily")?.disabled, true);
    await act(async () => {
      Array.from(moveMenu.querySelectorAll("button")).find((button) => button.textContent === "Huddle Boards (top level)")?.click();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(tree.items[0].parent_folder_id, null, "moving out clears only the saved folder placement");
    boardRow = section.querySelector<HTMLElement>('[data-huddle-explorer-row="huddle_logic_gate"]');
    assert.ok(boardRow);
    assert.equal(boardRow.parentElement, folderARow.parentElement?.parentElement, "the reloaded Board renders at the top level");
    assert.equal(tree.items[0].resource_id, "board-1", "moving keeps the exact underlying Board identity");

    rejectNextBoardMove = true;
    moveMenu = await openMoveMenu();
    await act(async () => {
      Array.from(moveMenu.querySelectorAll("button")).find((button) => button.textContent === "Operations")?.click();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.match(section.querySelector('[role="alert"]')?.textContent ?? "", /Board move denied/);
    assert.equal(tree.items[0].parent_folder_id, null, "a rejected move preserves the saved placement");
    assert.equal(boardRow.parentElement, folderARow.parentElement?.parentElement, "a rejected move preserves the displayed placement");

    await act(async () => {
      boardRow.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
    });
    boardMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Huddle Board actions"]');
    await act(async () => {
      Array.from(boardMenu?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Remove from"))?.click();
    });
    const confirmation = dom.window.document.querySelector<HTMLElement>('[data-mango-confirm-action-menu="true"]');
    assert.ok(confirmation);
    assert.match(confirmation.textContent ?? "", /will not be deleted/);
    await act(async () => {
      Array.from(confirmation.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Remove")?.click();
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.ok(calls.some((call) => call.method === "DELETE" && call.path === "/v1/huddle-explorer/items/item-board"), "Board removal deletes only the Explorer placement endpoint");
    assert.equal(calls.some((call) => call.method === "DELETE" && call.path === "/v1/huddle-logic-gates/board-1"), false);

    const emptyFolderRow = Array.from(section.querySelectorAll<HTMLElement>('[data-huddle-explorer-row="folder"]'))
      .find((row) => row.textContent?.includes("Empty"));
    assert.ok(emptyFolderRow);
    await act(async () => {
      emptyFolderRow.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 55, clientY: 65 }));
    });
    const folderMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Huddle Board folder actions"]');
    assert.ok(folderMenu);
    assert.deepEqual(Array.from(folderMenu.querySelectorAll("button")).map((button) => button.textContent?.trim()), [
      "Create folder inside", "Rename", "Delete empty folder",
    ]);
    const emptyFolderDelete = Array.from(folderMenu.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Delete empty folder");
    assert.equal(emptyFolderDelete?.disabled, false, "an empty folder can be recycled");
    await act(async () => {
      folderARow.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 60, clientY: 70 }));
    });
    const nonEmptyFolderMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Huddle Board folder actions"]');
    const nonEmptyFolderDelete = Array.from(nonEmptyFolderMenu?.querySelectorAll("button") ?? []).find((button) => button.textContent?.trim() === "Delete empty folder");
    assert.equal(nonEmptyFolderDelete?.disabled, true, "a folder with contents cannot be recycled");

    const boardTransfer = dataTransfer();
    await act(async () => {
      dispatchDrag(boardRow, "dragstart", boardTransfer);
      dispatchDrag(folderARow, "dragover", boardTransfer);
      dispatchDrag(folderARow, "drop", boardTransfer);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.ok(calls.some((call) => call.method === "PUT" && call.path === "/v1/huddle-explorer/items/item-board" && call.json?.parent_folder_id === "folder-a"));
    assert.equal(tree.items[0].parent_folder_id, "folder-a", "dragging still persists the destination after using the move menu");
    boardRow = section.querySelector<HTMLElement>('[data-huddle-explorer-row="huddle_logic_gate"]');
    assert.ok(boardRow);

    let folderBRow = Array.from(section.querySelectorAll<HTMLElement>('[data-huddle-explorer-row="folder"]'))
      .find((row) => row.textContent?.includes("Daily"));
    if (!folderBRow) {
      await act(async () => {
        section.querySelector<HTMLButtonElement>('[data-huddle-folder-id="folder-a"]')?.click();
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
      });
      folderBRow = Array.from(section.querySelectorAll<HTMLElement>('[data-huddle-explorer-row="folder"]'))
        .find((row) => row.textContent?.includes("Daily"));
    }
    assert.ok(folderBRow);
    const folderBTransfer = dataTransfer();
    await act(async () => {
      dispatchDrag(folderBRow, "dragstart", folderBTransfer);
    });
    const rootDropTarget = section.querySelector<HTMLElement>('[data-huddle-root-drop-target="true"]');
    assert.ok(rootDropTarget, "dragging reveals a deliberate root target");
    await act(async () => {
      dispatchDrag(rootDropTarget, "dragover", folderBTransfer);
      dispatchDrag(rootDropTarget, "drop", folderBTransfer);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.ok(calls.some((call) => call.method === "PUT" && call.path === "/v1/huddle-explorer/folders/folder-b" && call.json?.parent_folder_id === ""), "the explicit root target moves a folder to root");

    const folderAPutCount = calls.filter((call) => call.method === "PUT" && call.path === "/v1/huddle-explorer/folders/folder-a").length;
    const boardDropTransfer = dataTransfer();
    await act(async () => {
      dispatchDrag(folderARow, "dragstart", boardDropTransfer);
      dispatchDrag(boardRow, "dragover", boardDropTransfer);
      dispatchDrag(boardRow, "drop", boardDropTransfer);
      dispatchDrag(folderARow, "dragend", boardDropTransfer);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(calls.filter((call) => call.method === "PUT" && call.path === "/v1/huddle-explorer/folders/folder-a").length, folderAPutCount, "a drop on a Board row does not bubble into a root move");

    const folderATransfer = dataTransfer();
    await act(async () => {
      dispatchDrag(folderARow, "dragstart", folderATransfer);
      dispatchDrag(folderBRow, "dragover", folderATransfer);
      dispatchDrag(folderBRow, "drop", folderATransfer);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    });
    assert.equal(calls.filter((call) => call.method === "PUT" && call.path === "/v1/huddle-explorer/folders/folder-a").length, folderAPutCount, "a folder cannot be dropped into its descendant");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    if (openDescriptor) Object.defineProperty(dom.window, "open", openDescriptor);
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

test("title headers keep editable titles separate and use existing entity icons", () => {
  const linkedPanels = source("frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  const project = source("frontend/src/modules/project-management/ProjectSummaryContent.tsx");
  const huddle = source("frontend/src/modules/huddles/HuddleResourceSurface.tsx");
  const huddleExplorer = source("frontend/src/modules/huddles/HuddleExplorerSection.tsx");
  const sidebar = source("frontend/src/app/AppSidebarChrome.tsx");
  const recycleBin = source("frontend/src/pages/recycle-bin/RecycleBinPage.tsx");
  const homePopups = source("frontend/src/pages/home/HomeParts.tsx");
  const updates = source("frontend/src/pages/home/UpdatesView.tsx");
  const kanbanOverlays = source("frontend/src/modules/kanban/KanbanOverlays.tsx");

  assert.match(editor, /<HierarchyBreadcrumb[\s\S]*resourceType=\{linkedEntityKind\}/);
  assert.match(linkedPanels, /<ExplorerEntityIcon kind=\{linkedEntityKind === "logic_gate" \? "logic_gate" : "node"\}/);
  assert.doesNotMatch(linkedPanels, /linkedEntityKind === "logic_gate" \? "Process:" : "Node:"/);
  assert.match(linkedPanels, /contentEditable=\{canEdit\}/, "the existing editable title remains independent");

  assert.match(project, /<HierarchyBreadcrumb[\s\S]*resourceType="project"/);
  assert.match(project, /<ExplorerRowIcon kind="project"/);
  assert.doesNotMatch(project, />Project Summary</);
  assert.match(project, /name: nextName/);

  assert.match(huddle, /<HierarchyBreadcrumb[\s\S]*kind="huddle_explorer"/);
  assert.match(huddle, /<HuddleResourceIcon type=\{resource\.resourceType\}/);
  assert.doesNotMatch(huddle, /Huddle Process/);
  assert.match(huddle, /\[isGate \? "header" : "name"\]: clean/, "Huddle title persistence remains on its own source field");
  assert.match(recycleBin, /kind === "huddle_logic_gate" \|\| kind === "huddle_explorer_item"[\s\S]*<HuddleResourceIcon type="huddle_logic_gate"/);
  assert.match(recycleBin, /kind === "huddle_node"[\s\S]*<HuddleResourceIcon type="huddle_node"/);

  assert.match(sidebar, /\{!explorerSearchActive && \([\s\S]*<AppSidebarPinnedSection[\s\S]*<HuddleExplorerSection[\s\S]*aria-label="Tower"/);
  assert.match(sidebar, /useExplorerSearchQuery\(companyID\)/);
  assert.match(sidebar, /onBeforeHierarchyNavigate=\{onHierarchyNavigate \?\? onClose\}/);
  assert.match(homePopups, /onBeforeHierarchyNavigate=\{onClose\}/);
  assert.match(updates, /onBeforeHierarchyNavigate=\{fullscreen \? \(\) => setFullscreen\(false\) : undefined\}/);
  assert.match(kanbanOverlays, /onBeforeHierarchyNavigate=\{fullscreen \? \(onToggleFullscreen \?\? onClose\) : undefined\}/);
  assert.match(project, /onBeforeHierarchyNavigate=\{fullscreen \? \(\) => setFullscreen\(false\) : undefined\}/);
  assert.match(huddleExplorer, /setOpenNode\(null\)[\s\S]*setPendingRevealRowID/);
});

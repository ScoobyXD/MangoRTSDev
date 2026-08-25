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

test("Huddle breadcrumb root, folder, and owner Process are clickable", async () => {
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

test("title headers keep editable titles separate and use existing entity icons", () => {
  const linkedPanels = source("frontend/src/modules/editor/EditorLinkedDocumentPanels.tsx");
  const editor = source("frontend/src/modules/editor/EditorContent.tsx");
  const project = source("frontend/src/modules/project-management/ProjectSummaryContent.tsx");
  const huddle = source("frontend/src/modules/huddles/HuddleResourceSurface.tsx");
  const huddleExplorer = source("frontend/src/modules/huddles/HuddleExplorerSection.tsx");
  const sidebar = source("frontend/src/app/AppSidebarChrome.tsx");
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
  assert.doesNotMatch(huddle, /\{isGate \? "Huddle Process:" : "Huddle Node:"\}/);
  assert.match(huddle, /\[isGate \? "header" : "name"\]: clean/, "Huddle title persistence remains on its own source field");

  assert.match(sidebar, /<div hidden=\{explorerSearchActive\}>\s*<HuddleExplorerSection/);
  assert.match(sidebar, /useExplorerSearchQuery\(companyID\)/);
  assert.match(sidebar, /onBeforeHierarchyNavigate=\{popupSidebarFill \? undefined : \(onHierarchyNavigate \?\? onClose\)\}/);
  assert.match(homePopups, /onBeforeHierarchyNavigate=\{onClose\}/);
  assert.match(updates, /onBeforeHierarchyNavigate=\{fullscreen \? \(\) => setFullscreen\(false\) : undefined\}/);
  assert.match(kanbanOverlays, /onBeforeHierarchyNavigate=\{fullscreen \? \(onToggleFullscreen \?\? onClose\) : undefined\}/);
  assert.match(project, /onBeforeHierarchyNavigate=\{fullscreen \? \(\) => setFullscreen\(false\) : undefined\}/);
  assert.match(huddleExplorer, /setOpenNode\(null\)[\s\S]*setPendingRevealRowID/);
});

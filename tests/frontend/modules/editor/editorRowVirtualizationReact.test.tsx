import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import type { NodeProjectionItem } from "../../../../frontend/src/modules/node-map/NodeRecordStore.ts";
import { buildEditorAttachedEmailPayload, buildEditorTextBlockChatPayload } from "../../../../frontend/src/modules/editor/editorProjection.ts";
import type { ProjectProjection, ProjectView } from "../../../../frontend/src/modules/project-management/projectManagementApi.ts";

type Restore = () => void;
const COMPANY_ID = "virtualization-test-company";
const NODE_ID = "virtualization-test-node";
const PROJECT_ID = "virtualization-test-project";
const DOCUMENT_PREFIX = "<!-- mango-editor-html-v1 -->";
const TEXT_BLOCK_PREFIX = "<!-- mango-node-text-block-v1 -->";

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function textBlockInformation(index: number, label: string): string {
  return TEXT_BLOCK_PREFIX + JSON.stringify({
    title: `Block ${index}`,
    document: `${DOCUMENT_PREFIX}<p>${label} ${index}</p>`,
    attachments: [],
  });
}

function timestamp(index: number): string {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString();
}

function nodeProjections(count: number): NodeProjectionItem[] {
  return Array.from({ length: count }, (_, index) => ({
    company_id: COMPANY_ID,
    node_id: NODE_ID,
    information_id: `node-block-${index}`,
    type: "Text box",
    information: textBlockInformation(index, "Node content"),
    revision: 1,
    created_timestamp: timestamp(index),
    updated_timestamp: timestamp(index),
  }));
}

function nodeChatProjection(blockID: string, message = `Chat for ${blockID}`): NodeProjectionItem {
  const createdTimestamp = timestamp(61);
  return {
    company_id: COMPANY_ID,
    node_id: NODE_ID,
    information_id: `chat-${blockID}`,
    type: "Text block chat",
    information: buildEditorTextBlockChatPayload({
      blockID,
      authorID: "virtualization-user",
      authorName: "Test User",
      message,
      createdTimestamp,
    }),
    revision: 1,
    created_timestamp: createdTimestamp,
    updated_timestamp: createdTimestamp,
  };
}

function nodeEmailProjection(blockID: string): NodeProjectionItem {
  const createdTimestamp = timestamp(62);
  return {
    company_id: COMPANY_ID,
    node_id: NODE_ID,
    information_id: `email-${blockID}`,
    type: "Attached email",
    information: buildEditorAttachedEmailPayload({
      blockID,
      messageID: `message-${blockID}`,
      subject: `Email for ${blockID}`,
      from: "sender@example.test",
      attachedTimestamp: createdTimestamp,
    }),
    revision: 1,
    created_timestamp: createdTimestamp,
    updated_timestamp: createdTimestamp,
  };
}

function projectProjections(count: number): ProjectProjection[] {
  return Array.from({ length: count }, (_, index) => ({
    company_id: COMPANY_ID,
    project_id: PROJECT_ID,
    information_id: `project-block-${index}`,
    type: "Text box",
    information: textBlockInformation(index, "Project content"),
    created_timestamp: timestamp(index),
    updated_timestamp: timestamp(index),
  }));
}

function projectView(projections: ProjectProjection[]): ProjectView {
  return {
    company_id: COMPANY_ID,
    project_id: PROJECT_ID,
    project: {
      company_id: COMPANY_ID,
      project_id: PROJECT_ID,
      name: "Virtualized Project",
      status: "Active",
      health: "On Track",
      created_timestamp: timestamp(0),
      updated_timestamp: timestamp(1),
    },
    information: [],
    projections,
    relationships: [],
    critical_path: [],
    can_edit: true,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mountedRowIDs(container: ParentNode, kind: "node" | "project"): string[] {
  const attribute = kind === "node" ? "data-node-text-box-row" : "data-project-text-box-row";
  return Array.from(container.querySelectorAll<HTMLElement>(`[${attribute}]`))
    .map((element) => element.getAttribute(attribute) ?? "")
    .filter(Boolean);
}

function assertBoundedRows(container: ParentNode, kind: "node" | "project", maximum = 7): string[] {
  const list = container.querySelector<HTMLElement>(`[data-mango-bounded-editor-rows="${kind}"]`);
  assert.ok(list, `${kind} bounded row list should render`);
  const mounted = Number(list.dataset.mountedRowCount ?? "0");
  const rowIDs = mountedRowIDs(container, kind);
  assert.ok(mounted > 0, `${kind} should mount at least one row`);
  assert.ok(mounted <= maximum, `${kind} mounted ${mounted} rows, expected at most ${maximum}`);
  assert.equal(rowIDs.length, mounted, `${kind} mounted row counter should match the real DOM`);
  return rowIDs;
}

function assertPaneToggles(row: HTMLElement, expected: readonly [boolean, boolean, boolean]) {
  const toggles = Array.from(row.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Toggle email column"], button[aria-label="Toggle text editor column"], button[aria-label="Toggle chat column"]',
  ));
  assert.deepEqual(toggles.map((button) => button.getAttribute("aria-label")), [
    "Toggle email column",
    "Toggle text editor column",
    "Toggle chat column",
  ]);
  assert.deepEqual(toggles.map((button) => button.getAttribute("aria-pressed")), expected.map(String));
}

function assertThreeOpenToggles(row: HTMLElement) {
  assertPaneToggles(row, [true, true, true]);
}

function assertZeroEmailNodeDefaults(row: HTMLElement) {
  assertPaneToggles(row, [false, true, true]);
}

test("real Node and Project surfaces keep rows bounded through load, edits, scrolling, and deep targets", { timeout: 20_000 }, async () => {
  const originalConsoleError = console.error;
  console.error = (...values: unknown[]) => {
    if (
      typeof values[0] === "string"
      && values[0].includes("inside a test was not wrapped in act")
      && values[1] === "NodeTextBlockEditor"
    ) return;
    originalConsoleError(...values);
  };
  const dom = new JSDOM("<!doctype html><html><body><div id=\"node-root\"></div><div id=\"project-root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLSpanElement", "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement",
    "HTMLUListElement", "HTMLAnchorElement", "HTMLBRElement", "HTMLTableElement", "HTMLTableRowElement",
    "HTMLTableCellElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "DocumentFragment",
    "DOMParser", "DOMException", "Event", "EventTarget", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent",
    "CustomEvent", "MutationObserver", "Range",
  ] as const;
  for (const name of browserGlobals) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("PointerEvent", dom.window.MouseEvent, restores);
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("localStorage", dom.window.localStorage, restores);
  installGlobal("sessionStorage", dom.window.sessionStorage, restores);
  installGlobal("indexedDB", fakeIndexedDB, restores);
  installGlobal("IDBKeyRange", IDBKeyRange, restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  dom.window.sessionStorage.setItem("mangorts:active-company-id-v1", COMPANY_ID);
  dom.window.localStorage.setItem(
    `node-editor-pane-layout-v2:${COMPANY_ID}:${NODE_ID}`,
    JSON.stringify({ initialized: true, openEditorBlockIDs: [], openEmailBlockIDs: [], openChatBlockIDs: [] }),
  );

  let nextFrameID = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const requestFrame = (callback: FrameRequestCallback) => {
    const frameID = nextFrameID += 1;
    frames.set(frameID, callback);
    return frameID;
  };
  const cancelFrame = (frameID: number) => { frames.delete(frameID); };
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);

  class TestResizeObserver {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  }
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "800px 0px";
    readonly thresholds = [0];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
    takeRecords() { return []; }
  }
  installGlobal("ResizeObserver", TestResizeObserver, restores);
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });

  class TestWebSocket extends dom.window.EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = TestWebSocket.CONNECTING;
    binaryType: BinaryType = "blob";
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    url: string;
    onclose = null;
    onerror = null;
    onmessage = null;
    onopen = null;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
    }
    close() { this.readyState = TestWebSocket.CLOSED; }
    send() { return undefined; }
  }
  installGlobal("WebSocket", TestWebSocket, restores);

  const nodeTextBlockProjectionItems = nodeProjections(60);
  let currentNodeProjectionItems = [...nodeTextBlockProjectionItems, nodeChatProjection("node-block-59")];
  const projectProjectionItems = projectProjections(60);
  const serverDocuments = new Map<string, { html: string; revision: number }>();
  for (const projection of [...nodeTextBlockProjectionItems, ...projectProjectionItems]) {
    const payload = JSON.parse(projection.information.slice(TEXT_BLOCK_PREFIX.length)) as { document: string };
    serverDocuments.set(projection.information_id, { html: payload.document, revision: 0 });
  }
  let committedEditorOperations = 0;
  const fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), dom.window.location.href);
    if (url.pathname === `/v1/projects/${PROJECT_ID}`) return jsonResponse(projectView(projectProjectionItems));
    if (url.pathname === "/v1/me") {
      return jsonResponse({
        user: { user_id: "virtualization-user", email: "user@example.test", display_name: "Test User" },
        memberships: [],
        is_dev_admin: false,
      });
    }
    if (url.pathname.endsWith("/users")) return jsonResponse({ users: [] });
    if (url.pathname.endsWith("/user-groups")) return jsonResponse({ groups: [], members: [] });
    if (url.pathname.includes("/editor-collaboration/")) {
      const documentID = decodeURIComponent(url.pathname.split("/documents/")[1] ?? "");
      const current = serverDocuments.get(documentID) ?? { html: "", revision: 0 };
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          operation_id: string;
          patch: { start_utf8: number; delete_utf8: number; insert: string };
        };
        const nextHTML = current.html.slice(0, body.patch.start_utf8)
          + body.patch.insert
          + current.html.slice(body.patch.start_utf8 + body.patch.delete_utf8);
        const next = { html: nextHTML, revision: current.revision + 1 };
        serverDocuments.set(documentID, next);
        committedEditorOperations += 1;
        return jsonResponse({
          operation_id: body.operation_id,
          revision: next.revision,
          patch: body.patch,
          concurrent_operations: [],
        });
      }
      return jsonResponse({ revision: current.revision, html: current.html, etag: `revision-${current.revision}` });
    }
    if (url.pathname.includes("/realtime/ticket")) return jsonResponse({});
    if (url.pathname.includes("/relationships")) return jsonResponse({ relationships: [] });
    if (url.pathname.includes("/accounts")) return jsonResponse({ accounts: [] });
    return jsonResponse({ attachments: [], projects: [], logic_gates: [], results: [] });
  };
  installGlobal("fetch", fetchImplementation, restores);
  dom.window.fetch = fetchImplementation;

  const flushWork = async (rounds = 14) => {
    await act(async () => {
      for (let round = 0; round < rounds; round += 1) {
        await Promise.resolve();
        const callbacks = Array.from(frames.values());
        frames.clear();
        callbacks.forEach((callback) => callback(round * 16));
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  const scroll = async (element: HTMLElement, scrollTop: number) => {
    element.scrollTop = scrollTop;
    element.dispatchEvent(new dom.window.Event("scroll"));
    await flushWork();
  };

  let nodeRoot: { render(value: React.ReactNode): void; unmount(): void } | null = null;
  let projectRoot: { render(value: React.ReactNode): void; unmount(): void } | null = null;
  try {
    const [{ createRoot }, { NodeWorkspaceSurface }, { ProjectSummaryContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurface.tsx"),
      import("../../../../frontend/src/modules/project-management/ProjectSummaryContent.tsx"),
    ]);
    const noop = () => undefined;
    const runtimeErrors: string[] = [];
    const nodeRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      if (path.includes("/editor-collaboration/") && (init?.method ?? "GET") === "PATCH") {
        return { projection_revision: 2 } as T;
      }
      if (path.includes("/attachments")) return { attachments: [] } as T;
      return { relationships: [], projects: [], results: [] } as T;
    };
    const nodeProps = {
      apiBase: "http://localhost",
      companyID: COMPANY_ID,
      scope: `node:${NODE_ID}`,
      nodeID: NODE_ID,
      canEdit: true,
      nodePriorityDraft: "3",
      assignedLogicGateIDs: [] as string[],
      unseenChanges: [],
      companyUsers: [],
      editorSequence: 1,
      topPx: 0,
      accent: "#7c3aed",
      surfaceText: "#172033",
      panelBackground: "#ffffff",
      strokeColor: "#dbeafe",
      ruleColor: "#cbd5e1",
      scrollbarAccent: "#7c3aed",
      scrollbarTrack: "#e2e8f0",
      outlineStyle: "automatic-outline-numbering" as const,
      requestJSON: nodeRequestJSON,
      onProjectionMutation: noop,
      onMarkChangeSeen: noop,
      onMarkAllChangesSeen: noop,
      onCreateNodeFromImage: async () => undefined,
      onAssignToLogicGate: async () => undefined,
      onRequireNodePriorityForLogicGateAssignment: noop,
      onError: (message: string) => { runtimeErrors.push(message); },
    };
    const renderNode = (options: { loaded: boolean; projections?: NodeProjectionItem[]; focusInformationID?: string; focusRequestID?: number }) => (
      <NodeWorkspaceSurface
        {...nodeProps}
        projections={options.projections ?? (options.loaded ? currentNodeProjectionItems : [])}
        projectionsLoaded={options.loaded}
        focusInformationID={options.focusInformationID}
        focusRequestID={options.focusRequestID}
      />
    );

    const nodeContainer = dom.window.document.getElementById("node-root");
    assert.ok(nodeContainer);
    nodeRoot = createRoot(nodeContainer);
    await act(async () => { nodeRoot?.render(renderNode({ loaded: false })); });
    await flushWork();
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true, projections: [] })); });
    await flushWork();
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true })); });
    await flushWork();

    const initialNodeRows = assertBoundedRows(nodeContainer, "node");
    for (const rowID of initialNodeRows) {
      const row = nodeContainer.querySelector<HTMLElement>(`[data-node-text-box-row="${rowID}"]`);
      assert.ok(row);
      assertZeroEmailNodeDefaults(row);
      assert.ok(row.querySelector(`[data-node-text-block-id="${rowID}"]`), "open Node editor should be mounted");
      assert.ok(row.querySelector(`[data-node-chat-block-id="${rowID}"]`), "open Node chat should be mounted");
    }

    const nodeScrollElement = nodeContainer.firstElementChild as HTMLElement | null;
    assert.ok(nodeScrollElement);
    assert.equal(nodeScrollElement.style.overflowAnchor, "none");
    Object.defineProperty(nodeScrollElement, "clientHeight", { configurable: true, value: 900 });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    await flushWork();
    const editedBlockID = initialNodeRows[0];
    assert.equal(editedBlockID, "node-block-59");
    assert.match(
      nodeContainer.querySelector<HTMLElement>(`[data-node-text-box-row="${editedBlockID}"]`)?.textContent ?? "",
      /Chat for node-block-59/,
      "late chat projection should render in the matching row",
    );
    const manualEditorToggle = nodeContainer.querySelector<HTMLButtonElement>(
      `[data-node-text-box-row="${editedBlockID}"] button[aria-label="Toggle text editor column"]`,
    );
    const manualChatToggle = nodeContainer.querySelector<HTMLButtonElement>(
      `[data-node-text-box-row="${editedBlockID}"] button[aria-label="Toggle chat column"]`,
    );
    assert.ok(manualEditorToggle);
    assert.ok(manualChatToggle);
    await act(async () => {
      manualEditorToggle.click();
      manualChatToggle.click();
    });
    await flushWork();
    assert.equal(manualEditorToggle.getAttribute("aria-pressed"), "false");
    assert.equal(manualChatToggle.getAttribute("aria-pressed"), "false");

    const lateTextProjection = nodeProjections(61).find((projection) => projection.information_id === "node-block-60");
    assert.ok(lateTextProjection);
    const latePayload = JSON.parse(lateTextProjection.information.slice(TEXT_BLOCK_PREFIX.length)) as { document: string };
    serverDocuments.set(lateTextProjection.information_id, { html: latePayload.document, revision: 0 });
    currentNodeProjectionItems = [
      ...nodeProjections(61),
      nodeChatProjection("node-block-59"),
      nodeChatProjection("node-block-60"),
    ];
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true })); });
    await flushWork();

    const lateRow = nodeContainer.querySelector<HTMLElement>('[data-node-text-box-row="node-block-60"]');
    assert.ok(lateRow, "late block should mount in the bounded top window");
    assertZeroEmailNodeDefaults(lateRow);
    assert.ok(lateRow.querySelector('[data-node-text-block-id="node-block-60"]'), "late block editor should mount");
    assert.ok(lateRow.querySelector('[data-node-chat-block-id="node-block-60"]'), "late block chat should mount");
    assert.match(lateRow.textContent ?? "", /Chat for node-block-60/);

    const retainedRow = nodeContainer.querySelector<HTMLElement>(`[data-node-text-box-row="${editedBlockID}"]`);
    assert.ok(retainedRow);
    assertPaneToggles(retainedRow, [false, false, false]);
    const retainedEditorToggle = retainedRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle text editor column"]');
    const retainedChatToggle = retainedRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle chat column"]');
    assert.ok(retainedEditorToggle);
    assert.ok(retainedChatToggle);
    await act(async () => {
      retainedEditorToggle.click();
    });
    await flushWork();
    assertPaneToggles(retainedRow, [false, true, false]);

    committedEditorOperations = 0;
    const editedSurface = nodeContainer.querySelector<HTMLElement>(`[data-node-text-block-id="${editedBlockID}"]`);
    assert.ok(editedSurface);
    assert.equal(editedSurface.getAttribute("contenteditable"), "true", "Node editor should be editable before exercising unmount flush");
    await act(async () => {
      const beforeInput = new dom.window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: "Edited before virtual unmount",
      });
      Simulate.beforeInput(editedSurface, {
        data: "Edited before virtual unmount",
        inputType: "insertText",
        nativeEvent: beforeInput,
      } as never);
      editedSurface.innerHTML = "<p>Edited before virtual unmount</p>";
      const input = new dom.window.InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: "Edited before virtual unmount",
      });
      Simulate.input(editedSurface, {
        data: "Edited before virtual unmount",
        inputType: "insertText",
        nativeEvent: input,
      } as never);
    });

    let distantNodeRows: string[] = [];
    let previousScrollTop = nodeScrollElement.scrollTop;
    for (const nextScrollTop of [6_000, 12_000, 24_000, 36_000, 45_000]) {
      await scroll(nodeScrollElement, nextScrollTop);
      assert.equal(nodeScrollElement.scrollTop, nextScrollTop, "user scrolling should not be rewritten by an old anchor");
      assert.ok(nodeScrollElement.scrollTop >= previousScrollTop, "Node scrolling should remain monotonic");
      previousScrollTop = nodeScrollElement.scrollTop;
      distantNodeRows = assertBoundedRows(nodeContainer, "node");
    }
    assert.ok(distantNodeRows.includes("node-block-0"), "final Node row should mount at the bottom");
    assert.notDeepEqual(distantNodeRows, initialNodeRows, "Node scrolling should move the mounted window");
    assert.equal(nodeContainer.querySelector(`[data-node-text-box-row="${editedBlockID}"]`), null, "edited Node row should unmount");
    await flushWork();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    assert.ok(committedEditorOperations > 0, "virtual unmount should flush the pending editor operation");
    assert.match(serverDocuments.get(editedBlockID)?.html ?? "", /Edited before virtual unmount/, "flushed backend snapshot should contain the edit");

    await scroll(nodeScrollElement, 0);
    assertBoundedRows(nodeContainer, "node");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    const remountedSurface = nodeContainer.querySelector<HTMLElement>(`[data-node-text-block-id="${editedBlockID}"]`);
    assert.ok(remountedSurface, "edited Node row should remount when scrolled back");
    assert.match(remountedSurface.textContent ?? "", /Edited before virtual unmount/, "remounted Node editor should preserve the edit");
    const remountedChatToggle = nodeContainer.querySelector<HTMLButtonElement>(
      `[data-node-text-box-row="${editedBlockID}"] button[aria-label="Toggle chat column"]`,
    );
    assert.ok(remountedChatToggle);
    assert.equal(remountedChatToggle.getAttribute("aria-pressed"), "false", "manual chat closure should survive virtualization");
    await act(async () => { remountedChatToggle.click(); });
    await flushWork();
    const remountedChat = nodeContainer.querySelector<HTMLElement>(`[data-node-chat-block-id="${editedBlockID}"]`);
    assert.ok(remountedChat, "matching Node chat should remount on demand");
    assert.match(remountedChat.textContent ?? "", /Chat for node-block-59/);
    await act(async () => { remountedChatToggle.click(); });
    await flushWork();

    const topEditorToggle = nodeContainer.querySelector<HTMLButtonElement>(
      `[data-node-text-box-row="${editedBlockID}"] button[aria-label="Toggle text editor column"]`,
    );
    assert.ok(topEditorToggle);
    await act(async () => { topEditorToggle.click(); });
    await flushWork();
    assert.equal(topEditorToggle.getAttribute("aria-pressed"), "false");
    assert.equal(nodeContainer.querySelector(`[data-node-text-block-id="${editedBlockID}"]`), null);
    await act(async () => {
      nodeRoot?.render(renderNode({ loaded: true, focusInformationID: editedBlockID, focusRequestID: 1 }));
    });
    await flushWork();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    const reopenedNodeToggle = nodeContainer.querySelector<HTMLButtonElement>(
      `[data-node-text-box-row="${editedBlockID}"] button[aria-label="Toggle text editor column"]`,
    );
    assert.equal(reopenedNodeToggle?.getAttribute("aria-pressed"), "true", "Node deep target should reopen a closed editor column");
    assert.ok(nodeContainer.querySelector(`[data-node-text-block-id="${editedBlockID}"]`));

    const distantNodeTarget = "node-block-8";
    await act(async () => {
      nodeRoot?.render(renderNode({ loaded: true, focusInformationID: distantNodeTarget, focusRequestID: 2 }));
    });
    await flushWork();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    assertBoundedRows(nodeContainer, "node");
    assert.ok(nodeContainer.querySelector(`[data-node-text-box-row="${distantNodeTarget}"]`), "Node deep target should mount directly");

    await scroll(nodeScrollElement, 0);
    assert.equal(nodeScrollElement.scrollTop, 0);
    await act(async () => {
      nodeRoot?.render(renderNode({ loaded: true, focusInformationID: distantNodeTarget, focusRequestID: 2 }));
    });
    await flushWork();
    assert.equal(nodeScrollElement.scrollTop, 0, "a handled deep target should not replay after the user scrolls away");
    assertBoundedRows(nodeContainer, "node", 8);

    await act(async () => { nodeRoot?.unmount(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    nodeRoot = null;

    for (const version of ["v4", "v3", "v2"]) {
      dom.window.localStorage.removeItem(`node-editor-pane-layout-${version}:${COMPANY_ID}:${NODE_ID}`);
    }
    currentNodeProjectionItems = [
      ...nodeProjections(61),
      nodeChatProjection("node-block-59"),
      nodeChatProjection("node-block-60"),
      nodeEmailProjection("node-block-59"),
    ];
    nodeRoot = createRoot(nodeContainer);
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true })); });
    await flushWork();
    const emailNodeRow = nodeContainer.querySelector<HTMLElement>('[data-node-text-box-row="node-block-59"]');
    assert.ok(emailNodeRow);
    assertThreeOpenToggles(emailNodeRow);
    assert.ok(emailNodeRow.querySelector('[data-node-text-block-id="node-block-59"]'));
    assert.ok(emailNodeRow.querySelector('[data-node-chat-block-id="node-block-59"]'));
    assert.match(emailNodeRow.textContent ?? "", /Email for node-block-59/, "attached email should stay associated with its text block");

    await act(async () => { nodeRoot?.unmount(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    nodeRoot = null;

    const projectContainer = dom.window.document.getElementById("project-root");
    assert.ok(projectContainer);
    projectRoot = createRoot(projectContainer);
    const emptyWorkspace = {
      nodeFolders: [], nodeFolderItems: [], nodes: [], logicGateFolders: [], logicGateFolderItems: [], logicGates: [],
    };
    const renderProject = (focusInformationID?: string, focusRequestID?: number) => (
      <ProjectSummaryContent
        projectID={PROJECT_ID}
        focusInformationID={focusInformationID}
        focusRequestID={focusRequestID}
        accent="#7c3aed"
        onBack={noop}
        workspace={emptyWorkspace}
      />
    );
    await act(async () => { projectRoot?.render(renderProject()); });
    await flushWork(24);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    await flushWork();

    const initialProjectRows = assertBoundedRows(projectContainer, "project");
    for (const rowID of initialProjectRows) {
      const row = projectContainer.querySelector<HTMLElement>(`[data-project-text-box-row="${rowID}"]`);
      assert.ok(row);
      assertThreeOpenToggles(row);
      assert.ok(row.querySelector(`[data-project-text-block-id="${rowID}"]`), "open Project editor should be mounted");
    }
    const projectList = projectContainer.querySelector<HTMLElement>('[data-mango-bounded-editor-rows="project"]');
    const projectScrollElement = projectList?.parentElement;
    assert.ok(projectScrollElement);
    assert.equal(projectScrollElement.style.overflowAnchor, "none");
    Object.defineProperty(projectScrollElement, "clientHeight", { configurable: true, value: 900 });
    await scroll(projectScrollElement, 45_000);
    const distantProjectRows = assertBoundedRows(projectContainer, "project");
    assert.notDeepEqual(distantProjectRows, initialProjectRows, "Project scrolling should move the mounted window");

    const projectTargetID = "project-block-8";
    await act(async () => { projectRoot?.render(renderProject(projectTargetID, 1)); });
    await flushWork();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    const targetProjectRows = assertBoundedRows(projectContainer, "project");
    assert.ok(targetProjectRows.includes(projectTargetID), "Project deep target should mount directly");
    const projectTargetToggle = projectContainer.querySelector<HTMLButtonElement>(
      `[data-project-text-box-row="${projectTargetID}"] button[aria-label="Toggle text editor column"]`,
    );
    assert.equal(projectTargetToggle?.getAttribute("aria-pressed"), "true");
    await act(async () => { projectTargetToggle?.click(); });
    await flushWork();
    assert.equal(projectTargetToggle?.getAttribute("aria-pressed"), "false");
    await act(async () => { projectRoot?.render(renderProject(projectTargetID, 2)); });
    await flushWork();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    const reopenedProjectToggle = projectContainer.querySelector<HTMLButtonElement>(
      `[data-project-text-box-row="${projectTargetID}"] button[aria-label="Toggle text editor column"]`,
    );
    assert.equal(reopenedProjectToggle?.getAttribute("aria-pressed"), "true", "Project deep target should reopen a closed editor column");
    assertBoundedRows(projectContainer, "project");
    assert.deepEqual(runtimeErrors, [], "the lifecycle run should not report editor recovery errors");
  } finally {
    if (nodeRoot) await act(async () => { nodeRoot?.unmount(); });
    if (projectRoot) await act(async () => { projectRoot?.unmount(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    console.error = originalConsoleError;
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import type { NodeProjectionItem } from "../../../../frontend/src/modules/node-map/NodeRecordStore.ts";
import { buildEditorAttachedEmailPayload, buildEditorTextBlockChatPayload } from "../../../../frontend/src/modules/editor/editorProjection.ts";
import { applyEmailBodyHighlights } from "../../../../frontend/src/modules/editor/emailBodyHighlights.ts";
import type { ProjectProjection, ProjectView } from "../../../../frontend/src/modules/project-management/projectManagementApi.ts";

type Restore = () => void;
const COMPANY_ID = "virtualization-test-company";
const NODE_ID = "virtualization-test-node";
const PROJECT_ID = "virtualization-test-project";
function tiptapDocument(text: string) {
  return {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: `block-${text.toLowerCase().replace(/[^a-z]+/g, "-")}`, textAlign: "left", indentLevel: 0 },
        content: [{ type: "text", text }],
      }],
    },
  };
}
const TEXT_BLOCK_PREFIX = "<!-- mango-node-text-block-v1 -->";

test("rich email bodies paint stored and active chat selections without flattening markup", () => {
  const dom = new JSDOM("<!doctype html><html><body>Hello <strong>linked email</strong> body.</body></html>");
  const bodyText = dom.window.document.body.textContent ?? "";
  const quote = "linked email";
  const startOffset = bodyText.indexOf(quote);
  applyEmailBodyHighlights(dom.window.document, [{ id: "stored-chat", quote, startOffset, endOffset: startOffset + quote.length }]);
  const stored = dom.window.document.querySelector<HTMLElement>('[data-mango-email-body-highlight="stored"]');
  assert.equal(stored?.textContent, quote);
  assert.equal(dom.window.document.querySelector("strong")?.textContent, quote, "painting a highlight must preserve the provider's rich markup");

  const activeQuote = "body";
  applyEmailBodyHighlights(dom.window.document, [{ id: "stored-chat", quote, startOffset, endOffset: startOffset + quote.length }], {
    quote: activeQuote,
    startOffset: 0,
    endOffset: 1,
  });
  assert.equal(dom.window.document.querySelectorAll('[data-mango-email-body-highlight="stored"]').length, 1, "repainting must not duplicate stored highlights");
  assert.equal(dom.window.document.querySelector<HTMLElement>('[data-mango-email-body-highlight="active"]')?.textContent, activeQuote, "active chat navigation should fall back to the persisted quote when offsets drift");
  dom.window.close();
});

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
    document: JSON.stringify(tiptapDocument(`${label} ${index}`)),
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
      messageID: `thread-root-${blockID}`,
      emailMessageID: `email-message-${blockID}`,
      threadID: `thread-${blockID}`,
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

function assertOnlyEditorOpen(row: HTMLElement) {
  assertPaneToggles(row, [false, true, false]);
}


function assertNodePaneToggles(row: HTMLElement, expected: readonly [boolean, boolean]) {
  const toggles = Array.from(row.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="Toggle text editor column"], button[aria-label="Toggle chat column"]',
  ));
  assert.deepEqual(toggles.map((button) => button.getAttribute("aria-label")), [
    "Toggle text editor column",
    "Toggle chat column",
  ]);
  assert.deepEqual(toggles.map((button) => button.getAttribute("aria-pressed")), expected.map(String));
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
  const scrolledIntoView: HTMLElement[] = [];
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value(this: HTMLElement) { scrolledIntoView.push(this); } });
  if (!dom.window.Range.prototype.getClientRects) dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!dom.window.Range.prototype.getBoundingClientRect) dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  if (!dom.window.document.elementFromPoint) {
    Object.defineProperty(dom.window.document, "elementFromPoint", {
      configurable: true,
      value: () => dom.window.document.querySelector(".mango-tiptap-prosemirror") ?? dom.window.document.body,
    });
  }
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
  const serverDocuments = new Map<string, { document: ReturnType<typeof tiptapDocument>; revision: number }>();
  for (const projection of [...nodeTextBlockProjectionItems, ...projectProjectionItems]) {
    const payload = JSON.parse(projection.information.slice(TEXT_BLOCK_PREFIX.length)) as { document: string };
    serverDocuments.set(projection.information_id, { document: JSON.parse(payload.document) as ReturnType<typeof tiptapDocument>, revision: 0 });
  }
  const fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), dom.window.location.href);
    if (url.pathname === "/v1/communications/messages/thread-root-node-block-0") return jsonResponse({
      message: {
        email_message_id: "email-message-node-block-0",
        id: "thread-root-node-block-0",
        thread_id: "thread-node-block-0",
        subject: "Email for node-block-0",
        snippet: "Earlier message in linked thread",
        body: "Earlier linked email body.",
        date: 1_768_521_500,
        unread: false,
        starred: false,
        from: [{ name: "Earlier Sender", email: "earlier@example.test" }],
        to: [{ name: "Recipient Person", email: "recipient@example.test" }],
      },
    });
    if (url.pathname === "/v1/communications/messages/message-node-block-0") return jsonResponse({
      message: {
        email_message_id: "internal-message-node-block-0",
        id: "message-node-block-0",
        thread_id: "thread-node-block-0",
        subject: "Email for node-block-0",
        snippet: "Full linked message preview",
        body: "Complete linked email body.",
        date: 1_768_521_600,
        unread: false,
        starred: false,
        from: [{ name: "Sender Person", email: "sender@example.test" }],
        to: [{ name: "Recipient Person", email: "recipient@example.test" }],
        cc: [{ name: "Copy Person", email: "copy@example.test" }],
        bcc: [{ name: "Blind Copy", email: "blind@example.test" }],
      },
    });
    if (url.pathname === "/v1/communications/threads/thread-node-block-0") return jsonResponse({
      thread: {
        id: "thread-node-block-0",
        subject: "Email for node-block-0",
        message_ids: ["thread-root-node-block-0", "message-node-block-0"],
      },
    });
    if (url.pathname === "/v1/editor-data-format") return jsonResponse({
      company_id: COMPANY_ID,
      editor_format: "tiptap_json",
      migration_state: "ready",
      document_schema_version: 1,
      expected_document_count: 0,
      converted_document_count: 0,
    });
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
    if (url.pathname.startsWith("/v1/editor-json/")) {
      if (url.pathname.endsWith("/collaboration-ticket")) {
        return jsonResponse({
          token: "virtualization-collaboration-token",
          document_name: "virtualization-document",
          collaboration_epoch: "00000000-0000-4000-8000-000000000001",
        });
      }
      const documentID = decodeURIComponent(url.pathname.split("/documents/")[1] ?? "");
      const current = serverDocuments.get(documentID) ?? { document: tiptapDocument(""), revision: 0 };
      if ((init?.method ?? "GET").toUpperCase() === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          operation_id: string;
          document: ReturnType<typeof tiptapDocument>;
        };
        const next = { document: body.document, revision: current.revision + 1 };
        serverDocuments.set(documentID, next);
        return jsonResponse({
          operation_id: body.operation_id,
          revision: next.revision,
          committed_at: "2026-01-01T00:00:00.000Z",
        });
      }
      return jsonResponse({
        revision: current.revision,
        schema_version: 1,
        document: current.document,
        annotations: [],
      });
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
    const nodeRequestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (path.includes("/editor-data-format")) {
        return {
          company_id: COMPANY_ID,
          editor_format: "tiptap_json",
          migration_state: "ready",
          document_schema_version: 1,
          expected_document_count: 0,
          converted_document_count: 0,
        } as T;
      }
      if (path.startsWith("/v1/editor-json/")) {
        const response = await fetchImplementation(path, {
          ...init,
          body: init?.json === undefined ? init?.body : JSON.stringify(init.json),
        });
        return await response.json() as T;
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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork(24);

    const initialNodeRows = assertBoundedRows(nodeContainer, "node");
    for (const rowID of initialNodeRows) {
      const row = nodeContainer.querySelector<HTMLElement>(`[data-node-text-box-row="${rowID}"]`);
      assert.ok(row);
      const chatOpen = rowID === "node-block-59";
      assertNodePaneToggles(row, [true, chatOpen]);
      assert.ok(row.querySelector(`[data-node-text-block-id="${rowID}"]`), "open Node editor should be mounted");
      assert.equal(Boolean(row.querySelector(`[data-node-chat-block-id="${rowID}"]`)), chatOpen, "only a text box with existing chat should open chat by default");
    }

    const nodeScrollElement = nodeContainer.firstElementChild as HTMLElement | null;
    assert.ok(nodeScrollElement);
    assert.equal(nodeScrollElement.style.overflowAnchor, "none");
    assert.equal(nodeScrollElement.style.overscrollBehaviorY, "contain");
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
    serverDocuments.set(lateTextProjection.information_id, { document: JSON.parse(latePayload.document) as ReturnType<typeof tiptapDocument>, revision: 0 });
    currentNodeProjectionItems = [
      ...nodeProjections(61),
      nodeChatProjection("node-block-59"),
      nodeChatProjection("node-block-60"),
    ];
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true })); });
    await flushWork();

    const lateRow = nodeContainer.querySelector<HTMLElement>('[data-node-text-box-row="node-block-60"]');
    assert.ok(lateRow, "late block should mount in the bounded top window");
    assertNodePaneToggles(lateRow, [true, true]);
    assert.ok(lateRow.querySelector('[data-node-text-block-id="node-block-60"]'), "late block editor should mount");
    assert.ok(lateRow.querySelector('[data-node-chat-block-id="node-block-60"]'), "late block chat should mount");
    assert.match(lateRow.textContent ?? "", /Chat for node-block-60/);

    const retainedRow = nodeContainer.querySelector<HTMLElement>(`[data-node-text-box-row="${editedBlockID}"]`);
    assert.ok(retainedRow);
    assertNodePaneToggles(retainedRow, [false, false]);
    const retainedEditorToggle = retainedRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle text editor column"]');
    const retainedChatToggle = retainedRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle chat column"]');
    assert.ok(retainedEditorToggle);
    assert.ok(retainedChatToggle);
    await act(async () => {
      retainedEditorToggle.click();
    });
    await flushWork();
    assertNodePaneToggles(retainedRow, [true, false]);

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
    assert.equal(nodeContainer.querySelector(`[data-node-text-box-row="${editedBlockID}"]`), null, "top Node row should unmount");

    await scroll(nodeScrollElement, 0);
    assertBoundedRows(nodeContainer, "node");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flushWork();
    const remountedSurface = nodeContainer.querySelector<HTMLElement>(`[data-node-text-block-id="${editedBlockID}"]`);
    assert.ok(remountedSurface, "top Node row should remount when scrolled back");
    assert.match(remountedSurface.textContent ?? "", /Node content 59/, "remounted Node editor should restore its JSON document");
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
    const emailLinkedProjection = nodeProjections(1)[0];
    assert.ok(emailLinkedProjection);
    const emailLinkedPayload = JSON.parse(emailLinkedProjection.information.slice(TEXT_BLOCK_PREFIX.length)) as Record<string, unknown>;
    emailLinkedProjection.information = TEXT_BLOCK_PREFIX + JSON.stringify({
      ...emailLinkedPayload,
      email_message_id: "internal-message-node-block-0",
      email_accent: "#2563eb",
    });
    currentNodeProjectionItems = [
      emailLinkedProjection,
      nodeChatProjection("node-block-0"),
      nodeEmailProjection("node-block-0"),
    ];
    nodeRoot = createRoot(nodeContainer);
    await act(async () => { nodeRoot?.render(renderNode({ loaded: true })); });
    await flushWork();
    const emailNodeRow = nodeContainer.querySelector<HTMLElement>('[data-node-text-box-row="node-block-0"]');
    assert.ok(emailNodeRow);
    assertNodePaneToggles(emailNodeRow, [true, true]);
    const emailColumn = nodeContainer.querySelector<HTMLElement>('[data-node-email-column="true"]');
    const emailWorkspace = nodeContainer.querySelector<HTMLElement>('[data-node-email-workspace-mode]');
    const removedEmailCollapseToggle = nodeContainer.querySelector<HTMLButtonElement>('button[aria-label="Collapse email column"]');
    const emailFocusToggle = nodeContainer.querySelector<HTMLButtonElement>('button[aria-label="Expand email column"]');
    const nodeEmailToggle = nodeContainer.querySelector<HTMLButtonElement>('button[aria-label="Toggle node email column"]');
    const editorToggle = emailNodeRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle text editor column"]');
    const chatToggle = emailNodeRow.querySelector<HTMLButtonElement>('button[aria-label="Toggle chat column"]');
    assert.ok(emailColumn, "attached email should render once in the node-wide column");
    assert.ok(emailWorkspace);
    assert.equal(removedEmailCollapseToggle, null, "the obsolete email-header collapse arrow should stay removed");
    assert.ok(emailFocusToggle, "the email header should expose its focus expansion control");
    assert.ok(nodeEmailToggle);
    assert.ok(editorToggle);
    assert.ok(chatToggle);
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "email-with-text");
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "editor-chat");
    assert.equal(emailColumn.style.height, emailColumn.style.minHeight, "the email column should remain bounded to the available Node viewport");
    assert.ok(Number.parseFloat(emailColumn.style.minHeight) >= 240, "the email column should fill the remaining Node viewport");
    assert.equal(emailColumn.style.overflow, "hidden", "a long email should not extend the outer virtualized timeline");
    const emailColumnScroll = emailColumn.querySelector<HTMLElement>(".editor-document-scroll");
    assert.ok(emailColumnScroll, "the bounded email column should retain its own content scroller");
    assert.equal(emailColumnScroll.style.overflowY, "auto", "long email content should scroll inside the email column");
    assert.ok(emailNodeRow.querySelector('[data-node-text-block-id="node-block-0"]'));
    assert.ok(emailNodeRow.querySelector('[data-node-chat-block-id="node-block-0"]'));
    assert.equal(emailNodeRow.querySelector('[data-node-chat-block-id="node-block-0"] [data-chat-pane-header="true"]'), null, "embedded Node chat should use the shared row header instead of rendering a second header");
    assert.match(nodeContainer.textContent ?? "", /Email for node-block-0/, "attached email should stay in the node-wide column");

    assert.equal(emailNodeRow.querySelector('[data-node-pane-header="editor"]')?.textContent?.includes("Editor"), true);
    assert.equal(emailNodeRow.querySelector('[data-node-pane-header="chat"]')?.textContent?.includes("Chat"), true);
    assert.doesNotMatch(emailColumn.textContent ?? "", /Attached emails/, "the email column should not repeat a redundant second header");
    assert.ok(Number.parseFloat(emailColumn.style.minHeight) >= 700, "the email column should cover at least the full fixed row while viewport sizing settles");
    assert.equal(emailFocusToggle.getAttribute("aria-expanded"), "false");
    assert.match(emailWorkspace.style.transition, /grid-template-columns 180ms/, "email focus mode should animate the column tracks");
    await act(async () => { emailFocusToggle.click(); });
    await flushWork();
    assert.equal(emailWorkspace.dataset.nodeEmailFocusMode, "expanded");
    assert.equal(emailFocusToggle.getAttribute("aria-expanded"), "true");
    assert.equal(emailFocusToggle.getAttribute("aria-label"), "Restore email layout");
    const timelineOnlyRail = nodeContainer.querySelector<HTMLElement>('[data-node-email-timeline-rail="true"]');
    assert.ok(timelineOnlyRail, "email focus mode should retain the text-box timeline rail");
    assert.equal(timelineOnlyRail.getAttribute("aria-hidden"), "true");
    const expandedTracks = emailWorkspace.style.gridTemplateColumns.split(/\s+/);
    assert.equal(expandedTracks[1], "0px", "email focus mode should remove the normal resize gap");
    assert.equal(expandedTracks[2], "38px", "email focus mode should leave only the compact timeline on the right");
    assert.ok(
      Number.parseFloat(expandedTracks[0] ?? "0") > Number.parseFloat(expandedTracks[2] ?? "0") * 5,
      "the focused email column should own the vast majority of workspace width",
    );
    await act(async () => { emailFocusToggle.click(); });
    await flushWork();
    assert.equal(emailWorkspace.dataset.nodeEmailFocusMode, "normal");
    assert.equal(emailFocusToggle.getAttribute("aria-expanded"), "false");
    assert.equal(emailFocusToggle.getAttribute("aria-label"), "Expand email column");
    assert.equal(nodeContainer.querySelector('[data-node-email-timeline-rail="true"]'), null);

    const linkedEmailToggle = emailNodeRow.querySelector<HTMLButtonElement>('button[aria-label="Show linked email"]');
    assert.ok(linkedEmailToggle, "a child-message-linked text box should expose a direct body expansion button");
    await act(async () => { linkedEmailToggle.click(); });
    await flushWork();
    assert.equal(linkedEmailToggle.getAttribute("aria-expanded"), "true");
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-linked-email-layout]')?.dataset.nodeLinkedEmailLayout, "content-column");
    assert.equal(linkedEmailToggle.getAttribute("aria-label"), "Hide linked email");
    const linkedEmailPreview = emailNodeRow.querySelector<HTMLElement>('[data-node-linked-email-preview="true"]');
    assert.ok(linkedEmailPreview, "the exact child message should resolve through its attached root thread and expand inside the text box");
    assert.equal(linkedEmailPreview.querySelectorAll('[data-email-single-message="true"]').length, 1, "the inline plane should contain exactly one email message");
    assert.equal(linkedEmailPreview.querySelector('[data-email-timeline-item="true"]'), null, "the inline plane should not render thread timeline chrome");
    assert.ok(linkedEmailPreview.querySelector('[data-email-message-id="message-node-block-0"]'), "the inline plane should render the linked child rather than its attached thread root");
    assert.doesNotMatch(linkedEmailPreview.textContent ?? "", /Earlier linked email body\./, "the inline plane should not include another message from the thread");
    assert.match(linkedEmailPreview.textContent ?? "", /From:\s*Sender Person <sender@example\.test>/);
    assert.match(linkedEmailPreview.textContent ?? "", /To:\s*Recipient Person <recipient@example\.test>/);
    assert.match(linkedEmailPreview.textContent ?? "", /Cc:\s*Copy Person <copy@example\.test>/);
    assert.match(linkedEmailPreview.textContent ?? "", /Bcc:\s*Blind Copy <blind@example\.test>/);
    assert.match(linkedEmailPreview.textContent ?? "", /Complete linked email body\./);
    const textBoxContentColumn = emailNodeRow.querySelector<HTMLElement>('[data-node-text-box-content-column="true"]');
    const textBoxPaneLayout = emailNodeRow.querySelector<HTMLElement>('[data-node-text-box-columns="editor-chat"]');
    const fullHeightChat = emailNodeRow.querySelector<HTMLElement>('[data-node-chat-block-id="node-block-0"]');
    assert.ok(textBoxContentColumn?.contains(linkedEmailPreview), "the linked email should stay inside the left content column");
    assert.ok(textBoxPaneLayout);
    assert.ok(fullHeightChat?.parentElement);
    assert.equal(textBoxPaneLayout.style.height, "auto", "the linked-email row should grow to show the complete message");
    assert.equal(textBoxContentColumn?.style.height, "auto");
    assert.equal(linkedEmailPreview.style.overflow, "visible");
    assert.equal(fullHeightChat.parentElement.style.height, "660px", "opening linked email must not shorten the independent chat column");
    await act(async () => { linkedEmailToggle.click(); });
    await flushWork();
    assert.equal(emailNodeRow.querySelector('[data-node-linked-email-preview="true"]'), null);
    assert.equal(linkedEmailToggle.getAttribute("aria-label"), "Show linked email");

    await act(async () => { nodeEmailToggle.click(); });
    await flushWork();
    const closedEmailColumn = nodeContainer.querySelector<HTMLElement>('[data-node-email-column="true"]');
    assert.ok(closedEmailColumn, "the Node-level email column shell should remain mounted for its exit transition");
    assert.equal(closedEmailColumn.dataset.nodeEmailColumnState, "closed");
    assert.equal(closedEmailColumn.getAttribute("aria-hidden"), "true");
    assert.equal(closedEmailColumn.style.opacity, "0");
    assert.match(emailWorkspace.style.gridTemplateColumns, /^0px 0px /, "the closed email track should animate to zero width without changing track count");
    scrolledIntoView.length = 0;
    const linkedTextBoxHeader = emailNodeRow.querySelector<HTMLElement>('[data-node-text-box-header="true"]');
    assert.ok(linkedTextBoxHeader);
    await act(async () => { linkedTextBoxHeader.click(); });
    await flushWork(24);
    assert.equal(closedEmailColumn.dataset.nodeEmailColumnState, "open", "clicking the linked text-box header should animate the retained email column open");
    assert.equal(closedEmailColumn.getAttribute("aria-hidden"), "false");
    assert.ok(scrolledIntoView.some((element) => element.dataset.emailMessageId === "message-node-block-0"), "the left email column should scroll to the exact child message linked to the text box");

    const textBoxActions = emailNodeRow.querySelector<HTMLButtonElement>('button[aria-label="Text box actions"]');
    assert.ok(textBoxActions);
    await act(async () => { textBoxActions.click(); });
    await flushWork();
    const textBoxActionsMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Text box actions"]');
    assert.ok(textBoxActionsMenu, "the three-dot button should reveal its Delete action");
    assert.equal(textBoxActionsMenu.style.position, "fixed", "the menu should escape the clipped fixed-height text-box row");
    const deleteTextBoxAction = Array.from(textBoxActionsMenu.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === "Delete");
    assert.ok(deleteTextBoxAction);
    await act(async () => { deleteTextBoxAction.click(); });
    await flushWork();
    assert.match(dom.window.document.body.textContent ?? "", /Are you sure you want to delete this\?/);
    const cancelDelete = Array.from(dom.window.document.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === "Cancel");
    if (cancelDelete) {
      await act(async () => { cancelDelete.click(); });
      await flushWork();
    }
    await act(async () => { chatToggle.click(); });
    await flushWork();
    assertNodePaneToggles(emailNodeRow, [true, false]);
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "editor-only");
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "email-with-text", "email and editor should remain distinct columns");

    await act(async () => { editorToggle.click(); });
    await flushWork();
    assertNodePaneToggles(emailNodeRow, [false, false]);
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "email-only", "email should own the full workspace when it is the only visible pane");

    await act(async () => { nodeEmailToggle.click(); });
    await flushWork();
    assert.equal(closedEmailColumn.dataset.nodeEmailColumnState, "closed");
    assert.equal(closedEmailColumn.style.pointerEvents, "none");
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "text-only");

    await act(async () => { editorToggle.click(); });
    await flushWork();
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "editor-only", "editor should own the row when it is the only visible pane");
    assert.ok(emailNodeRow.querySelector('[data-node-text-block-id="node-block-0"]'));

    await act(async () => { editorToggle.click(); });
    await flushWork();
    await act(async () => { chatToggle.click(); });
    await flushWork();
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "chat-only", "chat should own the row when it is the only visible pane");
    assert.ok(emailNodeRow.querySelector('[data-node-chat-block-id="node-block-0"]'));

    await act(async () => { nodeEmailToggle.click(); });
    await flushWork();
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "email-with-text", "email and chat should render as distinct columns");
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "chat-only");

    await act(async () => { editorToggle.click(); });
    await flushWork();
    assert.equal(emailWorkspace.dataset.nodeEmailWorkspaceMode, "email-with-text");
    assert.equal(emailNodeRow.querySelector<HTMLElement>('[data-node-visible-panes]')?.dataset.nodeVisiblePanes, "editor-chat", "all three pane types should render together");

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
      assertOnlyEditorOpen(row);
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

test("real Node, Project, and Logic Gate page hosts load JSON editors and preserve the unified HTML email column", { timeout: 20_000 }, async () => {
  const hostCompanyID = "json-page-host-company";
  const hostNodeID = "json-page-host-node";
  const hostProjectID = "json-page-host-project";
  const hostLogicGateID = "json-page-host-logic-gate";
  const hostNodeDocumentID = "json-node-document";
  const hostProjectDocumentID = "json-project-document";
  const hostLogicDocumentID = "json-logic-document";
  const dom = new JSDOM("<!doctype html><html><body><div id=\"node-json-root\"></div><div id=\"project-json-root\"></div><div id=\"logic-json-root\"></div></body></html>", {
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
  dom.window.sessionStorage.setItem("mangorts:active-company-id-v1", hostCompanyID);
  dom.window.localStorage.setItem("mangorts:active-company-id-v1", hostCompanyID);
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });

  let nextFrameID = 0;
  const frameTimers = new Map<number, ReturnType<typeof setTimeout>>();
  const requestFrame = (callback: FrameRequestCallback) => {
    const frameID = nextFrameID += 1;
    frameTimers.set(frameID, setTimeout(() => {
      frameTimers.delete(frameID);
      callback(Date.now());
    }, 0));
    return frameID;
  };
  const cancelFrame = (frameID: number) => {
    const timer = frameTimers.get(frameID);
    if (timer) clearTimeout(timer);
    frameTimers.delete(frameID);
  };
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);

  class HostResizeObserver {
    observe() { return undefined; }
    unobserve() { return undefined; }
    disconnect() { return undefined; }
  }
  const exactObservers: HostIntersectionObserver[] = [];
  class HostIntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds = [0];
    private targets = new Set<Element>();
    constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? "0px";
      if (this.rootMargin === "0px") exactObservers.push(this);
    }
    observe(target: Element) {
      this.targets.add(target);
      this.emit(target, this.rootMargin !== "0px");
    }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    takeRecords() { return []; }
    trigger(visible: boolean) {
      for (const target of this.targets) this.emit(target, visible);
    }
    private emit(target: Element, visible: boolean) {
      this.callback([{
        target,
        isIntersecting: visible,
        intersectionRatio: visible ? 1 : 0,
        boundingClientRect: target.getBoundingClientRect(),
        intersectionRect: target.getBoundingClientRect(),
        rootBounds: null,
        time: Date.now(),
      } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  installGlobal("ResizeObserver", HostResizeObserver, restores);
  installGlobal("IntersectionObserver", HostIntersectionObserver, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: HostResizeObserver });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: HostIntersectionObserver });

  const websocketScopes: string[] = [];
  const sockets: HostWebSocket[] = [];
  class HostWebSocket extends dom.window.EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readyState = HostWebSocket.CONNECTING;
    binaryType: BinaryType = "blob";
    bufferedAmount = 0;
    extensions = "";
    protocol = "";
    url: string;
    readonly scopes = new Set<string>();
    onclose: ((event: CloseEvent) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onmessage: ((event: MessageEvent) => void) | null = null;
    onopen: ((event: Event) => void) | null = null;
    constructor(url: string | URL) {
      super();
      this.url = String(url);
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = HostWebSocket.OPEN;
        this.onopen?.(new dom.window.Event("open"));
      });
    }
    close() {
      this.readyState = HostWebSocket.CLOSED;
      this.onclose?.(new dom.window.CloseEvent("close"));
    }
    send(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (typeof value !== "string") return;
      const payload = JSON.parse(value) as { type?: string; scope?: string };
      if (payload.type === "subscribe" && payload.scope) {
        websocketScopes.push(payload.scope);
        this.scopes.add(payload.scope);
      }
    }
    emitSnapshotRequired(resourceType: "node" | "project" | "logic_gate", resourceID: string, documentID: string, revision: number) {
      const scope = `editor-json:${resourceType}:${resourceID}:${documentID}`;
      this.onmessage?.(new dom.window.MessageEvent("message", { data: JSON.stringify({
        type: "editor.snapshot.required",
        company_id: hostCompanyID,
        scope,
        event_id: `event-${revision}`,
        resource_type: resourceType,
        resource_id: resourceID,
        document_id: documentID,
        resource_revision: revision,
        operation_id: `operation-${revision}`,
        client_id: "remote-client",
      }) }));
    }
  }
  installGlobal("WebSocket", HostWebSocket, restores);

  const tiptapDocument = (text: string) => ({
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        attrs: { blockId: `block-${text.toLowerCase().replace(/[^a-z]+/g, "-")}`, textAlign: "left", indentLevel: 0 },
        content: [{ type: "text", text }],
      }],
    },
  });
  type Canonical = { revision: number; schema_version: number; document: ReturnType<typeof tiptapDocument>; annotations: Array<{ id: string; kind: "comment" | "change" | "chat"; from: number; to: number }> };
  const canonicalDocuments = new Map<string, Canonical>([
    [hostNodeDocumentID, { revision: 1, schema_version: 1, document: tiptapDocument("Node JSON text"), annotations: [{ id: "node-page-change", kind: "change", from: 1, to: 5 }] }],
    [hostProjectDocumentID, { revision: 1, schema_version: 1, document: tiptapDocument("Project JSON text"), annotations: [{ id: "json-project-chat", kind: "chat", from: 1, to: 8 }] }],
    [hostLogicDocumentID, { revision: 1, schema_version: 1, document: tiptapDocument("Logic JSON text"), annotations: [] }],
  ]);
  const textProjectionInformation = (title: string, documentID: string) => TEXT_BLOCK_PREFIX + JSON.stringify({
    title,
    document: JSON.stringify(canonicalDocuments.get(documentID)?.document),
    attachments: [],
  });
  const now = "2026-07-20T12:00:00.000Z";
  const nodeProjection: NodeProjectionItem = {
    company_id: hostCompanyID,
    node_id: hostNodeID,
    information_id: hostNodeDocumentID,
    type: "Text box",
    information: textProjectionInformation("Node JSON block", hostNodeDocumentID),
    revision: 1,
    created_timestamp: now,
    updated_timestamp: now,
  };
  const nodeUnseenChanges = [{
    company_id: hostCompanyID,
    change_id: "node-page-change",
    node_id: hostNodeID,
    information_id: hostNodeDocumentID,
    change_type: "addition" as const,
    text: "Node",
    start_offset: 1,
    end_offset: 5,
    actor_user_id: "remote-user",
    actor_display_name: "Remote User",
    created_timestamp: now,
  }];
  const attachedEmail: NodeProjectionItem = {
    company_id: hostCompanyID,
    node_id: hostNodeID,
    information_id: "json-host-email",
    type: "Attached email",
    information: buildEditorAttachedEmailPayload({
      blockID: hostNodeDocumentID,
      messageID: "durable-html-message",
      emailMessageID: "internal-durable-html-message",
      threadID: "durable-html-thread",
      emailThreadID: "durable-provider-independent-thread",
      subject: "HTML email stays outside Tiptap",
      snippet: "<p><em>Rich HTML snapshot</em></p>",
      from: "sender@example.test",
      attachedTimestamp: now,
    }),
    revision: 1,
    created_timestamp: now,
    updated_timestamp: now,
  };
  const projectProjection: ProjectProjection = {
    company_id: hostCompanyID,
    project_id: hostProjectID,
    information_id: hostProjectDocumentID,
    type: "Text box",
    information: textProjectionInformation("Project JSON block", hostProjectDocumentID),
    created_timestamp: now,
    updated_timestamp: now,
  };
  const projectChatProjection: ProjectProjection = {
    company_id: hostCompanyID,
    project_id: hostProjectID,
    information_id: "json-project-chat",
    type: "Text block chat",
    information: buildEditorTextBlockChatPayload({
      blockID: hostProjectDocumentID,
      selectionStart: 1,
      selectionEnd: 8,
      authorID: "remote-user",
      authorName: "Remote User",
      message: "Project anchored chat",
      createdTimestamp: now,
    }),
    created_timestamp: now,
    updated_timestamp: now,
  };
  const logicProjection = {
    company_id: hostCompanyID,
    logic_gate_id: hostLogicGateID,
    information_id: hostLogicDocumentID,
    type: "Text box",
    information: JSON.stringify(canonicalDocuments.get(hostLogicDocumentID)?.document),
    revision: 1,
    created_timestamp: now,
    updated_timestamp: now,
  };
  const requestedPaths: string[] = [];
  let ticketRequests = 0;
  const route = (pathname: string, method: string, body: unknown): unknown => {
    requestedPaths.push(`${method} ${pathname}`);
    if (pathname === "/v1/editor-data-format") return {
      company_id: hostCompanyID,
      editor_format: "tiptap_json",
      migration_state: "ready",
      document_schema_version: 1,
      expected_document_count: 3,
      converted_document_count: 3,
    };
    if (pathname.startsWith("/v1/editor-json/")) {
      if (pathname.endsWith("/collaboration-ticket")) {
        ticketRequests += 1;
        const prefix = pathname.slice(0, -"/collaboration-ticket".length);
        const documentID = decodeURIComponent(prefix.split("/documents/")[1] ?? "");
        const resourceParts = prefix.slice("/v1/editor-json/".length).split("/");
        const ownerType = resourceParts[0];
        const ownerID = resourceParts[1];
        return {
          token: "test-collaboration-token",
          document_name: `editor-owner:${ownerType}:${hostCompanyID}:${ownerID}:${Buffer.from(documentID).toString("base64url")}:00000000-0000-4000-8000-000000000001`,
          collaboration_epoch: "00000000-0000-4000-8000-000000000001",
        };
      }
      const documentID = decodeURIComponent(pathname.split("/documents/")[1] ?? "");
      const current = canonicalDocuments.get(documentID);
      assert.ok(current, `unexpected JSON document ${documentID}`);
      if (method === "POST") {
        const commit = body as { document: Canonical["document"]; annotations?: Canonical["annotations"] };
        const next = { ...current, revision: current.revision + 1, document: commit.document, annotations: commit.annotations ?? [] };
        canonicalDocuments.set(documentID, next);
        return next;
      }
      return current;
    }
    if (pathname === `/v1/projects/${hostProjectID}`) return projectView([projectProjection, projectChatProjection]);
    if (pathname === `/v2/logic-gates/${hostLogicGateID}/view`) return {
      company_id: hostCompanyID,
      logic_gate_id: hostLogicGateID,
      logic_gate: {
        company_id: hostCompanyID,
        logic_gate_id: hostLogicGateID,
        header: "JSON Logic Gate",
        can_edit: true,
        effective_access_level: "write",
        gvic_assignments: [],
        created_timestamp: now,
        updated_timestamp: now,
      },
      information: [logicProjection],
      projections: [logicProjection],
      relationships: [],
      information_count: 1,
      relationships_count: 0,
      can_edit: true,
      effective_access_level: "write",
      editor_sequence: 1,
    };
    if (pathname === "/v1/me") return {
      user: { user_id: "json-page-user", email: "json@example.test", display_name: "JSON Page User" },
      memberships: [],
      is_dev_admin: false,
    };
    if (pathname === "/v1/realtime/ticket") {
      ticketRequests += 1;
      return { expires_at: "2026-07-20T13:00:00.000Z" };
    }
    if (pathname.endsWith("/users")) return { users: [] };
    if (pathname.endsWith("/user-groups")) return { groups: [], members: [] };
    if (pathname.includes("save-versions")) return { versions: [] };
    if (pathname.includes("content-changes")) return { changes: [] };
    if (pathname.includes("/gvic")) return { gvic_assignments: [] };
    if (pathname.includes("attachments")) return { attachments: [] };
    if (pathname.includes("relationships")) return { relationships: [] };
    if (pathname.includes("accounts")) return { accounts: [] };
    return { projects: [], logic_gates: [], results: [], information: [], projections: [] };
  };
  const fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input), dom.window.location.href);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" && init.body ? JSON.parse(init.body) : undefined;
    return jsonResponse(route(url.pathname, method, body));
  };
  installGlobal("fetch", fetchImplementation, restores);
  dom.window.fetch = fetchImplementation;
  const nodeRequestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const url = new URL(path, dom.window.location.href);
    return route(url.pathname, (init?.method ?? "GET").toUpperCase(), init?.json) as T;
  };
  const waitFor = async (condition: () => boolean, message: string, attempts = 120) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (condition()) return;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
    assert.fail(message);
  };

  let nodeRoot: { render(value: React.ReactNode): void; unmount(): void } | null = null;
  let projectRoot: { render(value: React.ReactNode): void; unmount(): void } | null = null;
  let logicRoot: { render(value: React.ReactNode): void; unmount(): void } | null = null;
  try {
    const [{ createRoot }, { NodeWorkspaceSurface }, { ProjectSummaryContent }, { EditorContent }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurface.tsx"),
      import("../../../../frontend/src/modules/project-management/ProjectSummaryContent.tsx"),
      import("../../../../frontend/src/modules/editor/EditorContent.tsx"),
    ]);
    const noop = () => undefined;
    const nodeContainer = dom.window.document.getElementById("node-json-root");
    const projectContainer = dom.window.document.getElementById("project-json-root");
    const logicContainer = dom.window.document.getElementById("logic-json-root");
    assert.ok(nodeContainer && projectContainer && logicContainer);
    nodeRoot = createRoot(nodeContainer);
    projectRoot = createRoot(projectContainer);
    logicRoot = createRoot(logicContainer);
    await act(async () => {
      nodeRoot?.render(<NodeWorkspaceSurface
        apiBase="http://localhost"
        companyID={hostCompanyID}
        scope={`node:${hostNodeID}`}
        nodeID={hostNodeID}
        canEdit
        nodePriorityDraft="3"
        assignedLogicGateIDs={[]}
        projections={[nodeProjection, attachedEmail]}
        unseenChanges={nodeUnseenChanges}
        companyUsers={[]}
        projectionsLoaded
        editorSequence={1}
        topPx={0}
        accent="#7c3aed"
        surfaceText="#172033"
        panelBackground="#ffffff"
        strokeColor="#dbeafe"
        ruleColor="#cbd5e1"
        scrollbarAccent="#7c3aed"
        scrollbarTrack="#e2e8f0"
        outlineStyle="automatic-outline-numbering"
        requestJSON={nodeRequestJSON}
        onProjectionMutation={noop}
        onMarkChangeSeen={noop}
        onMarkAllChangesSeen={noop}
        onCreateNodeFromImage={async () => undefined}
        onAssignToLogicGate={async () => undefined}
        onRequireNodePriorityForLogicGateAssignment={noop}
        onError={noop}
      />);
      projectRoot?.render(<ProjectSummaryContent
        projectID={hostProjectID}
        accent="#7c3aed"
        onBack={noop}
        workspace={{ nodeFolders: [], nodeFolderItems: [], nodes: [], logicGateFolders: [], logicGateFolderItems: [], logicGates: [] }}
      />);
      logicRoot?.render(<EditorContent
        accent="#7c3aed"
        forcedEntityKind="logic_gate"
        forcedEntityID={hostLogicGateID}
        forcedLabel="JSON Logic Gate"
      />);
    });

    await waitFor(
      () => nodeContainer.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length === 1
        && projectContainer.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length === 1
        && logicContainer.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length === 1,
      "all three actual page hosts should mount their JSON editor path",
    );
    const nodeEditor = nodeContainer.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    const projectEditor = projectContainer.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    const logicEditor = logicContainer.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    assert.ok(nodeEditor && projectEditor && logicEditor);
    assert.equal(projectEditor.dataset.mangoEditorSyncMode, "revisioned-json");
    assert.equal(logicEditor.dataset.mangoEditorSyncMode, "revisioned-json");
    await waitFor(
      () => [nodeEditor, projectEditor, logicEditor].every((editor) => editor.dataset.mangoEditorState === "sleeping"),
      "offscreen page-host editors should prepare a sleeping static renderer",
    );
    assert.equal(websocketScopes.filter((scope) => scope.startsWith("editor-json:")).length, 0, "near-viewport preparation must not subscribe any offscreen JSON editor");
    await waitFor(
      () => Boolean(nodeEditor.querySelector('[data-mango-annotation-id="node-page-change"]'))
        && Boolean(projectEditor.querySelector('[data-mango-annotation-id="json-project-chat"]')),
      "sleeping Node and Project page hosts should merge backend positions into their real change/chat owners",
    );
    assert.equal(nodeEditor.querySelector('[data-mango-annotation-id="node-page-change"]')?.textContent, "Node");
    assert.equal(projectEditor.querySelector('[data-mango-annotation-id="json-project-chat"]')?.textContent, "Project");
    assert.match(logicEditor.textContent ?? "", /Logic JSON text/);
    assert.ok(requestedPaths.some((path) => path.includes(`/v1/editor-json/node/${hostNodeID}/documents/${hostNodeDocumentID}`)));
    assert.ok(requestedPaths.some((path) => path.includes(`/v1/editor-json/project/${hostProjectID}/documents/${hostProjectDocumentID}`)));
    assert.ok(requestedPaths.some((path) => path.includes(`/v1/editor-json/logic_gate/${hostLogicGateID}/documents/${hostLogicDocumentID}`)));

    const emailColumn = nodeContainer.querySelector<HTMLElement>('[data-node-email-column="true"]');
    assert.ok(emailColumn, "the Node host should retain one unified email column in JSON mode");
    assert.match(emailColumn.textContent ?? "", /HTML email stays outside Tiptap/);
    assert.equal(emailColumn.querySelector('[data-mango-editor-format="tiptap_json"]'), null, "email display must not enter the Tiptap path");
    assert.ok(nodeContainer.querySelector('button[aria-label="Toggle node email column"]'));
    assert.equal(nodeContainer.querySelector('[data-node-text-box-row] button[aria-label="Toggle email column"]'), null, "per-row email panes remain removed");

    for (const observer of exactObservers) observer.trigger(true);
    await waitFor(
      () => ticketRequests > 0
        && websocketScopes.some((scope) => scope === `editor-json:node:${hostNodeID}:${hostNodeDocumentID}`)
        && websocketScopes.some((scope) => scope === `editor-json:project:${hostProjectID}:${hostProjectDocumentID}`)
        && websocketScopes.some((scope) => scope === `editor-json:logic_gate:${hostLogicGateID}:${hostLogicDocumentID}`),
      "visible page-host editors should request their configured realtime sync path",
    );
    assert.equal(
      websocketScopes.some((scope) => scope === `editor-json:project:${hostProjectID}:${hostProjectDocumentID}`
        || scope === `editor-json:logic_gate:${hostLogicGateID}:${hostLogicDocumentID}`),
      true,
      "without a collaboration URL, Project and Logic Gate editors use revisioned JSON realtime recovery",
    );
    assert.equal(nodeEditor.dataset.mangoEditorState, "sleeping", "visibility alone keeps the page-host editor static until focus");

    canonicalDocuments.set(hostNodeDocumentID, {
      revision: 2,
      schema_version: 1,
      document: tiptapDocument("Live Node JSON text"),
      annotations: [{ id: "node-page-change", kind: "change", from: 1, to: 5 }],
    });
    const nodeSocket = sockets.find((socket) => socket.scopes.has(`editor-json:node:${hostNodeID}:${hostNodeDocumentID}`));
    assert.ok(nodeSocket);
    nodeSocket.emitSnapshotRequired("node", hostNodeID, hostNodeDocumentID, 2);
    await waitFor(
      () => (nodeEditor.textContent ?? "").includes("Live Node JSON text")
        && nodeEditor.querySelector('[data-mango-annotation-id="node-page-change"]')?.textContent === "Live",
      "a visible sleeping page-host renderer should receive live document and highlight updates",
    );

    for (const observer of exactObservers) observer.trigger(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  } finally {
    if (nodeRoot) await act(async () => { nodeRoot?.unmount(); });
    if (projectRoot) await act(async () => { projectRoot?.unmount(); });
    if (logicRoot) await act(async () => { logicRoot?.unmount(); });
    for (const timer of frameTimers.values()) clearTimeout(timer);
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

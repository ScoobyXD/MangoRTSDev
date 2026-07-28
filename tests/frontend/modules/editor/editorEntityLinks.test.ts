import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";

import { sanitizeEditorDocumentHTML } from "../../../../frontend/src/modules/editor/richTextEditing.js";
import { calculateEditorSelectionActionPosition } from "../../../../frontend/src/modules/editor/editorSelectionActions.js";
import {
  createEditorEntityLinkElement,
  createNodeEntityFromSelection,
  editorEntityRoute,
  normalizeEditorSelectionNodeTitle,
  openEditorEntityLink,
  readActiveEntityLinkDraft,
  readEditorEntityLinkElement,
  readEditorEntitySourceNodePath,
  replaceEditorEntityLinkWithLabel,
  returnToEditorEntitySourceNode,
  searchEditorEntityLinks,
} from "../../../../frontend/src/modules/editor/editorEntityLinks.js";

test("highlighted-text actions keep the square-plus button immediately right of the chat button", () => {
  const rect = { left: 80, right: 120, top: 40, height: 20 };
  const chat = calculateEditorSelectionActionPosition({
    rect,
    isForwardSelection: true,
    boundaryWidth: 500,
    rightInset: 36,
  });
  const createNode = calculateEditorSelectionActionPosition({
    rect,
    isForwardSelection: true,
    boundaryWidth: 500,
    offsetX: 36,
  });
  assert.deepEqual(chat, { left: 128, top: 36 });
  assert.deepEqual(createNode, { left: 164, top: 36 });
  assert.equal(createNode.left - chat.left, 36);

  const edgeChat = calculateEditorSelectionActionPosition({
    rect: { left: 175, right: 198, top: 40, height: 20 },
    isForwardSelection: true,
    boundaryWidth: 200,
    rightInset: 36,
  });
  const edgeCreateNode = calculateEditorSelectionActionPosition({
    rect: { left: 175, right: 198, top: 40, height: 20 },
    isForwardSelection: true,
    boundaryWidth: 200,
    offsetX: 36,
  });
  assert.equal(edgeCreateNode.left - edgeChat.left, 36);

  const reverseEdgeChat = calculateEditorSelectionActionPosition({
    rect: { left: 10, right: 40, top: 40, height: 20 },
    isForwardSelection: false,
    boundaryWidth: 200,
    rightInset: 36,
  });
  const reverseEdgeCreateNode = calculateEditorSelectionActionPosition({
    rect: { left: 10, right: 40, top: 40, height: 20 },
    isForwardSelection: false,
    boundaryWidth: 200,
    offsetX: 36,
  });
  assert.equal(reverseEdgeCreateNode.left - reverseEdgeChat.left, 36);

  const iconSource = readFileSync("frontend/src/modules/editor/EditorSelectionNodeIcon.tsx", "utf8");
  assert.match(iconSource, /<rect x="5" y="5" width="14" height="14"/);
  assert.match(iconSource, /<path d="M9 12h6M12 9v6"/);
});

test("# entity drafts respect text boundaries and allow a searchable phrase", () => {
  assert.deepEqual(readActiveEntityLinkDraft("Link #road map", 14), {
    start: 5,
    end: 14,
    query: "road map",
    trigger: "#",
  });
  assert.equal(readActiveEntityLinkDraft("word#road", 9), null);
  assert.equal(readActiveEntityLinkDraft("#road ", 6)?.query, "road ");
  assert.equal(readActiveEntityLinkDraft("#road,", 6), null);
});

test("entity search requests scoped Nodes, Logic Gates, and Projects and keeps ranked API order", async () => {
  let requestedPath = "";
  const results = await searchEditorEntityLinks({
    companyID: "company-1",
    requestJSON: async <T>(path: string): Promise<T> => {
      requestedPath = path;
      return {
        results: [
          { resource_type: "project", resource_id: "project-1", display_name: "Roadmap" },
          { resource_type: "node", resource_id: "node-1", display_name: "Roadmap task" },
          { resource_type: "logic_gate", resource_id: "gate-1", display_name: "Roadmap review" },
          { resource_type: "folder", resource_id: "folder-1", display_name: "Ignored" },
          { resource_type: "node", resource_id: "node-1", display_name: "Duplicate" },
        ],
      } as T;
    },
  }, "road");

  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.pathname, "/v1/company-explorer/search");
  assert.equal(url.searchParams.get("company_id"), "company-1");
  assert.equal(url.searchParams.get("q"), "road");
  assert.equal(url.searchParams.get("resource_types"), "node,logic_gate,project");
  assert.equal(url.searchParams.get("ranking"), "editor_entities");
  assert.deepEqual(results.map((entity) => entity.entityType), ["project", "node", "logic_gate"]);
});

test("selection Node creation normalizes the exact title and returns a durable entity", async () => {
  let submittedBody: Record<string, unknown> | undefined;
  const entity = await createNodeEntityFromSelection({
    companyID: "company-1",
    requestJSON: async <T>(path: string, init?: RequestInit): Promise<T> => {
      assert.equal(path, "/v1/workspace/entity-batches");
      submittedBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
      return {
        nodes: [{
          company_id: "company-1",
          node_id: "node-created",
          name: "Create this Node",
          created_timestamp: "2026-07-21T12:00:00Z",
        }],
        relationships: [],
        folder_items: [],
        node_map_positions: [],
      } as T;
    },
  }, "  Create\n this   Node  ");

  assert.equal(normalizeEditorSelectionNodeTitle("  Create\n this   Node  "), "Create this Node");
  assert.equal((submittedBody?.items as Array<{ name: string }>)[0]?.name, "Create this Node");
  assert.deepEqual(entity, {
    entityType: "node",
    entityID: "node-created",
    label: "Create this Node",
    updatedTimestamp: "2026-07-21T12:00:00Z",
  });
});

test("legacy entity chips preserve identity, type styling, and routes", () => {
  const dom = new JSDOM("<!doctype html>");
  const domGlobals = dom.window as unknown as typeof globalThis;
  const previousHTMLElement = globalThis.HTMLElement;
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  try {
    const element = createEditorEntityLinkElement(dom.window.document, {
      entityType: "logic_gate",
      entityID: "gate one",
      label: "Approval gate",
    });
    assert.equal(element.getAttribute("contenteditable"), "false");
    assert.equal(element.classList.contains("mango-editor-entity-link--logic_gate"), true);
    assert.deepEqual(readEditorEntityLinkElement(element), {
      entityType: "logic_gate",
      entityID: "gate one",
      label: "Approval gate",
    });
    assert.equal(editorEntityRoute({ entityType: "logic_gate", entityID: "gate one" }), "/logic-gates/gate%20one");
  } finally {
    if (previousHTMLElement === undefined) delete (globalThis as Record<string, unknown>).HTMLElement;
    else Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: previousHTMLElement });
    dom.window.close();
  }
});

test("entity chips render the canonical Node, Logic Gate, and Project icons", () => {
  const dom = new JSDOM("<!doctype html>");
  try {
    const icons = [
      ["node", "M3.7 1.7h5.45l3.15 3.15v9.45H3.7z"],
      ["logic_gate", "M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z"],
      ["project", "M2.3 3.1h11.4v9.8H2.3z"],
    ] as const;
    for (const [entityType, expectedPath] of icons) {
      const element = createEditorEntityLinkElement(dom.window.document, {
        entityType,
        entityID: `${entityType}-1`,
        label: `${entityType} name`,
      });
      const icon = element.querySelector("svg.mango-editor-entity-icon");
      if (!icon) throw new Error(`${entityType} should render an SVG icon`);
      assert.ok(
        [...icon.querySelectorAll("path")].some((pathElement) => pathElement.getAttribute("d") === expectedPath),
        `${entityType} should use its canonical product icon path`,
      );
      assert.equal(element.querySelector(".mango-editor-entity-label")?.textContent, `${entityType} name`);
    }
  } finally {
    dom.window.close();
  }
});

test("entity clicks navigate inside the app and Node-to-Node links retain a safe return marker", () => {
  const dom = new JSDOM("<!doctype html>", { url: "https://mango.test/nodes/source-node" });
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  let popStateCount = 0;
  let historyBackCount = 0;
  dom.window.addEventListener("popstate", () => { popStateCount += 1; });
  Object.defineProperty(dom.window.history, "back", { configurable: true, value: () => { historyBackCount += 1; } });
  try {
    openEditorEntityLink({ entityType: "node", entityID: "target-node", label: "Target Node" });
    assert.equal(dom.window.location.pathname, "/nodes/target-node");
    assert.equal(popStateCount, 1);
    assert.equal(readEditorEntitySourceNodePath("target-node", dom.window.history.state), "/nodes/source-node");
    assert.equal(returnToEditorEntitySourceNode("target-node"), true);
    assert.equal(historyBackCount, 1);
    assert.equal(returnToEditorEntitySourceNode("another-node"), false);

    dom.window.history.replaceState({}, "", "/nodes/source-node");
    openEditorEntityLink({ entityType: "project", entityID: "project-1", label: "Project One" });
    assert.equal(dom.window.location.pathname, "/projects/project-1");
    assert.equal(popStateCount, 2);
    assert.equal(readEditorEntitySourceNodePath("target-node", dom.window.history.state), null);
  } finally {
    if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    dom.window.close();
  }
});

test("Backspace unwrapping replaces a legacy entity chip with its ordinary label text", () => {
  const dom = new JSDOM('<!doctype html><body><div id="editor" contenteditable="true"></div></body>');
  const domGlobals = dom.window as unknown as typeof globalThis;
  const previousHTMLElement = globalThis.HTMLElement;
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  try {
    const root = dom.window.document.querySelector<HTMLElement>("#editor");
    if (!root) throw new Error("missing editor");
    root.append("Before ");
    root.append(createEditorEntityLinkElement(dom.window.document, {
      entityType: "node",
      entityID: "node-1",
      label: "Restored Node title",
    }));
    const range = dom.window.document.createRange();
    range.setStart(root, root.childNodes.length);
    range.collapse(true);
    const selection = dom.window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    assert.equal(replaceEditorEntityLinkWithLabel(root), true);
    assert.equal(root.querySelector('[data-mango-entity-link="true"]'), null);
    assert.equal(root.textContent, "Before Restored Node title");
    assert.equal(selection?.anchorNode?.textContent, "Restored Node title");
    assert.equal(selection?.anchorOffset, "Restored Node title".length);
  } finally {
    if (previousHTMLElement === undefined) delete (globalThis as Record<string, unknown>).HTMLElement;
    else Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: previousHTMLElement });
    dom.window.close();
  }
});

test("legacy rich HTML sanitization retains only canonical entity-link data", () => {
  const dom = new JSDOM("<!doctype html>");
  const domGlobals = dom.window as unknown as typeof globalThis;
  const names = ["document", "Node", "Element", "HTMLElement", "HTMLLIElement", "HTMLSpanElement", "HTMLTableCellElement", "HTMLUListElement"] as const;
  const previous = new Map<string, unknown>();
  for (const name of names) {
    previous.set(name, (globalThis as unknown as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "document" ? dom.window.document : (domGlobals as unknown as Record<string, unknown>)[name] });
  }
  try {
    const sanitized = sanitizeEditorDocumentHTML('<span data-mango-entity-link="true" data-mango-entity-type="project" data-mango-entity-id="project-1" data-mango-entity-label="Roadmap" onclick="steal()" style="position:fixed">Spoofed</span>');
    assert.match(sanitized, /data-mango-entity-link="true"/);
    assert.match(sanitized, /data-mango-entity-type="project"/);
    assert.match(sanitized, /data-mango-entity-id="project-1"/);
    assert.match(sanitized, /data-mango-entity-label="Roadmap"/);
    assert.match(sanitized, />Roadmap<\/span>/);
    assert.doesNotMatch(sanitized, /onclick|position:fixed|Spoofed/);
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    dom.window.close();
  }
});

test("# entity menu selects its top result with Tab and the entity participates in history", async () => {
  const dom = new JSDOM("<!doctype html><div id=\"editor\"></div>", { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  const names = ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "KeyboardEvent"] as const;
  const previous = new Map<string, unknown>();
  for (const name of names) {
    previous.set(name, (globalThis as unknown as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : (domGlobals as unknown as Record<string, unknown>)[name] });
  }
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancelRAF = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (handle: number) => clearTimeout(handle) });
  if (!domGlobals.Range.prototype.getClientRects) domGlobals.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!domGlobals.Range.prototype.getBoundingClientRect) domGlobals.Range.prototype.getBoundingClientRect = () => new domGlobals.DOMRect();
  const queries: string[] = [];
  const editor = new MangoTiptapEditorEngine({
    element: dom.window.document.querySelector<HTMLElement>("#editor"),
    extensions: createMangoTiptapExtensions({
      editable: true,
      searchEntityLinks: async (query) => {
        queries.push(query);
        return [
          { entityType: "project", entityID: "project-1", label: "Most recent project" },
          { entityType: "node", entityID: "node-1", label: "Second Node" },
        ];
      },
    }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  try {
    editor.commands.focus();
    editor.commands.insertContent("#");
    for (let index = 0; index < 50 && !dom.window.document.querySelector('[data-mango-tiptap-entity-menu="true"] [role="option"]'); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.deepEqual(queries, [""]);
    const entityMenu = dom.window.document.querySelector<HTMLElement>('[data-mango-tiptap-entity-menu="true"]');
    assert.equal(entityMenu?.dataset.side, "bottom");
    assert.equal(entityMenu?.classList.contains("mango-tiptap-suggestion-menu--entity"), true);
    assert.equal(entityMenu?.querySelector('[role="option"]')?.classList.contains("mango-tiptap-suggestion-option--entity"), true);
    assert.ok(entityMenu?.querySelector(".mango-tiptap-suggestion-product-icon"));
    editor.view.dom.dispatchEvent(new domGlobals.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    const inserted = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "mangoEntityLink") as { attrs?: Record<string, unknown> } | undefined;
    assert.equal(inserted?.attrs?.entityType, "project");
    assert.equal(inserted?.attrs?.entityId, "project-1");
    assert.equal(inserted?.attrs?.label, "Most recent project");
    assert.match(editor.getHTML(), /data-mango-entity-id="project-1"/);
    assert.match(editor.getHTML(), /mango-editor-entity-icon/);
    assert.match(editor.getHTML(), /M2.3 3.1h11.4v9.8H2.3z/);
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.getJSON().content?.[0]?.content?.some((node) => node.type === "mangoEntityLink") ?? false, false);
    assert.equal(editor.commands.redo(), true);
    assert.equal(editor.getJSON().content?.[0]?.content?.some((node) => node.type === "mangoEntityLink"), true);

    let entityEnd = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "mangoEntityLink") return true;
      entityEnd = position + node.nodeSize;
      return false;
    });
    assert.ok(entityEnd > 0);
    editor.commands.setTextSelection(entityEnd);
    editor.view.dom.dispatchEvent(new domGlobals.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    assert.equal(editor.getJSON().content?.[0]?.content?.some((node) => node.type === "mangoEntityLink") ?? false, false);
    assert.match(editor.state.doc.textContent, /Most recent project/);
    assert.equal(editor.commands.undo(), true);
    assert.equal(editor.getJSON().content?.[0]?.content?.some((node) => node.type === "mangoEntityLink"), true);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    if (previousRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame;
    else Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: previousRAF });
    if (previousCancelRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame;
    else Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: previousCancelRAF });
  }
});
test("@ mention menu reads people loaded after editor creation and inserts an atomic colorful chip", async () => {
  const dom = new JSDOM("<!doctype html><div id=\"editor\"></div>", { url: "https://mango.test/" });
  const domGlobals = dom.window as unknown as typeof globalThis;
  const names = ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "KeyboardEvent"] as const;
  const previous = new Map<string, unknown>();
  for (const name of names) {
    previous.set(name, (globalThis as unknown as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, { configurable: true, value: name === "window" ? dom.window : name === "document" ? dom.window.document : (domGlobals as unknown as Record<string, unknown>)[name] });
  }
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancelRAF = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: (handle: number) => clearTimeout(handle) });
  if (!domGlobals.Range.prototype.getClientRects) domGlobals.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!domGlobals.Range.prototype.getBoundingClientRect) domGlobals.Range.prototype.getBoundingClientRect = () => new domGlobals.DOMRect(40, 30, 0, 20);
  let people: ReadonlyArray<{ userID: string; name: string; email?: string }> = [];
  const editor = new MangoTiptapEditorEngine({
    element: dom.window.document.querySelector<HTMLElement>("#editor"),
    extensions: createMangoTiptapExtensions({ editable: true, getMentionUsers: () => people }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  try {
    people = [{ userID: "user-1", name: "Christina Phan", email: "christina.phan@example.com" }];
    editor.commands.focus();
    editor.commands.insertContent("@");
    for (let index = 0; index < 50 && !dom.window.document.querySelector('[data-mango-tiptap-mention-menu="true"] [role="option"]'); index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const menu = dom.window.document.querySelector<HTMLElement>('[data-mango-tiptap-mention-menu="true"]');
    const option = menu?.querySelector<HTMLElement>('[role="option"]');
    assert.equal(menu?.dataset.side, "bottom");
    assert.equal(menu?.classList.contains("mango-tiptap-suggestion-menu"), true);
    assert.equal(option?.classList.contains("mango-tiptap-suggestion-option--person"), true);
    assert.equal(option?.querySelector(".mango-tiptap-suggestion-label")?.textContent, "Christina Phan");
    assert.equal(option?.querySelector(".mango-tiptap-suggestion-meta")?.textContent, "christina.phan@example.com");
    assert.equal(option?.querySelector(".mango-tiptap-suggestion-avatar")?.textContent, "CP");
    editor.view.dom.dispatchEvent(new domGlobals.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    const inserted = editor.getJSON().content?.[0]?.content?.find((node) => node.type === "mention") as { attrs?: Record<string, unknown> } | undefined;
    assert.equal(inserted?.attrs?.userId, "user-1");
    assert.equal(inserted?.attrs?.label, "Christina Phan");
    assert.equal(inserted?.attrs?.kind, "normal");
    assert.match(editor.getHTML(), /mango-tiptap-mention--normal/);
  } finally {
    editor.destroy();
    dom.window.close();
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    if (previousRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame;
    else Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: previousRAF });
    if (previousCancelRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame;
    else Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: previousCancelRAF });
  }
});

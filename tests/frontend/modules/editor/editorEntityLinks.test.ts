import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

import { ACTION_ITEM_TARGET_ARROW_PATH, createActionItemIconElement } from "../../../../frontend/src/icons/ActionItemIcon.js";
import { createExplorerEntityIconElement } from "../../../../frontend/src/icons/EntityIcons.js";

import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";

import { sanitizeEditorDocumentHTML } from "../../../../frontend/src/modules/editor/richTextEditing.js";
import { calculateEditorSelectionActionPosition } from "../../../../frontend/src/modules/editor/editorSelectionActions.js";
import {
  createActionItemEntityFromSelection,
  createEditorEntityLinkElement,
  createNodeEntityFromSelection,
  editorEntityRoute,
  EVENT_EDITOR_EMAIL_REFERENCE_OPEN,
  EVENT_EDITOR_ENTITY_REFERENCE_OPEN,
  EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION,
  normalizeEditorSelectionActionItemName,
  normalizeEditorSelectionNodeTitle,
  openEditorEntityLink,
  readActiveEntityLinkDraft,
  readEditorEntityLinkElement,
  readEditorEntitySourceNodePath,
  replaceEditorEntityLinkWithLabel,
  returnToEditorEntitySourceNode,
  searchEditorEntityLinks,
  updateRenderedEditorEntityReference,
  type EditorEntityLink,
  type EditorEntityReferenceOpenDetail,
  type EditorEntityReferencePresentation,
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

  const scrolledChat = calculateEditorSelectionActionPosition({
    rect,
    isForwardSelection: true,
    boundaryWidth: 500,
    rightInset: 36,
    scrollLeft: 10,
    scrollTop: 300,
  });
  assert.deepEqual(scrolledChat, { left: 138, top: 336 });

  const iconSource = readFileSync("frontend/src/icons/EditorSelectionNodeIcon.tsx", "utf8");
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

test("entity search groups Nodes, Processes, and Projects in product order and forwards cancellation", async () => {
  let requestedPath = "";
  let requestedSignal: AbortSignal | null | undefined;
  const controller = new AbortController();
  const results = await searchEditorEntityLinks({
    companyID: "company-1",
    requestJSON: async <T>(path: string, init?: RequestInit): Promise<T> => {
      requestedPath = path;
      requestedSignal = init?.signal;
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
  }, "road", 20, ["node", "logic_gate", "project"], controller.signal);

  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.pathname, "/v1/company-explorer/search");
  assert.equal(url.searchParams.get("company_id"), "company-1");
  assert.equal(url.searchParams.get("q"), "road");
  assert.equal(url.searchParams.get("resource_types"), "node,logic_gate,project");
  assert.equal(url.searchParams.get("ranking"), "editor_entities");
  assert.equal(requestedSignal, controller.signal);
  assert.deepEqual(results.map((entity) => entity.entityType), ["node", "logic_gate", "project"]);
});

test("entity search requests and returns only the selected picker category", async () => {
  let requestedPath = "";
  const results = await searchEditorEntityLinks({
    companyID: "company-1",
    requestJSON: async <T>(path: string): Promise<T> => {
      requestedPath = path;
      return {
        results: [
          { resource_type: "node", resource_id: "node-1", display_name: "Ignored Node" },
          { resource_type: "project", resource_id: "project-1", display_name: "Launch" },
        ],
      } as T;
    },
  }, "launch", 20, ["project"]);

  const url = new URL(requestedPath, "https://mango.test");
  assert.equal(url.searchParams.get("resource_types"), "project");
  assert.deepEqual(results, [{
    entityType: "project",
    entityID: "project-1",
    label: "Launch",
    updatedTimestamp: undefined,
  }]);
});

test("entity search joins bounded Entity results after Nodes, Processes, and Projects", async () => {
  const requested: Array<{ path: string; signal?: AbortSignal | null }> = [];
  const controller = new AbortController();
  const results = await searchEditorEntityLinks({
    companyID: "company-1",
    requestJSON: async <T>(path: string, init?: RequestInit): Promise<T> => {
      requested.push({ path, signal: init?.signal });
      if (path.startsWith("/v1/entities?")) {
        return {
          entities: [
            { entity_id: "entity-1", entity_type_name: "Action Item", name: "Thailand delivery", updated_timestamp: "2026-08-27T12:00:00Z" },
            { entity_id: "entity-2", name: "Afternoon delivery", updated_timestamp: "2026-08-27T13:00:00Z" },
            { entity_id: "", name: "Ignored" },
          ],
        } as T;
      }
      return {
        results: [
          { resource_type: "project", resource_id: "project-1", display_name: "Costco order" },
          { resource_type: "node", resource_id: "node-1", display_name: "Receiving" },
          { resource_type: "logic_gate", resource_id: "gate-1", display_name: "Delivery process" },
        ],
      } as T;
    },
  }, "delivery", 4, ["node", "logic_gate", "project", "entity"], controller.signal);

  assert.deepEqual(results, [
    { entityType: "node", entityID: "node-1", label: "Receiving", updatedTimestamp: undefined },
    { entityType: "logic_gate", entityID: "gate-1", label: "Delivery process", updatedTimestamp: undefined },
    { entityType: "project", entityID: "project-1", label: "Costco order", updatedTimestamp: undefined },
    { entityType: "entity", entityID: "entity-1", label: "Thailand delivery", updatedTimestamp: "2026-08-27T12:00:00Z", isActionItem: true },
  ]);
  assert.equal(requested.length, 2);
  assert.equal(requested.every((request) => request.signal === controller.signal), true);
  const entityURL = new URL(requested.find((request) => request.path.startsWith("/v1/entities?"))?.path ?? "", "https://mango.test");
  assert.equal(entityURL.searchParams.get("company_id"), "company-1");
  assert.equal(entityURL.searchParams.get("q"), "delivery");
  assert.equal(entityURL.searchParams.get("limit"), "4");
  assert.equal(results.length, 4, "the merged workspace and Entity result set honors the requested total limit");
});

test("Entity-only blank search lists the bounded company Entities without querying Company Explorer", async () => {
  const requestedPaths: string[] = [];
  const results = await searchEditorEntityLinks({
    companyID: "company-1",
    requestJSON: async <T>(path: string): Promise<T> => {
      requestedPaths.push(path);
      return { entities: [{ entity_id: "entity-1", name: "First Entity" }] } as T;
    },
  }, "", 50, ["entity"]);

  assert.equal(requestedPaths.length, 1);
  assert.equal(new URL(requestedPaths[0], "https://mango.test").pathname, "/v1/entities");
  assert.deepEqual(results, [{ entityType: "entity", entityID: "entity-1", label: "First Entity", updatedTimestamp: undefined }]);
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

test("the shared Tiptap selection toolbar exposes one keyboard-operable yellow/red Action Item split control", () => {
  const source = readFileSync("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx", "utf8");
  const previewHost = readFileSync("frontend/src/modules/editor/EntityReferencePreviewHost.tsx", "utf8");
  const css = readFileSync("frontend/src/index.css", "utf8");
  assert.match(source, /role="group"[\s\S]*aria-label="Create an Action Item from highlighted text"/);
  assert.match(source, /\(\["yellow", "red"\] as const\)\.map/);
  assert.match(source, /aria-label=\{`Create \$\{color\} Action Item from highlighted text\.`\}/);
  assert.match(source, /<ActionItemIcon size=\{16\} \/>/);
  assert.doesNotMatch(source, /label\.slice\(0, 1\)/);
  assert.match(source, /createActionItemEntityFromSelection\(\{[\s\S]*source: \{ resourceType, resourceID \}[\s\S]*\}, action\.quote, color\)/);
  assert.match(previewHost, /<KPIEditorPopup[\s\S]*item=\{kpiSource\}[\s\S]*canEdit/);
  assert.match(previewHost, /kpi_id: source\.resource_id,[\s\S]*logic_gate_id: source\.parent_resource_id/);
  assert.match(css, /\.mango-editor-action-item--yellow[\s\S]*animation: mango-editor-action-item-pulse 2s/);
  assert.match(css, /\.mango-editor-action-item--red[\s\S]*animation: mango-editor-action-item-pulse 1s/);
  assert.match(css, /\.mango-editor-action-item--yellow,\s*\.mango-editor-entity-link\.mango-editor-action-item--yellow/, "the fully filled yellow chip wins over the generic Entity variables");
  assert.match(css, /\.mango-editor-action-item--red,\s*\.mango-editor-entity-link\.mango-editor-action-item--red/, "the fully filled red chip wins over the generic Entity variables");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.mango-editor-action-item--yellow,[\s\S]*animation: none/);
});

test("the shared Tiptap selection toolbar stays hidden during primary-pointer selection and refreshes only after release", () => {
  const source = readFileSync("frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx", "utf8");
  assert.match(source, /selectionPointerDownRef\.current = true;[\s\S]*setSelectionAction\(null\);/);
  assert.match(source, /if \(selectionPointerDownRef\.current \|\| selection\.empty/);
  assert.match(source, /addEventListener\("pointerup", finishSelectionPointerGesture\)/);
  assert.match(source, /addEventListener\("pointercancel", finishSelectionPointerGesture\)/);
  assert.match(source, /addEventListener\("mouseup", finishSelectionPointerGesture\)/);
  assert.match(source, /selectionPointerDownRef\.current = false;[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*updateSelectionState\(editor\)/);
});

test("selection Action Item creation sends the exact body, normalized name, chosen color, and typed source", async () => {
  let submittedJSON: unknown;
  const entity = await createActionItemEntityFromSelection({
    companyID: "company-1",
    source: { resourceType: "huddle_node", resourceID: "huddle-node-1" },
    requestJSON: async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      assert.equal(path, "/v1/action-items");
      assert.equal(init?.method, "POST");
      submittedJSON = init?.json;
      return {
        action_item: {
          company_id: "company-1",
          entity_id: "action-item-1",
          entity_type_id: "action-item-type",
          entity_type_name: "Action Item",
          entity_folder_id: null,
          name: "Escalate delayed shipment",
          position: 1000,
          revision: 1,
          created_timestamp: "2026-08-28T12:00:00Z",
          updated_timestamp: "2026-08-28T12:00:01Z",
          entity_fields: [],
        },
      } as T;
    },
  }, "  Escalate\n delayed   shipment  ", "yellow");

  assert.deepEqual(submittedJSON, {
    company_id: "company-1",
    body_text: "  Escalate\n delayed   shipment  ",
    name: "Escalate delayed shipment",
    color: "yellow",
    source: { resource_type: "huddle_node", resource_id: "huddle-node-1" },
  });
  assert.deepEqual(entity, {
    entityType: "entity",
    entityID: "action-item-1",
    label: "Escalate delayed shipment",
    updatedTimestamp: "2026-08-28T12:00:01Z",
    isActionItem: true,
    actionItemColor: "yellow",
  });
  assert.equal(normalizeEditorSelectionActionItemName(`  ${"x".repeat(240)}  `), "x".repeat(200));
  assert.equal(normalizeEditorSelectionActionItemName("🚦".repeat(240)), "🚦".repeat(200));
  assert.equal(normalizeEditorSelectionActionItemName("完成".repeat(120)), "完成".repeat(100));
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

test("an authoritative Entity read refreshes rendered Action Item labels, target icon, and color without replacing chip identity", () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const domGlobals = dom.window as unknown as typeof globalThis;
  const previousWindow = globalThis.window;
  const previousHTMLElement = globalThis.HTMLElement;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: domGlobals.HTMLElement });
  try {
    const chip = createEditorEntityLinkElement(dom.window.document, {
      entityType: "entity",
      entityID: "action-item-1",
      label: "Saved label",
      isActionItem: true,
    });
    dom.window.document.body.append(chip);
    let presentation: EditorEntityReferencePresentation | null = null;
    dom.window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_PRESENTATION, (event) => {
      presentation = (event as CustomEvent<EditorEntityReferencePresentation>).detail;
    });

    updateRenderedEditorEntityReference({ entityID: "action-item-1", label: "Current label", isActionItem: true, actionItemColor: "red" });
    assert.equal(chip.dataset.mangoEntityId, "action-item-1");
    assert.equal(chip.dataset.mangoEntityLabel, "Current label");
    assert.equal(chip.dataset.mangoActionItem, "true");
    assert.equal(chip.dataset.mangoActionItemColor, "red");
    assert.equal(chip.querySelector(".mango-editor-entity-label")?.textContent, "Current label");
    assert.equal(chip.querySelector(".mango-editor-action-item-severity"), null);
    assert.equal(chip.getAttribute("aria-label"), "Open Action Item Current label");
    assert.equal(chip.getAttribute("title"), "Action Item: Current label");
    assert.equal(chip.querySelector(".mango-editor-action-item-icon path:last-of-type")?.getAttribute("d"), ACTION_ITEM_TARGET_ARROW_PATH);
    assert.deepEqual(presentation, { entityID: "action-item-1", label: "Current label", isActionItem: true, actionItemColor: "red" });

    updateRenderedEditorEntityReference({ entityID: "action-item-1", label: "Resolved label", isActionItem: true, actionItemColor: null });
    assert.equal(chip.dataset.mangoEntityLabel, "Resolved label");
    assert.equal(chip.dataset.mangoActionItem, "true");
    assert.equal(chip.hasAttribute("data-mango-action-item-color"), false);
    assert.equal(chip.querySelector(".mango-editor-action-item-severity"), null);
    assert.equal(chip.classList.contains("mango-editor-action-item--red"), false);
  } finally {
    if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
    if (previousHTMLElement === undefined) delete (globalThis as Record<string, unknown>).HTMLElement;
    else Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: previousHTMLElement });
    dom.window.close();
  }
});

test("entity chips render the canonical Node, Logic Gate, Project, Entity, and Email icons", () => {
  const dom = new JSDOM("<!doctype html>");
  try {
    const icons = [
      ["node", "M3.7 1.7h5.45l3.15 3.15v9.45H3.7z"],
      ["logic_gate", "M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z"],
      ["project", "M2.3 3.1h11.4v9.8H2.3z"],
      ["entity", "M5.1 5.35h5.8M5.1 8h5.8M5.1 10.65h3.65"],
      ["email_message", "M2.1 3.65h11.8v8.7H2.1z"],
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

test("the shared Action Item DOM icon uses the target-and-arrow product shape", () => {
  const dom = new JSDOM("<!doctype html>");
  try {
    const icon = createActionItemIconElement(dom.window.document);
    assert.equal(icon.getAttribute("viewBox"), "0 0 16 16");
    assert.equal(icon.querySelector("path:last-of-type")?.getAttribute("d"), ACTION_ITEM_TARGET_ARROW_PATH);
    assert.ok(icon.querySelector("circle"), "the target center is present");
  } finally {
    dom.window.close();
  }
});

test("the shared React and DOM Entity icon uses the same default, inverse, and orange tone specs", () => {
  const dom = new JSDOM("<!doctype html>");
  try {
    const tones = [
      ["default", "#0d9488", "rgba(13,148,136,0.10)"],
      ["inverse", "#ffffff", "rgba(255,255,255,0.10)"],
      ["orange", "#ff9708", "rgba(255,151,8,0.10)"],
    ] as const;

    for (const [tone, expectedStroke, expectedFill] of tones) {
      const icon = createExplorerEntityIconElement(dom.window.document, "entity", tone);
      assert.equal(icon.querySelector("rect")?.getAttribute("stroke"), expectedStroke);
      assert.equal(icon.querySelector("rect")?.getAttribute("fill"), expectedFill);
      assert.equal(icon.querySelector("path")?.getAttribute("stroke"), expectedStroke);
    }
    const source = readFileSync("frontend/src/icons/EntityIcons.tsx", "utf8");
    assert.match(source, /ExplorerEntityIcon[\s\S]*iconSpecs\(kind, tone, id\)/);
    assert.match(source, /createExplorerEntityIconElement[\s\S]*iconSpecs\(kind, tone, id\)/);
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
  let openedEmail: EditorEntityLink | undefined;
  let openedEntity: EditorEntityReferenceOpenDetail | undefined;
  dom.window.addEventListener("popstate", () => { popStateCount += 1; });
  dom.window.addEventListener(EVENT_EDITOR_EMAIL_REFERENCE_OPEN, (event) => {
    openedEmail = (event as CustomEvent<EditorEntityLink>).detail;
  });
  dom.window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_OPEN, (event) => {
    openedEntity = (event as CustomEvent<EditorEntityReferenceOpenDetail>).detail;
  });
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

    openEditorEntityLink({
      entityType: "email_message",
      entityID: "11111111-1111-4111-8111-111111111111",
      label: "Quarterly update",
      emailMessageID: "11111111-1111-4111-8111-111111111111",
      emailThreadID: "22222222-2222-4222-8222-222222222222",
      emailAccountEmail: "owner@example.com",
    });
    assert.equal(dom.window.location.pathname, "/projects/project-1", "an Email reference opens through the mailbox event without inventing an app route");
    assert.deepEqual(openedEmail, {
      entityType: "email_message",
      entityID: "11111111-1111-4111-8111-111111111111",
      label: "Quarterly update",
      emailMessageID: "11111111-1111-4111-8111-111111111111",
      emailThreadID: "22222222-2222-4222-8222-222222222222",
      emailAccountEmail: "owner@example.com",
    });

    const anchor = { left: 900, top: 40, right: 940, bottom: 62 };
    openEditorEntityLink({ entityType: "entity", entityID: "entity-1", label: "Thailand delivery" }, undefined, anchor);
    assert.equal(dom.window.location.pathname, "/projects/project-1", "an Entity reference opens through the detail-preview event without inventing an app route");
    assert.deepEqual(openedEntity, { entity: { entityType: "entity", entityID: "entity-1", label: "Thailand delivery" }, anchor });
    assert.throws(
      () => editorEntityRoute({ entityType: "entity", entityID: "entity-1" }),
      /detail preview/,
    );
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

test("durable Tiptap entity nodes keep their identity through history and Backspace unwrapping", () => {
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
  const editor = new MangoTiptapEditorEngine({
    element: dom.window.document.querySelector<HTMLElement>("#editor"),
    extensions: createMangoTiptapExtensions({ editable: true }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });
  try {
    editor.commands.focus();
    editor.commands.insertContent({
      type: "mangoEntityLink",
      attrs: { entityType: "project", entityId: "project-1", label: "Most recent project" },
    });
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

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{
      type: "mangoEntityLink",
      attrs: { entityType: "entity", entityId: "entity-1", label: "Saved delivery label" },
    }] }] });
    const entityNode = editor.getJSON().content?.[0]?.content?.[0] as { attrs?: Record<string, unknown> } | undefined;
    assert.equal(entityNode?.attrs?.entityType, "entity");
    assert.equal(entityNode?.attrs?.entityId, "entity-1");
    assert.equal(entityNode?.attrs?.label, "Saved delivery label");
    assert.match(editor.getHTML(), /data-mango-entity-type="entity"/);
    assert.match(editor.getHTML(), /data-mango-entity-id="entity-1"/);
    assert.match(editor.getHTML(), /M5.1 5.35h5.8M5.1 8h5.8M5.1 10.65h3.65/);

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{
      type: "mangoEntityLink",
      attrs: { entityType: "entity", entityId: "action-item-1", label: "Escalate delayed shipment", actionItem: true, actionItemColor: "yellow" },
    }] }] });
    const actionItemHTML = editor.getHTML();
    assert.match(actionItemHTML, /data-mango-action-item="true"/);
    assert.match(actionItemHTML, /data-mango-action-item-color="yellow"/);
    assert.match(actionItemHTML, /mango-editor-action-item--yellow/);
    assert.match(actionItemHTML, /aria-label="Open Action Item Escalate delayed shipment"/);
    assert.match(actionItemHTML, /M8 8 14\.5 1\.5M11\.5 1\.5h3v3/);
    assert.doesNotMatch(actionItemHTML, />Yellow<\/span>/);
    editor.commands.setContent(actionItemHTML);
    const actionItemNode = editor.getJSON().content?.[0]?.content?.[0] as { attrs?: Record<string, unknown> } | undefined;
    assert.equal(actionItemNode?.attrs?.actionItem, true, "HTML clipboard hydration preserves Action Item identity");
    assert.equal(actionItemNode?.attrs?.actionItemColor, "yellow", "HTML clipboard hydration preserves Action Item presentation");
    let actionItemEnd = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name !== "mangoEntityLink") return true;
      actionItemEnd = position + node.nodeSize;
      return false;
    });
    editor.commands.setTextSelection(actionItemEnd);
    editor.view.dom.dispatchEvent(new domGlobals.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    assert.equal(editor.getJSON().content?.[0]?.content?.some((node) => node.type === "mangoEntityLink") ?? false, false);
    assert.match(editor.state.doc.textContent, /Escalate delayed shipment/);

    editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", content: [{
      type: "mangoEntityLink",
      attrs: {
        entityType: "email_message",
        entityId: "11111111-1111-4111-8111-111111111111",
        label: "Quarterly update",
        emailMessageId: "11111111-1111-4111-8111-111111111111",
        emailThreadId: "22222222-2222-4222-8222-222222222222",
        emailAccountEmail: "owner@example.com",
      },
    }] }] });
    const emailNode = editor.getJSON().content?.[0]?.content?.[0] as { attrs?: Record<string, unknown> } | undefined;
    assert.equal(emailNode?.attrs?.entityType, "email_message");
    assert.equal(emailNode?.attrs?.entityId, "11111111-1111-4111-8111-111111111111");
    assert.equal(emailNode?.attrs?.emailMessageId, "11111111-1111-4111-8111-111111111111");
    assert.equal(emailNode?.attrs?.emailThreadId, "22222222-2222-4222-8222-222222222222");
    assert.equal(emailNode?.attrs?.emailAccountEmail, "owner@example.com");
    assert.equal(emailNode?.attrs?.emailMailbox, undefined);
    assert.match(editor.getHTML(), /data-mango-email-message-id="11111111-1111-4111-8111-111111111111"/);
    assert.doesNotMatch(editor.getHTML(), /data-mango-email-mailbox/);

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
    assert.match(editor.state.doc.textContent, /Quarterly update/);
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
    assert.equal(menu?.dataset.visibleRows, "5");
    assert.equal(menu?.style.maxHeight, "236px");
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

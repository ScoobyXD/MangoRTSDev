import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import type { EditorTextBlockChatMessage } from "../../../../frontend/src/modules/editor/editorProjection.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function message(input: Partial<EditorTextBlockChatMessage> & { id: string }): EditorTextBlockChatMessage {
  return {
    id: input.id,
    blockID: input.blockID ?? "block-1",
    parentID: input.parentID,
    selectionQuote: input.selectionQuote,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd,
    authorID: input.authorID ?? "user-1",
    authorName: input.authorName ?? "Ada",
    message: input.message ?? "Comment",
    createdTimestamp: input.createdTimestamp ?? "2026-07-13T12:00:00.000Z",
    attachments: input.attachments ?? [],
    entityLinks: input.entityLinks,
  };
}

function rect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

test("annotated editor text reveals and accessibly focuses its exact chat comment", { timeout: 8_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "localStorage",
    "Node", "NodeFilter", "Element", "HTMLElement", "HTMLDivElement", "HTMLSpanElement",
    "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement", "HTMLUListElement", "HTMLOListElement",
    "HTMLAnchorElement", "HTMLBRElement", "HTMLButtonElement", "HTMLInputElement",
    "HTMLTextAreaElement", "HTMLTableElement", "HTMLTableRowElement", "HTMLTableCellElement",
    "DocumentFragment", "DOMParser", "DOMException", "DOMRect", "Event", "EventTarget",
    "InputEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "Range",
  ] as const;
  for (const name of browserGlobals) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  installGlobal("indexedDB", indexedDB, restores);
  installGlobal("IDBKeyRange", IDBKeyRange, restores);

  let nextFrameID = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const requestFrame = (callback: FrameRequestCallback) => {
    nextFrameID += 1;
    frames.set(nextFrameID, callback);
    return nextFrameID;
  };
  const cancelFrame = (frameID: number) => frames.delete(frameID);
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);

  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "800px 0px";
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  installGlobal("ResizeObserver", TestResizeObserver, restores);
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });

  Object.defineProperty(dom.window.Range.prototype, "getClientRects", {
    configurable: true,
    value(this: Range) {
      const text = this.toString();
      if (text === "alpha") return [rect(20, 20, 70, 40)];
      if (text === "beta") return [rect(100, 20, 145, 40)];
      if (text === "nested") return [rect(46, 52, 108, 72)];
      return [];
    },
  });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value(this: Range) {
      return Array.from(this.getClientRects())[0] ?? rect(0, 0, 0, 0);
    },
  });

  const scrolledMessageIDs: string[] = [];
  const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "scrollIntoView");
  const attachEventDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "attachEvent");
  const detachEventDescriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, "detachEvent");
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value(this: HTMLElement) {
      scrolledMessageIDs.push(this.getAttribute("data-node-chat-message-id") ?? "");
    },
  });

  const flushFrames = async () => {
    await act(async () => {
      for (let pass = 0; pass < 8 && frames.size > 0; pass += 1) {
        const callbacks = Array.from(frames.values());
        frames.clear();
        for (const callback of callbacks) callback(performance.now());
        await Promise.resolve();
      }
    });
  };

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { Simulate }, { ChatPane, NodeTextBlockEditor }] = await Promise.all([
      import("react-dom/client"),
      import("react-dom/test-utils"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
    ]);
    const noop = () => undefined;
    const initialDocument = JSON.stringify({
      format: "mango-tiptap-json",
      schema_version: 1,
      document: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "alpha beta gamma" }] }],
      },
    });
    let canonicalDocument = JSON.parse(initialDocument);
    let canonicalRevision = 0;
    const editorRequestJSON = async <T,>(path: string, init?: { method?: string; json?: unknown }): Promise<T> => {
      if (path === "/v1/editor-data-format?company_id=company-1") {
        return {
          company_id: "company-1",
          editor_format: "tiptap_json",
          migration_state: "ready",
          document_schema_version: 1,
          expected_document_count: 0,
          converted_document_count: 0,
        } as T;
      }
      if (path.endsWith("/collaboration-ticket")) {
        return {
          token: "chat-navigation-ticket",
          document_name: "chat-navigation",
          collaboration_epoch: "00000000-0000-4000-8000-000000000001",
        } as T;
      }
      if (path.startsWith("/v1/editor-json/")) {
        if (init?.method === "POST") {
          canonicalDocument = (init.json as { document?: unknown } | undefined)?.document ?? canonicalDocument;
          canonicalRevision += 1;
          return {
            operation_id: "chat-navigation-operation",
            revision: canonicalRevision,
            committed_at: "2026-08-02T00:00:00Z",
          } as T;
        }
        return {
          revision: canonicalRevision,
          schema_version: 1,
          document: canonicalDocument,
          annotations: [],
        } as T;
      }
      throw new Error("unexpected_editor_request:" + path);
    };
    const messages = [
      message({ id: "comment-alpha", selectionQuote: "alpha", selectionStart: 1, selectionEnd: 6, message: "Alpha note" }),
      message({ id: "comment-beta", selectionQuote: "beta", selectionStart: 7, selectionEnd: 11, message: "Beta note" }),
    ];
    const activatedMessageIDs: string[] = [];
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;

    const renderPrimaryEditor = (
      navigationRequest: { anchorMessageID: string; requestID: number } | null,
      nextMessages = messages,
    ) => (
      <NodeTextBlockEditor
        blockID="block-1"
        editable
        nodeID="node-1"
        apiBase="http://localhost"
        companyID="company-1"
        attachmentRequestJSON={editorRequestJSON}
        currentUserID=""
        companyUsers={[]}
        documentValue={initialDocument}
        chatMessages={nextMessages}
        activeChatAnchorMessageID=""
        chatNavigationRequest={navigationRequest}
        onChatNavigationConsumed={noop}
        surfaceText="#111827"
        accent="#7c3aed"
        outlineStyle="automatic-outline-numbering"
        indentGuideColor="#94a3b8"
        scrollbarTrack="#e2e8f0"
        onFocus={noop}
        onBlur={noop}
        onDocumentChange={noop}
        onDocumentFlush={noop}
        onChatHighlightActivate={(messageID) => activatedMessageIDs.push(messageID)}
        onSelectionChatRequest={noop}
        onImageChatRequest={noop}
        onImageNodeRequest={noop}
      />
    );
    const waitForEditor = async (predicate: () => boolean, messageText: string) => {
      for (let index = 0; index < 100; index += 1) {
        await flushFrames();
        if (predicate()) return;
        await act(async () => { await new Promise((resolve) => dom.window.setTimeout(resolve, 0)); });
      }
      assert.fail(messageText + "; state=" + container.querySelector<HTMLElement>('[data-node-text-block-id="block-1"]')?.dataset.mangoEditorState + "; text=" + container.textContent);
    };

    await act(async () => root.render(renderPrimaryEditor(null)));
    await waitForEditor(
      () => Boolean(container.querySelector('[data-node-text-block-id="block-1"] [data-mango-annotation-id="comment-beta"]')),
      "the sleeping JSON document should paint its chat annotations",
    );
    const editor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-1"]');
    assert.ok(editor);
    const betaAnnotation = editor.querySelector<HTMLElement>('[data-mango-annotation-id="comment-beta"]');
    assert.ok(betaAnnotation);
    assert.equal(betaAnnotation.textContent, "beta");
    const annotationEvent = new dom.window.CustomEvent("mango:tiptap-annotation-activate", {
      bubbles: true,
      detail: { id: "comment-beta", kind: "chat" },
    });
    await act(async () => { betaAnnotation.dispatchEvent(annotationEvent); });
    assert.deepEqual(activatedMessageIDs, ["comment-beta"]);

    const threadedMessages = [
      message({ id: "parent", message: "Parent comment" }),
      message({ id: "exact-child", parentID: "parent", authorName: "Grace", message: "Exact child comment" }),
    ];
    const editedComments: Array<{ messageID: string; message: string }> = [];
    const chatProps = {
      blockID: "block-1",
      editable: true,
      apiBase: "",
      companyID: "company-1",
      messages: threadedMessages,
      selectionAnchor: undefined,
      draft: "",
      companyUsers: [],
      draftAttachments: [],
      replyTargetID: "",
      heightStorageKey: "chat-navigation-test",
      active: true,
      currentUserID: "user-1",
      activeMessageID: "exact-child",
      accent: "#7c3aed",
      surfaceText: "#111827",
      panelBackground: "#ffffff",
      strokeColor: "#94a3b8",
      ruleColor: "#cbd5e1",
      onFocus: noop,
      onDraftChange: noop,
      onActivateMessage: noop,
      onNavigateToMessage: noop,
      onReply: noop,
      onEditMessage: async (messageID: string, nextMessage: string) => {
        editedComments.push({ messageID, message: nextMessage });
      },
      onDeleteMessage: noop,
      onClearReply: noop,
      onClearSelectionAnchor: noop,
      onAttachFiles: noop,
      onRemoveDraftAttachment: noop,
      onSubmit: noop,
    };
    await act(async () => root.render(<ChatPane {...chatProps} messageFocusRequest={null} />));
    await flushFrames();
    const collapse = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse replies"]');
    assert.ok(collapse);
    await act(async () => collapse.focus());
    assert.equal(dom.window.document.activeElement, collapse);
    await act(async () => root.render(
      <ChatPane {...chatProps} messageFocusRequest={null} composerFocusRequestID={1} />,
    ));
    await flushFrames();
    assert.equal(
      dom.window.document.activeElement,
      container.querySelector("textarea"),
      "an explicit image-chat request moves the caret into an already-open composer",
    );
    await act(async () => collapse.click());
    assert.equal(container.querySelector('[data-node-chat-message-id="exact-child"]'), null);

    await act(async () => root.render(
      <ChatPane {...chatProps} messageFocusRequest={{ messageID: "exact-child", requestID: 1 }} />,
    ));
    await flushFrames();
    const focusedComment = container.querySelector<HTMLElement>('[data-node-chat-message-id="exact-child"]');
    assert.ok(focusedComment, "focus request expands collapsed ancestors");
    assert.equal(dom.window.document.activeElement, focusedComment);
    assert.equal(focusedComment.getAttribute("role"), "article");
    assert.equal(focusedComment.getAttribute("aria-label"), "Chat comment from Grace");
    assert.equal(focusedComment.getAttribute("aria-current"), "true");
    assert.notEqual(focusedComment.style.outline, "none");
    assert.deepEqual(scrolledMessageIDs, ["exact-child"]);
    await act(async () => root.render(
      <ChatPane {...chatProps} messageFocusRequest={{ messageID: "exact-child", requestID: 1 }} />,
    ));
    await flushFrames();
    assert.equal(dom.window.document.activeElement, focusedComment, "an ordinary rerender must not hand focus back to the composer");

    const editButton = focusedComment.querySelector<HTMLButtonElement>('button[aria-label="Edit comment"]');
    assert.ok(editButton, "the author sees Edit on a sent chat comment");
    await act(async () => editButton.click());
    const editTextarea = focusedComment.querySelector<HTMLTextAreaElement>('textarea[aria-label="Edit comment text"]');
    assert.ok(editTextarea);
    await act(async () => {
      const setTextareaValue = Object.getOwnPropertyDescriptor(
        dom.window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      assert.ok(setTextareaValue);
      setTextareaValue.call(editTextarea, "Updated exact child comment");
      Simulate.change(editTextarea);
      await Promise.resolve();
    });
    assert.equal(editTextarea.value, "Updated exact child comment");
    const saveEditButton = focusedComment.querySelector<HTMLButtonElement>('button[aria-label="Save edited comment"]');
    assert.ok(saveEditButton);
    await act(async () => saveEditButton.click());
    assert.deepEqual(editedComments, [{ messageID: "exact-child", message: "Updated exact child comment" }]);

    await act(async () => root.render(
      <ChatPane {...chatProps} currentUserID="other-user" messageFocusRequest={null} />,
    ));
    assert.equal(container.querySelector('button[aria-label="Edit comment"]'), null, "other users cannot edit the author's comment");

    const imageMessage = message({
      id: "image-comment",
      message: "Image reference",
      attachments: [{
        id: "image-1",
        name: "diagram.png",
        type: "image/png",
        size: 4,
        dataURL: "data:image/png;base64,AA==",
      }],
    });
    await act(async () => root.render(
      <ChatPane
        {...chatProps}
        messages={[imageMessage]}
        activeMessageID=""
        messageFocusRequest={null}
      />,
    ));
    const chatDownload = container.querySelector<HTMLButtonElement>('[data-mango-chat-attachment-download="true"]');
    assert.ok(chatDownload, "a posted chat image exposes its own row download button");
    assert.equal(chatDownload.getAttribute("aria-label"), "Download diagram.png");
    const previewTrigger = container.querySelector<HTMLButtonElement>('button[title="Double-click to preview"]');
    assert.ok(previewTrigger);
    await act(async () => previewTrigger.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true })));
    await flushFrames();
    const previewBackdrop = dom.window.document.querySelector<HTMLElement>('[data-mango-image-preview-backdrop="translucent"]');
    assert.ok(previewBackdrop, "double-clicking the chat image opens the shared fullscreen image preview");
    assert.ok(dom.window.document.querySelector('[data-mango-image-preview-download="true"]'));
    const previewClose = dom.window.document.querySelector<HTMLButtonElement>('[data-mango-image-preview-close="true"]');
    assert.ok(previewClose);
    assert.equal(previewClose.textContent?.trim(), "X");
    await act(async () => previewClose.click());
    assert.equal(dom.window.document.querySelector('[data-mango-image-preview-backdrop="translucent"]'), null);

    const mentionUsers = [{ user_id: "ada", display_name: "Ada Lovelace", email: "ada@example.test" }];
    const mentionedPrincipals: string[] = [];
    const MentionComposerHarness: React.FC<{ initialDraft: string }> = ({ initialDraft }) => {
      const [mentionDraft, setMentionDraft] = React.useState(initialDraft);
      return (
        <ChatPane
          {...chatProps}
          messages={[]}
          companyUsers={mentionUsers}
          draft={mentionDraft}
          onDraftChange={setMentionDraft}
          onMentionPrincipal={(user) => mentionedPrincipals.push(user.user_id)}
          messageFocusRequest={null}
        />
      );
    };
    const acceptComposerMention = async (initialDraft: string, expectedKind: "mention" | "urgent") => {
      await act(async () => root.render(<MentionComposerHarness key={expectedKind} initialDraft={initialDraft} />));
      const composer = container.querySelector<HTMLTextAreaElement>("textarea");
      assert.ok(composer);
      composer.focus();
      composer.setSelectionRange(initialDraft.length, initialDraft.length);
      await act(async () => composer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "d", bubbles: true })));
      assert.ok(container.querySelector('[role="listbox"][aria-label="Mention users"]'));
      const tab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await act(async () => composer.dispatchEvent(tab));
      await flushFrames();
      assert.equal(tab.defaultPrevented, true);
      assert.equal(composer.selectionStart, composer.value.length, "autocomplete leaves the native caret after the accepted mention");
      assert.equal(composer.selectionEnd, composer.value.length, "autocomplete keeps the accepted mention caret collapsed");
      const overlay = container.querySelector<HTMLElement>('[data-mango-chat-composer-mention-overlay="true"]');
      assert.ok(overlay);
      assert.equal(overlay.style.fontFamily, composer.style.fontFamily);
      assert.equal(overlay.style.fontSize, composer.style.fontSize);
      assert.equal(overlay.style.fontWeight, composer.style.fontWeight);
      assert.equal(overlay.style.lineHeight, composer.style.lineHeight);
      assert.equal(overlay.style.letterSpacing, composer.style.letterSpacing);
      assert.equal(composer.value, `${initialDraft[0]}Ada Lovelace `);
      const chip = container.querySelector<HTMLElement>(`[data-mango-chat-composer-mention="true"][data-mango-mention-kind="${expectedKind}"]`);
      assert.ok(chip, `${expectedKind} autocomplete is visibly rendered as an entity in the composer`);
      assert.equal(chip.style.padding, "0px", "the painted chip cannot add inline width ahead of the native caret");
      assert.equal(chip.style.borderWidth, "0px", "the painted chip border cannot add inline width ahead of the native caret");
      assert.equal(chip.style.fontWeight, "inherit", "the painted chip uses the textarea glyph metrics");
      assert.match(chip.style.boxShadow, /0 0 0 2px/, "the mention stays visibly outlined without changing text flow");
    };
    await acceptComposerMention("@Ad", "mention");
    await acceptComposerMention("!Ad", "urgent");
    assert.deepEqual(mentionedPrincipals, ["ada", "ada"], "accepted composer entities keep the existing mentioned-principal model");

    const requestedEntityPaths: string[] = [];
    const requestedEntitySignals: Array<AbortSignal | null | undefined> = [];
    const entityRequestJSON = async <T,>(path: string, init?: RequestInit): Promise<T> => {
      requestedEntityPaths.push(path);
      requestedEntitySignals.push(init?.signal);
      if (path.startsWith("/v1/entities?")) {
        return {
          entities: [{ entity_id: "entity exact/id", name: "Thailand delivery" }],
        } as T;
      }
      return {
        results: [
          { resource_type: "node", resource_id: "node-1", display_name: "Node One" },
          { resource_type: "project", resource_id: "project-1", display_name: "Project One" },
          { resource_type: "logic_gate", resource_id: "gate-1", display_name: "Gate One" },
        ],
      } as T;
    };
    let acceptedEntityLinks: NonNullable<EditorTextBlockChatMessage["entityLinks"]> = [];
    const EntityComposerHarness: React.FC = () => {
      const [entityDraft, setEntityDraft] = React.useState("#Pro");
      const [entityLinks, setEntityLinks] = React.useState<NonNullable<EditorTextBlockChatMessage["entityLinks"]>>([]);
      acceptedEntityLinks = entityLinks;
      return (
        <ChatPane
          {...chatProps}
          messages={[]}
          draft={entityDraft}
          draftEntityLinks={entityLinks}
          entityRequestJSON={entityRequestJSON}
          onDraftChange={setEntityDraft}
          onDraftEntityLinksChange={setEntityLinks}
          messageFocusRequest={null}
        />
      );
    };
    await act(async () => root.render(<EntityComposerHarness />));
    const entityComposer = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(entityComposer);
    entityComposer.focus();
    entityComposer.setSelectionRange(entityComposer.value.length, entityComposer.value.length);
    await act(async () => entityComposer.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "o", bubbles: true })));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    await flushFrames();
    assert.ok(requestedEntityPaths.some((path) => path.includes("resource_types=node%2Clogic_gate%2Cproject") && path.includes("ranking=editor_entities")));
    assert.ok(requestedEntityPaths.some((path) => path.startsWith("/v1/entities?") && path.includes("q=Pro")));
    assert.equal(requestedEntitySignals.length, 2);
    assert.ok(requestedEntitySignals[0]);
    assert.equal(requestedEntitySignals[0], requestedEntitySignals[1], "chat cancels both branches of one combined search through one signal");
    const entityMenu = container.querySelector<HTMLElement>('[data-mango-chat-entity-menu="true"]');
    assert.ok(entityMenu, "# opens the shared workspace entity picker in chat");
    assert.deepEqual(
      Array.from(entityMenu.querySelectorAll<HTMLElement>("[data-mango-chat-entity-type]")).map((option) => option.dataset.mangoChatEntityType),
      ["node", "logic_gate", "project", "entity"],
      "chat exposes Nodes, Processes, Projects, and Entities in product order",
    );
    for (let index = 0; index < 3; index += 1) {
      await act(async () => entityComposer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    }
    const acceptEntity = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => entityComposer.dispatchEvent(acceptEntity));
    await flushFrames();
    assert.equal(acceptEntity.defaultPrevented, true);
    assert.equal(entityComposer.value, "#Thailand delivery ");
    assert.deepEqual(acceptedEntityLinks, [{ start: 0, end: 18, entityType: "entity", entityID: "entity exact/id", label: "Thailand delivery" }]);
    const draftEntityChip = container.querySelector<HTMLElement>('[data-mango-chat-composer-entity-link="true"]');
    assert.ok(draftEntityChip, "an accepted # entity is visibly rendered as a chip before the chat is sent");
    assert.equal(draftEntityChip.textContent, "#Thailand delivery");
    assert.equal(draftEntityChip.dataset.mangoEntityType, "entity");
    assert.equal(draftEntityChip.dataset.mangoEntityId, "entity exact/id");
    assert.equal(draftEntityChip.style.padding, "0px", "the draft entity chip keeps its glyph width aligned with the native caret");
    assert.equal(draftEntityChip.style.fontWeight, "inherit");
    assert.match(draftEntityChip.style.boxShadow, /0 0 0 2px/, "the unsent entity stays visibly outlined like an accepted mention");
    assert.equal(entityComposer.style.color, "transparent", "the overlay paints the entity without duplicating the textarea text");

    const linkedMessage = message({ id: "linked-entity", message: "See #Project One", entityLinks: [{ start: 4, end: 16, entityType: "project", entityID: "project-1", label: "Project One" }] });
    await act(async () => root.render(<ChatPane {...chatProps} messages={[linkedMessage]} draft="" messageFocusRequest={null} />));
    const sentEntityLink = container.querySelector<HTMLButtonElement>('[data-mango-chat-entity-link="true"][data-mango-entity-type="project"]');
    assert.ok(sentEntityLink, "sent chat preserves and renders the selected entity identity");
    assert.match(sentEntityLink.textContent ?? "", /#Project One/);
    await act(async () => sentEntityLink.click());
    assert.equal(dom.window.location.pathname, "/projects/project-1", "chat entity activation uses the same in-app deep route as editor entities");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    if (scrollIntoViewDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    else delete (dom.window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    if (attachEventDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", attachEventDescriptor);
    else delete (dom.window.HTMLElement.prototype as { attachEvent?: unknown }).attachEvent;
    if (detachEventDescriptor) Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", detachEventDescriptor);
    else delete (dom.window.HTMLElement.prototype as { detachEvent?: unknown }).detachEvent;
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

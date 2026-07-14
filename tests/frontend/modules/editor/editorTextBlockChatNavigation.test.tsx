import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
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
    "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement", "HTMLUListElement",
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
    const [{ createRoot }, { ChatPane, NodeTextBlockEditor }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
    ]);
    const noop = () => undefined;
    const messages = [
      message({ id: "comment-alpha", selectionQuote: "alpha", selectionStart: 0, selectionEnd: 5, message: "Alpha note" }),
      message({ id: "comment-beta", selectionQuote: "beta", selectionStart: 6, selectionEnd: 10, message: "Beta note" }),
    ];
    const activatedMessageIDs: string[] = [];
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;

    await act(async () => root.render(
      <NodeTextBlockEditor
        blockID="block-1"
        editable
        nodeID="node-1"
        apiBase=""
        companyID="company-1"
        currentUserID="user-1"
        companyUsers={[]}
        documentValue="<!-- mango-editor-html-v1 -->alpha beta gamma"
        contentChanges={[]}
        chatMessages={messages}
        activeChatAnchorMessageID=""
        chatNavigationRequest={null}
        surfaceText="#111827"
        accent="#7c3aed"
        outlineStyle="automatic-outline-numbering"
        indentGuideColor="#94a3b8"
        scrollbarTrack="#e2e8f0"
        onFocus={noop}
        onBlur={noop}
        onDocumentChange={noop}
        onDocumentFlush={noop}
        onChangeSeen={noop}
        onChatHighlightActivate={(messageID) => activatedMessageIDs.push(messageID)}
        onSelectionChatRequest={noop}
        onImageChatRequest={noop}
        onImageNodeRequest={noop}
      />,
    ));
    const editor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-1"]');
    const editorWrapper = editor?.parentElement;
    assert.ok(editor);
    assert.ok(editorWrapper);
    editor.getBoundingClientRect = () => rect(0, 0, 400, 220);
    editorWrapper.getBoundingClientRect = () => rect(0, 0, 400, 220);
    await flushFrames();

    const textNode = editor.firstChild;
    assert.ok(textNode);
    const caret = dom.window.document.createRange();
    caret.setStart(textNode, 0);
    caret.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(caret);
    await act(async () => {
      editor.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 120,
        clientY: 30,
      }));
    });
    assert.deepEqual(activatedMessageIDs, ["comment-beta"]);

    const selection = dom.window.document.createRange();
    selection.setStart(textNode, 0);
    selection.setEnd(textNode, 5);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(selection);
    await act(async () => {
      editor.dispatchEvent(new dom.window.MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 40,
        clientY: 30,
      }));
    });
    assert.deepEqual(activatedMessageIDs, ["comment-beta"], "range selection must not be hijacked by comment navigation");

    const threadedMessages = [
      message({ id: "parent", message: "Parent comment" }),
      message({ id: "exact-child", parentID: "parent", authorName: "Grace", message: "Exact child comment" }),
    ];
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

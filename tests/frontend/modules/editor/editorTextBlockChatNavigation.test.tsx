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
    const [{ createRoot }, { ChatPane, NodeTextBlockEditor }, { AppModalPortal }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
      import("../../../../frontend/src/app/AppModalPortal.tsx"),
    ]);
    const noop = () => undefined;
    const legacyFormatRequestJSON = async <T,>(path: string): Promise<T> => {
      assert.equal(path, "/v1/editor-data-format?company_id=company-1");
      return {
        company_id: "company-1",
        editor_format: "legacy_html",
        migration_state: "not_started",
        document_schema_version: 1,
        expected_document_count: 0,
        converted_document_count: 0,
      } as T;
    };
    const messages = [
      message({ id: "comment-alpha", selectionQuote: "alpha", selectionStart: 0, selectionEnd: 5, message: "Alpha note" }),
      message({ id: "comment-beta", selectionQuote: "beta", selectionStart: 6, selectionEnd: 10, message: "Beta note" }),
    ];
    const activatedMessageIDs: string[] = [];
    const selectionRequests: Array<{ quote: string; startOffset: number; endOffset: number }> = [];
    const consumedNavigationRequestIDs: number[] = [];
    const handleNavigationConsumed = (requestID: number) => consumedNavigationRequestIDs.push(requestID);
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
        attachmentRequestJSON={legacyFormatRequestJSON}
        currentUserID="user-1"
        companyUsers={[]}
        documentValue="<!-- mango-editor-html-v1 -->alpha beta gamma"
        contentChanges={[]}
        chatMessages={nextMessages}
        activeChatAnchorMessageID=""
        chatNavigationRequest={navigationRequest}
        onChatNavigationConsumed={handleNavigationConsumed}
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
        onSelectionChatRequest={(selection) => selectionRequests.push(selection)}
        onImageChatRequest={noop}
        onImageNodeRequest={noop}
      />
    );
    await act(async () => root.render(renderPrimaryEditor(null)));
    const editor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-1"]');
    const editorWrapper = editor?.parentElement;
    assert.ok(editor);
    assert.ok(editorWrapper);
    editor.getBoundingClientRect = () => rect(0, 0, 400, 220);
    editorWrapper.getBoundingClientRect = () => rect(0, 0, 400, 220);
    const sourceNavigationScrollTops: number[] = [];
    Object.defineProperty(editor, "clientHeight", { configurable: true, value: 220 });
    Object.defineProperty(editor, "scrollTo", {
      configurable: true,
      value(options: ScrollToOptions) {
        const top = options.top ?? editor.scrollTop;
        sourceNavigationScrollTops.push(top);
        editor.scrollTop = top;
      },
    });
    await act(async () => editor.focus());
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

    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const ordinaryCommentButton = container.querySelector<HTMLButtonElement>('button[aria-label="Comment on selection"]');
    assert.ok(ordinaryCommentButton, "an ordinary inline selection exposes the comment action");
    await act(async () => ordinaryCommentButton.click());
    assert.deepEqual(
      selectionRequests.map(({ quote, startOffset, endOffset }) => ({ quote, startOffset, endOffset })),
      [{ quote: "alpha", startOffset: 0, endOffset: 5 }],
    );

    const firstNavigationRequest = { anchorMessageID: "comment-alpha", requestID: 41 };
    await act(async () => root.render(renderPrimaryEditor(firstNavigationRequest, [...messages])));
    await flushFrames();
    assert.equal(sourceNavigationScrollTops.length, 1, "one chat click scrolls its source range once");
    assert.deepEqual(consumedNavigationRequestIDs, [41]);

    editor.scrollTop = 137;
    await act(async () => root.render(renderPrimaryEditor(firstNavigationRequest, [...messages])));
    await flushFrames();
    assert.equal(sourceNavigationScrollTops.length, 1, "rerenders cannot replay a handled chat navigation request");
    assert.equal(editor.scrollTop, 137, "a handled request cannot drag the user back after manual scrolling");
    assert.deepEqual(consumedNavigationRequestIDs, [41], "a handled request is acknowledged once");

    const secondNavigationRequest = { anchorMessageID: "comment-alpha", requestID: 42 };
    await act(async () => root.render(renderPrimaryEditor(secondNavigationRequest, [...messages])));
    await flushFrames();
    assert.equal(sourceNavigationScrollTops.length, 2, "a later explicit click may navigate once with a new request ID");
    assert.deepEqual(consumedNavigationRequestIDs, [41, 42]);

    await act(async () => root.render(
      <NodeTextBlockEditor
        blockID="block-2"
        editable
        nodeID="node-1"
        apiBase="http://localhost"
        companyID="company-1"
        attachmentRequestJSON={legacyFormatRequestJSON}
        currentUserID="user-1"
        companyUsers={[]}
        documentValue="<!-- mango-editor-html-v1 --><div>alpha</div><div>beta</div>"
        contentChanges={[]}
        chatMessages={[]}
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
        onChatHighlightActivate={noop}
        onSelectionChatRequest={(nextSelection) => selectionRequests.push(nextSelection)}
        onImageChatRequest={noop}
        onImageNodeRequest={noop}
      />,
    ));
    const wrappedEditor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-2"]');
    assert.ok(wrappedEditor);
    await flushFrames();
    wrappedEditor.innerHTML = "<div>alpha</div><div>beta</div>";
    const lineTextNodes = Array.from(wrappedEditor.querySelectorAll("div"))
      .map((line) => line.firstChild)
      .filter((node): node is ChildNode => Boolean(node?.textContent));
    const firstLine = lineTextNodes.find((node) => node.textContent === "alpha");
    const secondLine = lineTextNodes.find((node) => node.textContent === "beta");
    assert.ok(firstLine);
    assert.ok(secondLine);
    const wrappedSelection = dom.window.document.createRange();
    wrappedSelection.setStart(firstLine, 0);
    wrappedSelection.setEnd(secondLine, secondLine.textContent?.length ?? 0);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(wrappedSelection);
    await act(async () => {
      dom.window.document.dispatchEvent(new dom.window.Event("selectionchange"));
      await new Promise((resolve) => dom.window.setTimeout(resolve, 0));
    });
    const wrappedCommentButton = container.querySelector<HTMLButtonElement>('button[aria-label="Comment on selection"]');
    assert.ok(wrappedCommentButton, "a visually wrapped multi-line selection exposes the comment action");
    await act(async () => wrappedCommentButton.click());
    const wrappedRequest = selectionRequests[1];
    assert.deepEqual(
      wrappedRequest && { quote: wrappedRequest.quote, startOffset: wrappedRequest.startOffset, endOffset: wrappedRequest.endOffset },
      { quote: "alpha\nbeta", startOffset: 0, endOffset: 10 },
    );

    const nestedDocument = '<!-- mango-editor-html-v1 --><ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">outer<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">nested</li></ul></li></ul>';
    const nestedEditorProps = {
      blockID: "block-nested",
      editable: true,
      nodeID: "node-1",
      apiBase: "http://localhost",
      companyID: "company-1",
      attachmentRequestJSON: legacyFormatRequestJSON,
      currentUserID: "user-1",
      companyUsers: [],
      documentValue: nestedDocument,
      contentChanges: [],
      activeChatAnchorMessageID: "",
      chatNavigationRequest: null,
      surfaceText: "#111827",
      accent: "#7c3aed",
      outlineStyle: "automatic-outline-numbering" as const,
      indentGuideColor: "#94a3b8",
      scrollbarTrack: "#e2e8f0",
      onFocus: noop,
      onBlur: noop,
      onDocumentChange: noop,
      onDocumentFlush: noop,
      onChangeSeen: noop,
      onChatHighlightActivate: noop,
      onSelectionChatRequest: noop,
      onImageChatRequest: noop,
      onImageNodeRequest: noop,
    };
    await act(async () => root.render(
      <NodeTextBlockEditor
        {...nestedEditorProps}
        chatMessages={[]}
        pendingChatSelectionAnchor={{ blockID: "block-nested", quote: "nested", startOffset: 6, endOffset: 12 }}
      />,
    ));
    const nestedEditor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-nested"]');
    assert.ok(nestedEditor);
    nestedEditor.getBoundingClientRect = () => rect(0, 0, 400, 220);
    nestedEditor.parentElement!.getBoundingClientRect = () => rect(0, 0, 400, 220);
    await flushFrames();
    assert.ok(container.querySelector('[data-mango-chat-message-id="pending-chat-selection"]'), "nested source text remains highlighted while the chat composer is open");

    await act(async () => root.render(
      <NodeTextBlockEditor
        {...nestedEditorProps}
        pendingChatSelectionAnchor={undefined}
        chatMessages={[message({ id: "comment-nested", blockID: "block-nested", selectionQuote: "nested", selectionStart: 6, selectionEnd: 12 })]}
      />,
    ));
    await flushFrames();
    assert.ok(container.querySelector('[data-mango-chat-message-id="comment-nested"]'), "the source annotation persists after chat creation succeeds");

    const imageChatRequests: string[] = [];
    const inlineImageDocument = '<!-- mango-editor-html-v1 --><span data-mango-editor-image="true" data-mango-editor-filename="inline.png" data-mango-editor-mime-type="image/png"><img src="data:image/png;base64,AA==" alt=""></span>';
    await act(async () => root.render(
      <AppModalPortal>
        <NodeTextBlockEditor
          {...nestedEditorProps}
          blockID="block-image"
          documentValue={inlineImageDocument}
          pendingChatSelectionAnchor={undefined}
          chatMessages={[]}
          onImageChatRequest={(image) => imageChatRequests.push(image.blockID)}
        />
      </AppModalPortal>,
    ));
    await flushFrames();
    const enclosingModalLayer = dom.window.document.querySelector<HTMLElement>('[data-mango-modal-focus-trap="true"]');
    const imageEditor = enclosingModalLayer?.querySelector<HTMLElement>('[data-node-text-block-id="block-image"]');
    const imageFrame = imageEditor?.querySelector<HTMLElement>('[data-mango-editor-image="true"]');
    const inlineImage = imageFrame?.querySelector<HTMLImageElement>("img");
    assert.ok(enclosingModalLayer);
    assert.ok(imageEditor);
    assert.ok(imageFrame);
    assert.ok(inlineImage);
    imageEditor.getBoundingClientRect = () => rect(0, 0, 400, 300);
    imageEditor.parentElement!.getBoundingClientRect = () => rect(0, 0, 400, 300);
    imageFrame.getBoundingClientRect = () => rect(100, 100, 250, 220);
    await act(async () => {
      inlineImage.dispatchEvent(new dom.window.MouseEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 175,
        clientY: 160,
      }));
    });
    const imageActions = dom.window.document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Image actions"]');
    assert.ok(imageActions, "selecting an inline image still exposes its chat/create-node controls");
    assert.equal(
      imageActions.closest('[data-mango-modal-layer="true"]'),
      enclosingModalLayer,
      "selected-image controls must stay above their enclosing editor modal instead of opening a lower sibling layer",
    );
    assert.equal(dom.window.document.querySelectorAll('[data-mango-modal-layer="true"]').length, 1);
    dom.window.document.dispatchEvent(new dom.window.Event("pointerup"));
    const imageCommentButton = imageActions.querySelector<HTMLButtonElement>('button[aria-label="Comment on image"]');
    assert.ok(imageCommentButton);
    await act(async () => imageCommentButton.click());
    assert.deepEqual(imageChatRequests, ["block-image"]);

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

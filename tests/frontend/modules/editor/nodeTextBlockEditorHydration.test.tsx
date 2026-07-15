import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { EditorDocumentFormattingController } from "../../../../frontend/src/modules/editor/useEditorDocumentSurfaceHandlers.ts";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function attachmentDocument(attachmentID: string): string {
  const source = "mango-attachment:" + encodeURIComponent(attachmentID);
  return '<!-- mango-editor-html-v1 --><span data-mango-editor-image="true" data-mango-editor-attachment-id="' +
    attachmentID + '"><img src="' + source + '" alt=""></span>';
}

async function flushAsyncWork() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

test("NodeTextBlockEditor restores its attachment hydrator after StrictMode replay", { timeout: 5_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window",
    "document",
    "navigator",
    "self",
    "Node",
    "NodeFilter",
    "Element",
    "HTMLElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLImageElement",
    "HTMLTemplateElement",
    "HTMLLIElement",
    "HTMLUListElement",
    "HTMLAnchorElement",
    "HTMLBRElement",
    "HTMLTableElement",
    "HTMLTableRowElement",
    "HTMLTableCellElement",
    "DocumentFragment",
    "DOMParser",
    "DOMException",
    "Event",
    "EventTarget",
    "MouseEvent",
    "KeyboardEvent",
    "FocusEvent",
    "MutationObserver",
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
  const animationFrames = new Map<number, FrameRequestCallback>();
  const requestFrame = (callback: FrameRequestCallback) => {
    const frameID = nextFrameID += 1;
    animationFrames.set(frameID, callback);
    return frameID;
  };
  const cancelFrame = (frameID: number) => {
    animationFrames.delete(frameID);
  };
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);

  let activeObservers = 0;
  let maximumActiveObservers = 0;
  let observerCreations = 0;
  let observerDisconnects = 0;
  class TestIntersectionObserver {
    private active = true;
    private readonly observed = new Set<Element>();

    constructor(
      private readonly callback: IntersectionObserverCallback,
      readonly options?: IntersectionObserverInit,
    ) {
      observerCreations += 1;
      activeObservers += 1;
      maximumActiveObservers = Math.max(maximumActiveObservers, activeObservers);
    }

    observe(target: Element) {
      this.observed.add(target);
      this.callback([{
        target,
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }

    unobserve(target: Element) {
      this.observed.delete(target);
    }

    disconnect() {
      if (!this.active) return;
      this.active = false;
      this.observed.clear();
      observerDisconnects += 1;
      activeObservers -= 1;
    }

    takeRecords() {
      return [];
    }

    readonly root = null;
    readonly rootMargin = "800px 0px";
    readonly thresholds = [0];
  }
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "IntersectionObserver", {
    configurable: true,
    writable: true,
    value: TestIntersectionObserver,
  });

  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  const createdObjectURLs: string[] = [];
  const revokedObjectURLs: string[] = [];
  URL.createObjectURL = () => {
    const value = "blob:test-" + (createdObjectURLs.length + 1);
    createdObjectURLs.push(value);
    return value;
  };
  URL.revokeObjectURL = (value) => {
    revokedObjectURLs.push(value);
  };
  Object.defineProperty(dom.window.URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: URL.createObjectURL,
  });
  Object.defineProperty(dom.window.URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: URL.revokeObjectURL,
  });

  const fetchedURLs: string[] = [];
  const fetchSignals: AbortSignal[] = [];
  let fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    fetchedURLs.push(String(input));
    if (init?.signal) fetchSignals.push(init.signal);
    return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
  };
  installGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => fetchImplementation(input, init), restores);

  let mountedRoot: { unmount(): void } | null = null;
  let pendingMountedRoot: { unmount(): void } | null = null;
  let unifiedMountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { NodeTextBlockEditor }, { UnifiedRichEditorSurface }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
      import("../../../../frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"),
    ]);
    const noop = () => undefined;
    const emptyUsers: never[] = [];
    const flushedDocuments: string[] = [];
    const emptyChanges: never[] = [];
    const emptyMessages: never[] = [];
    const formattingControllerRef: React.MutableRefObject<EditorDocumentFormattingController | null> = { current: null };
    const baseProps = {
      blockID: "block-1",
      editable: true,
      nodeID: "node-1",
      apiBase: "https://api.test",
      companyID: "company-1",
      currentUserID: "user-1",
      companyUsers: emptyUsers,
      contentChanges: emptyChanges,
      chatMessages: emptyMessages,
      activeChatAnchorMessageID: "",
      chatNavigationRequest: null,
      tableInsertRequestID: 0,
      surfaceText: "#111827",
      accent: "#7c3aed",
      outlineStyle: "automatic-outline-numbering" as const,
      indentGuideColor: "#94a3b8",
      scrollbarTrack: "#e2e8f0",
      onFocus: noop,
      onBlur: noop,
      onDocumentChange: noop,
      onDocumentFlush: (value: string) => { flushedDocuments.push(value); },
      onChangeSeen: noop,
      onSelectionChatRequest: noop,
      onImageChatRequest: noop,
      onImageNodeRequest: noop,
      formattingControllerRef,
      formattingControllerActive: true,
    };
    const renderEditor = (documentValue: string) => (
      <React.StrictMode>
        <NodeTextBlockEditor {...baseProps} documentValue={documentValue} />
      </React.StrictMode>
    );

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const firstDocument = attachmentDocument("attachment-1");

    await act(async () => {
      root.render(renderEditor(firstDocument));
    });
    await flushAsyncWork();

    const editor = container.querySelector<HTMLElement>('[data-node-text-block-id="block-1"]');
    const firstImage = editor?.querySelector("img");
    assert.ok(editor);
    assert.ok(firstImage);
    assert.ok(formattingControllerRef.current, "the initial formatting target publishes its controller before editor focus");
    assert.notEqual(dom.window.document.activeElement, editor, "publishing the initial controller must not steal browser focus");
    assert.equal(firstImage.getAttribute("src"), "blob:test-1");
    assert.equal(activeObservers, 1);
    assert.equal(maximumActiveObservers, 1);
    assert.equal(observerCreations, 2);
    assert.equal(observerDisconnects, 1);
    assert.equal(fetchedURLs.length, 1);
    assert.equal(fetchSignals[0]?.aborted, false);
    assert.deepEqual(createdObjectURLs, ["blob:test-1"]);

    await act(async () => {
      editor.focus();
      editor.blur();
    });
    assert.deepEqual(flushedDocuments, [], "focusing and selecting an unchanged image must not flush a node projection");

    const firstFrame = firstImage.closest('[data-mango-editor-image="true"]');
    assert.ok(firstFrame);
    firstFrame.setAttribute("data-mango-editor-image-selected", "true");
    await act(async () => {
      editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    assert.equal(editor.querySelector("img"), null);

    await act(async () => {
      editor.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    await flushAsyncWork();
    const undoRestoredImage = editor.querySelector("img");
    assert.ok(undoRestoredImage);
    assert.equal(undoRestoredImage.getAttribute("src"), "blob:test-2");
    assert.deepEqual(createdObjectURLs, ["blob:test-1", "blob:test-2"]);
    assert.deepEqual(revokedObjectURLs, ["blob:test-1"]);
    assert.equal(activeObservers, 1);
    assert.equal(observerCreations, 3);
    assert.equal(observerDisconnects, 2);
    assert.equal(fetchedURLs.length, 1);

    await act(async () => {
      root.render(renderEditor(firstDocument));
    });
    await flushAsyncWork();
    assert.equal(activeObservers, 1);
    assert.equal(observerCreations, 3);
    assert.equal(fetchedURLs.length, 1);
    assert.deepEqual(createdObjectURLs, ["blob:test-1", "blob:test-2"]);

    const secondDocument = attachmentDocument("attachment-2");
    await act(async () => {
      root.render(renderEditor(secondDocument));
    });
    await flushAsyncWork();

    const secondImage = editor.querySelector("img");
    assert.ok(secondImage);
    assert.equal(undoRestoredImage.getAttribute("src"), "mango-attachment:attachment-1");
    assert.equal(secondImage.getAttribute("src"), "blob:test-3");
    assert.equal(activeObservers, 1);
    assert.equal(maximumActiveObservers, 1);
    assert.equal(fetchedURLs.length, 2);
    assert.deepEqual(revokedObjectURLs, ["blob:test-1", "blob:test-2"]);

    await act(async () => {
      root.unmount();
    });
    mountedRoot = null;
    assert.equal(activeObservers, 0);
    assert.equal(formattingControllerRef.current, null);
    assert.equal(secondImage.getAttribute("src"), "mango-attachment:attachment-2");
    assert.deepEqual(revokedObjectURLs, ["blob:test-1", "blob:test-2", "blob:test-3"]);
    assert.equal(animationFrames.size, 0);

    const pendingContainer = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(pendingContainer);
    let pendingFetchSignal: AbortSignal | null = null;
    let resolvePendingFetchAbort!: () => void;
    const pendingFetchAbort = new Promise<void>((resolve) => {
      resolvePendingFetchAbort = resolve;
    });
    fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetchedURLs.push(String(input));
      pendingFetchSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        pendingFetchSignal?.addEventListener("abort", () => {
          resolvePendingFetchAbort();
          reject(new DOMException("The operation was aborted.", "AbortError"));
        }, { once: true });
      });
    };
    const pendingRoot = createRoot(pendingContainer);
    pendingMountedRoot = pendingRoot;
    await act(async () => {
      pendingRoot.render(renderEditor(attachmentDocument("attachment-pending")));
    });
    await flushAsyncWork();
    assert.equal(activeObservers, 1);
    assert.equal(fetchedURLs.length, 3);
    assert.equal(pendingFetchSignal?.aborted, false);

    await act(async () => {
      pendingRoot.unmount();
    });
    pendingMountedRoot = null;
    await pendingFetchAbort;
    await flushAsyncWork();
    assert.equal(pendingFetchSignal?.aborted, true);
    assert.equal(activeObservers, 0);
    assert.deepEqual(createdObjectURLs, ["blob:test-1", "blob:test-2", "blob:test-3"]);
    assert.equal(animationFrames.size, 0);
    const unifiedContainer = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(unifiedContainer);
    fetchImplementation = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      fetchedURLs.push(String(input));
      if (init?.signal) fetchSignals.push(init.signal);
      return new Response(new Blob(["image"], { type: "image/png" }), { status: 200 });
    };
    function ControlledUnifiedEditor() {
      const [documentValue, setDocumentValue] = React.useState(attachmentDocument("attachment-unified"));
      return (
        <React.StrictMode>
          <UnifiedRichEditorSurface
            value={documentValue}
            outlineStyle="automatic-outline-numbering"
            surfaceID="my-triage-compose"
            ariaLabel="Message"
            surfaceText="#111827"
            accent="#0ea5e9"
            indentGuideColor="#94a3b8"
            editorImageAttachmentContext={{
              apiBase: "https://api.test",
              companyID: "company-1",
              resourceType: "email_draft",
              resourceID: "personal:user-1:owner@example.test:draft-1",
              editorSurface: "my-triage-compose",
            }}
            eagerEditorImageHydration
            onChange={setDocumentValue}
          />
        </React.StrictMode>
      );
    }
    const unifiedFetchCountBeforeMount = fetchedURLs.length;
    const unifiedRoot = createRoot(unifiedContainer);
    unifiedMountedRoot = unifiedRoot;
    await act(async () => {
      unifiedRoot.render(<ControlledUnifiedEditor />);
    });
    await flushAsyncWork();

    const unifiedEditor = unifiedContainer.querySelector('[data-mango-unified-rich-editor="my-triage-compose"]');
    const unifiedImage = unifiedEditor?.querySelector("img");
    assert.ok(unifiedEditor);
    assert.ok(unifiedImage);
    assert.equal(fetchedURLs.length, unifiedFetchCountBeforeMount + 1);
    const stableImageSource = unifiedImage.getAttribute("src");
    const revokedBeforeTyping = revokedObjectURLs.length;

    await act(async () => {
      unifiedEditor.appendChild(dom.window.document.createTextNode("x"));
      unifiedEditor.dispatchEvent(new dom.window.Event("input", { bubbles: true, cancelable: true }));
    });
    await flushAsyncWork();

    assert.equal(unifiedEditor.querySelector("img"), unifiedImage);
    assert.equal(unifiedImage.getAttribute("src"), stableImageSource);
    assert.equal(fetchedURLs.length, unifiedFetchCountBeforeMount + 1);
    assert.equal(revokedObjectURLs.length, revokedBeforeTyping);

    await act(async () => unifiedRoot.unmount());
    unifiedMountedRoot = null;
    assert.equal(revokedObjectURLs.length, revokedBeforeTyping + 1);
  } finally {
    if (unifiedMountedRoot) {
      await act(async () => unifiedMountedRoot?.unmount());
    }
    if (pendingMountedRoot) {
      await act(async () => pendingMountedRoot?.unmount());
    }
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
    }
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

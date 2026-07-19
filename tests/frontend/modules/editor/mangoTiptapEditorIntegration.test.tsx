import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { getEditorRuntimeMetrics, resetEditorRuntimeMetricsForTests } from "../../../../frontend/src/modules/editor/editorRuntimeMetrics.ts";
import type { MangoTiptapFormattingController } from "../../../../frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx";
import { MangoTiptapStaticRenderer } from "../../../../frontend/src/modules/editor/tiptap/MangoTiptapStaticRenderer.tsx";
import type { MangoTiptapAnnotation } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapAnnotations.ts";
import type { MangoTiptapDocument } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.ts";
import { createMangoTiptapExtensions, MangoTiptapEditorEngine } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.ts";
import { mangoTiptapPendingStorageKey, readExactMangoTiptapPending } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapSync.ts";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

async function flushAsyncWork(rounds = 8) {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

async function waitFor(predicate: () => boolean, message: string) {
  for (let index = 0; index < 100; index += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  assert.fail(message);
}

function structuredDocument(): MangoTiptapDocument {
  return {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: { type: "doc", content: [
      { type: "paragraph", attrs: { blockId: "paragraph-1", indentLevel: 0 }, content: [{ type: "text", text: "Alpha" }] },
      { type: "paragraph", attrs: { blockId: "empty-paragraph" } },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "List item" }] }] }] },
      { type: "table", content: [{ type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1 }, content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }] }] }] },
      { type: "mangoAttachmentImage", attrs: { attachmentId: "image-1", filename: "image.png", mimeType: "image/png", alignment: "center", position: "break", layout: "content" } },
    ] },
  };
}

function largeStructuredDocument(): MangoTiptapDocument {
  const base = structuredDocument();
  return {
    ...base,
    document: {
      ...base.document,
      content: [
        ...(base.document.content ?? []),
        ...Array.from({ length: 400 }, (_, index) => ({
          type: "paragraph",
          attrs: { blockId: `large-paragraph-${index}`, indentLevel: 0 },
          content: [{ type: "text", text: `Large deterministic paragraph ${index} ${"x".repeat(80)}` }],
        })),
      ],
    },
  };
}

function structuredAnnotations(document: MangoTiptapDocument): MangoTiptapAnnotation[] {
  const editor = new MangoTiptapEditorEngine({
    extensions: createMangoTiptapExtensions({ editable: false }),
    content: document.document,
  });
  const annotations: MangoTiptapAnnotation[] = [];
  try {
    editor.state.doc.descendants((node, position) => {
      if (node.isText && ["Alpha", "List item", "Cell"].includes(node.text ?? "")) {
        annotations.push({ id: `annotation-${annotations.length + 1}`, kind: "comment", from: position, to: position + node.nodeSize });
      }
      if (node.type.name === "mangoAttachmentImage") {
        annotations.push({ id: "annotation-image", kind: "change", from: position, to: position + node.nodeSize });
        annotations.push({ id: "annotation-image-overlap", kind: "chat", from: position, to: position + node.nodeSize });
      }
    });
  } finally {
    editor.destroy();
  }
  return annotations;
}

test("static JSON renderer paints true ProseMirror ranges across blocks, lists, tables, and images", () => {
  const document = structuredDocument();
  const annotations = structuredAnnotations(document);
  const html = renderToStaticMarkup(
    <MangoTiptapStaticRenderer
      value={document}
      annotations={annotations}
      renderAttachmentImage={(attributes) => <span data-static-image={attributes.attachmentId}>{attributes.filename}</span>}
    />,
  );
  for (const annotation of annotations) assert.match(html, new RegExp(`data-mango-annotation-id="${annotation.id}"`));
  assert.match(html, /<ul>/);
  assert.match(html, /<table/);
  assert.match(html, /data-static-image="image-1"/);
});

test("mounted JSON editor batches full-document work, pins pending work, and uses visible-only realtime", { timeout: 10_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLSpanElement", "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement",
    "HTMLUListElement", "HTMLAnchorElement", "HTMLBRElement", "HTMLTableElement", "HTMLTableRowElement",
    "HTMLTableCellElement", "HTMLButtonElement", "HTMLInputElement", "DocumentFragment", "DOMParser",
    "DOMException", "Event", "EventTarget", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent",
    "CustomEvent", "MutationObserver", "Range", "Selection",
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
  const requestFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
  const cancelFrame = (handle: number) => clearTimeout(handle);
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);
  if (!dom.window.HTMLElement.prototype.scrollIntoView) dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  if (!dom.window.Range.prototype.getClientRects) dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!dom.window.Range.prototype.getBoundingClientRect) dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();

  const observers: TestIntersectionObserver[] = [];
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin: string;
    readonly thresholds: readonly number[];
    private target: Element | null = null;

    constructor(private readonly callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.rootMargin = options?.rootMargin ?? "0px";
      this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [Number(options?.threshold ?? 0)];
      observers.push(this);
    }

    observe(target: Element) {
      this.target = target;
      this.trigger(this.rootMargin.startsWith("600px"));
    }

    trigger(visible: boolean) {
      if (!this.target) return;
      this.callback([{
        target: this.target,
        isIntersecting: visible,
        intersectionRatio: visible ? 1 : 0,
      } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }

    disconnect() { this.target = null; }
    unobserve(target: Element) { if (this.target === target) this.target = null; }
    takeRecords() { return []; }
  }
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });

  const value = largeStructuredDocument();
  const annotations = structuredAnnotations(value);
  const controllerRef: React.MutableRefObject<MangoTiptapFormattingController | null> = { current: null };
  const lifecyclePins: boolean[] = [];
  const changes: string[] = [];
  let canonicalReads = 0;
  let canonicalRevision = 0;
  let canonicalDocument = value;
  let canonicalAnnotations = annotations.map(({ id, kind, from, to }) => ({ id, kind, from, to }));
  let postStarted = false;
  let releasePost: (() => void) | undefined;
  let subscriptions = 0;
  let unsubscriptions = 0;
  const requestJSON = async <T,>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (init?.method !== "POST") {
      canonicalReads += 1;
      return { revision: canonicalRevision, schema_version: 1, document: canonicalDocument, annotations: canonicalAnnotations } as T;
    }
    postStarted = true;
    await new Promise<void>((resolve) => { releasePost = resolve; });
    canonicalRevision += 1;
    canonicalDocument = init.json && typeof init.json === "object" && "document" in init.json
      ? (init.json as { document: MangoTiptapDocument }).document
      : canonicalDocument;
    canonicalAnnotations = init.json && typeof init.json === "object" && "annotations" in init.json
      ? (init.json as { annotations: typeof canonicalAnnotations }).annotations
      : canonicalAnnotations;
    return { revision: canonicalRevision, schema_version: 1, document: canonicalDocument, annotations: canonicalAnnotations } as T;
  };

  let mountedRoot: { unmount(): void } | null = null;
  let pageHostRoot: { unmount(): void } | null = null;
  let setHostVisible: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;
  resetEditorRuntimeMetricsForTests();
  try {
    const [{ createRoot }, { MangoTiptapEditor }, { NodeTextBlockEditor }, { LogicGateTiptapEditorSurface }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
      import("../../../../frontend/src/modules/editor/LogicGateTiptapEditorSurface.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    function VirtualizedEditorHost() {
      const [rowVisible, setRowVisible] = React.useState(true);
      const [pinned, setPinned] = React.useState(false);
      setHostVisible = setRowVisible;
      if (!rowVisible && !pinned) return <div data-virtual-row-placeholder="document-1" />;
      return (
        <MangoTiptapEditor
          value={JSON.stringify(value)}
          editable
          ariaLabel="JSON document"
          companyID="company-1"
          resourceType="node"
          resourceID="node-1"
          documentID="document-1"
          requestJSON={requestJSON}
          subscribeToCanonicalChange={() => {
            subscriptions += 1;
            return () => { unsubscriptions += 1; };
          }}
          annotations={annotations}
          formattingControllerRef={controllerRef}
          onChange={(next) => changes.push(next)}
          onLifecycleChange={(snapshot) => {
            lifecyclePins.push(snapshot.pinned);
            setPinned(snapshot.pinned);
          }}
        />
      );
    }
    await act(async () => {
      root.render(<VirtualizedEditorHost />);
    });
    await waitFor(() => canonicalReads === 1, "near-viewport preparation should recover the canonical JSON document");
    const editorRoot = container.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    assert.ok(editorRoot);
    await waitFor(() => editorRoot.dataset.mangoEditorState === "sleeping", "canonical preparation should finish before visibility changes");
    assert.equal(subscriptions, 0, "the 600px preparation margin must not create a realtime document scope");
    for (const annotation of annotations) {
      assert.ok(editorRoot.querySelector(`[data-mango-annotation-id="${annotation.id}"]`), `sleeping renderer should paint ${annotation.id}`);
    }

    const exactObserver = observers.find((observer) => observer.rootMargin === "0px");
    assert.ok(exactObserver);
    exactObserver.trigger(true);
    await waitFor(() => subscriptions === 1 && canonicalReads === 2, "visible entry should subscribe and refresh canonical state");

    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
    });
    await waitFor(() => controllerRef.current !== null, "visible focused JSON document should activate a ProseMirror editor");
    resetEditorRuntimeMetricsForTests();
    const changeCountBeforeTyping = changes.length;
    await act(async () => {
      for (let index = 0; index < 10; index += 1) assert.equal(controllerRef.current?.indent(), true);
    });
    assert.ok(getEditorRuntimeMetrics().transactions >= 10, "each immediate ProseMirror edit should transact in memory");
    assert.equal(getEditorRuntimeMetrics().full_document_serializations, 0, "transaction burst must not serialize eagerly");
    assert.equal(getEditorRuntimeMetrics().indexeddb_writes, 0, "transaction burst must not persist recovery state eagerly");
    assert.equal(changes.length, changeCountBeforeTyping, "parent receives one batched snapshot instead of per-transaction JSON");
    assert.equal(editorRoot.dataset.mangoEditorPinned, "true", "dirty work pins the mounted editor immediately");

    await waitFor(() => postStarted, "quiet-period batch should start one backend save");
    assert.equal(getEditorRuntimeMetrics().full_document_serializations, 1);
    assert.equal(getEditorRuntimeMetrics().indexeddb_writes, 1);
    assert.equal(changes.length, changeCountBeforeTyping + 1);
    const pendingKey = mangoTiptapPendingStorageKey({
      companyID: "company-1", resourceType: "node", resourceID: "node-1", documentID: "document-1",
    });
    const pendingRecord = await readExactMangoTiptapPending(pendingKey);
    assert.ok(pendingRecord);
    assert.deepEqual(pendingRecord.commits[0]?.annotations, canonicalAnnotations, "mapped positions share the exact pending save batch");

    exactObserver.trigger(false);
    assert.equal(unsubscriptions, 1, "offscreen dirty editor releases the exact realtime scope immediately");
    await act(async () => { setHostVisible(false); });
    assert.ok(container.contains(editorRoot), "offscreen dirty editor remains mounted only to finish its save");
    assert.equal(editorRoot.dataset.mangoEditorPinned, "true");
    releasePost?.();
    await waitFor(() => Boolean(container.querySelector('[data-virtual-row-placeholder="document-1"]')), "backend acknowledgement should release the virtual-row pin and permit unmount");
    assert.equal(await readExactMangoTiptapPending(pendingKey), null, "acknowledgement deletes the exact pending recovery record");
    assert.equal(lifecyclePins.includes(true), true);
    assert.equal(lifecyclePins.at(-1), false);
    assert.equal(controllerRef.current, null, "released clean row tears down its active editor");

    const readsBeforeReentry = canonicalReads;
    await act(async () => { setHostVisible(true); });
    await waitFor(() => canonicalReads > readsBeforeReentry, "returning virtual row should fetch the latest canonical document");
    const remountedEditorRoot = container.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    assert.ok(remountedEditorRoot);
    await waitFor(() => remountedEditorRoot.dataset.mangoEditorState === "sleeping", "re-entered row should finish its near-viewport canonical recovery");
    for (const annotation of canonicalAnnotations) {
      assert.ok(remountedEditorRoot.querySelector(`[data-mango-annotation-id="${annotation.id}"]`), `persisted ${annotation.kind} position should survive remount`);
    }
    const reentryExactObserver = observers.filter((observer) => observer.rootMargin === "0px").at(-1);
    assert.ok(reentryExactObserver);
    reentryExactObserver.trigger(true);
    await waitFor(() => subscriptions === 2 && canonicalReads > readsBeforeReentry + 1, "visible re-entry should create one new exact scope and refresh after subscribing");

    const pageHostContainer = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(pageHostContainer);
    const pageHostPaths: string[] = [];
    const pageHostDocument = structuredDocument();
    const pageHostRequest = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      pageHostPaths.push(path);
      if (path.startsWith("/v1/editor-data-format")) {
        return {
          company_id: "company-hosts",
          editor_format: "tiptap_json",
          migration_state: "ready",
          document_schema_version: 1,
          expected_document_count: 3,
          converted_document_count: 3,
        } as T;
      }
      if (init?.method === "POST") {
        const body = init.json as { document: MangoTiptapDocument; annotations?: typeof canonicalAnnotations };
        return { revision: 1, schema_version: 1, document: body.document, annotations: body.annotations ?? [] } as T;
      }
      return { revision: 0, schema_version: 1, document: pageHostDocument, annotations: [] } as T;
    };
    const noop = () => undefined;
    const pageHostBaseProps = {
      editable: true,
      apiBase: "https://page-hosts.test",
      companyID: "company-hosts",
      currentUserID: "user-hosts",
      companyUsers: [],
      documentValue: JSON.stringify(pageHostDocument),
      contentChanges: [],
      chatMessages: [],
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
      onSelectionChatRequest: noop,
      onImageChatRequest: noop,
      onImageNodeRequest: noop,
      attachmentRequestJSON: pageHostRequest,
    };
    const pageRoot = createRoot(pageHostContainer);
    pageHostRoot = pageRoot;
    await act(async () => {
      pageRoot.render(
        <>
          <NodeTextBlockEditor {...pageHostBaseProps} surfaceKind="node" nodeID="node-host" blockID="node-document" />
          <NodeTextBlockEditor
            {...pageHostBaseProps}
            surfaceKind="project"
            nodeID="project-host"
            attachmentResourceID="project-host"
            blockID="project-document"
          />
          <React.Suspense fallback={<div aria-label="Loading Logic Gate JSON host" />}>
            <LogicGateTiptapEditorSurface
              value={JSON.stringify(pageHostDocument)}
              editable
              companyID="company-hosts"
              resourceID="logic-gate-host"
              documentID="logic-gate-document"
              currentUserID="user-hosts"
              requestJSON={pageHostRequest}
            />
          </React.Suspense>
        </>,
      );
    });
    await waitFor(
      () => pageHostContainer.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length === 3,
      "the real Node, Project, and Logic Gate JSON host adapters should all mount Tiptap",
    );
    assert.ok(pageHostContainer.querySelector('[aria-label="Node text box"]'));
    assert.ok(pageHostContainer.querySelector('[aria-label="Project text box"]'));
    assert.ok(pageHostContainer.querySelector('[aria-label="Logic Gate editor"]'));
    await waitFor(
      () => pageHostPaths.some((path) => path.includes("/v1/editor-json/node/node-host/documents/node-document"))
        && pageHostPaths.some((path) => path.includes("/v1/editor-json/project/project-host/documents/project-document"))
        && pageHostPaths.some((path) => path.includes("/v1/editor-json/logic_gate/logic-gate-host/documents/logic-gate-document")),
      "each production host adapter should address its own JSON resource type",
    );
    await act(async () => pageRoot.unmount());
    pageHostRoot = null;
    pageHostContainer.remove();

    await act(async () => {
      remountedEditorRoot.dispatchEvent(new dom.window.FocusEvent("focusin", { bubbles: true }));
    });
    await waitFor(() => controllerRef.current !== null, "remounted visible document should activate again");
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: undefined });
    postStarted = false;
    releasePost = undefined;
    await act(async () => { assert.equal(controllerRef.current?.indent(), true); });
    await waitFor(
      () => (remountedEditorRoot.querySelector('[role="alert"]')?.textContent ?? "").includes("Browser recovery storage failed:"),
      "unavailable IndexedDB should produce a visible recovery-safety error",
    );
    await waitFor(() => postStarted, "storage failure must not prevent the canonical backend save");
    assert.equal(remountedEditorRoot.dataset.mangoEditorPinned, "true");
    releasePost?.();
    await waitFor(() => remountedEditorRoot.dataset.mangoEditorPinned !== "true", "backend acknowledgement should unpin despite IndexedDB failure");

    await act(async () => root.unmount());
    mountedRoot = null;
    assert.equal(subscriptions, 2);
    assert.equal(unsubscriptions, 2, "unmount cleanup releases only the active re-entry subscription");
  } finally {
    releasePost?.();
    if (pageHostRoot) await act(async () => pageHostRoot?.unmount());
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

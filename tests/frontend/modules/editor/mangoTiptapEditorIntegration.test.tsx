import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Simulate } from "react-dom/test-utils";

import {
  restartEditorTraceForTests,
  resetEditorTraceForTests,
  startEditorTraceForTests,
  stopEditorTraceForTests,
} from "../../../../frontend/src/modules/editor/editorTrace.ts";
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
      { type: "paragraph", attrs: { blockId: "legacy-date-heading" }, content: [
        { type: "text", text: "07/20/26 " },
        { type: "text", text: "HR / EA, Sammie Lee", marks: [{ type: "textStyle", attrs: { fontSize: "14px" } }, { type: "bold" }] },
      ] },
      { type: "paragraph", attrs: { blockId: "paragraph-1", indentLevel: 0 }, content: [
        { type: "text", text: "Alpha" },
        { type: "mangoEntityLink", attrs: { entityType: "project", entityId: "project-1", label: "Project One" } },
      ] },
      { type: "paragraph", attrs: { blockId: "empty-paragraph" } },
      { type: "bulletList", content: [{
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "List item" }] },
          { type: "bulletList", content: [{
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Nested item" }] },
              { type: "bulletList", content: [{
                type: "listItem",
                content: [
                  { type: "paragraph", content: [{ type: "text", text: "Third-level item" }] },
                  { type: "bulletList", content: [{
                    type: "listItem",
                    content: [{ type: "paragraph", content: [{ type: "text", text: "Fourth-level item" }] }],
                  }] },
                ],
              }] },
            ],
          }] },
        ],
      }] },
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
        const kind = node.text === "List item" ? "chat" : "comment";
        annotations.push({ id: `annotation-${annotations.length + 1}`, kind, from: position, to: position + node.nodeSize });
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
  assert.match(html, /class="mango-tiptap-document mango-tiptap-static-document"/);
  assert.match(html, /mango-tiptap-annotation--chat/);
  assert.match(html, /<ul>/);
  assert.match(html, /data-mango-legacy-leading-date-heading="true"/);
  assert.equal((html.match(/<ul>/g) ?? []).length, 4);
  assert.match(html, /Third-level item/);
  assert.match(html, /Fourth-level item/);
  assert.match(html, /<table/);
  assert.match(html, /data-static-image="image-1"/);
  assert.match(html, /data-mango-entity-id="project-1"/);
  assert.match(html, /href="\/projects\/project-1"/);
  assert.match(html, /mango-editor-entity-icon/);
  assert.match(html, /M2.3 3.1h11.4v9.8H2.3z/);

  const compactDefaultsHTML = renderToStaticMarkup(
    <MangoTiptapStaticRenderer
      value={{
        format: "mango-tiptap-json",
        schema_version: 1,
        document: { type: "doc", content: [
          { type: "paragraph", content: [{ type: "mangoEntityLink", attrs: { entityId: "node-compact", label: "Compact Node" } }] },
          { type: "paragraph", content: [{ type: "text", text: "Compact link", marks: [{ type: "link", attrs: { href: "https://example.test" } }] }] },
          { type: "mangoAttachmentImage", attrs: { attachmentId: "compact-image", filename: "compact.png", mimeType: "image/png" } },
        ] },
      }}
      renderAttachmentImage={(attributes) => (
        <span
          data-compact-image={attributes.attachmentId}
          data-alignment={attributes.alignment}
          data-position={attributes.position}
          data-layout={attributes.layout}
        />
      )}
    />,
  );
  assert.match(compactDefaultsHTML, /href="\/nodes\/node-compact"/);
  assert.match(compactDefaultsHTML, /href="https:\/\/example.test" target="_blank"/);
  assert.match(compactDefaultsHTML, /data-compact-image="compact-image"/);
  assert.match(compactDefaultsHTML, /data-alignment="left"/);
  assert.match(compactDefaultsHTML, /data-position="break"/);
  assert.match(compactDefaultsHTML, /data-layout="content"/);

  const presentationCSS = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/tiptap/mangoTiptap.css"), "utf8");
  assert.match(presentationCSS, /font-size:\s*14px/);
  assert.match(presentationCSS, /line-height:\s*20px/);
  assert.match(presentationCSS, /padding:\s*12px 13px/);
  assert.match(presentationCSS, /min-height:\s*100%/);
  assert.match(presentationCSS, /\.mango-tiptap-active-surface[^}]+height:\s*100%/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror:focus[^}]+outline:\s*none/s);
  assert.match(presentationCSS, /data-mango-editor-editable="true"[^}]+cursor:\s*text/s);
  assert.match(presentationCSS, /ul:not\(\[data-type="taskList"\]\) > li::before/);
  assert.match(presentationCSS, /ul:not\(\[data-type="taskList"\]\) ul:not\(\[data-type="taskList"\]\) ul:not\(\[data-type="taskList"\]\) ul:not\(\[data-type="taskList"\]\) > li::before/);
  assert.match(presentationCSS, /border-radius:\s*999px/);
  assert.match(presentationCSS, /border-radius:\s*1px/);
  assert.match(presentationCSS, /background:\s*linear-gradient\(135deg, rgba\(254, 255, 102, 0\.72\), rgba\(250, 232, 28, 0\.58\)\)/);
  assert.match(presentationCSS, /data-mango-legacy-leading-date-heading="true"/);
  assert.match(presentationCSS, /margin-top:\s*20px/);
  assert.match(presentationCSS, /ol ol[^}]+list-style-type:\s*lower-alpha/s);
  assert.match(presentationCSS, /ol ol ol > li::marker[^}]+counter\(list-item\) "\)  "/s);
  assert.match(presentationCSS, /ol ol ol ol > li::marker[^}]+counter\(list-item, lower-alpha\) "\)  "/s);
  assert.match(presentationCSS, /li > (?:ul|ol)[\s\S]+border-left:\s*1px solid rgba\(100, 116, 139, 0\.3\)/);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror table[^}]+border-collapse:\s*collapse/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror td[^}]+border:\s*1px solid #94a3b8/s);
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
  const imageFetchURLs: string[] = [];
  const NativeResponse = globalThis.Response;
  installGlobal("fetch", async (input: RequestInfo | URL) => {
    imageFetchURLs.push(String(input));
    return new NativeResponse(new Blob(["image-bytes"], { type: "image/png" }), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  }, restores);
  const originalFocus = dom.window.HTMLElement.prototype.focus;
  let preventScrollEditorFocuses = 0;
  dom.window.HTMLElement.prototype.focus = function focus(options?: FocusOptions) {
    if (this.classList.contains("mango-tiptap-prosemirror")) {
      if (options?.preventScroll) preventScrollEditorFocuses += 1;
      else {
        const editorRoot = this.closest<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
        if (editorRoot) editorRoot.scrollTop = 0;
      }
    }
    originalFocus.call(this, options);
  };
  restores.push(() => { dom.window.HTMLElement.prototype.focus = originalFocus; });
  const requestFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
  const cancelFrame = (handle: number) => clearTimeout(handle);
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);
  if (!dom.window.HTMLElement.prototype.scrollIntoView) dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  if (!dom.window.Range.prototype.getClientRects) dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  if (!dom.window.Range.prototype.getBoundingClientRect) dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  if (!dom.window.document.elementFromPoint) {
    Object.defineProperty(dom.window.document, "elementFromPoint", {
      configurable: true,
      value: () => dom.window.document.querySelector(".mango-tiptap-prosemirror") ?? dom.window.document.body,
    });
  }

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
    isObserving(target?: Element) { return target ? this.target === target : this.target !== null; }
  }
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });

  const value = largeStructuredDocument();
  const annotations = structuredAnnotations(value);
  const controllerRef: React.MutableRefObject<MangoTiptapFormattingController | null> = { current: null };
  const lifecyclePins: boolean[] = [];
  const selectionFontSizes: number[] = [];
  const selectionInlineFormats: Array<{ bold: boolean; underline: boolean; italic: boolean; strikethrough: boolean }> = [];
  let canonicalReads = 0;
  let canonicalRevision = 0;
  let canonicalDocument = value;
  let canonicalAnnotations = annotations.map(({ id, kind, from, to }) => ({ id, kind, from, to }));
  let postStarted = false;
  let postedDocument: MangoTiptapDocument | null = null;
  let releasePost: (() => void) | undefined;
  let subscriptions = 0;
  let unsubscriptions = 0;
  let subscriptionRecover: (() => void | Promise<void>) | undefined;
  let conflictCallbacks = 0;
  const documentErrors: string[] = [];
  const storageErrors: string[] = [];
  let storageRecoveries = 0;
  const remoteImageImports: Array<{ path: string; body: unknown }> = [];
  let holdRemoteImageImport = false;
  let releaseRemoteImageImport: (() => void) | undefined;
  const requestJSON = async <T,>(_path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    if (_path === "/v1/attachments/imports/remote-image") {
      remoteImageImports.push({ path: _path, body: init?.json });
      if (holdRemoteImageImport) {
        await new Promise<void>((resolve) => { releaseRemoteImageImport = resolve; });
      }
      const attachment = {
        company_id: "company-1",
        attachment_id: "google-docs-paste-image",
        original_filename: "google-docs-tree.png",
        mime_type: "image/png",
        byte_size: 2048,
        sha256: "google-docs-image-sha256",
        original_width: 546,
        original_height: 427,
        source_kind: "editor_paste",
        created_timestamp: "2026-07-29T16:00:00Z",
      };
      return {
        attachment,
        resource_attachment: {
          resource_attachment_id: "resource-google-docs-paste-image",
          company_id: "company-1",
          resource_type: "node",
          resource_id: "node-1",
          attachment_id: attachment.attachment_id,
          relationship_kind: "inline_image",
          created_timestamp: "2026-07-29T16:00:00Z",
          attachment,
        },
      } as T;
    }
    if (init?.method !== "POST") {
      canonicalReads += 1;
      return { revision: canonicalRevision, schema_version: 1, document: canonicalDocument, annotations: canonicalAnnotations } as T;
    }
    postStarted = true;
    const body = init.json as { operation_id: string; document: MangoTiptapDocument; annotations?: typeof canonicalAnnotations };
    postedDocument = body.document;
    await new Promise<void>((resolve) => { releasePost = resolve; });
    canonicalRevision += 1;
    canonicalDocument = body.document;
    canonicalAnnotations = body.annotations ?? [];
    return { operation_id: body.operation_id, revision: canonicalRevision, committed_at: "2026-07-29T18:00:00Z" } as T;
  };

  let mountedRoot: { unmount(): void } | null = null;
  let pageHostRoot: { unmount(): void } | null = null;
  let setHostVisible: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;
  let forceHostRerender: () => void = () => undefined;
  resetEditorRuntimeMetricsForTests();
  startEditorTraceForTests();
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
      const [, setRenderVersion] = React.useState(0);
      forceHostRerender = () => setRenderVersion((current) => current + 1);
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
          attachmentContext={{
            requestJSON,
            apiBase: "http://localhost",
            companyID: "company-1",
            resourceType: "node",
            resourceID: "node-1",
            informationID: "document-1",
            editorSurface: "node",
          }}
          onImageChatRequest={() => undefined}
          onImageNodeRequest={() => undefined}
          subscribeToCanonicalChange={(recover) => {
            subscriptionRecover = recover;
            subscriptions += 1;
            return () => { unsubscriptions += 1; };
          }}
          annotations={annotations.map((annotation) => ({ ...annotation }))}
          formattingControllerRef={controllerRef}
          onSelectionFontSizeChange={(fontSize) => selectionFontSizes.push(fontSize)}
          onSelectionInlineFormatChange={(format) => selectionInlineFormats.push(format)}
          onConflict={() => { conflictCallbacks += 1; }}
          onError={(message) => documentErrors.push(message)}
          onRecoveryStorageError={(message) => storageErrors.push(message)}
          onRecoveryStorageRecovered={() => { storageRecoveries += 1; }}
          onLifecycleChange={(snapshot) => {
            lifecyclePins.push(snapshot.pinned);
            setPinned(snapshot.pinned);
          }}
        />
      );
    }
    await act(async () => {
      root.render(<React.StrictMode><VirtualizedEditorHost /></React.StrictMode>);
    });
    await waitFor(() => canonicalReads >= 2, "Strict Mode remount should replace the stopped preparation and recover the canonical JSON document");
    const editorRoot = container.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]');
    assert.ok(editorRoot);
    await waitFor(() => editorRoot.dataset.mangoEditorState === "sleeping", "canonical preparation should finish before visibility changes");
    assert.equal(editorRoot.dataset.mangoEditorEditable, "true", "editable sleeping JSON documents must advertise their text cursor state");
    assert.equal(subscriptions, 0, "the 600px preparation margin must not create a realtime document scope");
    for (const annotation of annotations) {
      assert.ok(editorRoot.querySelector(`[data-mango-annotation-id="${annotation.id}"]`), `sleeping renderer should paint ${annotation.id}`);
    }

    const exactObserver = observers.filter((observer) => observer.rootMargin === "0px" && observer.isObserving(editorRoot)).at(-1);
    assert.ok(exactObserver);
    const readsBeforeVisible = canonicalReads;
    const subscriptionsBeforeVisible = subscriptions;
    exactObserver.trigger(true);
    await waitFor(
      () => subscriptions > subscriptionsBeforeVisible && canonicalReads > readsBeforeVisible,
      "visible entry should subscribe and refresh canonical state",
    );

    editorRoot.scrollTop = 287;
    const activationEvent = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 8, clientY: 8 });
    await act(async () => {
      editorRoot.dispatchEvent(activationEvent);
    });
    assert.equal(activationEvent.defaultPrevented, true, "activation must suppress native focus on the static renderer that is about to be replaced");
    await waitFor(() => controllerRef.current !== null, "a normal pointer click should activate a visible ProseMirror editor");
    await flushAsyncWork(2);
    assert.equal(editorRoot.scrollTop, 287, "activating a scrolled JSON document must keep its exact text-box scroll position");
    assert.ok(preventScrollEditorFocuses >= 1, "pointer activation must focus without asking the browser to scroll");
    const activeProseMirror = editorRoot.querySelector<HTMLElement>(".mango-tiptap-prosemirror");
    assert.ok(activeProseMirror);
    assert.equal(activeProseMirror.parentElement?.classList.contains("mango-tiptap-active-surface"), true, "the active EditorContent wrapper must fill the full text box");
    assert.equal(activeProseMirror.getAttribute("contenteditable"), "true", "the clicked JSON document should become a real editable surface");
    assert.equal(activeProseMirror.dataset.mangoLegacyLeadingDateHeading, "true");

    const selectionPublicationsBeforeStableRerender = selectionInlineFormats.length;
    restartEditorTraceForTests();
    await act(async () => { forceHostRerender(); });
    await flushAsyncWork(4);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    const stableRerenderTrace = stopEditorTraceForTests();
    assert.equal(
      stableRerenderTrace.events.filter((event) => event.name === "prosemirror.dispatch_transaction").length,
      0,
      "a parent rerender with a new but content-identical annotation array must not dispatch any ProseMirror transaction",
    );
    assert.ok(
      stableRerenderTrace.events.filter((event) => event.name === "react.mango_tiptap_editor.commit").length <= 2,
      "one parent rerender must settle instead of starting an editor commit loop",
    );
    assert.equal(selectionInlineFormats.length, selectionPublicationsBeforeStableRerender, "an annotation-only rerender must not republish toolbar state");
    startEditorTraceForTests();
    await act(async () => { assert.equal(controllerRef.current?.adjustFontSize(1), true); });
    await waitFor(() => selectionFontSizes.at(-1) === 16, "the plus command must immediately update the toolbar number");
    await act(async () => { assert.equal(controllerRef.current?.toggleInlineFormat("bold"), true); });
    await waitFor(() => selectionInlineFormats.at(-1)?.bold === true, "bold must immediately report its active toolbar state");
    await act(async () => { assert.equal(controllerRef.current?.toggleInlineFormat("underline"), true); });
    await waitFor(() => selectionInlineFormats.at(-1)?.underline === true, "underline must immediately report its active toolbar state");
    await act(async () => { assert.equal(controllerRef.current?.toggleInlineFormat("italic"), true); });
    await waitFor(() => selectionInlineFormats.at(-1)?.italic === true, "italic must execute and immediately report its active toolbar state");
    await act(async () => {
      controllerRef.current?.toggleInlineFormat("italic");
      controllerRef.current?.toggleInlineFormat("underline");
      controllerRef.current?.toggleInlineFormat("bold");
      controllerRef.current?.adjustFontSize(-1);
    });
    await waitFor(
      () => selectionFontSizes.at(-1) === 15
        && selectionInlineFormats.at(-1)?.bold === false
        && selectionInlineFormats.at(-1)?.underline === false
        && selectionInlineFormats.at(-1)?.italic === false,
      "toolbar commands should return to the caret's original format state",
    );

    let activeImageFrame = activeProseMirror.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]');
    assert.ok(activeImageFrame);
    await act(async () => {
      activeImageFrame.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitFor(() => activeImageFrame.dataset.selected === "true", "clicking an inline image should create a visible Tiptap node selection");
    assert.equal(controllerRef.current?.readFormatState().textAlignment, "center", "the selected image starts with its stored center alignment");
    await act(async () => { assert.equal(controllerRef.current?.applyTextAlignment("left"), true); });
    assert.equal(controllerRef.current?.readFormatState().textAlignment, "left", "the selected image node attributes must receive the toolbar alignment");
    await waitFor(() => postStarted, "selected image alignment must use the normal durable document save");
    const postedImage = postedDocument?.document.content?.find((node) => node.type === "mangoAttachmentImage");
    assert.equal(postedImage?.attrs?.attachmentId, "image-1");
    assert.equal(Object.prototype.hasOwnProperty.call(postedImage?.attrs ?? {}, "alignment"), false, "the default left alignment should not be sent");
    assert.equal(Object.prototype.hasOwnProperty.call(postedImage?.attrs ?? {}, "position"), false, "the default break position should not be sent");
    assert.equal(Object.prototype.hasOwnProperty.call(postedImage?.attrs ?? {}, "layout"), false, "the default content layout should not be sent");
    assert.doesNotMatch(JSON.stringify(postedDocument), /"indentLevel":0|"textAlign":null/);
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the selected image alignment save must receive its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;
    activeImageFrame = activeProseMirror.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]');
    assert.ok(activeImageFrame);
    await waitFor(() => activeImageFrame.dataset.selected === "true", "the persisted image alignment must preserve its node selection");
    assert.equal(activeImageFrame.closest(".node-mangoAttachmentImage")?.getAttribute("draggable"), "true", "the selected inline image remains movable through Tiptap drag and drop");
    assert.equal(activeImageFrame.style.cursor, "pointer", "inline images use the hand-selection cursor instead of the editor text caret");
    assert.ok(activeImageFrame.querySelector('[data-mango-inline-image-download="true"]'), "the selected image exposes an icon-only download control attached to its frame");
    assert.ok(activeImageFrame.querySelector('[data-mango-tiptap-image-comment="true"]'), "the selected image exposes the same comment icon action as selected text");
    assert.ok(activeImageFrame.querySelector('[data-mango-tiptap-image-create-node="true"]'), "the selected image retains its icon-only create-node action");
    assert.equal(activeImageFrame.querySelectorAll("[data-mango-tiptap-image-resize-handle]").length, 8, "the selected image can resize from every edge and corner");
    assert.equal(Array.from(activeImageFrame.querySelectorAll("button")).some((button) => ["Move", "Delete", "Download", "Preview", "Left", "Center", "Right", "Wide", "Resize"].includes(button.textContent?.trim() ?? "")), false, "the detached labeled image button strip is removed");
    assert.equal(editorRoot.querySelector('[aria-label="Highlighted text actions"]'), null, "image node selections must not open the text-selection toolbar");
    await act(async () => {
      activeImageFrame.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitFor(() => Boolean(dom.window.document.querySelector('[role="dialog"][aria-label="Preview image.png"]')), "double-clicking an inline image should open its full-screen preview in the shared modal layer");
    const imagePreview = dom.window.document.querySelector<HTMLElement>('[role="dialog"][aria-label="Preview image.png"]');
    assert.ok(imagePreview?.querySelector('button[aria-label="Download image"]'), "the full-screen image preview should expose a download button");
    assert.equal(imagePreview?.dataset.mangoImagePreviewBackdrop, "translucent");
    assert.equal(imagePreview?.querySelector('[data-mango-image-preview-close="true"]')?.textContent?.trim(), "X", "the preview uses the shared bright-red X control");
    await waitFor(() => Boolean(imagePreview?.querySelector("img")), "the full-screen image preview should load the original attachment");
    assert.ok(imageFetchURLs.some((url) => url.includes("variant=original")), "the full-screen preview should request the original image variant");
    const closeImagePreview = imagePreview?.querySelector<HTMLButtonElement>('button[aria-label="Close image preview"]');
    assert.ok(closeImagePreview);
    await act(async () => { closeImagePreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => !dom.window.document.querySelector('[role="dialog"][aria-label="Preview image.png"]'), "the inline image preview should close normally");
    const richClipboardHTML = '<p><strong>Google Docs text before</strong></p><p><img src="https://lh7-rt.googleusercontent.com/docsz/temporary-tree?key=secret" alt="Copied tree" width="546" height="427"></p><p>Google Docs text after</p>';
    const richClipboardData = {
      files: [],
      getData: (type: string) => type === "text/html" ? richClipboardHTML : type === "text/plain" ? "Google Docs text before Google Docs text after" : "",
    } as unknown as DataTransfer;
    const richPasteEvent = new dom.window.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(richPasteEvent, "clipboardData", { configurable: true, value: richClipboardData });
    holdRemoteImageImport = true;
    await act(async () => {
      activeProseMirror.dispatchEvent(richPasteEvent);
    });
    assert.equal(richPasteEvent.defaultPrevented, true, "mixed Google Docs clipboard HTML must be owned by the durable image importer");
    await waitFor(() => remoteImageImports.length === 1, "the Google Docs image must use the remote durable attachment importer");
    const pasteLoading = activeProseMirror.querySelector<HTMLElement>('[data-mango-tiptap-paste-loading="true"]');
    assert.match(pasteLoading?.textContent ?? "", /Loading image/);
    assert.deepEqual(remoteImageImports[0], {
      path: "/v1/attachments/imports/remote-image",
      body: {
        company_id: "company-1",
        resource_type: "node",
        resource_id: "node-1",
        source_url: "https://lh7-rt.googleusercontent.com/docsz/temporary-tree?key=secret",
        original_filename: "temporary-tree",
        information_id: "document-1",
        editor_surface: "node",
      },
    });
    await act(async () => {
      assert.equal(controllerRef.current?.applyTextAlignment("right"), true, "editing while the remote image imports must remain available");
    });
    releaseRemoteImageImport?.();
    releaseRemoteImageImport = undefined;
    holdRemoteImageImport = false;
    await waitFor(
      () => Boolean(activeProseMirror.querySelector('[data-mango-attachment-id="google-docs-paste-image"]'))
        && (activeProseMirror.textContent ?? "").includes("Google Docs text before")
        && (activeProseMirror.textContent ?? "").includes("Google Docs text after"),
      "the active editor must keep both pasted text and the imported Google Docs image",
    );
    assert.equal(activeProseMirror.querySelector('[data-mango-tiptap-paste-loading="true"]'), null);
    const pastedImageFrame = activeProseMirror.querySelector<HTMLElement>('[data-mango-attachment-id="google-docs-paste-image"]');
    assert.ok(pastedImageFrame);
    assert.equal(pastedImageFrame.style.justifyContent, "flex-start", "a pasted image follows the default left toolbar alignment");

    await waitFor(() => postStarted, "the complete mixed rich paste must reach the normal durable document save");
    assert.match(JSON.stringify(postedDocument), /Google Docs text before/);
    assert.match(JSON.stringify(postedDocument), /google-docs-paste-image/);
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the pasted text and image save must receive its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;
    resetEditorRuntimeMetricsForTests();
    const alphaWalker = dom.window.document.createTreeWalker(activeProseMirror, dom.window.NodeFilter.SHOW_TEXT);
    let alphaText: Text | null = null;
    while (alphaWalker.nextNode()) {
      const candidate = alphaWalker.currentNode as Text;
      if (candidate.data === "Alpha") {
        alphaText = candidate;
        break;
      }
    }
    assert.ok(alphaText, "the active document should contain the paragraph used for the typing regression test");
    const typedText = " typed through the editor";
    await act(async () => {
      activeProseMirror.focus();
      const range = dom.window.document.createRange();
      range.setStart(alphaText!, alphaText!.data.length);
      range.collapse(true);
      const selection = dom.window.document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      const beforeInput = new dom.window.InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: typedText,
      });
      Simulate.beforeInput(activeProseMirror, {
        data: typedText,
        inputType: "insertText",
        nativeEvent: beforeInput,
      } as never);
      if (!beforeInput.defaultPrevented) {
        const inserted = dom.window.document.createTextNode(typedText);
        range.insertNode(inserted);
        range.setStartAfter(inserted);
        range.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      const input = new dom.window.InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: typedText,
      });
      Simulate.input(activeProseMirror, {
        data: typedText,
        inputType: "insertText",
        nativeEvent: input,
      } as never);
    });
    await waitFor(() => getEditorRuntimeMetrics().transactions >= 1, "normal typing should create an immediate ProseMirror transaction");
    assert.equal(getEditorRuntimeMetrics().full_document_serializations, 0, "typing must not serialize before the quiet-period batch");
    assert.equal(getEditorRuntimeMetrics().indexeddb_writes, 0, "typing must not persist recovery state before the quiet-period batch");
    assert.equal(editorRoot.dataset.mangoEditorPinned, "true", "dirty work pins the mounted editor immediately");

    await waitFor(() => postStarted, "normal typing alone must start one backend save after the quiet period");
    assert.match(JSON.stringify(postedDocument), /Alpha typed through the editor/, "the backend save must contain text entered through the normal editable surface");
    assert.equal(getEditorRuntimeMetrics().full_document_serializations, 1);
    assert.equal(getEditorRuntimeMetrics().indexeddb_writes, 1);
    const pendingKey = mangoTiptapPendingStorageKey({
      companyID: "company-1", resourceType: "node", resourceID: "node-1", documentID: "document-1",
    });
    const pendingRecord = await readExactMangoTiptapPending(pendingKey);
    assert.ok(pendingRecord);
    const alphaAnnotation = canonicalAnnotations.find((annotation) => annotation.id === "annotation-1");
    assert.ok(alphaAnnotation);
    const expectedMappedAnnotations = canonicalAnnotations.map((annotation) => annotation.from >= alphaAnnotation.to
      ? { ...annotation, from: annotation.from + typedText.length, to: annotation.to + typedText.length }
      : annotation);
    assert.deepEqual(pendingRecord.annotations, expectedMappedAnnotations, "typed text and shifted annotation positions share the exact recovery batch");

    exactObserver.trigger(false);
    await act(async () => { setHostVisible(false); });
    assert.ok(container.contains(editorRoot), "offscreen dirty editor remains mounted only to finish its save");
    assert.equal(editorRoot.dataset.mangoEditorPinned, "true");
    releasePost?.();
    await waitFor(() => Boolean(container.querySelector('[data-virtual-row-placeholder="document-1"]')), "backend acknowledgement should release the virtual-row pin and permit unmount");
    await waitFor(() => unsubscriptions >= subscriptions, "unmounted JSON editor should release every exact realtime scope");
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
    const reentryExactObserver = observers.filter((observer) => observer.rootMargin === "0px" && observer.isObserving(remountedEditorRoot)).at(-1);
    assert.ok(reentryExactObserver);
    const subscriptionsBeforeReentry = subscriptions;
    const readsBeforeVisibleReentry = canonicalReads;
    reentryExactObserver.trigger(true);
    await waitFor(
      () => subscriptions > subscriptionsBeforeReentry && canonicalReads > readsBeforeVisibleReentry,
      "visible re-entry should create one new exact scope and refresh after subscribing",
    );

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
      if (path.endsWith("/collaboration-ticket")) {
        const prefix = path.slice(0, -"/collaboration-ticket".length);
        const documentID = decodeURIComponent(prefix.split("/documents/")[1] ?? "");
        const resourceParts = prefix.slice("/v1/editor-json/".length).split("/");
        return {
          token: "page-host-collaboration-token",
          document_name: `editor-owner:${resourceParts[0]}:company-hosts:${resourceParts[1]}:${Buffer.from(documentID).toString("base64url")}:00000000-0000-4000-8000-000000000001`,
          collaboration_epoch: "00000000-0000-4000-8000-000000000001",
        } as T;
      }
      if (init?.method === "POST") {
        const body = init.json as { operation_id: string; document: MangoTiptapDocument; annotations?: typeof canonicalAnnotations };
        return { operation_id: body.operation_id, revision: 1, committed_at: "2026-07-29T18:00:00Z" } as T;
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
    assert.equal(pageHostContainer.querySelector('[aria-label="Project text box"]')?.closest('[data-mango-editor-format="tiptap_json"]')?.getAttribute("data-mango-editor-sync-mode"), "revisioned-json");
    assert.equal(pageHostContainer.querySelector('[aria-label="Logic Gate editor"]')?.closest('[data-mango-editor-format="tiptap_json"]')?.getAttribute("data-mango-editor-sync-mode"), "revisioned-json");
    await waitFor(
      () => pageHostPaths.some((path) => path.includes("/v1/editor-json/node/node-host/documents/node-document"))
        && pageHostPaths.some((path) => path.includes("/v1/editor-json/project/project-host/documents/project-document"))
        && pageHostPaths.some((path) => path.includes("/v1/editor-json/logic_gate/logic-gate-host/documents/logic-gate-document")),
      "each production host should load its canonical JSON snapshot",
    );
    assert.equal(pageHostPaths.some((path) => path.includes("/collaboration-ticket")), false, "offscreen Project and Logic Gate hosts should not request collaboration identity");
    for (const observer of observers.filter((observer) => observer.rootMargin === "0px").slice(-3)) observer.trigger(true);
    await flushAsyncWork();
    assert.equal(pageHostPaths.some((path) => path.includes("/collaboration-ticket")), false, "an absent collaboration URL keeps visible Project and Logic Gate editors on revisioned JSON sync");
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
    assert.equal(conflictCallbacks, 0, "a storage failure must not surface as a document conflict");
    assert.deepEqual(documentErrors, []);
    assert.ok(storageErrors.some((message) => message.startsWith("Browser recovery storage failed:")));
    Object.defineProperty(globalThis, "indexedDB", { configurable: true, writable: true, value: fakeIndexedDB });
    reentryExactObserver.trigger(false);
    reentryExactObserver.trigger(true);
    await act(async () => { await subscriptionRecover?.(); });
    await waitFor(() => storageRecoveries === 1, "a later successful recovery read should clear the storage warning");
    await waitFor(() => !remountedEditorRoot.querySelector('[role="alert"]'), "the recovered storage warning should disappear");
    assert.equal(conflictCallbacks, 0);

    const traceExport = stopEditorTraceForTests();
    const traceEventNames = new Set(traceExport.events.map((event) => event.name));
    for (const expected of [
      "prosemirror.dispatch_transaction",
      "plugin.block_identity.append_transaction",
      "plugin.paste_loading.apply",
      "plugin.annotations.apply",
      "tiptap.on_transaction",
      "tiptap.on_update",
      "editor.update_selection_state",
      "runtime_metrics.increment",
      "lifecycle.mark_dirty",
      "host.on_lifecycle_change",
      "sync.schedule",
      "sync.capture_scheduled_snapshot",
      "tiptap.get_json",
      "indexeddb.pending.put",
      "react.mango_tiptap_editor.commit",
    ]) {
      assert.ok(traceEventNames.has(expected), `missing mounted-editor trace event: ${expected}`);
    }
    assert.equal(traceExport.limits.dropped_events, 0);
    assert.equal(traceExport.open_spans.length, 0);
    assert.ok(traceExport.events.some((event) => (
      event.name === "prosemirror.dispatch_transaction"
      && event.phase === "end"
      && Number(event.duration_us) >= 0
    )));
    assert.ok(!JSON.stringify(traceExport).includes("Type while image imports"));
    await act(async () => root.unmount());
    mountedRoot = null;
    assert.equal(subscriptions, 2);
    assert.equal(unsubscriptions, 2, "unmount cleanup releases the active visible subscription");
  } finally {
    resetEditorTraceForTests();
    releaseRemoteImageImport?.();
    releasePost?.();
    if (pageHostRoot) await act(async () => pageHostRoot?.unmount());
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

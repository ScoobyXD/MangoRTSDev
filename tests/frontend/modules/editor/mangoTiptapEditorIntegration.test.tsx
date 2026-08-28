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

const EMAIL_THREAD_ID = "22222222-2222-4222-8222-222222222222";
const REFERENCED_EMAIL_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const ABSENT_EMAIL_MESSAGE_ID = "77777777-7777-4777-8777-777777777777";
const MISSING_EMAIL_THREAD_ID = "99999999-9999-4999-8999-999999999999";
const MISSING_EMAIL_MESSAGE_ID = "88888888-8888-4888-8888-888888888888";

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
  for (let index = 0; index < 300; index += 1) {
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
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "entity-1", label: "Saved delivery label" } },
        { type: "mangoEntityLink", attrs: {
          entityType: "email_message",
          entityId: REFERENCED_EMAIL_MESSAGE_ID,
          label: "Persisted reference label",
          emailMessageId: REFERENCED_EMAIL_MESSAGE_ID,
          emailThreadId: EMAIL_THREAD_ID,
          emailAccountEmail: "owner@example.test",
        } },
        { type: "mangoEntityLink", attrs: {
          entityType: "email_message",
          entityId: MISSING_EMAIL_MESSAGE_ID,
          label: "Missing durable email",
          emailMessageId: MISSING_EMAIL_MESSAGE_ID,
          emailThreadId: MISSING_EMAIL_THREAD_ID,
          emailAccountEmail: "owner@example.test",
        } },
        { type: "mangoEntityLink", attrs: {
          entityType: "email_message",
          entityId: ABSENT_EMAIL_MESSAGE_ID,
          label: "Absent durable message",
          emailMessageId: ABSENT_EMAIL_MESSAGE_ID,
          emailThreadId: EMAIL_THREAD_ID,
          emailAccountEmail: "owner@example.test",
        } },
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
      { type: "table", content: [
        { type: "tableRow", content: [{ type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: [420] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Heading" }] }] }] },
        { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: [420] }, content: [{ type: "paragraph", content: [{ type: "text", text: "Cell" }] }] }] },
      ] },
      { type: "mangoAttachmentImage", attrs: { attachmentId: "image-1", filename: "image.png", mimeType: "image/png", alignment: "right", position: "wrap", layout: "content" } },
      { type: "paragraph", attrs: { blockId: "wrapped-text" }, content: [{ type: "text", text: "Text wraps beside the image." }] },
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

test("static JSON rendering keeps Action Item color, non-color severity text, and accessible identity", () => {
  const value: MangoTiptapDocument = {
    format: "mango-tiptap-json",
    schema_version: 1,
    document: {
      type: "doc",
      content: [{
        type: "paragraph",
        content: [{
          type: "mangoEntityLink",
          attrs: {
            entityType: "entity",
            entityId: "action-item-red",
            label: "Call the delayed customer",
            actionItemColor: "red",
          },
        }],
      }],
    },
  };
  const html = renderToStaticMarkup(<MangoTiptapStaticRenderer value={value} />);
  assert.match(html, /data-mango-action-item-color="red"/);
  assert.match(html, /mango-editor-action-item--red/);
  assert.match(html, /aria-label="Open Red Action Item Call the delayed customer"/);
  assert.match(html, />Red<\/span>/);
});

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
  for (const annotation of annotations.filter((item) => item.kind !== "change")) {
    assert.match(html, new RegExp(`data-mango-annotation-id="${annotation.id}"`));
  }
  assert.doesNotMatch(html, /data-mango-annotation-id="annotation-image"/);
  assert.match(html, /class="mango-tiptap-document mango-tiptap-static-document"/);
  assert.match(html, /mango-tiptap-annotation--chat/);
  assert.match(html, /<ul>/);
  assert.match(html, /data-mango-legacy-leading-date-heading="true"/);
  assert.equal((html.match(/<ul>/g) ?? []).length, 4);
  assert.match(html, /Third-level item/);
  assert.match(html, /Fourth-level item/);
  assert.match(html, /<table/);
  assert.match(html, /<th[^>]+style="width:420px;max-width:420px"/, "the sleeping header must honor its saved column width");
  assert.match(html, /<td[^>]+style="width:420px;max-width:420px"/, "the sleeping cell must honor its saved column width");
  assert.match(html, /data-static-image="image-1"/);
  assert.match(html, /class="mango-tiptap-image-placement" data-mango-image-position="wrap" data-mango-image-alignment="right"/);
  assert.match(html, /Text wraps beside the image/);
  assert.match(html, /data-mango-entity-id="project-1"/);
  assert.match(html, /href="\/projects\/project-1"/);
  assert.match(html, /mango-editor-entity-icon/);
  assert.match(html, /M2.3 3.1h11.4v9.8H2.3z/);
  assert.match(html, /data-mango-entity-type="entity"/);
  assert.match(html, /data-mango-entity-id="entity-1"/);
  assert.match(html, /Saved delivery label/);
  assert.match(html, /data-mango-entity-id="entity-1"[^>]*role="link"[^>]*tabindex="0"/);
  assert.match(html, /M5.1 5.35h5.8M5.1 8h5.8M5.1 10.65h3.65/);
  assert.doesNotMatch(html, /data-mango-entity-id="entity-1"[^>]*href=/, "an Entity chip opens its exact detail preview instead of inventing an app route");

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
  assert.match(compactDefaultsHTML, /class="mango-tiptap-image-placement" data-mango-image-position="break" data-mango-image-alignment="left"/);
  assert.match(compactDefaultsHTML, /data-layout="content"/);

  const presentationCSS = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/tiptap/mangoTiptap.css"), "utf8");
  assert.match(presentationCSS, /font-size:\s*14px/);
  assert.match(presentationCSS, /line-height:\s*20px/);
  assert.match(presentationCSS, /padding:\s*12px 13px/);
  assert.match(presentationCSS, /min-height:\s*100%/);
  assert.match(presentationCSS, /display:\s*flow-root/, "the editor contains wrapped floats even at its narrowest mounted width");
  assert.match(presentationCSS, /data-mango-image-position="wrap"[^}]+position:\s*relative;[^}]+z-index:\s*1/s, "wrapped text boxes must not cover the visible image's pointer target");
  assert.match(presentationCSS, /data-mango-image-position="wrap"[^}]+max-width:\s*min\(50%, 840px\)/s);
  assert.match(presentationCSS, /data-mango-image-alignment="left"[^}]+float:\s*left/s);
  assert.match(presentationCSS, /data-mango-image-alignment="right"[^}]+float:\s*right/s);
  assert.match(presentationCSS, /data-mango-image-position="break"[^}]+clear:\s*both/s);
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
  assert.match(presentationCSS, /Automatic numbering repeats 1\., a\., 1\), a\)/);
  assert.match(presentationCSS, /Repeat the four requested bullet shapes after the fourth nesting level/);
  assert.match(presentationCSS, /\[data-mango-outline-style="indent-guides"\][\s\S]+li > (?:ul|ol)[\s\S]+border-left:\s*1px solid rgba\(100, 116, 139, 0\.3\)/);
  assert.doesNotMatch(presentationCSS, /^\.mango-tiptap-(?:static-document|prosemirror) li > (?:ul|ol),[^{]*\{[^}]*border-left:/m);
  assert.match(presentationCSS, /\.mango-tiptap-(?:static-document|prosemirror) \.tableWrapper[^}]+width:\s*max-content/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror table[^}]+border-collapse:\s*collapse/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror table[^}]+width:\s*auto/s);
  assert.doesNotMatch(presentationCSS, /\.mango-tiptap-(?:static-document|prosemirror) table[^}]+width:\s*100%/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror td[^}]+border:\s*1px solid #94a3b8/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror td[^}]+width:\s*112px/s);
  assert.match(presentationCSS, /\.mango-tiptap-prosemirror td[^}]+height:\s*36px/s);
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
  const systemClipboardItems: TestClipboardItem[] = [];
  class TestClipboardItem {
    static supports(type: string) { return ["image/png", "text/html", "text/plain"].includes(type); }
    constructor(readonly data: Record<string, Blob | Promise<Blob>>) {}
  }
  class TestFileReader {
    result: string | ArrayBuffer | null = null;
    error: DOMException | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL() {
      this.result = "data:image/png;base64,aW1hZ2UtYnl0ZXM=";
      queueMicrotask(() => this.onload?.());
    }
  }
  installGlobal("ClipboardItem", TestClipboardItem, restores);
  installGlobal("FileReader", TestFileReader, restores);
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(dom.window.navigator, "clipboard");
  Object.defineProperty(dom.window.navigator, "clipboard", {
    configurable: true,
    value: { write: async (items: TestClipboardItem[]) => { systemClipboardItems.push(...items); } },
  });
  restores.push(() => {
    if (clipboardDescriptor) Object.defineProperty(dom.window.navigator, "clipboard", clipboardDescriptor);
    else delete (dom.window.navigator as Navigator & { clipboard?: Clipboard }).clipboard;
  });
  const imageFetchURLs: string[] = [];
  const storedThreadRequests: string[] = [];
  const NativeResponse = globalThis.Response;
  installGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = String(input);
    imageFetchURLs.push(url);
    if (url.includes("/v1/communications/threads/")) {
      storedThreadRequests.push(url);
      if (url.includes(MISSING_EMAIL_THREAD_ID)) {
        return new NativeResponse(JSON.stringify({ error: "stored_email_thread_not_found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new NativeResponse(JSON.stringify({
        thread: {
          email_thread_id: EMAIL_THREAD_ID,
          thread_id: "provider-thread-is-not-reference-authority",
          history_complete: true,
          download_status: "complete",
          messages: [
            {
              id: "provider-message-3",
              email_message_id: "44444444-4444-4444-8444-444444444444",
              email_thread_id: EMAIL_THREAD_ID,
              message_order: 2,
              thread_id: "provider-thread-is-not-reference-authority",
              subject: "Last stored row",
              body: "Last stored body",
              date: 100,
              unread: false,
              starred: false,
            },
            {
              id: "provider-message-1",
              email_message_id: "11111111-1111-4111-8111-111111111111",
              email_thread_id: EMAIL_THREAD_ID,
              message_order: 0,
              thread_id: "provider-thread-is-not-reference-authority",
              subject: "First stored row",
              body: "First stored body",
              date: 300,
              unread: false,
              starred: false,
            },
            {
              id: "provider-message-2",
              email_message_id: REFERENCED_EMAIL_MESSAGE_ID,
              email_thread_id: EMAIL_THREAD_ID,
              message_order: 1,
              thread_id: "provider-thread-is-not-reference-authority",
              subject: "Durable selected row",
              body: "Referenced stored body without reconstructed quoted history",
              date: 200,
              unread: false,
              starred: false,
            },
          ],
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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
  let holdAnimationFrames = false;
  let heldFrameSequence = 0;
  const heldAnimationFrames = new Map<number, FrameRequestCallback>();
  const requestFrame = (callback: FrameRequestCallback) => {
    if (!holdAnimationFrames) return setTimeout(() => callback(Date.now()), 0) as unknown as number;
    const handle = -(heldFrameSequence += 1);
    heldAnimationFrames.set(handle, callback);
    return handle;
  };
  const cancelFrame = (handle: number) => {
    if (handle < 0) heldAnimationFrames.delete(handle);
    else clearTimeout(handle);
  };
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);
  if (!dom.window.HTMLElement.prototype.scrollIntoView) dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  const legacyInputPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
  if (!legacyInputPrototype.attachEvent) legacyInputPrototype.attachEvent = () => undefined;
  if (!legacyInputPrototype.detachEvent) legacyInputPrototype.detachEvent = () => undefined;

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
  const ownerAnnotations = annotations.filter((annotation) => annotation.kind !== "change");
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
  const linkedPickerEntities: string[] = [];
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
  let leadingContentClicks = 0;
  let setHostVisible: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;
  let forceHostRerender: () => void = () => undefined;
  resetEditorRuntimeMetricsForTests();
  startEditorTraceForTests();
  try {
    const [{ createRoot }, { MangoTiptapEditor }, { NodeTextBlockEditor }, { LogicGateTiptapEditorSurface }, { EmailReferencePreviewHost }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/tiptap/MangoTiptapEditor.tsx"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
      import("../../../../frontend/src/modules/editor/LogicGateTiptapEditorSurface.tsx"),
      import("../../../../frontend/src/pages/home/EmailReferencePreviewHost.tsx"),
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
      return <>
        <MangoTiptapEditor
          value={JSON.stringify(value)}
          editable
          ariaLabel="JSON document"
          companyID="company-1"
          resourceType="node"
          resourceID="node-1"
          documentID="document-1"
          requestJSON={requestJSON}
          leadingContent={<button type="button" data-test-leading-content="true" onClick={() => { leadingContentClicks += 1; }}>Process metadata</button>}
          attachmentContext={{
            requestJSON,
            apiBase: "http://localhost",
            companyID: "company-1",
            resourceType: "node",
            resourceID: "node-1",
            informationID: "document-1",
            editorSurface: "node",
          }}
          onEntityLink={async (entity) => { linkedPickerEntities.push(`${entity.entityType}:${entity.entityID}`); }}
          onImageChatRequest={() => undefined}
          onImageNodeRequest={() => undefined}
          subscribeToCanonicalChange={(recover) => {
            subscriptionRecover = recover;
            subscriptions += 1;
            return () => { unsubscriptions += 1; };
          }}
          annotations={ownerAnnotations.map((annotation) => ({ ...annotation }))}
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
        <EmailReferencePreviewHost
          apiBase="http://localhost"
          companyID="company-1"
          currentUserID="user-1"
        />
      </>;
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
    const leadingContentButton = editorRoot.querySelector<HTMLButtonElement>('[data-test-leading-content="true"]');
    assert.ok(leadingContentButton);
    const leadingPointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      leadingContentButton.dispatchEvent(leadingPointerDown);
      leadingContentButton.focus();
      leadingContentButton.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, button: 0 }));
      leadingContentButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await flushAsyncWork(2);
    assert.equal(leadingPointerDown.defaultPrevented, false, "interactive leading content must keep its native pointer action");
    assert.equal(leadingContentClicks, 1, "interactive leading content must receive its click");
    assert.equal(controllerRef.current, null, "leading-content pointer, focus, and double-click actions must not activate the sleeping text editor");
    assert.equal(editorRoot.dataset.mangoEditorState, "sleeping");
    for (const annotation of ownerAnnotations) {
      assert.ok(editorRoot.querySelector(`[data-mango-annotation-id="${annotation.id}"]`), `sleeping renderer should paint ${annotation.id}`);
    }
    assert.equal(editorRoot.querySelector('[data-mango-annotation-id="annotation-image"]'), null, "dormant changes must not paint on sleeping surfaces");
    const sleepingImagePlacement = editorRoot.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]')?.closest<HTMLElement>(".mango-tiptap-image-placement");
    assert.equal(sleepingImagePlacement?.dataset.mangoImagePosition, "wrap");
    assert.equal(sleepingImagePlacement?.dataset.mangoImageAlignment, "right");

    const referenceRequestStart = imageFetchURLs.length;
    const referencedEmailLink = editorRoot.querySelector<HTMLElement>(`[data-mango-email-message-id="${REFERENCED_EMAIL_MESSAGE_ID}"]`);
    assert.ok(referencedEmailLink);
    const referencePointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { referencedEmailLink.dispatchEvent(referencePointerDown); });
    await flushAsyncWork(2);
    assert.equal(referencePointerDown.defaultPrevented, false, "a sleeping entity chip must retain the ordinary click that follows pointerdown");
    assert.equal(controllerRef.current, null, "clicking a sleeping entity chip must not replace it with the live editor before click");
    assert.equal(editorRoot.dataset.mangoEditorState, "sleeping");
    await act(async () => {
      referencedEmailLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitFor(
      () => Boolean(dom.window.document.querySelector('[data-email-reference-preview="true"][aria-label="Email thread: Durable selected row"]')),
      "one ordinary sleeping-chip click should open the established email preview",
    );
    assert.equal(storedThreadRequests.length, 1, "the reference must make one canonical stored-thread read");
    const storedThreadURL = new URL(storedThreadRequests[0]);
    assert.equal(storedThreadURL.pathname, `/v1/communications/threads/${EMAIL_THREAD_ID}`);
    assert.equal(storedThreadURL.searchParams.get("company_id"), "company-1");
    assert.equal(storedThreadURL.searchParams.get("account_email"), "owner@example.test");
    const storedRows = Array.from(dom.window.document.querySelectorAll<HTMLElement>('article[data-email-timeline-item="true"]'));
    assert.deepEqual(storedRows.map((row) => row.dataset.emailMessageId), [
      "provider-message-1",
      "provider-message-2",
      "provider-message-3",
    ], "the existing viewer must render each stored row once in persisted message_order");
    assert.equal(new Set(storedRows.map((row) => row.dataset.emailMessageId)).size, 3);
    const closeStoredPreview = dom.window.document.querySelector<HTMLButtonElement>('[data-email-reference-preview-close="true"]');
    assert.ok(closeStoredPreview);
    await act(async () => { closeStoredPreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => !dom.window.document.querySelector('[data-email-reference-preview="true"]'), "the established preview should close");

    const missingEmailLink = editorRoot.querySelector<HTMLElement>(`[data-mango-email-message-id="${MISSING_EMAIL_MESSAGE_ID}"]`);
    assert.ok(missingEmailLink);
    const missingPointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { missingEmailLink.dispatchEvent(missingPointerDown); });
    assert.equal(missingPointerDown.defaultPrevented, false);
    await act(async () => {
      missingEmailLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitFor(
      () => dom.window.document.querySelector('[data-email-reference-preview="true"]')?.textContent?.includes("Email thread unavailable") === true,
      "a genuinely missing durable thread should use the established unavailable state",
    );
    assert.equal(storedThreadRequests.length, 2, "a missing durable row must not start a fallback read");
    assert.deepEqual(
      imageFetchURLs.filter((url) => url.includes("/v1/communications/")),
      storedThreadRequests,
      "inline reference lookup must not call a Node relationship, collaboration, provider, or mailbox-page endpoint",
    );
    const closeMissingPreview = dom.window.document.querySelector<HTMLButtonElement>('[data-email-reference-preview-close="true"]');
    assert.ok(closeMissingPreview);
    await act(async () => { closeMissingPreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => !dom.window.document.querySelector('[data-email-reference-preview="true"]'), "the unavailable preview should close");

    const absentMessageLink = editorRoot.querySelector<HTMLElement>(`[data-mango-email-message-id="${ABSENT_EMAIL_MESSAGE_ID}"]`);
    assert.ok(absentMessageLink);
    await act(async () => {
      absentMessageLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    });
    await waitFor(
      () => dom.window.document.querySelector('[data-email-reference-preview="true"]')?.textContent?.includes("Email thread unavailable") === true,
      "an existing durable thread without the referenced durable message should use the established unavailable state",
    );
    assert.equal(storedThreadRequests.length, 3, "an absent durable message must not start a fallback read");
    const closeAbsentMessagePreview = dom.window.document.querySelector<HTMLButtonElement>('[data-email-reference-preview-close="true"]');
    assert.ok(closeAbsentMessagePreview);
    await act(async () => { closeAbsentMessagePreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => !dom.window.document.querySelector('[data-email-reference-preview="true"]'), "the absent-message preview should close");
    const referenceResourceRequests = imageFetchURLs.slice(referenceRequestStart).filter((url) => (
      /\/v[12]\/(?:communications|nodes|projects|logic-gates|huddles|email-relationships)(?:\/|\?)/.test(url)
    ));
    assert.deepEqual(
      referenceResourceRequests,
      storedThreadRequests,
      "inline reference lookup must not call a Node relationship, collaboration, provider, mailbox-page, or other resource endpoint",
    );

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
    const sleepingImage = editorRoot.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]');
    assert.ok(sleepingImage);
    const activationEvent = new dom.window.MouseEvent("pointerover", { bubbles: true, cancelable: true, clientX: 8, clientY: 8 });
    const preventScrollBeforeImageHover = preventScrollEditorFocuses;
    holdAnimationFrames = true;
    await act(async () => {
      sleepingImage.dispatchEvent(activationEvent);
    });
    assert.ok(editorRoot.querySelector('[data-mango-tiptap-activation-cover="true"]'), "entering a sleeping image must start its live editor while the static document stays painted");
    assert.equal(editorRoot.querySelector<HTMLElement>('[data-mango-tiptap-live-surface="true"]')?.style.opacity, "0", "the unattached live surface must not replace the painted document");
    assert.equal(activationEvent.defaultPrevented, false, "image hover activation must not consume the pointer gesture");
    await waitFor(() => controllerRef.current !== null, "entering a sleeping image should prepare its native ProseMirror drag source");
    holdAnimationFrames = false;
    const activationFrames = [...heldAnimationFrames.values()];
    heldAnimationFrames.clear();
    await act(async () => {
      activationFrames.forEach((callback) => callback(Date.now()));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    await flushAsyncWork(2);
    assert.equal(editorRoot.scrollTop, 287, "hover-activating a scrolled image must keep its exact text-box scroll position");
    assert.equal(preventScrollEditorFocuses, preventScrollBeforeImageHover, "hover-activating an image must not steal focus");
    const activeProseMirror = editorRoot.querySelector<HTMLElement>(".mango-tiptap-prosemirror");
    assert.ok(activeProseMirror);
    assert.equal(editorRoot.dataset.mangoTiptapLiveReady, "true", "the live editor is exposed only after its DOM and caret are ready");
    assert.equal(editorRoot.querySelector('[data-mango-tiptap-activation-cover="true"]'), null, "the static cover leaves only after the live editor is ready");
    assert.equal(activeProseMirror.children.length, value.document.content?.length, "first-click activation must not add an editor row");
    assert.equal(Array.from(activeProseMirror.querySelectorAll("p")).filter((paragraph) => paragraph.textContent === "").length, 1, "first-click activation preserves the one intentional empty paragraph without creating another");
    assert.equal(activeProseMirror.querySelector('[data-mango-annotation-id="annotation-image"]'), null, "dormant changes must not decorate active surfaces");
    assert.equal(activeProseMirror.parentElement?.classList.contains("mango-tiptap-active-surface"), true, "the active EditorContent wrapper must fill the full text box");
    assert.equal(activeProseMirror.getAttribute("contenteditable"), "true", "the clicked JSON document should become a real editable surface");
    assert.notEqual(dom.window.document.activeElement, activeProseMirror, "preparing an image drag source must not move the user's caret");
    assert.equal(activeProseMirror.dataset.mangoLegacyLeadingDateHeading, "true");
    const activeInitialImagePlacement = activeProseMirror.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]')?.closest<HTMLElement>(".mango-tiptap-image-placement");
    assert.equal(activeInitialImagePlacement?.dataset.mangoImagePosition, sleepingImagePlacement?.dataset.mangoImagePosition, "active and sleeping renderers use the same image placement");
    assert.equal(activeInitialImagePlacement?.dataset.mangoImageAlignment, sleepingImagePlacement?.dataset.mangoImageAlignment, "active and sleeping renderers use the same image side");

    editorRoot.scrollTop = 321;
    holdAnimationFrames = true;
    const activeCaretEvent = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 20, clientY: 20 });
    await act(async () => {
      activeProseMirror.focus({ preventScroll: true });
      activeProseMirror.dispatchEvent(activeCaretEvent);
    });
    assert.equal(activeCaretEvent.defaultPrevented, false, "an active-editor click keeps native caret placement");
    editorRoot.scrollTop = 17;
    holdAnimationFrames = false;
    const caretFrames = [...heldAnimationFrames.values()];
    heldAnimationFrames.clear();
    assert.ok(caretFrames.length > 0, "the caret click schedules scroll restoration before paint");
    await act(async () => {
      caretFrames.forEach((callback) => callback(Date.now()));
    });
    assert.equal(editorRoot.scrollTop, 321, "placing a caret in an active editor must not move the text-box scroll position");

    restartEditorTraceForTests();
    await act(async () => { await subscriptionRecover?.(); });
    await flushAsyncWork(3);
    const identicalCanonicalTrace = stopEditorTraceForTests();
    assert.equal(
      identicalCanonicalTrace.events.filter((event) => event.name === "prosemirror.dispatch_transaction").length,
      0,
      "an identical canonical refresh must not replace the live ProseMirror document",
    );
    assert.equal(activeProseMirror.children.length, value.document.content?.length, "an identical refresh must not add an empty row");
    assert.equal(dom.window.document.activeElement, activeProseMirror, "an identical refresh preserves the caret owner");
    assert.equal(postStarted, false, "activation and an identical canonical refresh are read-only");

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
    const activeImageDragHandle = activeImageFrame.querySelector<HTMLElement>('[data-mango-tiptap-image-frame="true"]');
    assert.ok(activeImageDragHandle);
    assert.notEqual(activeImageFrame.dataset.selected, "true", "the drag regression must start from an unselected image");
    const imagePointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      activeImageDragHandle.dispatchEvent(imagePointerDown);
    });
    await waitFor(() => activeImageFrame.dataset.selected === "true", "starting a drag on an unselected image must create its Tiptap node selection before dragstart");
    assert.equal(imagePointerDown.defaultPrevented, false, "selecting the image must leave native Tiptap dragging enabled");
    assert.equal(controllerRef.current?.readFormatState().textAlignment, "right", "the selected wrapped image starts on its stored side");
    await act(async () => { assert.equal(controllerRef.current?.applyTextAlignment("left"), true); });
    assert.equal(controllerRef.current?.readFormatState().textAlignment, "left", "the selected image node attributes must receive the toolbar alignment");
    await waitFor(() => postStarted, "selected image alignment must use the normal durable document save");
    const postedImage = postedDocument?.document.content?.find((node) => node.type === "mangoAttachmentImage");
    assert.equal(postedImage?.attrs?.attachmentId, "image-1");
    assert.equal(Object.prototype.hasOwnProperty.call(postedImage?.attrs ?? {}, "alignment"), false, "the default left alignment should not be sent");
    assert.equal(postedImage?.attrs?.position, "wrap", "the additive wrapped placement should be sent without changing the JSON envelope version");
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
    const activeMovedImagePlacement = activeImageFrame.closest<HTMLElement>(".mango-tiptap-image-placement");
    assert.equal(activeMovedImagePlacement?.dataset.mangoImagePosition, "wrap");
    assert.equal(activeMovedImagePlacement?.dataset.mangoImageAlignment, "left");
    const currentImageNode = activeImageFrame.closest<HTMLElement>(".node-mangoAttachmentImage");
    assert.ok(currentImageNode);
    const imageIndexBeforeDrag = Array.from(activeProseMirror.children).indexOf(currentImageNode);
    assert.ok(imageIndexBeforeDrag > 1, "the drag regression must start from a different document row than its destination");
    assert.equal(currentImageNode.getAttribute("draggable"), "true", "ProseMirror's image node must own the native drag source");
    assert.equal(activeImageFrame.querySelector('[data-mango-tiptap-image-frame="true"]')?.getAttribute("draggable"), null, "the visible Tiptap drag handle must not create a second nested drag source");
    const currentImageDragHandle = activeImageFrame.querySelector<HTMLElement>('[data-mango-tiptap-image-frame="true"]');
    assert.ok(currentImageDragHandle);
    const imageDragData = new Map<string, string>();
    const imageDragTransfer = {
      files: [],
      effectAllowed: "none",
      dropEffect: "move",
      clearData(type?: string) { if (type) imageDragData.delete(type); else imageDragData.clear(); },
      setData(type: string, data: string) { imageDragData.set(type, data); },
      getData(type: string) { return imageDragData.get(type) ?? ""; },
      setDragImage() { return undefined; },
    } as unknown as DataTransfer;
    const imageMouseDown = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 500 });
    const imageDragStart = new dom.window.MouseEvent("dragstart", { bubbles: true, cancelable: true, button: 0, clientX: 500, clientY: 500 });
    const imageDragEnter = new dom.window.MouseEvent("dragenter", { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 10 });
    const imageDragOver = new dom.window.MouseEvent("dragover", { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 10 });
    const imageDrop = new dom.window.MouseEvent("drop", { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 10 });
    for (const event of [imageDragStart, imageDragEnter, imageDragOver, imageDrop]) {
      Object.defineProperty(event, "dataTransfer", { configurable: true, value: imageDragTransfer });
    }
    const imageDropTarget = activeProseMirror.children[0] as HTMLElement;
    const originalEditorBounds = activeProseMirror.getBoundingClientRect;
    const originalEditorOffsetParent = Object.getOwnPropertyDescriptor(activeProseMirror, "offsetParent");
    const originalCaretPosition = Object.getOwnPropertyDescriptor(dom.window.document, "caretPositionFromPoint");
    Object.defineProperty(activeProseMirror, "getBoundingClientRect", { configurable: true, value: () => new dom.window.DOMRect(0, 0, 1_000, 1_000) });
    Object.defineProperty(activeProseMirror, "offsetParent", { configurable: true, value: activeProseMirror.parentElement });
    Object.defineProperty(dom.window.document, "caretPositionFromPoint", {
      configurable: true,
      value: () => ({ offsetNode: activeProseMirror, offset: 1 }),
    });
    try {
      await act(async () => {
        currentImageDragHandle.dispatchEvent(imageMouseDown);
        currentImageNode.dispatchEvent(imageDragStart);
        imageDropTarget.dispatchEvent(imageDragEnter);
        imageDropTarget.dispatchEvent(imageDragOver);
        imageDropTarget.dispatchEvent(imageDrop);
      });
    } finally {
      Object.defineProperty(activeProseMirror, "getBoundingClientRect", { configurable: true, value: originalEditorBounds });
      if (originalEditorOffsetParent) Object.defineProperty(activeProseMirror, "offsetParent", originalEditorOffsetParent);
      else delete (activeProseMirror as HTMLElement & { offsetParent?: Element | null }).offsetParent;
      if (originalCaretPosition) Object.defineProperty(dom.window.document, "caretPositionFromPoint", originalCaretPosition);
      else delete (dom.window.document as Document & { caretPositionFromPoint?: unknown }).caretPositionFromPoint;
    }
    assert.match(imageDragData.get("text/html") ?? "", /data-attachment-id="image-1"/, "native Tiptap dragstart must carry the selected image node");
    assert.equal(imageDragStart.defaultPrevented, false, "the native image drag must not be canceled at its source");
    assert.equal(imageDragOver.defaultPrevented, true, "the destination row must accept the native image drop");
    assert.equal(imageDrop.defaultPrevented, true, "the image drop must commit through the existing ProseMirror transaction");
    await waitFor(() => {
      const movedImageNode = activeProseMirror.querySelector('[data-mango-attachment-id="image-1"]')?.closest(".node-mangoAttachmentImage");
      const movedIndex = movedImageNode ? Array.from(activeProseMirror.children).indexOf(movedImageNode) : -1;
      return movedIndex >= 0 && movedIndex < imageIndexBeforeDrag;
    }, "dropping on an earlier document row must move the image to an earlier document anchor");
    activeImageFrame = activeProseMirror.querySelector<HTMLElement>('[data-mango-attachment-id="image-1"]');
    assert.ok(activeImageFrame);
    const imageIndexAfterDrag = Array.from(activeProseMirror.children).indexOf(activeImageFrame.closest<HTMLElement>(".node-mangoAttachmentImage")!);
    assert.equal(activeImageFrame.closest<HTMLElement>(".mango-tiptap-image-placement")?.dataset.mangoImageAlignment, "right", "dropping in the right zone must snap and wrap the moved image on the right");
    await waitFor(() => postStarted, "the native image drop must use the normal durable document save");
    const savedImageIndex = postedDocument?.document.content?.findIndex((node) => node.type === "mangoAttachmentImage");
    assert.equal(savedImageIndex, imageIndexAfterDrag, "the saved JSON must contain the moved image at its new anchor");
    assert.equal(postedDocument?.document.content?.[savedImageIndex!]?.attrs?.alignment, "right");
    assert.equal(postedDocument?.document.content?.[savedImageIndex!]?.attrs?.position, "wrap");
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the moved image save must receive its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;
    const copiedEventData = new Map<string, string>();
    const copyClipboardData = {
      setData: (type: string, copiedValue: string) => { copiedEventData.set(type, copiedValue); },
      getData: (type: string) => copiedEventData.get(type) ?? "",
    } as unknown as DataTransfer;
    const originalImageRequestsBeforeCopy = imageFetchURLs.filter((url) => url.includes("variant=original")).length;
    const imageCopyEvent = new dom.window.Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(imageCopyEvent, "clipboardData", { configurable: true, value: copyClipboardData });
    await act(async () => { activeProseMirror.dispatchEvent(imageCopyEvent); });
    assert.equal(imageCopyEvent.defaultPrevented, true, "copying a selected Tiptap image must replace the private ProseMirror node clipboard");
    assert.match(copiedEventData.get("text/html") ?? "", /data-mango-editor-image="true"/, "the synchronous clipboard keeps a Mango round-trip fallback");
    assert.equal(copiedEventData.get("text/plain"), "image.png");
    await waitFor(() => systemClipboardItems.length === 1, "selected image copy should publish a portable system clipboard item");
    const portableImagePayload = systemClipboardItems[0].data;
    assert.equal((await portableImagePayload["image/png"]).type, "image/png", "the system clipboard receives actual image bytes");
    assert.match(await (await portableImagePayload["text/html"]).text(), /<img src="data:image\/png;base64,aW1hZ2UtYnl0ZXM="/, "portable HTML embeds image bytes instead of a Mango attachment reference");
    assert.equal(await (await portableImagePayload["text/plain"]).text(), "image.png");
    assert.ok(imageFetchURLs.filter((url) => url.includes("variant=original")).length > originalImageRequestsBeforeCopy, "copy reloads the authorized original attachment bytes");
    assert.equal(activeImageFrame.style.cursor, "pointer", "inline images use the hand-selection cursor instead of the editor text caret");
    assert.ok(activeImageFrame.querySelector('[data-mango-inline-image-download="true"]'), "the selected image exposes an icon-only download control attached to its frame");
    assert.ok(activeImageFrame.querySelector('[data-mango-tiptap-image-comment="true"]'), "the selected image exposes the same comment icon action as selected text");
    assert.ok(activeImageFrame.querySelector('[data-mango-tiptap-image-create-node="true"]'), "the selected image retains its icon-only create-node action");
    assert.equal(activeImageFrame.querySelectorAll("[data-mango-tiptap-image-resize-handle]").length, 8, "the selected image can resize from every edge and corner");
    assert.equal(Array.from(activeImageFrame.querySelectorAll("button")).some((button) => ["Move", "Delete", "Download", "Preview", "Left", "Center", "Right", "Wide", "Resize"].includes(button.textContent?.trim() ?? "")), false, "the detached labeled image button strip is removed");
    assert.equal(editorRoot.querySelector('[aria-label="Highlighted text actions"]'), null, "image node selections must not open the text-selection toolbar");
    const activeTableCell = activeProseMirror.querySelector<HTMLElement>("td");
    assert.ok(activeTableCell);
    const tableContextEvent = new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: 40, clientY: 50 });
    await act(async () => { activeTableCell.dispatchEvent(tableContextEvent); });
    assert.equal(tableContextEvent.defaultPrevented, true, "right-clicking a table cell opens Mango's table menu");
    await waitFor(() => Boolean(dom.window.document.querySelector('[role="menu"][aria-label="Table actions"]')), "the table context menu should become visible");
    assert.equal(editorRoot.querySelector('[role="toolbar"][aria-label="Table controls"]'), null, "selecting a table must not show the duplicate top-right command strip");
    const tableMenu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Table actions"]');
    assert.ok(tableMenu);
    assert.equal(tableMenu.parentElement, dom.window.document.body, "the table menu is portaled above the editor scroll window");
    assert.equal(editorRoot.contains(tableMenu), false, "the table menu must not be clipped by the editor");
    assert.equal(tableMenu.style.position, "fixed");
    assert.equal(tableMenu.classList.contains("mango-liquid-context-menu"), true, "the table menu uses the shared right-click surface");
    assert.equal(tableMenu.querySelectorAll('[role="separator"]').length, 2, "table commands use the shared grouped-menu separators");
    const deleteTableItem = Array.from(tableMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.trim() === "Delete table");
    assert.ok(deleteTableItem?.style.color, "the bottom delete section uses destructive red text");
    const addColumnRight = Array.from(tableMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.trim() === "Create column on the right");
    assert.ok(addColumnRight);
    await act(async () => { addColumnRight.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length === 2, "the right-click command should add a table column");
    assert.equal(dom.window.document.querySelector('[role="menu"][aria-label="Table actions"]'), null, "a completed table command closes the context menu");
    await waitFor(() => postStarted, "the table command must use the normal durable document save");
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the table mutation save must receive its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;

    await waitFor(() => Boolean(editorRoot.querySelector('[data-mango-tiptap-table-resize-handle="true"]')), "a selected table exposes its bottom-right resize handle");
    let tableResizeHandle = editorRoot.querySelector<HTMLButtonElement>('[data-mango-tiptap-table-resize-handle="true"]');
    assert.equal(tableResizeHandle?.getAttribute("aria-label"), "Drag to resize table rows and columns");
    const rowsBeforeResize = activeProseMirror.querySelectorAll("table tr").length;
    const columnsBeforeResize = activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length;
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1, clientX: 225, clientY: 175 }));
    });
    await waitFor(() => Boolean(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]')), "dragging previews equal-sized table additions");
    let resizePreview = editorRoot.querySelector<HTMLElement>('[data-mango-tiptap-table-resize-preview="true"]');
    assert.equal(resizePreview?.dataset.previewRows, String(rowsBeforeResize + 2));
    assert.equal(resizePreview?.dataset.previewColumns, String(columnsBeforeResize + 1));
    assert.equal(resizePreview?.style.width, `${(columnsBeforeResize + 1) * 112}px`, "the preview uses the width that will be stored on release");
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: 225, clientY: 175 }));
    });
    await waitFor(() => activeProseMirror.querySelectorAll("table tr").length === rowsBeforeResize + 2, "releasing the handle creates the previewed rows");
    assert.equal(activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length, columnsBeforeResize + 1, "releasing the handle creates the previewed columns");
    assert.equal(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]'), null, "the preview clears after its one committed change");
    await waitFor(() => postStarted, "table expansion uses the normal durable document save");
    const expandedPostedTable = postedDocument?.document.content?.find((node) => node.type === "table");
    assert.ok(expandedPostedTable);
    for (const row of expandedPostedTable.content ?? []) {
      for (const cell of row.content ?? []) assert.deepEqual(cell.attrs?.colwidth, [112], "the committed table stores its previewed equal column width");
    }
    assert.equal(activeProseMirror.querySelector("table")?.style.width, resizePreview?.style.width, "the table outline does not jump horizontally after release");
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the table expansion save receives its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;

    tableResizeHandle = editorRoot.querySelector<HTMLButtonElement>('[data-mango-tiptap-table-resize-handle="true"]');
    assert.ok(tableResizeHandle);
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1, clientX: -12, clientY: 28 }));
    });
    await waitFor(() => Boolean(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]')), "dragging left and up previews removal of empty trailing cells");
    resizePreview = editorRoot.querySelector<HTMLElement>('[data-mango-tiptap-table-resize-preview="true"]');
    assert.equal(resizePreview?.dataset.previewRows, String(rowsBeforeResize));
    assert.equal(resizePreview?.dataset.previewColumns, String(columnsBeforeResize));
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: -12, clientY: 28 }));
    });
    await waitFor(() => activeProseMirror.querySelectorAll("table tr").length === rowsBeforeResize, "upward dragging removes only empty trailing rows");
    assert.equal(activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length, columnsBeforeResize, "left dragging removes only the previewed trailing column");
    await waitFor(() => postStarted, "table shrink uses the normal durable document save");
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the table shrink save receives its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;

    tableResizeHandle = editorRoot.querySelector<HTMLButtonElement>('[data-mango-tiptap-table-resize-handle="true"]');
    assert.ok(tableResizeHandle);
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1, clientX: -12, clientY: -1_000 }));
    });
    await waitFor(() => Boolean(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]')), "a content-blocked axis still previews a safe shrink on the other axis");
    resizePreview = editorRoot.querySelector<HTMLElement>('[data-mango-tiptap-table-resize-preview="true"]');
    assert.equal(resizePreview?.dataset.previewRows, String(rowsBeforeResize), "text blocks deletion of either occupied row");
    assert.equal(resizePreview?.dataset.previewColumns, "1", "the remaining empty trailing column may still be removed");
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: -12, clientY: -1_000 }));
    });
    await waitFor(() => activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length === 1, "the handle stops at the occupied column");
    assert.equal(activeProseMirror.querySelectorAll("table tr").length, rowsBeforeResize, "the handle does not delete rows containing text");
    assert.match(activeProseMirror.querySelector("table")?.textContent ?? "", /Heading[\s\S]*Cell/, "the protected table text remains intact");
    await waitFor(() => postStarted, "the independently safe table shrink is saved normally");
    releasePost?.();
    await waitFor(() => editorRoot.dataset.mangoEditorPinned !== "true", "the safe shrink save receives its backend acknowledgement");
    postStarted = false;
    postedDocument = null;
    releasePost = undefined;

    tableResizeHandle = editorRoot.querySelector<HTMLButtonElement>('[data-mango-tiptap-table-resize-handle="true"]');
    assert.ok(tableResizeHandle);
    const rowsBeforeCancelledResize = activeProseMirror.querySelectorAll("table tr").length;
    const columnsBeforeCancelledResize = activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length;
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1, clientX: 225, clientY: 175 }));
    });
    await waitFor(() => Boolean(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]')), "a cancellable table resize first paints its preview");
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointercancel", { bubbles: true, cancelable: true, button: 0, clientX: 225, clientY: 175 }));
    });
    await waitFor(() => !editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]'), "pointer cancel clears the table resize preview");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(activeProseMirror.querySelectorAll("table tr").length, rowsBeforeCancelledResize, "pointer cancel adds no rows");
    assert.equal(activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length, columnsBeforeCancelledResize, "pointer cancel adds no columns");
    assert.equal(postStarted, false, "pointer cancel starts no durable save");

    tableResizeHandle = editorRoot.querySelector<HTMLButtonElement>('[data-mango-tiptap-table-resize-handle="true"]');
    assert.ok(tableResizeHandle);
    await act(async () => {
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointermove", { bubbles: true, cancelable: true, buttons: 1, clientX: -1_000, clientY: -1_000 }));
      tableResizeHandle!.dispatchEvent(new dom.window.MouseEvent("pointerup", { bubbles: true, cancelable: true, button: 0, clientX: -1_000, clientY: -1_000 }));
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 650)); });
    assert.equal(editorRoot.querySelector('[data-mango-tiptap-table-resize-preview="true"]'), null, "a fully content-blocked shrink has no preview or mutation");
    assert.equal(activeProseMirror.querySelectorAll("table tr").length, rowsBeforeResize);
    assert.equal(activeProseMirror.querySelectorAll("table tr:first-child td, table tr:first-child th").length, 1);
    assert.equal(postStarted, false, "a fully blocked shrink starts no durable save");
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
    for (const annotation of canonicalAnnotations.filter((item) => item.kind !== "change")) {
      assert.ok(remountedEditorRoot.querySelector(`[data-mango-annotation-id="${annotation.id}"]`), `persisted ${annotation.kind} position should survive remount`);
    }
    assert.equal(remountedEditorRoot.querySelector('[data-mango-annotation-id="annotation-image"]'), null, "remounted dormant changes must remain non-rendering");
    const reentryExactObserver = observers.filter((observer) => observer.rootMargin === "0px" && observer.isObserving(remountedEditorRoot)).at(-1);
    assert.ok(reentryExactObserver);
    const subscriptionsBeforeReentry = subscriptions;
    const readsBeforeVisibleReentry = canonicalReads;
    reentryExactObserver.trigger(true);
    await waitFor(
      () => subscriptions > subscriptionsBeforeReentry && canonicalReads > readsBeforeVisibleReentry,
      "visible re-entry should create one new exact scope and refresh after subscribing",
    );

    remountedEditorRoot.scrollTop = 193;
    const preventScrollBeforeReentryClick = preventScrollEditorFocuses;
    const reentryPointerDown = new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 12, clientY: 12 });
    holdAnimationFrames = true;
    await act(async () => { remountedEditorRoot.dispatchEvent(reentryPointerDown); });
    assert.equal(reentryPointerDown.defaultPrevented, true, "ordinary sleeping-editor pointer activation must keep suppressing the replaced static target");
    assert.ok(remountedEditorRoot.querySelector('[data-mango-tiptap-activation-cover="true"]'), "ordinary pointer activation must keep the sleeping document painted while the live editor attaches");
    await waitFor(() => controllerRef.current !== null, "ordinary pointer activation must still attach the live editor");
    holdAnimationFrames = false;
    const reentryActivationFrames = [...heldAnimationFrames.values()];
    heldAnimationFrames.clear();
    await act(async () => { reentryActivationFrames.forEach((callback) => callback(Date.now())); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    await flushAsyncWork(2);
    const reentryProseMirror = remountedEditorRoot.querySelector<HTMLElement>(".mango-tiptap-prosemirror");
    assert.ok(reentryProseMirror);
    assert.equal(remountedEditorRoot.scrollTop, 193, "ordinary pointer activation must keep the exact text-box scroll position");
    assert.ok(preventScrollEditorFocuses > preventScrollBeforeReentryClick, "ordinary pointer activation must focus without asking the browser to scroll");
    assert.equal(dom.window.document.activeElement, reentryProseMirror, "ordinary pointer activation must still focus the attached editor");

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
    assert.ok(pageHostContainer.querySelector('[aria-label="Process editor"]'));
    assert.equal(pageHostContainer.querySelector('[aria-label="Project text box"]')?.closest('[data-mango-editor-format="tiptap_json"]')?.getAttribute("data-mango-editor-sync-mode"), "revisioned-json");
    assert.equal(pageHostContainer.querySelector('[aria-label="Process editor"]')?.closest('[data-mango-editor-format="tiptap_json"]')?.getAttribute("data-mango-editor-sync-mode"), "revisioned-json");
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
    const remountedProseMirror = remountedEditorRoot.querySelector<HTMLElement>(".mango-tiptap-prosemirror");
    assert.ok(remountedProseMirror);
    await act(async () => {
      remountedProseMirror.dispatchEvent(new dom.window.KeyboardEvent("keydown", {
        key: "#",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    await waitFor(() => Boolean(dom.window.document.querySelector('[data-mango-universal-picker="true"]')), "# should open the universal picker");
    const picker = dom.window.document.querySelector<HTMLElement>('[data-mango-universal-picker="true"]');
    const pickerInput = picker?.querySelector<HTMLInputElement>('input[aria-label="Search resources to reference"]');
    assert.ok(picker && pickerInput);
    assert.equal(picker.dataset.mangoUniversalPickerMode, "reference");
    assert.equal(dom.window.document.activeElement, pickerInput, "the universal picker search field should receive focus");
    await act(async () => { Simulate.change(pickerInput, { target: { value: "l" } }); });
    await flushAsyncWork(2);
    await act(async () => { Simulate.keyDown(pickerInput, { key: "Tab" }); });
    await flushAsyncWork(2);
    const logicGateCategory = [...picker.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Processes"));
    assert.equal(logicGateCategory?.getAttribute("aria-pressed"), "true", "L then Tab should select Logic Gates");
    await act(async () => { Simulate.keyDown(pickerInput, { key: "#" }); });
    await flushAsyncWork(2);
    assert.equal(picker.dataset.mangoUniversalPickerMode, "link", "a second # should switch to link mode");
    const categoryButtons = [...picker.querySelectorAll<HTMLButtonElement>("button")];
    assert.equal(categoryButtons.find((button) => button.textContent?.includes("Nodes"))?.disabled, true);
    assert.equal(categoryButtons.find((button) => button.textContent?.includes("Processes"))?.disabled, false);
    assert.equal(categoryButtons.find((button) => button.textContent?.includes("Projects"))?.disabled, false);
    assert.equal(categoryButtons.find((button) => button.textContent?.includes("Emails"))?.disabled, false);
    assert.deepEqual(linkedPickerEntities, []);
    await act(async () => { Simulate.keyDown(pickerInput, { key: "Escape" }); });
    await waitFor(() => !dom.window.document.querySelector('[data-mango-universal-picker="true"]'), "Escape should close the universal picker");

    const activeEmailLink = remountedProseMirror.querySelector<HTMLElement>(`[data-mango-email-message-id="${REFERENCED_EMAIL_MESSAGE_ID}"]`);
    assert.ok(activeEmailLink);
    const activeReferenceRequestStart = imageFetchURLs.length;
    const defaultElementFromPoint = dom.window.document.elementFromPoint;
    Object.defineProperty(dom.window.document, "elementFromPoint", { configurable: true, value: () => activeEmailLink });
    try {
      await act(async () => {
        activeEmailLink.dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        activeEmailLink.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true, cancelable: true, button: 0 }));
        activeEmailLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      });
    } finally {
      Object.defineProperty(dom.window.document, "elementFromPoint", { configurable: true, value: defaultElementFromPoint });
    }
    await waitFor(
      () => Boolean(dom.window.document.querySelector('[data-email-reference-preview="true"][aria-label="Email thread: Durable selected row"]')),
      "one ordinary active-editor chip click should use the same established preview",
    );
    assert.equal(storedThreadRequests.length, 4);
    assert.deepEqual(
      imageFetchURLs.slice(activeReferenceRequestStart).filter((url) => (
        /\/v[12]\/(?:communications|nodes|projects|logic-gates|huddles|email-relationships)(?:\/|\?)/.test(url)
      )),
      [storedThreadRequests.at(-1)],
      "the active shared path must make only the exact stored-thread request",
    );
    const closeActivePreview = dom.window.document.querySelector<HTMLButtonElement>('[data-email-reference-preview-close="true"]');
    assert.ok(closeActivePreview);
    await act(async () => { closeActivePreview.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, button: 0 })); });
    await waitFor(() => !dom.window.document.querySelector('[data-email-reference-preview="true"]'), "the active-editor preview should close");

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

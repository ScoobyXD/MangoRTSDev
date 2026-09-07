import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import React, { act } from "react";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import type { ProcessStepEditorPlacement } from "../../../../frontend/src/modules/editor/ProcessStepInstructionEditor.js";
import type { MangoTiptapDocument } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";

const instructions: MangoTiptapDocument = {
  format: "mango-tiptap-json", schema_version: 1,
  document: { type: "doc", content: [
    { type: "paragraph", attrs: { blockId: "intro" }, content: [{ type: "text", text: "Receive  the delivery." }, { type: "hardBreak" }, { type: "text", text: "Check the date." }] },
    { type: "paragraph", attrs: { blockId: "blank" } },
    { type: "orderedList", attrs: { blockId: "list", start: 3 }, content: [
      { type: "listItem", attrs: { blockId: "item" }, content: [{ type: "paragraph", attrs: { blockId: "item-text" }, content: [{ type: "text", text: "Record the package count." }] }] },
    ] },
  ] },
};

async function waitFor(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
  assert.fail(message);
}

for (const saveMode of ["local", "server"] as const) test(`${saveMode} Step uses one rich editor and keeps its clicked caret, undo, and save owner while moving between sidebar and map`, { timeout: 15_000 }, async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div><div id="map"><div id="map-preview"></div><div id="map-slot"></div></div>', { url: `http://${saveMode}-step-editor.test/`, pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "self", "Node", "NodeFilter", "Element", "HTMLElement", "DocumentFragment", "DOMParser", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "InputEvent", "MutationObserver", "Range", "Selection", "localStorage", "sessionStorage"]) install(name, name === "window" || name === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  install("cancelAnimationFrame", clearTimeout);
  install("indexedDB", indexedDB);
  install("IDBKeyRange", IDBKeyRange);
  install("IntersectionObserver", class {
    private connected = true;
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) { queueMicrotask(() => { if (this.connected) this.callback([{ target, isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }); }
    disconnect() { this.connected = false; }
  });
  dom.window.HTMLElement.prototype.scrollIntoView = () => undefined;
  dom.window.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  const [{ createRoot }, { renderToStaticMarkup }, { ProcessStepInstructionEditor }, { MangoTiptapStaticRenderer }, { captureMangoTiptapPointerBookmark }, { flushMangoTiptapResource }] = await Promise.all([
    import("react-dom/client"), import("react-dom/server"), import("../../../../frontend/src/modules/editor/ProcessStepInstructionEditor.js"),
    import("../../../../frontend/src/modules/editor/tiptap/MangoTiptapStaticRenderer.js"), import("../../../../frontend/src/modules/editor/tiptap/mangoTiptapPointerActivation.js"),
    import("../../../../frontend/src/modules/editor/tiptap/mangoTiptapFlushRegistry.js"),
  ]);
  const container = dom.window.document.getElementById("root")!;
  const mapSlot = dom.window.document.getElementById("map-slot")!;
  const mapPreview = dom.window.document.getElementById("map-preview")!;
  mapPreview.innerHTML = renderToStaticMarkup(<MangoTiptapStaticRenderer value={instructions} />);
  const root = createRoot(container);
  const companyID = `company-${saveMode}`;
  const requestPaths: Array<{ path: string; method: string }> = [];
  const snapshots: MangoTiptapDocument[] = [];
  let body = structuredClone(instructions);
  let placement: ProcessStepEditorPlacement | null = null;
  let pendingSave: (() => void) | undefined;
  let holdSave = false;
  let editable = true;
  let revision = 0;
  const requestJSON = async <T,>(path: string, options?: RequestInit & { json?: unknown }): Promise<T> => {
    assert.equal(saveMode, "server", "a local map edit must not read or write the server");
    const method = options?.method ?? "GET";
    requestPaths.push({ path, method });
    assert.equal(new URL(path, dom.window.location.origin).pathname, "/v1/editor-json/process_step/step-a/documents/step-a");
    if (method === "GET") return { revision, schema_version: 1, document: body, annotations: [] } as T;
    assert.equal(method, "POST");
    if (holdSave) await new Promise<void>((resolve) => { pendingSave = resolve; });
    const commit = options!.json as { operation_id: string; document: MangoTiptapDocument };
    body = commit.document;
    return { operation_id: commit.operation_id, revision: ++revision, committed_at: "2026-09-08T12:00:00Z" } as T;
  };
  const subscribeToCanonicalChange = () => () => {};
  const render = () => root.render(<React.Suspense fallback={<div>Loading editor</div>}>
    <ProcessStepInstructionEditor companyID={companyID} resourceType="process_step" resourceID="step-a" documentID="step-a"
      ariaLabel="Step instructions" body={body} value={JSON.stringify(body)} saveMode={saveMode} requestJSON={requestJSON}
      subscribeToCanonicalChange={subscribeToCanonicalChange} editable={editable}
      attachmentContext={{ apiBase: "", companyID, resourceType: "logic_gate", resourceID: "process-a", informationID: "overview", editorSurface: "logic_gate_editor", requestJSON, onError: (message) => assert.fail(message) }}
      onDocumentSnapshotChange={(document) => { body = document; snapshots.push(document); }}
      placement={placement} onReturn={() => { placement = null; render(); }} style={{ minHeight: 112 }} />
  </React.Suspense>);
  try {
    await act(async () => render());
    await waitFor(() => Boolean(container.querySelector('[data-mango-editor-format="tiptap_json"]')), "the sidebar Step editor did not mount");
    const originalEditorRoot = container.querySelector<HTMLElement>('[data-mango-editor-format="tiptap_json"]')!;
    const introText = mapPreview.querySelector('[data-mango-block-id="intro"]')!.firstChild!;
    Object.defineProperty(dom.window.document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: introText, offset: 9 }) });
    const coordinates = { left: 180, top: 120 };
    const bookmark = captureMangoTiptapPointerBookmark(mapPreview, introText, coordinates);
    assert.deepEqual(bookmark, { blockID: "intro", textOffset: 9 });
    placement = { stepID: "step-a", container: mapSlot, activation: { requestID: 1, coordinates, bookmark } };
    await act(async () => render());
    await waitFor(() => Boolean(mapSlot.querySelector('.mango-tiptap-prosemirror')), "double-click placement did not activate the editor in its map slot");
    await waitFor(() => originalEditorRoot.dataset.mangoTiptapLiveReady === "true", "the map caret did not settle");
    const liveDOM = mapSlot.querySelector<TiptapEditorHTMLElement>(".mango-tiptap-prosemirror")!;
    const editor = liveDOM.editor!;
    assert.equal(mapSlot.querySelector('[data-mango-editor-format="tiptap_json"]'), originalEditorRoot, "moving the editor must retain its exact DOM root");
    assert.equal(dom.window.document.querySelectorAll('[data-mango-editor-format="tiptap_json"]').length, 1, "the sidebar and map must share one editor/save session");
    assert.equal(editor.state.selection.from, editor.view.posAtDOM(liveDOM.querySelector('[data-mango-block-id="intro"]')!.firstChild!, 9));
    assert.equal(editor.state.selection.empty, true, "activation places a caret instead of selecting the word or document");
    assert.equal(dom.window.document.activeElement, liveDOM);
    const sidebarCopy = container.querySelector(".mango-step-editor-copy")!;
    assert.ok(sidebarCopy.querySelector('ol[start="3"] > li'), "the sidebar copy retains numbered list structure");
    assert.equal(sidebarCopy.querySelector('[data-mango-block-id="intro"]')!.textContent, "Receive  the delivery.Check the date.");
    assert.ok(sidebarCopy.querySelector('[data-mango-block-id="intro"] br'), "hard breaks remain rich document nodes");
    assert.ok(sidebarCopy.querySelector('[data-mango-block-id="blank"]'), "empty paragraphs remain visible spacing");
    assert.equal(requestPaths.filter((request) => request.method === "POST").length, 0, "moving or focusing must not save a document");
    holdSave = true;
    await act(async () => { editor.commands.insertContent("checked "); });
    assert.equal(editor.can().undo(), true);
    const historySelection = editor.state.selection.toJSON();
    let flushing: Promise<void> | undefined;
    if (saveMode === "server") {
      flushing = flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: "process-a" });
      await waitFor(() => Boolean(pendingSave), "the Process flush did not include its portalled Step editor");
    }
    const copyText = container.querySelector('[data-mango-block-id="intro"]')!.firstChild!;
    Object.defineProperty(dom.window.document, "caretPositionFromPoint", { configurable: true, value: () => ({ offsetNode: copyText, offset: 4 }) });
    await act(async () => container.querySelector(".mango-step-editor-copy")!.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 900, clientY: 160 })));
    await waitFor(() => container.contains(originalEditorRoot) && editor.state.selection.from === editor.view.posAtDOM(liveDOM.querySelector('[data-mango-block-id="intro"]')!.firstChild!, 4), "clicking the sidebar copy must return the same editor at the clicked caret");
    assert.equal(liveDOM.editor, editor);
    assert.equal(mapSlot.children.length, 0);
    assert.equal(container.querySelector(".mango-step-editor-copy"), null);
    assert.equal(editor.can().undo(), true, "returning to the sidebar must retain the original undo history");
    assert.notDeepEqual(editor.state.selection.toJSON(), historySelection, "return focuses the clicked sidebar location");
    if (flushing) await act(async () => { pendingSave!(); await flushing; });
    assert.equal(requestPaths.filter((request) => request.method === "POST").length, saveMode === "server" ? 1 : 0, "the same Step must have only one pending save");
    assert.ok(snapshots.some((snapshot) => JSON.stringify(snapshot).includes("checked ")));
    assert.ok(editor.getJSON().content?.some((node) => node.type === "orderedList"), "in-place editing must retain the canonical rich JSON structure");
    const outside = dom.window.document.createElement("button");
    dom.window.document.body.appendChild(outside);
    placement = { stepID: "step-a", container: mapSlot, activation: { requestID: 2, coordinates, bookmark } };
    await act(async () => render());
    placement = null;
    await act(async () => { render(); outside.focus(); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    assert.equal(container.contains(originalEditorRoot), true, "canceling a pending activation returns the sole editor");
    assert.equal(mapSlot.children.length, 0);
    assert.equal(liveDOM.editor, editor);
    assert.equal(dom.window.document.activeElement, outside, "a canceled activation must not steal a later focus choice");
    placement = { stepID: "step-a", container: mapSlot, activation: { requestID: 3, coordinates, bookmark } };
    await act(async () => render());
    await waitFor(() => dom.window.document.activeElement === liveDOM, "the same editor should reactivate in the map");
    editable = false;
    await act(async () => render());
    const readonlyDOM = mapSlot.querySelector<TiptapEditorHTMLElement>('.mango-tiptap-prosemirror')!;
    assert.equal(readonlyDOM.editor!.isEditable, false, "losing edit access must make the currently portalled editor readonly");
    assert.equal(mapSlot.querySelector('[data-mango-editor-format="tiptap_json"]'), originalEditorRoot, "permission changes retain the existing Step save session");
    assert.equal(readonlyDOM.getAttribute("contenteditable"), "false");
    assert.equal(requestPaths.filter((request) => request.method === "POST").length, saveMode === "server" ? 1 : 0, "moving and access changes cannot create a second save");
  } finally {
    pendingSave?.();
    await act(async () => root.unmount());
    dom.window.close();
    restores.reverse().forEach((restore) => restore());
  }
});

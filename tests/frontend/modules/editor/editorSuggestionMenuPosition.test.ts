import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";

test("@, !, and # menus stay above a Node modal and directly below the caret row", async () => {
  const dom = new JSDOM(
    '<!doctype html><div data-mango-modal-layer="true"><div id="editor"></div></div>',
    { url: "https://mango.test/" },
  );
  const domGlobals = dom.window as unknown as typeof globalThis;
  const DOMRectConstructor = domGlobals.DOMRect;
  const HTMLElementConstructor = domGlobals.HTMLElement;
  const globalNames = ["window", "document", "Node", "Element", "HTMLElement", "MutationObserver", "KeyboardEvent"] as const;
  const previousGlobals = new Map<string, unknown>();
  for (const name of globalNames) {
    previousGlobals.set(name, (globalThis as unknown as Record<string, unknown>)[name]);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: name === "window"
        ? dom.window
        : name === "document"
          ? dom.window.document
          : (domGlobals as unknown as Record<string, unknown>)[name],
    });
  }
  const previousRAF = globalThis.requestAnimationFrame;
  const previousCancelRAF = globalThis.cancelAnimationFrame;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (handle: number) => clearTimeout(handle),
  });
  if (!domGlobals.Range.prototype.getClientRects) {
    domGlobals.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (!domGlobals.Range.prototype.getBoundingClientRect) {
    domGlobals.Range.prototype.getBoundingClientRect = () => new DOMRectConstructor(40, 30, 0, 20);
  }
  const previousElementRect = HTMLElementConstructor.prototype.getBoundingClientRect;
  let decorationTop = 30;
  HTMLElementConstructor.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute("data-decoration-id")) return new DOMRectConstructor(40, decorationTop, 0, 20);
    return previousElementRect.call(this);
  };

  const editor = new MangoTiptapEditorEngine({
    element: dom.window.document.querySelector<HTMLElement>("#editor"),
    extensions: createMangoTiptapExtensions({
      editable: true,
      getMentionUsers: () => [{ userID: "user-1", name: "Christina Phan", email: "christina@example.com" }],
      searchEntityLinks: async () => [{ entityType: "project", entityID: "project-1", label: "Launch" }],
    }),
    content: { type: "doc", content: [{ type: "paragraph" }] },
  });

  try {
    const modalLayer = dom.window.document.querySelector<HTMLElement>('[data-mango-modal-layer="true"]');
    const cases = [
      { trigger: "@", selector: '[data-mango-tiptap-mention-menu="true"]' },
      { trigger: "!", selector: '[data-mango-tiptap-mention-menu="true"]' },
      { trigger: "#", selector: '[data-mango-tiptap-entity-menu="true"]' },
    ];
    for (const item of cases) {
      decorationTop = 30;
      editor.commands.clearContent();
      editor.commands.focus();
      editor.commands.insertContent(item.trigger);
      let menu: HTMLElement | null = null;
      for (let index = 0; index < 50 && !menu; index += 1) {
        menu = dom.window.document.querySelector<HTMLElement>(item.selector);
        if (!menu) await new Promise((resolve) => setTimeout(resolve, 2));
      }
      if (!menu) throw new Error(`Expected ${item.trigger} suggestion menu to open`);
      assert.equal(menu.parentElement, modalLayer);
      assert.equal(menu.dataset.side, "bottom");
      assert.equal(menu.dataset.visibleRows, "5");
      assert.equal(menu.style.position, "fixed");
      assert.equal(menu.style.left, "40px");
      assert.equal(menu.style.top, "57px");
      decorationTop = -70;
      editor.view.dom.dispatchEvent(new domGlobals.Event("scroll"));
      assert.equal(menu.style.top, "-43px", "the overlay should follow its caret when a nested editor scrolls");
      editor.view.dom.dispatchEvent(new domGlobals.KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    }
  } finally {
    editor.destroy();
    HTMLElementConstructor.prototype.getBoundingClientRect = previousElementRect;
    dom.window.close();
    for (const name of globalNames) {
      const value = previousGlobals.get(name);
      if (value === undefined) delete (globalThis as unknown as Record<string, unknown>)[name];
      else Object.defineProperty(globalThis, name, { configurable: true, value });
    }
    if (previousRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).requestAnimationFrame;
    else Object.defineProperty(globalThis, "requestAnimationFrame", { configurable: true, value: previousRAF });
    if (previousCancelRAF === undefined) delete (globalThis as unknown as Record<string, unknown>).cancelAnimationFrame;
    else Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: previousCancelRAF });
  }
});

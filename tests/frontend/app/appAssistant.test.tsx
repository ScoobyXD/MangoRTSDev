import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("chat keeps its accessible toggle and disabled composer without contacting an agent", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/" });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests += 1; throw new Error("Chat must not contact an agent."); };
  const [{ createRoot }, { AppAssistant }] = await Promise.all([
    import("react-dom/client"), import("../../../frontend/src/app/AppAssistant.tsx"),
  ]);
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  try {
    await act(async () => { root.render(<AppAssistant bottomInset={62} />); });
    const assistant = container.querySelector<HTMLElement>('[aria-label="Mango chat"]')!;
    const expand = container.querySelector<HTMLButtonElement>('[aria-label="Expand Mango chat"]')!;
    const collapse = container.querySelector<HTMLButtonElement>('[aria-label="Collapse Mango chat"]')!;
    const panel = dom.window.document.getElementById(expand.getAttribute("aria-controls")!)!;
    const expanded = panel.closest<HTMLDivElement>(".mango-assistant-expanded")!;
    assert.equal(assistant.style.bottom, "62px");
    assert.equal(expanded.hidden, true, "chat starts collapsed");
    assert.equal(expand.hidden, false);
    assert.equal(expand.getAttribute("aria-expanded"), "false");
    assert.equal(collapse.getAttribute("aria-controls"), panel.id);
    await act(async () => { expand.click(); });
    assert.equal(expanded.hidden, false);
    assert.equal(expand.hidden, true);
    assert.equal(dom.window.document.activeElement, collapse);
    assert.equal(collapse.getAttribute("aria-expanded"), "true");
    const input = panel.querySelector<HTMLTextAreaElement>('[aria-label="Message Mango"]')!;
    const send = panel.querySelector<HTMLButtonElement>(".mango-assistant-send")!;
    assert.ok(input.disabled);
    assert.ok(send.disabled);
    assert.equal(panel.querySelector('[role="status"]')?.textContent, "Mango chat is unavailable.");
    await act(async () => { send.click(); });
    await act(async () => { collapse.click(); });
    assert.equal(expanded.hidden, true);
    assert.equal(expand.hidden, false);
    assert.equal(dom.window.document.activeElement, expand);
    assert.equal(requests, 0);
  } finally {
    await act(async () => { root.unmount(); });
    globalThis.fetch = originalFetch;
    dom.window.close();
    restores.reverse().forEach((restore) => restore());
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

test("quoted email history is collapsed by default and expands through the shared subthread control", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  for (const name of ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement", "Event", "EventTarget", "MouseEvent", "DOMParser"] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { EmailQuotedHistory }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/communications/EmailQuotedHistory.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const body = '<div>New answer</div><div class="gmail_quote"><div>On Tuesday...</div><blockquote>Old answer</blockquote></div>';

    await act(async () => root.render(
      <EmailQuotedHistory body={body}>
        {(visibleBody) => <div data-visible-email-body dangerouslySetInnerHTML={{ __html: visibleBody }} />}
      </EmailQuotedHistory>,
    ));

    const visibleBody = container.querySelector<HTMLElement>("[data-visible-email-body]");
    const showButton = container.querySelector<HTMLButtonElement>('[data-email-quoted-history-control="show"]');
    assert.ok(visibleBody);
    assert.ok(showButton);
    assert.equal(showButton.textContent?.trim(), "Show subthread");
    assert.equal(showButton.getAttribute("aria-expanded"), "false");
    assert.match(visibleBody.textContent ?? "", /New answer/);
    assert.doesNotMatch(visibleBody.textContent ?? "", /Old answer/);

    await act(async () => showButton.click());

    const hideButton = container.querySelector<HTMLButtonElement>('[data-email-quoted-history-control="hide"]');
    assert.ok(hideButton);
    assert.equal(hideButton.textContent?.trim(), "Hide subthread");
    assert.equal(hideButton.getAttribute("aria-expanded"), "true");
    assert.match(visibleBody.textContent ?? "", /Old answer/);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import { IDBKeyRange, indexedDB as fakeIndexedDB } from "fake-indexeddb";
import { JSDOM } from "jsdom";
import React, { act } from "react";

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

test("KPI plus creates a selected inline name and only double-click opens the popup", async () => {
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
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { Simulate }, { LogicGateKPISection }] = await Promise.all([
      import("react-dom/client"),
      import("react-dom/test-utils"),
      import("../../../../frontend/src/modules/huddles/LogicGateKPISection.tsx"),
    ]);
    const calls: Array<{ path: string; method: string; json?: unknown }> = [];
    const created = { company_id: "company-1", kpi_id: "kpi-1", logic_gate_id: "gate-1", name: "New KPI" };
    const requestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const method = init?.method ?? "GET";
      calls.push({ path, method, json: init?.json });
      if (path.startsWith("/v1/kpis?")) return { kpis: [] } as T;
      if (path === "/v1/kpis" && method === "POST") return created as T;
      if (path === "/v1/kpis/kpi-1" && method === "PUT") return { ...created, name: (init?.json as { name: string }).name } as T;
      if (path.startsWith("/v1/editor-json/kpi/")) return {
        revision: 1,
        schema_version: 1,
        document: {
          format: "mango-tiptap-json",
          schema_version: 1,
          document: { type: "doc", content: [{ type: "paragraph" }] },
          annotations: [],
        },
        annotations: [],
      } as T;
      throw new Error(`unexpected request ${method} ${path}`);
    };
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(
      <LogicGateKPISection companyID="company-1" logicGateID="gate-1" canEdit requestJSON={requestJSON}/>,
    ));
    await flushAsyncWork();

    const plus = container.querySelector<HTMLButtonElement>('button[aria-label="Create KPI"]');
    assert.ok(plus);
    await act(async () => plus.click());
    await flushAsyncWork();
    assert.deepEqual(calls.find((call) => call.method === "POST")?.json, {
      company_id: "company-1",
      logic_gate_id: "gate-1",
      name: "New KPI",
    });
    assert.equal(dom.window.document.querySelector('[role="dialog"][aria-label="KPI"]'), null, "creation must not open the popup");

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="KPI name"]');
    assert.ok(nameInput, "the new card should enter inline name editing");
    assert.equal(dom.window.document.activeElement, nameInput);
    assert.equal(nameInput.selectionStart, 0);
    assert.equal(nameInput.selectionEnd, "New KPI".length);

    await act(async () => Simulate.change(nameInput, { target: { value: "Revenue KPI" } }));
    await act(async () => Simulate.blur(nameInput));
    await flushAsyncWork();
    assert.deepEqual(calls.find((call) => call.method === "PUT")?.json, { company_id: "company-1", name: "Revenue KPI" });

    const card = container.querySelector<HTMLButtonElement>('button[data-mango-kpi-card="kpi-1"]');
    assert.ok(card);
    await act(async () => card.click());
    assert.equal(dom.window.document.querySelector('[role="dialog"][aria-label="KPI"]'), null, "single-click must not open the popup");
    await act(async () => card.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
    assert.ok(dom.window.document.querySelector('[role="dialog"][aria-label="KPI"]'), "double-click should open the popup");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

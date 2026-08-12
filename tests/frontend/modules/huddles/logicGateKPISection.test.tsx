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

test("Logic Gate relationship tray links Huddles and opens a KPI from one click anywhere on its card", async () => {
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
    const huddle = { company_id: "company-1", huddle_logic_gate_id: "huddle-1", header: "Weekly Leadership" };
    const requestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const method = init?.method ?? "GET";
      calls.push({ path, method, json: init?.json });
      if (path.startsWith("/v1/kpis?")) return { kpis: [] } as T;
      if (path.startsWith("/v1/logic-gates/gate-1/huddle-logic-gates?") && method === "GET") return { huddle_logic_gates: [huddle] } as T;
      if (path === "/v1/huddle-logic-gates?company_id=company-1" && method === "GET") return { huddle_logic_gates: [huddle] } as T;
      if (path === "/v1/user-pins?company_id=company-1" && method === "GET") return { pin_folders: [], user_pins: [] } as T;
      if (path === "/v1/logic-gates/gate-1/huddle-logic-gates/huddle-1" && method === "PUT") return { status: "ok" } as T;
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

    assert.equal(container.querySelector('[data-logic-gate-relationship-tray="split"]')?.getAttribute("data-logic-gate-relationship-tray"), "split");
    const huddleCard = container.querySelector<HTMLElement>('[data-logic-gate-huddle-card="huddle-1"]');
    assert.ok(huddleCard, "the linked Huddle Logic Gate should use its own card");
    assert.ok(huddleCard.querySelector("svg"), "the Huddle Logic Gate card should show its Huddle icon");
    assert.match(huddleCard.textContent ?? "", /Weekly Leadership/);

    const huddlePlus = container.querySelector<HTMLButtonElement>('button[aria-label="Add Huddle Logic Gate"]');
    assert.ok(huddlePlus);
    await act(async () => huddlePlus.click());
    await flushAsyncWork();
    const huddleOption = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes("Weekly Leadership"));
    assert.ok(huddleOption, "the shared Universal Picker should list visible Huddle Logic Gates");
    await act(async () => huddleOption.click());
    await flushAsyncWork();
    assert.deepEqual(calls.find((call) => call.path.endsWith("/huddle-logic-gates/huddle-1") && call.method === "PUT")?.json, { company_id: "company-1" });

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
    assert.deepEqual(calls.find((call) => call.path === "/v1/kpis/kpi-1" && call.method === "PUT")?.json, { company_id: "company-1", name: "Revenue KPI" });

    const cardPreview = container.querySelector<HTMLElement>('button[data-mango-kpi-card="kpi-1"] [data-kpi-card-preview="true"]');
    assert.ok(cardPreview);
    await act(async () => cardPreview.click());
    const dialog = dom.window.document.querySelector('[role="dialog"][aria-label="KPI"][data-kpi-editor-popup="centered-large"]');
    assert.ok(dialog, "single-click should open the shared large popup");
    assert.ok(dialog.querySelector('button[aria-label="Close KPI"]'), "the popup should expose the standard red X close action");
    assert.ok(dialog.querySelector('[role="toolbar"]'), "the existing Mango editor toolbar should live in the popup header");
    assert.ok(dialog.querySelector('[data-editor-save-status]'), "the existing Mango save status should be visible in the popup header");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { CompanyExplorerContent } from "../../../../frontend/src/modules/company-explorer/CompanyExplorerContent.js";
import { EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, EVENT_COMPANY_EXPLORER_FIND_REQUESTED, EVENT_COMPANY_EXPLORER_PROCESS_CREATED } from "../../../../frontend/src/modules/dashboardEvents.js";
import type { CompanyExplorerV2Row } from "../../../../frontend/src/modules/company-explorer/companyExplorerLazyApi.js";

test("map creation reveals a Process in a cached empty Folder without opening its editor; recovery reads the same exact path", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "http://localhost" });
  const restores: Array<() => void> = [];
  for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "Node", "HTMLElement", "Element", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    const value = name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  dom.window.sessionStorage.setItem("mangorts:active-company-id-v1", "company");
  Object.defineProperty(dom.window.HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 600 });
  const timestamp = "2026-09-05T00:00:00Z";
  const row = (entity_id: string, entity_type: CompanyExplorerV2Row["entity_type"], name: string, parent_entity_id?: string, has_children = false): CompanyExplorerV2Row => ({
    company_id: "company", entity_id, resource_id: entity_id, entity_type, name, parent_entity_id, has_children,
    position: 0, created_timestamp: timestamp, updated_timestamp: timestamp,
  });
  const company = row("company", "company", "Workspace", undefined, true);
  const operations = row("operations", "folder", "Operations", "company", true);
  const orders = row("orders", "folder", "Orders", "operations");
  const process = { ...row("new-process", "logic_gate", "Receive order", "orders"), edge_id: "saved-placement" };
  let committed = false;
  const reads: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.ok(!init?.method || init.method === "GET", "revealing a committed Process makes no write");
    const url = new URL(input.toString());
    const parent = url.searchParams.get("parent_id");
    if (url.pathname === "/v1/company-explorer/roots") return Response.json({ rows: [company] });
    assert.equal(url.pathname, "/v1/company-explorer/children");
    reads.push(parent!);
    return Response.json({ rows: parent === "company" ? [operations] : parent === "operations" ? [{ ...orders, has_children: committed }] : parent === "orders" && committed ? [process] : [] });
  }) as typeof fetch;
  let activations = 0;
  dom.window.addEventListener(EVENT_COMPANY_EXPLORER_ENTITY_ACTIVATED, () => { activations++; });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  const send = async (name: string, detail: unknown) => {
    await act(async () => { dom.window.dispatchEvent(new dom.window.CustomEvent(name, { detail })); });
  };
  try {
    await act(async () => root.render(<CompanyExplorerContent accent="#475569" widgetId="sidebar-explorer" theme="light" hideTopControls />));
    await send(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, { companyID: "company", sourceFrameID: "process-map", folderPathIDs: ["operations", "orders"] });
    assert.match(dom.window.document.body.textContent!, /Orders/);
    assert.equal(dom.window.document.querySelector('[data-selected="true"]')?.textContent, "Orders");
    assert.ok(reads.includes("orders"), "the explicitly chosen empty Folder was loaded");

    reads.length = 0;
    committed = true;
    await send(EVENT_COMPANY_EXPLORER_PROCESS_CREATED, {
      companyID: "company", processID: "new-process", folderPathIDs: ["operations", "orders"],
      response: { logic_gates: [{ company_id: "company", logic_gate_id: "new-process", header: "Receive order" }], folder_items: [{ company_id: "company", folder_id: "orders", item_id: "new-process", item_type: "logic_gate" }] },
    });
    assert.equal(dom.window.document.querySelector('[data-selected="true"]')?.textContent, "Receive order");
    assert.equal(dom.window.document.querySelectorAll('.company-explorer-row-hit[data-selected="true"]').length, 1);
    assert.deepEqual(reads.sort(), ["company", "operations", "orders"]);
    assert.equal(activations, 0);

    reads.length = 0;
    await send(EVENT_COMPANY_EXPLORER_PROCESS_CREATED, { companyID: "another-company", processID: "hidden", folderPathIDs: ["hidden-folder"] });
    assert.deepEqual(reads, []);
    assert.equal(dom.window.document.querySelector('[data-selected="true"]')?.textContent, "Receive order");

    await send(EVENT_COMPANY_EXPLORER_PROCESS_CREATED, { companyID: "company", processID: "new-process", folderPathIDs: ["operations", "orders"] });
    assert.deepEqual(reads.sort(), ["company", "operations", "orders"]);
    assert.equal(dom.window.document.querySelectorAll('[data-company-explorer-row-id="logic-gate-new-process"]').length, 1);
    assert.equal(activations, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

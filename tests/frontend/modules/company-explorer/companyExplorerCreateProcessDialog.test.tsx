import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { CompanyExplorerCreateProcessDialog } from "../../../../frontend/src/modules/company-explorer/CompanyExplorerCreateProcessDialog.js";
import type { WorkspaceEntityCommandRequest } from "../../../../frontend/src/modules/workspace/workspaceEntityCommands.js";

const folders = [
  { company_id: "company", folder_id: "operations", name: "Operations", position: 1 },
  { company_id: "company", folder_id: "orders", parent_folder_id: "operations", name: "Orders", position: 1 },
];
const createdResponse = { logic_gates: [{ company_id: "company", logic_gate_id: "new-process", header: "Receive order" }], folder_items: [{ folder_id: "orders", item_type: "logic_gate", item_id: "new-process" }] };

async function renderDialog(requestJSON: WorkspaceEntityCommandRequest, initialFolderID = "", position?: number) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "http://localhost" });
  const restores: Array<() => void> = [];
  for (const name of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    const value = name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  let closes = 0;
  const creations: Array<{ response: unknown; path: string[] }> = [];
  await act(async () => {
    root.render(<CompanyExplorerCreateProcessDialog companyID="company" requestJSON={requestJSON} initialFolderID={initialFolderID} position={position} creatorRACIRole="accountable" isDarkTheme={false} onClose={() => { closes++; }} onCreated={(response, path) => creations.push({ response, path })} />);
  });
  const document = dom.window.document;
  return {
    document, creations, get closes() { return closes; },
    async name(value: string) { await act(async () => { const input = document.querySelector("input")!; input.value = value; Simulate.change(input); }); },
    async folder(value: string) { await act(async () => { const select = document.querySelector("select")!; select.value = value; Simulate.change(select); }); },
    async submit() { await act(async () => { Simulate.submit(document.querySelector("form")!); }); },
    async close() {
      await act(async () => root.unmount());
      dom.window.close();
      for (const restore of restores.reverse()) restore();
    },
  };
}

test("Process creation requires a name and existing Folder, then makes one named batch in the selected destination", async () => {
  const writes: Array<{ path: string; body: Record<string, any> }> = [];
  const request: WorkspaceEntityCommandRequest = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (init?.method !== "POST") return { folders } as T;
    writes.push({ path, body: JSON.parse(String(init.body)) });
    return createdResponse as T;
  };
  const ui = await renderDialog(request, "", 2000);
  try {
    assert.equal(ui.document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled, true);
    await ui.submit();
    assert.equal(writes.length, 0);
    await ui.name("  Receive order  ");
    await ui.submit();
    assert.equal(writes.length, 0);
    assert.match(ui.document.querySelector("select")!.textContent!, /Operations \/ Orders/);
    await ui.folder("orders");
    await ui.submit();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].path, "/v1/workspace/entity-batches");
    assert.equal(writes[0].body.company_id, "company");
    assert.equal(writes[0].body.entity_kind, "logic_gate");
    assert.equal(writes[0].body.folder_id, "orders");
    assert.equal(writes[0].body.mutation_origin, "company_explorer");
    assert.equal(writes[0].body.creator_logic_gate_gvic_role, "accountable");
    assert.equal(writes[0].body.items[0].title, "Receive order");
    assert.equal(writes[0].body.items[0].position, undefined, "a different Folder must not reuse the context-menu position");
    assert.deepEqual(ui.creations, [{ response: createdResponse, path: ["operations", "orders"] }]);
    assert.equal(ui.closes, 1);
  } finally { await ui.close(); }
});

test("A failed Process create keeps the entered name and selected Folder and permits a corrected retry", async () => {
  const writes: Record<string, any>[] = [];
  const request: WorkspaceEntityCommandRequest = async <T,>(_path: string, init?: RequestInit): Promise<T> => {
    if (init?.method !== "POST") return { folders } as T;
    writes.push(JSON.parse(String(init.body)));
    if (writes.length === 1) throw new Error("Folder access changed.");
    return createdResponse as T;
  };
  const ui = await renderDialog(request, "orders", 2000);
  try {
    await ui.name("Receive order");
    await ui.submit();
    assert.match(ui.document.querySelector('[role="alert"]')!.textContent!, /Folder access changed/);
    assert.equal(ui.document.querySelector("input")!.value, "Receive order");
    assert.equal(ui.document.querySelector("select")!.value, "orders");
    assert.equal(ui.closes, 0);
    assert.equal(ui.creations.length, 0);
    await ui.submit();
    assert.equal(writes[1].items[0].position, 2000);
    assert.equal(ui.closes, 1);
    assert.equal(ui.creations.length, 1);
  } finally { await ui.close(); }
});

test("Cancelling Process creation and an unavailable Folder never create a record", async () => {
  let writes = 0;
  const request: WorkspaceEntityCommandRequest = async <T,>(_path: string, init?: RequestInit): Promise<T> => {
    if (init?.method === "POST") writes++;
    return { folders: [] } as T;
  };
  const ui = await renderDialog(request, "deleted-folder");
  try {
    await ui.name("Receive order");
    await ui.submit();
    assert.equal(writes, 0);
    assert.match(ui.document.body.textContent!, /Create a Folder in Company Explorer first/);
    await act(async () => { Simulate.click(ui.document.querySelector('button[type="button"]')!); });
    assert.equal(ui.closes, 1);
    assert.equal(writes, 0);
  } finally { await ui.close(); }
});

import assert from "node:assert/strict";
import test from "node:test";
import React, { act, useState } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { ProcessMapDestinationPath, processMapFolderPath } from "../../../../frontend/src/pages/process-map/ProcessMapDestinationPath.js";
import { ProcessMapCreateFolderDialog } from "../../../../frontend/src/pages/process-map/ProcessMapCreateFolderDialog.js";
import type { CompanyExplorerFolder } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { CompanyExplorerV2Row } from "../../../../frontend/src/modules/company-explorer/companyExplorerLazyApi.js";

function folder(id: string, name: string, parent?: string, position = 1): CompanyExplorerFolder {
  return { company_id: "company", folder_id: id, name, parent_folder_id: parent, position, folder_kind: "node", created_timestamp: "created", updated_timestamp: "updated" };
}
const folders = [folder("operations", "Operations"), folder("orders", "Orders", "operations"), folder("sales", "Sales", undefined, 2)];
const createdFolder: CompanyExplorerV2Row = {
  company_id: "company", entity_type: "folder", entity_id: "created-folder", parent_entity_id: "orders", name: "Incoming", position: 2000,
  created_timestamp: "created", updated_timestamp: "updated",
};

async function mount(node: React.ReactElement, fetchImpl?: typeof fetch) {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { pretendToBeVisual: true, url: "https://process-map-dialog.test" });
  const restores: Array<() => void> = [];
  for (const name of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "MutationObserver", "getComputedStyle", "IS_REACT_ACT_ENVIRONMENT"]) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    const value = name === "IS_REACT_ACT_ENVIRONMENT" ? true : name === "getComputedStyle" ? dom.window.getComputedStyle.bind(dom.window) : name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete (globalThis as Record<string, unknown>)[name]; });
  }
  Object.assign(dom.window.HTMLElement.prototype, { attachEvent() {}, detachEvent() {} });
  const originalFetch = globalThis.fetch;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(dom.window.document.getElementById("root")!);
  await act(async () => { root.render(node); });
  const document = dom.window.document;
  let unmounted = false;
  return {
    document,
    async click(text: string) {
      const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent === text || candidate.getAttribute("aria-label") === text);
      assert.ok(button, `missing button: ${text}`);
      await act(async () => { button.click(); });
    },
    async name(value: string) {
      await act(async () => { const input = document.querySelector("input")!; input.value = value; Simulate.change(input); });
    },
    async submit() { await act(async () => { Simulate.submit(document.querySelector("form")!); }); },
    async unmount() { if (!unmounted) { await act(async () => root.unmount()); unmounted = true; } },
    async cleanup() {
      if (!unmounted) await act(async () => root.unmount());
      globalThis.fetch = originalFetch;
      dom.window.close();
      for (const restore of restores.reverse()) restore();
    },
  };
}

test("Folder paths require a complete, acyclic ancestry and retain exact Folder identities", () => {
  assert.deepEqual(processMapFolderPath(folders, "orders"), [folders[0], folders[1]]);
  assert.deepEqual(processMapFolderPath(folders, ""), []);
  assert.deepEqual(processMapFolderPath(folders, "missing"), []);
  assert.deepEqual(processMapFolderPath([folder("child", "Child", "missing")], "child"), []);
  assert.deepEqual(processMapFolderPath([folder("a", "A", "b"), folder("b", "B", "a")], "a"), []);
});

test("destination browser shows one Folder level and commits only an explicit valid choice", async () => {
  const changes: string[] = [];
  function Picker() {
    const [folderID, setFolderID] = useState("");
    return <ProcessMapDestinationPath folders={folders} folderID={folderID} onChange={(id) => { changes.push(id); setFolderID(id); }} />;
  }
  const ui = await mount(<Picker />);
  try {
    await ui.click("Choose Folder");
    assert.ok(ui.document.querySelector("[aria-label='Open Operations']"));
    assert.equal(ui.document.querySelector("[aria-label='Open Orders']"), null, "descendants are not rendered as one large list");
    const rootCommit = [...ui.document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Use this Folder")!;
    assert.equal(rootCommit.disabled, true);
    await ui.click("Open Operations");
    assert.deepEqual(changes, []);
    assert.ok(ui.document.querySelector("[aria-label='Open Orders']"));
    assert.equal(ui.document.querySelector("[aria-label='Open Sales']"), null);
    await ui.click("Open Orders");
    await ui.click("Up to parent Folder");
    await ui.click("Open Orders");
    await ui.click("Use this Folder");
    assert.deepEqual(changes, ["orders"]);
    assert.equal(ui.document.querySelector("[aria-label='Choose destination Folder']"), null);
    assert.equal(ui.document.querySelector("[aria-label='Destination path']")?.textContent, "Workspace/Operations/Orders");
    await ui.click("Workspace");
    await act(async () => { ui.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(ui.document.querySelector("[aria-label='Choose destination Folder']"), null);
    assert.deepEqual(changes, ["orders"]);
  } finally { await ui.cleanup(); }
});

test("Create Folder posts one canonical request and returns the exact Explorer row", async () => {
  const writes: Array<{ url: string; method?: string; body: unknown }> = [];
  const creations: CompanyExplorerV2Row[] = [];
  let closes = 0;
  let resolveWrite!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveWrite = resolve; });
  const ui = await mount(<ProcessMapCreateFolderDialog apiBase="https://api.test" companyID="company" folders={folders} initialParentFolderID="orders" onClose={() => { closes++; }} onCreated={(row) => creations.push(row)} />, (async (input, init) => {
    writes.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return pending;
  }) as typeof fetch);
  try {
    await ui.submit();
    assert.equal(writes.length, 0);
    await ui.name("  Incoming  ");
    await ui.submit();
    await ui.submit();
    assert.equal(writes.length, 1, "repeated submits cannot duplicate an in-flight creation");
    assert.equal(ui.document.querySelector<HTMLInputElement>("input")!.disabled, true);
    assert.ok([...ui.document.querySelectorAll<HTMLButtonElement>("nav button")].every((button) => button.disabled));
    await ui.click("Cancel");
    assert.equal(closes, 0);
    await act(async () => { resolveWrite(new Response(JSON.stringify(createdFolder), { status: 201 })); await pending; });
    assert.deepEqual(writes, [{ url: "https://api.test/v1/company-explorer/folders", method: "POST", body: { company_id: "company", parent_folder_id: "orders", name: "Incoming" } }]);
    assert.deepEqual(creations, [createdFolder]);
    assert.equal(closes, 1);
  } finally { await ui.cleanup(); }
});

test("a missing destination blocks creation until an explicit Workspace choice and errors preserve the name", async () => {
  const writes: unknown[] = [];
  const creations: CompanyExplorerV2Row[] = [];
  const ui = await mount(<ProcessMapCreateFolderDialog apiBase="https://api.test" companyID="company" folders={folders} initialParentFolderID="missing" onClose={() => undefined} onCreated={(row) => creations.push(row)} />, (async (_input, init) => {
    writes.push(JSON.parse(String(init?.body)));
    return writes.length === 1
      ? new Response(JSON.stringify({ error: "parent_folder_not_found" }), { status: 404 })
      : new Response(JSON.stringify({ ...createdFolder, parent_entity_id: "company" }), { status: 201 });
  }) as typeof fetch);
  try {
    await ui.name("Incoming");
    await ui.submit();
    assert.equal(writes.length, 0);
    assert.match(ui.document.querySelector("[role='status']")?.textContent ?? "", /selected Folder is unavailable/);
    await ui.click("Choose Folder");
    await ui.click("Use Workspace");
    await ui.submit();
    assert.match(ui.document.querySelector("[role='alert']")?.textContent ?? "", /destination is no longer available/);
    assert.equal(ui.document.querySelector<HTMLInputElement>("input")!.value, "Incoming");
    assert.equal(creations.length, 0);
    await ui.submit();
    assert.deepEqual(writes, [
      { company_id: "company", parent_folder_id: "", name: "Incoming" },
      { company_id: "company", parent_folder_id: "", name: "Incoming" },
    ]);
    assert.equal(creations[0].parent_entity_id, "company");
  } finally { await ui.cleanup(); }
});

test("a Folder creation completing after dialog unmount cannot call stale navigation callbacks", async () => {
  let resolveWrite!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { resolveWrite = resolve; });
  let callbacks = 0;
  const ui = await mount(<ProcessMapCreateFolderDialog apiBase="https://api.test" companyID="company" folders={folders} onClose={() => { callbacks++; }} onCreated={() => { callbacks++; }} />, (async () => pending) as typeof fetch);
  try {
    await ui.name("Incoming");
    await ui.submit();
    await ui.unmount();
    await act(async () => { resolveWrite(new Response(JSON.stringify(createdFolder), { status: 201 })); await pending; });
    assert.equal(callbacks, 0);
  } finally { await ui.cleanup(); }
});

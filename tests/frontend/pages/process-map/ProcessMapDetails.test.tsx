import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { ProcessMapDetailsContents } from "../../../../frontend/src/pages/process-map/ProcessMapDetails.js";

test("Process Map reuses inherited typed RACI, the saved policy command, permissions, and the existing SOP document", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://process-details.test/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (prior) Object.defineProperty(globalThis, name, prior); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLDivElement", "HTMLSpanElement", "HTMLButtonElement", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "localStorage", "sessionStorage"]) install(name, name === "window" || name === "self" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0));
  install("cancelAnimationFrame", clearTimeout);
  const requests: Array<{ path: string; method: string; options?: RequestInit }> = [];
  const group = { company_id: "details-company", role: "responsible", principal_type: "group", principal_id: "review-team", principal_name: "Review Team", user_id: "", created_timestamp: "" };
  const policy = { assignment_mode: "customized", effective_assignment_mode: "customized", effective_source: { resource_type: "company_explorer_folder", resource_id: "folder-one" }, gvic_assignments: [group], revision: "revision-one" };
  let conflict = true;
  const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  install("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, "http://process-details.test");
    const method = options?.method ?? "GET";
    requests.push({ path: url.pathname, method, options });
    if (url.pathname.endsWith("/users")) return response({ users: [] });
    if (url.pathname.endsWith("/user-groups")) return response({ groups: [{ company_id: "details-company", group_id: "review-team", name: "Review Team", position: 1000 }], members: [] });
    if (url.pathname.endsWith("/gvic")) {
      if (method === "PUT" && conflict) {
        conflict = false;
        policy.revision = "revision-two";
        return new Response(JSON.stringify({ error: "version_conflict" }), { status: 409, headers: { "content-type": "application/json" } });
      }
      if (method === "PUT") return response({ ...policy, gvic_assignments: JSON.parse(String(options?.body)).gvic_assignments, revision: "revision-three" });
      return response(policy);
    }
    if (url.pathname.endsWith("/view")) return response({ can_edit: !url.pathname.includes("readonly"), logic_gate: { logic_gate_id: "saved-process", header: "Procedure" }, information: [], projections: [{ information_id: "existing-sop", type: "Text box", information: "", updated_timestamp: "2026-09-05" }] });
    assert.fail(`Unexpected request ${method} ${url.pathname}`);
  });
  const [{ createRoot }, { ProcessMapDetails }, { EDITOR_TEXT_BLOCK_TYPE }] = await Promise.all([
    import("react-dom/client"), import("../../../../frontend/src/pages/process-map/ProcessMapDetails.js"), import("../../../../frontend/src/modules/editor/editorProjection.js"),
  ]);
  assert.equal(EDITOR_TEXT_BLOCK_TYPE, "Text box");
  const root = createRoot(dom.window.document.getElementById("root")!);
  let contents: ProcessMapDetailsContents = {};
  let busy = true;
  const render = (processID: string, isNew: boolean, folderID = "folder-one", refreshVersion = 0) => root.render(<ProcessMapDetails key={processID} apiBase="http://process-details.test" companyID="details-company" processID={processID} isNew={isNew} folderID={folderID} refreshVersion={refreshVersion} onChange={(next) => { contents = next; }} onBusyChange={(next) => { busy = next; }} />);
  const settle = async (predicate: () => boolean) => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) assert.fail(dom.window.document.body.textContent ?? "did not settle");
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    }
  };
  const removeGroup = async () => {
    const assigned = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Responsible people and groups"]')!;
    await act(async () => assigned.click());
    const remove = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Remove Review Team from Responsible"]');
    assert.ok(remove, [...dom.window.document.querySelectorAll("button")].map((button) => button.getAttribute("aria-label")).join(" | "));
    await act(async () => remove.click());
  };
  try {
    await act(async () => render("new-process", true));
    await settle(() => !busy && !dom.window.document.querySelector<HTMLButtonElement>('[data-raci-add-principal="responsible"]')?.disabled);
    assert.deepEqual(contents, {}, "untouched inherited assignments are omitted from creation");
    assert.match(dom.window.document.body.textContent ?? "", /Review Team/);
    await removeGroup();
    assert.deepEqual(contents.gvic_assignments, [], "explicitly clearing inherited assignments sends an empty complete policy");
    await act(async () => render("new-process", true, "folder-two"));
    await settle(() => !busy);
    assert.deepEqual(contents.gvic_assignments, [], "changing Folder preserves explicit user choices");
    assert.equal(requests.some((request) => request.method !== "GET"), false, "creation does not write a policy before Save");
    await act(async () => render("saved-process", false));
    await settle(() => !busy && !dom.window.document.querySelector<HTMLButtonElement>('[data-raci-add-principal="responsible"]')?.disabled);
    await removeGroup();
    await settle(() => !busy);
    const write = requests.find((request) => request.method === "PUT")!;
    assert.equal(write.path, "/v1/resources/logic_gate/saved-process/gvic");
    assert.equal(new Headers(write.options?.headers).get("If-Match"), "revision-one");
    assert.deepEqual(JSON.parse(String(write.options?.body)).gvic_assignments, []);
    assert.match(dom.window.document.body.textContent ?? "", /Assignments changed elsewhere/);
    await removeGroup();
    await settle(() => !busy);
    assert.equal(new Headers(requests.filter((request) => request.method === "PUT").at(-1)?.options?.headers).get("If-Match"), "revision-two", "a conflict reloads the current policy revision for the next edit");
    const toggle = dom.window.document.querySelector<HTMLButtonElement>(".process-map-details__toggle")!;
    await act(async () => toggle.click());
    await settle(() => Boolean(dom.window.document.querySelector('[data-process-sop-document-id="existing-sop"]')));
    const editor = dom.window.document.querySelector('[data-process-sop-document-id="existing-sop"]');
    group.principal_name = "Renamed Review Team";
    const policyReads = requests.filter((request) => request.path.endsWith("/gvic")).length;
    await act(async () => render("saved-process", false, "folder-one", 1));
    await settle(() => requests.filter((request) => request.path.endsWith("/gvic")).length > policyReads);
    assert.equal(dom.window.document.querySelector('[data-process-sop-document-id="existing-sop"]'), editor, "canonical policy refresh preserves the open SOP editor");
    await act(async () => render("readonly-process", false));
    await settle(() => !busy);
    assert.equal(dom.window.document.querySelector<HTMLButtonElement>('[data-raci-add-principal="responsible"]')?.disabled, true, "the map respects the existing Process edit permission");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

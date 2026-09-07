import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { ProcessWorkSnapshot } from "../../../../frontend/src/modules/kanban/processWork.js";
import type { MangoTiptapDocument } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";

async function settle(condition: () => boolean, message: string) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(message);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

test("saved Process map refreshes canonical Steps and permissions, retries denial, and rejects late navigation reads", async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://saved-process.test", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => { if (previous) Object.defineProperty(globalThis, name, previous); else delete (globalThis as Record<string, unknown>)[name]; });
  };
  for (const name of ["window", "document", "navigator", "sessionStorage", "localStorage", "Node", "Element", "HTMLElement", "HTMLInputElement", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "MutationObserver"]) {
    install(name, name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  const sockets: TestSocket[] = [];
  class TestSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 1;
    onmessage: ((event: { data: string }) => void) | null = null;
    constructor() { sockets.push(this); }
    send() {}
    close() { this.readyState = 3; }
  }
  install("WebSocket", TestSocket);
  const apiBase = "http://saved-process.test", companyID = "company";
  let processID = "first", denied = false;
  const work: ProcessWorkSnapshot = { logic_gate: { logic_gate_id: "first", header: "Saved procedure" }, permissions: { can_edit: true, can_resolve_requests: false }, steps: [{ process_step_id: "first-step", logic_gate_id: "first", name: "Review request", position: 1000 }], relationships: [], nodes: [] };
  let pendingWork: Promise<Response> | null = null;
  let savedStepX = 64;
  let releaseWork!: (response: Response) => void;
  const requests: string[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  install("fetch", async (input: string, options?: RequestInit) => {
    const url = new URL(input, apiBase);
    requests.push(`${options?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/v1/realtime/ticket") return reply({ ticket: "test" });
    const match = url.pathname.match(/^\/v2\/logic-gates\/([^/]+)\/(work|step-map|steps)$/);
    assert.ok(match, `Unexpected endpoint ${url.pathname}`);
    const id = match[1];
    if (match[2] === "work") {
      if (id === "first" && pendingWork) return pendingWork;
      if (id === "first" && denied) return reply({ error: "not_found" }, 404);
      return reply(id === "first" ? work : { ...work, logic_gate: { logic_gate_id: id, header: "Another procedure" }, steps: [{ process_step_id: "second-step", logic_gate_id: id, name: "Approve payment", position: 1000 }] });
    }
    if (match[2] === "steps") {
      const body = JSON.parse(String(options?.body));
      const step = { process_step_id: "created", logic_gate_id: id, name: body.name, position: 2000 };
      work.steps = [...work.steps, step];
      return reply({ step });
    }
    assert.equal(options?.method ?? "GET", "GET");
    return reply({ revision: 1, steps: id === "first" ? [{ process_step_id: "first-step", x: savedStepX, y: 64, width: 224, height: 112 }] : [], routes: [] });
  });
  const [{ createRoot }, { ProcessMapSavedProcess }, { clearProcessWorkCache, getCachedProcessWork, dispatchLogicGateWorkUpdated }, { updateRealtimeHealth, realtimeHealthKey }] = await Promise.all([
    import("react-dom/client"), import("../../../../frontend/src/pages/process-map/ProcessMapSavedProcess.js"),
    import("../../../../frontend/src/modules/kanban/kanbanApi.js"), import("../../../../frontend/src/modules/realtime/realtimeHealth.js"),
  ]);
  clearProcessWorkCache(apiBase, companyID, "first");
  clearProcessWorkCache(apiBase, companyID, "second");
  const container = dom.window.document.getElementById("root")!;
  const root = createRoot(container);
  const busy: boolean[] = [];
  let updateStepBody!: (stepID: string, body: MangoTiptapDocument) => void;
  const button = (name: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === name);
  const render = () => root.render(<ProcessMapSavedProcess apiBase={apiBase} companyID={companyID} processID={processID} onBusyChange={(value) => busy.push(value)} renderDetails={(canEdit, refreshVersion, _focusStepID, onStepBodyChange) => { updateStepBody = onStepBodyChange; return <div data-process-details={processID} data-can-edit={canEdit} data-refresh-version={refreshVersion}>Process assignments and SOP</div>; }} renderActions={({ createStep, disabled }) => <button type="button" disabled={disabled} onClick={createStep}>+ Create Step</button>} />);
  const refresh = async () => { await act(async () => dispatchLogicGateWorkUpdated(companyID, "first")); };
  try {
    await act(async () => render());
    await settle(() => button("+ Create Step")?.disabled === false, "saved map did not load");
    assert.equal(busy.at(-1), false);
    assert.equal(container.querySelector('[data-process-details="first"]')?.getAttribute("data-can-edit"), "true");
    updateRealtimeHealth(realtimeHealthKey(apiBase, companyID), { status: "connected" });
    const originalBodyCallback = updateStepBody;
    const previewBody: MangoTiptapDocument = { format: "mango-tiptap-json", schema_version: 1, document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Check the customer's delivery request." }] }] } };
    const requestsBeforePreview = [...requests];
    await act(async () => updateStepBody("first-step", previewBody));
    assert.equal(container.querySelector('[data-step-map-id="first-step"] .process-step-map__step-preview')?.textContent, "Check the customer's delivery request.");
    assert.equal(updateStepBody, originalBodyCallback, "preview callbacks remain stable across presentation updates");
    assert.equal(work.steps[0].body_json, undefined, "the editor callback must not mutate canonical work");
    assert.equal(getCachedProcessWork(apiBase, companyID, "first")?.contents.steps[0].body_json, undefined, "a pending instruction snapshot must not replace the shared saved cache");
    await act(async () => { updateStepBody("first-step", previewBody); updateStepBody("missing-step", previewBody); });
    assert.deepEqual(requests, requestsBeforePreview, "preview updates must not read layout/work or issue a save");
    assert.equal(busy.at(-1), false, "typing must not block the map behind a layout reload");
    savedStepX = 160;
    await refresh();
    await settle(() => container.querySelector<HTMLElement>('[data-step-map-id="first-step"]')?.style.left === "160px", "a canonical Process event must still reload changed layout with unchanged Step IDs");
    await act(async () => button("+ Create Step")!.click());
    await settle(() => Boolean(container.querySelector('[data-step-map-id="created"]')), "created Step did not refresh into saved map");
    work.permissions.can_edit = false;
    await refresh();
    await settle(() => button("+ Create Step")?.disabled === true, "refreshed permissions did not disable editing");
    assert.equal(container.querySelector('[data-process-details="first"]')?.getAttribute("data-can-edit"), "false", "assignment and SOP editing follows the refreshed Process permission");
    denied = true;
    await refresh();
    await settle(() => Boolean(button("Retry")), "denied Process did not show retry");
    assert.equal(container.querySelector('[data-step-map-id="first-step"]'), null);
    assert.equal(container.querySelector("[data-process-details]"), null, "denial removes assignments and SOP together with the map");
    assert.equal(getCachedProcessWork(apiBase, companyID, "first"), null);
    await act(async () => originalBodyCallback("first-step", previewBody));
    assert.equal(container.querySelector('[data-step-map-id="first-step"]'), null, "a late editor snapshot cannot restore denied contents");
    denied = false;
    work.permissions.can_edit = true;
    await act(async () => button("Retry")!.click());
    await settle(() => button("+ Create Step")?.disabled === false, "retry did not reload accessible Process");
    assert.equal(container.querySelector('[data-process-details="first"]')?.getAttribute("data-can-edit"), "true", "retry restores authorized assignments and SOP");
    await settle(() => sockets.some((socket) => socket.onmessage), "realtime subscription did not open");
    await act(async () => sockets.at(-1)!.onmessage?.({ data: JSON.stringify({ type: "subscription.rejected", scope: "process:first", error: "resource_not_found" }) }));
    await settle(() => container.textContent?.includes("This Process is unavailable.") === true, "subscription rejection left stale map visible");
    assert.equal(container.querySelector('[data-step-map-id="first-step"]'), null);
    assert.equal(container.querySelector("[data-process-details]"), null, "subscription rejection removes stale assignments and SOP");
    await act(async () => button("Retry")!.click());
    await settle(() => button("+ Create Step")?.disabled === false, "retry did not recover after subscription rejection");
    assert.ok(container.querySelector('[data-process-details="first"]'));
    pendingWork = new Promise((resolve) => { releaseWork = resolve; });
    await refresh();
    processID = "second";
    await act(async () => render());
    await settle(() => Boolean(container.querySelector('[data-step-map-id="second-step"]')), "navigation did not load the new Process");
    await act(async () => releaseWork(reply(work)));
    await settle(() => busy.at(-1) === false, "new Process never became ready");
    assert.equal(container.querySelector('[data-step-map-id="first-step"]'), null);
    assert.ok(container.querySelector('[data-step-map-id="second-step"]'));
    assert.equal(container.querySelector('[data-process-details="first"]'), null);
    assert.ok(container.querySelector('[data-process-details="second"]'), "late navigation reads cannot restore the previous Process details");
    assert.ok(requests.every((path) => !/saved-views|users|editor-json|\/nodes/.test(path)), "saved canvas must not load Board or SOP data");
  } finally {
    await act(async () => root.unmount());
    clearProcessWorkCache(apiBase, companyID, "first");
    clearProcessWorkCache(apiBase, companyID, "second");
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

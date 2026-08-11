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

test("RACI Tabs moves stay lazy and live changes refresh only visible branches", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  for (const name of ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement", "Event", "EventTarget", "MouseEvent", "FocusEvent", "CustomEvent"] as const) {
    const value = name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  const sockets: FakeWebSocket[] = [];
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = FakeWebSocket.CONNECTING;
    sent: string[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {
      sockets.push(this);
      queueMicrotask(() => {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({ type: "ready" }) });
        this.onmessage?.({ data: JSON.stringify({ type: "heartbeat.challenge", nonce: "raci-tabs-heartbeat" }) });
      });
    }
    send(message: string): void {
      this.sent.push(message);
      const parsed = JSON.parse(message) as { type?: string; scope?: string; nonce?: string };
      if (parsed.type === "subscribe" && parsed.scope) queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: parsed.scope }) }));
      if (parsed.type === "heartbeat.response") queueMicrotask(() => this.onmessage?.({ data: JSON.stringify({ type: "heartbeat.confirmed", nonce: parsed.nonce }) }));
    }
    close(): void { this.readyState = FakeWebSocket.CLOSED; this.onclose?.(); }
  }
  installGlobal("WebSocket", FakeWebSocket, restores);

  const companyID = "44444444-4444-4444-8444-444444444444";
  const folderID = "55555555-5555-4555-8555-555555555555";
  const firstGateID = "66666666-6666-4666-8666-666666666661";
  const secondGateID = "66666666-6666-4666-8666-666666666662";
  const moved = new Set<string>();
  const branchRequests: string[] = [];
  let layoutRequests = 0;

  const itemRow = (logicGateID: string, name: string, folder: string | null, position: number) => ({ row_kind: "item", item: {
    company_id: companyID, user_id: "77777777-7777-4777-8777-777777777777", role: "responsible",
    logic_gate_id: logicGateID, folder_id: folder, name, position,
    created_timestamp: "2026-08-10T00:00:00Z", updated_timestamp: "2026-08-10T00:00:00Z", status_counts: {},
  } });
  const folderRow = { row_kind: "folder", folder: {
    company_id: companyID, folder_id: folderID, user_id: "77777777-7777-4777-8777-777777777777",
    role: "responsible", parent_folder_id: null, name: "Destination", position: 3000,
    created_timestamp: "2026-08-10T00:00:00Z", updated_timestamp: "2026-08-10T00:00:00Z", has_children: true, status_counts: {},
  } };

  installGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const value = typeof input === "string" ? input : input.toString();
    const url = new URL(value, "http://localhost");
    if (url.pathname === "/v1/realtime/ticket") return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/v1/raci-tabs/layout") {
      layoutRequests += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as { entries?: Array<{ entry_type?: string; entry_id?: string; parent_folder_id?: string }> };
      for (const entry of body.entries ?? []) if (entry.entry_type === "item" && entry.parent_folder_id === folderID && entry.entry_id) moved.add(entry.entry_id);
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname !== "/v1/raci-tabs") return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    branchRequests.push(value);
    const parentFolderID = url.searchParams.get("parent_folder_id") ?? "";
    const rows = parentFolderID === folderID
      ? [firstGateID, secondGateID].filter((id) => moved.has(id)).map((id, index) => itemRow(id, id === firstGateID ? "First Gate" : "Second Gate", folderID, (index + 1) * 1000))
      : [
        ...(!moved.has(firstGateID) ? [itemRow(firstGateID, "First Gate", null, 1000)] : []),
        ...(!moved.has(secondGateID) ? [itemRow(secondGateID, "Second Gate", null, 2000)] : []),
        folderRow,
      ];
    return new Response(JSON.stringify({ role: "responsible", parent_folder_id: parentFolderID || null, rows, status_counts: {}, next_cursor: "" }), { status: 200, headers: { "content-type": "application/json" } });
  }, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { AppSidebarRACITabsSection }] = await Promise.all([
      import("react-dom/client"),
      import("../../../frontend/src/app/AppSidebarRACITabsSection.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => { root.render(<AppSidebarRACITabsSection apiBase="http://raci-live.test" companyID={companyID} onOpenLogicGate={() => undefined} />); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(branchRequests.length, 0, "collapsed roles must not read RACI branches");

    const responsible = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Responsible");
    assert.ok(responsible);
    await act(async () => { responsible.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(branchRequests.length, 1);

    const dragIntoDestination = async (logicGateID: string) => {
      const source = container.querySelector<HTMLElement>(`[data-raci-tab-row="item:${logicGateID}"]`);
      const destination = container.querySelector<HTMLElement>(`[data-raci-tab-row="folder:${folderID}"]`);
      assert.ok(source);
      assert.ok(destination);
      let dragPayloadWrites = 0;
      const dataTransfer = { effectAllowed: "move", setData: () => { dragPayloadWrites += 1; } };
      const dragStart = new dom.window.Event("dragstart", { bubbles: true, cancelable: true });
      Object.defineProperty(dragStart, "dataTransfer", { value: dataTransfer });
      const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
      const expectedLayoutRequests = layoutRequests + 1;
      await act(async () => { source.dispatchEvent(dragStart); await Promise.resolve(); });
      assert.equal(dragPayloadWrites, 1, "drag start must capture the existing row identity");
      await act(async () => {
        destination.dispatchEvent(drop);
        for (let attempt = 0; attempt < 20 && layoutRequests < expectedLayoutRequests; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      assert.equal(drop.defaultPrevented, true, "folder drop must reach the RACI Tabs drop handler");
    };

    await dragIntoDestination(firstGateID);
    assert.equal(layoutRequests, 1, container.querySelector('[role="alert"]')?.textContent ?? "layout request was not sent");
    assert.equal(branchRequests.filter((value) => value.includes("parent_folder_id=")).length, 0, "closed destination must not be preloaded or cached");
    assert.equal(container.querySelector(`[data-raci-tab-row="item:${firstGateID}"]`), null, "moved row leaves the visible source immediately");

    let folderButton = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Destination"]');
    assert.ok(folderButton);
    await act(async () => { folderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(branchRequests.filter((value) => value.includes(`parent_folder_id=${folderID}`)).length, 1, "opening destination performs a fresh read");
    assert.ok(container.querySelector(`[data-raci-tab-row="item:${firstGateID}"]`));

    await dragIntoDestination(secondGateID);
    assert.equal(layoutRequests, 2);
    assert.equal(branchRequests.filter((value) => value.includes(`parent_folder_id=${folderID}`)).length, 2, "open destination refreshes after a move");
    assert.ok(container.querySelector(`[data-raci-tab-row="item:${secondGateID}"]`));

    folderButton = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse Destination"]');
    assert.ok(folderButton);
    await act(async () => { folderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    const beforeCollapsedSignal = branchRequests.length;
    assert.ok(sockets[0]);
    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: "raci_tabs.changed", company_id: companyID, scope: "raci-tabs:company" }) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(branchRequests.length, beforeCollapsedSignal + 1, "only the still-expanded role root refreshes");
    assert.equal(branchRequests[branchRequests.length - 1].includes("parent_folder_id="), false);

    folderButton = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Destination"]');
    assert.ok(folderButton);
    await act(async () => { folderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(branchRequests.filter((value) => value.includes(`parent_folder_id=${folderID}`)).length, 3, "reopening changed collapsed destination reads fresh data");

    await act(async () => { responsible.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await Promise.resolve(); });
    const beforeFullyCollapsedSignal = branchRequests.length;
    await act(async () => {
      sockets[0].onmessage?.({ data: JSON.stringify({ type: "raci_tabs.changed", company_id: companyID, scope: "raci-tabs:company" }) });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(branchRequests.length, beforeFullyCollapsedSignal, "collapsed role makes no immediate branch request");
    await act(async () => { responsible.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(branchRequests.length, beforeFullyCollapsedSignal + 1, "reopening a changed role performs a fresh root read");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

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

test("Tower RACI Tabs start collapsed and fetch only an opened role and opened folder", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  for (const name of ["window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement", "Event", "EventTarget", "MouseEvent", "FocusEvent", "CustomEvent"] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  class SilentWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    readyState = SilentWebSocket.CONNECTING;
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(_url: string) {
      queueMicrotask(() => { this.readyState = SilentWebSocket.OPEN; this.onopen?.(); });
    }
    send(_message: string): void {}
    close(): void { this.readyState = SilentWebSocket.CLOSED; this.onclose?.(); }
  }
  installGlobal("WebSocket", SilentWebSocket, restores);

  const requests: string[] = [];
  installGlobal("fetch", async (input: string | URL | Request) => {
    const value = typeof input === "string" ? input : input.toString();
    requests.push(value);
    const url = new URL(value, "http://localhost");
    if (url.pathname === "/v1/realtime/ticket") {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    const parentFolderID = url.searchParams.get("parent_folder_id") ?? "";
    const rows = parentFolderID
      ? []
      : [{ row_kind: "folder", folder: {
        company_id: "11111111-1111-4111-8111-111111111111",
        folder_id: "22222222-2222-4222-8222-222222222222",
        user_id: "33333333-3333-4333-8333-333333333333",
        role: "responsible", parent_folder_id: null, name: "Personal", position: 1000,
        created_timestamp: "2026-08-10T00:00:00Z", updated_timestamp: "2026-08-10T00:00:00Z",
        has_children: true, status_counts: {},
      } }];
    return new Response(JSON.stringify({ role: "responsible", parent_folder_id: parentFolderID || null, rows, status_counts: {}, next_cursor: "" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
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
    await act(async () => {
      root.render(<AppSidebarRACITabsSection apiBase="http://api.test" companyID="11111111-1111-4111-8111-111111111111" onOpenLogicGate={() => undefined} />);
      await Promise.resolve();
    });

    const roleButtons = Array.from(container.querySelectorAll("button")).filter((button) => ["Responsible", "Accountable", "Consulted", "Informed"].includes(button.textContent?.trim() ?? ""));
    assert.deepEqual(roleButtons.map((button) => button.textContent?.trim()), ["Responsible", "Accountable", "Consulted", "Informed"]);
    assert.deepEqual(roleButtons.map((button) => button.getAttribute("aria-expanded")), ["false", "false", "false", "false"]);
    assert.equal(roleButtons[0].parentElement?.style.gridTemplateColumns, "minmax(0,1fr) 74px 22px", "role totals and the add action use the same columns as Logic Gate rows");
    assert.equal(container.querySelectorAll('button[aria-label^="Create "][aria-label$=" folder"]').length, 4, "every collapsed role exposes its root-folder action in the header");
    assert.equal(requests.filter((value) => value.includes("/v1/raci-tabs?")).length, 0);

    await act(async () => {
      roleButtons[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const firstBranchRequests = requests.filter((value) => value.includes("/v1/raci-tabs?"));
    assert.equal(firstBranchRequests.length, 1);
    assert.match(firstBranchRequests[0], /role=responsible/);
    assert.doesNotMatch(firstBranchRequests[0], /parent_folder_id=/);
    assert.equal(container.querySelector('[data-raci-tab-surface="responsible"] button[aria-label="Create Responsible folder"]'), null, "the expanded surface has no separate empty add-folder row");

    const folderButton = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Personal"]');
    assert.ok(folderButton);
    await act(async () => {
      folderButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const branchRequests = requests.filter((value) => value.includes("/v1/raci-tabs?"));
    assert.equal(branchRequests.length, 2);
    assert.match(branchRequests[1], /parent_folder_id=22222222-2222-4222-8222-222222222222/);
    assert.equal(requests.filter((value) => /role=(accountable|consulted|informed)/.test(value)).length, 0);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

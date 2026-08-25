import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";

import { EXPLORER_DRAG_MIME } from "../../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import {
  realtimeHealthKey,
  updateRealtimeHealth,
} from "../../../../frontend/src/modules/realtime/realtimeHealth.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]): void {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

async function flushUI(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

test("Process Map renders one exact lazy layer and keeps navigation on Folder double-click only", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/process-map/folders/parent-1",
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "SVGElement", "Event",
    "EventTarget", "MouseEvent", "PointerEvent", "WheelEvent", "CustomEvent", "getComputedStyle", "localStorage",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : name === "getComputedStyle"
          ? dom.window.getComputedStyle.bind(dom.window)
          : (dom.window as unknown as Record<string, unknown>)[name];
    if (value !== undefined) installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  installGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0), restores);
  installGlobal("cancelAnimationFrame", (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer), restores);
  class IdentityDOMMatrixReadOnly { readonly m22 = 1; }
  Object.defineProperty(dom.window, "DOMMatrixReadOnly", { configurable: true, value: IdentityDOMMatrixReadOnly });
  installGlobal("DOMMatrixReadOnly", IdentityDOMMatrixReadOnly, restores);

  const originalHTMLElementRect = dom.window.HTMLElement.prototype.getBoundingClientRect;
  const originalSVGRect = dom.window.SVGElement.prototype.getBoundingClientRect;
  const surfaceRect = {
    x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600,
    toJSON: () => ({}),
  };
  dom.window.HTMLElement.prototype.getBoundingClientRect = () => surfaceRect;
  dom.window.SVGElement.prototype.getBoundingClientRect = () => surfaceRect;
  for (const [name, value] of [["clientWidth", 900], ["clientHeight", 600], ["offsetWidth", 900], ["offsetHeight", 600]] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(dom.window.HTMLElement.prototype, name);
    Object.defineProperty(dom.window.HTMLElement.prototype, name, { configurable: true, get: () => value });
    restores.push(() => {
      if (descriptor) Object.defineProperty(dom.window.HTMLElement.prototype, name, descriptor);
      else delete (dom.window.HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    });
  }
  restores.push(() => {
    dom.window.HTMLElement.prototype.getBoundingClientRect = originalHTMLElementRect;
    dom.window.SVGElement.prototype.getBoundingClientRect = originalSVGRect;
  });

  class ImmediateResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element): void {
      queueMicrotask(() => this.callback([{
        target,
        contentRect: surfaceRect,
        borderBoxSize: [],
        contentBoxSize: [],
        devicePixelContentBoxSize: [],
      } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver));
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  installGlobal("ResizeObserver", ImmediateResizeObserver, restores);

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
    close(): void { this.readyState = SilentWebSocket.CLOSED; }
  }
  installGlobal("WebSocket", SilentWebSocket, restores);

  const requests: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  let placementAdded = false;
  installGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({ url, method, body });
    if (url.pathname === "/v1/realtime/ticket") {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.includes("/placements/")) {
      placementAdded = true;
      return new Response(JSON.stringify({
        resource_type: "logic_gate",
        resource_id: "added-gate",
        map_parent_folder_id: "parent-1",
        grid_x: body?.grid_x,
        grid_y: body?.grid_y,
        revision: 1,
        created_timestamp: "created",
        updated_timestamp: "created",
      }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({
      layer: { kind: "folder", folder_id: "parent-1", name: "Parent" },
      placements: [
        {
          restricted: false,
          resource_type: "company_explorer_folder",
          resource_id: "child-1",
          name: "Child",
          grid_x: 1,
          grid_y: 2,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        },
        {
          restricted: false,
          resource_type: "logic_gate",
          resource_id: "gate-1",
          name: "Review",
          grid_x: 9,
          grid_y: 2,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        },
        { restricted: true, grid_x: 16, grid_y: 2 },
        ...(placementAdded ? [{
          restricted: false,
          resource_type: "logic_gate",
          resource_id: "added-gate",
          name: "Added process",
          grid_x: 10,
          grid_y: 7,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        }] : []),
      ],
      traces: [],
    }), { status: 200, headers: { "content-type": "application/json", etag: "\"viewer-1\"" } });
  }, restores);

  let mountedRoot: { unmount(): void } | null = null;
  const openedFolders: string[] = [];
  try {
    const [{ createRoot }, { ProcessMapSurface }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/process-map/ProcessMapSurface.tsx"),
    ]);
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => {
      root.render(
        <ProcessMapSurface
          apiBase="http://api.test"
          companyID="company-1"
          folderID="parent-1"
          onOpenFolder={(folderID) => openedFolders.push(folderID)}
        />,
      );
      await flushUI();
      await flushUI();
    });

    const layerRequests = requests.filter((request) => request.url.pathname === "/v1/process-map/layer");
    assert.equal(layerRequests.length, 1);
    assert.deepEqual(Object.fromEntries(layerRequests[0].url.searchParams), {
      company_id: "company-1",
      folder_id: "parent-1",
    });
    assert.equal(requests.some((request) => /company-explorer\/(tree|graph)|logic-gate-relationships/.test(request.url.pathname)), false);

    const folderCard = container.querySelector<HTMLElement>('[aria-label="Folder: Child"]');
    const processCard = container.querySelector<HTMLElement>('[aria-label="Process: Review"]');
    const restrictedCard = container.querySelector<HTMLElement>('[aria-label="?"]');
    assert.ok(folderCard);
    assert.ok(processCard);
    assert.ok(restrictedCard);
    assert.equal(restrictedCard.textContent, "?");
    assert.equal(restrictedCard.querySelectorAll(".react-flow__handle").length, 0);
    assert.equal(restrictedCard.closest(".react-flow__node")?.classList.contains("selectable"), false);
    assert.equal(restrictedCard.closest(".react-flow__node")?.classList.contains("draggable"), false);

    await act(async () => {
      folderCard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    assert.equal(openedFolders.length, 0, "single click selects without navigation");
    assert.equal(container.querySelector(".process-map-toolbar button")?.textContent, "Remove Child");

    await act(async () => {
      folderCard.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      processCard.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      const pane = container.querySelector<HTMLElement>(".react-flow__pane");
      assert.ok(pane);
      pane.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, deltaY: -10 }));
      pane.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      await flushUI();
    });
    assert.deepEqual(openedFolders, ["child-1"], "only Folder double-click drills in; Process and viewport gestures do not");

    const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      clientX: { value: 280 },
      clientY: { value: 196 },
      dataTransfer: { value: {
        types: [EXPLORER_DRAG_MIME],
        dropEffect: "copy",
        getData: (type: string) => type === EXPLORER_DRAG_MIME
          ? JSON.stringify({ kind: "logic_gate", itemID: "added-gate", itemType: "logic_gate" })
          : "",
      } },
    });
    const surface = container.querySelector<HTMLElement>(".process-map-surface");
    assert.ok(surface);
    updateRealtimeHealth(realtimeHealthKey("http://api.test", "company-1"), { status: "connected" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      surface.dispatchEvent(drop);
      await flushUI();
      await flushUI();
    });
    assert.equal(drop.defaultPrevented, true, "the Process Map owns exact Explorer drops");
    const placementWrite = requests.find((request) => request.url.pathname.endsWith("/placements/logic_gate/added-gate"));
    assert.ok(placementWrite, JSON.stringify(requests.map((request) => ({ path: request.url.pathname, method: request.method }))));
    assert.equal(placementWrite.method, "PUT");
    assert.equal(placementWrite.body?.map_parent_folder_id, "parent-1");
    assert.ok(container.querySelector('[aria-label="Process: Added process"]'));
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

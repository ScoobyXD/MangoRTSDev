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

  let realtimeSocket: SilentWebSocket | null = null;
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
      realtimeSocket = this;
      queueMicrotask(() => {
        this.readyState = SilentWebSocket.OPEN;
        this.onopen?.();
        this.onmessage?.({ data: JSON.stringify({
          type: "ready",
          connection_id: "surface-connection-1",
          connection_correlation: "surface-correlation-1",
        }) });
      });
    }
    send(_message: string): void {}
    close(): void { this.readyState = SilentWebSocket.CLOSED; }
  }
  installGlobal("WebSocket", SilentWebSocket, restores);

  const requests: Array<{ url: URL; method: string; body?: Record<string, unknown>; originConnectionID: string | null }> = [];
  let placementAdded = false;
  let placementDeleted = false;
  let placementRecreated = false;
  let delayedPlacementRestricted = false;
  let catchupPlacementVisible = false;
  let mixedPlacementPresent = true;
  let traceRecreated = false;
  let deferNextTracePut = false;
  let finishPlacementDelete: (() => void) | null = null;
  let finishDelayedPlacementPut: (() => void) | null = null;
  let finishNavigationPlacementPut: (() => void) | null = null;
  let finishNavigationLayerRead: (() => void) | null = null;
  let finishMixedPlacementDelete: (() => void) | null = null;
  let finishMixedPlacementPut: (() => void) | null = null;
  let finishDeferredTracePut: (() => void) | null = null;
  let permissionLayerReadCount = 0;
  let finishOldPermissionLayerRead: (() => void) | null = null;
  let finishReplacementPermissionLayerRead: (() => void) | null = null;
  const traceWrites: Array<Record<string, unknown>> = [];
  installGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString(), "http://localhost");
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    requests.push({
      url,
      method,
      body,
      originConnectionID: new Headers(init?.headers).get("X-Mango-Realtime-Connection-ID"),
    });
    if (url.pathname === "/v1/realtime/ticket") {
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname.endsWith("/operational-relationships/trace-1/trace") && method === "PUT") {
      traceWrites.push(body ?? {});
      const responseRevision = deferNextTracePut ? 9 : traceWrites.length + 1;
      const response = () => new Response(JSON.stringify({
        resource_operational_relationship_id: "trace-1",
        route_points: body?.route_points,
        revision: responseRevision,
        created_timestamp: "created",
        updated_timestamp: "updated",
      }), { status: 200, headers: { "content-type": "application/json" } });
      if (deferNextTracePut) {
        deferNextTracePut = false;
        return await new Promise<Response>((resolve) => {
          finishDeferredTracePut = () => resolve(response());
        });
      }
      return response();
    }
    if (url.pathname.endsWith("/placements/logic_gate/mixed-gate") && method === "DELETE") {
      return await new Promise<Response>((resolve) => {
        finishMixedPlacementDelete = () => resolve(new Response(null, { status: 204 }));
      });
    }
    if (url.pathname.includes("/placements/") && method === "DELETE") {
      return await new Promise<Response>((resolve) => {
        finishPlacementDelete = () => {
          if (!placementRecreated) placementDeleted = true;
          resolve(new Response(null, { status: 204 }));
        };
      });
    }
    if (url.pathname.endsWith("/placements/logic_gate/navigation-gate")) {
      return await new Promise<Response>((resolve) => {
        finishNavigationPlacementPut = () => resolve(new Response(JSON.stringify({
          resource_type: "logic_gate",
          resource_id: "navigation-gate",
          map_parent_folder_id: "parent-1",
          grid_x: body?.grid_x,
          grid_y: body?.grid_y,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        }), { status: 201, headers: { "content-type": "application/json" } }));
      });
    }
    if (url.pathname.endsWith("/placements/logic_gate/mixed-gate")) {
      return await new Promise<Response>((resolve) => {
        finishMixedPlacementPut = () => {
          mixedPlacementPresent = true;
          resolve(new Response(JSON.stringify({
            resource_type: "logic_gate",
            resource_id: "mixed-gate",
            map_parent_folder_id: "catchup-folder",
            grid_x: body?.grid_x,
            grid_y: body?.grid_y,
            revision: 2,
            created_timestamp: "created",
            updated_timestamp: "recreated",
          }), { status: 200, headers: { "content-type": "application/json" } }));
        };
      });
    }
    if (url.pathname.endsWith("/placements/logic_gate/delayed-gate")) {
      return await new Promise<Response>((resolve) => {
        finishDelayedPlacementPut = () => resolve(new Response(JSON.stringify({
          resource_type: "logic_gate",
          resource_id: "delayed-gate",
          map_parent_folder_id: "parent-1",
          grid_x: body?.grid_x,
          grid_y: body?.grid_y,
          revision: 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        }), { status: 201, headers: { "content-type": "application/json" } }));
      });
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
    if (url.pathname === "/v1/process-map/layer" && url.searchParams.get("folder_id") === "navigation-folder") {
      return await new Promise<Response>((resolve) => {
        finishNavigationLayerRead = () => resolve(new Response(JSON.stringify({
          layer: { kind: "folder", folder_id: "navigation-folder", name: "Navigation target" },
          placements: [{
            restricted: false,
            resource_type: "logic_gate",
            resource_id: "navigation-target-gate",
            name: "Navigation target process",
            grid_x: 3,
            grid_y: 4,
            revision: 1,
            created_timestamp: "created",
            updated_timestamp: "created",
          }],
          traces: [],
        }), { status: 200, headers: { "content-type": "application/json" } }));
      });
    }
    if (url.pathname === "/v1/process-map/layer" && url.searchParams.get("folder_id") === "catchup-folder") {
      return new Response(JSON.stringify({
        layer: { kind: "folder", folder_id: "catchup-folder", name: "Catch-up" },
        placements: [
          ...(catchupPlacementVisible ? [{
            restricted: false,
            resource_type: "logic_gate",
            resource_id: "catchup-gate",
            name: "Missed during subscribe",
            grid_x: 5,
            grid_y: 5,
            revision: 1,
            created_timestamp: "created",
            updated_timestamp: "created",
          }] : []),
          ...(mixedPlacementPresent ? [{
            restricted: false,
            resource_type: "logic_gate",
            resource_id: "mixed-gate",
            name: "Mixed final process",
            grid_x: 12,
            grid_y: 5,
            revision: 2,
            created_timestamp: "created",
            updated_timestamp: "recreated",
          }] : []),
        ],
        traces: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/v1/process-map/layer" && url.searchParams.get("folder_id") === "permission-hint-folder") {
      permissionLayerReadCount += 1;
      return await new Promise<Response>((resolve) => {
        if (permissionLayerReadCount === 1) {
          finishOldPermissionLayerRead = () => resolve(new Response(JSON.stringify({
            layer: { kind: "folder", folder_id: "permission-hint-folder", name: "Permission hint" },
            placements: [{
              restricted: false,
              resource_type: "logic_gate",
              resource_id: "old-permission-gate",
              name: "Old pre-hint process",
              grid_x: 4,
              grid_y: 4,
              revision: 1,
              created_timestamp: "created",
              updated_timestamp: "created",
            }],
            traces: [],
          }), { status: 200, headers: { "content-type": "application/json" } }));
          return;
        }
        finishReplacementPermissionLayerRead = () => resolve(new Response(JSON.stringify({
          layer: { kind: "folder", folder_id: "permission-hint-folder", name: "Permission hint" },
          placements: [{ restricted: true, grid_x: 4, grid_y: 4 }],
          traces: [],
        }), { status: 200, headers: { "content-type": "application/json" } }));
      });
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
        ...(!placementDeleted ? [{
          restricted: false,
          resource_type: "logic_gate",
          resource_id: "gate-1",
          name: placementRecreated ? "Review recreated" : "Review",
          grid_x: 9,
          grid_y: 2,
          revision: placementRecreated ? 2 : 1,
          created_timestamp: "created",
          updated_timestamp: "created",
        }] : []),
        { restricted: true, grid_x: 16, grid_y: 2 },
        ...(delayedPlacementRestricted ? [{ restricted: true, grid_x: 22, grid_y: 7 }] : []),
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
      traces: [{
        resource_operational_relationship_id: "trace-1",
        source: { resource_type: "company_explorer_folder", resource_id: "child-1" },
        target: { resource_type: "logic_gate", resource_id: "gate-1" },
        route_points: traceRecreated ? [{ x: 9, y: 8 }] : [{ x: 7, y: 5 }],
        revision: 1,
        created_timestamp: "created",
        updated_timestamp: "created",
      }],
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
    const readsBeforeAdmission = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "process-map:company" }) });
      await flushUI();
      await flushUI();
      realtimeSocket?.onmessage?.({ data: JSON.stringify({ type: "heartbeat.confirmed", nonce: "process-map-ready" }) });
      await flushUI();
      await flushUI();
    });
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      readsBeforeAdmission + 1,
      "subscription admission and recovery share one canonical catch-up read",
    );
    updateRealtimeHealth(realtimeHealthKey("http://api.test", "company-1"), { status: "connected" });

    const traceEdge = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(traceEdge);
    await act(async () => {
      traceEdge.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const waypoint = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(waypoint);
    const startingWaypointTransform = waypoint.style.transform;
    await act(async () => {
      waypoint.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 10, clientX: 182, clientY: 126 }));
      waypoint.dispatchEvent(new dom.window.PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 10, clientX: 322, clientY: 266 }));
      await flushUI();
    });
    const movedWaypoint = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(movedWaypoint);
    assert.notEqual(movedWaypoint.style.transform, startingWaypointTransform, "waypoint movement previews locally");
    await act(async () => {
      movedWaypoint.dispatchEvent(new dom.window.PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: 10, clientX: 490, clientY: 406 }));
      movedWaypoint.dispatchEvent(new dom.window.PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 10, clientX: 602, clientY: 518 }));
      await flushUI();
    });
    const restoredWaypoint = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(restoredWaypoint);
    assert.equal(restoredWaypoint.style.transform, startingWaypointTransform, "pointer cancel restores the starting route and removes movement listeners");
    assert.equal(traceWrites.length, 0, "pointer cancel does not save the preview route");
    for (const pointerID of [11, 12]) {
      await act(async () => {
        restoredWaypoint.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: pointerID, clientX: 182, clientY: 126 }));
        restoredWaypoint.dispatchEvent(new dom.window.PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: pointerID, clientX: 182, clientY: 126 }));
        await flushUI();
      });
    }
    const traceAfterClicks = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(traceAfterClicks);
    await act(async () => {
      traceAfterClicks.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const waypointAfterClicks = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(waypointAfterClicks);
    await act(async () => {
      waypointAfterClicks.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      await flushUI();
      await flushUI();
    });
    assert.equal(traceWrites.length, 1, `a no-move double-click performs only the waypoint-removal PUT: ${JSON.stringify(traceWrites)}`);
    assert.deepEqual(traceWrites[0].route_points, []);

    deferNextTracePut = true;
    const traceForDeferredEdit = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(traceForDeferredEdit);
    await act(async () => {
      traceForDeferredEdit.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 238, clientY: 210 }));
      await flushUI();
    });
    assert.ok(finishDeferredTracePut, "the trace edit acknowledgement remains pending");
    traceRecreated = true;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "trace-recreated-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    const recreatedTraceEdge = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(recreatedTraceEdge);
    await act(async () => {
      recreatedTraceEdge.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const recreatedWaypoint = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(recreatedWaypoint);
    const recreatedWaypointTransform = recreatedWaypoint.style.transform;
    const readsBeforeTraceAck = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    const completeDeferredTrace = finishDeferredTracePut;
    await act(async () => {
      completeDeferredTrace();
      await flushUI();
      await flushUI();
      await flushUI();
    });
    const recoveredTraceEdge = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(recoveredTraceEdge);
    await act(async () => {
      recoveredTraceEdge.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    assert.equal(
      container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]')?.style.transform,
      recreatedWaypointTransform,
      "a delayed trace ACK cannot overwrite a canonically recreated relationship with reset revision",
    );
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      readsBeforeTraceAck + 1,
      "a superseded trace acknowledgement performs one bounded canonical recovery read",
    );

    const gestureWaypoint = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(gestureWaypoint);
    const writesBeforeGestureRefresh = traceWrites.length;
    await act(async () => {
      gestureWaypoint.dispatchEvent(new dom.window.PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 13, clientX: 238, clientY: 210 }));
      gestureWaypoint.dispatchEvent(new dom.window.PointerEvent("pointermove", { bubbles: true, cancelable: true, pointerId: 13, clientX: 350, clientY: 322 }));
      await flushUI();
    });
    assert.notEqual(
      container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]')?.style.transform,
      recreatedWaypointTransform,
      "the active waypoint gesture previews before refresh",
    );
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "gesture-refresh-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    const edgeAfterGestureRefresh = container.querySelector<HTMLElement>(".react-flow__edge");
    assert.ok(edgeAfterGestureRefresh);
    await act(async () => {
      edgeAfterGestureRefresh.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const canonicalWaypointAfterGestureRefresh = container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]');
    assert.ok(canonicalWaypointAfterGestureRefresh);
    const canonicalTransformAfterGestureRefresh = canonicalWaypointAfterGestureRefresh.style.transform;
    await act(async () => {
      gestureWaypoint.dispatchEvent(new dom.window.PointerEvent("pointercancel", { bubbles: true, cancelable: true, pointerId: 13, clientX: 490, clientY: 406 }));
      await flushUI();
    });
    assert.equal(
      container.querySelector<HTMLButtonElement>('[aria-label="Trace waypoint 1"]')?.style.transform,
      canonicalTransformAfterGestureRefresh,
      "cancel from a pre-refresh gesture cannot restore stale route geometry",
    );
    assert.equal(traceWrites.length, writesBeforeGestureRefresh, "a refresh-cancelled waypoint gesture performs no PUT");

    const refreshedFolderCard = container.querySelector<HTMLElement>('[aria-label="Folder: Child"]');
    const refreshedProcessCard = container.querySelector<HTMLElement>('[aria-label="Process: Review"]');
    assert.ok(refreshedFolderCard);
    assert.ok(refreshedProcessCard);
    await act(async () => {
      refreshedFolderCard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    assert.equal(openedFolders.length, 0, "single click selects without navigation");
    assert.equal(container.querySelector(".process-map-toolbar button")?.textContent, "Remove Child");

    await act(async () => {
      refreshedFolderCard.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      refreshedProcessCard.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      const pane = container.querySelector<HTMLElement>(".react-flow__pane");
      assert.ok(pane);
      pane.dispatchEvent(new dom.window.WheelEvent("wheel", { bubbles: true, deltaY: -10 }));
      pane.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));
      await flushUI();
    });
    assert.deepEqual(openedFolders, ["child-1"], "only Folder double-click drills in; Process and viewport gestures do not");

    const readsBeforeSuccessfulDrop = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    const drop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      clientX: { value: 280 },
      clientY: { value: 196 },
      dataTransfer: { value: {
        types: [EXPLORER_DRAG_MIME],
        dropEffect: "copy",
        getData: (type: string) => type === EXPLORER_DRAG_MIME
          ? JSON.stringify({ kind: "logic_gate", label: "Added process", itemID: "added-gate", itemType: "logic_gate" })
          : "",
      } },
    });
    const surface = container.querySelector<HTMLElement>(".process-map-surface");
    assert.ok(surface);
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
    assert.equal(placementWrite.originConnectionID, "surface-correlation-1");
    assert.ok(container.querySelector('[aria-label="Process: Added process"]'));
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      readsBeforeSuccessfulDrop,
      "a successful placement response updates the mounted layer without reloading it",
    );
    const layerReadCount = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "surface-connection-1",
      }) });
      await flushUI();
    });
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      layerReadCount,
      "the initiating connection ignores only its exact echoed hint",
    );
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "another-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      layerReadCount + 1,
      "a hint from every other connection still reloads the exact mounted layer",
    );

    const reviewCard = container.querySelector<HTMLElement>('[aria-label="Process: Review"]');
    assert.ok(reviewCard);
    await act(async () => {
      reviewCard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const removeButton = [...container.querySelectorAll<HTMLButtonElement>(".process-map-toolbar button")]
      .find((button) => button.textContent === "Remove Review");
    assert.ok(removeButton);
    await act(async () => {
      removeButton.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    assert.equal(container.querySelector('[aria-label="Process: Review"]'), null, "placement deletion starts optimistically");
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "delete-race-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    placementRecreated = true;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "placement-recreated-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Review recreated"]'), "a newer remote recreation supersedes the pending delete");
    const readsBeforeDeleteCommit = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    const completeDelete = finishPlacementDelete;
    assert.ok(completeDelete);
    await act(async () => {
      completeDelete();
      await flushUI();
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Review recreated"]'), "a delayed delete acknowledgement cannot remove a newer recreation");
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      readsBeforeDeleteCommit + 1,
      "a superseded delete acknowledgement performs one bounded canonical recovery read",
    );
    const placementDelete = requests.find((request) => request.method === "DELETE" && request.url.pathname.endsWith("/placements/logic_gate/gate-1"));
    assert.equal(placementDelete?.originConnectionID, "surface-correlation-1");

    const delayedDrop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(delayedDrop, {
      clientX: { value: 560 },
      clientY: { value: 280 },
      dataTransfer: { value: {
        types: [EXPLORER_DRAG_MIME],
        dropEffect: "copy",
        getData: (type: string) => type === EXPLORER_DRAG_MIME
          ? JSON.stringify({ kind: "logic_gate", label: "Permission-hidden process", itemID: "delayed-gate", itemType: "logic_gate" })
          : "",
      } },
    });
    const readsBeforeDelayedDrop = requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length;
    await act(async () => {
      surface.dispatchEvent(delayedDrop);
      await flushUI();
    });
    assert.ok(finishDelayedPlacementPut, "the Explorer placement write remains pending for the permission race");
    delayedPlacementRestricted = true;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "permission-change-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    assert.equal(container.querySelector('[aria-label="Process: Permission-hidden process"]'), null);
    assert.equal(container.querySelectorAll('[aria-label="?"]').length, 2, "the canonical permission response exposes only opaque placeholders");
    const completeDelayedPlacement = finishDelayedPlacementPut;
    await act(async () => {
      completeDelayedPlacement();
      await flushUI();
      await flushUI();
      await flushUI();
    });
    assert.equal(container.querySelector('[aria-label="Process: Permission-hidden process"]'), null, "a delayed placement response cannot restore a name after permission invalidation");
    assert.equal(container.querySelectorAll('[aria-label="?"]').length, 2);
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer").length,
      readsBeforeDelayedDrop + 2,
      "the permission hint and superseded write each perform one bounded canonical layer read",
    );

    const navigationDrop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(navigationDrop, {
      clientX: { value: 700 },
      clientY: { value: 336 },
      dataTransfer: { value: {
        types: [EXPLORER_DRAG_MIME],
        dropEffect: "copy",
        getData: (type: string) => type === EXPLORER_DRAG_MIME
          ? JSON.stringify({ kind: "logic_gate", label: "Navigation source write", itemID: "navigation-gate", itemType: "logic_gate" })
          : "",
      } },
    });
    await act(async () => {
      surface.dispatchEvent(navigationDrop);
      await flushUI();
    });
    assert.ok(finishNavigationPlacementPut, "the source-layer write remains pending during navigation");
    await act(async () => {
      root.render(
        <ProcessMapSurface
          apiBase="http://api.test"
          companyID="company-1"
          folderID="navigation-folder"
          onOpenFolder={(folderID) => openedFolders.push(folderID)}
        />,
      );
      await flushUI();
    });
    assert.ok(finishNavigationLayerRead, "the newly navigated layer read is in flight");
    const completeNavigationPlacement = finishNavigationPlacementPut;
    await act(async () => {
      completeNavigationPlacement();
      await flushUI();
    });
    const completeNavigationLayer = finishNavigationLayerRead;
    await act(async () => {
      completeNavigationLayer();
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Navigation target process"]'), "a source-layer write completion cannot abort the newly navigated layer read");
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer" && request.url.searchParams.get("folder_id") === "navigation-folder").length,
      1,
    );

    await act(async () => {
      root.render(
        <ProcessMapSurface
          apiBase="http://api.test"
          companyID="company-1"
          folderID="catchup-folder"
          onOpenFolder={(folderID) => openedFolders.push(folderID)}
        />,
      );
      await flushUI();
      await flushUI();
    });
    assert.equal(container.querySelector('[aria-label="Process: Missed during subscribe"]'), null, "the first snapshot predates the missed event");
    catchupPlacementVisible = true;
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({ type: "subscription.accepted", scope: "process-map:company" }) });
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Missed during subscribe"]'), "subscription acceptance performs one canonical catch-up read");
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer" && request.url.searchParams.get("folder_id") === "catchup-folder").length,
      2,
    );
    updateRealtimeHealth(realtimeHealthKey("http://api.test", "company-1"), { status: "connected" });

    const mixedCard = container.querySelector<HTMLElement>('[aria-label="Process: Mixed final process"]');
    assert.ok(mixedCard);
    await act(async () => {
      mixedCard.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
      await flushUI();
    });
    const removeMixedButton = [...container.querySelectorAll<HTMLButtonElement>(".process-map-toolbar button")]
      .find((button) => button.textContent === "Remove Mixed final process");
    assert.ok(removeMixedButton);
    await act(async () => {
      removeMixedButton.click();
      await flushUI();
      await flushUI();
    });
    assert.ok(finishMixedPlacementDelete, "the older placement delete remains pending");
    assert.equal(container.querySelector('[aria-label="Process: Mixed final process"]'), null);
    mixedPlacementPresent = false;
    const mixedDrop = new dom.window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(mixedDrop, {
      clientX: { value: 420 },
      clientY: { value: 392 },
      dataTransfer: { value: {
        types: [EXPLORER_DRAG_MIME],
        dropEffect: "copy",
        getData: (type: string) => type === EXPLORER_DRAG_MIME
          ? JSON.stringify({ kind: "logic_gate", label: "Mixed final process", itemID: "mixed-gate", itemType: "logic_gate" })
          : "",
      } },
    });
    const catchupReadsBeforeMixedResponses = requests.filter((request) => request.url.pathname === "/v1/process-map/layer" && request.url.searchParams.get("folder_id") === "catchup-folder").length;
    const catchupSurface = container.querySelector<HTMLElement>(".process-map-surface");
    assert.ok(catchupSurface);
    await act(async () => {
      catchupSurface.dispatchEvent(mixedDrop);
      await flushUI();
    });
    assert.ok(finishMixedPlacementPut, "the newer placement PUT remains pending");
    const completeMixedPut = finishMixedPlacementPut;
    await act(async () => {
      completeMixedPut();
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Mixed final process"]'), "the last committed PUT is applied locally");
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer" && request.url.searchParams.get("folder_id") === "catchup-folder").length,
      catchupReadsBeforeMixedResponses,
      "the normal successful PUT performs no layer GET",
    );
    const completeMixedDelete = finishMixedPlacementDelete;
    await act(async () => {
      completeMixedDelete();
      await flushUI();
      await flushUI();
      await flushUI();
    });
    assert.ok(container.querySelector('[aria-label="Process: Mixed final process"]'), "the older delayed DELETE acknowledgement cannot override the newer PUT");
    assert.equal(
      requests.filter((request) => request.url.pathname === "/v1/process-map/layer" && request.url.searchParams.get("folder_id") === "catchup-folder").length,
      catchupReadsBeforeMixedResponses + 1,
      "the superseded mixed-operation acknowledgement performs one bounded canonical read",
    );

    await act(async () => {
      root.render(
        <ProcessMapSurface
          apiBase="http://api.test"
          companyID="company-1"
          folderID="permission-hint-folder"
          onOpenFolder={(folderID) => openedFolders.push(folderID)}
        />,
      );
      await flushUI();
    });
    assert.ok(finishOldPermissionLayerRead, "the pre-hint layer response remains pending");
    await act(async () => {
      realtimeSocket?.onmessage?.({ data: JSON.stringify({
        type: "process_map.changed",
        company_id: "company-1",
        scope: "process-map:company",
        origin_connection_id: "permission-hint-connection",
      }) });
      await flushUI();
      await flushUI();
    });
    assert.ok(finishReplacementPermissionLayerRead, "the permission hint starts a separate canonical replacement read");
    const completeOldPermissionLayer = finishOldPermissionLayerRead;
    await act(async () => {
      completeOldPermissionLayer();
      await flushUI();
      await flushUI();
    });
    assert.equal(
      container.querySelector('[aria-label="Process: Old pre-hint process"]'),
      null,
      "a pre-hint response cannot render while the canonical replacement is pending",
    );
    const completeReplacementPermissionLayer = finishReplacementPermissionLayerRead;
    await act(async () => {
      completeReplacementPermissionLayer();
      await flushUI();
      await flushUI();
    });
    assert.equal(container.querySelector('[aria-label="Process: Old pre-hint process"]'), null);
    assert.equal(container.querySelectorAll('[aria-label="?"]').length, 1);
    assert.equal(permissionLayerReadCount, 2);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

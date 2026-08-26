import assert from "node:assert/strict";
import test from "node:test";
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

test("the shared Logic Gate Q/D tracker renders 31 slices and reconciles a committed choice", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "Event", "EventTarget", "MouseEvent", "FocusEvent", "CustomEvent",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const exactObservers: TestIntersectionObserver[] = [];
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds = [0];
    private target: Element | null = null;
    constructor(private readonly callback: IntersectionObserverCallback) { exactObservers.push(this); }
    observe(target: Element) {
      this.target = target;
      this.trigger(false);
    }
    unobserve() { this.target = null; }
    disconnect() { this.target = null; }
    takeRecords() { return []; }
    trigger(visible: boolean) {
      if (!this.target) return;
      this.callback([{ target: this.target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
  }
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { LogicGateQDTracker }, qdApi] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/logic-gates/LogicGateQDTracker.js"),
      import("../../../../frontend/src/modules/logic-gates/qdRatingsApi.js"),
    ]);
    qdApi.clearQDRatingsCache();
    const businessDate = qdApi.getQDBusinessDate();
    const requests: Array<{ path: string; method: string; json?: unknown }> = [];
    const requestJSON = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      const method = init?.method ?? "GET";
      requests.push({ path, method, json: init?.json });
      if (method === "GET") return { qd_ratings: [] } as T;
      return {
        qd_rating: {
          company_id: "company-1",
          qd_rating_id: "rating-1",
          logic_gate_id: "gate-1",
          quality_rating: "green",
          delivery_rating: null,
          rated_by_user_id: "user-1",
          rated_by_display_name: "Avery Stone",
          rated_created_timestamp: new Date().toISOString(),
          rated_updated_timestamp: new Date().toISOString(),
        },
      } as T;
    };
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(
      <>
        <LogicGateQDTracker apiBase="" companyID="company-1" logicGateID="gate-1" canEdit requestJSON={requestJSON} />
        <LogicGateQDTracker apiBase="" companyID="company-1" logicGateID="gate-1" canEdit requestJSON={requestJSON} />
      </>,
    ));
    await flushAsyncWork();

    assert.equal(requests.length, 0, "offscreen trackers must not load or subscribe");
    await act(async () => exactObservers.forEach((observer) => observer.trigger(true)));
    await flushAsyncWork();

    const trackers = container.querySelectorAll<HTMLElement>('[data-logic-gate-qd-tracker="full"]');
    assert.equal(trackers.length, 2);
    assert.equal(trackers[0]?.querySelectorAll('[data-qd-metric="quality"]').length, 31);
    assert.equal(trackers[0]?.querySelectorAll('[data-qd-metric="delivery"]').length, 31);
    const day31 = trackers[0]?.querySelector<HTMLButtonElement>('[data-qd-metric="quality"][data-qd-day="31"]');
    assert.ok(day31);
    assert.doesNotMatch(day31.style.background, /repeating-linear-gradient/, "day 31 stays a normal fixed slice in every month");
    const todayQuality = trackers[0]?.querySelector<HTMLButtonElement>(`[data-qd-metric="quality"][data-qd-day="${businessDate.day}"]`);
    assert.ok(todayQuality);
    assert.equal(todayQuality.disabled, false);
    await act(async () => todayQuality.click());

    const green = [...trackers[0]!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === "Green");
    assert.ok(green);
    await act(async () => green.click());
    await flushAsyncWork();

    assert.deepEqual(requests.find((request) => request.method === "PUT"), {
      path: "/v1/logic-gates/gate-1/qd-ratings/quality",
      method: "PUT",
      json: { company_id: "company-1", rating: "green" },
    });
    for (const tracker of trackers) {
      const committed = tracker.querySelector(`[data-qd-metric="quality"][data-qd-day="${businessDate.day}"]`);
      assert.equal(committed?.getAttribute("data-qd-rating"), "green");
      assert.match(tracker.textContent ?? "", /Last rated by Avery Stone/);
    }
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

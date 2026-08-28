import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import type { Entity } from "../../../../frontend/src/modules/entities/entitiesApi.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function actionItem(entityID: string, name: string): Entity {
  return {
    company_id: "company-1",
    entity_id: entityID,
    entity_type_id: "action-item-type",
    entity_type_name: "Action Item",
    name,
    position: 0,
    revision: 1,
    created_timestamp: "2026-08-28T12:00:00Z",
    entity_fields: [],
  } as Entity;
}

test("Huddle Action Item panel honors a refresh during initial load and ignores the stale response", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement", "HTMLButtonElement",
    "HTMLInputElement", "Event", "EventTarget", "MouseEvent", "CustomEvent", "MutationObserver",
  ] as const) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("localStorage", dom.window.localStorage, restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { HuddleActionItemsPanel }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/huddles/HuddleActionItemsPanel.tsx"),
    ]);
    const pending: Array<(value: { action_items: Entity[] }) => void> = [];
    const requestJSON = <T,>(_path: string): Promise<T> => new Promise((resolve) => {
      pending.push((value) => resolve(value as T));
    });
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    const panel = (refreshToken: number) => (
      <HuddleActionItemsPanel
        companyID="company-1"
        currentUserID="user-1"
        scope={{ resourceType: "huddle_node", resourceID: "node-1" }}
        companyUsers={[]}
        requestJSON={requestJSON}
        refreshToken={refreshToken}
      />
    );

    await act(async () => root.render(panel(0)));
    await act(async () => { await Promise.resolve(); });
    assert.equal(pending.length, 1);

    await act(async () => root.render(panel(1)));
    assert.equal(pending.length, 2, "a saved-reference refresh must not be dropped during initial load");

    await act(async () => {
      pending[1]?.({ action_items: [actionItem("entity-new", "Newest result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Newest result/);

    await act(async () => {
      pending[0]?.({ action_items: [actionItem("entity-old", "Stale result")] });
      await Promise.resolve();
    });
    assert.match(container.textContent ?? "", /Newest result/);
    assert.doesNotMatch(container.textContent ?? "", /Stale result/);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

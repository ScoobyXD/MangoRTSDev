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
    entity_fields: [
      {
        company_id: "company-1", entity_field_id: `${entityID}-person`, entity_id: entityID,
        system_key: "person_in_charge", name: "Person in charge", field_type: "person", config: {},
        value: "user-1", position: 0, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
      {
        company_id: "company-1", entity_field_id: `${entityID}-due`, entity_id: entityID,
        system_key: "completion_due_date", name: "Completion due date", field_type: "date", config: {},
        value: "2026-09-03", position: 1, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
      {
        company_id: "company-1", entity_field_id: `${entityID}-color`, entity_id: entityID,
        system_key: "color", name: "Color", field_type: "color", config: {},
        value: "red", position: 2, created_timestamp: "2026-08-28T12:00:00Z", updated_timestamp: "2026-08-28T12:00:00Z",
      },
    ],
  } as Entity;
}

test("Huddle Action Item panel honors a refresh during initial load and ignores the stale response", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    url: "http://localhost/",
    pretendToBeVisual: true,
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
    const savedViewReads: string[] = [];
    const savedViewWrites: Array<{ path: string; json: unknown }> = [];
    const requestJSON = <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
      if (path.startsWith("/v1/saved-views?") && !init?.method) {
        savedViewReads.push(path);
        return Promise.resolve({ saved_views: [] } as T);
      }
      if (path.startsWith("/v1/saved-views/") && init?.method === "PUT") {
        savedViewWrites.push({ path, json: init.json });
        return Promise.resolve(init.json as T);
      }
      return new Promise((resolve) => {
        pending.push((value) => resolve(value as T));
      });
    };
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
    assert.match(savedViewReads[0] ?? "", /surface=huddle_node_action_items/);

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

    const slots = [...container.querySelectorAll<HTMLElement>("[data-action-item-inline-field-slot]")];
    assert.deepEqual(slots.map((slot) => slot.dataset.actionItemInlineFieldSlot), ["person_in_charge", "completion_due_date"]);
    const rail = container.querySelector<HTMLElement>('[data-action-item-inline-fields="true"]');
    assert.equal(rail?.style.marginLeft, "auto");
    assert.equal(rail?.style.flexWrap, "nowrap");
    assert.equal(rail?.style.overflowX, "auto");
    assert.match(container.textContent ?? "", /Red/);
    assert.match(container.textContent ?? "", /user-1/);

    let openedEntityID = "";
    dom.window.addEventListener("mangorts:editor-entity-reference-open", (event) => {
      openedEntityID = (event as CustomEvent<{ entity?: { entityID?: string } }>).detail.entity?.entityID ?? "";
    }, { once: true });
    const rowButton = container.querySelector<HTMLButtonElement>('[data-action-item-target="entity-new"]');
    assert.ok(rowButton);
    await act(async () => rowButton.click());
    assert.equal(openedEntityID, "entity-new");

    const viewButton = container.querySelector<HTMLButtonElement>('button[aria-label="Group, order, and choose Action Item row fields"]');
    assert.ok(viewButton);
    await act(async () => viewButton.click());
    const directionButton = dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Sort descending for grouping level 1"]');
    assert.ok(directionButton);
    await act(async () => {
      directionButton.click();
      await Promise.resolve();
    });
    assert.equal(savedViewWrites.length, 1);
    const savedPayload = savedViewWrites[0]?.json as { surface?: string; groupings?: Array<{ field?: string; direction?: string }> };
    assert.equal(savedPayload.surface, "huddle_node_action_items");
    assert.deepEqual(savedPayload.groupings?.[0], { field: "color", direction: "desc" });
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

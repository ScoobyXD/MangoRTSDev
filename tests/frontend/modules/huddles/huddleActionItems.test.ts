import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyUser } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { Entity } from "../../../../frontend/src/modules/entities/entitiesApi.js";
import {
  DEFAULT_ACTION_ITEM_GROUPINGS,
  actionItemColor,
  actionItemColorHex,
  actionItemFieldOptionLabel,
  actionItemGroupingStorageKey,
  actionItemGroupingValues,
  actionItemPersonLabel,
  actionItemReferenceIDs,
  formatActionItemDate,
  listHuddleActionItems,
  normalizeActionItemGroupings,
  transitionActionItemReferenceRefresh,
  type ActionItemReferenceRefreshState,
} from "../../../../frontend/src/modules/huddles/huddleActionItems.js";

const users: CompanyUser[] = [{
  company_id: "company-1",
  user_id: "user-1",
  display_name: "Ada Lovelace",
  email: "ada@example.com",
}];

const item = {
  company_id: "company-1",
  entity_id: "entity-1",
  entity_type_id: "type-1",
  entity_type_name: "Action Item",
  name: "Call Costco about mangoes",
  position: 0,
  revision: 0,
  created_timestamp: "2026-08-28T12:00:00Z",
  entity_fields: [
    { entity_field_id: "field-1", entity_id: "entity-1", company_id: "company-1", name: "Person in Charge", system_key: "person_in_charge", field_type: "person", value: "user-1", position: 0, created_timestamp: "", updated_timestamp: "" },
    { entity_field_id: "field-2", entity_id: "entity-1", company_id: "company-1", name: "Completion due date", system_key: "completion_due_date", field_type: "date", value: "2026-09-03", position: 1, created_timestamp: "", updated_timestamp: "" },
    { entity_field_id: "field-3", entity_id: "entity-1", company_id: "company-1", name: "Color", system_key: "color", field_type: "color", config: { options: [{ key: "red", label: "Urgent red", color: "#dc2626" }] }, value: "red", position: 2, created_timestamp: "", updated_timestamp: "" },
    { entity_field_id: "field-4", entity_id: "entity-1", company_id: "company-1", name: "Status", system_key: "status", field_type: "choice", config: { options: [{ key: "in_progress", label: "Being handled" }] }, value: "in_progress", position: 3, created_timestamp: "", updated_timestamp: "" },
  ],
} as Entity;

test("Huddle Action Items default to person then completion due date with the v2 personal storage key", () => {
  assert.deepEqual(normalizeActionItemGroupings(undefined), DEFAULT_ACTION_ITEM_GROUPINGS);
  assert.deepEqual(DEFAULT_ACTION_ITEM_GROUPINGS, [
    { field: "person", direction: "asc" },
    { field: "completion_due_date", direction: "asc" },
  ]);
  assert.equal(actionItemGroupingStorageKey(" company-1 ", " user-1 "), "mangorts-huddle-action-item-groupings-v2:company-1:user-1");
  assert.deepEqual(normalizeActionItemGroupings([
    { field: "color", direction: "desc" },
    { field: "color", direction: "asc" },
    { field: "unknown", direction: "asc" },
  ]), [{ field: "color", direction: "desc" }]);
});

test("Huddle Action Item grouping reads stable system fields and displays dates as month/day/year", () => {
  assert.equal(actionItemPersonLabel(item, users), "Ada Lovelace");
  assert.equal(actionItemColor(item), "red");
  assert.equal(actionItemColorHex(item), "#dc2626");
  assert.equal(actionItemFieldOptionLabel(item, "color"), "Urgent red");
  assert.equal(formatActionItemDate("2026-09-03"), "09/03/2026");
  assert.deepEqual(actionItemGroupingValues(item, "person", users), [{ key: "user-1", label: "Ada Lovelace", sortValue: "ada lovelace" }]);
  assert.deepEqual(actionItemGroupingValues(item, "completion_due_date", users), [{ key: "2026-09-03", label: "09/03/2026", sortValue: "2026-09-03" }]);
  assert.deepEqual(actionItemGroupingValues(item, "status", users), [{ key: "in_progress", label: "Being handled", sortValue: "being handled" }]);
  assert.deepEqual(actionItemGroupingValues(item, "color", users), [{ key: "red", label: "Urgent red", sortValue: "urgent red" }]);
});

test("missing owner and due date group last", () => {
  const unassigned = { ...item, entity_fields: [] } as Entity;
  assert.equal(actionItemGroupingValues(unassigned, "person", users)[0]?.sortLast, true);
  assert.equal(actionItemGroupingValues(unassigned, "completion_due_date", users)[0]?.sortLast, true);
});

test("Huddle Action Items request the exact node or Process scope", async () => {
  const paths: string[] = [];
  const requestJSON = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return { action_items: [item] } as T;
  };

  assert.deepEqual(await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_node", resourceID: "node-1" },
  }), [item]);
  await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_logic_gate", resourceID: "huddle-1" },
  });

  assert.deepEqual(paths, [
    "/v1/action-items?company_id=company-1&huddle_node_id=node-1",
    "/v1/action-items?company_id=company-1&huddle_logic_gate_id=huddle-1",
  ]);
});

test("Action Item reference signatures include only exact Action Item entities", () => {
  assert.deepEqual(actionItemReferenceIDs({
    type: "doc",
    content: [
      { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "item-2", actionItem: true } },
      { type: "paragraph", content: [
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "item-1", actionItemColor: "yellow" } },
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "entity-plain", actionItem: false } },
        { type: "mangoEntityLink", attrs: { entityType: "node", entityId: "node-1", actionItem: true } },
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "item-2", actionItem: true } },
      ] },
    ],
  }), ["item-1", "item-2"]);
});

test("Huddle Action Item rollups refresh only after a saved reference-set change", () => {
  let state: ActionItemReferenceRefreshState | undefined;
  const apply = (event: Parameters<typeof transitionActionItemReferenceRefresh>[1]) => {
    const result = transitionActionItemReferenceRefresh(state, event);
    state = result.state;
    return result.refresh;
  };

  assert.equal(apply({ type: "snapshot", signature: "" }), false, "initial document establishes the baseline");
  assert.equal(apply({ type: "snapshot", signature: "" }), false, "plain typing does not dirty the Action Item set");
  assert.equal(apply({ type: "saved" }), false, "saving plain text does not refresh the rollup");

  assert.equal(apply({ type: "snapshot", signature: "item-1" }), false, "a local reference waits for its durable save");
  assert.equal(apply({ type: "saved" }), true, "the saved added reference refreshes exactly once");
  assert.equal(apply({ type: "saved" }), false, "a repeated saved signal does not refresh again");
  assert.equal(apply({ type: "canonical", signature: "item-1" }), false, "an unchanged canonical echo does not refresh");

  assert.equal(apply({ type: "snapshot", signature: "" }), false, "a local removal also waits for save");
  assert.equal(apply({ type: "saved" }), true, "the saved removal refreshes exactly once");
  assert.equal(apply({ type: "canonical", signature: "item-2" }), true, "a genuinely changed remote canonical set refreshes once");
  assert.equal(apply({ type: "canonical", signature: "item-2" }), false, "a repeated canonical set is ignored");
  assert.equal(apply({ type: "removed" }), true, "a successful textbox deletion refreshes even before editor hydration");
});

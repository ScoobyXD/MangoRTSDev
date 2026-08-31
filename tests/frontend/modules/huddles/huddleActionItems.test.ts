import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyUser } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
  DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS,
  HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES,
  actionItemReferenceIDs,
  fetchHuddleActionItemSavedView,
  huddleActionItemGroupingValues,
  listHuddleActionItems,
  normalizeHuddleActionItemDisplayedFields,
  normalizeHuddleActionItemPreferences,
  saveHuddleActionItemSavedView,
  sortHuddleActionItems,
  toHuddleActionItemPresentation,
  transitionActionItemReferenceRefresh,
  type ActionItemReferenceRefreshState,
  type HuddleActionItem,
  type HuddleActionItemSavedView,
} from "../../../../frontend/src/modules/huddles/huddleActionItems.js";

const users: CompanyUser[] = [
  { company_id: "company-1", user_id: "user-1", display_name: "Ada Lovelace", email: "ada@example.com" },
  { company_id: "company-1", user_id: "user-2", display_name: "Grace Hopper", email: "grace@example.com" },
];

function entityField(id: string, systemKey: string, value: string, position: number) {
  return {
    company_id: "company-1",
    entity_field_id: id,
    entity_id: "entity-1",
    entity_field_type_id: `type-${id}`,
    system_key: systemKey,
    name: systemKey.replace(/_/g, " "),
    field_type: systemKey.includes("date") ? "date" : systemKey.includes("person") || systemKey === "assigned_by" ? "person" : "choice",
    config: {},
    value,
    position,
    created_timestamp: "2026-08-28T12:00:00Z",
    updated_timestamp: "2026-08-28T12:00:00Z",
  };
}

const rawItem = {
  company_id: "company-1",
  entity_id: "entity-1",
  entity_type_id: "type-1",
  entity_type_name: "Action Item",
  name: "Call Costco about mangoes",
  position: 0,
  revision: 0,
  created_timestamp: "2026-08-28T12:00:00Z",
  entity_fields: [
    entityField("field-1", "person_in_charge", "user-1", 0),
    entityField("field-2", "assigned_by", "user-2", 1),
    entityField("field-3", "completion_due_date", "2026-09-03", 2),
    entityField("field-4", "analysis_due_date", "2026-09-01", 3),
    entityField("field-5", "color", "red", 4),
    entityField("field-6", "status", "in_progress", 5),
  ],
  source: { resource_type: "huddle_node", resource_id: "node-source", name: "Weekly notes" },
} as HuddleActionItem;

test("Huddle Action Items separate grouping, leaf ordering, and inline field defaults", () => {
  assert.deepEqual(normalizeHuddleActionItemPreferences(undefined), {
    groupings: DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
    orderings: DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS,
    displayedFields: DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  });
  assert.deepEqual(DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS, [
    { field: "color", direction: "asc" },
    { field: "person_in_charge", direction: "asc" },
  ]);
  assert.deepEqual(DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS, [{ field: "completion_due_date", direction: "asc" }]);
  assert.deepEqual(DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS, ["person_in_charge", "completion_due_date"]);

  assert.deepEqual(normalizeHuddleActionItemPreferences({
    groupings: [{ field: "color", direction: "desc" }],
    settings: {
      ordering: [{ field: "color", direction: "asc" }, { field: "completion_due_date", direction: "desc" }],
      displayed_fields: ["source", "huddle_process", "source", "status"],
    },
  }), {
    groupings: [{ field: "color", direction: "desc" }],
    orderings: [{ field: "completion_due_date", direction: "desc" }],
    displayedFields: ["source", "status"],
  });
  assert.deepEqual(normalizeHuddleActionItemDisplayedFields([]), [], "an explicit empty tray stays empty");
});

test("Huddle Process and Huddle Node saved views are independent user-owned surfaces", async () => {
  assert.deepEqual(HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES, {
    huddle_logic_gate: "huddle_logic_gate_action_items",
    huddle_node: "huddle_node_action_items",
  });
  const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
  const savedView = (surface: HuddleActionItemSavedView["surface"]): HuddleActionItemSavedView => ({
    company_id: "company-1",
    saved_view_id: "11111111-1111-4111-8111-111111111111",
    surface,
    principal: "user",
    principal_id: "user-1",
    name: "Huddle Action Items",
    groupings: DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
    settings: { ordering: DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS, displayed_fields: DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS },
    position: 1000,
  });
  const requestJSON = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    calls.push({ path, init });
    const surface = path.includes("huddle_node_action_items") ? "huddle_node_action_items" : "huddle_logic_gate_action_items";
    if ((init?.method ?? "GET") === "GET") return { saved_views: [savedView(surface)] } as T;
    return savedView((init?.json as { surface: HuddleActionItemSavedView["surface"] }).surface) as T;
  };

  const processView = await fetchHuddleActionItemSavedView(requestJSON, "company-1", "huddle_logic_gate");
  const nodeView = await fetchHuddleActionItemSavedView(requestJSON, "company-1", "huddle_node");
  assert.equal(processView?.surface, "huddle_logic_gate_action_items");
  assert.equal(nodeView?.surface, "huddle_node_action_items");

  await saveHuddleActionItemSavedView(requestJSON, {
    companyID: "company-1",
    userID: "user-1",
    scopeType: "huddle_node",
    savedViewID: "11111111-1111-4111-8111-111111111111",
    groupings: DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
    orderings: DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS,
    displayedFields: DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  });
  assert.equal((calls[2]?.init?.json as { surface?: string }).surface, "huddle_node_action_items");
  assert.equal((calls[2]?.init?.json as { principal?: string }).principal, "user");
});

test("Huddle Action Items reuse My Work projection, semantic grouping, and due-date leaf ordering", () => {
  const item = toHuddleActionItemPresentation(rawItem, users);
  assert.equal(item.person_in_charge_name, "Ada Lovelace");
  assert.equal(item.assigned_by_name, "Grace Hopper");
  assert.equal(item.completion_due_date_field_id, "field-3");
  assert.equal(item.source?.name, "Weekly notes");
  assert.deepEqual(huddleActionItemGroupingValues(item, "color"), [{ key: "red", label: "Red", sortValue: 1 }]);
  assert.deepEqual(huddleActionItemGroupingValues(item, "person_in_charge"), [{
    key: "user-1",
    label: "Ada Lovelace",
    sortValue: "ada lovelace\u0000user-1",
  }]);

  const early = { ...item, entity_id: "early", name: "Early", completion_due_date: "2026-09-01" };
  const late = { ...item, entity_id: "late", name: "Late", completion_due_date: "2026-09-10" };
  const missing = { ...item, entity_id: "missing", name: "Missing", completion_due_date: null };
  assert.deepEqual(
    sortHuddleActionItems([late, missing, early], [{ field: "completion_due_date", direction: "asc" }]).map((candidate) => candidate.entity_id),
    ["early", "late", "missing"],
  );
  assert.deepEqual(
    sortHuddleActionItems([late, missing, early], [{ field: "completion_due_date", direction: "desc" }]).map((candidate) => candidate.entity_id),
    ["late", "early", "missing"],
    "missing values stay last in either direction",
  );
  assert.deepEqual(
    sortHuddleActionItems([late, missing, early], []).map((candidate) => candidate.entity_id),
    ["late", "missing", "early"],
    "an empty ordering stack preserves the stable backend order",
  );
});

test("Huddle Action Items request the exact Node or Process relationship scope", async () => {
  const paths: string[] = [];
  const requestJSON = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return { action_items: [rawItem] } as T;
  };
  assert.deepEqual(await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_node", resourceID: "node-1" },
  }), [rawItem]);
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
  const document = {
    type: "doc",
    content: [
      { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "item-2", actionItem: true } },
      { type: "paragraph", content: [
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "item-1", actionItemColor: "yellow" } },
        { type: "mangoEntityLink", attrs: { entityType: "entity", entityId: "plain", actionItem: false } },
        { type: "mangoEntityLink", attrs: { entityType: "node", entityId: "node-1", actionItem: true } },
      ] },
    ],
  };
  assert.deepEqual(actionItemReferenceIDs(document), ["item-1", "item-2"]);
});

test("Huddle Action Item rollups refresh only after a saved reference-set change", () => {
  let state: ActionItemReferenceRefreshState | undefined;
  const apply = (event: Parameters<typeof transitionActionItemReferenceRefresh>[1]) => {
    const result = transitionActionItemReferenceRefresh(state, event);
    state = result.state;
    return result.refresh;
  };
  assert.equal(apply({ type: "snapshot", signature: "" }), false);
  assert.equal(apply({ type: "snapshot", signature: "item-1" }), false);
  assert.equal(apply({ type: "saved" }), true);
  assert.equal(apply({ type: "saved" }), false);
  assert.equal(apply({ type: "canonical", signature: "item-2" }), true);
  assert.equal(apply({ type: "canonical", signature: "item-2" }), false);
  assert.equal(apply({ type: "removed" }), true);
});

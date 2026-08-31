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
  filterHuddleNodeDueActionItems,
  huddleActionItemWasCreatedInNode,
  huddleActionItemGroupingValues,
  huddleActionItemOrderingsForView,
  listHuddleActionItems,
  normalizeHuddleActionItemDisplayedFields,
  normalizeHuddleActionItemPreferences,
  reconcileHuddleNodeViewingDate,
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

test("Huddle Board and both Huddle Node sections use independent user-owned saved-view surfaces", async () => {
  assert.deepEqual(HUDDLE_ACTION_ITEM_SAVED_VIEW_SURFACES, {
    huddle_logic_gate: "huddle_logic_gate_action_items",
    huddle_node_created: "huddle_node_created_action_items",
    huddle_node_due: "huddle_node_due_action_items",
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
    const surface = path.includes("huddle_node_created_action_items")
      ? "huddle_node_created_action_items"
      : path.includes("huddle_node_due_action_items")
        ? "huddle_node_due_action_items"
        : "huddle_logic_gate_action_items";
    if ((init?.method ?? "GET") === "GET") return { saved_views: [savedView(surface)] } as T;
    return savedView((init?.json as { surface: HuddleActionItemSavedView["surface"] }).surface) as T;
  };

  const boardView = await fetchHuddleActionItemSavedView(requestJSON, "company-1", "huddle_logic_gate");
  const createdView = await fetchHuddleActionItemSavedView(requestJSON, "company-1", "huddle_node_created");
  const dueView = await fetchHuddleActionItemSavedView(requestJSON, "company-1", "huddle_node_due");
  assert.equal(boardView?.surface, "huddle_logic_gate_action_items");
  assert.equal(createdView?.surface, "huddle_node_created_action_items");
  assert.equal(dueView?.surface, "huddle_node_due_action_items");

  await saveHuddleActionItemSavedView(requestJSON, {
    companyID: "company-1",
    userID: "user-1",
    view: "huddle_node_created",
    savedViewID: "11111111-1111-4111-8111-111111111111",
    groupings: DEFAULT_HUDDLE_ACTION_ITEM_GROUPINGS,
    orderings: DEFAULT_HUDDLE_ACTION_ITEM_ORDERINGS,
    displayedFields: DEFAULT_HUDDLE_ACTION_ITEM_DISPLAYED_FIELDS,
  });
  assert.equal((calls[3]?.init?.json as { surface?: string }).surface, "huddle_node_created_action_items");
  assert.equal((calls[3]?.init?.json as { principal?: string }).principal, "user");
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

test("Huddle Node sections keep Source provenance separate from the current due rollup", () => {
  const item = (entityID: string, completionDueDate: string, status: string, sourceID = "node-source") => ({
    ...rawItem,
    entity_id: entityID,
    source: { resource_type: "huddle_node" as const, resource_id: sourceID, name: "Source" },
    entity_fields: rawItem.entity_fields.map((field) => field.system_key === "completion_due_date"
      ? { ...field, value: completionDueDate }
      : field.system_key === "status"
        ? { ...field, value: status }
        : field),
  });
  const createdAndDone = item("created-done", "2026-08-01", "done");
  assert.equal(huddleActionItemWasCreatedInNode(createdAndDone, "node-source"), true, "completed items remain in the created section");
  assert.equal(huddleActionItemWasCreatedInNode(createdAndDone, "other-node"), false);

  const due = item("due", "2026-09-03", "in_progress", "sibling-node");
  const future = item("future", "2026-09-04", "pending", "sibling-node");
  const completed = item("completed", "2026-09-01", "completed", "sibling-node");
  const excludedCreated = item("created-here", "2026-09-01", "pending");
  assert.deepEqual(
    filterHuddleNodeDueActionItems(
      [future, completed, excludedCreated, due],
      "2026-09-03",
      new Set(["created-here"]),
    ).map((candidate) => candidate.entity_id),
    ["due"],
  );
  assert.deepEqual(huddleActionItemOrderingsForView("huddle_node_due", [
    { field: "color", direction: "desc" },
    { field: "completion_due_date", direction: "desc" },
    { field: "person_in_charge", direction: "asc" },
  ]), [
    { field: "completion_due_date", direction: "asc" },
    { field: "color", direction: "desc" },
    { field: "person_in_charge", direction: "asc" },
  ], "the due section always forces oldest due date first and preserves secondary orderings");
  assert.deepEqual(huddleActionItemOrderingsForView("huddle_node_created", [
    { field: "completion_due_date", direction: "desc" },
  ]), [{ field: "completion_due_date", direction: "desc" }], "the created section keeps its own ordering choice");
});

test("a temporary Huddle Node viewing date initializes once and survives realtime or page recovery", () => {
  const initial = reconcileHuddleNodeViewingDate("", "", "node-1", "2026-08-31");
  assert.equal(initial, "2026-08-31");
  assert.equal(
    reconcileHuddleNodeViewingDate("node-1", "2026-09-15", "node-1", "2026-09-01"),
    "2026-09-15",
    "a same-Node realtime, focus, or visibility reload updates the persisted reference without overwriting the temporary choice",
  );
  assert.equal(
    reconcileHuddleNodeViewingDate("node-1", "2026-09-15", "node-2", "2026-10-02"),
    "2026-10-02",
    "opening another Node starts from that Node's persisted date",
  );
});

test("Huddle Action Items request exact Board, created-Source, and due-rollup scopes", async () => {
  const paths: string[] = [];
  const requestJSON = async <T>(path: string): Promise<T> => {
    paths.push(path);
    return { action_items: [rawItem] } as T;
  };
  assert.deepEqual(await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_node", resourceID: "node-source" },
    view: "huddle_node_created",
  }), [rawItem]);
  assert.deepEqual(await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_node", resourceID: "node-source" },
    view: "huddle_node_due",
    viewingDate: "2026-09-03",
  }), [rawItem]);
  await listHuddleActionItems(requestJSON, {
    companyID: "company-1",
    scope: { resourceType: "huddle_logic_gate", resourceID: "huddle-1" },
    view: "huddle_logic_gate",
  });
  assert.deepEqual(paths, [
    "/v1/huddle-nodes/node-source/action-items?company_id=company-1&scope=created",
    "/v1/huddle-nodes/node-source/action-items?company_id=company-1&scope=due&viewing_date=2026-09-03",
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

test("a stale canonical Huddle snapshot cannot erase a local Action Item refresh", () => {
  let state: ActionItemReferenceRefreshState | undefined;
  const apply = (event: Parameters<typeof transitionActionItemReferenceRefresh>[1]) => {
    const result = transitionActionItemReferenceRefresh(state, event);
    state = result.state;
    return result.refresh;
  };

  assert.equal(apply({ type: "snapshot", signature: "" }), false);
  assert.equal(apply({ type: "snapshot", signature: "item-1" }), false);
  assert.equal(apply({ type: "canonical", signature: "" }), false);
  assert.equal(apply({ type: "saved" }), true, "the durable local relationship must refresh after the stale read");
  assert.equal(state?.notifiedSignature, "item-1");
});

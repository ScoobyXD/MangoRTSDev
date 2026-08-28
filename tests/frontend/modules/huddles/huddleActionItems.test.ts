import assert from "node:assert/strict";
import test from "node:test";
import type { CompanyUser } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { Entity } from "../../../../frontend/src/modules/entities/entitiesApi.js";
import {
  DEFAULT_ACTION_ITEM_GROUPINGS,
  actionItemColor,
  actionItemColorHex,
  actionItemFieldOptionLabel,
  actionItemGroupingValues,
  actionItemPersonLabel,
  formatActionItemDate,
  normalizeActionItemGroupings,
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

test("Huddle Action Items default to personal person/date/due-date grouping", () => {
  assert.deepEqual(normalizeActionItemGroupings(undefined), DEFAULT_ACTION_ITEM_GROUPINGS);
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

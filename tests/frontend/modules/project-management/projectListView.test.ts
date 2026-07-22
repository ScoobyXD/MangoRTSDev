import test from "node:test";
import assert from "node:assert/strict";
import type { EntityField } from "../../../../frontend/src/modules/fields/entityFieldsApi.js";
import {
  entityFieldGroupingValue,
  normalizeProjectListGroupings,
  projectListGroupingFields,
} from "../../../../frontend/src/modules/project-management/projectListViewModel.js";

test("project grouping preferences keep supported unique levels and normalize direction", () => {
  assert.deepEqual(normalizeProjectListGroupings([
    { field: "team", direction: "desc" },
    { field: "account", direction: "sideways" },
    { field: "team", direction: "asc" },
    { field: "unsupported", direction: "desc" },
    null,
  ]), [
    { field: "team", direction: "desc" },
    { field: "account", direction: "asc" },
  ]);
  assert.deepEqual(normalizeProjectListGroupings({ field: "team" }), []);
});

test("project grouping preferences support reusable entity fields", () => {
  const field: EntityField = {
    company_id: "company-1",
    field_id: "field-fx",
    name: "FX",
    color: "#6366f1",
    position: 0,
    assignment_count: 2,
    created_timestamp: "2026-07-21T00:00:00Z",
    updated_timestamp: "2026-07-21T00:00:00Z",
  };
  const groupingValue = entityFieldGroupingValue(field.field_id);

  assert.equal(groupingValue, "field:field-fx");
  assert.deepEqual(projectListGroupingFields([field]).slice(-1)[0], {
    value: groupingValue,
    label: "Field: FX",
  });
  assert.deepEqual(normalizeProjectListGroupings([
    { field: groupingValue, direction: "desc" },
    { field: groupingValue, direction: "asc" },
    { field: "field:", direction: "asc" },
  ]), [
    { field: groupingValue, direction: "desc" },
  ]);
});

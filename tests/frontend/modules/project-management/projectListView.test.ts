import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EntityField } from "../../../../frontend/src/modules/fields/entityFieldsApi.js";
import {
  activeProjectListGroupings,
  entityFieldGroupingValue,
  isProjectListFieldGrouping,
  normalizeProjectListGroupings,
  PROJECT_LIST_FIELD_GROUPING,
  projectListGroupingFields,
  projectListSpecificFieldGroupingOptions,
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
  assert.deepEqual(projectListGroupingFields().slice(-1)[0], {
    value: PROJECT_LIST_FIELD_GROUPING,
    label: "Field",
  });
  assert.deepEqual(projectListSpecificFieldGroupingOptions([field])[0], {
    value: groupingValue,
    label: "FX",
  });
  assert.equal(isProjectListFieldGrouping(groupingValue), true);
  const normalized = normalizeProjectListGroupings([
    { field: PROJECT_LIST_FIELD_GROUPING, direction: "asc" },
    { field: groupingValue, direction: "desc" },
    { field: groupingValue, direction: "asc" },
    { field: "field:", direction: "asc" },
  ]);
  assert.deepEqual(normalized, [
    { field: PROJECT_LIST_FIELD_GROUPING, direction: "asc" },
    { field: groupingValue, direction: "desc" },
  ]);
  assert.deepEqual(activeProjectListGroupings(normalized), [
    { field: groupingValue, direction: "desc" },
  ]);

});
test("project field controls separate enabling from choosing a specific field", () => {
  const listSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectListView.tsx"),
    "utf8",
  );
  const contentSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectManagementContent.tsx"),
    "utf8",
  );

  assert.match(listSource, /aria-label="Enable field column"/);
  assert.match(listSource, /PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER/);
  assert.match(listSource, /Choose field for column/);
  assert.match(contentSource, /fieldVariant=\{projectListGroupingFieldVariant\}/);
  assert.match(contentSource, /placeholder: "Choose field"/);
});

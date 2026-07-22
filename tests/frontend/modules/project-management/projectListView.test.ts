import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toggleProjectFieldValue } from "../../../../frontend/src/modules/project-management/ProjectFieldControl.js";
import {
  activeProjectListGroupings,
  entityFieldGroupingValue,
  normalizeProjectListFieldColumns,
  normalizeProjectListGroupings,
  PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER,
  PROJECT_LIST_FIELD_GROUPING,
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

test("project grouping exposes one generic Fields level and migrates legacy field-specific preferences", () => {
  const legacyGroupingValue = entityFieldGroupingValue("field-fx");

  assert.equal(legacyGroupingValue, "field:field-fx");
  assert.deepEqual(projectListGroupingFields().slice(-1)[0], {
    value: PROJECT_LIST_FIELD_GROUPING,
    label: "Group by Fields",
  });
  const normalized = normalizeProjectListGroupings([
    { field: legacyGroupingValue, direction: "desc" },
    { field: PROJECT_LIST_FIELD_GROUPING, direction: "asc" },
    { field: "field:", direction: "asc" },
  ]);
  assert.deepEqual(normalized, [
    { field: PROJECT_LIST_FIELD_GROUPING, direction: "desc" },
  ]);
  assert.deepEqual(activeProjectListGroupings(normalized), normalized);
});

test("project field column preferences collapse to one generic column", () => {
  assert.deepEqual(normalizeProjectListFieldColumns([]), []);
  assert.deepEqual(normalizeProjectListFieldColumns(["field-fx", "field-ax"]), [PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER]);
  assert.deepEqual(normalizeProjectListFieldColumns([PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER]), [PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER]);
});

test("project fields are selected per row and grouping stays generic", () => {
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
  assert.match(listSource, /customFieldHeaderLabelStyle}>Field</);
  assert.match(listSource, /values=\{project\.fields\?\.map/);
  assert.match(listSource, /choices=\{fields\.map/);
  assert.doesNotMatch(listSource, /Choose field for column/);
  assert.doesNotMatch(contentSource, /fieldVariant=\{/);
});

test("project metadata dropdowns commit each option immediately and summary mirrors the enabled Field column", () => {
  assert.deepEqual(toggleProjectFieldValue(["field-a", "field-a"], "field-b"), ["field-a", "field-b"]);
  assert.deepEqual(toggleProjectFieldValue(["field-a", "field-b"], "field-a"), ["field-b"]);
  assert.deepEqual(toggleProjectFieldValue([" field-a "], " "), ["field-a"]);

  const controlSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectFieldControl.tsx"),
    "utf8",
  );
  const contentSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectManagementContent.tsx"),
    "utf8",
  );
  const summarySource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"),
    "utf8",
  );

  assert.match(controlSource, /const commitMultiple = [\s\S]*setOpen\(false\);[\s\S]*onChange\(toggleProjectFieldValue/);
  assert.doesNotMatch(controlSource, />Apply</);
  assert.doesNotMatch(controlSource, />Cancel</);
  assert.match(contentSource, /entityFields=\{entityFields\}[\s\S]*showFieldMetadata=\{visibleProjectFieldIDs\.length > 0\}/);
  assert.match(summarySource, /setEntityFieldAssignments/);
  assert.match(summarySource, /showFieldMetadata \? \([\s\S]*>Fields<[\s\S]*ariaLabel="Project fields"[\s\S]*>Status</);
});

test("project surfaces retain the elevated visual system and compact-width layout hooks", () => {
  const managementSource = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectManagementContent.tsx"), "utf8");
  const summarySource = readFileSync(resolve(process.cwd(), "frontend/src/modules/project-management/ProjectSummaryContent.tsx"), "utf8");
  const cssSource = readFileSync(resolve(process.cwd(), "frontend/src/index.css"), "utf8");

  assert.match(managementSource, /mango-project-management-surface/);
  assert.match(managementSource, /radial-gradient\(circle at 6% 0%/);
  assert.match(summarySource, /mango-project-summary-timeline/);
  assert.match(summarySource, /mango-project-summary-work-panel/);
  assert.match(summarySource, /mango-project-summary-tabs/);
  assert.match(cssSource, /@media \(max-width: 860px\)/);
  assert.match(cssSource, /mango-project-summary-split-handle/);
});

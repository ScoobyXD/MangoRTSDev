import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toggleProjectFieldValue } from "../../../../frontend/src/modules/project-management/ProjectFieldControl.js";
import type { ProjectRecord } from "../../../../frontend/src/modules/project-management/projectManagementApi.js";
import {
  activeProjectListGroupings,
  createEmptyProjectListFilters,
  entityFieldGroupingValue,
  filterProjectsForList,
  hasActiveProjectListFilters,
  normalizeProjectListFieldColumns,
  normalizeProjectListGroupings,
  PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER,
  PROJECT_LIST_FILTER_UNASSIGNED,
  PROJECT_LIST_FIELD_GROUPING,
  projectMatchesProjectListFilters,
  projectListGroupingFields,
} from "../../../../frontend/src/modules/project-management/projectListViewModel.js";

function projectRecord(projectID: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    company_id: "company-1",
    project_id: projectID,
    name: projectID,
    status: "Active",
    health: "On Track",
    created_timestamp: "2026-08-10T12:00:00",
    updated_timestamp: "2026-08-10T12:00:00",
    ...overrides,
  };
}

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

test("project list filters are inactive by default and match names without case sensitivity", () => {
  const projects = [
    projectRecord("project-a", { name: "Mango Launch" }),
    projectRecord("project-b", { name: "Customer renewal" }),
  ];
  const empty = createEmptyProjectListFilters();

  assert.equal(hasActiveProjectListFilters(empty), false);
  assert.equal(filterProjectsForList(projects, empty), projects);
  assert.equal(hasActiveProjectListFilters({ ...empty, createdFrom: "not-a-date" }), false);
  assert.deepEqual(
    filterProjectsForList(projects, { ...empty, nameQuery: "  MANGO  " }).map((project) => project.project_id),
    ["project-a"],
  );
});

test("project list filters use OR within a category and AND across categories", () => {
  const projects = [
    projectRecord("project-a", {
      accounts: [{ company_id: "company-1", account_id: "account-a", name: "A", created_timestamp: "2026-08-01T12:00:00" }],
      teams: [{ company_id: "company-1", group_id: "team-a", name: "Team A", created_timestamp: "2026-08-01T12:00:00" }],
      status: "Active",
    }),
    projectRecord("project-b", {
      accounts: [{ company_id: "company-1", account_id: "account-b", name: "B", created_timestamp: "2026-08-01T12:00:00" }],
      teams: [{ company_id: "company-1", group_id: "team-a", name: "Team A", created_timestamp: "2026-08-01T12:00:00" }],
      status: "Planning",
    }),
    projectRecord("project-c", {
      accounts: [{ company_id: "company-1", account_id: "account-c", name: "C", created_timestamp: "2026-08-01T12:00:00" }],
      teams: [{ company_id: "company-1", group_id: "team-b", name: "Team B", created_timestamp: "2026-08-01T12:00:00" }],
      status: "Active",
    }),
  ];
  const filters = {
    ...createEmptyProjectListFilters(),
    accountIDs: ["account-a", "account-b"],
    teamIDs: ["team-a"],
    statuses: ["Active"],
  };

  assert.deepEqual(filterProjectsForList(projects, filters).map((project) => project.project_id), ["project-a"]);
});

test("project list assignment filters include unassigned account, team, and Field values", () => {
  const assigned = projectRecord("assigned", {
    accounts: [{ company_id: "company-1", account_id: "account-a", name: "A", created_timestamp: "2026-08-01T12:00:00" }],
    teams: [{ company_id: "company-1", group_id: "team-a", name: "Team A", created_timestamp: "2026-08-01T12:00:00" }],
    fields: [{ company_id: "company-1", field_id: "field-a", name: "FX", color: "#123456", position: 1, created_timestamp: "2026-08-01T12:00:00", updated_timestamp: "2026-08-01T12:00:00" }],
  });
  const unassigned = projectRecord("unassigned", { accounts: [], teams: [], fields: [] });
  const empty = createEmptyProjectListFilters();

  assert.deepEqual(filterProjectsForList([assigned, unassigned], {
    ...empty,
    accountIDs: [PROJECT_LIST_FILTER_UNASSIGNED],
    teamIDs: [PROJECT_LIST_FILTER_UNASSIGNED],
    fieldIDs: [PROJECT_LIST_FILTER_UNASSIGNED],
  }).map((project) => project.project_id), ["unassigned"]);
  assert.deepEqual(filterProjectsForList([assigned, unassigned], {
    ...empty,
    accountIDs: [PROJECT_LIST_FILTER_UNASSIGNED, "account-a"],
  }).map((project) => project.project_id), ["assigned", "unassigned"]);
});

test("project list status, health, Field, and date filters use inclusive boundaries", () => {
  const matching = projectRecord("matching", {
    status: "Planning",
    health: "AT RISK",
    fields: [{ company_id: "company-1", field_id: "field-a", name: "FX", color: "#123456", position: 1, created_timestamp: "2026-08-01T12:00:00", updated_timestamp: "2026-08-01T12:00:00" }],
    created_timestamp: "2026-08-10T12:00:00",
    updated_timestamp: "2026-08-12T12:00:00",
  });
  const outside = projectRecord("outside", {
    status: "Planning",
    health: "AT RISK",
    fields: [{ company_id: "company-1", field_id: "field-a", name: "FX", color: "#123456", position: 1, created_timestamp: "2026-08-01T12:00:00", updated_timestamp: "2026-08-01T12:00:00" }],
    created_timestamp: "2026-08-09T12:00:00",
    updated_timestamp: "2026-08-13T12:00:00",
  });
  const filters = {
    ...createEmptyProjectListFilters(),
    statuses: ["Planning"],
    healthValues: ["AT RISK"],
    fieldIDs: ["field-a"],
    createdFrom: "2026-08-10",
    createdTo: "2026-08-10",
    updatedFrom: "2026-08-12",
    updatedTo: "2026-08-12",
  };

  assert.equal(projectMatchesProjectListFilters(matching, filters), true);
  assert.equal(projectMatchesProjectListFilters(outside, filters), false);
  assert.equal(projectMatchesProjectListFilters(projectRecord("invalid", { created_timestamp: "bad-date" }), {
    ...createEmptyProjectListFilters(),
    createdFrom: "2026-08-10",
  }), false);
});

test("Project filters render in the grouping popover and apply before ProjectListView grouping", () => {
  const managementSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/project-management/ProjectManagementContent.tsx"),
    "utf8",
  );
  const groupingSource = readFileSync(
    resolve(process.cwd(), "frontend/src/modules/grouping/UniversalGroupingControls.tsx"),
    "utf8",
  );

  assert.match(managementSource, /filterProjectsForList\(projects, projectListFilters\)/);
  assert.match(managementSource, /additionalContent=\{\([\s\S]*<ProjectListFilterControls/);
  assert.match(managementSource, /<ProjectListView[\s\S]*projects=\{filteredProjects\}/);
  assert.match(groupingSource, /\{additionalContent\}[\s\S]*<\/div>[\s\S]*\)\}/);
  assert.match(groupingSource, /maxHeight:[\s\S]*overflowY: "auto"/);
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

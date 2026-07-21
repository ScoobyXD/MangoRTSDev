import test from "node:test";
import assert from "node:assert/strict";
import type { CompanyExplorerFolder } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { EntityField } from "../../../../frontend/src/modules/fields/entityFieldsApi.js";
import {
  normalizeProjectListGroupings,
  entityFieldGroupingValue,
  projectListGroupingFields,
  projectFolderSubtreeIDs,
  resolveProjectFolderRootID,
} from "../../../../frontend/src/modules/project-management/projectListViewModel.js";

function folder(folderID: string, parentFolderID: string | undefined, name: string, position: number): CompanyExplorerFolder {
  return {
    company_id: "company-1",
    folder_id: folderID,
    parent_folder_id: parentFolderID,
    folder_kind: "project",
    name,
    position,
    created_timestamp: "2026-07-21T00:00:00Z",
    updated_timestamp: "2026-07-21T00:00:00Z",
  };
}

test("project folders resolve the protected Projects root and include nested descendants", () => {
  const folders = [
    folder("unfiled", undefined, "Unfiled", 1000),
    folder("projects", "unfiled", "Projects", 1000),
    folder("client-work", "projects", "Client Work", 1000),
    folder("launches", "client-work", "Launches", 1000),
    folder("other-projects", undefined, "Projects", 2000),
    folder("logic-gates", "unfiled", "Logic Gates", 2000),
  ];

  assert.equal(resolveProjectFolderRootID(folders), "projects");
  assert.deepEqual(
    [...projectFolderSubtreeIDs(folders, "projects")].sort(),
    ["client-work", "launches", "projects"],
  );
});

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

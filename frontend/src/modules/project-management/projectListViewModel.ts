import type { CompanyExplorerFolder } from "../folders/companyExplorerFolders.js";
import type { UniversalGroupingSetting } from "../grouping/universalGrouping.js";

export type ProjectListGroupingField = "account" | "team" | "status" | "health" | "created_month" | "updated_month";

export const PROJECT_LIST_GROUPING_FIELDS: ReadonlyArray<{ value: ProjectListGroupingField; label: string }> = [
  { value: "account", label: "Account" },
  { value: "team", label: "Team" },
  { value: "status", label: "Status" },
  { value: "health", label: "Health" },
  { value: "created_month", label: "Date created" },
  { value: "updated_month", label: "Date updated" },
];

export function normalizeProjectListGroupings(value: unknown): Array<UniversalGroupingSetting<ProjectListGroupingField>> {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(PROJECT_LIST_GROUPING_FIELDS.map((field) => field.value));
  const seen = new Set<ProjectListGroupingField>();
  const result: Array<UniversalGroupingSetting<ProjectListGroupingField>> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const field = String((item as { field?: unknown }).field ?? "") as ProjectListGroupingField;
    if (!allowed.has(field) || seen.has(field)) continue;
    seen.add(field);
    result.push({ field, direction: (item as { direction?: unknown }).direction === "desc" ? "desc" : "asc" });
  }
  return result;
}

export function resolveProjectFolderRootID(folders: CompanyExplorerFolder[]): string {
  const ordered = [...folders].sort(compareFolders);
  const unfiled = ordered.find((folder) => !cleanFolderParentID(folder) && folder.name.trim().toLocaleLowerCase() === "unfiled");
  const projects = ordered.find((folder) => (
    folder.name.trim().toLocaleLowerCase() === "projects"
    && (!unfiled || cleanFolderParentID(folder) === unfiled.folder_id)
  ));
  return projects?.folder_id ?? "";
}

export function projectFolderSubtreeIDs(folders: CompanyExplorerFolder[], rootFolderID: string): Set<string> {
  const result = new Set<string>();
  if (!rootFolderID) return result;
  result.add(rootFolderID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const parentID = cleanFolderParentID(folder);
      if (!parentID || !result.has(parentID) || result.has(folder.folder_id)) continue;
      result.add(folder.folder_id);
      changed = true;
    }
  }
  return result;
}

function cleanFolderParentID(folder: CompanyExplorerFolder): string {
  return folder.parent_folder_id?.trim() ?? "";
}

function compareFolders(left: CompanyExplorerFolder, right: CompanyExplorerFolder): number {
  return (left.position ?? 0) - (right.position ?? 0)
    || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    || left.folder_id.localeCompare(right.folder_id);
}

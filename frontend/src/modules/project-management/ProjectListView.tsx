import React, { useEffect, useMemo, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyUserGroup } from "../communications/communicationsApi.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalGroupingSetting, type UniversalNestedGroup } from "../grouping/universalGrouping.js";
import type { ProjectHealth, ProjectRecord } from "./projectManagementApi.js";
import {
  ProjectFieldControl,
  PROJECT_HEALTH_CHOICES,
  projectStatusChoices,
  type ProjectFieldTone,
} from "./ProjectFieldControl.js";
import { PROJECT_LIST_GROUPING_FIELDS, projectFolderSubtreeIDs, type ProjectListGroupingField } from "./projectListViewModel.js";
export { PROJECT_LIST_GROUPING_FIELDS, normalizeProjectListGroupings, projectFolderSubtreeIDs, resolveProjectFolderRootID } from "./projectListViewModel.js";
export type { ProjectListGroupingField } from "./projectListViewModel.js";

export type ProjectListContextMenuRequest =
  | { kind: "root"; x: number; y: number; selectedProjectIDs: string[] }
  | { kind: "folder"; x: number; y: number; folder: CompanyExplorerFolder; selectedProjectIDs: string[] }
  | { kind: "project"; x: number; y: number; project: ProjectRecord; selectedProjectIDs: string[] };

export type ProjectListFieldUpdate = Partial<{
  status: string;
  health: ProjectHealth;
  accountIDs: string[];
  teamIDs: string[];
}>;

type ProjectTreeRow =
  | { kind: "folder"; id: string; depth: number; folder: CompanyExplorerFolder; expanded: boolean; hasChildren: boolean }
  | { kind: "project"; id: string; depth: number; project: ProjectRecord };

const PROJECT_TREE_DRAG_MIME = "application/x-mangorts-project-list-tree";

export function ProjectListView({
  projects,
  folders,
  folderItems,
  rootFolderID,
  loading,
  groupings,
  accounts,
  teams,
  savingProjectIDs,
  onProjectOpen,
  onProjectFieldChange,
  onContextMenu,
  onMoveProjects,
  onMoveFolder,
}: {
  projects: ProjectRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rootFolderID: string;
  loading: boolean;
  groupings: Array<UniversalGroupingSetting<ProjectListGroupingField>>;
  accounts: Account[];
  teams: CompanyUserGroup[];
  savingProjectIDs: Set<string>;
  onProjectOpen: (projectID: string) => void;
  onProjectFieldChange: (project: ProjectRecord, update: ProjectListFieldUpdate) => void | Promise<void>;
  onContextMenu: (request: ProjectListContextMenuRequest) => void;
  onMoveProjects: (projectIDs: string[], folderID: string) => void | Promise<void>;
  onMoveFolder: (folderID: string, parentFolderID: string) => void | Promise<void>;
}) {
  const folderSubtree = useMemo(() => projectFolderSubtreeIDs(folders, rootFolderID), [folders, rootFolderID]);
  const visibleFolders = useMemo(() => folders.filter((folder) => (
    folder.folder_id !== rootFolderID && (rootFolderID ? folderSubtree.has(folder.folder_id) : true)
  )), [folderSubtree, folders, rootFolderID]);
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<Set<string>>(new Set());
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [selectedProjectIDs, setSelectedProjectIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorID, setSelectionAnchorID] = useState("");
  const [dropFolderID, setDropFolderID] = useState("");

  useEffect(() => {
    setExpandedFolderIDs((current) => {
      const next = new Set(current);
      visibleFolders.forEach((folder) => next.add(folder.folder_id));
      return next;
    });
  }, [visibleFolders]);

  useEffect(() => {
    const known = new Set(projects.map((project) => project.project_id));
    setSelectedProjectIDs((current) => new Set([...current].filter((projectID) => known.has(projectID))));
  }, [projects]);

  const treeRows = useMemo(() => buildProjectTreeRows({
    projects,
    folders: visibleFolders,
    folderItems,
    rootFolderID,
    expandedFolderIDs,
    folderSubtree,
  }), [expandedFolderIDs, folderItems, folderSubtree, projects, rootFolderID, visibleFolders]);
  const visibleProjectIDs = useMemo(() => treeRows.filter((row): row is Extract<ProjectTreeRow, { kind: "project" }> => row.kind === "project").map((row) => row.project.project_id), [treeRows]);
  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const groupedProjects = useMemo(() => buildUniversalNestedGroups(sortedProjects, groupings, {
    rootID: "projects",
    rowKey: (project) => project.project_id,
    getValues: projectGroupingValues,
    sortRows: sortProjects,
  }), [groupings, sortedProjects]);

  useEffect(() => {
    if (groupings.length === 0) return;
    const all = new Set<string>();
    const visit = (groups: Array<UniversalNestedGroup<ProjectRecord, ProjectListGroupingField>>) => {
      for (const group of groups) {
        all.add(group.id);
        visit(group.groups);
      }
    };
    visit(groupedProjects);
    setExpandedGroupIDs(all);
  }, [groupedProjects, groupings.length]);

  if (loading) return <div style={emptyStyle}>Loading projects</div>;

  const selectProject = (projectID: string, event: React.MouseEvent) => {
    if (event.shiftKey && selectionAnchorID) {
      const start = visibleProjectIDs.indexOf(selectionAnchorID);
      const end = visibleProjectIDs.indexOf(projectID);
      if (start >= 0 && end >= 0) {
        const [from, to] = start <= end ? [start, end] : [end, start];
        setSelectedProjectIDs(new Set(visibleProjectIDs.slice(from, to + 1)));
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      setSelectedProjectIDs((current) => {
        const next = new Set(current);
        if (next.has(projectID)) next.delete(projectID);
        else next.add(projectID);
        return next;
      });
      setSelectionAnchorID(projectID);
      return;
    }
    setSelectedProjectIDs(new Set([projectID]));
    setSelectionAnchorID(projectID);
  };

  const requestProjectContextMenu = (project: ProjectRecord, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const selected = selectedProjectIDs.has(project.project_id) ? [...selectedProjectIDs] : [project.project_id];
    if (!selectedProjectIDs.has(project.project_id)) {
      setSelectedProjectIDs(new Set([project.project_id]));
      setSelectionAnchorID(project.project_id);
    }
    onContextMenu({ kind: "project", project, x: event.clientX, y: event.clientY, selectedProjectIDs: selected });
  };

  const projectRow = (project: ProjectRecord, depth: number, key: string) => {
    const selected = selectedProjectIDs.has(project.project_id);
    const saving = savingProjectIDs.has(project.project_id);
    const health = normalizeProjectHealth(project.health);
    return (
      <tr
        key={key}
        data-project-row="project"
        draggable
        style={projectRowStyle(selected)}
        onClick={(event) => selectProject(project.project_id, event)}
        onDoubleClick={() => onProjectOpen(project.project_id)}
        onContextMenu={(event) => requestProjectContextMenu(project, event)}
        onDragStart={(event) => {
          const projectIDs = selected ? [...selectedProjectIDs] : [project.project_id];
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(PROJECT_TREE_DRAG_MIME, JSON.stringify({ kind: "projects", projectIDs }));
          event.dataTransfer.setData("text/plain", project.name || project.project_id);
        }}
      >
        <td style={nameCellStyle}>
          <span style={nameCellInnerStyle(depth)}>
            <span style={treeSpacerStyle} />
            <span style={iconStyle}><ExplorerRowIcon kind="project" /></span>
            <span style={nameTextStyle}>{project.name || project.project_id}</span>
          </span>
        </td>
        <td style={editableCellStyle}>
          <ProjectFieldControl
            ariaLabel={`Status for ${project.name || "project"}`}
            values={[project.status || "Active"]}
            choices={projectStatusChoices(project.status)}
            tone="status"
            disabled={saving}
            onChange={(values) => onProjectFieldChange(project, { status: values[0] || "Active" })}
          />
        </td>
        <td style={editableCellStyle}>
          <ProjectFieldControl
            ariaLabel={`Health for ${project.name || "project"}`}
            values={[health]}
            choices={PROJECT_HEALTH_CHOICES}
            tone={projectHealthTone(health)}
            disabled={saving}
            onChange={(values) => onProjectFieldChange(project, { health: normalizeProjectHealth(values[0]) })}
          />
        </td>
        <td style={editableCellStyle}>
          <ProjectFieldControl
            ariaLabel={`Accounts for ${project.name || "project"}`}
            values={project.accounts?.map((account) => account.account_id) ?? []}
            choices={accounts.map((account) => ({ id: account.account_id, label: account.name || account.account_id }))}
            multiple
            disabled={saving}
            onChange={(accountIDs) => onProjectFieldChange(project, { accountIDs })}
          />
        </td>
        <td style={editableCellStyle}>
          <ProjectFieldControl
            ariaLabel={`Teams for ${project.name || "project"}`}
            values={project.teams?.map((team) => team.group_id) ?? []}
            choices={teams.map((team) => ({ id: team.group_id, label: team.name || team.group_id }))}
            multiple
            disabled={saving}
            onChange={(teamIDs) => onProjectFieldChange(project, { teamIDs })}
          />
        </td>
      </tr>
    );
  };

  const renderGroups = (groups: Array<UniversalNestedGroup<ProjectRecord, ProjectListGroupingField>>): React.ReactNode => groups.map((group) => {
    const expanded = expandedGroupIDs.has(group.id);
    const rows = group.rows.length > 0 ? group.rows : collectGroupProjects(group);
    return (
      <React.Fragment key={group.id}>
        <tr data-project-row="group" style={groupRowStyle(group.depth)} onClick={() => setExpandedGroupIDs((current) => toggleSet(current, group.id))}>
          <td colSpan={5} style={groupCellStyle}>
            <span style={groupCellInnerStyle(group.depth)}>
              <span style={disclosureStyle}><ExplorerDisclosureIcon open={expanded} color="#64748b" /></span>
              <span style={groupAxisStyle}>{groupingFieldLabel(group.field)}</span>
              <span style={groupLabelStyle}>{group.label}</span>
              <span style={countStyle}>{rows.length}</span>
            </span>
          </td>
        </tr>
        {expanded ? (group.groups.length > 0 ? renderGroups(group.groups) : group.rows.map((project) => projectRow(project, group.depth + 1, `${group.id}:${project.project_id}`))) : null}
      </React.Fragment>
    );
  });

  const acceptDrop = (event: React.DragEvent, targetFolderID: string) => {
    const payload = readProjectTreeDrag(event.dataTransfer);
    if (!payload || !targetFolderID) return;
    if (payload.kind === "folder" && projectFolderSubtreeIDs(folders, payload.folderID).has(targetFolderID)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropFolderID("");
    if (payload.kind === "projects") void onMoveProjects(payload.projectIDs, targetFolderID);
    else void onMoveFolder(payload.folderID, targetFolderID);
  };

  return (
    <div
      className="kanban-board-scroll"
      style={listScrollStyle(dropFolderID === rootFolderID)}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest("[data-project-row]")) return;
        event.preventDefault();
        onContextMenu({ kind: "root", x: event.clientX, y: event.clientY, selectedProjectIDs: [...selectedProjectIDs] });
      }}
      onDragOver={(event) => {
        if (!hasProjectTreeDrag(event.dataTransfer) || !rootFolderID) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropFolderID(rootFolderID);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderID("");
      }}
      onDrop={(event) => acceptDrop(event, rootFolderID)}
      onMouseDown={(event) => {
        if (event.button === 0 && !(event.target as HTMLElement).closest("[data-project-row]")) {
          setSelectedProjectIDs(new Set());
          setSelectionAnchorID("");
        }
      }}
    >
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={headerCellStyle}>Project Name</th>
            <th style={headerCellStyle}>Status</th>
            <th style={headerCellStyle}>Health</th>
            <th style={headerCellStyle}>Account</th>
            <th style={headerCellStyle}>Team</th>
          </tr>
        </thead>
        <tbody>
          {groupings.length > 0 ? renderGroups(groupedProjects) : treeRows.map((row) => {
            if (row.kind === "project") return projectRow(row.project, row.depth, row.id);
            return (
              <tr
                key={row.id}
                data-project-row="folder"
                draggable
                style={folderRowStyle(dropFolderID === row.folder.folder_id)}
                onClick={() => setExpandedFolderIDs((current) => toggleSet(current, row.folder.folder_id))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onContextMenu({ kind: "folder", folder: row.folder, x: event.clientX, y: event.clientY, selectedProjectIDs: [...selectedProjectIDs] });
                }}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(PROJECT_TREE_DRAG_MIME, JSON.stringify({ kind: "folder", folderID: row.folder.folder_id }));
                  event.dataTransfer.setData("text/plain", row.folder.name);
                }}
                onDragOver={(event) => {
                  if (!hasProjectTreeDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropFolderID(row.folder.folder_id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderID((current) => current === row.folder.folder_id ? "" : current);
                }}
                onDrop={(event) => acceptDrop(event, row.folder.folder_id)}
              >
                <td colSpan={5} style={folderCellStyle}>
                  <span style={nameCellInnerStyle(row.depth)}>
                    <span style={disclosureStyle}>{row.hasChildren ? <ExplorerDisclosureIcon open={row.expanded} color="#64748b" /> : null}</span>
                    <span style={iconStyle}><ExplorerRowIcon kind="folder" /></span>
                    <span style={folderNameStyle}>{row.folder.name}</span>
                  </span>
                </td>
              </tr>
            );
          })}
          {(groupings.length > 0 ? groupedProjects.length : treeRows.length) === 0 ? (
            <tr><td colSpan={5} style={emptyCellStyle}>No projects</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

export function ProjectFolderPicker({
  title,
  actionLabel,
  folders,
  rootFolderID,
  disabledFolderIDs,
  onChoose,
  onClose,
}: {
  title: string;
  actionLabel: string;
  folders: CompanyExplorerFolder[];
  rootFolderID: string;
  disabledFolderIDs?: Set<string>;
  onChoose: (folderID: string) => void;
  onClose: () => void;
}) {
  const [selectedFolderID, setSelectedFolderID] = useState(rootFolderID);
  const choices = useMemo(() => buildFolderChoices(folders, rootFolderID), [folders, rootFolderID]);
  useEffect(() => {
    if (disabledFolderIDs?.has(selectedFolderID)) {
      setSelectedFolderID(choices.find((choice) => !disabledFolderIDs.has(choice.folderID))?.folderID ?? "");
    }
  }, [choices, disabledFolderIDs, selectedFolderID]);
  const canChoose = Boolean(selectedFolderID) && !disabledFolderIDs?.has(selectedFolderID);
  return (
    <AppModalPortal onRequestClose={onClose}>
      <div style={modalBackdropStyle} onPointerDown={onClose}>
        <div role="dialog" aria-modal="true" aria-label={title} style={pickerStyle} onPointerDown={(event) => event.stopPropagation()}>
          <h3 style={pickerTitleStyle}>{title}</h3>
          <div style={pickerListStyle}>
            {choices.map((choice) => (
              <label key={choice.folderID} style={pickerChoiceStyle(disabledFolderIDs?.has(choice.folderID) === true)}>
                <input
                  type="radio"
                  name="project-folder-target"
                  value={choice.folderID}
                  checked={selectedFolderID === choice.folderID}
                  disabled={disabledFolderIDs?.has(choice.folderID)}
                  onChange={() => setSelectedFolderID(choice.folderID)}
                />
                <span style={{ paddingLeft: choice.depth * 18 }}>{choice.depth > 0 ? "↳ " : ""}{choice.label}</span>
              </label>
            ))}
          </div>
          <div style={pickerActionsStyle}>
            <button type="button" style={secondaryButtonStyle} onClick={onClose}>Cancel</button>
            <button type="button" style={primaryButtonStyle} disabled={!canChoose} onClick={() => { if (canChoose) onChoose(selectedFolderID); }}>{actionLabel}</button>
          </div>
        </div>
      </div>
    </AppModalPortal>
  );
}

function buildProjectTreeRows(input: {
  projects: ProjectRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  rootFolderID: string;
  expandedFolderIDs: Set<string>;
  folderSubtree: Set<string>;
}): ProjectTreeRow[] {
  const projectsByID = new Map(input.projects.map((project) => [project.project_id, project]));
  const foldersByParent = new Map<string, CompanyExplorerFolder[]>();
  for (const folder of input.folders) {
    const parentID = cleanFolderParentID(folder);
    const bucket = foldersByParent.get(parentID) ?? [];
    bucket.push(folder);
    foldersByParent.set(parentID, bucket);
  }
  foldersByParent.forEach((folders) => folders.sort(compareFolders));
  const itemsByFolder = new Map<string, CompanyExplorerFolderItem[]>();
  const placedProjectIDs = new Set<string>();
  for (const item of input.folderItems) {
    if (item.item_type !== "project" || !projectsByID.has(item.item_id)) continue;
    if (input.rootFolderID && !input.folderSubtree.has(item.folder_id)) continue;
    const bucket = itemsByFolder.get(item.folder_id) ?? [];
    bucket.push(item);
    itemsByFolder.set(item.folder_id, bucket);
    placedProjectIDs.add(item.item_id);
  }
  itemsByFolder.forEach((items) => items.sort((left, right) => left.position - right.position || left.item_id.localeCompare(right.item_id)));
  const rows: ProjectTreeRow[] = [];
  const appendFolder = (folder: CompanyExplorerFolder, depth: number) => {
    const childFolders = foldersByParent.get(folder.folder_id) ?? [];
    const childItems = itemsByFolder.get(folder.folder_id) ?? [];
    const expanded = input.expandedFolderIDs.has(folder.folder_id);
    rows.push({ kind: "folder", id: `folder:${folder.folder_id}`, depth, folder, expanded, hasChildren: childFolders.length + childItems.length > 0 });
    if (!expanded) return;
    for (const entry of mergeFolderEntries(childFolders, childItems)) {
      if (entry.kind === "folder") appendFolder(entry.folder, depth + 1);
      else {
        const project = projectsByID.get(entry.item.item_id);
        if (project) rows.push({ kind: "project", id: `folder:${folder.folder_id}:project:${project.project_id}`, depth: depth + 1, project });
      }
    }
  };
  const rootParentID = input.rootFolderID || "";
  const rootFolders = foldersByParent.get(rootParentID) ?? [];
  const rootItems = itemsByFolder.get(rootParentID) ?? [];
  for (const entry of mergeFolderEntries(rootFolders, rootItems)) {
    if (entry.kind === "folder") appendFolder(entry.folder, 0);
    else {
      const project = projectsByID.get(entry.item.item_id);
      if (project) rows.push({ kind: "project", id: `root:project:${project.project_id}`, depth: 0, project });
    }
  }
  for (const project of sortProjects(input.projects.filter((item) => !placedProjectIDs.has(item.project_id)))) {
    rows.push({ kind: "project", id: `unfiled:project:${project.project_id}`, depth: 0, project });
  }
  return rows;
}

function mergeFolderEntries(folders: CompanyExplorerFolder[], items: CompanyExplorerFolderItem[]) {
  return [
    ...folders.map((folder) => ({ kind: "folder" as const, position: folder.position, folder })),
    ...items.map((item) => ({ kind: "item" as const, position: item.position, item })),
  ].sort((left, right) => left.position - right.position || (
    left.kind === "folder" && right.kind === "item" ? -1 : left.kind === "item" && right.kind === "folder" ? 1 : 0
  ));
}

function buildFolderChoices(folders: CompanyExplorerFolder[], rootFolderID: string): Array<{ folderID: string; label: string; depth: number }> {
  const root = folders.find((folder) => folder.folder_id === rootFolderID);
  const children = new Map<string, CompanyExplorerFolder[]>();
  for (const folder of folders) {
    if (folder.folder_id === rootFolderID) continue;
    const parentID = cleanFolderParentID(folder);
    const bucket = children.get(parentID) ?? [];
    bucket.push(folder);
    children.set(parentID, bucket);
  }
  children.forEach((items) => items.sort(compareFolders));
  const choices = [{ folderID: rootFolderID, label: root?.name || "Projects (top level)", depth: 0 }];
  const append = (parentID: string, depth: number) => {
    for (const folder of children.get(parentID) ?? []) {
      choices.push({ folderID: folder.folder_id, label: folder.name, depth });
      append(folder.folder_id, depth + 1);
    }
  };
  append(rootFolderID, 1);
  return choices.filter((choice) => choice.folderID);
}

function projectGroupingValues(project: ProjectRecord, field: ProjectListGroupingField): UniversalGroupValue[] {
  if (field === "account") return entityGroupValues(project.accounts?.map((account) => ({ id: account.account_id, label: account.name })) ?? []);
  if (field === "team") return entityGroupValues(project.teams?.map((team) => ({ id: team.group_id, label: team.name })) ?? []);
  if (field === "status") return singleGroupValue(project.status || "Unassigned");
  if (field === "health") return singleGroupValue(normalizeProjectHealth(project.health));
  const raw = field === "created_month" ? project.created_timestamp : project.updated_timestamp;
  const date = raw ? new Date(raw) : null;
  if (!date || Number.isNaN(date.getTime())) return [{ key: "__unassigned", label: "No date", sortValue: "", sortLast: true }];
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return [{ key, label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }), sortValue: key }];
}

function entityGroupValues(values: Array<{ id: string; label?: string }>): UniversalGroupValue[] {
  const unique = new Map<string, UniversalGroupValue>();
  for (const value of values) {
    const id = value.id.trim();
    if (id) unique.set(id, { key: id, label: value.label?.trim() || id, sortValue: value.label?.trim() || id });
  }
  return unique.size > 0 ? [...unique.values()] : [{ key: "__unassigned", label: "Unassigned", sortValue: "", sortLast: true }];
}

function singleGroupValue(value: string): UniversalGroupValue[] {
  const label = value.trim() || "Unassigned";
  return [{ key: label.toLocaleLowerCase(), label, sortValue: label }];
}

function collectGroupProjects(group: UniversalNestedGroup<ProjectRecord, ProjectListGroupingField>): ProjectRecord[] {
  if (group.rows.length > 0) return group.rows;
  const byID = new Map<string, ProjectRecord>();
  const visit = (current: UniversalNestedGroup<ProjectRecord, ProjectListGroupingField>) => {
    current.rows.forEach((project) => byID.set(project.project_id, project));
    current.groups.forEach(visit);
  };
  visit(group);
  return [...byID.values()];
}

function hasProjectTreeDrag(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(PROJECT_TREE_DRAG_MIME);
}

function readProjectTreeDrag(dataTransfer: DataTransfer): { kind: "projects"; projectIDs: string[] } | { kind: "folder"; folderID: string } | null {
  const raw = dataTransfer.getData(PROJECT_TREE_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown; projectIDs?: unknown; folderID?: unknown };
    if (parsed.kind === "projects" && Array.isArray(parsed.projectIDs)) {
      const projectIDs = parsed.projectIDs.map(String).map((value) => value.trim()).filter(Boolean);
      return projectIDs.length > 0 ? { kind: "projects", projectIDs } : null;
    }
    if (parsed.kind === "folder" && typeof parsed.folderID === "string" && parsed.folderID.trim()) {
      return { kind: "folder", folderID: parsed.folderID.trim() };
    }
  } catch {
    return null;
  }
  return null;
}

function cleanFolderParentID(folder: CompanyExplorerFolder): string {
  return folder.parent_folder_id?.trim() ?? "";
}

function compareFolders(left: CompanyExplorerFolder, right: CompanyExplorerFolder): number {
  return (left.position ?? 0) - (right.position ?? 0)
    || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    || left.folder_id.localeCompare(right.folder_id);
}

function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) || left.project_id.localeCompare(right.project_id));
}

function toggleSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function groupingFieldLabel(field: ProjectListGroupingField): string {
  return PROJECT_LIST_GROUPING_FIELDS.find((option) => option.value === field)?.label ?? field;
}

function normalizeProjectHealth(value?: string | null): ProjectHealth {
  return value === "AT RISK" || value === "Off Track" ? value : "On Track";
}

function projectHealthTone(health: ProjectHealth): ProjectFieldTone {
  return health === "AT RISK" ? "warning" : health === "Off Track" ? "danger" : "healthy";
}

const listScrollStyle = (dropActive: boolean): React.CSSProperties => ({
  minHeight: 0,
  overflow: "auto",
  border: `1px solid ${dropActive ? "rgba(37, 99, 235, 0.58)" : "rgba(148, 163, 184, 0.20)"}`,
  borderRadius: 10,
  background: dropActive ? "rgba(239, 246, 255, 0.88)" : "rgba(255, 255, 255, 0.82)",
});
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 720, color: "#0f172a" };
const headerCellStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 5, height: 42, padding: "0 14px", background: "#f8fafc", borderBottom: "1px solid rgba(148, 163, 184, 0.26)", color: "#475569", fontSize: 12, fontWeight: 900, textAlign: "left" };
const cellStyle: React.CSSProperties = { height: 44, padding: "0 14px", borderBottom: "1px solid rgba(226, 232, 240, 0.9)", fontSize: 13, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", verticalAlign: "middle" };
const editableCellStyle: React.CSSProperties = { ...cellStyle, minWidth: 142, padding: "5px 14px" };
const nameCellStyle: React.CSSProperties = { ...cellStyle, color: "#0f172a", fontWeight: 900 };
const projectRowStyle = (selected: boolean): React.CSSProperties => ({ cursor: "pointer", background: selected ? "linear-gradient(90deg, rgba(219, 234, 254, 0.92), rgba(239, 246, 255, 0.72))" : "transparent", outline: selected ? "2px solid rgba(37, 99, 235, 0.30)" : "2px solid transparent", outlineOffset: -2 });
const folderRowStyle = (dropActive: boolean): React.CSSProperties => ({ cursor: "pointer", background: dropActive ? "rgba(219, 234, 254, 0.92)" : "rgba(248, 250, 252, 0.78)" });
const folderCellStyle: React.CSSProperties = { ...cellStyle, padding: 0, height: 40 };
const nameCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 40, display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%", paddingLeft: 10 + Math.max(0, depth) * 34 });
const treeSpacerStyle: React.CSSProperties = { width: 14, flexShrink: 0 };
const disclosureStyle: React.CSSProperties = { width: 14, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const iconStyle: React.CSSProperties = { width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const nameTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const folderNameStyle: React.CSSProperties = { ...nameTextStyle, color: "#334155", fontSize: 13, fontWeight: 850 };
const groupRowStyle = (depth: number): React.CSSProperties => ({ cursor: "pointer", background: depth === 0 ? "#e2e8f0" : "#f1f5f9" });
const groupCellStyle: React.CSSProperties = { height: 38, padding: 0, borderBottom: "1px solid rgba(148,163,184,.22)", color: "#0f172a", fontSize: 12, fontWeight: 900 };
const groupCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 38, display: "inline-flex", alignItems: "center", paddingLeft: 12 + Math.max(0, depth) * 34 });
const groupAxisStyle: React.CSSProperties = { display: "inline-flex", marginLeft: 7, marginRight: 7, borderRadius: 999, padding: "3px 7px", background: "rgba(255,255,255,.7)", color: "#64748b", fontSize: 10, fontWeight: 900 };
const groupLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 950 };
const countStyle: React.CSSProperties = { marginLeft: 8, color: "#64748b", fontSize: 11, fontWeight: 800 };
const emptyStyle: React.CSSProperties = { minHeight: 0, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };
const emptyCellStyle: React.CSSProperties = { height: 90, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };
const modalBackdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", padding: 18, background: "rgba(15,23,42,.28)" };
const pickerStyle: React.CSSProperties = { width: "min(440px, 100%)", maxHeight: "min(620px, calc(100vh - 36px))", display: "grid", gridTemplateRows: "auto minmax(120px, 1fr) auto", gap: 12, padding: 16, borderRadius: 12, background: "#fff", boxShadow: "0 24px 60px rgba(15,23,42,.24)" };
const pickerTitleStyle: React.CSSProperties = { margin: 0, color: "#0f172a", fontSize: 16, fontWeight: 950 };
const pickerListStyle: React.CSSProperties = { minHeight: 120, overflow: "auto", display: "grid", alignContent: "start", gap: 3, padding: 4, border: "1px solid rgba(148,163,184,.25)", borderRadius: 8 };
const pickerChoiceStyle = (disabled: boolean): React.CSSProperties => ({ minHeight: 34, display: "flex", alignItems: "center", gap: 7, padding: "0 8px", borderRadius: 6, color: "#334155", fontSize: 12, fontWeight: 800, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? .45 : 1 });
const pickerActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8 };
const secondaryButtonStyle: React.CSSProperties = { minHeight: 32, border: "1px solid rgba(148,163,184,.35)", borderRadius: 8, background: "#fff", color: "#334155", padding: "0 12px", fontWeight: 850, cursor: "pointer" };
const primaryButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, border: 0, background: "#2563eb", color: "#fff" };

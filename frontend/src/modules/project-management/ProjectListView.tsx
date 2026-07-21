import React, { useEffect, useMemo, useState } from "react";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyUserGroup } from "../communications/communicationsApi.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalGroupingSetting, type UniversalNestedGroup } from "../grouping/universalGrouping.js";
import type { ProjectHealth, ProjectRecord } from "./projectManagementApi.js";
import {
  ProjectFieldControl,
  PROJECT_HEALTH_CHOICES,
  projectStatusChoices,
  type ProjectFieldTone,
} from "./ProjectFieldControl.js";
import { PROJECT_LIST_GROUPING_FIELDS, type ProjectListGroupingField } from "./projectListViewModel.js";
export { PROJECT_LIST_GROUPING_FIELDS, normalizeProjectListGroupings } from "./projectListViewModel.js";
export type { ProjectListGroupingField } from "./projectListViewModel.js";

export type ProjectListContextMenuRequest = {
  kind: "project";
  x: number;
  y: number;
  project: ProjectRecord;
  selectedProjectIDs: string[];
};

export type ProjectListFieldUpdate = Partial<{
  status: string;
  health: ProjectHealth;
  accountIDs: string[];
  teamIDs: string[];
}>;

export function ProjectListView({
  projects,
  loading,
  groupings,
  accounts,
  teams,
  savingProjectIDs,
  onProjectOpen,
  onProjectFieldChange,
  onContextMenu,
}: {
  projects: ProjectRecord[];
  loading: boolean;
  groupings: Array<UniversalGroupingSetting<ProjectListGroupingField>>;
  accounts: Account[];
  teams: CompanyUserGroup[];
  savingProjectIDs: Set<string>;
  onProjectOpen: (projectID: string) => void;
  onProjectFieldChange: (project: ProjectRecord, update: ProjectListFieldUpdate) => void | Promise<void>;
  onContextMenu: (request: ProjectListContextMenuRequest) => void;
}) {
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [selectedProjectIDs, setSelectedProjectIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorID, setSelectionAnchorID] = useState("");

  useEffect(() => {
    const known = new Set(projects.map((project) => project.project_id));
    setSelectedProjectIDs((current) => new Set([...current].filter((projectID) => known.has(projectID))));
  }, [projects]);

  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const visibleProjectIDs = useMemo(() => sortedProjects.map((project) => project.project_id), [sortedProjects]);
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
        style={projectRowStyle(selected)}
        onClick={(event) => selectProject(project.project_id, event)}
        onDoubleClick={() => onProjectOpen(project.project_id)}
        onContextMenu={(event) => requestProjectContextMenu(project, event)}
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

  return (
    <div
      className="kanban-board-scroll"
      style={listScrollStyle}
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
          {groupings.length > 0
            ? renderGroups(groupedProjects)
            : sortedProjects.map((project) => projectRow(project, 0, project.project_id))}
          {(groupings.length > 0 ? groupedProjects.length : sortedProjects.length) === 0 ? (
            <tr><td colSpan={5} style={emptyCellStyle}>No projects</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
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

const listScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.82)",
};
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 720, color: "#0f172a" };
const headerCellStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 5, height: 42, padding: "0 14px", background: "#f8fafc", borderBottom: "1px solid rgba(148, 163, 184, 0.26)", color: "#475569", fontSize: 12, fontWeight: 900, textAlign: "left" };
const cellStyle: React.CSSProperties = { height: 44, padding: "0 14px", borderBottom: "1px solid rgba(226, 232, 240, 0.9)", fontSize: 13, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", verticalAlign: "middle" };
const editableCellStyle: React.CSSProperties = { ...cellStyle, minWidth: 142, padding: "5px 14px" };
const nameCellStyle: React.CSSProperties = { ...cellStyle, color: "#0f172a", fontWeight: 900 };
const projectRowStyle = (selected: boolean): React.CSSProperties => ({ cursor: "pointer", background: selected ? "linear-gradient(90deg, rgba(219, 234, 254, 0.92), rgba(239, 246, 255, 0.72))" : "transparent", outline: selected ? "2px solid rgba(37, 99, 235, 0.30)" : "2px solid transparent", outlineOffset: -2 });
const nameCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 40, display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%", paddingLeft: 10 + Math.max(0, depth) * 34 });
const treeSpacerStyle: React.CSSProperties = { width: 14, flexShrink: 0 };
const disclosureStyle: React.CSSProperties = { width: 14, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const iconStyle: React.CSSProperties = { width: 18, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const nameTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const groupRowStyle = (depth: number): React.CSSProperties => ({ cursor: "pointer", background: depth === 0 ? "#e2e8f0" : "#f1f5f9" });
const groupCellStyle: React.CSSProperties = { height: 38, padding: 0, borderBottom: "1px solid rgba(148,163,184,.22)", color: "#0f172a", fontSize: 12, fontWeight: 900 };
const groupCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 38, display: "inline-flex", alignItems: "center", paddingLeft: 12 + Math.max(0, depth) * 34 });
const groupAxisStyle: React.CSSProperties = { display: "inline-flex", marginLeft: 7, marginRight: 7, borderRadius: 999, padding: "3px 7px", background: "rgba(255,255,255,.7)", color: "#64748b", fontSize: 10, fontWeight: 900 };
const groupLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 950 };
const countStyle: React.CSSProperties = { marginLeft: 8, color: "#64748b", fontSize: 11, fontWeight: 800 };
const emptyStyle: React.CSSProperties = { minHeight: 0, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };
const emptyCellStyle: React.CSSProperties = { height: 90, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };

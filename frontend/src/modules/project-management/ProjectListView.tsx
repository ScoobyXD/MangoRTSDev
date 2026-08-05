import React, { useEffect, useMemo, useState } from "react";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyUserGroup } from "../communications/communicationsApi.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import type { EntityField } from "../fields/entityFieldsApi.js";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalGroupingSetting, type UniversalNestedGroup } from "../grouping/universalGrouping.js";
import type { ProjectHealth, ProjectRecord } from "./projectManagementApi.js";
import {
  ProjectFieldControl,
  PROJECT_HEALTH_CHOICES,
  projectStatusChoices,
  type ProjectFieldTone,
} from "./ProjectFieldControl.js";
import {
  activeProjectListGroupings,
  entityFieldIDFromGrouping,
  PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER,
  PROJECT_LIST_FIELD_GROUPING,
  PROJECT_LIST_GROUPING_FIELDS,
  type ProjectListGroupingField,
} from "./projectListViewModel.js";
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
  fieldIDs: string[];
}>;

export function ProjectListView({
  projects,
  loading,
  groupings,
  accounts,
  teams,
  fields,
  visibleFieldIDs,
  onVisibleFieldIDsChange,
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
  fields: EntityField[];
  visibleFieldIDs: string[];
  onVisibleFieldIDsChange: (fieldIDs: string[]) => void;
  savingProjectIDs: Set<string>;
  onProjectOpen: (projectID: string) => void;
  onProjectFieldChange: (project: ProjectRecord, update: ProjectListFieldUpdate) => void | Promise<void>;
  onContextMenu: (request: ProjectListContextMenuRequest) => void;
}) {
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [selectedProjectIDs, setSelectedProjectIDs] = useState<Set<string>>(new Set());
  const [selectionAnchorID, setSelectionAnchorID] = useState("");

  const fieldByID = useMemo(() => new Map(fields.map((field) => [field.field_id, field])), [fields]);
  const fieldColumnEnabled = visibleFieldIDs.length > 0;
  const canEnableFieldColumn = !fieldColumnEnabled && fields.length > 0;
  const enableFieldColumnTitle = canEnableFieldColumn
    ? "Enable field column"
    : fields.length === 0
      ? "Create a field from Entities → Fields first"
      : "The Field column is already visible";
  const columnCount = 6 + (fieldColumnEnabled ? 1 : 0);
  const activeGroupings = useMemo(() => activeProjectListGroupings(groupings), [groupings]);

  useEffect(() => {
    const known = new Set(projects.map((project) => project.project_id));
    setSelectedProjectIDs((current) => new Set([...current].filter((projectID) => known.has(projectID))));
  }, [projects]);

  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const visibleProjectIDs = useMemo(() => sortedProjects.map((project) => project.project_id), [sortedProjects]);
  const groupedProjects = useMemo(() => buildUniversalNestedGroups(sortedProjects, activeGroupings, {
    rootID: "projects",
    rowKey: (project) => project.project_id,
    getValues: (project, field) => projectGroupingValues(project, field, fieldByID),
    sortRows: sortProjects,
  }), [activeGroupings, fieldByID, sortedProjects]);

  useEffect(() => {
    if (activeGroupings.length === 0) return;
    const all = new Set<string>();
    const visit = (groups: Array<UniversalNestedGroup<ProjectRecord, ProjectListGroupingField>>) => {
      for (const group of groups) {
        all.add(group.id);
        visit(group.groups);
      }
    };
    visit(groupedProjects);
    setExpandedGroupIDs(all);
  }, [activeGroupings.length, groupedProjects]);

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
        {fieldColumnEnabled ? (
          <td style={customFieldCellStyle}>
            <ProjectFieldControl
              ariaLabel={`Fields for ${project.name || "project"}`}
              values={project.fields?.map((field) => field.field_id) ?? []}
              choices={fields.map((field) => ({ id: field.field_id, label: field.name }))}
              multiple
              placeholder="Not set"
              disabled={saving}
              onChange={(fieldIDs) => onProjectFieldChange(project, { fieldIDs })}
            />
          </td>
        ) : null}
        <td aria-hidden="true" style={addFieldCellStyle} />
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
          <td colSpan={columnCount} style={groupCellStyle}>
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
      <table style={tableStyle(fieldColumnEnabled ? 1 : 0)}>
        <thead>
          <tr>
            <th style={headerCellStyle}>Project Name</th>
            {fieldColumnEnabled ? (
              <th style={customFieldHeaderStyle}>
                <span style={customFieldHeaderInnerStyle}>
                  <span aria-hidden="true" style={customFieldHeaderDotStyle} />
                  <span style={customFieldHeaderLabelStyle}>Field</span>
                  <button type="button" aria-label="Remove Field column" title="Remove field column" style={hideFieldColumnButtonStyle} onClick={() => onVisibleFieldIDsChange([])}>{"\u00d7"}</button>
                </span>
              </th>
            ) : null}
            <th style={addFieldHeaderStyle}>
              <button
                type="button"
                aria-label="Enable field column"
                title={enableFieldColumnTitle}
                disabled={!canEnableFieldColumn}
                style={addFieldColumnButtonStyle(!canEnableFieldColumn)}
                onClick={() => onVisibleFieldIDsChange([PROJECT_LIST_FIELD_COLUMN_PLACEHOLDER])}
              >+</button>
            </th>
            <th style={headerCellStyle}>Status</th>
            <th style={headerCellStyle}>Health</th>
            <th style={headerCellStyle}>Account</th>
            <th style={headerCellStyle}>Team</th>
          </tr>
        </thead>
        <tbody>
          {activeGroupings.length > 0
            ? renderGroups(groupedProjects)
            : sortedProjects.map((project) => projectRow(project, 0, project.project_id))}
          {(activeGroupings.length > 0 ? groupedProjects.length : sortedProjects.length) === 0 ? (
            <tr><td colSpan={columnCount} style={emptyCellStyle}>No projects</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function projectGroupingValues(project: ProjectRecord, field: ProjectListGroupingField, fieldByID: Map<string, EntityField>): UniversalGroupValue[] {
  const customFieldID = entityFieldIDFromGrouping(field);
  if (field === PROJECT_LIST_FIELD_GROUPING || customFieldID) {
    const values = (project.fields ?? []).map((assignment) => {
      const definition = fieldByID.get(assignment.field_id);
      return {
        id: assignment.field_id,
        label: definition?.name?.trim() || assignment.name?.trim() || assignment.field_id,
      };
    });
    return entityGroupValues(values);
  }
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
  const customFieldID = entityFieldIDFromGrouping(field);
  if (field === PROJECT_LIST_FIELD_GROUPING || customFieldID) return "Fields";
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
  border: "1px solid rgba(255, 255, 255, 0.86)",
  borderRadius: 16,
  background: "linear-gradient(145deg, rgba(255,255,255,.94), rgba(240,244,249,.84))",
  boxShadow: "inset 3px 3px 9px rgba(148,163,184,.12), inset -3px -3px 10px rgba(255,255,255,.92), 8px 8px 22px rgba(148,163,184,.16), -7px -7px 20px rgba(255,255,255,.84)",
};
const tableStyle = (customFieldCount: number): React.CSSProperties => ({ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 820 + customFieldCount * 170, color: "#0f172a" });
const headerCellStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 5, height: 46, padding: "0 15px", background: "linear-gradient(180deg, rgba(255,255,255,.97), rgba(241,245,249,.94))", borderBottom: "1px solid rgba(148, 163, 184, 0.24)", color: "#475569", fontSize: 11, fontWeight: 950, letterSpacing: ".015em", textAlign: "left", boxShadow: "inset 0 1px 0 rgba(255,255,255,.96)" };
const customFieldHeaderStyle: React.CSSProperties = { ...headerCellStyle, minWidth: 164, padding: "0 12px", background: "linear-gradient(180deg, rgba(238,242,255,.98), rgba(248,250,252,.95))" };
const customFieldHeaderInnerStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) 20px", alignItems: "center", gap: 6 };
const customFieldHeaderDotStyle: React.CSSProperties = { width: 9, height: 9, borderRadius: 999, background: "#6366f1", boxShadow: "0 0 0 4px rgba(99,102,241,.13), 0 3px 8px rgba(99,102,241,.25)", flexShrink: 0 };
const customFieldHeaderLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#3730a3", fontSize: 12, fontWeight: 950 };
const hideFieldColumnButtonStyle: React.CSSProperties = { width: 20, height: 20, display: "grid", placeItems: "center", border: "1px solid rgba(148,163,184,.18)", borderRadius: 7, background: "rgba(255,255,255,.76)", color: "#94a3b8", cursor: "pointer", padding: 0, font: "inherit", fontSize: 15, lineHeight: 1, boxShadow: "2px 2px 5px rgba(148,163,184,.10), -2px -2px 5px rgba(255,255,255,.8)" };
const addFieldHeaderStyle: React.CSSProperties = { ...headerCellStyle, position: "relative", width: 44, minWidth: 44, padding: 0, textAlign: "center", overflow: "visible" };
const addFieldColumnButtonStyle = (disabled: boolean): React.CSSProperties => ({ width: 30, height: 30, display: "inline-grid", placeItems: "center", border: "1px solid rgba(99,102,241,.26)", borderRadius: 10, background: disabled ? "rgba(241,245,249,.70)" : "linear-gradient(145deg, rgba(255,255,255,.98), rgba(238,242,255,.92))", color: disabled ? "#cbd5e1" : "#6366f1", boxShadow: disabled ? "inset 2px 2px 5px rgba(148,163,184,.10)" : "4px 4px 10px rgba(148,163,184,.16), -4px -4px 10px rgba(255,255,255,.90), 0 4px 12px rgba(99,102,241,.12)", cursor: disabled ? "default" : "pointer", padding: 0, font: "inherit", fontSize: 18, fontWeight: 850, lineHeight: 1, opacity: disabled ? 0.72 : 1 });
const cellStyle: React.CSSProperties = { height: 48, padding: "0 15px", borderBottom: "1px solid rgba(226, 232, 240, 0.76)", fontSize: 13, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", verticalAlign: "middle" };
const editableCellStyle: React.CSSProperties = { ...cellStyle, minWidth: 150, padding: "7px 14px" };
const customFieldCellStyle: React.CSSProperties = { ...editableCellStyle, background: "linear-gradient(90deg, rgba(99,102,241,.045), rgba(196,181,253,.025), transparent)" };
const addFieldCellStyle: React.CSSProperties = { ...cellStyle, width: 44, minWidth: 44, padding: 0 };
const nameCellStyle: React.CSSProperties = { ...cellStyle, color: "#0f172a", fontWeight: 900 };
const projectRowStyle = (selected: boolean): React.CSSProperties => ({ cursor: "pointer", background: selected ? "linear-gradient(90deg, rgba(224,231,255,.92), rgba(239,246,255,.76), rgba(250,245,255,.70))" : "rgba(255,255,255,.62)", outline: selected ? "2px solid rgba(99,102,241,.34)" : "2px solid transparent", outlineOffset: -2, boxShadow: selected ? "inset 4px 0 0 #6366f1, 0 5px 16px rgba(99,102,241,.10)" : undefined });
const nameCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 40, display: "inline-flex", alignItems: "center", gap: 7, maxWidth: "100%", paddingLeft: 10 + Math.max(0, depth) * 34 });
const treeSpacerStyle: React.CSSProperties = { width: 14, flexShrink: 0 };
const disclosureStyle: React.CSSProperties = { width: 14, height: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const iconStyle: React.CSSProperties = { width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRadius: 7, background: "rgba(239,246,255,.86)", color: "#3b82f6", boxShadow: "inset 1px 1px 0 rgba(255,255,255,.9)" };
const nameTextStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const groupRowStyle = (depth: number): React.CSSProperties => ({ cursor: "pointer", background: depth === 0 ? "linear-gradient(90deg, rgba(226,232,240,.94), rgba(238,242,255,.88))" : "linear-gradient(90deg, rgba(241,245,249,.96), rgba(248,250,252,.90))" });
const groupCellStyle: React.CSSProperties = { height: 42, padding: 0, borderBottom: "1px solid rgba(148,163,184,.20)", color: "#0f172a", fontSize: 12, fontWeight: 900, boxShadow: "inset 0 1px 0 rgba(255,255,255,.72)" };
const groupCellInnerStyle = (depth: number): React.CSSProperties => ({ minHeight: 42, display: "inline-flex", alignItems: "center", paddingLeft: 14 + Math.max(0, depth) * 34 });
const groupAxisStyle: React.CSSProperties = { display: "inline-flex", marginLeft: 7, marginRight: 8, border: "1px solid rgba(255,255,255,.78)", borderRadius: 999, padding: "4px 8px", background: "rgba(255,255,255,.78)", color: "#6366f1", fontSize: 10, fontWeight: 950, boxShadow: "3px 3px 8px rgba(148,163,184,.13), -3px -3px 8px rgba(255,255,255,.82)" };
const groupLabelStyle: React.CSSProperties = { fontSize: 13, fontWeight: 950 };
const countStyle: React.CSSProperties = { marginLeft: 8, color: "#64748b", fontSize: 11, fontWeight: 800 };
const emptyStyle: React.CSSProperties = { minHeight: 0, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };
const emptyCellStyle: React.CSSProperties = { height: 90, textAlign: "center", color: "#64748b", fontSize: 12, fontWeight: 850 };

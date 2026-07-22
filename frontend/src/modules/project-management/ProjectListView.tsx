import React, { useEffect, useMemo, useState } from "react";
import type { Account } from "../accounts/accountsApi.js";
import type { CompanyUserGroup } from "../communications/communicationsApi.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import type { EntityField } from "../fields/entityFieldsApi.js";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalGroupingSetting, type UniversalNestedGroup } from "../grouping/universalGrouping.js";
import type { ProjectHealth, ProjectRecord } from "./projectManagementApi.js";
import {
  ProjectFieldControl,
  PROJECT_HEALTH_CHOICES,
  projectStatusChoices,
  type ProjectFieldTone,
} from "./ProjectFieldControl.js";
import { entityFieldIDFromGrouping, PROJECT_LIST_GROUPING_FIELDS, type ProjectListGroupingField } from "./projectListViewModel.js";
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

  const [fieldPickerOpen, setFieldPickerOpen] = useState(false);
  const fieldByID = useMemo(() => new Map(fields.map((field) => [field.field_id, field])), [fields]);
  const visibleFields = useMemo(() => visibleFieldIDs.map((fieldID) => fieldByID.get(fieldID)).filter((field): field is EntityField => Boolean(field)), [fieldByID, visibleFieldIDs]);
  const addableFields = useMemo(() => fields.filter((field) => !visibleFieldIDs.includes(field.field_id)), [fields, visibleFieldIDs]);
  const columnCount = 6 + visibleFields.length;

  useEffect(() => {
    const known = new Set(projects.map((project) => project.project_id));
    setSelectedProjectIDs((current) => new Set([...current].filter((projectID) => known.has(projectID))));
  }, [projects]);

  const sortedProjects = useMemo(() => sortProjects(projects), [projects]);
  const visibleProjectIDs = useMemo(() => sortedProjects.map((project) => project.project_id), [sortedProjects]);
  const groupedProjects = useMemo(() => buildUniversalNestedGroups(sortedProjects, groupings, {
    rootID: "projects",
    rowKey: (project) => project.project_id,
    getValues: (project, field) => projectGroupingValues(project, field, fieldByID),
    sortRows: sortProjects,
  }), [fieldByID, groupings, sortedProjects]);

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
        {visibleFields.map((field) => {
          const currentFieldIDs = project.fields?.map((item) => item.field_id) ?? [];
          const assigned = currentFieldIDs.includes(field.field_id);
          return (
            <td key={field.field_id} style={customFieldCellStyle(field.color)}>
              <ProjectFieldControl
                ariaLabel={`${field.name} for ${project.name || "project"}`}
                values={assigned ? [field.field_id] : []}
                choices={[{ id: field.field_id, label: field.name }]}
                multiple
                placeholder="Not set"
                disabled={saving}
                onChange={(values) => onProjectFieldChange(project, {
                  fieldIDs: values.includes(field.field_id)
                    ? [...currentFieldIDs.filter((fieldID) => fieldID !== field.field_id), field.field_id]
                    : currentFieldIDs.filter((fieldID) => fieldID !== field.field_id),
                })}
              />
            </td>
          );
        })}
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
              <span style={groupAxisStyle}>{groupingFieldLabel(group.field, fieldByID)}</span>
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
      <table style={tableStyle(visibleFields.length)}>
        <thead>
          <tr>
            <th style={headerCellStyle}>Project Name</th>
            {visibleFields.map((field) => (
              <th key={field.field_id} style={customFieldHeaderStyle(field.color)}>
                <span style={customFieldHeaderInnerStyle}>
                  <span aria-hidden="true" style={customFieldHeaderDotStyle(field.color)} />
                  <span style={customFieldHeaderLabelStyle}>{field.name}</span>
                  <button
                    type="button"
                    aria-label={`Hide ${field.name} column`}
                    title={`Hide ${field.name} column`}
                    style={hideFieldColumnButtonStyle}
                    onClick={() => onVisibleFieldIDsChange(visibleFieldIDs.filter((fieldID) => fieldID !== field.field_id))}
                  >×</button>
                </span>
              </th>
            ))}
            <th style={addFieldHeaderStyle}>
              <button type="button" aria-label="Add field column" title="Add field column" style={addFieldColumnButtonStyle(fieldPickerOpen)} onClick={() => setFieldPickerOpen((open) => !open)}>+</button>
              {fieldPickerOpen ? (
                <div role="dialog" aria-label="Add field column" style={fieldPickerStyle}>
                  <div style={fieldPickerTitleStyle}>Add field column</div>
                  {addableFields.length === 0 ? (
                    <div style={fieldPickerEmptyStyle}>{fields.length === 0 ? "Create fields from Entities → Fields first." : "Every field is already visible."}</div>
                  ) : addableFields.map((field) => (
                    <button
                      key={field.field_id}
                      type="button"
                      style={fieldPickerOptionStyle}
                      onClick={() => {
                        onVisibleFieldIDsChange([...visibleFieldIDs, field.field_id]);
                        setFieldPickerOpen(false);
                      }}
                    >
                      <span aria-hidden="true" style={customFieldHeaderDotStyle(field.color)} />
                      <span>{field.name}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </th>
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
            <tr><td colSpan={columnCount} style={emptyCellStyle}>No projects</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function projectGroupingValues(project: ProjectRecord, field: ProjectListGroupingField, fieldByID: Map<string, EntityField>): UniversalGroupValue[] {
  const customFieldID = entityFieldIDFromGrouping(field);
  if (customFieldID) {
    const definition = fieldByID.get(customFieldID);
    const label = definition?.name?.trim() || "Field";
    const assigned = project.fields?.some((item) => item.field_id === customFieldID) === true;
    return assigned
      ? [{ key: customFieldID, label, sortValue: label }]
      : [{ key: "__unassigned", label: `No ${label}`, sortValue: "", sortLast: true }];
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

function groupingFieldLabel(field: ProjectListGroupingField, fieldByID: Map<string, EntityField>): string {
  const customFieldID = entityFieldIDFromGrouping(field);
  if (customFieldID) return fieldByID.get(customFieldID)?.name ?? "Field";
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
const tableStyle = (customFieldCount: number): React.CSSProperties => ({ width: "100%", borderCollapse: "separate", borderSpacing: 0, minWidth: 760 + customFieldCount * 150, color: "#0f172a" });
const headerCellStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 5, height: 42, padding: "0 14px", background: "#f8fafc", borderBottom: "1px solid rgba(148, 163, 184, 0.26)", color: "#475569", fontSize: 12, fontWeight: 900, textAlign: "left" };
const customFieldHeaderStyle = (color: string): React.CSSProperties => ({ ...headerCellStyle, minWidth: 142, padding: "0 10px", background: `linear-gradient(180deg, ${color}12, #f8fafc 78%)` });
const customFieldHeaderInnerStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) 20px", alignItems: "center", gap: 6 };
const customFieldHeaderDotStyle = (color: string): React.CSSProperties => ({ width: 9, height: 9, borderRadius: 999, background: color, boxShadow: `0 0 0 3px ${color}18`, flexShrink: 0 });
const customFieldHeaderLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const hideFieldColumnButtonStyle: React.CSSProperties = { width: 20, height: 20, display: "grid", placeItems: "center", border: 0, borderRadius: 6, background: "transparent", color: "#94a3b8", cursor: "pointer", padding: 0, font: "inherit", fontSize: 15, lineHeight: 1 };
const addFieldHeaderStyle: React.CSSProperties = { ...headerCellStyle, position: "relative", width: 44, minWidth: 44, padding: 0, textAlign: "center", overflow: "visible" };
const addFieldColumnButtonStyle = (open: boolean): React.CSSProperties => ({ width: 28, height: 28, display: "inline-grid", placeItems: "center", border: `1px solid ${open ? "#6366f1" : "rgba(99,102,241,.28)"}`, borderRadius: 9, background: open ? "#eef2ff" : "rgba(255,255,255,.92)", color: "#6366f1", boxShadow: open ? "0 0 0 3px rgba(99,102,241,.12)" : "0 4px 10px rgba(15,23,42,.06)", cursor: "pointer", padding: 0, font: "inherit", fontSize: 18, fontWeight: 800, lineHeight: 1 });
const fieldPickerStyle: React.CSSProperties = { position: "absolute", top: 37, left: 0, zIndex: 80, width: 230, maxHeight: 280, overflow: "auto", display: "grid", alignContent: "start", gap: 4, padding: 8, border: "1px solid rgba(99,102,241,.24)", borderRadius: 12, background: "rgba(255,255,255,.98)", boxShadow: "0 18px 44px rgba(15,23,42,.20), inset 1px 1px 0 rgba(255,255,255,.9)", textAlign: "left", boxSizing: "border-box" };
const fieldPickerTitleStyle: React.CSSProperties = { padding: "3px 5px 7px", borderBottom: "1px solid rgba(226,232,240,.9)", color: "#334155", fontSize: 11, fontWeight: 950 };
const fieldPickerOptionStyle: React.CSSProperties = { minHeight: 34, display: "grid", gridTemplateColumns: "12px minmax(0,1fr)", alignItems: "center", gap: 8, border: 0, borderRadius: 8, background: "transparent", color: "#334155", cursor: "pointer", padding: "0 8px", textAlign: "left", font: "inherit", fontSize: 12, fontWeight: 850 };
const fieldPickerEmptyStyle: React.CSSProperties = { padding: "10px 7px", color: "#64748b", fontSize: 11, fontWeight: 750, lineHeight: 1.45 };
const cellStyle: React.CSSProperties = { height: 44, padding: "0 14px", borderBottom: "1px solid rgba(226, 232, 240, 0.9)", fontSize: 13, fontWeight: 700, color: "#334155", whiteSpace: "nowrap", verticalAlign: "middle" };
const editableCellStyle: React.CSSProperties = { ...cellStyle, minWidth: 142, padding: "5px 14px" };
const customFieldCellStyle = (color: string): React.CSSProperties => ({ ...editableCellStyle, background: `linear-gradient(90deg, ${color}06, transparent)` });
const addFieldCellStyle: React.CSSProperties = { ...cellStyle, width: 44, minWidth: 44, padding: 0 };
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

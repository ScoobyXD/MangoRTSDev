import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../../modules/communications/communicationsApi";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { NodeRecord } from "../../modules/node-map/shared";
import { listMyWorkMatrixRows, type MyWorkMatrixRow } from "../../modules/work-items/workItemReadApi";
import { cleanIDList, logicGateTitle } from "./homeUtils";
import {
  DEFAULT_MY_WORK_GROUPINGS,
  MY_WORK_GROUPING_FIELDS,
  buildNestedGroups,
  computeDefaultExpandedGroupIDs,
  defaultMyWorkSelectedScope,
  GVICRoleLabel,
  myWorkGroupingFieldLabel,
  normalizeMyWorkGroupingStack,
  normalizeMyWorkSavedGroupingSettings,
  priorityLabel,
  sortMyWorkRows,
  type MyWorkGroupingField,
  type MyWorkGroupingSetting,
  type MyWorkNestedGroup,
  type MyWorkResourceRow,
  type MyWorkSavedGroupingSetting,
  type MyWorkScopeLevel,
  type MyWorkSelectedScope,
} from "./myWorkGrouping";

type MyWorkViewProps = {
  apiBase: string;
  loading: boolean;
  companyID: string;
  currentUserID: string;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
};

type ScopePickerRow = {
  key: string;
  depth: number;
  label: string;
  detail: string;
  icon: "company" | "group" | "user";
  scope: MyWorkSelectedScope;
};

const SAVED_GROUPING_SETTINGS_STORAGE_PREFIX = "mangorts.saved_grouping_settings.v1";
const MY_WORK_MATRIX_ROLES: LogicGateGVICRole[] = ["generated", "verified", "consulted", "informed"];
const MY_WORK_MATRIX_PRIORITIES = [1, 2, 3, 4, 5, 0] as const;

export function MyWorkView({
  apiBase,
  loading,
  companyID,
  currentUserID,
  nodes,
  logicGates,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  onOpenNode,
  onOpenLogicGate,
}: MyWorkViewProps) {
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const groupByID = useMemo(() => new Map(companyUserGroups.map((group) => [group.group_id.trim(), group])), [companyUserGroups]);
  const membersByGroupID = useMemo(() => {
    const out = new Map<string, CompanyUserGroupMember[]>();
    for (const member of companyUserGroupMembers) {
      const groupID = member.group_id.trim();
      if (!groupID) continue;
      const list = out.get(groupID) ?? [];
      list.push(member);
      out.set(groupID, list);
    }
    for (const list of out.values()) list.sort((a, b) => userLabel(userByID.get(a.user_id), a.user_id).localeCompare(userLabel(userByID.get(b.user_id), b.user_id), undefined, { numeric: true, sensitivity: "base" }));
    return out;
  }, [companyUserGroupMembers, userByID]);
  const childGroupsByParentID = useMemo(() => {
    const out = new Map<string, CompanyUserGroup[]>();
    for (const group of companyUserGroups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      const list = out.get(parentID) ?? [];
      list.push(group);
      out.set(parentID, list);
    }
    for (const list of out.values()) list.sort(sortCompanyUserGroups);
    return out;
  }, [companyUserGroups]);
  const groupIDsByUserID = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const member of companyUserGroupMembers) {
      const userID = member.user_id.trim();
      const groupID = member.group_id.trim();
      if (!userID || !groupID) continue;
      const list = out.get(userID) ?? [];
      if (!list.includes(groupID)) list.push(groupID);
      out.set(userID, list);
    }
    return out;
  }, [companyUserGroupMembers]);
  const currentUserImmediateGroupID = useMemo(() => {
    const groups = (groupIDsByUserID.get(currentUserID) ?? [])
      .map((groupID) => groupByID.get(groupID))
      .filter((group): group is CompanyUserGroup => Boolean(group))
      .sort(sortCompanyUserGroups);
    return groups[0]?.group_id.trim() ?? "";
  }, [currentUserID, groupByID, groupIDsByUserID]);

  const fallbackSetting = useMemo(() => createDefaultGroupingSetting(companyID, currentUserID), [companyID, currentUserID]);
  const storageKey = useMemo(() => savedGroupingSettingsStorageKey(companyID, currentUserID), [companyID, currentUserID]);
  const [settings, setSettings] = useState<MyWorkSavedGroupingSetting[]>(() => readSavedGroupingSettings(storageKey, fallbackSetting, currentUserID));
  const [selectedSettingID, setSelectedSettingID] = useState(settings[0]?.setting_id ?? "");
  const [scopeMenuLevel, setScopeMenuLevel] = useState<MyWorkScopeLevel | null>(null);
  const [addGroupingOpen, setAddGroupingOpen] = useState(false);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [matrixRows, setMatrixRows] = useState<MyWorkMatrixRow[]>([]);
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState("");

  useEffect(() => {
    const next = readSavedGroupingSettings(storageKey, fallbackSetting, currentUserID);
    setSettings(next);
    setSelectedSettingID(next[0]?.setting_id ?? "");
  }, [currentUserID, fallbackSetting, storageKey]);

  useEffect(() => {
    writeSavedGroupingSettings(storageKey, settings);
  }, [settings, storageKey]);

  useEffect(() => {
    if (settings.some((setting) => setting.setting_id === selectedSettingID)) return;
    setSelectedSettingID(settings[0]?.setting_id ?? "");
  }, [selectedSettingID, settings]);

  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;
  const targetUserIDs = useMemo(() => userIDsForSelectedScope(selectedSetting.selected_scope, companyUsers, childGroupsByParentID, membersByGroupID), [childGroupsByParentID, companyUsers, membersByGroupID, selectedSetting.selected_scope]);

  useEffect(() => {
    if (!apiBase || !companyID || targetUserIDs.length === 0) {
      setMatrixRows([]);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    setMatrixError("");
    void Promise.all(targetUserIDs.map((targetUserID) => (
      listMyWorkMatrixRows({ apiBase, companyID, targetUserID, limit: 500 })
        .then((payload) => payload.rows ?? [])
    ))).then((results) => {
      if (cancelled) return;
      const byKey = new Map<string, MyWorkMatrixRow>();
      for (const row of results.flat()) {
        const key = `${row.user_id}\u0000${row.role}\u0000${row.resource_type}\u0000${row.resource_id}\u0000${row.logic_gate_id ?? ""}\u0000${row.project_id ?? ""}`;
        byKey.set(key, row);
      }
      setMatrixRows(Array.from(byKey.values()));
    }).catch((error) => {
      if (cancelled) return;
      setMatrixRows([]);
      setMatrixError(error instanceof Error ? error.message : "Failed to load My Work");
    }).finally(() => {
      if (!cancelled) setMatrixLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, targetUserIDs]);

  const updateSelectedSetting = useCallback((updater: (setting: MyWorkSavedGroupingSetting) => MyWorkSavedGroupingSetting) => {
    setSettings((current) => current.map((setting) => {
      if (setting.setting_id !== selectedSetting.setting_id) return setting;
      const next = updater(setting);
      return {
        ...next,
        groupings: normalizeMyWorkGroupingStack(next.groupings),
        updated_timestamp: new Date().toISOString(),
      };
    }));
  }, [selectedSetting.setting_id]);

  const defaultScopeForLevel = useCallback((level: MyWorkScopeLevel): MyWorkSelectedScope => {
    if (level === "me") return defaultMyWorkSelectedScope(currentUserID);
    if (level === "team") {
      return currentUserImmediateGroupID
        ? { level, subject_type: "group", subject_id: currentUserImmediateGroupID }
        : { level, subject_type: "user", subject_id: currentUserID };
    }
    return { level, subject_type: "company", subject_id: "company" };
  }, [currentUserID, currentUserImmediateGroupID]);

  const selectScopeLevel = useCallback((level: MyWorkScopeLevel) => {
    const nextScope = defaultScopeForLevel(level);
    if (level === "me") {
      updateSelectedSetting((setting) => ({ ...setting, selected_scope: nextScope }));
      setScopeMenuLevel(null);
      return;
    }
    if (selectedSetting.selected_scope.level !== level) {
      updateSelectedSetting((setting) => ({ ...setting, selected_scope: nextScope }));
    }
    setScopeMenuLevel((current) => (current === level ? null : level));
  }, [defaultScopeForLevel, selectedSetting.selected_scope.level, updateSelectedSetting]);

  const selectScope = useCallback((scope: MyWorkSelectedScope) => {
    updateSelectedSetting((setting) => ({ ...setting, selected_scope: scope }));
    setScopeMenuLevel(null);
  }, [updateSelectedSetting]);

  const addSavedView = useCallback(() => {
    const now = new Date().toISOString();
    const nextNumber = settings.length + 1;
    const setting: MyWorkSavedGroupingSetting = {
      ...selectedSetting,
      setting_id: createLocalID(),
      name: `View ${nextNumber}`,
      created_timestamp: now,
      updated_timestamp: now,
    };
    setSettings((current) => [...current, setting]);
    setSelectedSettingID(setting.setting_id);
  }, [selectedSetting, settings.length]);

  const deleteSavedView = useCallback((settingID: string) => {
    setSettings((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((setting) => setting.setting_id !== settingID);
      if (selectedSettingID === settingID) setSelectedSettingID(next[0]?.setting_id ?? "");
      return next;
    });
  }, [selectedSettingID]);

  const updateGrouping = useCallback((index: number, grouping: MyWorkGroupingSetting) => {
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: setting.groupings.map((item, itemIndex) => (itemIndex === index ? grouping : item)),
    }));
  }, [updateSelectedSetting]);

  const removeGrouping = useCallback((index: number) => {
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: setting.groupings.length <= 1 ? setting.groupings : setting.groupings.filter((_, itemIndex) => itemIndex !== index),
    }));
  }, [updateSelectedSetting]);

  const addGrouping = useCallback((field: MyWorkGroupingField) => {
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: [...setting.groupings, { field, direction: "asc" }],
    }));
    setAddGroupingOpen(false);
  }, [updateSelectedSetting]);

  const rows = useMemo(() => buildMyWorkRowsFromMatrix({
    matrixRows,
    logicGates,
    userByID,
    groupByID,
    groupIDsByUserID,
  }), [groupByID, groupIDsByUserID, logicGates, matrixRows, userByID]);

  const visibleRows = rows;
  const nestedGroups = useMemo(() => buildNestedGroups(visibleRows, selectedSetting.groupings), [selectedSetting.groupings, visibleRows]);
  const groupingSignature = useMemo(() => JSON.stringify({
    setting: selectedSetting.setting_id,
    scope: selectedSetting.selected_scope,
    groupings: selectedSetting.groupings,
    rows: visibleRows.map((row) => row.rowKey ?? `${row.kind}:${row.id}`).sort(),
  }), [selectedSetting.groupings, selectedSetting.selected_scope, selectedSetting.setting_id, visibleRows]);

  useEffect(() => {
    setExpandedGroupIDs(computeDefaultExpandedGroupIDs(nestedGroups));
  }, [groupingSignature, nestedGroups]);

  const scopeRows = useMemo(() => buildScopePickerRows({
    level: scopeMenuLevel ?? selectedSetting.selected_scope.level,
    currentUserID,
    companyUsers,
    companyUserGroups,
    groupByID,
    membersByGroupID,
    childGroupsByParentID,
    currentUserImmediateGroupID,
  }), [childGroupsByParentID, companyUserGroups, companyUsers, currentUserID, currentUserImmediateGroupID, groupByID, membersByGroupID, scopeMenuLevel, selectedSetting.selected_scope.level]);
  const scopeLabel = selectedScopeLabel(selectedSetting.selected_scope, userByID, groupByID);
  const activeFieldSet = new Set(selectedSetting.groupings.map((grouping) => grouping.field));
  const addableFields = MY_WORK_GROUPING_FIELDS.filter((field) => !activeFieldSet.has(field.value));

  return (
    <section style={myWorkShellStyle}>
      <div style={myWorkHeaderStyle}>
        <div style={myWorkTitleStackStyle}>
          <h2 style={myWorkTitleStyle}>My Work</h2>
          <div style={myWorkMetaStyle}>
            {visibleRows.length} active item{visibleRows.length === 1 ? "" : "s"} for {scopeLabel}
            {loading || matrixLoading ? " - Loading" : ""}
            {matrixError ? ` - ${matrixError}` : ""}
          </div>
        </div>
        <GroupingPanel
          setting={selectedSetting}
          settings={settings}
          scopeLabel={scopeLabel}
          scopeMenuLevel={scopeMenuLevel}
          scopeRows={scopeRows}
          addableFields={addableFields}
          addGroupingOpen={addGroupingOpen}
          onSelectSetting={setSelectedSettingID}
          onAddSavedView={addSavedView}
          onDeleteSavedView={deleteSavedView}
          onSelectScopeLevel={selectScopeLevel}
          onSelectScope={selectScope}
          onToggleCollapsed={() => updateSelectedSetting((setting) => ({ ...setting, panel_collapsed: !setting.panel_collapsed }))}
          onUpdateGrouping={updateGrouping}
          onRemoveGrouping={removeGrouping}
          onSetAddGroupingOpen={setAddGroupingOpen}
          onAddGrouping={addGrouping}
        />
      </div>
      <div className="mango-home-scroll" style={myWorkMatrixScrollStyle}>
        {visibleRows.length === 0 && !loading && !matrixLoading ? (
          <div style={myWorkEmptyStyle}>No active work for this scope</div>
        ) : (
          <MyWorkMatrix
            rows={visibleRows}
            groupings={selectedSetting.groupings}
            expandedGroupIDs={expandedGroupIDs}
            onToggleGroup={(groupID) => {
              setExpandedGroupIDs((current) => {
                const next = new Set(current);
                if (next.has(groupID)) next.delete(groupID);
                else next.add(groupID);
                return next;
              });
            }}
            onOpenNode={onOpenNode}
            onOpenLogicGate={onOpenLogicGate}
            nodeByID={new Map(nodes.map((node) => [node.node_id, node]))}
            logicGateByID={new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]))}
          />
        )}
      </div>
    </section>
  );
}

function GroupingPanel({
  setting,
  settings,
  scopeLabel,
  scopeMenuLevel,
  scopeRows,
  addableFields,
  addGroupingOpen,
  onSelectSetting,
  onAddSavedView,
  onDeleteSavedView,
  onSelectScopeLevel,
  onSelectScope,
  onToggleCollapsed,
  onUpdateGrouping,
  onRemoveGrouping,
  onSetAddGroupingOpen,
  onAddGrouping,
}: {
  setting: MyWorkSavedGroupingSetting;
  settings: MyWorkSavedGroupingSetting[];
  scopeLabel: string;
  scopeMenuLevel: MyWorkScopeLevel | null;
  scopeRows: ScopePickerRow[];
  addableFields: ReadonlyArray<{ value: MyWorkGroupingField; label: string }>;
  addGroupingOpen: boolean;
  onSelectSetting: (settingID: string) => void;
  onAddSavedView: () => void;
  onDeleteSavedView: (settingID: string) => void;
  onSelectScopeLevel: (level: MyWorkScopeLevel) => void;
  onSelectScope: (scope: MyWorkSelectedScope) => void;
  onToggleCollapsed: () => void;
  onUpdateGrouping: (index: number, grouping: MyWorkGroupingSetting) => void;
  onRemoveGrouping: (index: number) => void;
  onSetAddGroupingOpen: (open: boolean) => void;
  onAddGrouping: (field: MyWorkGroupingField) => void;
}) {
  return (
    <div style={groupingPanelStyle}>
      <div style={scopeControlRowStyle}>
        <div style={scopeTabsStyle}>
          {(["me", "team", "all"] as const).map((level) => (
            <button
              key={level}
              type="button"
              style={scopeTabStyle(setting.selected_scope.level === level)}
              onClick={() => onSelectScopeLevel(level)}
            >
              {level === "me" ? "Me" : level === "team" ? "Team" : "All"}
            </button>
          ))}
        </div>
        <button type="button" title={setting.panel_collapsed ? "Expand grouping settings" : "Collapse grouping settings"} style={collapseButtonStyle} onClick={onToggleCollapsed}>
          <ExplorerDisclosureIcon open={!setting.panel_collapsed} color="currentColor" />
        </button>
      </div>
      <div style={scopeLabelStyle}>{scopeLabel}</div>
      {scopeMenuLevel && (
        <div style={scopePickerStyle}>
          {scopeRows.length === 0 ? (
            <div style={scopePickerEmptyStyle}>No people or groups</div>
          ) : scopeRows.map((row) => (
            <button
              key={row.key}
              type="button"
              style={scopePickerRowStyle(row.depth, scopesEqual(row.scope, setting.selected_scope))}
              onClick={() => onSelectScope(row.scope)}
            >
              <ScopeIcon icon={row.icon} />
              <span style={scopePickerTextStyle}>
                <span style={scopePickerLabelStyle}>{row.label}</span>
                {row.detail && <span style={scopePickerDetailStyle}>{row.detail}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {!setting.panel_collapsed && (
        <div style={groupingBodyStyle}>
          <div style={savedViewsStyle}>
            <div style={savedViewsListStyle}>
              {settings.map((item) => (
                <div key={item.setting_id} style={savedViewRowStyle(item.setting_id === setting.setting_id)}>
                  <button type="button" style={savedViewButtonStyle} onClick={() => onSelectSetting(item.setting_id)}>
                    {item.name}
                  </button>
                  <button type="button" title="Delete view" style={savedViewDeleteStyle} disabled={settings.length <= 1} onClick={() => onDeleteSavedView(item.setting_id)}>x</button>
                </div>
              ))}
            </div>
            <button type="button" style={newViewButtonStyle} onClick={onAddSavedView}>+ New View</button>
          </div>
          <div style={groupingStackStyle}>
            {setting.groupings.map((grouping, index) => (
              <div key={`${grouping.field}:${index}`} style={groupingRowStyle(index)}>
                <span style={groupingFieldLabelStyle}>{myWorkGroupingFieldLabel(grouping.field)}</span>
                <button
                  type="button"
                  style={groupingDirectionButtonStyle}
                  onClick={() => onUpdateGrouping(index, { ...grouping, direction: grouping.direction === "asc" ? "desc" : "asc" })}
                >
                  {grouping.direction === "asc" ? "Asc" : "Desc"}
                </button>
                <button type="button" title="Remove grouping" style={groupingRemoveButtonStyle} disabled={setting.groupings.length <= 1} onClick={() => onRemoveGrouping(index)}>x</button>
              </div>
            ))}
            <div style={{ position: "relative" }}>
              <button type="button" style={addGroupingButtonStyle} disabled={addableFields.length === 0} onClick={() => onSetAddGroupingOpen(!addGroupingOpen)}>
                + Add Grouping
              </button>
              {addGroupingOpen && (
                <div style={addGroupingMenuStyle}>
                  {addableFields.map((field) => (
                    <button key={field.value} type="button" style={addGroupingOptionStyle} onClick={() => onAddGrouping(field.value)}>
                      {field.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MyWorkGroupList({
  groups,
  expandedGroupIDs,
  onToggleGroup,
  onOpenNode,
  onOpenLogicGate,
  nodeByID,
  logicGateByID,
}: {
  groups: MyWorkNestedGroup[];
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  return (
    <div style={groupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const leafRows = group.groups.length === 0 ? group.rows : [];
        const itemCount = countGroupRows(group);
        return (
          <div key={group.id} style={groupBlockStyle}>
            <button type="button" style={groupHeaderStyle(group.depth)} onClick={() => onToggleGroup(group.id)}>
              <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              <GroupHeaderIcon field={group.field} />
              <span style={groupHeaderLabelStyle}>{group.label}</span>
              <span style={groupHeaderCountStyle}>{itemCount}</span>
            </button>
            {open && group.groups.length > 0 && (
              <MyWorkGroupList
                groups={group.groups}
                expandedGroupIDs={expandedGroupIDs}
                onToggleGroup={onToggleGroup}
                onOpenNode={onOpenNode}
                onOpenLogicGate={onOpenLogicGate}
                nodeByID={nodeByID}
                logicGateByID={logicGateByID}
              />
            )}
            {open && leafRows.length > 0 && (
              <MyWorkRows rows={leafRows} depth={group.depth + 1} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} nodeByID={nodeByID} logicGateByID={logicGateByID} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MyWorkRows({
  rows,
  depth,
  onOpenNode,
  onOpenLogicGate,
  nodeByID,
  logicGateByID,
}: {
  rows: MyWorkResourceRow[];
  depth: number;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  const sections = useMemo(() => buildLogicGateSections(rows, logicGateByID), [logicGateByID, rows]);
  const sectionSignature = useMemo(() => sections.map((section) => `${section.key}:${section.rows.length}`).join("|"), [sections]);
  const [collapsedSectionKeys, setCollapsedSectionKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCollapsedSectionKeys(new Set());
  }, [sectionSignature]);

  const toggleSection = useCallback((sectionKey: string) => {
    setCollapsedSectionKeys((current) => {
      const next = new Set(current);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  }, []);

  return (
    <div style={rowListStyle}>
      {sections.map((section) => {
        const open = !collapsedSectionKeys.has(section.key);
        return (
          <div key={section.key} style={logicGateSectionBlockStyle}>
            <button type="button" style={logicGateSectionRowStyle(depth)} onClick={() => toggleSection(section.key)}>
              <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              {section.logicGateID ? <ExplorerRowIcon kind="logic_gate" /> : <span style={othersSectionBadgeStyle}>O</span>}
              <span style={workRowTitleTextStyle}>{section.title}</span>
              <span style={groupHeaderCountStyle}>{section.rows.length}</span>
            </button>
            {open && (
              <div style={logicGateNodeListStyle}>
                {section.rows.map((row) => {
              const primaryPerson = row.people[0]?.label ?? "Unassigned";
              const status = row.status?.trim() || "No status";
              const priority = Number.isFinite(Number(row.priority)) && Number(row.priority) > 0 ? priorityLabel(Number(row.priority)) : "No priority";
              const dueDate = row.dueDate?.trim() || "No due date";
              return (
                <button
                  key={`${section.key}:${row.rowKey ?? `${row.kind}:${row.id}`}`}
                  type="button"
                  style={workRowStyle(depth + 1)}
                  onClick={() => {
                    if (row.kind === "node") {
                      const node = nodeByID.get(row.id) ?? nodeRecordFromMyWorkRow(row);
                      if (node) onOpenNode(node);
                    } else {
                      onOpenLogicGate(row.id, logicGateTitle(logicGateByID.get(row.id)));
                    }
                  }}
                >
                  <span style={workRowTitleCellStyle}>
                    <ExplorerRowIcon kind={row.kind === "node" ? "node" : "logic_gate"} />
                    <span style={workRowTitleTextStyle}>{row.title}</span>
                  </span>
                  <span style={workRowMetaCellStyle}>{row.kind === "node" ? "Node" : "Logic Gate"}</span>
                  <span style={workRowMetaCellStyle}>{primaryPerson}</span>
                  <span style={workRowMetaCellStyle}>{status}</span>
                  <span style={workRowMetaCellStyle}>{priority}</span>
                  <span style={workRowMetaCellStyle}>{dueDate}</span>
                </button>
              );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

type MyWorkLogicGateSection = {
  key: string;
  logicGateID: string;
  title: string;
  rows: MyWorkResourceRow[];
};

function buildLogicGateSections(rows: MyWorkResourceRow[], logicGateByID: Map<string, LogicGateRecord>): MyWorkLogicGateSection[] {
  const sections = new Map<string, MyWorkLogicGateSection>();
  for (const row of rows) {
    const logicGateIDs = row.logicGateIDs.length > 0 ? row.logicGateIDs : [""];
    logicGateIDs.forEach((logicGateID, index) => {
      const cleanLogicGateID = logicGateID.trim();
      const key = cleanLogicGateID ? `logic_gate:${cleanLogicGateID}` : "others";
      const existing = sections.get(key);
      const title = cleanLogicGateID
        ? (logicGateByID.has(cleanLogicGateID) ? logicGateTitle(logicGateByID.get(cleanLogicGateID)) : row.logicGateLabels[index] || cleanLogicGateID)
        : "Others";
      const section: MyWorkLogicGateSection = existing ?? { key, logicGateID: cleanLogicGateID, title, rows: [] };
      if (!section.rows.some((item) => item.kind === row.kind && item.id === row.id)) section.rows.push(row);
      sections.set(key, section);
    });
  }
  return Array.from(sections.values())
    .map((section) => ({ ...section, rows: sortMyWorkRows(section.rows) }))
    .sort((left, right) => {
      if (!left.logicGateID && right.logicGateID) return 1;
      if (left.logicGateID && !right.logicGateID) return -1;
      return left.title.localeCompare(right.title, undefined, { numeric: true, sensitivity: "base" })
        || left.key.localeCompare(right.key);
    });
}
function MyWorkMatrix({
  rows,
  groupings,
  expandedGroupIDs,
  onToggleGroup,
  onOpenNode,
  onOpenLogicGate,
  nodeByID,
  logicGateByID,
}: {
  rows: MyWorkResourceRow[];
  groupings: MyWorkGroupingSetting[];
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  return (
    <div style={myWorkMatrixGridStyle}>
      <div style={myWorkMatrixCornerStyle}>Priority</div>
      {MY_WORK_MATRIX_ROLES.map((role) => (
        <div key={role} style={myWorkMatrixColumnHeaderStyle}>{GVICRoleLabel(role)}</div>
      ))}
      {MY_WORK_MATRIX_PRIORITIES.map((priority) => (
        <React.Fragment key={priority}>
          <div style={myWorkMatrixPriorityHeaderStyle}>{priorityLabel(priority)}</div>
          {MY_WORK_MATRIX_ROLES.map((role) => {
            const cellRows = sortMyWorkRows(rows.filter((row) => row.primaryGVICRole === role && priorityBucket(row.priority) === priority));
            const groups = buildNestedGroups(cellRows, groupings);
            return (
              <div key={`${priority}:${role}`} style={myWorkMatrixCellStyle}>
                {cellRows.length === 0 ? (
                  <div style={myWorkMatrixCellEmptyStyle}>No active work</div>
                ) : groups.length > 0 ? (
                  <MyWorkGroupList
                    groups={groups}
                    expandedGroupIDs={expandedGroupIDs}
                    onToggleGroup={onToggleGroup}
                    onOpenNode={onOpenNode}
                    onOpenLogicGate={onOpenLogicGate}
                    nodeByID={nodeByID}
                    logicGateByID={logicGateByID}
                  />
                ) : (
                  <MyWorkRows rows={cellRows} depth={0} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} nodeByID={nodeByID} logicGateByID={logicGateByID} />
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

function buildMyWorkRowsFromMatrix({
  matrixRows,
  logicGates,
  userByID,
  groupByID,
  groupIDsByUserID,
}: {
  matrixRows: MyWorkMatrixRow[];
  logicGates: LogicGateRecord[];
  userByID: Map<string, CompanyUser>;
  groupByID: Map<string, CompanyUserGroup>;
  groupIDsByUserID: Map<string, string[]>;
}): MyWorkResourceRow[] {
  const logicGateByID = new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id.trim(), logicGate]));
  const rows: MyWorkResourceRow[] = [];
  for (const row of matrixRows) {
    const role = normalizeGVICRole(row.role);
    if (!role) continue;
    const userID = row.user_id?.trim() ?? "";
    const people = userID ? [personForUserID(userID, userByID)] : [];
    const logicGateIDs = cleanIDList([row.logic_gate_id ?? ""]);
    const logicGateLabels = logicGateIDs.map((logicGateID) => {
      const logicGate = logicGateByID.get(logicGateID);
      return logicGate ? logicGateTitle(logicGate) : logicGateID;
    });
    const projectID = row.project_id?.trim() ?? "";
    const projectName = row.project_name?.trim() ?? "";
    rows.push({
      rowKey: `${userID}:${role}:${row.resource_type}:${row.resource_id}:${row.logic_gate_id ?? ""}:${projectID}`,
      companyID: row.company_id,
      kind: row.resource_type,
      id: row.resource_id,
      title: row.display_title?.trim() || (row.resource_type === "node" ? "Node" : "Logic Gate"),
      status: row.status,
      dueDate: row.due_date,
      priority: row.priority,
      accounts: row.accounts ?? [],
      projectLabels: projectName ? [projectName] : projectID ? [projectID] : [],
      people,
      teams: teamsForUsers(userID ? [userID] : [], groupIDsByUserID, groupByID),
      gvicRoles: [role],
      primaryGVICRole: role,
      participantUserIDs: userID ? [userID] : [],
      projectID,
      projectName,
      logicGateLabels,
      logicGateIDs,
    });
  }

  return sortMyWorkRows(rows);
}

function nodeRecordFromMyWorkRow(row: MyWorkResourceRow): NodeRecord | null {
  if (row.kind !== "node") return null;
  return {
    company_id: row.companyID ?? "",
    node_id: row.id,
    name: row.title,
    status: row.status,
    due_date: row.dueDate,
    priority: row.priority,
    logic_gate_ids: row.logicGateIDs,
    accounts: row.accounts,
    created_timestamp: new Date().toISOString(),
  };
}

function priorityBucket(priority: number | null | undefined): typeof MY_WORK_MATRIX_PRIORITIES[number] {
  const value = Number(priority);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.max(1, Math.min(5, Math.round(value))) as typeof MY_WORK_MATRIX_PRIORITIES[number];
}

function normalizeGVICRole(role: string | null | undefined): LogicGateGVICRole | "" {
  if (role === "generated" || role === "verified" || role === "consulted" || role === "informed") return role;
  return "";
}

function userIDsForSelectedScope(
  scope: MyWorkSelectedScope,
  companyUsers: CompanyUser[],
  childGroupsByParentID: Map<string, CompanyUserGroup[]>,
  membersByGroupID: Map<string, CompanyUserGroupMember[]>,
): string[] {
  if (scope.subject_type === "company") return uniqueStrings(companyUsers.map((user) => user.user_id));
  if (scope.subject_type === "user") return uniqueStrings([scope.subject_id]);
  return Array.from(userIDsForGroupSubtree(scope.subject_id, childGroupsByParentID, membersByGroupID));
}

function buildScopePickerRows({
  level,
  currentUserID,
  companyUsers,
  companyUserGroups,
  groupByID,
  membersByGroupID,
  childGroupsByParentID,
  currentUserImmediateGroupID,
}: {
  level: MyWorkScopeLevel;
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  groupByID: Map<string, CompanyUserGroup>;
  membersByGroupID: Map<string, CompanyUserGroupMember[]>;
  childGroupsByParentID: Map<string, CompanyUserGroup[]>;
  currentUserImmediateGroupID: string;
}): ScopePickerRow[] {
  if (level === "me") {
    const currentUser = companyUsers.find((user) => user.user_id === currentUserID);
    const users = [currentUser, ...companyUsers.filter((user) => user.user_id !== currentUserID)]
      .filter((user): user is CompanyUser => Boolean(user))
      .sort((a, b) => (a.user_id === currentUserID ? -1 : b.user_id === currentUserID ? 1 : userLabel(a, a.user_id).localeCompare(userLabel(b, b.user_id), undefined, { numeric: true, sensitivity: "base" })));
    return users.map((user) => ({
      key: `me:user:${user.user_id}`,
      depth: 0,
      label: userLabel(user, user.user_id),
      detail: user.email?.trim() ?? "",
      icon: "user",
      scope: { level: "me", subject_type: "user", subject_id: user.user_id },
    }));
  }

  const rows: ScopePickerRow[] = [];
  const appendGroup = (group: CompanyUserGroup, depth: number, scopeLevel: MyWorkScopeLevel, seen: Set<string>) => {
    const groupID = group.group_id.trim();
    if (!groupID || seen.has(groupID)) return;
    seen.add(groupID);
    rows.push({
      key: `${scopeLevel}:group:${groupID}`,
      depth,
      label: group.name.trim() || groupID,
      detail: "Group",
      icon: "group",
      scope: { level: scopeLevel, subject_type: "group", subject_id: groupID },
    });
    for (const child of childGroupsByParentID.get(groupID) ?? []) appendGroup(child, depth + 1, scopeLevel, seen);
    for (const member of membersByGroupID.get(groupID) ?? []) {
      rows.push({
        key: `${scopeLevel}:group:${groupID}:user:${member.user_id}`,
        depth: depth + 1,
        label: member.user_display_name?.trim() || userLabel(undefined, member.user_id),
        detail: member.user_email?.trim() ?? "",
        icon: "user",
        scope: { level: scopeLevel, subject_type: "user", subject_id: member.user_id },
      });
    }
  };

  if (level === "team") {
    const root = groupByID.get(currentUserImmediateGroupID);
    if (root) appendGroup(root, 0, "team", new Set());
    if (!root) {
      const currentUser = companyUsers.find((user) => user.user_id === currentUserID);
      rows.push({
        key: `team:user:${currentUserID}`,
        depth: 0,
        label: userLabel(currentUser, currentUserID),
        detail: currentUser?.email?.trim() ?? "",
        icon: "user",
        scope: { level: "team", subject_type: "user", subject_id: currentUserID },
      });
    }
    return rows;
  }

  rows.push({
    key: "all:company",
    depth: 0,
    label: "Company",
    detail: "All people and groups",
    icon: "company",
    scope: { level: "all", subject_type: "company", subject_id: "company" },
  });
  const topGroups = childGroupsByParentID.get("") ?? companyUserGroups.filter((group) => !(group.parent_group_id ?? "").trim()).sort(sortCompanyUserGroups);
  for (const group of topGroups) appendGroup(group, 1, "all", new Set());
  return rows;
}

function userIDsForGroupSubtree(
  groupID: string,
  childGroupsByParentID: Map<string, CompanyUserGroup[]>,
  membersByGroupID: Map<string, CompanyUserGroupMember[]>,
): Set<string> {
  const out = new Set<string>();
  const visit = (currentGroupID: string, seen: Set<string>) => {
    const cleanGroupID = currentGroupID.trim();
    if (!cleanGroupID || seen.has(cleanGroupID)) return;
    seen.add(cleanGroupID);
    for (const member of membersByGroupID.get(cleanGroupID) ?? []) {
      const userID = member.user_id.trim();
      if (userID) out.add(userID);
    }
    for (const child of childGroupsByParentID.get(cleanGroupID) ?? []) visit(child.group_id, seen);
  };
  visit(groupID, new Set());
  return out;
}

function personForUserID(userID: string, userByID: Map<string, CompanyUser>, fallbackName?: string, fallbackEmail?: string) {
  const user = userByID.get(userID);
  return {
    userID,
    label: userLabel(user, userID, fallbackName, fallbackEmail),
  };
}

function teamsForUsers(userIDs: string[], groupIDsByUserID: Map<string, string[]>, groupByID: Map<string, CompanyUserGroup>) {
  const teams = new Map<string, { groupID: string; label: string }>();
  for (const userID of userIDs) {
    for (const groupID of groupIDsByUserID.get(userID) ?? []) {
      const group = groupByID.get(groupID);
      const label = group?.name.trim() || groupID;
      if (groupID && !teams.has(groupID)) teams.set(groupID, { groupID, label });
    }
  }
  return Array.from(teams.values()).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" }));
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean)));
}

function selectedScopeLabel(scope: MyWorkSelectedScope, userByID: Map<string, CompanyUser>, groupByID: Map<string, CompanyUserGroup>): string {
  if (scope.subject_type === "company") return "Company";
  if (scope.subject_type === "group") {
    const group = groupByID.get(scope.subject_id);
    return group?.name.trim() || scope.subject_id || "Group";
  }
  if (scope.level === "me" && !scope.subject_id.trim()) return "My view";
  return userLabel(userByID.get(scope.subject_id), scope.subject_id);
}

function userLabel(user: CompanyUser | undefined, fallbackID: string, fallbackName = "", fallbackEmail = ""): string {
  return user?.display_name?.trim() || fallbackName?.trim() || user?.email?.trim() || fallbackEmail?.trim() || fallbackID.trim() || "User";
}

function sortCompanyUserGroups(left: CompanyUserGroup, right: CompanyUserGroup): number {
  return left.position - right.position
    || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
    || left.group_id.localeCompare(right.group_id);
}

function createDefaultGroupingSetting(companyID: string, currentUserID: string): MyWorkSavedGroupingSetting {
  const now = new Date().toISOString();
  return {
    setting_id: createLocalID(),
    company_id: companyID,
    user_id: currentUserID,
    surface: "my_work",
    name: "GVIC Priority Project",
    selected_scope: defaultMyWorkSelectedScope(currentUserID),
    groupings: [...DEFAULT_MY_WORK_GROUPINGS],
    panel_collapsed: false,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedGroupingSettingsStorageKey(companyID: string, userID: string): string {
  return `${SAVED_GROUPING_SETTINGS_STORAGE_PREFIX}:${companyID.trim() || "company"}:${userID.trim() || "user"}:my_work`;
}

function readSavedGroupingSettings(storageKey: string, fallback: MyWorkSavedGroupingSetting, currentUserID: string): MyWorkSavedGroupingSetting[] {
  if (typeof localStorage === "undefined") return [fallback];
  try {
    return normalizeMyWorkSavedGroupingSettings(JSON.parse(localStorage.getItem(storageKey) ?? "null"), fallback, currentUserID);
  } catch {
    return [fallback];
  }
}

function writeSavedGroupingSettings(storageKey: string, settings: MyWorkSavedGroupingSetting[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

function createLocalID(): string {
  return globalThis.crypto?.randomUUID?.() ?? `setting-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function scopesEqual(left: MyWorkSelectedScope, right: MyWorkSelectedScope): boolean {
  return left.level === right.level && left.subject_type === right.subject_type && left.subject_id === right.subject_id;
}

function countGroupRows(group: MyWorkNestedGroup): number {
  if (group.groups.length === 0) return group.rows.length;
  return group.groups.reduce((sum, child) => sum + countGroupRows(child), 0);
}

function ScopeIcon({ icon }: { icon: ScopePickerRow["icon"] }) {
  return <PeopleIcon multiple={icon !== "user"} />;
}

function PeopleIcon({ multiple }: { multiple: boolean }) {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={peopleIconStyle}>
      {multiple && <circle cx="5" cy="5.2" r="2.1" fill="none" stroke="currentColor" strokeWidth="1.4" />}
      {multiple && <path d="M1.8 13c.35-2.2 1.5-3.3 3.2-3.3.95 0 1.7.28 2.25.85" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
      <circle cx={multiple ? 10.3 : 8} cy="5.1" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d={multiple ? "M6.3 13.1c.42-2.45 1.78-3.7 4-3.7s3.58 1.25 4 3.7" : "M3.9 13.1c.42-2.45 1.82-3.7 4.1-3.7s3.68 1.25 4.1 3.7"} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function GroupHeaderIcon({ field }: { field: MyWorkGroupingField }) {
  return <span aria-hidden="true" style={groupHeaderBadgeStyle}>{groupHeaderBadgeLabel(field)}</span>;
}

function groupHeaderBadgeLabel(field: MyWorkGroupingField): string {
  if (field === "account") return "A";
  if (field === "due_date") return "D";
  if (field === "person") return "P";
  if (field === "priority") return "#";
  if (field === "project") return "P";
  if (field === "gvic") return "G";
  if (field === "status") return "S";
  return "T";
}

const peopleIconStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#2563eb",
};

const groupHeaderBadgeStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 0,
  color: "#64748b",
  background: "transparent",
  fontSize: 10,
  lineHeight: 1,
  fontWeight: 850,
};
const myWorkShellStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 6,
  padding: 14,
  background: "#ffffff",
  color: "#111827",
  overflow: "hidden",
};

const myWorkHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 34,
  position: "relative",
};

const myWorkTitleStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 4,
};

const myWorkTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 16,
  lineHeight: 1.2,
  fontWeight: 800,
  letterSpacing: 0,
};

const myWorkMetaStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const myWorkMatrixScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: "2px 10px 24px 0",
};

const myWorkMatrixGridStyle: React.CSSProperties = {
  minWidth: 1120,
  display: "grid",
  gridTemplateColumns: "142px repeat(4, minmax(220px, 1fr))",
  alignItems: "stretch",
  borderTop: "1px solid rgba(148, 163, 184, 0.34)",
  borderLeft: "1px solid rgba(148, 163, 184, 0.34)",
  background: "#ffffff",
};

const myWorkMatrixCornerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 3,
  minHeight: 36,
  display: "flex",
  alignItems: "center",
  borderRight: "1px solid rgba(148, 163, 184, 0.34)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  background: "#f8fafc",
  color: "#475569",
  fontSize: 11,
  fontWeight: 850,
  padding: "0 10px",
};

const myWorkMatrixColumnHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  minHeight: 36,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  borderRight: "1px solid rgba(148, 163, 184, 0.34)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  background: "#f8fafc",
  color: "#111827",
  fontSize: 12,
  fontWeight: 850,
  padding: "0 10px",
};

const myWorkMatrixPriorityHeaderStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  minHeight: 96,
  display: "flex",
  alignItems: "flex-start",
  borderRight: "1px solid rgba(148, 163, 184, 0.34)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  background: "#ffffff",
  color: "#334155",
  fontSize: 12,
  fontWeight: 850,
  padding: "12px 10px",
};

const myWorkMatrixCellStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 96,
  borderRight: "1px solid rgba(148, 163, 184, 0.34)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  background: "#ffffff",
  padding: "8px 6px 10px",
};

const myWorkMatrixCellEmptyStyle: React.CSSProperties = {
  minHeight: 62,
  display: "grid",
  placeItems: "center",
  color: "#94a3b8",
  fontSize: 11,
  fontWeight: 700,
};

const myWorkEmptyStyle: React.CSSProperties = {
  minHeight: 160,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 700,
};

const groupingPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  zIndex: 3,
  justifySelf: "end",
  width: "min(430px, 44vw)",
  minWidth: 280,
  display: "grid",
  gap: 6,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.10)",
  padding: 8,
};

const scopeControlRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 28px",
  gap: 6,
  alignItems: "center",
};

const scopeTabsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  overflow: "hidden",
};

function scopeTabStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    border: "none",
    borderRight: "1px solid rgba(15, 23, 42, 0.12)",
    background: active ? "#e2e8f0" : "#ffffff",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 650,
    cursor: "pointer",
  };
}

const collapseButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
};

const scopeLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#475569",
  fontSize: 11,
  fontWeight: 800,
};

const scopePickerStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 20,
  top: 43,
  right: 8,
  width: "min(360px, 80vw)",
  maxHeight: 320,
  overflow: "auto",
  display: "grid",
  gap: 1,
  padding: 6,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 18px 46px rgba(15, 23, 42, 0.18)",
};

function scopePickerRowStyle(depth: number, active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 28,
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    alignItems: "center",
    gap: 6,
    border: "1px solid transparent",
    borderRadius: 5,
    background: active ? "rgba(71, 85, 105, 0.12)" : "transparent",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: `3px 7px 3px ${7 + depth * 14}px`,
  };
}

const scopePickerTextStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 1,
};

const scopePickerLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 750,
};

const scopePickerDetailStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 650,
};

const scopePickerEmptyStyle: React.CSSProperties = {
  padding: 8,
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const groupingBodyStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "112px minmax(0, 1fr)",
  gap: 8,
  minWidth: 0,
};

const savedViewsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto",
  gap: 6,
  borderRight: "1px solid rgba(15, 23, 42, 0.12)",
  paddingRight: 7,
};

const savedViewsListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
};

function savedViewRowStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 18px",
    alignItems: "center",
    borderRadius: 5,
    background: active ? "rgba(71, 85, 105, 0.12)" : "transparent",
  };
}

const savedViewButtonStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 25,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 11,
  fontWeight: 750,
  textAlign: "left",
  cursor: "pointer",
  padding: "0 6px",
};

const savedViewDeleteStyle: React.CSSProperties = {
  width: 18,
  height: 24,
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 900,
  padding: 0,
};

const newViewButtonStyle: React.CSSProperties = {
  minHeight: 26,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
};

const groupingStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
};

function groupingRowStyle(index: number): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 46px 22px",
    alignItems: "center",
    gap: 5,
    marginLeft: index * 16,
    border: "1px solid rgba(15, 23, 42, 0.16)",
    borderRadius: 5,
    background: "#f8fafc",
    padding: "0 5px 0 8px",
  };
}

const groupingFieldLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 800,
};

const groupingDirectionButtonStyle: React.CSSProperties = {
  height: 22,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 10,
  fontWeight: 800,
  cursor: "pointer",
};

const groupingRemoveButtonStyle: React.CSSProperties = {
  height: 22,
  border: "none",
  background: "transparent",
  color: "#64748b",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
};

const addGroupingButtonStyle: React.CSSProperties = {
  minHeight: 28,
  border: "1px dashed rgba(15, 23, 42, 0.24)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 8px",
};

const addGroupingMenuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 22,
  top: "calc(100% + 4px)",
  left: 0,
  width: 180,
  display: "grid",
  gap: 2,
  padding: 5,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
};

const addGroupingOptionStyle: React.CSSProperties = {
  minHeight: 27,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  textAlign: "left",
  cursor: "pointer",
  padding: "0 7px",
};

const groupListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
};

const groupBlockStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 2,
};

function groupHeaderStyle(depth: number): React.CSSProperties {
  return {
    width: "max-content",
    maxWidth: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "14px 16px minmax(0, auto) auto",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    padding: "0 2px",
  };
}

const groupHeaderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 800,
};

const groupHeaderCountStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
};

const rowListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
};

const logicGateSectionBlockStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
};

function logicGateSectionRowStyle(depth: number): React.CSSProperties {
  return {
    width: "max-content",
    maxWidth: "min(980px, calc(100% - 16px))",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "14px 16px minmax(180px, auto) auto",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28 + 42,
    border: "none",
    background: "transparent",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    outline: "none",
    boxShadow: "none",
    padding: "0 2px",
  };
}

const logicGateNodeListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
};

const othersSectionBadgeStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 4,
  color: "#475569",
  background: "#f8fafc",
  fontSize: 10,
  lineHeight: 1,
  fontWeight: 850,
};

function workRowStyle(depth: number): React.CSSProperties {
  return {
    width: "min(980px, calc(100% - 16px))",
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "minmax(220px, 1.4fr) 92px minmax(120px, 0.8fr) 92px minmax(126px, 0.9fr) 96px",
    alignItems: "center",
    gap: 10,
    marginLeft: depth * 28 + 42,
    border: "none",
    borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
    background: "#ffffff",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: "0 8px",
  };
}

const workRowTitleCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 7,
};

const workRowTitleTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 780,
};

const workRowMetaCellStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#475569",
  fontSize: 11,
  fontWeight: 650,
};

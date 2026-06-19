import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../../modules/communications/communicationsApi";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { NodeRecord } from "../../modules/node-map/shared";
import { listMyWorkMatrixRows, type MyWorkResourceTree } from "../../modules/work-items/workItemReadApi";
import { cleanIDList, logicGateTitle } from "./homeUtils";
import { loadMyWorkMatrixCellsForUsers, type MyWorkMatrixCellWithUser, type MyWorkMatrixLoadFailure } from "./myWorkMatrixLoader";
import {
  DEFAULT_MY_WORK_GROUPINGS,
  MY_WORK_GROUPING_FIELDS,
  buildNestedGroups,
  computeAllExpandedGroupIDs,
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
  onOpenProject: (projectID: string, label: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInLogicGate?: (input: MyWorkNodeDropInput) => void;
  onCreateLogicGateInCell?: (input: MyWorkCellCreateInput) => void;
  onCreateNodeInCell?: (input: MyWorkCellCreateInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  onDropNodesInCell?: (input: MyWorkCellNodeDropInput) => void;
  onDropLogicGates?: (input: MyWorkCellLogicGateDropInput) => void;
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
type MyWorkMatrixPriority = typeof MY_WORK_MATRIX_PRIORITIES[number];
type MyWorkCellCreateInput = { priority: MyWorkMatrixPriority; creatorGVICRole?: LogicGateGVICRole };
type MyWorkNodeDropInput = { logicGateID: string; nodeIDs: string[]; priority: MyWorkMatrixPriority; fromLogicGateID?: string };
type MyWorkCellNodeDropInput = MyWorkCellCreateInput & { nodeIDs: string[]; fromLogicGateID?: string };
type MyWorkCellLogicGateDropInput = MyWorkCellCreateInput & { logicGateIDs: string[]; nodeIDsByLogicGateID?: Record<string, string[]> };
type MyWorkNodeDragPayload = { nodeIDs: string[]; fromLogicGateID?: string };
type MyWorkLogicGateDragPayload = { logicGateIDs: string[]; nodeIDsByLogicGateID?: Record<string, string[]> };
const HOME_INBOX_NODE_DRAG_MIME = "application/x-mangorts-home-inbox-node";
const HOME_INBOX_LOGIC_GATE_DRAG_MIME = "application/x-mangorts-home-inbox-logic-gate";

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
  onOpenProject,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onCreateNodeInLogicGate,
  onCreateLogicGateInCell,
  onCreateNodeInCell,
  onDropNodes,
  onDropNodesInCell,
  onDropLogicGates,
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
  const [matrixCells, setMatrixCells] = useState<MyWorkMatrixCellWithUser[]>([]);
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
      setMatrixCells([]);
      setMatrixError("");
      setMatrixLoading(false);
      return;
    }
    let cancelled = false;
    setMatrixLoading(true);
    setMatrixError("");
    void loadMyWorkMatrixCellsForUsers({
      companyID,
      targetUserIDs,
      fetchMatrix: (targetUserID) => listMyWorkMatrixRows({ apiBase, companyID, targetUserID }),
    }).then(({ cells, failures }) => {
      if (cancelled) return;
      setMatrixCells(cells);
      setMatrixError(myWorkMatrixFailureMessage(failures, targetUserIDs, userByID));
    }).finally(() => {
      if (!cancelled) setMatrixLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, targetUserIDs, userByID]);

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
    matrixCells,
    userByID,
    groupByID,
    groupIDsByUserID,
  }), [groupByID, groupIDsByUserID, matrixCells, userByID]);

  const visibleRows = rows;
  const nestedGroups = useMemo(() => buildNestedGroups(visibleRows, selectedSetting.groupings), [selectedSetting.groupings, visibleRows]);
  const groupingSignature = useMemo(() => JSON.stringify({
    setting: selectedSetting.setting_id,
    scope: selectedSetting.selected_scope,
    groupings: selectedSetting.groupings,
    rows: visibleRows.map((row) => row.rowKey ?? `${row.kind}:${row.id}`).sort(),
  }), [selectedSetting.groupings, selectedSetting.selected_scope, selectedSetting.setting_id, visibleRows]);

  useEffect(() => {
    setExpandedGroupIDs(computeAllExpandedGroupIDs(nestedGroups));
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
            {scopeLabel}
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
            onOpenProject={onOpenProject}
            onOpenNodeBulkMenu={onOpenNodeBulkMenu}
            onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
            onCreateNodeInLogicGate={onCreateNodeInLogicGate}
            onCreateLogicGateInCell={onCreateLogicGateInCell}
            onCreateNodeInCell={onCreateNodeInCell}
            onDropNodes={onDropNodes}
            onDropNodesInCell={onDropNodesInCell}
            onDropLogicGates={onDropLogicGates}
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
  onOpenProject,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onCreateNodeInLogicGate,
  onDropNodes,
  nodeByID,
  logicGateByID,
}: {
  groups: MyWorkNestedGroup[];
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInLogicGate?: (input: MyWorkNodeDropInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  return (
    <div style={groupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const leafRows = group.groups.length === 0 ? group.rows : [];
        const resourceTarget = myWorkGroupResourceTarget(group);
        return (
          <div key={group.id} style={groupBlockStyle}>
            <div style={groupHeaderStyle(group.depth)}>
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                style={disclosureButtonStyle}
                onClick={() => onToggleGroup(group.id)}
              >
                <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              </button>
              {resourceTarget ? (
                <button type="button" style={groupHeaderResourceButtonStyle} onClick={() => onOpenProject(resourceTarget.id, resourceTarget.label)}>
                  <GroupHeaderIcon field={group.field} />
                  <span style={groupHeaderLabelStyle}>{group.label}</span>
                </button>
              ) : (
                <span style={groupHeaderStaticContentStyle}>
                  <GroupHeaderIcon field={group.field} />
                  <span style={groupHeaderLabelStyle}>{group.label}</span>
                </span>
              )}
            </div>
            {open && group.groups.length > 0 && (
              <MyWorkGroupList
                groups={group.groups}
                expandedGroupIDs={expandedGroupIDs}
                onToggleGroup={onToggleGroup}
                onOpenNode={onOpenNode}
                onOpenLogicGate={onOpenLogicGate}
                onOpenProject={onOpenProject}
                onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
                onCreateNodeInLogicGate={onCreateNodeInLogicGate}
                onDropNodes={onDropNodes}
                nodeByID={nodeByID}
                logicGateByID={logicGateByID}
              />
            )}
            {open && leafRows.length > 0 && (
              <MyWorkRows rows={leafRows} depth={group.depth + 1} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} onOpenProject={onOpenProject} onOpenNodeBulkMenu={onOpenNodeBulkMenu} onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu} onCreateNodeInLogicGate={onCreateNodeInLogicGate} onDropNodes={onDropNodes} nodeByID={nodeByID} logicGateByID={logicGateByID} />
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
  onOpenProject,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onCreateNodeInLogicGate,
  onDropNodes,
  nodeByID,
  logicGateByID,
}: {
  rows: MyWorkResourceRow[];
  depth: number;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInLogicGate?: (input: MyWorkNodeDropInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  return (
    <div style={rowListStyle}>
      {sortMyWorkRows(rows).map((row) => (
        <MyWorkTreeRow
          key={row.rowKey ?? `${row.kind}:${row.id}`}
          row={row}
          depth={depth}
          onOpenNode={onOpenNode}
          onOpenLogicGate={onOpenLogicGate}
          onOpenProject={onOpenProject}
          onOpenNodeBulkMenu={onOpenNodeBulkMenu}
          onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
          onCreateNodeInLogicGate={onCreateNodeInLogicGate}
          onDropNodes={onDropNodes}
          nodeByID={nodeByID}
          logicGateByID={logicGateByID}
        />
      ))}
    </div>
  );
}

function MyWorkTreeRow({
  row,
  depth,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onCreateNodeInLogicGate,
  onDropNodes,
  nodeByID,
  logicGateByID,
}: {
  row: MyWorkResourceRow;
  depth: number;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInLogicGate?: (input: MyWorkNodeDropInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  const children = row.children ?? [];
  const primaryPerson = row.people[0]?.label ?? "Unassigned";
  const status = row.status?.trim() || "No status";
  const priority = Number.isFinite(Number(row.priority)) && Number(row.priority) > 0 ? priorityLabel(Number(row.priority)) : "No priority";
  const dueDate = row.dueDate?.trim() || "No due date";
  const actionPriority = priorityBucket(row.priority);
  const rowLogicGateID = row.kind === "logic_gate" ? row.id.trim() : row.logicGateIDs[0]?.trim() ?? "";
  return (
    <div style={logicGateSectionBlockStyle}>
      <div
        style={workRowStyle(depth)}
        draggable={row.kind === "node" || row.kind === "logic_gate"}
        onContextMenu={(event) => {
          if (row.kind === "node" && onOpenNodeBulkMenu) onOpenNodeBulkMenu(row.id, event);
          if (row.kind === "logic_gate" && onOpenLogicGateBulkMenu) onOpenLogicGateBulkMenu(row.id, event);
        }}
        onDragStart={(event) => {
          if (row.kind === "node") {
            writeMyWorkDragPayload(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME, { nodeIDs: [row.id], fromLogicGateID: rowLogicGateID });
          } else if (row.kind === "logic_gate") {
            writeMyWorkDragPayload(event.dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME, { logicGateIDs: [row.id], nodeIDsByLogicGateID: { [row.id]: collectMyWorkNodeIDs(row) } });
          }
        }}
        onDragOver={(event) => {
          if (row.kind !== "logic_gate" || !onDropNodes) return;
          const payload = readMyWorkDragPayload<MyWorkNodeDragPayload>(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
          if (!payload || cleanIDList(payload.nodeIDs).length === 0) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (row.kind !== "logic_gate" || !onDropNodes) return;
          const payload = readMyWorkDragPayload<MyWorkNodeDragPayload>(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
          const nodeIDs = cleanIDList(payload?.nodeIDs ?? []);
          if (nodeIDs.length === 0) return;
          event.preventDefault();
          event.stopPropagation();
          onDropNodes({ logicGateID: row.id, nodeIDs, priority: actionPriority, fromLogicGateID: payload?.fromLogicGateID });
        }}
      >
        <button
          type="button"
          style={workRowTitleCellButtonStyle}
          onClick={() => openMyWorkRowResource(row, nodeByID, logicGateByID, onOpenNode, onOpenLogicGate, onOpenProject)}
        >
          <ExplorerRowIcon kind={row.kind} />
          <span style={workRowTitleTextStyle}>{row.title}</span>
        </button>
        <span style={workRowMetaCellStyle}>{myWorkKindLabel(row.kind)}</span>
        {row.kind === "logic_gate" && onCreateNodeInLogicGate ? (
          <button type="button" style={myWorkInlineActionButtonStyle} onClick={() => onCreateNodeInLogicGate({ logicGateID: row.id, nodeIDs: [], priority: actionPriority })}>Node</button>
        ) : (
          <span style={workRowMetaCellStyle}>{primaryPerson}</span>
        )}
        <span style={workRowMetaCellStyle}>{status}</span>
        <span style={workRowMetaCellStyle}>{priority}</span>
        <span style={workRowMetaCellStyle}>{dueDate}</span>
      </div>
      {children.length > 0 && (
        <div style={logicGateNodeListStyle}>
          {sortMyWorkRows(children).map((child) => (
            <MyWorkTreeRow
              key={child.rowKey ?? `${row.rowKey}:${child.kind}:${child.id}`}
              row={child}
              depth={depth + 1}
              onOpenNode={onOpenNode}
              onOpenLogicGate={onOpenLogicGate}
              onOpenProject={onOpenProject}
              onOpenNodeBulkMenu={onOpenNodeBulkMenu}
              onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
              onCreateNodeInLogicGate={onCreateNodeInLogicGate}
              onDropNodes={onDropNodes}
              nodeByID={nodeByID}
              logicGateByID={logicGateByID}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type MyWorkGroupResourceTarget = {
  kind: "project";
  id: string;
  label: string;
};

function myWorkGroupResourceTarget(group: MyWorkNestedGroup): MyWorkGroupResourceTarget | null {
  if (group.field !== "project") return null;
  const rows = collectMyWorkGroupRows(group);
  const projectLabelsByID = new Map<string, string>();
  for (const row of rows) {
    const projectID = row.projectID?.trim() ?? "";
    if (!projectID) continue;
    const label = row.projectName?.trim() || row.projectLabels?.find((projectLabel) => projectLabel.trim())?.trim() || group.label;
    projectLabelsByID.set(projectID, label);
  }
  if (projectLabelsByID.size !== 1) return null;
  const [id, label] = projectLabelsByID.entries().next().value as [string, string];
  return { kind: "project", id, label: label || group.label };
}

function collectMyWorkGroupRows(group: MyWorkNestedGroup): MyWorkResourceRow[] {
  const rows = [...group.rows];
  for (const child of group.groups) rows.push(...collectMyWorkGroupRows(child));
  return rows;
}

function openMyWorkRowResource(
  row: MyWorkResourceRow,
  nodeByID: Map<string, NodeRecord>,
  logicGateByID: Map<string, LogicGateRecord>,
  onOpenNode: (node: NodeRecord) => void,
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void,
  onOpenProject: (projectID: string, label: string) => void,
) {
  if (row.kind === "project") {
    const projectID = row.projectID?.trim() || row.id.trim();
    if (projectID) onOpenProject(projectID, row.title?.trim() || projectID);
    return;
  }
  if (row.kind === "node") {
    const node = nodeByID.get(row.id) ?? nodeRecordFromMyWorkRow(row);
    if (node) onOpenNode(node);
    return;
  }
  const logicGateID = row.id.trim();
  if (!logicGateID) return;
  onOpenLogicGate(logicGateID, row.title?.trim() || logicGateTitle(logicGateByID.get(logicGateID)));
}

function myWorkKindLabel(kind: MyWorkResourceRow["kind"]): string {
  if (kind === "project") return "Project";
  if (kind === "logic_gate") return "Logic Gate";
  return "Node";
}

function MyWorkMatrix({
  rows,
  groupings,
  expandedGroupIDs,
  onToggleGroup,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onCreateNodeInLogicGate,
  onCreateLogicGateInCell,
  onCreateNodeInCell,
  onDropNodes,
  onDropNodesInCell,
  onDropLogicGates,
  nodeByID,
  logicGateByID,
}: {
  rows: MyWorkResourceRow[];
  groupings: MyWorkGroupingSetting[];
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInLogicGate?: (input: MyWorkNodeDropInput) => void;
  onCreateLogicGateInCell?: (input: MyWorkCellCreateInput) => void;
  onCreateNodeInCell?: (input: MyWorkCellCreateInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  onDropNodesInCell?: (input: MyWorkCellNodeDropInput) => void;
  onDropLogicGates?: (input: MyWorkCellLogicGateDropInput) => void;
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
            const createInput = { priority, creatorGVICRole: role };
            return (
              <div
                key={`${priority}:${role}`}
                style={myWorkMatrixCellStyle}
                onContextMenu={(event) => {
                  if (!onCreateNodeInCell) return;
                  event.preventDefault();
                  onCreateNodeInCell(createInput);
                }}
                onDragOver={(event) => {
                  if (!onDropNodesInCell && !onDropLogicGates) return;
                  const nodePayload = readMyWorkDragPayload<MyWorkNodeDragPayload>(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
                  const gatePayload = readMyWorkDragPayload<MyWorkLogicGateDragPayload>(event.dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME);
                  if (cleanIDList(nodePayload?.nodeIDs ?? []).length === 0 && cleanIDList(gatePayload?.logicGateIDs ?? []).length === 0) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  const nodePayload = readMyWorkDragPayload<MyWorkNodeDragPayload>(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
                  const gatePayload = readMyWorkDragPayload<MyWorkLogicGateDragPayload>(event.dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME);
                  const nodeIDs = cleanIDList(nodePayload?.nodeIDs ?? []);
                  const logicGateIDs = cleanIDList(gatePayload?.logicGateIDs ?? []);
                  if (nodeIDs.length === 0 && logicGateIDs.length === 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (logicGateIDs.length > 0 && onDropLogicGates) onDropLogicGates({ ...createInput, logicGateIDs, nodeIDsByLogicGateID: gatePayload?.nodeIDsByLogicGateID });
                  if (nodeIDs.length > 0 && onDropNodesInCell) onDropNodesInCell({ ...createInput, nodeIDs, fromLogicGateID: nodePayload?.fromLogicGateID });
                }}
              >
                {(onCreateNodeInCell || onCreateLogicGateInCell) && (
                  <div style={myWorkCellActionRowStyle}>
                    {onCreateNodeInCell && <button type="button" style={myWorkCellActionButtonStyle} onClick={() => onCreateNodeInCell(createInput)}>Node</button>}
                    {onCreateLogicGateInCell && <button type="button" style={myWorkCellActionButtonStyle} onClick={() => onCreateLogicGateInCell(createInput)}>Gate</button>}
                  </div>
                )}
                {cellRows.length === 0 ? (
                  <div style={myWorkMatrixCellEmptyStyle}>No active work</div>
                ) : groups.length > 0 ? (
                  <MyWorkGroupList
                    groups={groups}
                    expandedGroupIDs={expandedGroupIDs}
                    onToggleGroup={onToggleGroup}
                    onOpenNode={onOpenNode}
                    onOpenLogicGate={onOpenLogicGate}
                    onOpenProject={onOpenProject}
                    onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                    onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
                    onCreateNodeInLogicGate={onCreateNodeInLogicGate}
                    onDropNodes={onDropNodes}
                    nodeByID={nodeByID}
                    logicGateByID={logicGateByID}
                  />
                ) : (
                  <MyWorkRows rows={cellRows} depth={0} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} onOpenProject={onOpenProject} onOpenNodeBulkMenu={onOpenNodeBulkMenu} onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu} onCreateNodeInLogicGate={onCreateNodeInLogicGate} onDropNodes={onDropNodes} nodeByID={nodeByID} logicGateByID={logicGateByID} />
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
  matrixCells,
  userByID,
  groupByID,
  groupIDsByUserID,
}: {
  matrixCells: MyWorkMatrixCellWithUser[];
  userByID: Map<string, CompanyUser>;
  groupByID: Map<string, CompanyUserGroup>;
  groupIDsByUserID: Map<string, string[]>;
}): MyWorkResourceRow[] {
  const rows: MyWorkResourceRow[] = [];
  for (const cell of matrixCells) {
    const role = normalizeGVICRole(cell.role);
    if (!role) continue;
    const userID = cell.userID.trim();
    for (const root of cell.roots ?? []) {
      rows.push(myWorkTreeToRow({
        tree: root,
        companyID: cell.companyID,
        role,
        userID,
        cellPriority: cell.priority,
        userByID,
        groupByID,
        groupIDsByUserID,
      }));
    }
  }

  return sortMyWorkRows(rows);
}

function myWorkTreeToRow({
  tree,
  companyID,
  role,
  userID,
  cellPriority,
  userByID,
  groupByID,
  groupIDsByUserID,
  inheritedProjectID = "",
  inheritedProjectName = "",
  inheritedLogicGateID = "",
  inheritedLogicGateName = "",
  path = "",
}: {
  tree: MyWorkResourceTree;
  companyID: string;
  role: LogicGateGVICRole;
  userID: string;
  cellPriority: number | null;
  userByID: Map<string, CompanyUser>;
  groupByID: Map<string, CompanyUserGroup>;
  groupIDsByUserID: Map<string, string[]>;
  inheritedProjectID?: string;
  inheritedProjectName?: string;
  inheritedLogicGateID?: string;
  inheritedLogicGateName?: string;
  path?: string;
}): MyWorkResourceRow {
  const kind = tree.kind;
  const id = tree.resource_id?.trim() || tree.project_id?.trim() || tree.logic_gate_id?.trim() || tree.node_id?.trim() || "";
  const projectID = kind === "project" ? (tree.project_id?.trim() || id) : inheritedProjectID;
  const projectName = kind === "project" ? (tree.name?.trim() || id) : inheritedProjectName;
  const logicGateID = kind === "logic_gate" ? (tree.logic_gate_id?.trim() || id) : inheritedLogicGateID;
  const logicGateName = kind === "logic_gate" ? (tree.name?.trim() || id) : inheritedLogicGateName;
  const people = userID ? [personForUserID(userID, userByID)] : [];
  const nextPath = `${path}/${kind}:${id}`;
  return {
    rowKey: `${userID}:${role}:${cellPriority ?? "none"}:${nextPath}`,
    companyID,
    kind,
    id,
    title: tree.name?.trim() || myWorkKindLabel(kind),
    status: tree.status,
    dueDate: tree.due_date,
    priority: tree.priority ?? cellPriority,
    accounts: tree.accounts ?? [],
    projectLabels: projectName ? [projectName] : [],
    people,
    teams: teamsForUsers(userID ? [userID] : [], groupIDsByUserID, groupByID),
    gvicRoles: [role],
    primaryGVICRole: role,
    participantUserIDs: userID ? [userID] : [],
    projectID,
    projectName,
    logicGateLabels: logicGateName ? [logicGateName] : [],
    logicGateIDs: logicGateID ? [logicGateID] : [],
    children: (tree.children ?? []).map((child) => myWorkTreeToRow({
      tree: child,
      companyID,
      role,
      userID,
      cellPriority,
      userByID,
      groupByID,
      groupIDsByUserID,
      inheritedProjectID: projectID,
      inheritedProjectName: projectName,
      inheritedLogicGateID: logicGateID,
      inheritedLogicGateName: logicGateName,
      path: nextPath,
    })),
  };
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

function writeMyWorkDragPayload(dataTransfer: DataTransfer, mime: string, payload: unknown): void {
  dataTransfer.effectAllowed = "move";
  dataTransfer.setData(mime, JSON.stringify(payload));
  dataTransfer.setData("text/plain", "");
}

function readMyWorkDragPayload<T>(dataTransfer: DataTransfer, mime: string): T | null {
  const raw = dataTransfer.getData(mime);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function collectMyWorkNodeIDs(row: MyWorkResourceRow): string[] {
  const ids: string[] = [];
  const visit = (item: MyWorkResourceRow) => {
    if (item.kind === "node" && item.id.trim()) ids.push(item.id.trim());
    for (const child of item.children ?? []) visit(child);
  };
  visit(row);
  return cleanIDList(ids);
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

function myWorkMatrixFailureMessage(failures: MyWorkMatrixLoadFailure[], targetUserIDs: string[], userByID: Map<string, CompanyUser>): string {
  if (failures.length === 0) return "";
  const total = new Set(targetUserIDs.map((id) => id.trim()).filter(Boolean)).size;
  if (failures.length >= total) {
    return failures[0]?.message || "Failed to load My Work";
  }
  if (failures.length === 1) {
    const failedUserID = failures[0].userID;
    return `Failed to load My Work for ${userLabel(userByID.get(failedUserID), failedUserID)}`;
  }
  return `Failed to load My Work for ${failures.length} people`;
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
  if (field === "project") return <ExplorerRowIcon kind="project" />;
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

const myWorkCellActionRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "flex-end",
  gap: 5,
  marginBottom: 6,
};

const myWorkCellActionButtonStyle: React.CSSProperties = {
  minHeight: 22,
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 10,
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 7px",
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
    gridTemplateColumns: "14px minmax(0, auto)",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28,
    border: "none",
    borderRadius: 0,
    background: "transparent",
    color: "#111827",
    textAlign: "left",
    padding: "0 2px",
  };
}

const disclosureButtonStyle: React.CSSProperties = {
  width: 14,
  height: 24,
  minWidth: 14,
  border: "none",
  background: "transparent",
  color: "inherit",
  display: "grid",
  placeItems: "center",
  padding: 0,
  cursor: "pointer",
};

const groupHeaderResourceButtonStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
};

const groupHeaderStaticContentStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
};

const groupHeaderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
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

const logicGateNodeListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
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
    padding: "0 8px",
  };
}

const workRowTitleCellButtonStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 7,
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
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

const myWorkInlineActionButtonStyle: React.CSSProperties = {
  minWidth: 0,
  width: "max-content",
  minHeight: 22,
  border: "1px solid rgba(100, 116, 139, 0.22)",
  borderRadius: 5,
  background: "#f8fafc",
  color: "#334155",
  font: "inherit",
  fontSize: 10,
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 7px",
};

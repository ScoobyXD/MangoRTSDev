import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import {
  fetchUpdateBranch,
  fetchUpdateRootGroups,
  markNotificationRead,
  NOTIFICATION_TYPE_MENTION,
  NOTIFICATION_TYPE_URGENT_MENTION,
  type NotificationItem,
  type UpdateFeedFilter,
  type UpdateGroup,
} from "../../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../../modules/notifications/notificationTime";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalNestedGroup } from "./universalGrouping";

type UpdatesViewProps = {
  companyID: string;
  currentUserID: string;
  onOpenNode: (nodeID: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
};

type UpdateGroupingField = "project" | "logic_gate" | "node" | "type" | "date" | "read_state" | "gvic";
type UpdateGroupingDirection = "asc" | "desc";

type UpdateGroupingSetting = {
  field: UpdateGroupingField;
  direction: UpdateGroupingDirection;
};

type UpdateSavedGroupingSetting = {
  setting_id: string;
  company_id: string;
  user_id: string;
  surface: "updates";
  name: string;
  groupings: UpdateGroupingSetting[];
  panel_collapsed: boolean;
  created_timestamp: string;
  updated_timestamp: string;
};

type UpdateRowResource = {
  id: string;
  label: string;
};

type UpdateFeedRow = {
  rowKey: string;
  item: NotificationItem;
  project?: UpdateRowResource;
  logicGate?: UpdateRowResource;
  node?: UpdateRowResource;
};

const UPDATE_FILTERS: ReadonlyArray<{ value: UpdateFeedFilter; label: string; title: string }> = [
  { value: "urgent", label: "!", title: "Urgent mentions" },
  { value: "mention", label: "@", title: "Mentions" },
  { value: "update", label: "Updates", title: "Updates" },
  { value: "all", label: "All", title: "All updates" },
];

const UPDATE_GROUPING_FIELDS: ReadonlyArray<{ value: UpdateGroupingField; label: string }> = [
  { value: "project", label: "Project" },
  { value: "logic_gate", label: "Logic Gate" },
  { value: "node", label: "Node" },
  { value: "type", label: "Update Type" },
  { value: "date", label: "Date" },
  { value: "read_state", label: "Read State" },
  { value: "gvic", label: "GVIC" },
];

const DEFAULT_UPDATE_GROUPINGS: UpdateGroupingSetting[] = [
  { field: "project", direction: "asc" },
  { field: "logic_gate", direction: "asc" },
  { field: "node", direction: "asc" },
];

const UPDATE_GROUPING_FIELD_SET = new Set<UpdateGroupingField>(UPDATE_GROUPING_FIELDS.map((field) => field.value));
const SAVED_UPDATE_GROUPING_SETTINGS_STORAGE_PREFIX = "mangorts.updates.grouping_settings.v1";

export function UpdatesView({ companyID, currentUserID, onOpenNode, onOpenLogicGate, onOpenProject }: UpdatesViewProps) {
  const [rootGroups, setRootGroups] = useState<UpdateGroup[]>([]);
  const [branchByRootID, setBranchByRootID] = useState<Record<string, UpdateGroup>>({});
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [branchLoadingIDs, setBranchLoadingIDs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<UpdateFeedFilter>("all");
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const fallbackSetting = useMemo(() => createDefaultUpdateGroupingSetting(companyID, currentUserID), [companyID, currentUserID]);
  const storageKey = useMemo(() => savedUpdateGroupingSettingsStorageKey(companyID, currentUserID), [companyID, currentUserID]);
  const [settings, setSettings] = useState<UpdateSavedGroupingSetting[]>(() => readSavedUpdateGroupingSettings(storageKey, fallbackSetting));
  const [selectedSettingID, setSelectedSettingID] = useState(settings[0]?.setting_id ?? "");
  const [addGroupingOpen, setAddGroupingOpen] = useState(false);
  const [groupingFieldMenuIndex, setGroupingFieldMenuIndex] = useState<number | null>(null);

  useEffect(() => {
    const next = readSavedUpdateGroupingSettings(storageKey, fallbackSetting);
    setSettings(next);
    setSelectedSettingID(next[0]?.setting_id ?? "");
  }, [fallbackSetting, storageKey]);

  useEffect(() => {
    writeSavedUpdateGroupingSettings(storageKey, settings);
  }, [settings, storageKey]);

  useEffect(() => {
    if (settings.some((setting) => setting.setting_id === selectedSettingID)) return;
    setSelectedSettingID(settings[0]?.setting_id ?? "");
  }, [selectedSettingID, settings]);

  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;

  const updateSelectedSetting = useCallback((updater: (setting: UpdateSavedGroupingSetting) => UpdateSavedGroupingSetting) => {
    setSettings((current) => current.map((setting) => {
      if (setting.setting_id !== selectedSetting.setting_id) return setting;
      const next = updater(setting);
      return {
        ...next,
        groupings: normalizeUpdateGroupingStack(next.groupings),
        updated_timestamp: new Date().toISOString(),
      };
    }));
  }, [selectedSetting.setting_id]);

  const addSavedView = useCallback(() => {
    const now = new Date().toISOString();
    const setting: UpdateSavedGroupingSetting = {
      ...selectedSetting,
      setting_id: createLocalID(),
      name: `View ${settings.length + 1}`,
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

  const updateGrouping = useCallback((index: number, grouping: UpdateGroupingSetting) => {
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: setting.groupings.map((item, itemIndex) => (itemIndex === index ? grouping : item)),
    }));
  }, [updateSelectedSetting]);

  const removeGrouping = useCallback((index: number) => {
    setGroupingFieldMenuIndex(null);
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: setting.groupings.length <= 1 ? setting.groupings : setting.groupings.filter((_, itemIndex) => itemIndex !== index),
    }));
  }, [updateSelectedSetting]);

  const addGrouping = useCallback((field: UpdateGroupingField) => {
    setGroupingFieldMenuIndex(null);
    updateSelectedSetting((setting) => ({
      ...setting,
      groupings: [...setting.groupings, { field, direction: "asc" }],
    }));
    setAddGroupingOpen(false);
  }, [updateSelectedSetting]);

  const loadBranch = useCallback((rootID: string) => {
    const cleanRootID = rootID.trim();
    if (!companyID.trim() || !cleanRootID) return;
    if (branchByRootID[cleanRootID] || branchLoadingIDs.has(cleanRootID)) return;
    setBranchLoadingIDs((current) => new Set(current).add(cleanRootID));
    setError("");
    void fetchUpdateBranch({ companyID, filter, rootID: cleanRootID })
      .then((branch) => {
        setBranchByRootID((current) => ({ ...current, [cleanRootID]: branch }));
        setExpandedGroupIDs((current) => {
          const next = new Set(current);
          for (const groupID of collectUpdateGroupIDs(branch)) next.add(groupID);
          return next;
        });
      })
      .catch((nextError) => {
        setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
      })
      .finally(() => {
        setBranchLoadingIDs((current) => {
          const next = new Set(current);
          next.delete(cleanRootID);
          return next;
        });
      });
  }, [branchByRootID, branchLoadingIDs, companyID, filter]);

  useEffect(() => {
    if (!companyID.trim()) {
      setRootGroups([]);
      setBranchByRootID({});
      setExpandedGroupIDs(new Set());
      return;
    }
    let cancelled = false;
    setLoadingRoots(true);
    setError("");
    setBranchByRootID({});
    setBranchLoadingIDs(new Set());
    setExpandedGroupIDs(new Set());
    void fetchUpdateRootGroups({ companyID, filter })
      .then(async (roots) => {
        if (cancelled) return;
        setRootGroups(roots);
        if (roots.length === 0) return;
        const rootIDs = roots.map((root) => root.id);
        setExpandedGroupIDs(new Set(rootIDs));
        setBranchLoadingIDs(new Set(rootIDs));
        const branchResults = await Promise.allSettled(roots.map(async (root) => ({
          rootID: root.id,
          branch: await fetchUpdateBranch({ companyID, filter, rootID: root.id }),
        })));
        if (cancelled) return;
        const nextBranches: Record<string, UpdateGroup> = {};
        let failed = false;
        for (const result of branchResults) {
          if (result.status === "fulfilled") nextBranches[result.value.rootID] = result.value.branch;
          else failed = true;
        }
        setBranchByRootID(nextBranches);
        const nextExpanded = new Set<string>();
        for (const branch of Object.values(nextBranches)) {
          for (const groupID of collectUpdateGroupIDs(branch)) nextExpanded.add(groupID);
        }
        setExpandedGroupIDs(nextExpanded.size > 0 ? nextExpanded : new Set(rootIDs));
        if (failed) setError("Failed to load some Updates");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setRootGroups([]);
        setError(nextError instanceof Error ? nextError.message : "Failed to load Updates");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRoots(false);
          setBranchLoadingIDs(new Set());
        }
      });
    return () => { cancelled = true; };
  }, [companyID, filter]);

  const sourceGroups = useMemo(() => rootGroups.map((root) => branchByRootID[root.id] ?? root), [branchByRootID, rootGroups]);
  const updateRows = useMemo(() => flattenUpdateRows(sourceGroups), [sourceGroups]);
  const displayGroups = useMemo(() => buildUpdateDisplayGroups(updateRows, selectedSetting.groupings), [selectedSetting.groupings, updateRows]);
  const groupingSignature = useMemo(() => JSON.stringify({
    setting: selectedSetting.setting_id,
    groupings: selectedSetting.groupings,
    rows: updateRows.map((row) => row.rowKey).sort(),
  }), [selectedSetting.groupings, selectedSetting.setting_id, updateRows]);
  const activeFieldSet = new Set(selectedSetting.groupings.map((grouping) => grouping.field));
  const addableFields = UPDATE_GROUPING_FIELDS.filter((field) => !activeFieldSet.has(field.value));

  useEffect(() => {
    const nextExpanded = new Set<string>();
    for (const group of displayGroups) {
      for (const groupID of collectUpdateGroupIDs(group)) nextExpanded.add(groupID);
    }
    setExpandedGroupIDs(nextExpanded);
  }, [displayGroups, groupingSignature]);

  const toggleGroup = useCallback((groupID: string) => {
    const isRoot = rootGroups.some((group) => group.id === groupID);
    const willOpen = !expandedGroupIDs.has(groupID);
    if (willOpen && isRoot && !branchByRootID[groupID]) loadBranch(groupID);
    setExpandedGroupIDs((current) => {
      const next = new Set(current);
      if (willOpen) next.add(groupID);
      else next.delete(groupID);
      return next;
    });
  }, [branchByRootID, expandedGroupIDs, loadBranch, rootGroups]);

  const openItem = useCallback((item: NotificationItem) => {
    if (item.notification_id && !item.read_timestamp) void markNotificationRead(item.notification_id, true).catch(() => undefined);
    const nodeID = item.node_id?.trim() || (item.entity_type === "node" ? item.entity_id.trim() : "");
    if (nodeID) {
      onOpenNode(nodeID);
      return;
    }
    const logicGateID = item.logic_gate_id?.trim() || (item.entity_type === "logic_gate" ? item.entity_id.trim() : "");
    if (logicGateID) {
      onOpenLogicGate(logicGateID, item.title);
      return;
    }
    const projectID = item.entity_type === "project" ? item.entity_id.trim() : "";
    if (projectID) onOpenProject(projectID, item.title);
  }, [onOpenLogicGate, onOpenNode, onOpenProject]);

  const openGroupResource = useCallback((group: UpdateGroup) => {
    const resourceID = group.resource_id?.trim() ?? "";
    if (!resourceID) return;
    if (group.resource_type === "node") onOpenNode(resourceID);
    if (group.resource_type === "logic_gate") onOpenLogicGate(resourceID, group.label);
    if (group.resource_type === "project") onOpenProject(resourceID, group.label);
  }, [onOpenLogicGate, onOpenNode, onOpenProject]);

  const meta = loadingRoots || branchLoadingIDs.size > 0 ? "Loading" : error;

  return (
    <section style={updatesShellStyle(selectedSetting.panel_collapsed)}>
      <UpdateGroupingPanel
        setting={selectedSetting}
        settings={settings}
        addableFields={addableFields}
        addGroupingOpen={addGroupingOpen}
        groupingFieldMenuIndex={groupingFieldMenuIndex}
        onSelectSetting={setSelectedSettingID}
        onAddSavedView={addSavedView}
        onDeleteSavedView={deleteSavedView}
        onToggleCollapsed={() => updateSelectedSetting((setting) => ({ ...setting, panel_collapsed: !setting.panel_collapsed }))}
        onUpdateGrouping={updateGrouping}
        onRemoveGrouping={removeGrouping}
        onSetAddGroupingOpen={setAddGroupingOpen}
        onSetGroupingFieldMenuIndex={setGroupingFieldMenuIndex}
        onAddGrouping={addGrouping}
      />
      <div style={updatesContentStyle}>
        <div style={updatesHeaderStyle}>
          <div style={updatesTitleStackStyle}>
            <h2 style={updatesTitleStyle}>Updates</h2>
            {meta && <div style={updatesMetaStyle}>{meta}</div>}
          </div>
          <div style={updatesFilterRowStyle}>
            {UPDATE_FILTERS.map((item) => (
              <button key={item.value} type="button" title={item.title} style={updatesFilterButtonStyle(filter === item.value)} onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mango-home-scroll" style={updatesListStyle}>
          {!loadingRoots && !error && displayGroups.length === 0 ? (
            <div style={updatesEmptyStyle}>No updates</div>
          ) : (
            <UpdateGroupList
              groups={displayGroups}
              expandedGroupIDs={expandedGroupIDs}
              branchLoadingIDs={branchLoadingIDs}
              onToggleGroup={toggleGroup}
              onOpenItem={openItem}
              onOpenGroupResource={openGroupResource}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function UpdateGroupingPanel({
  setting,
  settings,
  addableFields,
  addGroupingOpen,
  groupingFieldMenuIndex,
  onSelectSetting,
  onAddSavedView,
  onDeleteSavedView,
  onToggleCollapsed,
  onUpdateGrouping,
  onRemoveGrouping,
  onSetAddGroupingOpen,
  onSetGroupingFieldMenuIndex,
  onAddGrouping,
}: {
  setting: UpdateSavedGroupingSetting;
  settings: UpdateSavedGroupingSetting[];
  addableFields: ReadonlyArray<{ value: UpdateGroupingField; label: string }>;
  addGroupingOpen: boolean;
  groupingFieldMenuIndex: number | null;
  onSelectSetting: (settingID: string) => void;
  onAddSavedView: () => void;
  onDeleteSavedView: (settingID: string) => void;
  onToggleCollapsed: () => void;
  onUpdateGrouping: (index: number, grouping: UpdateGroupingSetting) => void;
  onRemoveGrouping: (index: number) => void;
  onSetAddGroupingOpen: (open: boolean) => void;
  onSetGroupingFieldMenuIndex: (index: number | null) => void;
  onAddGrouping: (field: UpdateGroupingField) => void;
}) {
  return (
    <aside style={updatesGroupingPanelStyle(setting.panel_collapsed)}>
      <div style={updatesGroupingPanelHeaderStyle}>
        <span style={updatesGroupingPanelTitleStyle}>Grouping Settings</span>
        <button type="button" title={setting.panel_collapsed ? "Expand grouping settings" : "Collapse grouping settings"} style={updatesGroupingCollapseButtonStyle} onClick={onToggleCollapsed}>
          <ExplorerDisclosureIcon open={!setting.panel_collapsed} color="currentColor" />
        </button>
      </div>
      {!setting.panel_collapsed && (
        <div style={updatesGroupingBodyStyle}>
          <div style={updatesSavedViewsStyle}>
            <div style={updatesSavedViewsListStyle}>
              {settings.map((item) => (
                <div key={item.setting_id} style={updatesSavedViewRowStyle(item.setting_id === setting.setting_id)}>
                  <button type="button" style={updatesSavedViewButtonStyle} onClick={() => onSelectSetting(item.setting_id)}>
                    {item.name}
                  </button>
                  <button type="button" title="Delete view" style={updatesSavedViewDeleteStyle} disabled={settings.length <= 1} onClick={() => onDeleteSavedView(item.setting_id)}>x</button>
                </div>
              ))}
            </div>
            <button type="button" style={updatesNewViewButtonStyle} onClick={onAddSavedView}>+ New View</button>
          </div>
          <div style={updatesGroupingStackStyle}>
            {setting.groupings.map((grouping, index) => (
              <div key={`${grouping.field}:${index}`} style={updatesGroupingRowStyle(index)}>
                <button
                  type="button"
                  style={updatesGroupingFieldButtonStyle}
                  onClick={() => {
                    onSetAddGroupingOpen(false);
                    onSetGroupingFieldMenuIndex(groupingFieldMenuIndex === index ? null : index);
                  }}
                >
                  {updateGroupingFieldLabel(grouping.field)}
                </button>
                {groupingFieldMenuIndex === index && (
                  <div style={updatesGroupingFieldMenuStyle}>
                    {UPDATE_GROUPING_FIELDS
                      .filter((field) => field.value === grouping.field || !setting.groupings.some((item, itemIndex) => itemIndex !== index && item.field === field.value))
                      .map((field) => (
                        <button
                          key={field.value}
                          type="button"
                          style={updatesGroupingFieldOptionStyle(field.value === grouping.field)}
                          onClick={() => {
                            onUpdateGrouping(index, { ...grouping, field: field.value });
                            onSetGroupingFieldMenuIndex(null);
                          }}
                        >
                          {field.label}
                        </button>
                      ))}
                  </div>
                )}
                <button
                  type="button"
                  style={updatesGroupingDirectionButtonStyle}
                  onClick={() => onUpdateGrouping(index, { ...grouping, direction: grouping.direction === "asc" ? "desc" : "asc" })}
                >
                  {grouping.direction === "asc" ? "Asc" : "Desc"}
                </button>
                <button type="button" title="Remove grouping" style={updatesGroupingRemoveButtonStyle} disabled={setting.groupings.length <= 1} onClick={() => onRemoveGrouping(index)}>x</button>
              </div>
            ))}
            <div style={{ position: "relative" }}>
              <button
                type="button"
                style={updatesAddGroupingButtonStyle}
                disabled={addableFields.length === 0}
                onClick={() => {
                  onSetGroupingFieldMenuIndex(null);
                  onSetAddGroupingOpen(!addGroupingOpen);
                }}
              >
                + Add Grouping
              </button>
              {addGroupingOpen && (
                <div style={updatesAddGroupingMenuStyle}>
                  {addableFields.map((field) => (
                    <button key={field.value} type="button" style={updatesAddGroupingOptionStyle} onClick={() => onAddGrouping(field.value)}>
                      {field.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

function UpdateGroupList({
  groups,
  expandedGroupIDs,
  branchLoadingIDs,
  onToggleGroup,
  onOpenItem,
  onOpenGroupResource,
}: {
  groups: UpdateGroup[];
  expandedGroupIDs: Set<string>;
  branchLoadingIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenItem: (item: NotificationItem) => void;
  onOpenGroupResource: (group: UpdateGroup) => void;
}) {
  return (
    <div style={updateGroupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const branchLoading = branchLoadingIDs.has(group.id);
        const rows = group.notifications ?? [];
        const canOpenResource = updateGroupCanOpenResource(group);
        return (
          <div key={group.id} style={updateGroupBlockStyle}>
            <div style={updateGroupHeaderStyle(group.depth)}>
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                style={updateDisclosureButtonStyle}
                onClick={() => onToggleGroup(group.id)}
              >
                <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              </button>
              {canOpenResource ? (
                <button type="button" style={updateGroupResourceButtonStyle} onClick={() => onOpenGroupResource(group)}>
                  <UpdateGroupIcon group={group} />
                  <span style={updateGroupLabelStyle}>{group.label}</span>
                </button>
              ) : (
                <span style={updateGroupStaticContentStyle}>
                  <UpdateGroupIcon group={group} />
                  <span style={updateGroupLabelStyle}>{group.label}</span>
                </span>
              )}
            </div>
            {open && branchLoading && <div style={updatesBranchLoadingStyle}>Loading branch</div>}
            {open && group.groups.length > 0 && (
              <UpdateGroupList groups={group.groups} expandedGroupIDs={expandedGroupIDs} branchLoadingIDs={branchLoadingIDs} onToggleGroup={onToggleGroup} onOpenItem={onOpenItem} onOpenGroupResource={onOpenGroupResource} />
            )}
            {open && rows.length > 0 && <UpdateRows rows={rows} depth={group.depth + 1} onOpenItem={onOpenItem} />}
          </div>
        );
      })}
    </div>
  );
}

function updateGroupCanOpenResource(group: UpdateGroup): boolean {
  return Boolean(
    group.resource_id?.trim()
      && (group.resource_type === "project" || group.resource_type === "logic_gate" || group.resource_type === "node"),
  );
}

function UpdateGroupIcon({ group }: { group: UpdateGroup }) {
  if (group.resource_type === "project" || group.resource_type === "logic_gate" || group.resource_type === "node") {
    return <ExplorerRowIcon kind={group.resource_type} />;
  }
  return <span style={updateGroupBadgeStyle}>U</span>;
}

function UpdateRows({ rows, depth, onOpenItem }: { rows: NotificationItem[]; depth: number; onOpenItem: (item: NotificationItem) => void }) {
  return (
    <div style={updateRowsStyle}>
      {rows.map((item, index) => (
        <button key={`${item.notification_id || item.source_event_id}:${index}`} type="button" style={updateRowStyle(depth, !item.read_timestamp, item.type === NOTIFICATION_TYPE_URGENT_MENTION)} onClick={() => onOpenItem(item)}>
          <span style={updateRowIconStyle(item.type === NOTIFICATION_TYPE_URGENT_MENTION)}>
            {updateRowIcon(item)}
          </span>
          <span style={updateRowTextStyle}>
            <span style={updateRowTitleStyle}>{item.title}</span>
            {item.body_preview && <span style={updateRowBodyStyle}>{item.body_preview}</span>}
          </span>
          <span style={updateRowTimeStyle}>{formatNotificationTimestamp(item.created_timestamp)}</span>
        </button>
      ))}
    </div>
  );
}

function updateRowIcon(item: NotificationItem): React.ReactNode {
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return "!";
  if (item.type === NOTIFICATION_TYPE_MENTION) return "@";
  if (item.entity_type === "node") return <ExplorerRowIcon kind="node" />;
  if (item.entity_type === "logic_gate") return <ExplorerRowIcon kind="logic_gate" />;
  if (item.entity_type === "project") return <ExplorerRowIcon kind="project" />;
  return "U";
}

function collectUpdateGroupIDs(group: UpdateGroup): string[] {
  const ids = [group.id];
  for (const child of group.groups) ids.push(...collectUpdateGroupIDs(child));
  return ids;
}

function flattenUpdateRows(groups: UpdateGroup[]): UpdateFeedRow[] {
  const rows: UpdateFeedRow[] = [];
  const visit = (group: UpdateGroup, path: { project?: UpdateRowResource; logicGate?: UpdateRowResource; node?: UpdateRowResource }) => {
    const nextPath = updatePathWithGroup(path, group);
    for (const item of group.notifications ?? []) {
      const notificationKey = item.notification_id?.trim() || item.source_event_id?.trim() || `${item.entity_type}:${item.entity_id}:${item.created_timestamp}`;
      const pathKey = [nextPath.project?.id, nextPath.logicGate?.id, nextPath.node?.id].filter(Boolean).join("/");
      rows.push({
        rowKey: `${notificationKey}:${pathKey || "updates"}`,
        item,
        ...nextPath,
      });
    }
    for (const child of group.groups) visit(child, nextPath);
  };
  for (const group of groups) visit(group, {});
  return sortUpdateRows(rows);
}

function updatePathWithGroup(path: { project?: UpdateRowResource; logicGate?: UpdateRowResource; node?: UpdateRowResource }, group: UpdateGroup): { project?: UpdateRowResource; logicGate?: UpdateRowResource; node?: UpdateRowResource } {
  const resourceID = group.resource_id?.trim() ?? "";
  const label = group.label.trim();
  if (!resourceID || !label) return path;
  if (group.resource_type === "project") return { ...path, project: { id: resourceID, label } };
  if (group.resource_type === "logic_gate") return { ...path, logicGate: { id: resourceID, label } };
  if (group.resource_type === "node") return { ...path, node: { id: resourceID, label } };
  return path;
}

function buildUpdateDisplayGroups(rows: UpdateFeedRow[], groupings: UpdateGroupingSetting[]): UpdateGroup[] {
  const cleanGroupings = normalizeUpdateGroupingStack(groupings);
  const groups = buildUniversalNestedGroups(rows, cleanGroupings, {
    rootID: "updates",
    rowKey: (row) => row.rowKey,
    getValues: getUpdateGroupValues,
    sortRows: sortUpdateRows,
  });
  return groups.map(convertUniversalUpdateGroup);
}

function convertUniversalUpdateGroup(group: UniversalNestedGroup<UpdateFeedRow, UpdateGroupingField>): UpdateGroup {
  const resource = updateGroupResourceFromValue(group.field, group.key);
  return {
    id: group.id,
    key: group.key,
    field: group.field,
    label: group.label,
    resource_type: resource?.type ?? "",
    resource_id: resource?.id ?? "",
    depth: group.depth,
    groups: group.groups.map(convertUniversalUpdateGroup),
    notifications: group.rows.map((row) => row.item),
  };
}

function getUpdateGroupValues(row: UpdateFeedRow, field: UpdateGroupingField): UniversalGroupValue[] {
  if (field === "project") return [updateResourceGroupValue("project", row.project, "No project")];
  if (field === "logic_gate") return [updateResourceGroupValue("logic_gate", row.logicGate, "No logic gate")];
  if (field === "node") return [updateResourceGroupValue("node", row.node, "No node")];
  if (field === "type") return [updateTypeGroupValue(row.item)];
  if (field === "date") return [updateDateGroupValue(row.item.created_timestamp)];
  if (field === "read_state") {
    const unread = !row.item.read_timestamp;
    return [{ key: unread ? "read_state:unread" : "read_state:read", label: unread ? "Unread" : "Read", sortValue: unread ? 1 : 2 }];
  }
  const role = row.item.role?.trim() ?? "";
  return role ? [{ key: `gvic:${role}`, label: updateGVICRoleLabel(role), sortValue: updateGVICRoleSort(role) }] : [{ key: "gvic:none", label: "No GVIC", sortValue: 99, sortLast: true }];
}

function updateResourceGroupValue(field: "project" | "logic_gate" | "node", resource: UpdateRowResource | undefined, emptyLabel: string): UniversalGroupValue {
  if (!resource?.id.trim()) return { key: `${field}:none`, label: emptyLabel, sortValue: "", sortLast: true };
  return { key: `${field}:${resource.id}`, label: resource.label, sortValue: resource.label.toLowerCase() };
}

function updateTypeGroupValue(item: NotificationItem): UniversalGroupValue {
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return { key: "type:urgent", label: "Urgent mentions", sortValue: 1 };
  if (item.type === NOTIFICATION_TYPE_MENTION) return { key: "type:mention", label: "Mentions", sortValue: 2 };
  return { key: "type:update", label: "Updates", sortValue: 3 };
}

function updateDateGroupValue(createdTimestamp: string): UniversalGroupValue {
  const dateKey = createdTimestamp.trim().slice(0, 10);
  if (!dateKey) return { key: "date:none", label: "No date", sortValue: "", sortLast: true };
  return { key: `date:${dateKey}`, label: dateKey, sortValue: dateKey };
}

function updateGroupResourceFromValue(field: UpdateGroupingField, key: string): { type: "project" | "logic_gate" | "node"; id: string } | null {
  if (field !== "project" && field !== "logic_gate" && field !== "node") return null;
  const prefix = `${field}:`;
  if (!key.startsWith(prefix)) return null;
  const id = key.slice(prefix.length).trim();
  if (!id || id === "none") return null;
  return { type: field, id };
}

function sortUpdateRows(rows: UpdateFeedRow[]): UpdateFeedRow[] {
  return [...rows].sort((left, right) => {
    const leftTime = Date.parse(left.item.created_timestamp);
    const rightTime = Date.parse(right.item.created_timestamp);
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0)
      || left.item.title.localeCompare(right.item.title, undefined, { numeric: true, sensitivity: "base" })
      || left.rowKey.localeCompare(right.rowKey);
  });
}

function updateGroupingFieldLabel(field: UpdateGroupingField): string {
  return UPDATE_GROUPING_FIELDS.find((item) => item.value === field)?.label ?? "Field";
}

function normalizeUpdateGroupingStack(value: unknown): UpdateGroupingSetting[] {
  if (!Array.isArray(value)) return [...DEFAULT_UPDATE_GROUPINGS];
  const out: UpdateGroupingSetting[] = [];
  const seen = new Set<UpdateGroupingField>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as { field?: unknown; direction?: unknown };
    if (typeof candidate.field !== "string" || !UPDATE_GROUPING_FIELD_SET.has(candidate.field as UpdateGroupingField)) continue;
    const field = candidate.field as UpdateGroupingField;
    if (seen.has(field)) continue;
    seen.add(field);
    out.push({ field, direction: candidate.direction === "desc" ? "desc" : "asc" });
  }
  return out.length > 0 ? out : [...DEFAULT_UPDATE_GROUPINGS];
}

function updateGVICRoleLabel(role: string): string {
  if (role === "generated") return "Generated";
  if (role === "verified") return "Verified";
  if (role === "consulted") return "Consulted";
  if (role === "informed") return "Informed";
  if (role === "other") return "Other";
  return role.trim().replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function updateGVICRoleSort(role: string): number {
  if (role === "generated") return 1;
  if (role === "verified") return 2;
  if (role === "consulted") return 3;
  if (role === "informed") return 4;
  if (role === "other") return 5;
  return 6;
}

function createDefaultUpdateGroupingSetting(companyID: string, currentUserID: string): UpdateSavedGroupingSetting {
  const now = new Date().toISOString();
  return {
    setting_id: "default",
    company_id: companyID.trim(),
    user_id: currentUserID.trim(),
    surface: "updates",
    name: "Updates",
    groupings: [...DEFAULT_UPDATE_GROUPINGS],
    panel_collapsed: false,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedUpdateGroupingSettingsStorageKey(companyID: string, currentUserID: string): string {
  return `${SAVED_UPDATE_GROUPING_SETTINGS_STORAGE_PREFIX}:${companyID.trim() || "global"}:${currentUserID.trim() || "anonymous"}`;
}

function readSavedUpdateGroupingSettings(storageKey: string, fallback: UpdateSavedGroupingSetting): UpdateSavedGroupingSetting[] {
  if (typeof localStorage === "undefined") return [fallback];
  try {
    return normalizeUpdateSavedGroupingSettings(JSON.parse(localStorage.getItem(storageKey) ?? "null"), fallback);
  } catch {
    return [fallback];
  }
}

function writeSavedUpdateGroupingSettings(storageKey: string, settings: UpdateSavedGroupingSetting[]): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(storageKey, JSON.stringify(settings));
}

function normalizeUpdateSavedGroupingSettings(value: unknown, fallback: UpdateSavedGroupingSetting): UpdateSavedGroupingSetting[] {
  if (!Array.isArray(value)) return [fallback];
  const out: UpdateSavedGroupingSetting[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const normalized = normalizeUpdateSavedGroupingSetting(item, fallback);
    if (!normalized.setting_id || seen.has(normalized.setting_id)) continue;
    seen.add(normalized.setting_id);
    out.push(normalized);
  }
  return out.length > 0 ? out : [fallback];
}

function normalizeUpdateSavedGroupingSetting(value: unknown, fallback: UpdateSavedGroupingSetting): UpdateSavedGroupingSetting {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<UpdateSavedGroupingSetting>;
  return {
    setting_id: typeof candidate.setting_id === "string" && candidate.setting_id.trim() ? candidate.setting_id.trim() : fallback.setting_id,
    company_id: fallback.company_id,
    user_id: fallback.user_id,
    surface: "updates",
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : fallback.name,
    groupings: normalizeUpdateGroupingStack(candidate.groupings),
    panel_collapsed: candidate.panel_collapsed === true,
    created_timestamp: typeof candidate.created_timestamp === "string" && candidate.created_timestamp.trim() ? candidate.created_timestamp : fallback.created_timestamp,
    updated_timestamp: typeof candidate.updated_timestamp === "string" && candidate.updated_timestamp.trim() ? candidate.updated_timestamp : fallback.updated_timestamp,
  };
}

function createLocalID(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function updatesShellStyle(collapsed: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    display: "grid",
    gridTemplateColumns: collapsed ? "180px minmax(0, 1fr)" : "390px minmax(0, 1fr)",
    gap: 10,
    padding: "8px 14px 14px",
    background: "#ffffff",
    color: "#111827",
    overflow: "hidden",
  };
}

const updatesContentStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  overflow: "hidden",
};

function updatesGroupingPanelStyle(collapsed: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    alignContent: "start",
    gap: collapsed ? 0 : 8,
    border: "1px solid rgba(15, 23, 42, 0.18)",
    borderRadius: 6,
    background: "#ffffff",
    boxShadow: "0 8px 22px rgba(15, 23, 42, 0.06)",
    overflow: "visible",
  };
}

const updatesGroupingPanelHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 28px",
  alignItems: "center",
  gap: 6,
  padding: "6px 7px 6px 10px",
  borderBottom: "1px solid rgba(15, 23, 42, 0.10)",
};

const updatesGroupingPanelTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 12,
  fontWeight: 850,
};

const updatesGroupingCollapseButtonStyle: React.CSSProperties = {
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

const updatesGroupingBodyStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "112px minmax(0, 1fr)",
  gap: 8,
  padding: "0 8px 8px",
};

const updatesSavedViewsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto",
  gap: 6,
  borderRight: "1px solid rgba(15, 23, 42, 0.12)",
  paddingRight: 7,
};

const updatesSavedViewsListStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 4,
};

function updatesSavedViewRowStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 18px",
    alignItems: "center",
    borderRadius: 5,
    background: active ? "rgba(71, 85, 105, 0.12)" : "transparent",
  };
}

const updatesSavedViewButtonStyle: React.CSSProperties = {
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

const updatesSavedViewDeleteStyle: React.CSSProperties = {
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

const updatesNewViewButtonStyle: React.CSSProperties = {
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

const updatesGroupingStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
};

function updatesGroupingRowStyle(index: number): React.CSSProperties {
  return {
    position: "relative",
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

const updatesGroupingFieldButtonStyle: React.CSSProperties = {
  minWidth: 0,
  height: 24,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
  padding: "0 4px",
};

const updatesGroupingDirectionButtonStyle: React.CSSProperties = {
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

const updatesGroupingRemoveButtonStyle: React.CSSProperties = {
  height: 22,
  border: "none",
  background: "transparent",
  color: "#64748b",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
};

const updatesGroupingFieldMenuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 24,
  top: "calc(100% + 4px)",
  left: 0,
  width: 190,
  display: "grid",
  gap: 2,
  padding: 5,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.16)",
};

function updatesGroupingFieldOptionStyle(active: boolean): React.CSSProperties {
  return {
    minHeight: 27,
    border: "none",
    borderRadius: 5,
    background: active ? "rgba(71, 85, 105, 0.12)" : "transparent",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 700,
    textAlign: "left",
    cursor: "pointer",
    padding: "0 7px",
  };
}

const updatesAddGroupingButtonStyle: React.CSSProperties = {
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

const updatesAddGroupingMenuStyle: React.CSSProperties = {
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

const updatesAddGroupingOptionStyle: React.CSSProperties = {
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

const updatesHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 12,
  alignItems: "start",
};

const updatesTitleStackStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 4 };
const updatesTitleStyle: React.CSSProperties = { margin: 0, color: "#111827", fontSize: 16, lineHeight: 1.2, fontWeight: 800, letterSpacing: 0 };
const updatesMetaStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 700 };
const updatesFilterRowStyle: React.CSSProperties = { display: "inline-flex", border: "1px solid rgba(15, 23, 42, 0.18)", borderRadius: 6, overflow: "hidden" };

function updatesFilterButtonStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 32,
    minHeight: 28,
    border: "none",
    borderRight: "1px solid rgba(15, 23, 42, 0.12)",
    background: active ? "#e2e8f0" : "#ffffff",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 850 : 700,
    cursor: "pointer",
    padding: "0 9px",
  };
}

const updatesListStyle: React.CSSProperties = { minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", padding: "2px 16px 32px 0" };
const updatesEmptyStyle: React.CSSProperties = { minHeight: 160, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 700 };
const updateGroupListStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 4 };
const updateGroupBlockStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 2 };

function updateGroupHeaderStyle(depth: number): React.CSSProperties {
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
    background: "transparent",
    color: "#111827",
    textAlign: "left",
    padding: "0 2px",
  };
}

const updateDisclosureButtonStyle: React.CSSProperties = {
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

const updateGroupResourceButtonStyle: React.CSSProperties = {
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

const updateGroupStaticContentStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "16px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
};

const updateGroupBadgeStyle: React.CSSProperties = { width: 16, height: 16, display: "grid", placeItems: "center", color: "#64748b", fontSize: 10, fontWeight: 850 };
const updateGroupLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 };
const updatesBranchLoadingStyle: React.CSSProperties = { marginLeft: 42, color: "#64748b", fontSize: 11, fontWeight: 700, padding: "4px 0" };
const updateRowsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start" };

function updateRowStyle(depth: number, unread: boolean, urgent: boolean): React.CSSProperties {
  return {
    width: "min(980px, calc(100% - 16px))",
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "18px minmax(220px, 1fr) 100px",
    alignItems: "center",
    gap: 9,
    marginLeft: depth * 28 + 42,
    border: "none",
    borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
    background: urgent ? "rgba(239, 68, 68, 0.06)" : "#ffffff",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: "0 8px",
    fontWeight: unread ? 800 : 650,
  };
}

function updateRowIconStyle(urgent: boolean): React.CSSProperties {
  return { width: 18, display: "grid", placeItems: "center", color: urgent ? "#b91c1c" : "#475569", fontSize: 12, fontWeight: 900 };
}

const updateRowTextStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 2 };
const updateRowTitleStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 780 };
const updateRowBodyStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 11, fontWeight: 650 };
const updateRowTimeStyle: React.CSSProperties = { color: "#64748b", fontSize: 10, fontWeight: 700, textAlign: "right" };

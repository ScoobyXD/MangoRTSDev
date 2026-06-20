import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import {
  fetchUpdateBranch,
  fetchUpdateRootGroups,
  EVENT_NOTIFICATIONS_UPDATED,
  markNotificationRead,
  NOTIFICATION_TYPE_MENTION,
  NOTIFICATION_TYPE_URGENT_MENTION,
  type NotificationItem,
  type UpdateFeedFilter,
  type UpdateGroup,
} from "../../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../../modules/notifications/notificationTime";
import { createSavedViewID, deleteSavedView as deleteSavedViewRequest, fetchSavedViews, saveSavedView, type SavedView, type SavedViewPrincipal } from "./savedViewsApi";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalNestedGroup } from "./universalGrouping";

type UpdatesViewProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  liveRefreshToken?: number;
  onOpenNode: (nodeID: string, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
};

type UpdateGroupingField = "type" | "date" | "gvic";
type UpdateResourceGroupingField = "project" | "logic_gate" | "node";
type UpdateDisplayGroupingField = UpdateGroupingField | UpdateResourceGroupingField;
type UpdateGroupingDirection = "asc" | "desc";

type UpdateGroupingSetting = {
  field: UpdateGroupingField;
  direction: UpdateGroupingDirection;
};

type UpdateDisplayGroupingSetting = {
  field: UpdateDisplayGroupingField;
  direction: UpdateGroupingDirection;
};

type UpdateSavedGroupingSetting = {
  setting_id: string;
  company_id: string;
  user_id: string;
  surface: "updates";
  principal: SavedViewPrincipal;
  principal_id: string;
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
  { value: "type", label: "Update Type" },
  { value: "date", label: "Date" },
  { value: "gvic", label: "GVIC" },
];

const UPDATE_RESOURCE_GROUPINGS: UpdateDisplayGroupingSetting[] = [
  { field: "project", direction: "asc" },
  { field: "logic_gate", direction: "asc" },
  { field: "node", direction: "asc" },
];
const DEFAULT_UPDATE_GROUPINGS: UpdateGroupingSetting[] = [];

const UPDATE_GROUPING_FIELD_SET = new Set<UpdateGroupingField>(UPDATE_GROUPING_FIELDS.map((field) => field.value));
const NOTIFICATION_TYPE_NODE_ASSIGNED = "node.assigned";
const NOTIFICATION_TYPE_NODE_FIELDS_CHANGED = "node.fields_changed";
const NOTIFICATION_TYPE_NODE_COMMENT_CREATED = "node.comment_created";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_SAVED = "work_item.logic_gate_assignment_saved";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_MOVED = "work_item.logic_gate_assignment_moved";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_REMOVED = "work_item.logic_gate_assignment_removed";

export function UpdatesView({ apiBase, companyID, currentUserID, liveRefreshToken = 0, onOpenNode, onOpenLogicGate, onOpenProject }: UpdatesViewProps) {
  const [rootGroups, setRootGroups] = useState<UpdateGroup[]>([]);
  const [branchByRootID, setBranchByRootID] = useState<Record<string, UpdateGroup>>({});
  const [loadingRoots, setLoadingRoots] = useState(false);
  const [branchLoadingIDs, setBranchLoadingIDs] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<UpdateFeedFilter>("all");
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const fallbackSetting = useMemo(() => createDefaultUpdateGroupingSetting(companyID, currentUserID), [companyID, currentUserID]);
  const [settings, setSettings] = useState<UpdateSavedGroupingSetting[]>(() => [fallbackSetting]);
  const [selectedSettingID, setSelectedSettingID] = useState(settings[0]?.setting_id ?? "");
  const [addGroupingOpen, setAddGroupingOpen] = useState(false);
  const [groupingFieldMenuIndex, setGroupingFieldMenuIndex] = useState<number | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [hiddenNotificationIDs, setHiddenNotificationIDs] = useState<Set<string>>(new Set());
  const [selectedNotificationKey, setSelectedNotificationKey] = useState("");
  const [hoveredNotificationKey, setHoveredNotificationKey] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!apiBase || !companyID.trim()) {
      setSettings([fallbackSetting]);
      setSelectedSettingID(fallbackSetting.setting_id);
      return undefined;
    }
    let cancelled = false;
    setSettingsError("");
    void fetchSavedViews({ apiBase, companyID, surface: "updates" }).then((savedViews) => {
      if (cancelled) return;
      const next = savedViewsToUpdateSettings(savedViews, fallbackSetting, currentUserID);
      const settingsForState = next.length > 0 ? next : [fallbackSetting];
      setSettings(settingsForState);
      setSelectedSettingID(settingsForState[0]?.setting_id ?? "");
    }).catch((nextError) => {
      if (cancelled) return;
      setSettings([fallbackSetting]);
      setSelectedSettingID(fallbackSetting.setting_id);
      setSettingsError(savedViewErrorMessage(nextError, "Failed to load saved views"));
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, currentUserID, fallbackSetting]);

  useEffect(() => {
    if (settings.some((setting) => setting.setting_id === selectedSettingID)) return;
    setSelectedSettingID(settings[0]?.setting_id ?? "");
  }, [selectedSettingID, settings]);

  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;

  useEffect(() => {
    setHiddenNotificationIDs(new Set());
    setSelectedNotificationKey("");
    setHoveredNotificationKey("");
  }, [companyID]);

  useEffect(() => {
    setSelectedNotificationKey("");
    setHoveredNotificationKey("");
  }, [filter]);

  const persistSavedSetting = useCallback((setting: UpdateSavedGroupingSetting) => {
    if (!apiBase || !companyID.trim()) return;
    setSettingsError("");
    void saveSavedView({
      apiBase,
      savedView: updateSettingToSavedViewInput(setting, companyID, currentUserID),
    }).then((savedView) => {
      setSettings((current) => current.map((item) => (
        item.setting_id === setting.setting_id
          ? savedViewToUpdateSetting(savedView, item, currentUserID)
          : item
      )));
    }).catch((nextError) => {
      setSettingsError(savedViewErrorMessage(nextError, "Failed to save view"));
    });
  }, [apiBase, companyID, currentUserID]);

  const updateSelectedSetting = useCallback((updater: (setting: UpdateSavedGroupingSetting) => UpdateSavedGroupingSetting) => {
    const updated = updater(selectedSetting);
    const next = {
      ...updated,
      groupings: normalizeUpdateGroupingStack(updated.groupings),
      updated_timestamp: new Date().toISOString(),
    };
    setSettings((current) => current.map((setting) => (setting.setting_id === selectedSetting.setting_id ? next : setting)));
    persistSavedSetting(next);
  }, [persistSavedSetting, selectedSetting]);

  const toggleSelectedSettingCollapsed = useCallback(() => {
    setSettings((current) => current.map((setting) => (
      setting.setting_id === selectedSetting.setting_id
        ? { ...setting, panel_collapsed: !setting.panel_collapsed }
        : setting
    )));
  }, [selectedSetting.setting_id]);

  const addSavedView = useCallback(() => {
    const now = new Date().toISOString();
    const setting: UpdateSavedGroupingSetting = {
      ...selectedSetting,
      setting_id: createSavedViewID(),
      principal: "user",
      principal_id: currentUserID,
      name: `View ${settings.length + 1}`,
      created_timestamp: now,
      updated_timestamp: now,
    };
    setSettings((current) => [...current, setting]);
    setSelectedSettingID(setting.setting_id);
    persistSavedSetting(setting);
  }, [currentUserID, persistSavedSetting, selectedSetting, settings.length]);

  const deleteSavedView = useCallback((settingID: string) => {
    const setting = settings.find((item) => item.setting_id === settingID);
    setSettings((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((item) => item.setting_id !== settingID);
      if (selectedSettingID === settingID) setSelectedSettingID(next[0]?.setting_id ?? "");
      return next;
    });
    if (apiBase && companyID.trim() && setting) {
      void deleteSavedViewRequest({ apiBase, companyID, savedViewID: setting.setting_id }).catch((nextError) => {
        setSettingsError(savedViewErrorMessage(nextError, "Failed to delete view"));
      });
    }
  }, [apiBase, companyID, selectedSettingID, settings]);

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
      groupings: setting.groupings.filter((_, itemIndex) => itemIndex !== index),
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
  }, [companyID, filter, liveRefreshToken, reloadToken]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleNotificationsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string }>).detail;
      const eventCompanyID = detail?.companyID?.trim() ?? "";
      if (eventCompanyID && eventCompanyID !== companyID) return;
      setReloadToken((value) => value + 1);
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
    return () => window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
  }, [companyID]);

  const sourceGroups = useMemo(() => rootGroups.map((root) => branchByRootID[root.id] ?? root), [branchByRootID, rootGroups]);
  const updateRows = useMemo(() => flattenUpdateRows(sourceGroups, hiddenNotificationIDs), [hiddenNotificationIDs, sourceGroups]);
  const displayGroups = useMemo(() => buildUpdateDisplayGroups(updateRows, selectedSetting.groupings), [selectedSetting.groupings, updateRows]);
  const visibleNotifications = useMemo(() => flattenDisplayNotifications(displayGroups), [displayGroups]);
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

  useEffect(() => {
    if (!selectedNotificationKey) return;
    if (visibleNotifications.some((item) => updateNotificationSelectionKey(item) === selectedNotificationKey)) return;
    setSelectedNotificationKey("");
  }, [selectedNotificationKey, visibleNotifications]);

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

  const selectUpdateItem = useCallback((item: NotificationItem) => {
    setSelectedNotificationKey(updateNotificationSelectionKey(item));
    const nodeID = item.node_id?.trim() || (item.entity_type === "node" ? item.entity_id.trim() : "");
    if (nodeID) {
      onOpenNode(nodeID, item.information_id?.trim() || undefined);
    }
  }, [onOpenNode]);

  const selectAdjacentUpdate = useCallback((item: NotificationItem, direction: 1 | -1) => {
    if (visibleNotifications.length === 0) return;
    const itemKey = updateNotificationSelectionKey(item);
    const activeKey = selectedNotificationKey || itemKey;
    const currentIndex = Math.max(0, visibleNotifications.findIndex((candidate) => updateNotificationSelectionKey(candidate) === activeKey));
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), visibleNotifications.length - 1);
    selectUpdateItem(visibleNotifications[nextIndex]);
  }, [selectUpdateItem, selectedNotificationKey, visibleNotifications]);

  const markUpdateRead = useCallback((item: NotificationItem) => {
    const notificationID = item.notification_id?.trim() ?? "";
    if (!notificationID) return;
    const selectionKey = updateNotificationSelectionKey(item);
    setHiddenNotificationIDs((current) => {
      const next = new Set(current);
      next.add(notificationID);
      return next;
    });
    if (selectedNotificationKey === selectionKey) setSelectedNotificationKey("");
    void markNotificationRead(notificationID, true).catch((nextError) => {
      setHiddenNotificationIDs((current) => {
        const next = new Set(current);
        next.delete(notificationID);
        return next;
      });
      setError(nextError instanceof Error ? nextError.message : "Failed to mark update as read");
    });
  }, [selectedNotificationKey]);

  const openGroupResource = useCallback((group: UpdateGroup) => {
    const resourceID = group.resource_id?.trim() ?? "";
    if (!resourceID) return;
    if (group.resource_type === "node") onOpenNode(resourceID);
    if (group.resource_type === "logic_gate") onOpenLogicGate(resourceID, group.label);
    if (group.resource_type === "project") onOpenProject(resourceID, group.label);
  }, [onOpenLogicGate, onOpenNode, onOpenProject]);

  const meta = loadingRoots || branchLoadingIDs.size > 0 ? "Loading" : error || settingsError;

  return (
    <section style={updatesShellStyle}>
      <div style={updatesHeaderStyle}>
        <div style={updatesTitleStackStyle}>
          <h2 style={updatesTitleStyle}>Updates</h2>
          {meta && <div style={updatesMetaStyle}>{meta}</div>}
        </div>
        <div style={updatesHeaderControlsStyle}>
          <UpdateGroupingPanel
            setting={selectedSetting}
            settings={settings}
            addableFields={addableFields}
            addGroupingOpen={addGroupingOpen}
            groupingFieldMenuIndex={groupingFieldMenuIndex}
            onSelectSetting={setSelectedSettingID}
            onAddSavedView={addSavedView}
            onDeleteSavedView={deleteSavedView}
            onToggleCollapsed={toggleSelectedSettingCollapsed}
            onUpdateGrouping={updateGrouping}
            onRemoveGrouping={removeGrouping}
            onSetAddGroupingOpen={setAddGroupingOpen}
            onSetGroupingFieldMenuIndex={setGroupingFieldMenuIndex}
            onAddGrouping={addGrouping}
          />
          <div style={updatesFilterRowStyle}>
            {UPDATE_FILTERS.map((item) => (
              <button key={item.value} type="button" title={item.title} style={updatesFilterButtonStyle(filter === item.value)} onClick={() => setFilter(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
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
            onSelectItem={selectUpdateItem}
            onSelectAdjacent={selectAdjacentUpdate}
            onMarkRead={markUpdateRead}
            selectedNotificationKey={selectedNotificationKey}
            hoveredNotificationKey={hoveredNotificationKey}
            onHoverNotification={setHoveredNotificationKey}
            onOpenGroupResource={openGroupResource}
          />
        )}
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
    <div style={updatesGroupingPanelStyle}>
      <button type="button" title={setting.panel_collapsed ? "Expand grouping settings" : "Collapse grouping settings"} style={updatesGroupingTriggerStyle} onClick={onToggleCollapsed}>
        <span style={updatesGroupingPanelTitleStyle}>Grouping</span>
        <ExplorerDisclosureIcon open={!setting.panel_collapsed} color="currentColor" />
      </button>
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
                <button type="button" title="Remove grouping" style={updatesGroupingRemoveButtonStyle} onClick={() => onRemoveGrouping(index)}>x</button>
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
    </div>
  );
}

function UpdateGroupList({
  groups,
  expandedGroupIDs,
  branchLoadingIDs,
  onToggleGroup,
  onSelectItem,
  onSelectAdjacent,
  onMarkRead,
  selectedNotificationKey,
  hoveredNotificationKey,
  onHoverNotification,
  onOpenGroupResource,
}: {
  groups: UpdateGroup[];
  expandedGroupIDs: Set<string>;
  branchLoadingIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onSelectItem: (item: NotificationItem) => void;
  onSelectAdjacent: (item: NotificationItem, direction: 1 | -1) => void;
  onMarkRead: (item: NotificationItem) => void;
  selectedNotificationKey: string;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
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
              <UpdateGroupList
                groups={group.groups}
                expandedGroupIDs={expandedGroupIDs}
                branchLoadingIDs={branchLoadingIDs}
                onToggleGroup={onToggleGroup}
                onSelectItem={onSelectItem}
                onSelectAdjacent={onSelectAdjacent}
                onMarkRead={onMarkRead}
                selectedNotificationKey={selectedNotificationKey}
                hoveredNotificationKey={hoveredNotificationKey}
                onHoverNotification={onHoverNotification}
                onOpenGroupResource={onOpenGroupResource}
              />
            )}
            {open && rows.length > 0 && (
              <UpdateRows
                rows={rows}
                depth={group.depth + 1}
                onSelectItem={onSelectItem}
                onSelectAdjacent={onSelectAdjacent}
                onMarkRead={onMarkRead}
                selectedNotificationKey={selectedNotificationKey}
                hoveredNotificationKey={hoveredNotificationKey}
                onHoverNotification={onHoverNotification}
              />
            )}
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
  const icon = updateGroupIconBadge(group);
  return <span style={updateGroupBadgeStyle(icon.tone)}>{icon.label}</span>;
}

function updateGroupIconBadge(group: UpdateGroup): { label: string; tone: "urgent" | "mention" | "update" | "generated" | "verified" | "consulted" | "informed" | "other" | "date" } {
  if (group.key === "type:urgent" || /urgent/i.test(group.label)) return { label: "!", tone: "urgent" };
  if (group.key === "type:mention" || group.field === "type" && /mention/i.test(group.label)) return { label: "@", tone: "mention" };
  if (group.key === "type:update" || group.field === "type") return { label: "U", tone: "update" };
  if (group.key === "gvic:generated" || /^generated$/i.test(group.label)) return { label: "G", tone: "generated" };
  if (group.key === "gvic:verified" || /^verified$/i.test(group.label)) return { label: "V", tone: "verified" };
  if (group.key === "gvic:consulted" || /^consulted$/i.test(group.label)) return { label: "C", tone: "consulted" };
  if (group.key === "gvic:informed" || /^informed$/i.test(group.label)) return { label: "I", tone: "informed" };
  if (group.field === "date") return { label: "D", tone: "date" };
  return { label: "O", tone: "other" };
}

function UpdateRows({
  rows,
  depth,
  onSelectItem,
  onSelectAdjacent,
  onMarkRead,
  selectedNotificationKey,
  hoveredNotificationKey,
  onHoverNotification,
}: {
  rows: NotificationItem[];
  depth: number;
  onSelectItem: (item: NotificationItem) => void;
  onSelectAdjacent: (item: NotificationItem, direction: 1 | -1) => void;
  onMarkRead: (item: NotificationItem) => void;
  selectedNotificationKey: string;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
}) {
  return (
    <div style={updateRowsStyle}>
      {rows.map((item, index) => {
        const notificationKey = updateNotificationSelectionKey(item);
        const rowTone = updateRowTone(item);
        const rowBody = formatUpdateRowBody(item);
        return (
          <div
            key={`${notificationKey}:${index}`}
            role="button"
            tabIndex={0}
            style={updateRowStyle(depth, !item.read_timestamp, rowTone, selectedNotificationKey === notificationKey, hoveredNotificationKey === notificationKey)}
            onClick={() => onSelectItem(item)}
            onMouseEnter={() => onHoverNotification(notificationKey)}
            onMouseLeave={() => onHoverNotification("")}
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).tagName === "BUTTON") return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectItem(item);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onSelectAdjacent(item, 1);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                onSelectAdjacent(item, -1);
              }
            }}
          >
            <span style={updateRowIconStyle(rowTone)}>
              {updateRowIcon(item)}
            </span>
            <span style={updateRowTextStyle}>
              <span style={updateRowTitleStyle}>{formatUpdateRowTitle(item)}</span>
              {rowBody && <span style={updateRowBodyStyle}>{rowBody}</span>}
            </span>
            <span style={updateRowTimeStyle}>{formatNotificationTimestamp(item.created_timestamp)}</span>
            <button
              type="button"
              style={updateMarkReadButtonStyle}
              disabled={!item.notification_id?.trim()}
              onClick={(event) => {
                event.stopPropagation();
                onMarkRead(item);
              }}
            >
              Mark as read
            </button>
          </div>
        );
      })}
    </div>
  );
}

function updateRowIcon(item: NotificationItem): React.ReactNode {
  const tone = updateRowTone(item);
  if (tone === "urgent") return "!";
  if (tone === "mention") return "@";
  if (tone === "new") return "+";
  if (tone === "deleted") return "x";
  if (tone === "status") return "S";
  if (tone === "comment") return "C";
  return "U";
}

function updateRowTone(item: NotificationItem): "urgent" | "mention" | "new" | "deleted" | "status" | "comment" | "update" {
  const title = item.title.trim().toLowerCase();
  const body = (item.body_preview ?? "").trim().toLowerCase();
  const text = `${item.type} ${title} ${body}`;
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) return "urgent";
  if (item.type === NOTIFICATION_TYPE_MENTION) return "mention";
  if (item.type === NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_SAVED || item.type === NOTIFICATION_TYPE_NODE_ASSIGNED || /node added|new node|brand new node/.test(text)) return "new";
  if (item.type === NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_REMOVED || /\b(deleted|removed)\b/.test(text)) return "deleted";
  if (item.type === NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_MOVED || item.type === NOTIFICATION_TYPE_NODE_FIELDS_CHANGED || /status changed|moved to/.test(text)) return "status";
  if (item.type === NOTIFICATION_TYPE_NODE_COMMENT_CREATED || /comment/.test(text)) return "comment";
  return "update";
}

function formatUpdateRowTitle(item: NotificationItem): string {
  const title = item.title.trim();
  const fallback = title || "Update";
  if (item.type === NOTIFICATION_TYPE_URGENT_MENTION) {
    if (/^urgent\b/i.test(fallback)) return fallback.replace(/^urgent\b/i, "URGENT");
    return `URGENT ${fallback.replace(/\burgently mentioned you\b/i, "mentioned you").replace(/\bhas mentioned you\b/i, "mentioned you")}`;
  }
  if (item.type === NOTIFICATION_TYPE_MENTION) {
    return fallback.replace(/\bhas mentioned you\b/i, "mentioned you");
  }
  if (updateRowTone(item) === "new") return "Brand new node";
  if (updateRowTone(item) === "deleted") {
    if (/removed/i.test(fallback)) return "Removed from work";
    return "Deleted";
  }
  return fallback;
}

function formatUpdateRowBody(item: NotificationItem): string {
  const body = (item.body_preview ?? "").trim();
  if (!body) return "";
  if (updateRowTone(item) === "new") {
    const addedIn = body.match(/\bwas added in ([^.]+)\./i);
    if (addedIn?.[1]) return `Added in ${addedIn[1].trim()}.`;
    if (/was added to logic gate work/i.test(body)) return "Added to Logic Gate work.";
  }
  return body;
}

function collectUpdateGroupIDs(group: UpdateGroup): string[] {
  const ids = [group.id];
  for (const child of group.groups) ids.push(...collectUpdateGroupIDs(child));
  return ids;
}

function flattenUpdateRows(groups: UpdateGroup[], hiddenNotificationIDs: Set<string>): UpdateFeedRow[] {
  const rows: UpdateFeedRow[] = [];
  const visit = (group: UpdateGroup, path: { project?: UpdateRowResource; logicGate?: UpdateRowResource; node?: UpdateRowResource }) => {
    const nextPath = updatePathWithGroup(path, group);
    for (const item of group.notifications ?? []) {
      const notificationKey = item.notification_id?.trim() || item.source_event_id?.trim() || `${item.entity_type}:${item.entity_id}:${item.created_timestamp}`;
      if (item.read_timestamp || hiddenNotificationIDs.has(notificationKey)) continue;
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

function flattenDisplayNotifications(groups: UpdateGroup[]): NotificationItem[] {
  const rows: NotificationItem[] = [];
  const visit = (group: UpdateGroup) => {
    for (const item of group.notifications ?? []) rows.push(item);
    for (const child of group.groups) visit(child);
  };
  for (const group of groups) visit(group);
  return rows;
}

function updateNotificationSelectionKey(item: NotificationItem): string {
  return item.notification_id?.trim() || item.source_event_id?.trim() || `${item.entity_type}:${item.entity_id}:${item.created_timestamp}`;
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
  const displayGroupings: UpdateDisplayGroupingSetting[] = [
    ...normalizeUpdateGroupingStack(groupings),
    ...UPDATE_RESOURCE_GROUPINGS,
  ];
  const groups = buildUniversalNestedGroups(rows, displayGroupings, {
    rootID: "updates",
    rowKey: (row) => row.rowKey,
    getValues: getUpdateGroupValues,
    sortRows: sortUpdateRows,
  });
  return groups.map(convertUniversalUpdateGroup);
}

function convertUniversalUpdateGroup(group: UniversalNestedGroup<UpdateFeedRow, UpdateDisplayGroupingField>): UpdateGroup {
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

function getUpdateGroupValues(row: UpdateFeedRow, field: UpdateDisplayGroupingField): UniversalGroupValue[] {
  if (field === "project") return [updateResourceGroupValue("project", row.project, "No project")];
  if (field === "logic_gate") return [updateResourceGroupValue("logic_gate", row.logicGate, "No logic gate")];
  if (field === "node") return [updateResourceGroupValue("node", row.node, "No node")];
  if (field === "type") return [updateTypeGroupValue(row.item)];
  if (field === "date") return [updateDateGroupValue(row.item.created_timestamp)];
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

function updateGroupResourceFromValue(field: UpdateDisplayGroupingField, key: string): { type: "project" | "logic_gate" | "node"; id: string } | null {
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
  return out;
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
    setting_id: createSavedViewID(),
    company_id: companyID.trim(),
    user_id: currentUserID.trim(),
    surface: "updates",
    principal: "user",
    principal_id: currentUserID.trim(),
    name: "Updates",
    groupings: [...DEFAULT_UPDATE_GROUPINGS],
    panel_collapsed: true,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedViewsToUpdateSettings(savedViews: SavedView[], fallback: UpdateSavedGroupingSetting, currentUserID: string): UpdateSavedGroupingSetting[] {
  return savedViews
    .filter((view) => view.surface === "updates")
    .map((view) => savedViewToUpdateSetting(view, fallback, currentUserID));
}

function savedViewToUpdateSetting(view: SavedView, fallback: UpdateSavedGroupingSetting, currentUserID: string): UpdateSavedGroupingSetting {
  return normalizeUpdateSavedGroupingSetting({
    setting_id: view.saved_view_id,
    company_id: view.company_id,
    user_id: currentUserID,
    surface: "updates",
    principal: view.principal,
    principal_id: view.principal_id,
    name: view.name,
    groupings: view.groupings,
    panel_collapsed: fallback.panel_collapsed,
    created_timestamp: view.created_timestamp,
    updated_timestamp: view.updated_timestamp,
  }, fallback);
}

function normalizeUpdateSavedGroupingSetting(value: unknown, fallback: UpdateSavedGroupingSetting): UpdateSavedGroupingSetting {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<UpdateSavedGroupingSetting>;
  const principal = candidate.principal === "group" ? "group" : "user";
  const principalID = typeof candidate.principal_id === "string" && candidate.principal_id.trim()
    ? candidate.principal_id.trim()
    : fallback.principal_id;
  return {
    setting_id: typeof candidate.setting_id === "string" && candidate.setting_id.trim() ? candidate.setting_id.trim() : fallback.setting_id,
    company_id: fallback.company_id,
    user_id: fallback.user_id,
    surface: "updates",
    principal,
    principal_id: principalID,
    name: typeof candidate.name === "string" && candidate.name.trim() ? candidate.name.trim() : fallback.name,
    groupings: normalizeUpdateGroupingStack(candidate.groupings),
    panel_collapsed: candidate.panel_collapsed === true,
    created_timestamp: typeof candidate.created_timestamp === "string" && candidate.created_timestamp.trim() ? candidate.created_timestamp : fallback.created_timestamp,
    updated_timestamp: typeof candidate.updated_timestamp === "string" && candidate.updated_timestamp.trim() ? candidate.updated_timestamp : fallback.updated_timestamp,
  };
}

function updateSettingToSavedViewInput(setting: UpdateSavedGroupingSetting, companyID: string, currentUserID: string) {
  const principal = setting.principal === "group" ? "group" as const : "user" as const;
  return {
    company_id: companyID,
    saved_view_id: setting.setting_id,
    surface: "updates" as const,
    principal,
    principal_id: (principal === "group" ? setting.principal_id : currentUserID).trim(),
    name: setting.name,
    groupings: setting.groupings,
  };
}

function savedViewErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

const updatesShellStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: "8px 14px 14px",
  background: "#ffffff",
  color: "#111827",
  overflow: "hidden",
};

const updatesGroupingPanelStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
  overflow: "visible",
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

const updatesGroupingTriggerStyle: React.CSSProperties = {
  minWidth: 112,
  height: 28,
  display: "inline-grid",
  gridTemplateColumns: "minmax(0, 1fr) 16px",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  padding: "0 8px",
  cursor: "pointer",
};

const updatesGroupingBodyStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 6px)",
  right: 0,
  zIndex: 24,
  width: 330,
  minWidth: 0,
  display: "grid",
  gap: 8,
  padding: 8,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 12px 30px rgba(15, 23, 42, 0.14)",
};

const updatesSavedViewsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 6,
  paddingBottom: 7,
  borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
};

const updatesSavedViewsListStyle: React.CSSProperties = {
  minWidth: 0,
  maxHeight: 112,
  overflow: "auto",
  display: "grid",
  gap: 4,
};

function updatesSavedViewRowStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 28,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 24px",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${active ? "rgba(37, 99, 235, 0.42)" : "rgba(15, 23, 42, 0.14)"}`,
    borderRadius: 5,
    background: active ? "rgba(37, 99, 235, 0.08)" : "#f8fafc",
    padding: "2px 3px 2px 7px",
  };
}

const updatesSavedViewButtonStyle: React.CSSProperties = {
  minWidth: 0,
  height: 22,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  border: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 11,
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
  padding: 0,
};

const updatesSavedViewDeleteStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "#64748b",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  padding: 0,
};

const updatesNewViewButtonStyle: React.CSSProperties = {
  minHeight: 28,
  justifySelf: "start",
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
const updatesHeaderControlsStyle: React.CSSProperties = { minWidth: 0, display: "inline-flex", alignItems: "flex-start", justifyContent: "flex-end", gap: 8 };
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

function updateGroupBadgeStyle(tone: "urgent" | "mention" | "update" | "generated" | "verified" | "consulted" | "informed" | "other" | "date"): React.CSSProperties {
  const colors: Record<typeof tone, { color: string; background: string }> = {
    urgent: { color: "#b91c1c", background: "rgba(248, 113, 113, 0.14)" },
    mention: { color: "#2563eb", background: "rgba(96, 165, 250, 0.14)" },
    update: { color: "#475569", background: "rgba(148, 163, 184, 0.14)" },
    generated: { color: "#047857", background: "rgba(52, 211, 153, 0.14)" },
    verified: { color: "#7c3aed", background: "rgba(167, 139, 250, 0.14)" },
    consulted: { color: "#b45309", background: "rgba(251, 191, 36, 0.16)" },
    informed: { color: "#0891b2", background: "rgba(34, 211, 238, 0.14)" },
    other: { color: "#64748b", background: "rgba(148, 163, 184, 0.12)" },
    date: { color: "#334155", background: "rgba(148, 163, 184, 0.14)" },
  };
  return {
    width: 16,
    height: 16,
    borderRadius: 4,
    display: "grid",
    placeItems: "center",
    color: colors[tone].color,
    background: colors[tone].background,
    fontSize: 10,
    fontWeight: 900,
  };
}
const updateGroupLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 800 };
const updatesBranchLoadingStyle: React.CSSProperties = { marginLeft: 42, color: "#64748b", fontSize: 11, fontWeight: 700, padding: "4px 0" };
const updateRowsStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start" };

function updateRowStyle(depth: number, unread: boolean, tone: ReturnType<typeof updateRowTone>, selected: boolean, hovered: boolean): React.CSSProperties {
  const isUrgent = tone === "urgent";
  return {
    width: "min(980px, calc(100% - 16px))",
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "18px minmax(220px, 1fr) 58px 96px",
    alignItems: "center",
    gap: 9,
    marginLeft: depth * 28 + 42,
    border: selected ? "1px solid rgba(37, 99, 235, 0.55)" : "1px solid transparent",
    borderBottom: "1px solid rgba(148, 163, 184, 0.28)",
    borderRadius: selected ? 5 : 0,
    background: selected
      ? "rgba(37, 99, 235, 0.08)"
      : hovered
        ? "rgba(15, 23, 42, 0.035)"
        : isUrgent
          ? "rgba(239, 68, 68, 0.06)"
          : "#ffffff",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    padding: "0 8px",
    fontWeight: unread ? 800 : 650,
    outline: "none",
  };
}

function updateRowIconStyle(tone: ReturnType<typeof updateRowTone>): React.CSSProperties {
  const colors: Record<ReturnType<typeof updateRowTone>, { color: string; background: string }> = {
    urgent: { color: "#b91c1c", background: "rgba(248, 113, 113, 0.14)" },
    mention: { color: "#2563eb", background: "rgba(96, 165, 250, 0.14)" },
    new: { color: "#047857", background: "rgba(52, 211, 153, 0.14)" },
    deleted: { color: "#991b1b", background: "rgba(248, 113, 113, 0.14)" },
    status: { color: "#7c3aed", background: "rgba(167, 139, 250, 0.14)" },
    comment: { color: "#0891b2", background: "rgba(34, 211, 238, 0.14)" },
    update: { color: "#475569", background: "rgba(148, 163, 184, 0.14)" },
  };
  return {
    width: 18,
    height: 18,
    borderRadius: 4,
    display: "grid",
    placeItems: "center",
    color: colors[tone].color,
    background: colors[tone].background,
    fontSize: 11,
    fontWeight: 900,
  };
}

const updateRowTextStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 2 };
const updateRowTitleStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 780 };
const updateRowBodyStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 11, fontWeight: 650 };
const updateRowTimeStyle: React.CSSProperties = { color: "#64748b", fontSize: 10, fontWeight: 700, textAlign: "right" };
const updateMarkReadButtonStyle: React.CSSProperties = {
  height: 24,
  minWidth: 0,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 10,
  fontWeight: 800,
  cursor: "pointer",
  padding: "0 7px",
  whiteSpace: "nowrap",
};

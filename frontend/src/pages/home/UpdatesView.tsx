import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildNodeRoute } from "../../app/deepLinkRoutes";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { MinimizeToLineIcon, OpenInNewTabIcon } from "../../app/nodeEditorPopupControls";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import {
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  KANBAN_LOGIC_GATE_REVIEW_COLOR,
  KANBAN_NODE_PRIORITY_STYLE_OPTIONS,
} from "../../modules/kanban/shared";
import {
  deleteNotification,
  deleteNotifications,
  fetchUpdateBranch,
  fetchUpdateRootGroups,
  EVENT_NOTIFICATIONS_UPDATED,
  NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
  NOTIFICATION_TYPE_MENTION,
  NOTIFICATION_TYPE_URGENT_MENTION,
  type NotificationItem,
  type UpdateFeedFilter,
  type UpdateGroup,
} from "../../modules/notifications/notificationsApi";
import { formatNotificationTimestamp } from "../../modules/notifications/notificationTime";
import { createSavedViewID, deleteSavedView as deleteSavedViewRequest, fetchSavedViews, saveSavedView, type SavedView, type SavedViewPrincipal } from "./savedViewsApi";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalNestedGroup } from "../../modules/grouping/universalGrouping";
import { HOME_UPDATES_SAVED_VIEWS_SLOT_ID } from "./homeConstants";
import { sharedInboxContextMenuButtonStyle } from "./homeStyles";
import { orderedUpdateSelection, resolveUpdateClickSelection } from "./updatesSelection";

type UpdatesEditorContentComponent = React.FC<{
  accent: string;
  widgetId?: string;
  theme?: "mango" | "teal" | "light" | "dark";
  forcedEntityKind?: "node" | "logic_gate";
  forcedEntityID?: string;
  forcedLabel?: string;
  forcedEmptyMessage?: string;
  focusInformationID?: string;
  focusRequestID?: number;
  focusInformationMode?: "focus" | "scroll";
  suppressLegacyWorkspaceStream?: boolean;
}>;

const LazyUpdatesEditorContent = React.lazy(async () => {
  const module = await import("../../modules/editor/EditorContent");
  return { default: module.EditorContent as UpdatesEditorContentComponent };
});

type UpdatesViewProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  liveRefreshToken?: number;
  onOpenNode: (nodeID: string, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
};

type UpdateGroupingField = "type" | "date" | "gvic" | "project" | "logic_gate";
type UpdateDisplayGroupingField = UpdateGroupingField;
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
  position: number;
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

type UpdateDisplayGroup = Omit<UpdateGroup, "groups"> & {
  groups: UpdateDisplayGroup[];
  rows: UpdateFeedRow[];
};

type UpdateContextMenuState = {
  x: number;
  y: number;
};

type UpdateNodeDetails = {
  title?: string;
  status?: string | null;
  priority?: number | null;
};

type UpdatesNodePanelState = {
  nodeID: string;
  nodeTitle: string;
  focusInformationID?: string;
  focusRequestID: number;
  notificationKey: string;
  row: UpdateFeedRow | null;
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
  { value: "project", label: "Project" },
  { value: "logic_gate", label: "Logic Gate" },
];

const DEFAULT_UPDATE_GROUPINGS: UpdateGroupingSetting[] = [
  { field: "project", direction: "asc" },
  { field: "logic_gate", direction: "asc" },
];

const UPDATE_GROUPING_FIELD_SET = new Set<UpdateGroupingField>(UPDATE_GROUPING_FIELDS.map((field) => field.value));
const UPDATES_SELECTED_VIEW_STORAGE_KEY = "mangorts.updates.selectedView.v1";
const NOTIFICATION_TYPE_NODE_ASSIGNED = "node.assigned";
const NOTIFICATION_TYPE_NODE_FIELDS_CHANGED = "node.fields_changed";
const NOTIFICATION_TYPE_NODE_COMMENT_CREATED = "node.comment_created";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_SAVED = "work_item.logic_gate_assignment_saved";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_MOVED = "work_item.logic_gate_assignment_moved";
const NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_REMOVED = "work_item.logic_gate_assignment_removed";

export function UpdatesView({
  apiBase,
  companyID,
  currentUserID,
  liveRefreshToken = 0,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  resolveNodeDetails,
  resolveUserLabel,
}: UpdatesViewProps) {
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
  const [savedViewsSidebarSlot, setSavedViewsSidebarSlot] = useState<HTMLElement | null>(null);
  const [hiddenNotificationIDs, setHiddenNotificationIDs] = useState<Set<string>>(new Set());
  const [selectedNotificationKey, setSelectedNotificationKey] = useState("");
  const [selectedNotificationKeys, setSelectedNotificationKeys] = useState<Set<string>>(new Set());
  const [selectionAnchorNotificationKey, setSelectionAnchorNotificationKey] = useState("");
  const [hoveredNotificationKey, setHoveredNotificationKey] = useState("");
  const [contextMenu, setContextMenu] = useState<UpdateContextMenuState | null>(null);
  const [activeNodePanel, setActiveNodePanel] = useState<UpdatesNodePanelState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const updatesListRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") return;
    setSavedViewsSidebarSlot(document.getElementById(HOME_UPDATES_SAVED_VIEWS_SLOT_ID));
  }, []);

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
      const preferredSettingID = readUpdatesSelectedViewID(companyID, currentUserID);
      const nextSelectedSettingID = settingsForState.find((setting) => setting.setting_id === preferredSettingID)?.setting_id
        ?? settingsForState[0]?.setting_id
        ?? "";
      setSettings(settingsForState);
      setSelectedSettingID(nextSelectedSettingID);
      if (nextSelectedSettingID) storeUpdatesSelectedViewID(companyID, currentUserID, nextSelectedSettingID);
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
    const nextSettingID = settings[0]?.setting_id ?? "";
    setSelectedSettingID(nextSettingID);
    if (nextSettingID) storeUpdatesSelectedViewID(companyID, currentUserID, nextSettingID);
  }, [companyID, currentUserID, selectedSettingID, settings]);

  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;

  useEffect(() => {
    setHiddenNotificationIDs(new Set());
    setSelectedNotificationKey("");
    setSelectedNotificationKeys(new Set());
    setSelectionAnchorNotificationKey("");
    setHoveredNotificationKey("");
    setContextMenu(null);
    setActiveNodePanel(null);
  }, [companyID]);

  useEffect(() => {
    setSelectedNotificationKey("");
    setSelectedNotificationKeys(new Set());
    setSelectionAnchorNotificationKey("");
    setHoveredNotificationKey("");
    setContextMenu(null);
    setActiveNodePanel(null);
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

  const addSavedView = useCallback(() => {
    const now = new Date().toISOString();
    const setting: UpdateSavedGroupingSetting = {
      ...selectedSetting,
      setting_id: createSavedViewID(),
      principal: "user",
      principal_id: currentUserID,
      name: `View ${settings.length + 1}`,
      position: nextUpdateSavedViewPosition(settings),
      created_timestamp: now,
      updated_timestamp: now,
    };
    setSettings((current) => [...current, setting]);
    setSelectedSettingID(setting.setting_id);
    storeUpdatesSelectedViewID(companyID, currentUserID, setting.setting_id);
    persistSavedSetting(setting);
  }, [companyID, currentUserID, persistSavedSetting, selectedSetting, settings]);

  const selectSavedView = useCallback((settingID: string) => {
    setSelectedSettingID(settingID);
    storeUpdatesSelectedViewID(companyID, currentUserID, settingID);
  }, [companyID, currentUserID]);

  const renameSavedView = useCallback((settingID: string) => {
    const setting = settings.find((item) => item.setting_id === settingID);
    if (!setting) return;
    const nextName = window.prompt("Rename view", setting.name)?.trim();
    if (!nextName || nextName === setting.name) return;
    const next = { ...setting, name: nextName, updated_timestamp: new Date().toISOString() };
    setSettings((current) => current.map((item) => (item.setting_id === settingID ? next : item)));
    persistSavedSetting(next);
  }, [persistSavedSetting, settings]);

  const deleteSavedView = useCallback((settingID: string) => {
    const setting = settings.find((item) => item.setting_id === settingID);
    setSettings((current) => {
      if (current.length <= 1) return current;
      const next = current.filter((item) => item.setting_id !== settingID);
      if (selectedSettingID === settingID) {
        const nextSettingID = next[0]?.setting_id ?? "";
        setSelectedSettingID(nextSettingID);
        if (nextSettingID) storeUpdatesSelectedViewID(companyID, currentUserID, nextSettingID);
      }
      return next;
    });
    if (apiBase && companyID.trim() && setting) {
      void deleteSavedViewRequest({ apiBase, companyID, savedViewID: setting.setting_id }).catch((nextError) => {
        setSettingsError(savedViewErrorMessage(nextError, "Failed to delete view"));
      });
    }
  }, [apiBase, companyID, currentUserID, selectedSettingID, settings]);

  const moveSavedView = useCallback((settingID: string, direction: -1 | 1) => {
    const currentIndex = settings.findIndex((item) => item.setting_id === settingID);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= settings.length) return;
    const reordered = [...settings];
    [reordered[currentIndex], reordered[targetIndex]] = [reordered[targetIndex], reordered[currentIndex]];
    const now = new Date().toISOString();
    const nextSettings = reordered.map((setting, index) => {
      const previous = settings.find((item) => item.setting_id === setting.setting_id);
      const position = (index + 1) * 1000;
      return previous?.position === position
        ? setting
        : { ...setting, position, updated_timestamp: now };
    });
    setSettings(nextSettings);
    for (const setting of nextSettings) {
      const previous = settings.find((item) => item.setting_id === setting.setting_id);
      if (previous?.position !== setting.position) persistSavedSetting(setting);
    }
  }, [persistSavedSetting, settings]);

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

  const moveGrouping = useCallback((index: number, direction: -1 | 1) => {
    setGroupingFieldMenuIndex(null);
    setAddGroupingOpen(false);
    updateSelectedSetting((setting) => {
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= setting.groupings.length) return setting;
      const groupings = [...setting.groupings];
      [groupings[index], groupings[targetIndex]] = [groupings[targetIndex], groupings[index]];
      return { ...setting, groupings };
    });
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
      const detail = (event as CustomEvent<{ companyID?: string; source?: string }>).detail;
      const eventCompanyID = detail?.companyID?.trim() ?? "";
      if (eventCompanyID && eventCompanyID !== companyID) return;
      if (detail?.source === NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN) return;
      setReloadToken((value) => value + 1);
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
    return () => window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
  }, [companyID]);

  const sourceGroups = useMemo(() => rootGroups.map((root) => branchByRootID[root.id] ?? root), [branchByRootID, rootGroups]);
  const updateRows = useMemo(() => flattenUpdateRows(sourceGroups, hiddenNotificationIDs), [hiddenNotificationIDs, sourceGroups]);
  const displayGroups = useMemo(() => buildUpdateDisplayGroups(updateRows, selectedSetting.groupings), [selectedSetting.groupings, updateRows]);
  const visibleUpdateRows = useMemo(() => flattenDisplayRows(displayGroups), [displayGroups]);
  const visibleNotifications = useMemo(() => visibleUpdateRows.map((row) => row.item), [visibleUpdateRows]);
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
    if (visibleUpdateRows.some((row) => updateNotificationSelectionKey(row.item) === selectedNotificationKey)) return;
    setSelectedNotificationKey("");
  }, [selectedNotificationKey, visibleUpdateRows]);

  useEffect(() => {
    const visibleKeys = new Set(visibleUpdateRows.map((row) => updateNotificationSelectionKey(row.item)));
    setSelectedNotificationKeys((current) => {
      const next = new Set(Array.from(current).filter((key) => visibleKeys.has(key)));
      return next.size === current.size ? current : next;
    });
    if (selectionAnchorNotificationKey && !visibleKeys.has(selectionAnchorNotificationKey)) setSelectionAnchorNotificationKey("");
  }, [selectionAnchorNotificationKey, visibleUpdateRows]);

  useEffect(() => {
    if (!activeNodePanel?.notificationKey) return;
    if (visibleUpdateRows.some((row) => updateNotificationSelectionKey(row.item) === activeNodePanel.notificationKey)) return;
    setActiveNodePanel(null);
  }, [activeNodePanel, visibleUpdateRows]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeContextMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeContextMenu();
    };
    window.addEventListener("pointerdown", closeContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", closeContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

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

  const selectedNotificationItems = useMemo(() => {
    if (selectedNotificationKeys.size === 0) return [];
    return visibleNotifications.filter((item) => selectedNotificationKeys.has(updateNotificationSelectionKey(item)));
  }, [selectedNotificationKeys, visibleNotifications]);

  const focusUpdateRow = useCallback((notificationKey: string) => {
    if (!notificationKey) return;
    const focusSelectedRow = () => {
      const rows = Array.from(updatesListRef.current?.querySelectorAll<HTMLElement>("[data-update-key]") ?? []);
      rows.find((row) => row.dataset.updateKey === notificationKey)?.focus();
    };
    window.requestAnimationFrame(focusSelectedRow);
    window.setTimeout(focusSelectedRow, 80);
    window.setTimeout(focusSelectedRow, 240);
    window.setTimeout(focusSelectedRow, 600);
  }, []);

  const openUpdateNodePanel = useCallback((row: UpdateFeedRow) => {
    const nodeID = updateRowNodeID(row);
    if (!nodeID) return;
    const details = resolveNodeDetails?.(nodeID) ?? null;
    const informationID = row.item.information_id?.trim() || undefined;
    const notificationKey = updateNotificationSelectionKey(row.item);
    setActiveNodePanel({
      nodeID,
      nodeTitle: updateRowNodeLabel(row, details),
      focusInformationID: informationID,
      focusRequestID: Date.now(),
      notificationKey,
      row,
    });
    focusUpdateRow(notificationKey);
    onOpenNode(nodeID, informationID);
  }, [focusUpdateRow, onOpenNode, resolveNodeDetails]);

  const openNodePanelByResource = useCallback((nodeID: string, label = "") => {
    const cleanNodeID = nodeID.trim();
    if (!cleanNodeID) return;
    const details = resolveNodeDetails?.(cleanNodeID) ?? null;
    setActiveNodePanel({
      nodeID: cleanNodeID,
      nodeTitle: details?.title?.trim() || label.trim() || "Node",
      focusRequestID: Date.now(),
      notificationKey: "",
      row: null,
    });
    onOpenNode(cleanNodeID);
  }, [onOpenNode, resolveNodeDetails]);

  const selectUpdateRow = useCallback((row: UpdateFeedRow, event?: React.MouseEvent | React.KeyboardEvent, options: { open?: boolean; focus?: boolean } = {}) => {
    const item = row.item;
    const itemKey = updateNotificationSelectionKey(item);
    const orderedKeys = visibleUpdateRows.map((candidate) => updateNotificationSelectionKey(candidate.item));
    const selected = resolveUpdateClickSelection({
      orderedIDs: orderedKeys,
      previousSelectedIDs: selectedNotificationKeys,
      anchorID: selectionAnchorNotificationKey,
      clickedID: itemKey,
      shiftKey: !!event?.shiftKey,
      ctrlKey: !!event?.ctrlKey || !!event?.metaKey,
    });
    if (selected.selectedIDs.size === 0) selected.selectedIDs.add(itemKey);
    const orderedSelectedIDs = orderedUpdateSelection(orderedKeys, selected.selectedIDs);
    const primaryKey = selected.selectedIDs.has(itemKey) ? itemKey : (orderedSelectedIDs[0] ?? itemKey);
    const shouldOpen = options.open ?? (!event?.shiftKey && !event?.ctrlKey && !event?.metaKey);
    setSelectedNotificationKeys(new Set(orderedSelectedIDs.length > 0 ? orderedSelectedIDs : [itemKey]));
    setSelectionAnchorNotificationKey(selected.anchorID);
    setSelectedNotificationKey(primaryKey);
    if (options.focus) focusUpdateRow(itemKey);
    if (!shouldOpen) return;
    openUpdateNodePanel(row);
  }, [focusUpdateRow, openUpdateNodePanel, selectedNotificationKeys, selectionAnchorNotificationKey, visibleUpdateRows]);

  const selectAdjacentUpdate = useCallback((row: UpdateFeedRow, direction: 1 | -1) => {
    if (visibleUpdateRows.length === 0) return;
    const itemKey = updateNotificationSelectionKey(row.item);
    const activeKey = selectedNotificationKey || itemKey;
    const currentIndex = Math.max(0, visibleUpdateRows.findIndex((candidate) => updateNotificationSelectionKey(candidate.item) === activeKey));
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), visibleUpdateRows.length - 1);
    selectUpdateRow(visibleUpdateRows[nextIndex], undefined, { open: true, focus: true });
  }, [selectUpdateRow, selectedNotificationKey, visibleUpdateRows]);

  const removeSeenUpdates = useCallback((items: NotificationItem[], confirmMessage = "") => {
    const uniqueItems = Array.from(new Map(items.map((item) => [updateNotificationSelectionKey(item), item])).values());
    const notificationIDs = uniqueItems.map((item) => item.notification_id?.trim() ?? "").filter(Boolean);
    if (notificationIDs.length === 0) return;
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) return;
    const hiddenKeys = uniqueItems.map(updateNotificationSelectionKey);
    setHiddenNotificationIDs((current) => {
      const next = new Set(current);
      for (const key of hiddenKeys) next.add(key);
      return next;
    });
    setSelectedNotificationKeys((current) => {
      const next = new Set(current);
      for (const key of hiddenKeys) next.delete(key);
      return next;
    });
    if (hiddenKeys.includes(selectedNotificationKey)) setSelectedNotificationKey("");
    setContextMenu(null);
    void Promise.all(notificationIDs.map((notificationID) => deleteNotification(notificationID, companyID, { source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN }))).catch((nextError) => {
      setHiddenNotificationIDs((current) => {
        const next = new Set(current);
        for (const key of hiddenKeys) next.delete(key);
        return next;
      });
      setError(nextError instanceof Error ? nextError.message : "Failed to mark update as seen");
    });
  }, [companyID, selectedNotificationKey]);

  const markUpdateSeen = useCallback((item: NotificationItem) => {
    removeSeenUpdates([item]);
  }, [removeSeenUpdates]);

  const markSelectedUpdatesSeen = useCallback(() => {
    const items = selectedNotificationItems.length > 0 ? selectedNotificationItems : visibleNotifications;
    removeSeenUpdates(items, `Are you sure you want to mark ${items.length === 1 ? "this update" : `${items.length} updates`} as seen?`);
  }, [removeSeenUpdates, selectedNotificationItems, visibleNotifications]);

  const markAllUpdatesSeen = useCallback(() => {
    if (!companyID.trim()) return;
    if (typeof window !== "undefined" && !window.confirm("Are you sure you want to mark all updates as seen? This will remove them from Updates.")) return;
    const hiddenKeys = visibleNotifications.map(updateNotificationSelectionKey);
    setHiddenNotificationIDs((current) => {
      const next = new Set(current);
      for (const key of hiddenKeys) next.add(key);
      return next;
    });
    setSelectedNotificationKey("");
    setSelectedNotificationKeys(new Set());
    setSelectionAnchorNotificationKey("");
    setContextMenu(null);
    void deleteNotifications({ companyID, source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN }).catch((nextError) => {
      setHiddenNotificationIDs((current) => {
        const next = new Set(current);
        for (const key of hiddenKeys) next.delete(key);
        return next;
      });
      setError(nextError instanceof Error ? nextError.message : "Failed to mark all updates as seen");
    });
  }, [companyID, visibleNotifications]);

  const openUpdateContextMenu = useCallback((event: React.MouseEvent, row: UpdateFeedRow) => {
    event.preventDefault();
    event.stopPropagation();
    const item = row.item;
    const itemKey = updateNotificationSelectionKey(item);
    if (!selectedNotificationKeys.has(itemKey)) {
      setSelectedNotificationKey(itemKey);
      setSelectedNotificationKeys(new Set([itemKey]));
      setSelectionAnchorNotificationKey(itemKey);
    }
    setContextMenu({ x: event.clientX, y: event.clientY });
  }, [selectedNotificationKeys]);

  const openGroupResource = useCallback((group: UpdateDisplayGroup) => {
    const resourceID = group.resource_id?.trim() ?? "";
    if (!resourceID) return;
    if (group.resource_type === "node") openNodePanelByResource(resourceID, group.label);
    if (group.resource_type === "logic_gate") onOpenLogicGate(resourceID, group.label);
    if (group.resource_type === "project") onOpenProject(resourceID, group.label);
  }, [onOpenLogicGate, onOpenProject, openNodePanelByResource]);

  const meta = loadingRoots || branchLoadingIDs.size > 0 ? "Loading" : error || settingsError;

  return (
    <section style={updatesShellStyle(Boolean(activeNodePanel))}>
      <div style={updatesMainPaneStyle}>
        <div style={updatesHeaderStyle}>
          <div style={updatesTitleStackStyle}>
            <h2 style={updatesTitleStyle}>Updates</h2>
            {meta && <div style={updatesMetaStyle}>{meta}</div>}
          </div>
          <div style={updatesHeaderControlsStyle}>
            <button
              type="button"
              style={updatesSeenAllButtonStyle}
              disabled={visibleNotifications.length === 0}
              onClick={markAllUpdatesSeen}
            >
              Seen all
            </button>
            <div style={updatesFilterRowStyle}>
              {UPDATE_FILTERS.map((item) => (
                <button key={item.value} type="button" title={item.title} style={updatesFilterButtonStyle(filter === item.value)} onClick={() => setFilter(item.value)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {savedViewsSidebarSlot ? createPortal(
          <UpdateGroupingPanel
            setting={selectedSetting}
            settings={settings}
            addableFields={addableFields}
            addGroupingOpen={addGroupingOpen}
            groupingFieldMenuIndex={groupingFieldMenuIndex}
            onSelectSetting={selectSavedView}
            onAddSavedView={addSavedView}
            onRenameSavedView={renameSavedView}
            onMoveSavedView={moveSavedView}
            onDeleteSavedView={deleteSavedView}
            onUpdateGrouping={updateGrouping}
            onRemoveGrouping={removeGrouping}
            onMoveGrouping={moveGrouping}
            onSetAddGroupingOpen={setAddGroupingOpen}
            onSetGroupingFieldMenuIndex={setGroupingFieldMenuIndex}
            onAddGrouping={addGrouping}
          />,
          savedViewsSidebarSlot,
        ) : null}
        <div ref={updatesListRef} className="mango-home-scroll" style={updatesListStyle}>
          {!loadingRoots && !error && displayGroups.length === 0 ? (
            <div style={updatesEmptyStyle}>No updates</div>
          ) : (
            <UpdateGroupList
              groups={displayGroups}
              expandedGroupIDs={expandedGroupIDs}
              branchLoadingIDs={branchLoadingIDs}
              onToggleGroup={toggleGroup}
              onSelectRow={selectUpdateRow}
              onSelectAdjacent={selectAdjacentUpdate}
              onMarkSeen={markUpdateSeen}
              selectedNotificationKey={selectedNotificationKey}
              selectedNotificationKeys={selectedNotificationKeys}
              hoveredNotificationKey={hoveredNotificationKey}
              onHoverNotification={setHoveredNotificationKey}
              onOpenGroupResource={openGroupResource}
              onOpenContextMenu={openUpdateContextMenu}
              resolveNodeDetails={resolveNodeDetails}
              resolveUserLabel={resolveUserLabel}
            />
          )}
        </div>
      </div>
      {activeNodePanel && (
        <UpdatesNodePanel
          panel={activeNodePanel}
          resolveNodeDetails={resolveNodeDetails}
          resolveUserLabel={resolveUserLabel}
          onClose={() => setActiveNodePanel(null)}
        />
      )}
      {contextMenu && (
        <UpdateContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedCount={selectedNotificationItems.length}
          totalCount={visibleNotifications.length}
          onSeenSelected={markSelectedUpdatesSeen}
          onSeenAll={markAllUpdatesSeen}
          onClose={() => setContextMenu(null)}
        />
      )}
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
  onRenameSavedView,
  onMoveSavedView,
  onDeleteSavedView,
  onUpdateGrouping,
  onRemoveGrouping,
  onMoveGrouping,
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
  onRenameSavedView: (settingID: string) => void;
  onMoveSavedView: (settingID: string, direction: -1 | 1) => void;
  onDeleteSavedView: (settingID: string) => void;
  onUpdateGrouping: (index: number, grouping: UpdateGroupingSetting) => void;
  onRemoveGrouping: (index: number) => void;
  onMoveGrouping: (index: number, direction: -1 | 1) => void;
  onSetAddGroupingOpen: (open: boolean) => void;
  onSetGroupingFieldMenuIndex: (index: number | null) => void;
  onAddGrouping: (field: UpdateGroupingField) => void;
}) {
  const [savedViewContextMenu, setSavedViewContextMenu] = useState<{ settingID: string; x: number; y: number } | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorPosition, setEditorPosition] = useState<{ left: number; top: number }>({ left: 320, top: 92 });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const pendingEditAfterAddRef = useRef(false);
  const updateEditorPosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 430;
    const inset = 10;
    const left = Math.max(inset, Math.min(rect.right + 12, window.innerWidth - width - inset));
    const top = Math.max(inset, Math.min(rect.top, window.innerHeight - 180));
    setEditorPosition((current) => (current.left === left && current.top === top ? current : { left, top }));
  }, []);
  useEffect(() => {
    if (!editorOpen) return undefined;
    updateEditorPosition();
    const timer = window.setTimeout(updateEditorPosition, 0);
    window.addEventListener("resize", updateEditorPosition);
    window.addEventListener("scroll", updateEditorPosition, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", updateEditorPosition);
      window.removeEventListener("scroll", updateEditorPosition, true);
    };
  }, [editorOpen, updateEditorPosition]);
  useEffect(() => {
    if (!editorOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setEditorOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editorOpen]);
  useEffect(() => {
    if (!pendingEditAfterAddRef.current) return;
    pendingEditAfterAddRef.current = false;
    setEditorOpen(true);
  }, [setting.setting_id]);
  const contextSettingIndex = savedViewContextMenu ? settings.findIndex((item) => item.setting_id === savedViewContextMenu.settingID) : -1;
  const contextSetting = contextSettingIndex >= 0 ? settings[contextSettingIndex] : null;
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    onSetAddGroupingOpen(false);
    onSetGroupingFieldMenuIndex(null);
  }, [onSetAddGroupingOpen, onSetGroupingFieldMenuIndex]);
  const openEditorForSetting = useCallback((settingID: string) => {
    setSavedViewContextMenu(null);
    onSelectSetting(settingID);
    setEditorOpen(true);
  }, [onSelectSetting]);
  const editor = editorOpen && typeof document !== "undefined" ? createPortal(
    <div style={updatesGroupingBodyStyle(editorPosition)}>
      <div style={updatesGroupingEditorHeaderStyle}>
        <span style={updatesGroupingEditorTitleStyle}>{setting.name}</span>
        <button type="button" title="Close editor" style={updatesGroupingEditorCloseButtonStyle} onClick={closeEditor}>x</button>
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
            <button
              type="button"
              title="Move grouping up"
              disabled={index === 0}
              style={updatesGroupingMoveButtonStyle(index === 0)}
              onClick={() => onMoveGrouping(index, -1)}
            >
              Up
            </button>
            <button
              type="button"
              title="Move grouping down"
              disabled={index >= setting.groupings.length - 1}
              style={updatesGroupingMoveButtonStyle(index >= setting.groupings.length - 1)}
              onClick={() => onMoveGrouping(index, 1)}
            >
              Dn
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
    </div>,
    document.body,
  ) : null;

  return (
    <div ref={panelRef} style={updatesGroupingPanelStyle}>
      <div style={updatesSavedViewsListStyle}>
        {settings.map((item) => (
          <button
            key={item.setting_id}
            type="button"
            style={updatesSavedViewRowStyle(item.setting_id === setting.setting_id)}
            onClick={() => {
              setSavedViewContextMenu(null);
              onSelectSetting(item.setting_id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setSavedViewContextMenu({ settingID: item.setting_id, x: event.clientX, y: event.clientY });
            }}
          >
            <span style={updatesSavedViewButtonStyle}>{item.name}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        style={updatesNewViewButtonStyle}
        onClick={() => {
          pendingEditAfterAddRef.current = true;
          setSavedViewContextMenu(null);
          onAddSavedView();
        }}
      >
        Add new +
      </button>
      {savedViewContextMenu && contextSetting && (
        <FrameRightClickMenu x={savedViewContextMenu.x} y={savedViewContextMenu.y} onClose={() => setSavedViewContextMenu(null)} minWidth={170}>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => openEditorForSetting(contextSetting.setting_id)}
          >
            Edit
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              onRenameSavedView(contextSetting.setting_id);
              setSavedViewContextMenu(null);
            }}
          >
            Rename
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            disabled={contextSettingIndex <= 0}
            onClick={() => {
              onMoveSavedView(contextSetting.setting_id, -1);
              setSavedViewContextMenu(null);
            }}
          >
            Move up
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            disabled={contextSettingIndex >= settings.length - 1}
            onClick={() => {
              onMoveSavedView(contextSetting.setting_id, 1);
              setSavedViewContextMenu(null);
            }}
          >
            Move down
          </button>
          <button
            type="button"
            style={{ ...sharedInboxContextMenuButtonStyle, color: settings.length <= 1 ? "#94a3b8" : "#dc2626" }}
            disabled={settings.length <= 1}
            onClick={() => {
              if (settings.length <= 1) return;
              if (contextSetting.setting_id === setting.setting_id) closeEditor();
              onDeleteSavedView(contextSetting.setting_id);
              setSavedViewContextMenu(null);
            }}
          >
            Delete
          </button>
        </FrameRightClickMenu>
      )}
      {editor}
    </div>
  );
}

function UpdateGroupList({
  groups,
  expandedGroupIDs,
  branchLoadingIDs,
  onToggleGroup,
  onSelectRow,
  onSelectAdjacent,
  onMarkSeen,
  selectedNotificationKey,
  selectedNotificationKeys,
  hoveredNotificationKey,
  onHoverNotification,
  onOpenGroupResource,
  onOpenContextMenu,
  resolveNodeDetails,
  resolveUserLabel,
}: {
  groups: UpdateDisplayGroup[];
  expandedGroupIDs: Set<string>;
  branchLoadingIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onSelectRow: (row: UpdateFeedRow, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onSelectAdjacent: (row: UpdateFeedRow, direction: 1 | -1) => void;
  onMarkSeen: (item: NotificationItem) => void;
  selectedNotificationKey: string;
  selectedNotificationKeys: Set<string>;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
  onOpenGroupResource: (group: UpdateDisplayGroup) => void;
  onOpenContextMenu: (event: React.MouseEvent, row: UpdateFeedRow) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
}) {
  return (
    <div style={updateGroupListStyle}>
      {groups.map((group) => {
        const open = expandedGroupIDs.has(group.id);
        const branchLoading = branchLoadingIDs.has(group.id);
        const rows = group.rows ?? [];
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
                onSelectRow={onSelectRow}
                onSelectAdjacent={onSelectAdjacent}
                onMarkSeen={onMarkSeen}
                selectedNotificationKey={selectedNotificationKey}
                selectedNotificationKeys={selectedNotificationKeys}
                hoveredNotificationKey={hoveredNotificationKey}
                onHoverNotification={onHoverNotification}
                onOpenGroupResource={onOpenGroupResource}
                onOpenContextMenu={onOpenContextMenu}
                resolveNodeDetails={resolveNodeDetails}
                resolveUserLabel={resolveUserLabel}
              />
            )}
            {open && rows.length > 0 && (
              <UpdateRows
                rows={rows}
                depth={group.depth + 1}
                onSelectRow={onSelectRow}
                onSelectAdjacent={onSelectAdjacent}
                onMarkSeen={onMarkSeen}
                selectedNotificationKey={selectedNotificationKey}
                selectedNotificationKeys={selectedNotificationKeys}
                hoveredNotificationKey={hoveredNotificationKey}
                onHoverNotification={onHoverNotification}
                onOpenContextMenu={onOpenContextMenu}
                resolveNodeDetails={resolveNodeDetails}
                resolveUserLabel={resolveUserLabel}
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
  onSelectRow,
  onSelectAdjacent,
  onMarkSeen,
  selectedNotificationKey,
  selectedNotificationKeys,
  hoveredNotificationKey,
  onHoverNotification,
  onOpenContextMenu,
  resolveNodeDetails,
  resolveUserLabel,
}: {
  rows: UpdateFeedRow[];
  depth: number;
  onSelectRow: (row: UpdateFeedRow, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onSelectAdjacent: (row: UpdateFeedRow, direction: 1 | -1) => void;
  onMarkSeen: (item: NotificationItem) => void;
  selectedNotificationKey: string;
  selectedNotificationKeys: Set<string>;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
  onOpenContextMenu: (event: React.MouseEvent, row: UpdateFeedRow) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
}) {
  return (
    <div style={updateRowsStyle}>
      {rows.map((row, index) => {
        const item = row.item;
        const notificationKey = updateNotificationSelectionKey(item);
        const rowTone = updateRowTone(item);
        const rowBody = formatUpdateRowBody(row);
        return (
          <div
            key={`${row.rowKey}:${index}`}
            role="button"
            tabIndex={0}
            data-update-key={notificationKey}
            style={updateRowStyle(depth, !item.read_timestamp, rowTone, selectedNotificationKeys.has(notificationKey) || selectedNotificationKey === notificationKey, hoveredNotificationKey === notificationKey)}
            onMouseDown={(event) => {
              if (event.button !== 0) return;
              if ((event.target as HTMLElement).closest("button")) return;
              event.preventDefault();
              event.currentTarget.focus();
            }}
            onClick={(event) => onSelectRow(row, event)}
            onContextMenu={(event) => onOpenContextMenu(event, row)}
            onMouseEnter={() => onHoverNotification(notificationKey)}
            onMouseLeave={() => onHoverNotification("")}
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).tagName === "BUTTON") return;
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectRow(row, event);
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                onSelectAdjacent(row, 1);
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                onSelectAdjacent(row, -1);
              }
            }}
          >
            <span style={updateRowIconStyle(rowTone)}>
              {updateRowIcon(item)}
            </span>
            <span style={updateRowTextStyle}>
              <span style={updateRowTitleStyle}>
                <UpdateCanonicalRowCopy row={row} resolveNodeDetails={resolveNodeDetails} resolveUserLabel={resolveUserLabel} />
              </span>
              {rowBody && <span style={updateRowBodyStyle}>{rowBody}</span>}
            </span>
            <span style={updateRowTimeStyle}>{formatNotificationTimestamp(item.created_timestamp)}</span>
            <button
              type="button"
              style={updateMarkReadButtonStyle}
              disabled={!item.notification_id?.trim()}
              onClick={(event) => {
                event.stopPropagation();
                onMarkSeen(item);
              }}
            >
              Seen
            </button>
          </div>
        );
      })}
    </div>
  );
}

function UpdateContextMenu({
  x,
  y,
  selectedCount,
  totalCount,
  onSeenSelected,
  onSeenAll,
  onClose,
}: {
  x: number;
  y: number;
  selectedCount: number;
  totalCount: number;
  onSeenSelected: () => void;
  onSeenAll: () => void;
  onClose: () => void;
}) {
  const left = Math.max(8, Math.min(x, (typeof window === "undefined" ? x : window.innerWidth - 190)));
  const top = Math.max(8, Math.min(y, (typeof window === "undefined" ? y : window.innerHeight - 104)));
  return (
    <div
      role="menu"
      style={{ ...updatesContextMenuStyle, left, top }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        style={updatesContextMenuItemStyle}
        disabled={selectedCount <= 0}
        onClick={() => {
          onSeenSelected();
          onClose();
        }}
      >
        {selectedCount <= 1 ? "Seen update" : `Seen selected (${selectedCount})`}
      </button>
      <button
        type="button"
        role="menuitem"
        style={updatesContextMenuItemStyle}
        disabled={totalCount <= 0}
        onClick={() => {
          onSeenAll();
          onClose();
        }}
      >
        Seen all
      </button>
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

function UpdateCanonicalRowCopy({
  row,
  resolveNodeDetails,
  resolveUserLabel,
}: {
  row: UpdateFeedRow;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
}) {
  const item = row.item;
  const tone = updateRowTone(item);
  const nodeID = updateRowNodeID(row);
  const nodeDetails = nodeID ? resolveNodeDetails?.(nodeID) ?? null : null;
  const actor = updateActorLabel(item, resolveUserLabel);
  const nodeLabel = updateRowNodeLabel(row, nodeDetails);
  const logicGateLabel = updateRowLogicGateLabel(row);
  const statusLabel = updateRowStatusLabel(row, nodeDetails);
  const chatMention = updateRowIsChatMention(row);
  const priorityValue = nodeDetails ? updatePriorityValue(nodeDetails.priority) : null;
  const statusToken = statusLabel ? <UpdateStatusToken status={statusLabel} /> : null;
  const priorityToken = priorityValue !== null ? <UpdatePriorityToken priority={priorityValue} /> : null;
  const nodeEntity = <UpdateInlineEntity kind="node" label={nodeLabel} />;
  const logicGateEntity = <UpdateInlineEntity kind="logic_gate" label={logicGateLabel} />;

  if (tone === "urgent" || tone === "mention") {
    if (item.entity_type === "logic_gate") {
      return (
        <span style={updateRowCopyStyle}>
          <span>{actor}</span>
          <span>{tone === "urgent" ? "urgently mentioned you in" : "mentioned you in"}</span>
          {logicGateEntity}
        </span>
      );
    }
    return (
      <span style={updateRowCopyStyle}>
        <span>{actor}</span>
        <span>{tone === "urgent" ? (chatMention ? "urgently mentioned you in chat on" : "urgently mentioned you in") : (chatMention ? "mentioned you in chat on" : "mentioned you in")}</span>
        {nodeEntity}
        <span>in</span>
        {logicGateEntity}
      </span>
    );
  }

  if (item.type === NOTIFICATION_TYPE_LOGIC_GATE_ASSIGNMENT_SAVED || item.type === NOTIFICATION_TYPE_NODE_ASSIGNED || tone === "new") {
    return (
      <span style={updateRowCopyStyle}>
        <span>{actor}</span>
        <span>added</span>
        {nodeEntity}
        {priorityToken}
        {statusToken}
        <span>to</span>
        {logicGateEntity}
      </span>
    );
  }

  if (tone === "deleted") {
    return (
      <span style={updateRowCopyStyle}>
        <span>{actor}</span>
        <span>removed</span>
        {nodeEntity}
        <span>from</span>
        {logicGateEntity}
      </span>
    );
  }

  if (tone === "status") {
    return (
      <span style={updateRowCopyStyle}>
        <span>{actor}</span>
        <span>updated</span>
        {nodeEntity}
        {statusToken ? <span>to</span> : null}
        {statusToken}
        <span>in</span>
        {logicGateEntity}
      </span>
    );
  }

  if (tone === "comment") {
    return (
      <span style={updateRowCopyStyle}>
        <span>{actor}</span>
        <span>sent chat on</span>
        {nodeEntity}
        <span>in</span>
        {logicGateEntity}
      </span>
    );
  }

  return (
    <span style={updateRowCopyStyle}>
      <span>{normalizeLegacyUpdateTitle(item.title) || "Update"}</span>
    </span>
  );
}

function UpdateInlineEntity({ kind, label }: { kind: "node" | "logic_gate" | "project"; label: string }) {
  return (
    <span style={updateInlineEntityStyle}>
      <ExplorerRowIcon kind={kind} />
      <span style={updateInlineEntityLabelStyle}>{label}</span>
    </span>
  );
}

function UpdatePriorityToken({ priority }: { priority: number }) {
  const option = KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((item) => item.value === String(priority))
    ?? KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((item) => item.value === "0")
    ?? KANBAN_NODE_PRIORITY_STYLE_OPTIONS[0];
  return (
    <span
      style={{
        ...updateInlineTokenStyle,
        color: option.color,
        borderColor: option.borderColor,
        background: option.surface,
      }}
    >
      {option.label}
    </span>
  );
}

function UpdateStatusToken({ status }: { status: string }) {
  const color = updateStatusColor(status);
  return (
    <span
      style={{
        ...updateInlineTokenStyle,
        color,
        borderColor: `${color}55`,
        background: `${color}16`,
      }}
    >
      {formatUpdateStatusLabel(status)}
    </span>
  );
}

function UpdatesNodePanel({
  panel,
  resolveNodeDetails,
  resolveUserLabel,
  onClose,
}: {
  panel: UpdatesNodePanelState;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
  onClose: () => void;
}) {
  const details = resolveNodeDetails?.(panel.nodeID) ?? null;
  const nodeTitle = details?.title?.trim() || panel.nodeTitle;
  const body = panel.row ? formatUpdateRowBody(panel.row) : "";
  return (
    <aside style={updatesNodePanelStyle(Boolean(panel.row))} aria-label="Selected update node">
      {panel.row && (
        <div style={updatesNodePanelNotificationStyle}>
          <span style={updateRowIconStyle(updateRowTone(panel.row.item))}>{updateRowIcon(panel.row.item)}</span>
          <span style={updatesNodePanelNotificationTextStyle}>
            <UpdateCanonicalRowCopy row={panel.row} resolveNodeDetails={resolveNodeDetails} resolveUserLabel={resolveUserLabel} />
            {body && <span style={updatesNodePanelNotificationBodyStyle}>{body}</span>}
          </span>
          <span style={updatesNodePanelNotificationTimeStyle}>{formatNotificationTimestamp(panel.row.item.created_timestamp)}</span>
        </div>
      )}
      <div style={updatesNodePanelEditorStyle}>
        <div style={updatesNodePanelOverlayControlsStyle}>
          <button type="button" title="Open node in new tab" style={updatesNodePanelIconButtonStyle} onClick={() => openAppPathInNewTab(buildNodeRoute(panel.nodeID))}>
            <OpenInNewTabIcon />
          </button>
          <button type="button" title="Close node panel" style={updatesNodePanelIconButtonStyle} onClick={onClose}>
            <MinimizeToLineIcon />
          </button>
        </div>
        <React.Suspense fallback={<div style={updatesNodePanelLoadingStyle}>Loading node</div>}>
          <LazyUpdatesEditorContent
            accent="#2563eb"
            widgetId={`updates-node:${panel.nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={panel.nodeID}
            forcedLabel={nodeTitle}
            forcedEmptyMessage="Select an update that points to a node."
            focusInformationID={panel.focusInformationID}
            focusRequestID={panel.focusRequestID}
            focusInformationMode="scroll"
            suppressLegacyWorkspaceStream
          />
        </React.Suspense>
      </div>
    </aside>
  );
}

function formatUpdateRowBody(row: UpdateFeedRow): string {
  if (!updateRowShowsPreview(row)) return "";
  const body = (row.item.body_preview ?? "").trim();
  if (!body) return "";
  return body;
}

function updateRowShowsPreview(row: UpdateFeedRow): boolean {
  const tone = updateRowTone(row.item);
  return tone === "urgent" || tone === "mention" || tone === "comment";
}

function updateRowIsChatMention(row: UpdateFeedRow): boolean {
  if (row.item.type !== NOTIFICATION_TYPE_MENTION && row.item.type !== NOTIFICATION_TYPE_URGENT_MENTION) return false;
  return /\bmentioned you in chat on\b/i.test(row.item.title);
}

function updateRowNodeID(row: UpdateFeedRow): string {
  return row.item.node_id?.trim()
    || row.node?.id.trim()
    || (row.item.entity_type === "node" ? row.item.entity_id.trim() : "");
}

function updateRowNodeLabel(row: UpdateFeedRow, details?: UpdateNodeDetails | null): string {
  return details?.title?.trim()
    || row.node?.label.trim()
    || extractMentionTargetLabel(row.item)
    || extractNodeLabelFromPreview(row.item)
    || "Node";
}

function updateRowLogicGateLabel(row: UpdateFeedRow): string {
  return row.logicGate?.label.trim()
    || (row.item.entity_type === "logic_gate" ? extractMentionTargetLabel(row.item) : "")
    || "Logic Gate";
}

function updateActorLabel(item: NotificationItem, resolveUserLabel?: (userID: string) => string): string {
  const actorID = item.actor_user_id?.trim() ?? "";
  const resolved = actorID ? resolveUserLabel?.(actorID)?.trim() ?? "" : "";
  return resolved || extractActorFromNotification(item) || "Someone";
}

function updateRowStatusLabel(row: UpdateFeedRow, details?: UpdateNodeDetails | null): string {
  return extractStatusFromNotification(row.item) || details?.status?.trim() || "";
}

function updatePriorityValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(5, Math.round(value)));
}

function extractActorFromNotification(item: NotificationItem): string {
  const title = item.title.trim();
  const body = (item.body_preview ?? "").trim();
  const mentionMatch = title.match(/^(?:urgent\s+)?(.+?)\s+(?:urgently\s+)?mentioned you\b/i);
  if (mentionMatch?.[1]) return mentionMatch[1].trim();
  const bodyChangedMatch = body.match(/^(.+?)\s+(?:changed|updated|moved|added|removed)\b/i);
  if (bodyChangedMatch?.[1]) return bodyChangedMatch[1].trim();
  const titleActionMatch = title.match(/^(.+?)\s+(?:added|updated|removed|deleted|assigned|sent|attached|gave|requested)\b/i);
  if (titleActionMatch?.[1]) return titleActionMatch[1].trim();
  return "";
}

function extractMentionTargetLabel(item: NotificationItem): string {
  const title = item.title.trim();
  const chatMatch = title.match(/\bmentioned you in chat on\s+(.+)$/i);
  if (chatMatch?.[1]) return chatMatch[1].trim();
  const match = title.match(/\bmentioned you in\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
}

function extractNodeLabelFromPreview(item: NotificationItem): string {
  const title = item.title.trim();
  const body = (item.body_preview ?? "").trim();
  const addedMatch = body.match(/^(.+?)\s+was added\b/i);
  if (addedMatch?.[1]) return addedMatch[1].trim();
  const movedMatch = body.match(/^(.+?)\s+moved to\b/i);
  if (movedMatch?.[1]) return movedMatch[1].trim();
  const changedMatch = body.match(/^.+?\s+changed\s+(.+?)\s+to\b/i);
  if (changedMatch?.[1]) return changedMatch[1].trim();
  return normalizeLegacyUpdateTitle(title);
}

function extractStatusFromNotification(item: NotificationItem): string {
  const title = item.title.trim();
  const body = (item.body_preview ?? "").trim();
  const titleMatch = title.match(/\bstatus changed to\s+(.+)$/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  const addedMatch = body.match(/\bwas added in\s+([^.]+)\.?$/i);
  if (addedMatch?.[1]) return addedMatch[1].trim();
  const movedMatch = body.match(/\bmoved to\s+([^.]+)\.?$/i);
  if (movedMatch?.[1]) return movedMatch[1].trim();
  const changedMatch = body.match(/\bchanged\s+.+?\s+to\s+([^.]+)\.?$/i);
  if (changedMatch?.[1]) return changedMatch[1].trim();
  return "";
}

function normalizeLegacyUpdateTitle(value: string): string {
  return value.trim()
    .replace(/^URGENT\s+/i, "")
    .replace(/\bhas mentioned you\b/i, "mentioned you")
    .replace(/\s+/g, " ")
    .trim();
}

function formatUpdateStatusLabel(status: string): string {
  return status.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function updateStatusColor(status: string): string {
  const token = status.trim().toLowerCase().replace(/[_-]+/g, " ");
  if (token === "requested") return KANBAN_LOGIC_GATE_REQUESTED_COLOR;
  if (token === "backlog") return KANBAN_LOGIC_GATE_BACKLOG_COLOR;
  if (token === "pending") return KANBAN_LOGIC_GATE_PENDING_COLOR;
  if (token === "in progress") return KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR;
  if (token === "review") return KANBAN_LOGIC_GATE_REVIEW_COLOR;
  if (token === "done") return KANBAN_LOGIC_GATE_DONE_COLOR;
  return "#64748b";
}

type UpdateGroupIDTree = { id: string; groups: UpdateGroupIDTree[] };

function collectUpdateGroupIDs(group: UpdateGroupIDTree): string[] {
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

function flattenDisplayRows(groups: UpdateDisplayGroup[]): UpdateFeedRow[] {
  const rows: UpdateFeedRow[] = [];
  const visit = (group: UpdateDisplayGroup) => {
    for (const row of group.rows ?? []) rows.push(row);
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

function buildUpdateDisplayGroups(rows: UpdateFeedRow[], groupings: UpdateGroupingSetting[]): UpdateDisplayGroup[] {
  const displayGroupings: UpdateDisplayGroupingSetting[] = normalizeUpdateGroupingStack(groupings);
  if (displayGroupings.length === 0) {
    const sortedRows = sortUpdateRows(rows);
    return [{
      id: "updates/all",
      key: "updates:all",
      field: "type",
      label: "Updates",
      resource_type: "",
      resource_id: "",
      depth: 0,
      groups: [],
      notifications: sortedRows.map((row) => row.item),
      rows: sortedRows,
    }];
  }
  const groups = buildUniversalNestedGroups(rows, displayGroupings, {
    rootID: "updates",
    rowKey: (row) => row.rowKey,
    getValues: getUpdateGroupValues,
    sortRows: sortUpdateRows,
  });
  return groups.map(convertUniversalUpdateGroup);
}

function convertUniversalUpdateGroup(group: UniversalNestedGroup<UpdateFeedRow, UpdateDisplayGroupingField>): UpdateDisplayGroup {
  const resource = updateGroupResourceFromValue(group.field, group.key);
  const sortedRows = sortUpdateRows(group.rows);
  return {
    id: group.id,
    key: group.key,
    field: group.field,
    label: group.label,
    resource_type: resource?.type ?? "",
    resource_id: resource?.id ?? "",
    depth: group.depth,
    groups: group.groups.map(convertUniversalUpdateGroup),
    notifications: sortedRows.map((row) => row.item),
    rows: sortedRows,
  };
}

function getUpdateGroupValues(row: UpdateFeedRow, field: UpdateDisplayGroupingField): UniversalGroupValue[] {
  if (field === "project") return [updateResourceGroupValue("project", row.project, "No project")];
  if (field === "logic_gate") return [updateResourceGroupValue("logic_gate", row.logicGate, "No logic gate")];
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
  if (field !== "project" && field !== "logic_gate") return null;
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

function updatesSelectedViewStorageKey(companyID: string, userID: string): string {
  const cleanCompanyID = companyID.trim();
  const cleanUserID = userID.trim();
  return cleanCompanyID && cleanUserID
    ? `${UPDATES_SELECTED_VIEW_STORAGE_KEY}:${cleanCompanyID}:${cleanUserID}`
    : UPDATES_SELECTED_VIEW_STORAGE_KEY;
}

function readUpdatesSelectedViewID(companyID: string, userID: string): string {
  try {
    return localStorage.getItem(updatesSelectedViewStorageKey(companyID, userID))?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeUpdatesSelectedViewID(companyID: string, userID: string, settingID: string): void {
  const cleanSettingID = settingID.trim();
  if (!cleanSettingID) return;
  try {
    localStorage.setItem(updatesSelectedViewStorageKey(companyID, userID), cleanSettingID);
  } catch {}
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
    position: 1000,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedViewsToUpdateSettings(savedViews: SavedView[], fallback: UpdateSavedGroupingSetting, currentUserID: string): UpdateSavedGroupingSetting[] {
  return savedViews
    .filter((view) => view.surface === "updates")
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) || left.saved_view_id.localeCompare(right.saved_view_id))
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
    position: view.position,
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
    position: typeof candidate.position === "number" && Number.isFinite(candidate.position) ? candidate.position : fallback.position,
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
    position: setting.position,
  };
}

function nextUpdateSavedViewPosition(settings: UpdateSavedGroupingSetting[]): number {
  return Math.max(0, ...settings.map((setting) => Number.isFinite(setting.position) ? setting.position : 0)) + 1000;
}

function savedViewErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}

function updatesShellStyle(panelOpen: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    display: "grid",
    gridTemplateColumns: panelOpen ? "minmax(720px, 840px) minmax(520px, 1fr)" : "minmax(0, 1fr)",
    gap: panelOpen ? 12 : 0,
    padding: "10px 14px 14px",
    background: "radial-gradient(circle at 18% 12%, rgba(20, 184, 166, 0.16), transparent 34%), radial-gradient(circle at 88% 18%, rgba(251, 146, 60, 0.12), transparent 30%), linear-gradient(135deg, rgba(240, 253, 250, 0.94), rgba(255, 247, 237, 0.78) 48%, rgba(248, 250, 252, 0.96))",
    color: "#111827",
    overflow: "hidden",
  };
}

const updatesMainPaneStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  overflow: "hidden",
};

const updatesGroupingPanelStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  minWidth: 0,
  display: "grid",
  gap: 4,
  padding: "0 4px 2px 14px",
  overflow: "visible",
};

function updatesGroupingBodyStyle(position: { left: number; top: number }): React.CSSProperties {
  return {
    position: "fixed",
    top: position.top,
    left: position.left,
    zIndex: 90,
    width: "min(430px, calc(100vw - 96px))",
    maxHeight: "min(520px, calc(100vh - 32px))",
    overflow: "auto",
    minWidth: 0,
    display: "grid",
    gap: 8,
    padding: 10,
    border: "1px solid rgba(15, 23, 42, 0.18)",
    borderRadius: 8,
    background: "#ffffff",
    boxShadow: "0 18px 42px rgba(15, 23, 42, 0.16), 0 1px 0 rgba(255, 255, 255, 0.92) inset",
  };
}

const updatesGroupingEditorHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 26px",
  alignItems: "center",
  gap: 6,
};

const updatesGroupingEditorTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 12,
  fontWeight: 850,
};

const updatesGroupingEditorCloseButtonStyle: React.CSSProperties = {
  width: 26,
  height: 24,
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: 6,
  background: "rgba(255, 255, 255, 0.84)",
  color: "#64748b",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  padding: 0,
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
    minHeight: 28,
    display: "grid",
    alignItems: "center",
    border: "1px solid transparent",
    borderRadius: 5,
    background: active ? "rgba(71, 85, 105, 0.12)" : "transparent",
    cursor: "pointer",
    padding: "2px 7px",
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
  padding: 0,
};

const updatesNewViewButtonStyle: React.CSSProperties = {
  minHeight: 28,
  width: "100%",
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
  const indent = Math.min(index * 20, 42);
  return {
    position: "relative",
    minWidth: 0,
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 46px 32px 32px 22px",
    alignItems: "center",
    gap: 5,
    width: `calc(100% - ${indent}px)`,
    marginLeft: indent,
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

function updatesGroupingMoveButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 22,
    border: "1px solid rgba(15, 23, 42, 0.12)",
    borderRadius: 5,
    background: disabled ? "rgba(226, 232, 240, 0.54)" : "#ffffff",
    color: disabled ? "#94a3b8" : "#334155",
    font: "inherit",
    fontSize: 10,
    fontWeight: 800,
    cursor: disabled ? "default" : "pointer",
    padding: 0,
  };
}

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
  alignItems: "center",
  border: "1px solid rgba(15, 23, 42, 0.12)",
  borderRadius: 8,
  background: "linear-gradient(90deg, rgba(236, 253, 245, 0.92), rgba(255, 251, 235, 0.78), rgba(240, 249, 255, 0.86))",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.82)",
  padding: "9px 10px",
};

const updatesTitleStackStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 4 };
const updatesTitleStyle: React.CSSProperties = { margin: 0, color: "#111827", fontSize: 16, lineHeight: 1.2, fontWeight: 800, letterSpacing: 0 };
const updatesMetaStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 700 };
const updatesHeaderControlsStyle: React.CSSProperties = { minWidth: 0, display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 8 };
const updatesSeenAllButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#334155",
  font: "inherit",
  fontSize: 12,
  fontWeight: 850,
  cursor: "pointer",
  padding: "0 10px",
  whiteSpace: "nowrap",
  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.06)",
};
const updatesFilterRowStyle: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid rgba(15, 23, 42, 0.18)",
  borderRadius: 6,
  overflow: "hidden",
  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.06)",
};

function updatesFilterButtonStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 32,
    minHeight: 28,
    border: "none",
    borderRight: "1px solid rgba(15, 23, 42, 0.12)",
    background: active ? "#dbeafe" : "rgba(255, 255, 255, 0.94)",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 850 : 700,
    cursor: "pointer",
    padding: "0 9px",
  };
}

const updatesListStyle: React.CSSProperties = { minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", padding: "2px 16px 32px 2px" };
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
    mention: { color: "#c2410c", background: "rgba(251, 146, 60, 0.16)" },
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
  const leftOffset = depth * 28 + 42;
  return {
    width: `min(860px, calc(100% - ${leftOffset + 8}px))`,
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "18px minmax(180px, 1fr) 58px 78px",
    alignItems: "center",
    gap: 9,
    marginLeft: leftOffset,
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
    userSelect: "none",
    WebkitUserSelect: "none",
  };
}

function updateRowIconStyle(tone: ReturnType<typeof updateRowTone>): React.CSSProperties {
  const colors: Record<ReturnType<typeof updateRowTone>, { color: string; background: string }> = {
    urgent: { color: "#b91c1c", background: "rgba(248, 113, 113, 0.14)" },
    mention: { color: "#c2410c", background: "rgba(251, 146, 60, 0.16)" },
    new: { color: "#2563eb", background: "rgba(96, 165, 250, 0.14)" },
    deleted: { color: "#991b1b", background: "rgba(127, 29, 29, 0.12)" },
    status: { color: "#7c3aed", background: "rgba(167, 139, 250, 0.14)" },
    comment: { color: "#2563eb", background: "rgba(96, 165, 250, 0.14)" },
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
const updateRowTitleStyle: React.CSSProperties = { minWidth: 0, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 780 };
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

const updateRowCopyStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: "3px 5px",
  lineHeight: 1.25,
};

const updateInlineEntityStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: 230,
  display: "inline-flex",
  alignItems: "center",
  gap: 3,
  color: "#0f172a",
  fontWeight: 850,
  verticalAlign: "middle",
};

const updateInlineEntityLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const updateInlineTokenStyle: React.CSSProperties = {
  maxWidth: 190,
  minHeight: 18,
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid",
  borderRadius: 4,
  padding: "0 5px",
  fontSize: 10,
  fontWeight: 850,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

function updatesNodePanelStyle(hasNotification: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: hasNotification ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)",
    border: "1px solid rgba(15, 23, 42, 0.14)",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.96)",
    boxShadow: "0 18px 40px rgba(15, 23, 42, 0.14)",
    overflow: "hidden",
  };
}

const updatesNodePanelIconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 5,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  padding: 0,
};

const updatesNodePanelNotificationStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "18px minmax(0, 1fr) auto",
  alignItems: "start",
  gap: 8,
  borderBottom: "1px solid rgba(148, 163, 184, 0.18)",
  background: "rgba(248, 250, 252, 0.82)",
  padding: "8px 10px",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const updatesNodePanelNotificationTextStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 3, color: "#111827", fontSize: 12, fontWeight: 760 };
const updatesNodePanelNotificationBodyStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 11, fontWeight: 650 };
const updatesNodePanelNotificationTimeStyle: React.CSSProperties = { color: "#64748b", fontSize: 10, fontWeight: 750, whiteSpace: "nowrap" };
const updatesNodePanelEditorStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, position: "relative", overflow: "hidden", background: "#f8fafc" };
const updatesNodePanelLoadingStyle: React.CSSProperties = { minHeight: 180, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 750 };
const updatesNodePanelOverlayControlsStyle: React.CSSProperties = {
  position: "absolute",
  top: 4,
  right: 8,
  zIndex: 12,
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
};

const updatesContextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 2400,
  width: 180,
  display: "grid",
  gap: 2,
  padding: 5,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 6,
  background: "#ffffff",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.18)",
};

const updatesContextMenuItemStyle: React.CSSProperties = {
  minHeight: 30,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  textAlign: "left",
  cursor: "pointer",
  padding: "0 8px",
};

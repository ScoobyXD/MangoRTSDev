import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildNodeRoute } from "../../app/deepLinkRoutes";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { UnifiedNodeShell } from "../../modules/editor/UnifiedNodeShell";
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
import { createSavedViewID, fetchSavedViews, type SavedView, type SavedViewPrincipal } from "./savedViewsApi";
import { buildUniversalNestedGroups, type UniversalGroupValue, type UniversalNestedGroup } from "../../modules/grouping/universalGrouping";
import { getUniversalStatusGroupValue } from "../../modules/grouping/universalStatusGrouping";
import { EVENT_HOME_SAVED_VIEWS_CHANGED } from "./HomeSavedViewsSidebar";
import { resolveUpdateStatusForGrouping } from "./updateStatusGrouping";
import { orderedUpdateSelection, resolveUpdateClickSelection, resolveUpdateSeenSuccessor, updatesNotificationEventRequiresReload } from "./updatesSelection";
import {
  resolveCurrentUpdateLogicGateGroupValue,
  resolveCurrentUpdateLogicGateLabel,
  resolveUpdateLogicGateID,
  type UpdateLogicGateDetails,
} from "./updatesCurrentEntityLabels";

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
}>;

const LazyUpdatesEditorContent = React.lazy(async () => {
  const module = await import("../../modules/editor/EditorContent");
  return { default: module.EditorContent as UpdatesEditorContentComponent };
});

type UpdatesViewProps = {
  apiBase: string;
  companyID: string;
  currentUserID: string;
  onOpenNode: (nodeID: string, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
};

type UpdateGroupingField = "type" | "date" | "gvic" | "project" | "logic_gate" | "status";
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
  { value: "status", label: "Status" },
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
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  resolveNodeDetails,
  resolveLogicGateDetails,
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
  const [settingsError, setSettingsError] = useState("");
  const [savedViewsReloadToken, setSavedViewsReloadToken] = useState(0);
  const [hiddenNotificationIDs, setHiddenNotificationIDs] = useState<Set<string>>(new Set());
  const [selectedNotificationKey, setSelectedNotificationKey] = useState("");
  const [selectedNotificationKeys, setSelectedNotificationKeys] = useState<Set<string>>(new Set());
  const [selectionAnchorNotificationKey, setSelectionAnchorNotificationKey] = useState("");
  const [hoveredNotificationKey, setHoveredNotificationKey] = useState("");
  const [contextMenu, setContextMenu] = useState<UpdateContextMenuState | null>(null);
  const [activeNodePanel, setActiveNodePanel] = useState<UpdatesNodePanelState | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const updatesListRef = useRef<HTMLDivElement | null>(null);
  const notificationRefreshTimerRef = useRef<number | null>(null);
  const canonicalLoadInFlightRef = useRef(false);
  const notificationReloadQueuedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleSavedViewsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ surface?: string; settingID?: string }>).detail;
      if (detail?.surface !== "updates") return;
      const settingID = detail.settingID?.trim() ?? "";
      if (settingID) setSelectedSettingID(settingID);
      setSavedViewsReloadToken((value) => value + 1);
    };
    window.addEventListener(EVENT_HOME_SAVED_VIEWS_CHANGED, handleSavedViewsChanged);
    return () => window.removeEventListener(EVENT_HOME_SAVED_VIEWS_CHANGED, handleSavedViewsChanged);
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
  }, [apiBase, companyID, currentUserID, fallbackSetting, savedViewsReloadToken]);

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
      canonicalLoadInFlightRef.current = false;
      notificationReloadQueuedRef.current = false;
      setRootGroups([]);
      setBranchByRootID({});
      setExpandedGroupIDs(new Set());
      return;
    }
    let cancelled = false;
    setLoadingRoots(true);
    canonicalLoadInFlightRef.current = true;
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
          canonicalLoadInFlightRef.current = false;
          if (notificationReloadQueuedRef.current) {
            notificationReloadQueuedRef.current = false;
            setReloadToken((value) => value + 1);
          }
        }
      });
    return () => {
      cancelled = true;
      canonicalLoadInFlightRef.current = false;
      notificationReloadQueuedRef.current = false;
    };
  }, [companyID, filter, reloadToken]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleNotificationsUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID?: string; source?: string }>).detail;
      if (!updatesNotificationEventRequiresReload({
        activeCompanyID: companyID,
        eventCompanyID: detail?.companyID,
        source: detail?.source,
        localSeenSource: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN,
      })) return;
      if (notificationRefreshTimerRef.current !== null) window.clearTimeout(notificationRefreshTimerRef.current);
      notificationRefreshTimerRef.current = window.setTimeout(() => {
        notificationRefreshTimerRef.current = null;
        if (canonicalLoadInFlightRef.current) {
          notificationReloadQueuedRef.current = true;
          return;
        }
        setReloadToken((value) => value + 1);
      }, 80);
    };
    window.addEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
    return () => {
      window.removeEventListener(EVENT_NOTIFICATIONS_UPDATED, handleNotificationsUpdated);
      if (notificationRefreshTimerRef.current !== null) {
        window.clearTimeout(notificationRefreshTimerRef.current);
        notificationRefreshTimerRef.current = null;
      }
    };
  }, [companyID]);

  const sourceGroups = useMemo(() => rootGroups.map((root) => branchByRootID[root.id] ?? root), [branchByRootID, rootGroups]);
  const updateRows = useMemo(() => flattenUpdateRows(sourceGroups, hiddenNotificationIDs), [hiddenNotificationIDs, sourceGroups]);
  const displayGroups = useMemo(
    () => buildUpdateDisplayGroups(updateRows, selectedSetting.groupings, resolveNodeDetails, resolveLogicGateDetails),
    [resolveLogicGateDetails, resolveNodeDetails, selectedSetting.groupings, updateRows],
  );
  const visibleUpdateRows = useMemo(
    () => flattenDisplayRows(displayGroups, expandedGroupIDs),
    [displayGroups, expandedGroupIDs],
  );
  const visibleNotifications = useMemo(() => visibleUpdateRows.map((row) => row.item), [visibleUpdateRows]);
  const groupingSignature = useMemo(() => JSON.stringify({
    setting: selectedSetting.setting_id,
    groupings: selectedSetting.groupings,
    rows: updateRows.map((row) => row.rowKey).sort(),
  }), [selectedSetting.groupings, selectedSetting.setting_id, updateRows]);

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

  const focusUpdateRow = useCallback((rowKey: string) => {
    if (!rowKey) return;
    const focusSelectedRow = () => {
      const rows = Array.from(updatesListRef.current?.querySelectorAll<HTMLElement>("[data-update-row-key]") ?? []);
      rows.find((row) => row.dataset.updateRowKey === rowKey)?.focus();
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
    focusUpdateRow(row.rowKey);
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
    if (options.focus) focusUpdateRow(row.rowKey);
    if (!shouldOpen) return;
    openUpdateNodePanel(row);
  }, [focusUpdateRow, openUpdateNodePanel, selectedNotificationKeys, selectionAnchorNotificationKey, visibleUpdateRows]);

  const selectAdjacentUpdate = useCallback((row: UpdateFeedRow, direction: 1 | -1) => {
    if (visibleUpdateRows.length === 0) return;
    const currentIndex = Math.max(0, visibleUpdateRows.findIndex((candidate) => candidate.rowKey === row.rowKey));
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), visibleUpdateRows.length - 1);
    selectUpdateRow(visibleUpdateRows[nextIndex], undefined, { open: true, focus: true });
  }, [selectUpdateRow, visibleUpdateRows]);

  const removeSeenUpdates = useCallback((items: NotificationItem[], confirmMessage = "", options: { advanceFromRowKey?: string } = {}) => {
    const uniqueItems = Array.from(new Map(items.map((item) => [updateNotificationSelectionKey(item), item])).values());
    const notificationIDs = uniqueItems.map((item) => item.notification_id?.trim() ?? "").filter(Boolean);
    if (notificationIDs.length === 0) return;
    if (confirmMessage && typeof window !== "undefined" && !window.confirm(confirmMessage)) return;
    const hiddenKeys = uniqueItems.map(updateNotificationSelectionKey);
    const hiddenKeySet = new Set(hiddenKeys);
    const nextRowKey = options.advanceFromRowKey
      ? resolveUpdateSeenSuccessor(
        visibleUpdateRows.map((row) => ({
          rowKey: row.rowKey,
          notificationKey: updateNotificationSelectionKey(row.item),
        })),
        options.advanceFromRowKey,
        hiddenKeySet,
      )
      : "";
    const nextRow = nextRowKey ? visibleUpdateRows.find((row) => row.rowKey === nextRowKey) ?? null : null;
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
    if (nextRow) {
      const nextKey = updateNotificationSelectionKey(nextRow.item);
      setSelectedNotificationKey(nextKey);
      setSelectedNotificationKeys(new Set([nextKey]));
      setSelectionAnchorNotificationKey(nextKey);
      if (updateRowNodeID(nextRow)) openUpdateNodePanel(nextRow);
      else {
        setActiveNodePanel(null);
        focusUpdateRow(nextRow.rowKey);
      }
    } else if (options.advanceFromRowKey || hiddenKeys.includes(selectedNotificationKey)) {
      setSelectedNotificationKey("");
      setSelectedNotificationKeys(new Set());
      setSelectionAnchorNotificationKey("");
      setActiveNodePanel(null);
    }
    setContextMenu(null);
    void Promise.all(notificationIDs.map((notificationID) => deleteNotification(notificationID, companyID, { source: NOTIFICATION_UPDATE_SOURCE_UPDATES_LOCAL_SEEN }))).catch((nextError) => {
      setHiddenNotificationIDs((current) => {
        const next = new Set(current);
        for (const key of hiddenKeys) next.delete(key);
        return next;
      });
      setError(nextError instanceof Error ? nextError.message : "Failed to mark update as seen");
    });
  }, [companyID, focusUpdateRow, openUpdateNodePanel, selectedNotificationKey, visibleUpdateRows]);

  const markUpdateSeen = useCallback((row: UpdateFeedRow) => {
    removeSeenUpdates([row.item], "", { advanceFromRowKey: row.rowKey });
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
    if (group.resource_type === "logic_gate") {
      onOpenLogicGate(resourceID, resolveCurrentUpdateLogicGateLabel({
        currentDetails: resolveLogicGateDetails?.(resourceID),
        groupedLabel: group.label,
      }));
    }
    if (group.resource_type === "project") onOpenProject(resourceID, group.label);
  }, [onOpenLogicGate, onOpenProject, openNodePanelByResource, resolveLogicGateDetails]);

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
              resolveLogicGateDetails={resolveLogicGateDetails}
              resolveUserLabel={resolveUserLabel}
            />
          )}
        </div>
      </div>
      {activeNodePanel && (
        <UpdatesNodePanel
          panel={activeNodePanel}
          resolveNodeDetails={resolveNodeDetails}
          resolveLogicGateDetails={resolveLogicGateDetails}
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
  resolveLogicGateDetails,
  resolveUserLabel,
}: {
  groups: UpdateDisplayGroup[];
  expandedGroupIDs: Set<string>;
  branchLoadingIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onSelectRow: (row: UpdateFeedRow, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onSelectAdjacent: (row: UpdateFeedRow, direction: 1 | -1) => void;
  onMarkSeen: (row: UpdateFeedRow) => void;
  selectedNotificationKey: string;
  selectedNotificationKeys: Set<string>;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
  onOpenGroupResource: (group: UpdateDisplayGroup) => void;
  onOpenContextMenu: (event: React.MouseEvent, row: UpdateFeedRow) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined;
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
                resolveLogicGateDetails={resolveLogicGateDetails}
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
                resolveLogicGateDetails={resolveLogicGateDetails}
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
  if (group.field === "status") {
    return <span aria-hidden="true" style={updateStatusGroupDotStyle(group.label)} />;
  }
  const icon = updateGroupIconBadge(group);
  return <span style={updateGroupBadgeStyle(icon.tone)}>{icon.label}</span>;
}

function updateStatusGroupDotStyle(status: string): React.CSSProperties {
  const color = updateStatusColor(status);
  return {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: color,
    border: "1px solid rgba(255, 255, 255, 0.92)",
    boxShadow: `0 0 0 1px ${color}55`,
  };
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
  resolveLogicGateDetails,
  resolveUserLabel,
}: {
  rows: UpdateFeedRow[];
  depth: number;
  onSelectRow: (row: UpdateFeedRow, event?: React.MouseEvent | React.KeyboardEvent) => void;
  onSelectAdjacent: (row: UpdateFeedRow, direction: 1 | -1) => void;
  onMarkSeen: (row: UpdateFeedRow) => void;
  selectedNotificationKey: string;
  selectedNotificationKeys: Set<string>;
  hoveredNotificationKey: string;
  onHoverNotification: (notificationKey: string) => void;
  onOpenContextMenu: (event: React.MouseEvent, row: UpdateFeedRow) => void;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined;
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
            data-update-row-key={row.rowKey}
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
                <UpdateCanonicalRowCopy
                  row={row}
                  resolveNodeDetails={resolveNodeDetails}
                  resolveLogicGateDetails={resolveLogicGateDetails}
                  resolveUserLabel={resolveUserLabel}
                />
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
                onMarkSeen(row);
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
  if (updateItemIsEmailMention(item)) {
    return (
      <svg aria-label="Email mention" width="13" height="13" viewBox="0 0 16 16" style={{ display: "block" }}>
        <rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.45" />
        <path d="m2.7 4.4 5.3 4 5.3-4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
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
  resolveLogicGateDetails,
  resolveUserLabel,
}: {
  row: UpdateFeedRow;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined;
  resolveUserLabel?: (userID: string) => string;
}) {
  const item = row.item;
  const tone = updateRowTone(item);
  const nodeID = updateRowNodeID(row);
  const nodeDetails = nodeID ? resolveNodeDetails?.(nodeID) ?? null : null;
  const logicGateID = resolveUpdateLogicGateID(row);
  const logicGateDetails = logicGateID ? resolveLogicGateDetails?.(logicGateID) ?? null : null;
  const actor = updateActorLabel(item, resolveUserLabel);
  const nodeLabel = updateRowNodeLabel(row, nodeDetails);
  const logicGateLabel = updateRowLogicGateLabel(row, logicGateDetails);
  const statusLabel = updateRowStatusLabel(row, nodeDetails);
  const chatMention = updateRowIsChatMention(row);
  const priorityValue = nodeDetails ? updatePriorityValue(nodeDetails.priority) : null;
  const statusToken = statusLabel ? <UpdateStatusToken status={statusLabel} /> : null;
  const priorityToken = priorityValue !== null ? <UpdatePriorityToken priority={priorityValue} /> : null;
  const nodeEntity = <UpdateInlineEntity kind="node" label={nodeLabel} />;
  const logicGateEntity = <UpdateInlineEntity kind="logic_gate" label={logicGateLabel} />;

  if (tone === "urgent" || tone === "mention") {
    if (updateItemIsEmailMention(item)) {
      const subject = extractEmailMentionSubject(item);
      return (
        <span style={updateRowCopyStyle}>
          <span>{actor}</span>
          <span>{tone === "urgent" ? "urgently mentioned you on an email" : "mentioned you on an email"}</span>
          {subject && <span>{subject}</span>}
        </span>
      );
    }
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
  resolveLogicGateDetails,
  resolveUserLabel,
  onClose,
}: {
  panel: UpdatesNodePanelState;
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined;
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined;
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
            <UpdateCanonicalRowCopy
              row={panel.row}
              resolveNodeDetails={resolveNodeDetails}
              resolveLogicGateDetails={resolveLogicGateDetails}
              resolveUserLabel={resolveUserLabel}
            />
            {body && <span style={updatesNodePanelNotificationBodyStyle}>{body}</span>}
          </span>
          <span style={updatesNodePanelNotificationTimeStyle}>{formatNotificationTimestamp(panel.row.item.created_timestamp)}</span>
        </div>
      )}
      <UnifiedNodeShell
        surfaceID="updates-node-panel"
        title={nodeTitle}
        ariaLabel="Selected update node editor"
        actionTop={4}
        actionButtonStyle={updatesNodePanelIconButtonStyle}
        closeButtonStyle={updatesNodePanelIconButtonStyle}
        style={updatesNodePanelEditorStyle}
        actions={[
          {
            id: "open-in-new-tab",
            onClick: () => openAppPathInNewTab(buildNodeRoute(panel.nodeID)),
          },
          {
            id: "pin",
            title: "Pin node to Pinned",
            ariaLabel: "Pin node to Pinned",
            onClick: () => requestAppSidebarPin({ kind: "node", id: panel.nodeID, name: nodeTitle }),
          },
          {
            id: "close",
            title: "Close node panel",
            ariaLabel: "Close node panel",
            onClick: onClose,
          },
        ]}
      >
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
          />
        </React.Suspense>
      </UnifiedNodeShell>
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

function updateItemIsEmailMention(item: NotificationItem): boolean {
  if (item.type !== NOTIFICATION_TYPE_MENTION && item.type !== NOTIFICATION_TYPE_URGENT_MENTION) return false;
  return /\bmentioned you (?:in chat )?on (?:an )?email\b/i.test(item.title);
}

function extractEmailMentionSubject(item: NotificationItem): string {
  const match = item.title.trim().match(/\bmentioned you (?:in chat )?on (?:an )?email(?::|\s+-)?\s*(.*)$/i);
  return match?.[1]?.trim() ?? "";
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

function updateRowLogicGateLabel(row: UpdateFeedRow, details?: UpdateLogicGateDetails | null): string {
  return resolveCurrentUpdateLogicGateLabel({
    currentDetails: details,
    groupedLabel: row.logicGate?.label,
    historicalEntityLabel: row.item.entity_type === "logic_gate" ? extractMentionTargetLabel(row.item) : "",
  });
}

function updateActorLabel(item: NotificationItem, resolveUserLabel?: (userID: string) => string): string {
  const actorID = item.actor_user_id?.trim() ?? "";
  const resolved = actorID ? resolveUserLabel?.(actorID)?.trim() ?? "" : "";
  return resolved || extractActorFromNotification(item) || "Someone";
}

function updateRowStatusLabel(row: UpdateFeedRow, details?: UpdateNodeDetails | null): string {
  return resolveUpdateStatusForGrouping(row.item, details?.status);
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

function flattenDisplayRows(groups: UpdateDisplayGroup[], expandedGroupIDs: ReadonlySet<string>): UpdateFeedRow[] {
  const rows: UpdateFeedRow[] = [];
  const visit = (group: UpdateDisplayGroup) => {
    if (!expandedGroupIDs.has(group.id)) return;
    for (const child of group.groups) visit(child);
    for (const row of group.rows ?? []) rows.push(row);
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

function buildUpdateDisplayGroups(
  rows: UpdateFeedRow[],
  groupings: UpdateGroupingSetting[],
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined,
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined,
): UpdateDisplayGroup[] {
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
    getValues: (row, field) => getUpdateGroupValues(row, field, resolveNodeDetails, resolveLogicGateDetails),
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

function getUpdateGroupValues(
  row: UpdateFeedRow,
  field: UpdateDisplayGroupingField,
  resolveNodeDetails?: (nodeID: string) => UpdateNodeDetails | null | undefined,
  resolveLogicGateDetails?: (logicGateID: string) => UpdateLogicGateDetails | null | undefined,
): UniversalGroupValue[] {
  if (field === "project") return [updateResourceGroupValue("project", row.project, "No project")];
  if (field === "logic_gate") {
    const logicGateID = resolveUpdateLogicGateID(row);
    if (!logicGateID) return [updateResourceGroupValue("logic_gate", undefined, "No logic gate")];
    const groupValue = resolveCurrentUpdateLogicGateGroupValue({
      row,
      currentDetails: resolveLogicGateDetails?.(logicGateID),
      historicalEntityLabel: row.item.entity_type === "logic_gate" ? extractMentionTargetLabel(row.item) : "",
    });
    if (!groupValue) return [updateResourceGroupValue("logic_gate", undefined, "No logic gate")];
    return [{ key: `logic_gate:${groupValue.id}`, label: groupValue.label, sortValue: groupValue.sortValue }];
  }
  if (field === "type") return [updateTypeGroupValue(row.item)];
  if (field === "date") return [updateDateGroupValue(row.item.created_timestamp)];
  if (field === "status") {
    const nodeID = row.node?.id.trim() ?? "";
    const status = updateRowStatusLabel(row, nodeID ? resolveNodeDetails?.(nodeID) : null);
    const value = getUniversalStatusGroupValue(status);
    return [{ ...value, key: `status:${value.key}` }];
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

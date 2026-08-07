import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import { buildNodeRoute } from "../../app/deepLinkRoutes";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { requestAppSidebarPin } from "../../app/sidebarPins";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember } from "../../modules/communications/communicationsApi";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import { readCommittedEntityTitleVersion, subscribeCommittedEntityTitleUpdates } from "../../modules/realtime/committedEntityTitleUpdates";
import type { LogicGateRACIRole, LogicGateRecord } from "../../modules/logic-gates/types";
import type { NodeRecord } from "../../modules/nodes/types";
import { listMyWorkMatrixRows, type MyWorkMatrixRow } from "../../modules/work-items/workItemReadApi";
import { cleanIDList, logicGateTitle } from "./homeUtils";
import { EVENT_HOME_SAVED_VIEWS_CHANGED } from "./HomeSavedViewsSidebar";
import {
  homeColorWithAlpha,
  homeRACIRoleAccent,
  logicGateRACIColumnHeaderStyle,
  logicGateRACIColumnLabelStyle,
  logicGateRACIColumnLetterStyle,
  logicGateRACICornerStyle,
  logicGateRACIHeaderStyle,
  logicGateRACIMatrixSurfaceStyle,
  logicGateRACIPriorityHeaderStyle,
  sharedInboxContextMenuButtonStyle,
} from "./homeStyles";
import {
  loadMyWorkMatrixCacheEntry,
  markMyWorkMatrixCacheStale,
  markMyWorkMatrixCachesStaleForTargetUsers,
  myWorkMatrixCacheKey,
  patchMyWorkMatrixCacheEntry,
  patchMyWorkMatrixCells,
  patchMyWorkMatrixCellsForCommittedTitle,
  readMyWorkMatrixCache,
  readMyWorkMatrixCacheSummary,
  uniqueMyWorkTargetUserIDs,
  type MyWorkMatrixCellWithUser,
  type MyWorkMatrixLoadFailure,
} from "./myWorkMatrixLoader";
import {
  MY_WORK_DEBUG_STORAGE_KEY,
  myWorkDebugDurationMs,
  myWorkDebugEnabled,
  myWorkDebugLog,
  myWorkDebugTimestampMs,
  publishMyWorkDebugSnapshot,
  recordMyWorkDebugCause,
} from "./myWorkPerformanceDebug";
import { buildMyWorkDisplayRows, type MyWorkDisplayRow } from "./myWorkDisplayRows";
import {
  DEFAULT_MY_WORK_GROUPINGS,
  buildNestedGroups,
  computeAllExpandedCellGroupIDs,
  defaultMyWorkSelectedScope,
  RACIRoleLabel,
  myWorkCellGroupStateID,
  normalizeMyWorkGroupingStack,
  normalizeMyWorkSavedGroupingSetting,
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
import { createSavedViewID, fetchSavedViews, type SavedView } from "./savedViewsApi";

type MyWorkViewProps = {
  apiBase: string;
  loading: boolean;
  companyID: string;
  currentUserID: string;
  liveRefreshToken?: number;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onRenameNode?: (nodeID: string) => void;
  onRequestDeleteNode?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onCreateNodeInCell?: (input: MyWorkCellCreateInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => MyWorkNodeDropResult | Promise<MyWorkNodeDropResult>;
  onDropNodesInCell?: (input: MyWorkCellNodeDropInput) => void;
  onDropLogicGates?: (input: MyWorkCellLogicGateDropInput) => void;
  onDropProjects?: (input: MyWorkCellProjectDropInput) => void;
  hiddenNodeIDs?: Iterable<string>;
};

type ScopePickerRow = {
  key: string;
  depth: number;
  label: string;
  detail: string;
  icon: "company" | "group" | "user";
  scope: MyWorkSelectedScope;
};

const MY_WORK_MATRIX_ROLES: LogicGateRACIRole[] = ["responsible", "accountable", "consulted", "informed"];
const MY_WORK_MATRIX_PRIORITIES = [1, 2, 3, 4, 5, 0] as const;
type MyWorkMatrixPriority = typeof MY_WORK_MATRIX_PRIORITIES[number];
type MyWorkCellCreateInput = { priority: MyWorkMatrixPriority; creatorRACIRole?: LogicGateRACIRole };
type MyWorkNodeDropInput = MyWorkCellCreateInput & { logicGateID?: string; nodeIDs: string[]; fromLogicGateID?: string; targetUserID?: string };
type MyWorkCellNodeDropInput = MyWorkCellCreateInput & { nodeIDs: string[]; fromLogicGateID?: string };
type MyWorkCellLogicGateDropInput = MyWorkCellCreateInput & { logicGateIDs: string[]; nodeIDsByLogicGateID?: Record<string, string[]> };
type MyWorkCellProjectDropInput = MyWorkCellCreateInput & { projectIDs: string[]; logicGateIDsByProjectID?: Record<string, string[]>; nodeIDsByProjectID?: Record<string, string[]>; nodeIDsByLogicGateID?: Record<string, string[]> };
type MyWorkNodeDropResult = { gvic_projection_rows?: MyWorkMatrixRow[]; removed_projection_row_ids?: string[] } | null | undefined | void;
type MyWorkNodeDragPayload = { nodeIDs: string[]; fromLogicGateID?: string; targetUserID?: string };
type MyWorkLogicGateDragPayload = { logicGateIDs: string[]; nodeIDsByLogicGateID?: Record<string, string[]> };
type MyWorkProjectDragPayload = { projectIDs: string[]; logicGateIDsByProjectID?: Record<string, string[]>; nodeIDsByProjectID?: Record<string, string[]>; nodeIDsByLogicGateID?: Record<string, string[]> };
type MyWorkRoleColumnWidths = Record<LogicGateRACIRole, number>;
const HOME_INBOX_NODE_DRAG_MIME = "application/x-mangorts-home-inbox-node";
const HOME_INBOX_LOGIC_GATE_DRAG_MIME = "application/x-mangorts-home-inbox-logic-gate";
const HOME_INBOX_PROJECT_DRAG_MIME = "application/x-mangorts-home-inbox-project";
const MY_WORK_ROLE_COLUMN_WIDTHS_STORAGE_KEY = "mangorts.myWork.roleColumnWidths.v1";
const MY_WORK_SELECTED_VIEW_STORAGE_KEY = "mangorts.myWork.selectedView.v1";
const MY_WORK_PRIORITY_COLUMN_WIDTH = 104;
const MY_WORK_ROLE_COLUMN_DEFAULT_WIDTH = 282;
const MY_WORK_ROLE_COLUMN_MIN_WIDTH = 190;
const MY_WORK_ROLE_COLUMN_MAX_WIDTH = 620;
const MyWorkPerformanceDebugPanel = React.lazy(() => import("./MyWorkPerformanceDebugPanel"));
type MyWorkTreeStats = {
  topLevel: number;
  total: number;
  maxDepth: number;
  projects: number;
  logicGates: number;
  nodes: number;
};
type MyWorkNestedGroupStats = {
  topLevel: number;
  total: number;
  maxDepth: number;
};
type MyWorkMatrixCellRenderMetric = {
  priority: MyWorkMatrixPriority;
  role: LogicGateRACIRole;
  rows: number;
  totalRows: number;
  groups: number;
  filterMs: number;
  sortMs: number;
  groupMs: number;
  totalMs: number;
};
type MyWorkMatrixRenderMetrics = {
  renderID: number;
  startedAt: number;
  rows: number;
  totalRows: number;
  expandedGroupCount: number;
  groupings: string[];
  filterMs: number;
  sortMs: number;
  groupMs: number;
  nonEmptyCells: number;
  cellRows: number;
  cellTotalRows: number;
  cells: MyWorkMatrixCellRenderMetric[];
};
let myWorkMatrixDebugRenderSequence = 0;

export function MyWorkView({
  apiBase,
  loading,
  companyID,
  currentUserID,
  liveRefreshToken = 0,
  nodes,
  logicGates,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onRenameNode,
  onRequestDeleteNode,
  onCreateNodeInCell,
  onDropNodes,
  onDropNodesInCell,
  onDropLogicGates,
  onDropProjects,
  hiddenNodeIDs,
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
  const [settings, setSettings] = useState<MyWorkSavedGroupingSetting[]>(() => [fallbackSetting]);
  const [selectedSettingID, setSelectedSettingID] = useState(settings[0]?.setting_id ?? "");
  const [selectedScope, setSelectedScope] = useState<MyWorkSelectedScope>(() => defaultMyWorkSelectedScope(currentUserID));
  const [scopeMenuLevel, setScopeMenuLevel] = useState<MyWorkScopeLevel | null>(null);
  const [savedViewsReloadToken, setSavedViewsReloadToken] = useState(0);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(new Set());
  const [matrixCells, setMatrixCells] = useState<MyWorkMatrixCellWithUser[]>([]);
  const [matrixStateCacheKey, setMatrixStateCacheKey] = useState("");
  const [matrixLoading, setMatrixLoading] = useState(false);
  const [matrixError, setMatrixError] = useState("");
  const [settingsError, setSettingsError] = useState("");
  const [matrixReloadToken, setMatrixReloadToken] = useState(0);
  const [roleColumnWidths, setRoleColumnWidths] = useState<MyWorkRoleColumnWidths>(() => readMyWorkRoleColumnWidths(companyID));
  const matrixRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const lastLiveRefreshTokenRef = useRef(liveRefreshToken);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handleSavedViewsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ surface?: string; settingID?: string }>).detail;
      if (detail?.surface !== "my_work") return;
      const settingID = detail.settingID?.trim() ?? "";
      if (settingID) setSelectedSettingID(settingID);
      setSavedViewsReloadToken((value) => value + 1);
    };
    window.addEventListener(EVENT_HOME_SAVED_VIEWS_CHANGED, handleSavedViewsChanged);
    return () => window.removeEventListener(EVENT_HOME_SAVED_VIEWS_CHANGED, handleSavedViewsChanged);
  }, []);
  useEffect(() => subscribeCommittedEntityTitleUpdates((update) => {
    const title = update.title.trim();
    const resourceID = update.resourceID.trim();
    if (update.companyID !== companyID || !resourceID || !title) return;
    setMatrixCells((current) => patchMyWorkMatrixCellsForCommittedTitle(current, update));
  }), [companyID]);

  useEffect(() => {
    setSelectedScope(defaultMyWorkSelectedScope(currentUserID));
  }, [currentUserID]);

  useEffect(() => {
    setRoleColumnWidths(readMyWorkRoleColumnWidths(companyID));
  }, [companyID]);

  useEffect(() => {
    if (!apiBase || !companyID.trim()) {
      setSettings([fallbackSetting]);
      setSelectedSettingID(fallbackSetting.setting_id);
      return undefined;
    }
    let cancelled = false;
    setSettingsError("");
    void fetchSavedViews({ apiBase, companyID, surface: "my_work" }).then((savedViews) => {
      if (cancelled) return;
      const next = savedViewsToMyWorkSettings(savedViews, fallbackSetting, currentUserID);
      const settingsForState = next.length > 0 ? next : [fallbackSetting];
      const preferredSettingID = readMyWorkSelectedViewID(companyID, currentUserID);
      const nextSelectedSettingID = settingsForState.find((setting) => setting.setting_id === preferredSettingID)?.setting_id
        ?? settingsForState[0]?.setting_id
        ?? "";
      setSettings(settingsForState);
      setSelectedSettingID(nextSelectedSettingID);
      if (nextSelectedSettingID) storeMyWorkSelectedViewID(companyID, currentUserID, nextSelectedSettingID);
    }).catch((error) => {
      if (cancelled) return;
      setSettings([fallbackSetting]);
      setSelectedSettingID(fallbackSetting.setting_id);
      setSettingsError(savedViewErrorMessage(error, "Failed to load saved views"));
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, currentUserID, fallbackSetting, savedViewsReloadToken]);

  useEffect(() => {
    if (settings.some((setting) => setting.setting_id === selectedSettingID)) return;
    const nextSettingID = settings[0]?.setting_id ?? "";
    setSelectedSettingID(nextSettingID);
    if (nextSettingID) storeMyWorkSelectedViewID(companyID, currentUserID, nextSettingID);
  }, [companyID, currentUserID, selectedSettingID, settings]);

  const selectedSetting = settings.find((setting) => setting.setting_id === selectedSettingID) ?? settings[0] ?? fallbackSetting;
  const targetUserIDs = useMemo(() => userIDsForSelectedScope(selectedScope, companyUsers, childGroupsByParentID, membersByGroupID), [childGroupsByParentID, companyUsers, membersByGroupID, selectedScope]);
  const matrixTargetUserIDs = useMemo(() => uniqueMyWorkTargetUserIDs(targetUserIDs), [targetUserIDs]);
  const matrixCacheKey = useMemo(() => myWorkMatrixCacheKey({
    companyID,
    selectedScope,
    targetUserIDs: matrixTargetUserIDs,
  }), [companyID, matrixTargetUserIDs, selectedScope]);
  const cachedMatrixState = readMyWorkMatrixCache(matrixCacheKey);
  const matrixStateMatchesCacheKey = matrixStateCacheKey === matrixCacheKey;
  const baseDisplayedMatrixCells = matrixStateMatchesCacheKey
    ? matrixCells
    : cachedMatrixState?.hasValue
      ? cachedMatrixState.cells
      : [];
  const hiddenNodeIDSet = useMemo(() => new Set(cleanIDList(Array.from(hiddenNodeIDs ?? []))), [hiddenNodeIDs]);
  const displayedMatrixCells = hiddenNodeIDSet.size === 0
    ? baseDisplayedMatrixCells
    : baseDisplayedMatrixCells.filter((cell) => !hiddenNodeIDSet.has(cell.node_id?.trim() ?? ""));
  const displayedMatrixError = matrixStateMatchesCacheKey
    ? matrixError
    : cachedMatrixState?.hasValue
      ? myWorkMatrixFailureMessage(cachedMatrixState.failures, matrixTargetUserIDs, userByID)
      : "";
  const displayedMatrixLoading = matrixStateMatchesCacheKey
    ? matrixLoading
    : Boolean(cachedMatrixState?.loading || (!cachedMatrixState?.hasValue && apiBase && companyID.trim() && matrixTargetUserIDs.length > 0));

  const requestMatrixRefresh = useCallback((targetUserIDs = matrixTargetUserIDs, reason = "manual") => {
    const affectedTargetUserIDs = uniqueMyWorkTargetUserIDs(targetUserIDs);
    if (affectedTargetUserIDs.length > 0) markMyWorkMatrixCachesStaleForTargetUsers(affectedTargetUserIDs);
    else markMyWorkMatrixCacheStale(matrixCacheKey);
    myWorkDebugLog("view.refresh.request", {
      reason,
      cacheKey: matrixCacheKey,
      targetUserIDs: affectedTargetUserIDs,
      targetUserCount: affectedTargetUserIDs.length,
    });
    recordMyWorkDebugCause(reason, { cacheKey: matrixCacheKey, targetUserCount: affectedTargetUserIDs.length });
    if (matrixRefreshTimerRef.current !== null) window.clearTimeout(matrixRefreshTimerRef.current);
    matrixRefreshTimerRef.current = window.setTimeout(() => {
      matrixRefreshTimerRef.current = null;
      myWorkDebugLog("view.refresh.fire", { reason, cacheKey: matrixCacheKey });
      setMatrixReloadToken((value) => value + 1);
    }, 80);
  }, [matrixCacheKey, matrixTargetUserIDs]);

  useEffect(() => () => {
    if (matrixRefreshTimerRef.current !== null) {
      window.clearTimeout(matrixRefreshTimerRef.current);
      matrixRefreshTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!apiBase || !companyID || matrixTargetUserIDs.length === 0) {
      setMatrixCells([]);
      setMatrixStateCacheKey("");
      setMatrixError("");
      setMatrixLoading(false);
      return;
    }
    let cancelled = false;
    const cached = readMyWorkMatrixCache(matrixCacheKey);
    const debugEnabled = myWorkDebugEnabled();
    const loadStartedAt = debugEnabled ? myWorkDebugTimestampMs() : 0;
    if (debugEnabled) {
      publishMyWorkDebugSnapshot({ cache: readMyWorkMatrixCacheSummary(matrixCacheKey) });
      myWorkDebugLog("view.loadEffect.start", {
        cacheKey: matrixCacheKey,
        targetUserIDs: matrixTargetUserIDs,
        targetUserCount: matrixTargetUserIDs.length,
        cached: cached ? {
          hasValue: cached.hasValue,
          stale: cached.stale,
          loading: cached.loading,
          ageMs: cached.fetchedAt ? Math.round(Date.now() - cached.fetchedAt) : null,
          cells: cached.cells.length,
          failures: cached.failures.length,
        } : null,
      });
    }
    if (cached?.hasValue) {
      setMatrixCells(cached.cells);
      setMatrixStateCacheKey(matrixCacheKey);
      setMatrixError(myWorkMatrixFailureMessage(cached.failures, matrixTargetUserIDs, userByID));
      setMatrixLoading(cached.loading || cached.stale);
    } else {
      setMatrixCells([]);
      setMatrixStateCacheKey(matrixCacheKey);
      setMatrixError("");
      setMatrixLoading(true);
    }
    void loadMyWorkMatrixCacheEntry({
      cacheKey: matrixCacheKey,
      companyID,
      targetUserIDs: matrixTargetUserIDs,
      fetchMatrix: (targetUserID) => listMyWorkMatrixRows({ apiBase, companyID, targetUserID }),
    }).then(({ cells, failures }) => {
      if (cancelled) return;
      setMatrixCells(cells);
      setMatrixStateCacheKey(matrixCacheKey);
      setMatrixError(myWorkMatrixFailureMessage(failures, matrixTargetUserIDs, userByID));
      if (debugEnabled) {
        const durationMs = myWorkDebugDurationMs(loadStartedAt);
        const treeStats = myWorkMatrixCellTreeStats(cells);
        publishMyWorkDebugSnapshot({
          cache: readMyWorkMatrixCacheSummary(matrixCacheKey, "loaded"),
          matrixPayloadStats: treeStats,
          timings: { matrixFetchCacheLoadMs: durationMs },
        });
        myWorkDebugLog("view.loadEffect.done", {
          cacheKey: matrixCacheKey,
          durationMs,
          cells: cells.length,
          failures: failures.length,
          treeStats,
        });
      }
    }).catch((error) => {
      if (cancelled) return;
      setMatrixStateCacheKey(matrixCacheKey);
      setMatrixError(savedViewErrorMessage(error, "Failed to load My Work"));
      if (debugEnabled) {
        myWorkDebugLog("view.loadEffect.error", {
          cacheKey: matrixCacheKey,
          durationMs: myWorkDebugDurationMs(loadStartedAt),
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }).finally(() => {
      if (!cancelled) setMatrixLoading(false);
    });
    return () => { cancelled = true; };
  }, [apiBase, companyID, matrixCacheKey, matrixReloadToken, matrixTargetUserIDs, userByID]);

  useEffect(() => {
    if (liveRefreshToken === lastLiveRefreshTokenRef.current) return;
    lastLiveRefreshTokenRef.current = liveRefreshToken;
    if (!apiBase || !companyID.trim() || matrixTargetUserIDs.length === 0) return;
    requestMatrixRefresh(matrixTargetUserIDs, "liveRefreshToken");
  }, [apiBase, companyID, liveRefreshToken, matrixTargetUserIDs, requestMatrixRefresh]);

  const applyNodeDropResult = useCallback((result: MyWorkNodeDropResult, titleVersionAtStart: number) => {
    const rows = result?.gvic_projection_rows ?? [];
    const removedProjectionRowIDs = result?.removed_projection_row_ids ?? [];
    if (rows.length === 0 && removedProjectionRowIDs.length === 0) return;
    const patch = {
      companyID,
      rows,
      removedProjectionRowIDs,
      targetUserIDs: matrixTargetUserIDs,
      titleVersionAtStart,
    };
    setMatrixCells((previous) => patchMyWorkMatrixCells(previous, patch));
    setMatrixStateCacheKey(matrixCacheKey);
    patchMyWorkMatrixCacheEntry(matrixCacheKey, patch);
  }, [companyID, matrixCacheKey, matrixTargetUserIDs]);

  const handleDropNodes = useCallback((input: MyWorkNodeDropInput) => {
    const titleVersionAtStart = readCommittedEntityTitleVersion();
    const result = onDropNodes?.(input);
    if (result && typeof (result as Promise<MyWorkNodeDropResult>).then === "function") {
      void (result as Promise<MyWorkNodeDropResult>).then((resolved) => applyNodeDropResult(resolved, titleVersionAtStart));
      return;
    }
    applyNodeDropResult(result as MyWorkNodeDropResult, titleVersionAtStart);
  }, [applyNodeDropResult, onDropNodes]);

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
    if (selectedScope.level !== level) {
      setSelectedScope(nextScope);
    }
    setScopeMenuLevel((current) => (current === level ? null : level));
  }, [defaultScopeForLevel, selectedScope.level]);

  const selectScope = useCallback((scope: MyWorkSelectedScope) => {
    setSelectedScope(scope);
    setScopeMenuLevel(null);
  }, []);

  const updateRoleColumnWidth = useCallback((role: LogicGateRACIRole, width: number) => {
    setRoleColumnWidths((current) => {
      const next = { ...current, [role]: clampMyWorkRoleColumnWidth(width) };
      storeMyWorkRoleColumnWidths(companyID, next);
      return next;
    });
  }, [companyID]);

  const startRoleColumnResize = useCallback((role: LogicGateRACIRole, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startWidth = roleColumnWidths[role];
    const previousCursor = ownerDocument.body.style.cursor;
    const previousUserSelect = ownerDocument.body.style.userSelect;
    ownerDocument.body.style.cursor = "col-resize";
    ownerDocument.body.style.userSelect = "none";
    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateRoleColumnWidth(role, startWidth + moveEvent.clientX - startX);
    };
    const stopResize = () => {
      ownerDocument.removeEventListener("pointermove", handlePointerMove);
      ownerDocument.removeEventListener("pointerup", stopResize);
      ownerDocument.removeEventListener("pointercancel", stopResize);
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.body.style.userSelect = previousUserSelect;
    };
    ownerDocument.addEventListener("pointermove", handlePointerMove);
    ownerDocument.addEventListener("pointerup", stopResize);
    ownerDocument.addEventListener("pointercancel", stopResize);
  }, [roleColumnWidths, updateRoleColumnWidth]);

  const rows = useMemo(() => {
    const debugEnabled = myWorkDebugEnabled();
    const startedAt = debugEnabled ? myWorkDebugTimestampMs() : 0;
    const result = buildMyWorkRowsFromMatrix({
      matrixCells: displayedMatrixCells,
      userByID,
      groupByID,
      groupIDsByUserID,
    });
    if (debugEnabled) {
      const durationMs = myWorkDebugDurationMs(startedAt);
      const matrixTreeStats = myWorkMatrixCellTreeStats(displayedMatrixCells);
      const rowStats = myWorkResourceRowStats(result);
      publishMyWorkDebugSnapshot({
        matrixPayloadStats: matrixTreeStats,
        rowStats,
        timings: { rowsFromMatrixMs: durationMs },
      });
      myWorkDebugLog("client.rowsFromMatrix", {
        durationMs,
        matrixCells: displayedMatrixCells.length,
        matrixTreeStats,
        rowStats,
      });
    }
    return result;
  }, [displayedMatrixCells, groupByID, groupIDsByUserID, userByID]);

  const visibleRows = rows;
  const displayGroupings = useMemo(() => normalizeMyWorkGroupingStack(selectedSetting.groupings), [selectedSetting.groupings]);
  const showProjectHeaders = displayGroupings.some((grouping) => grouping.field === "project");
  const showLogicGateHeaders = displayGroupings.some((grouping) => grouping.field === "logic_gate");
  const matrixRowsByCell = useMemo(() => buildMyWorkRowsByMatrixCell(visibleRows), [visibleRows]);
  const defaultExpandedGroupIDs = useMemo(() => {
    const debugEnabled = myWorkDebugEnabled();
    const startedAt = debugEnabled ? myWorkDebugTimestampMs() : 0;
    const cellGroups: Array<{ cellKey: string; groups: MyWorkNestedGroup[] }> = [];
    let groupStats: MyWorkNestedGroupStats = { topLevel: 0, total: 0, maxDepth: 0 };
    for (const [cellKey, cellRows] of matrixRowsByCell.entries()) {
      const groups = buildNestedGroups(cellRows, displayGroupings);
      if (groups.length === 0) continue;
      cellGroups.push({ cellKey, groups });
      groupStats = mergeMyWorkNestedGroupStats(groupStats, myWorkNestedGroupStats(groups));
    }
    const result = computeAllExpandedCellGroupIDs(cellGroups);
    if (debugEnabled) {
      const durationMs = myWorkDebugDurationMs(startedAt);
      const rowStats = myWorkResourceRowStats(visibleRows);
      publishMyWorkDebugSnapshot({
        rowStats,
        topLevelGroupStats: groupStats,
        timings: { defaultExpansionMs: durationMs },
      });
      myWorkDebugLog("client.defaultExpandedGroups", {
        durationMs,
        rowStats,
        groupStats,
        expandedGroupCount: result.size,
        groupings: displayGroupings.map((grouping) => `${grouping.field}:${grouping.direction}`),
      });
    }
    return result;
  }, [displayGroupings, matrixRowsByCell, visibleRows]);
  const groupingSignature = useMemo(() => {
    const debugEnabled = myWorkDebugEnabled();
    const startedAt = debugEnabled ? myWorkDebugTimestampMs() : 0;
    const result = JSON.stringify({
      setting: selectedSetting.setting_id,
      scope: selectedScope,
      groupings: displayGroupings,
      rows: visibleRows.map((row) => row.rowKey ?? `${row.kind}:${row.id}`).sort(),
    });
    if (debugEnabled) {
      const durationMs = myWorkDebugDurationMs(startedAt);
      const rowStats = myWorkResourceRowStats(visibleRows);
      publishMyWorkDebugSnapshot({ rowStats, timings: { groupingSignatureMs: durationMs } });
      myWorkDebugLog("client.groupingSignature", {
        durationMs,
        rowStats,
        signatureLength: result.length,
      });
    }
    return result;
  }, [displayGroupings, selectedScope, selectedSetting.setting_id, visibleRows]);

  useEffect(() => {
    setExpandedGroupIDs(defaultExpandedGroupIDs);
  }, [defaultExpandedGroupIDs, groupingSignature]);

  const scopeRows = useMemo(() => buildScopePickerRows({
    level: scopeMenuLevel ?? selectedScope.level,
    currentUserID,
    companyUsers,
    companyUserGroups,
    groupByID,
    membersByGroupID,
    childGroupsByParentID,
    currentUserImmediateGroupID,
  }), [childGroupsByParentID, companyUserGroups, companyUsers, currentUserID, currentUserImmediateGroupID, groupByID, membersByGroupID, scopeMenuLevel, selectedScope.level]);
  const scopeLabel = selectedScopeLabel(selectedScope, userByID, groupByID);
  useEffect(() => {
    if (!myWorkDebugEnabled()) return;
    const displayedRowStats = myWorkResourceRowStats(visibleRows);
    publishMyWorkDebugSnapshot({
      activeHomeView: "my-work",
      companyID,
      currentUserID,
      selectedScope,
      selectedScopeLabel: scopeLabel,
      targetUserIDs: matrixTargetUserIDs,
      targetUserCount: matrixTargetUserIDs.length,
      cache: readMyWorkMatrixCacheSummary(matrixCacheKey),
      rowStats: displayedRowStats,
    });
    myWorkDebugLog("view.state", {
      debugFlag: MY_WORK_DEBUG_STORAGE_KEY,
      scope: selectedScope,
      scopeLabel,
      cacheKey: matrixCacheKey,
      targetUserIDs: matrixTargetUserIDs,
      targetUserCount: matrixTargetUserIDs.length,
      matrixStateCacheKey,
      displayedRows: visibleRows.length,
      displayedRowStats,
      expandedGroupCount: expandedGroupIDs.size,
      loading,
      matrixLoading: displayedMatrixLoading,
      matrixError: displayedMatrixError,
    });
  }, [companyID, currentUserID, displayedMatrixError, displayedMatrixLoading, expandedGroupIDs.size, loading, matrixCacheKey, matrixStateCacheKey, matrixTargetUserIDs, scopeLabel, selectedScope, visibleRows]);

  return (
    <section style={myWorkShellStyle}>
      <div className="mango-my-work-header" style={myWorkHeaderStyle}>
        <div className="mango-my-work-title-stack" style={myWorkTitleStackStyle}>
          <h2 style={myWorkTitleStyle}>My Work</h2>
          <div style={myWorkMetaStyle}>
            {scopeLabel}
            {loading || displayedMatrixLoading ? " - Loading" : ""}
            {displayedMatrixError ? ` - ${displayedMatrixError}` : ""}
            {settingsError ? ` - ${settingsError}` : ""}
          </div>
        </div>
        <MyWorkScopeControls
          selectedScope={selectedScope}
          scopeMenuLevel={scopeMenuLevel}
          scopeRows={scopeRows}
          onSelectScopeLevel={selectScopeLevel}
          onSelectScope={selectScope}
          onSetScopeMenuLevel={setScopeMenuLevel}
        />
      </div>
      {myWorkDebugEnabled() ? (
        <React.Suspense fallback={null}>
          <MyWorkPerformanceDebugPanel />
        </React.Suspense>
      ) : null}
      <div className="mango-home-scroll" style={myWorkMatrixScrollStyle}>
        {visibleRows.length === 0 && !loading && !displayedMatrixLoading ? (
          <div style={myWorkEmptyStyle}>No active work for this scope</div>
        ) : (
          <MyWorkMatrix
            rows={visibleRows}
            rowsByCell={matrixRowsByCell}
            groupings={displayGroupings}
            showProjectHeaders={showProjectHeaders}
            showLogicGateHeaders={showLogicGateHeaders}
            expandedGroupIDs={expandedGroupIDs}
            onToggleGroup={(groupID) => {
              setExpandedGroupIDs((current) => {
                const next = new Set(current);
                const wasExpanded = next.has(groupID);
                if (next.has(groupID)) next.delete(groupID);
                else next.add(groupID);
                myWorkDebugLog("view.groupToggle", {
                  groupID,
                  wasExpanded,
                  expandedGroupCountBefore: current.size,
                  expandedGroupCountAfter: next.size,
                });
                return next;
              });
            }}
            onOpenNode={onOpenNode}
            onOpenLogicGate={onOpenLogicGate}
            onOpenProject={onOpenProject}
            onRenameNode={onRenameNode}
            onRequestDeleteNode={onRequestDeleteNode}
            onCreateNodeInCell={onCreateNodeInCell}
            onDropNodes={handleDropNodes}
            onDropNodesInCell={onDropNodesInCell}
            onDropLogicGates={onDropLogicGates}
            onDropProjects={onDropProjects}
            nodeByID={new Map(nodes.map((node) => [node.node_id, node]))}
            logicGateByID={new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate]))}
            roleColumnWidths={roleColumnWidths}
            onStartRoleColumnResize={startRoleColumnResize}
          />
        )}
      </div>
    </section>
  );
}

function MyWorkScopeControls({
  selectedScope,
  scopeMenuLevel,
  scopeRows,
  onSelectScopeLevel,
  onSelectScope,
  onSetScopeMenuLevel,
}: {
  selectedScope: MyWorkSelectedScope;
  scopeMenuLevel: MyWorkScopeLevel | null;
  scopeRows: ScopePickerRow[];
  onSelectScopeLevel: (level: MyWorkScopeLevel) => void;
  onSelectScope: (scope: MyWorkSelectedScope) => void;
  onSetScopeMenuLevel: (level: MyWorkScopeLevel | null) => void;
}) {
  const [collapsedScopeRowKeys, setCollapsedScopeRowKeys] = useState<Set<string>>(new Set());
  const scopeMenuRef = useRef<HTMLDivElement>(null);
  const scopeRowsWithChildren = useMemo(() => scopeRows.map((row, index) => ({
    ...row,
    hasChildren: Boolean(scopeRows[index + 1] && scopeRows[index + 1].depth > row.depth),
  })), [scopeRows]);
  const visibleScopeRows = useMemo(() => {
    const out: Array<ScopePickerRow & { hasChildren: boolean }> = [];
    const collapsedAncestorDepths: number[] = [];
    for (const row of scopeRowsWithChildren) {
      while (collapsedAncestorDepths.length > 0 && row.depth <= collapsedAncestorDepths[collapsedAncestorDepths.length - 1]) {
        collapsedAncestorDepths.pop();
      }
      if (collapsedAncestorDepths.length > 0) continue;
      out.push(row);
      if (row.hasChildren && collapsedScopeRowKeys.has(row.key)) collapsedAncestorDepths.push(row.depth);
    }
    return out;
  }, [collapsedScopeRowKeys, scopeRowsWithChildren]);
  const toggleScopeRowCollapsed = useCallback((rowKey: string) => {
    setCollapsedScopeRowKeys((current) => {
      const next = new Set(current);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  }, []);
  useEffect(() => {
    if (!scopeMenuLevel) return undefined;
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && scopeMenuRef.current?.contains(target)) return;
      onSetScopeMenuLevel(null);
    };
    const timer = window.setTimeout(() => window.addEventListener("mousedown", handleOutsideClick, true), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [onSetScopeMenuLevel, scopeMenuLevel]);

  return (
    <div style={scopeControlRowStyle}>
      <div ref={scopeMenuRef} style={scopeTabsAnchorStyle}>
        <div style={scopeTabsStyle}>
          {(["me", "team", "all"] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={`mango-my-work-scope-tab${selectedScope.level === level ? " is-active" : ""}`}
              style={scopeTabStyle(level, selectedScope.level === level)}
              onClick={() => onSelectScopeLevel(level)}
            >
              {level === "me" ? "Me" : level === "team" ? "My Team" : "All"}
            </button>
          ))}
        </div>
        {scopeMenuLevel && (
          <div className="mango-my-work-scope-picker mango-home-scroll" style={scopePickerStyle}>
            {scopeRows.length === 0 ? (
              <div style={scopePickerEmptyStyle}>No people or groups</div>
            ) : visibleScopeRows.map((row) => {
              const collapsed = collapsedScopeRowKeys.has(row.key);
              return (
                <div
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  className="mango-my-work-menu-option"
                  style={scopePickerRowStyle(row.depth, scopesEqual(row.scope, selectedScope))}
                  onClick={() => onSelectScope(row.scope)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelectScope(row.scope);
                  }}
                >
                  {row.hasChildren ? (
                    <button
                      type="button"
                      className="mango-my-work-scope-disclosure"
                      aria-label={collapsed ? `Expand ${row.label}` : `Collapse ${row.label}`}
                      style={scopePickerDisclosureStyle}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleScopeRowCollapsed(row.key);
                      }}
                    >
                      <ExplorerDisclosureIcon open={!collapsed} color="currentColor" />
                    </button>
                  ) : <span style={scopePickerDisclosureSpacerStyle} />}
                  <ScopeIcon icon={row.icon} />
                  <span style={scopePickerTextStyle}>
                    <span style={scopePickerLabelStyle}>{row.label}</span>
                    {row.detail && <span style={scopePickerDetailStyle}>{row.detail}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function MyWorkGroupList({
  groups,
  cellKey,
  role,
  expandedGroupIDs,
  onToggleGroup,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onRenameNode,
  onRequestDeleteNode,
  nodeByID,
  logicGateByID,
  showProjectHeaders,
  showLogicGateHeaders,
  projectGroupAncestor = false,
  logicGateGroupAncestor = false,
}: {
  groups: MyWorkNestedGroup[];
  cellKey: string;
  role: LogicGateRACIRole;
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onRenameNode?: (nodeID: string) => void;
  onRequestDeleteNode?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  showProjectHeaders: boolean;
  showLogicGateHeaders: boolean;
  projectGroupAncestor?: boolean;
  logicGateGroupAncestor?: boolean;
}) {
  return (
    <div style={groupListStyle}>
      {groups.map((group) => {
        const groupStateID = myWorkCellGroupStateID(cellKey, group.id);
        const open = expandedGroupIDs.has(groupStateID);
        const leafRows = group.groups.length === 0 ? group.rows : [];
        const resourceTarget = myWorkGroupResourceTarget(group);
        const nextProjectGroupAncestor = projectGroupAncestor || group.field === "project";
        const nextLogicGateGroupAncestor = logicGateGroupAncestor || group.field === "logic_gate";
        return (
          <div key={group.id} style={groupBlockStyle}>
            <div style={groupHeaderStyle(group.depth, role)}>
              <button
                type="button"
                aria-label={`${open ? "Collapse" : "Expand"} ${group.label}`}
                style={disclosureButtonStyle}
                onClick={() => onToggleGroup(groupStateID)}
              >
                <ExplorerDisclosureIcon open={open} color="rgba(15, 23, 42, 0.66)" />
              </button>
              {resourceTarget ? (
                <button
                  type="button"
                  style={groupHeaderResourceButtonStyle}
                  onClick={() => {
                    if (resourceTarget.kind === "project") onOpenProject(resourceTarget.id, resourceTarget.label);
                    else onOpenLogicGate(resourceTarget.id, resourceTarget.label);
                  }}
                >
                  <GroupHeaderIcon field={group.field} role={role} />
                  <span style={groupHeaderLabelStyle}>{group.label}</span>
                </button>
              ) : (
                <span style={groupHeaderStaticContentStyle}>
                  <GroupHeaderIcon field={group.field} role={role} />
                  <span style={groupHeaderLabelStyle}>{group.label}</span>
                </span>
              )}
            </div>
            {open && group.groups.length > 0 && (
              <MyWorkGroupList
                groups={group.groups}
                cellKey={cellKey}
                role={role}
                expandedGroupIDs={expandedGroupIDs}
                onToggleGroup={onToggleGroup}
                onOpenNode={onOpenNode}
                onOpenLogicGate={onOpenLogicGate}
                onOpenProject={onOpenProject}
                onRenameNode={onRenameNode}
                onRequestDeleteNode={onRequestDeleteNode}
                nodeByID={nodeByID}
                logicGateByID={logicGateByID}
                showProjectHeaders={showProjectHeaders}
                showLogicGateHeaders={showLogicGateHeaders}
                projectGroupAncestor={nextProjectGroupAncestor}
                logicGateGroupAncestor={nextLogicGateGroupAncestor}
              />
            )}
            {open && leafRows.length > 0 && (
              <MyWorkRows rows={leafRows} role={role} depth={group.depth + 1} showProjectHeaders={showProjectHeaders && !nextProjectGroupAncestor} showLogicGateHeaders={showLogicGateHeaders && !nextLogicGateGroupAncestor} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} onOpenProject={onOpenProject} onRenameNode={onRenameNode} onRequestDeleteNode={onRequestDeleteNode} nodeByID={nodeByID} logicGateByID={logicGateByID} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function MyWorkRows({
  rows,
  role,
  depth,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onRenameNode,
  onRequestDeleteNode,
  nodeByID,
  logicGateByID,
  showProjectHeaders = true,
  showLogicGateHeaders = true,
}: {
  rows: MyWorkResourceRow[];
  role: LogicGateRACIRole;
  depth: number;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onRenameNode?: (nodeID: string) => void;
  onRequestDeleteNode?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  showProjectHeaders?: boolean;
  showLogicGateHeaders?: boolean;
}) {
  const sortedRows = useMemo(() => sortMyWorkRows(rows), [rows]);
  const displayRows = useMemo(() => buildMyWorkDisplayRows(sortedRows, {
    baseDepth: depth,
    showProjectHeaders,
    showLogicGateHeaders,
  }), [depth, showLogicGateHeaders, showProjectHeaders, sortedRows]);

  return (
    <div style={rowListStyle}>
      {displayRows.map((displayRow) => (
        <MyWorkDisplayRowItem
          key={displayRow.key}
          displayRow={displayRow}
          role={role}
          onOpenNode={onOpenNode}
          onOpenLogicGate={onOpenLogicGate}
          onOpenProject={onOpenProject}
          onRenameNode={onRenameNode}
          onRequestDeleteNode={onRequestDeleteNode}
          nodeByID={nodeByID}
          logicGateByID={logicGateByID}
        />
      ))}
    </div>
  );
}

function MyWorkDisplayRowItem({
  displayRow,
  role,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onRenameNode,
  onRequestDeleteNode,
  nodeByID,
  logicGateByID,
}: {
  displayRow: MyWorkDisplayRow;
  role: LogicGateRACIRole;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onRenameNode?: (nodeID: string) => void;
  onRequestDeleteNode?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
}) {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  if (displayRow.kind !== "node") {
    const kind = displayRow.kind === "project_header" ? "project" : "logic_gate";
    const canOpen = displayRow.kind === "project_header"
      ? Boolean(displayRow.projectID.trim())
      : Boolean(displayRow.logicGateID.trim());
    const content = (
      <>
        <ExplorerRowIcon kind={kind} />
        <span style={workRowTitleTextStyle(true)}>{displayRow.title}</span>
      </>
    );
    return (
      <div style={logicGateSectionBlockStyle}>
        <div style={workRowStyle(displayRow.depth, role, kind, true)}>
          {canOpen ? (
            <button
              type="button"
              style={workRowTitleCellButtonStyle}
              onClick={() => {
                if (displayRow.kind === "project_header") onOpenProject(displayRow.projectID, displayRow.title);
                else onOpenLogicGate(displayRow.logicGateID, displayRow.title);
              }}
            >
              {content}
            </button>
          ) : (
            <span style={workRowTitleStaticCellStyle}>{content}</span>
          )}
        </div>
      </div>
    );
  }

  const row = displayRow.row;
  const status = row.status?.trim() || "No status";
  const rowLogicGateID = row.logicGateIDs[0]?.trim() ?? "";
  const rowTargetUserID = row.participantUserIDs[0]?.trim() ?? "";
  return (
    <div style={logicGateSectionBlockStyle}>
      <div
        style={workRowStyle(displayRow.depth, role, row.kind, false)}
        draggable
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
        onDragStart={(event) => {
          writeMyWorkDragPayload(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME, { nodeIDs: [row.id], fromLogicGateID: rowLogicGateID, targetUserID: rowTargetUserID });
        }}
      >
        <button
          type="button"
          style={workRowTitleCellButtonStyle}
          onClick={() => openMyWorkRowResource(row, nodeByID, logicGateByID, onOpenNode, onOpenLogicGate, onOpenProject)}
        >
          <ExplorerRowIcon kind={row.kind} />
          <span style={workRowTitleTextStyle(false)}>{row.title}</span>
        </button>
        <span style={workRowStatusStyle(role)}>{status}</span>
      </div>
      {contextMenu && (
        <FrameRightClickMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)} minWidth={190}>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              openAppPathInNewTab(buildNodeRoute(row.id));
              setContextMenu(null);
            }}
          >
            Open in new browser tab
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              requestAppSidebarPin({ kind: "node", id: row.id, name: row.title });
              setContextMenu(null);
            }}
          >
            Pin
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              onRenameNode?.(row.id);
              setContextMenu(null);
            }}
          >
            Rename
          </button>
          <div style={myWorkContextMenuDividerStyle} />
          <button
            type="button"
            style={{ ...sharedInboxContextMenuButtonStyle, color: "#dc2626" }}
            onClick={(event) => {
              onRequestDeleteNode?.(row.id, confirmMenuPositionFromElement(event.currentTarget));
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </FrameRightClickMenu>
      )}
    </div>
  );
}

type MyWorkGroupResourceTarget = {
  kind: "project" | "logic_gate";
  id: string;
  label: string;
};

function myWorkGroupResourceTarget(group: MyWorkNestedGroup): MyWorkGroupResourceTarget | null {
  if (group.field !== "project" && group.field !== "logic_gate") return null;
  const rows = collectMyWorkGroupRows(group);
  if (group.field === "logic_gate") {
    const logicGateLabelsByID = new Map<string, string>();
    for (const row of rows) {
      const logicGateID = row.logicGateIDs[0]?.trim() ?? "";
      if (!logicGateID) continue;
      const label = row.logicGateLabels.find((logicGateLabel) => logicGateLabel.trim())?.trim() || group.label;
      logicGateLabelsByID.set(logicGateID, label);
    }
    if (logicGateLabelsByID.size !== 1) return null;
    const [id, label] = logicGateLabelsByID.entries().next().value as [string, string];
    return { kind: "logic_gate", id, label: label || group.label };
  }
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

function myWorkMatrixCellTreeStats(cells: MyWorkMatrixCellWithUser[]): MyWorkTreeStats {
  const stats = emptyMyWorkTreeStats(cells.length);
  for (const row of cells) {
    stats.maxDepth = Math.max(stats.maxDepth, 1);
    if (row.project_id?.trim()) stats.projects += 1;
    if (row.logic_gate_id?.trim()) stats.logicGates += 1;
    if (row.node_id?.trim()) stats.nodes += 1;
    stats.total += 1;
  }
  return stats;
}
function myWorkResourceRowStats(rows: MyWorkResourceRow[]): MyWorkTreeStats {
  const stats = emptyMyWorkTreeStats(rows.length);
  for (const row of rows) addMyWorkResourceRowStats(stats, row, 1);
  return stats;
}

function myWorkNestedGroupStats(groups: MyWorkNestedGroup[]): MyWorkNestedGroupStats {
  const stats: MyWorkNestedGroupStats = { topLevel: groups.length, total: 0, maxDepth: 0 };
  const visit = (group: MyWorkNestedGroup, depth: number) => {
    stats.total += 1;
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    for (const child of group.groups) visit(child, depth + 1);
  };
  for (const group of groups) visit(group, 1);
  return stats;
}

function mergeMyWorkNestedGroupStats(left: MyWorkNestedGroupStats, right: MyWorkNestedGroupStats): MyWorkNestedGroupStats {
  return {
    topLevel: left.topLevel + right.topLevel,
    total: left.total + right.total,
    maxDepth: Math.max(left.maxDepth, right.maxDepth),
  };
}

function buildMyWorkRowsByMatrixCell(rows: MyWorkResourceRow[]): Map<string, MyWorkResourceRow[]> {
  const out = new Map<string, MyWorkResourceRow[]>();
  for (const row of rows) {
    const role = row.primaryRACIRole;
    if (!role) continue;
    const key = myWorkCellBucketKey(role, priorityBucket(row.priority));
    const list = out.get(key) ?? [];
    list.push(row);
    out.set(key, list);
  }
  for (const [key, list] of out.entries()) out.set(key, sortMyWorkRows(list));
  return out;
}

function emptyMyWorkTreeStats(topLevel: number): MyWorkTreeStats {
  return { topLevel, total: 0, maxDepth: 0, projects: 0, logicGates: 0, nodes: 0 };
}



function addMyWorkResourceRowStats(stats: MyWorkTreeStats, row: MyWorkResourceRow, depth: number): void {
  stats.total += 1;
  stats.maxDepth = Math.max(stats.maxDepth, depth);
  if (row.kind === "project") stats.projects += 1;
  else if (row.kind === "logic_gate") stats.logicGates += 1;
  else if (row.kind === "node") stats.nodes += 1;
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


function MyWorkMatrix({
  rows,
  rowsByCell,
  groupings,
  showProjectHeaders,
  showLogicGateHeaders,
  expandedGroupIDs,
  onToggleGroup,
  onOpenNode,
  onOpenLogicGate,
  onOpenProject,
  onRenameNode,
  onRequestDeleteNode,
  onCreateNodeInCell,
  onDropNodes,
  onDropNodesInCell,
  onDropLogicGates,
  onDropProjects,
  nodeByID,
  logicGateByID,
  roleColumnWidths,
  onStartRoleColumnResize,
}: {
  rows: MyWorkResourceRow[];
  rowsByCell: Map<string, MyWorkResourceRow[]>;
  groupings: MyWorkGroupingSetting[];
  showProjectHeaders: boolean;
  showLogicGateHeaders: boolean;
  expandedGroupIDs: Set<string>;
  onToggleGroup: (groupID: string) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenProject: (projectID: string, label: string) => void;
  onRenameNode?: (nodeID: string) => void;
  onRequestDeleteNode?: (nodeID: string, position?: ConfirmActionMenuPosition) => void;
  onCreateNodeInCell?: (input: MyWorkCellCreateInput) => void;
  onDropNodes?: (input: MyWorkNodeDropInput) => void;
  onDropNodesInCell?: (input: MyWorkCellNodeDropInput) => void;
  onDropLogicGates?: (input: MyWorkCellLogicGateDropInput) => void;
  onDropProjects?: (input: MyWorkCellProjectDropInput) => void;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  roleColumnWidths: MyWorkRoleColumnWidths;
  onStartRoleColumnResize: (role: LogicGateRACIRole, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  const [createMenu, setCreateMenu] = useState<{ x: number; y: number; input: MyWorkCellCreateInput } | null>(null);
  const hasCreateCellActions = Boolean(onCreateNodeInCell);
  const renderMetricsRef = useRef<MyWorkMatrixRenderMetrics | null>(null);
  const debugEnabled = myWorkDebugEnabled();
  const renderMetrics: MyWorkMatrixRenderMetrics | null = debugEnabled
    ? {
      renderID: ++myWorkMatrixDebugRenderSequence,
      startedAt: myWorkDebugTimestampMs(),
      rows: rows.length,
      totalRows: myWorkResourceRowStats(rows).total,
      expandedGroupCount: expandedGroupIDs.size,
      groupings: groupings.map((grouping) => `${grouping.field}:${grouping.direction}`),
      filterMs: 0,
      sortMs: 0,
      groupMs: 0,
      nonEmptyCells: 0,
      cellRows: 0,
      cellTotalRows: 0,
      cells: [],
    }
    : null;
  renderMetricsRef.current = renderMetrics;
  useEffect(() => {
    const metrics = renderMetricsRef.current;
    if (!metrics) return;
    const slowestCells = [...metrics.cells]
      .sort((left, right) => right.totalMs - left.totalMs)
      .slice(0, 8);
    const commitDurationMs = myWorkDebugDurationMs(metrics.startedAt);
    const filterMs = Math.round(metrics.filterMs * 10) / 10;
    const sortMs = Math.round(metrics.sortMs * 10) / 10;
    const groupMs = Math.round(metrics.groupMs * 10) / 10;
    publishMyWorkDebugSnapshot({
      timings: {
        matrixRenderCommitMs: commitDurationMs,
        perCellFilterMs: filterMs,
        perCellSortMs: sortMs,
        perCellGroupingMs: groupMs,
      },
      matrixRender: {
        renderID: metrics.renderID,
        rows: metrics.rows,
        totalRows: metrics.totalRows,
        expandedGroupCount: metrics.expandedGroupCount,
        groupings: metrics.groupings,
        nonEmptyCells: metrics.nonEmptyCells,
        cellRows: metrics.cellRows,
        cellTotalRows: metrics.cellTotalRows,
        slowestCells,
      },
    });
    myWorkDebugLog("matrix.render", {
      renderID: metrics.renderID,
      commitDurationMs,
      rows: metrics.rows,
      totalRows: metrics.totalRows,
      expandedGroupCount: metrics.expandedGroupCount,
      groupings: metrics.groupings,
      filterMs,
      sortMs,
      groupMs,
      nonEmptyCells: metrics.nonEmptyCells,
      cellRows: metrics.cellRows,
      cellTotalRows: metrics.cellTotalRows,
      slowestCells,
    });
  });
  return (
    <>
      <div style={myWorkMatrixGridStyle(roleColumnWidths)}>
      <div style={myWorkMatrixCornerStyle}>Priority</div>
      {MY_WORK_MATRIX_ROLES.map((role) => (
        <div key={role} style={myWorkMatrixColumnHeaderStyle(role)}>
          <strong style={logicGateRACIColumnLetterStyle(role)}>{myWorkRACIRoleLetter(role)}</strong>
          <span style={logicGateRACIColumnLabelStyle(role)}>{RACIRoleLabel(role)}</span>
          <button
            type="button"
            aria-label={`Resize ${RACIRoleLabel(role)} column`}
            title={`Resize ${RACIRoleLabel(role)} column`}
            style={myWorkColumnResizeHandleStyle}
            onPointerDown={(event) => onStartRoleColumnResize(role, event)}
          />
        </div>
      ))}
      {MY_WORK_MATRIX_PRIORITIES.map((priority) => (
        <React.Fragment key={priority}>
          <div style={myWorkMatrixPriorityHeaderStyle(priority)}>{priorityLabel(priority)}</div>
          {MY_WORK_MATRIX_ROLES.map((role) => {
            const cellKey = myWorkCellBucketKey(role, priority);
            const filterStartedAt = renderMetrics ? myWorkDebugTimestampMs() : 0;
            const filteredRows = rowsByCell.get(cellKey) ?? [];
            const filterMs = renderMetrics ? myWorkDebugDurationMs(filterStartedAt) : 0;
            const sortStartedAt = renderMetrics ? myWorkDebugTimestampMs() : 0;
            const cellRows = filteredRows;
            const sortMs = renderMetrics ? myWorkDebugDurationMs(sortStartedAt) : 0;
            const groupStartedAt = renderMetrics ? myWorkDebugTimestampMs() : 0;
            const groups = buildNestedGroups(cellRows, groupings);
            const groupMs = renderMetrics ? myWorkDebugDurationMs(groupStartedAt) : 0;
            if (renderMetrics) {
              const totalMs = Math.round((filterMs + sortMs + groupMs) * 10) / 10;
              const rowStats = myWorkResourceRowStats(cellRows);
              const groupStats = myWorkNestedGroupStats(groups);
              renderMetrics.filterMs += filterMs;
              renderMetrics.sortMs += sortMs;
              renderMetrics.groupMs += groupMs;
              renderMetrics.cellRows += cellRows.length;
              renderMetrics.cellTotalRows += rowStats.total;
              if (cellRows.length > 0) renderMetrics.nonEmptyCells += 1;
              renderMetrics.cells.push({
                priority,
                role,
                rows: cellRows.length,
                totalRows: rowStats.total,
                groups: groupStats.total,
                filterMs,
                sortMs,
                groupMs,
                totalMs,
              });
            }
            const createInput = { priority, creatorRACIRole: role };
            return (
              <div
                key={`${priority}:${role}`}
                style={myWorkMatrixCellStyle(role)}
                onContextMenu={(event) => {
                  if (!hasCreateCellActions) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setCreateMenu({ x: event.clientX, y: event.clientY, input: createInput });
                }}
                onDragOver={(event) => {
                  if (!onDropNodes && !onDropNodesInCell && !onDropLogicGates && !onDropProjects) return;
                  const hasNodeDrag = hasMyWorkDragType(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
                  const hasLogicGateDrag = hasMyWorkDragType(event.dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME);
                  const hasProjectDrag = hasMyWorkDragType(event.dataTransfer, HOME_INBOX_PROJECT_DRAG_MIME);
                  if (!hasNodeDrag && !hasLogicGateDrag && !hasProjectDrag) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => {
                  const nodePayload = readMyWorkDragPayload<MyWorkNodeDragPayload>(event.dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
                  const gatePayload = readMyWorkDragPayload<MyWorkLogicGateDragPayload>(event.dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME);
                  const projectPayload = readMyWorkDragPayload<MyWorkProjectDragPayload>(event.dataTransfer, HOME_INBOX_PROJECT_DRAG_MIME);
                  const nodeIDs = cleanIDList(nodePayload?.nodeIDs ?? []);
                  const logicGateIDs = cleanIDList(gatePayload?.logicGateIDs ?? []);
                  const projectIDs = cleanIDList(projectPayload?.projectIDs ?? []);
                  if (nodeIDs.length === 0 && logicGateIDs.length === 0 && projectIDs.length === 0) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (projectIDs.length > 0 && onDropProjects) onDropProjects({
                    ...createInput,
                    projectIDs,
                    logicGateIDsByProjectID: projectPayload?.logicGateIDsByProjectID,
                    nodeIDsByProjectID: projectPayload?.nodeIDsByProjectID,
                    nodeIDsByLogicGateID: projectPayload?.nodeIDsByLogicGateID,
                  });
                  if (logicGateIDs.length > 0 && onDropLogicGates) onDropLogicGates({ ...createInput, logicGateIDs, nodeIDsByLogicGateID: gatePayload?.nodeIDsByLogicGateID });
                  if (nodeIDs.length > 0) {
                    const sourceLogicGateID = nodePayload?.fromLogicGateID?.trim() ?? "";
                    const targetUserID = nodePayload?.targetUserID?.trim() ?? "";
                    if (onDropNodes) {
                      onDropNodes({ ...createInput, logicGateID: sourceLogicGateID || undefined, nodeIDs, fromLogicGateID: sourceLogicGateID || undefined, targetUserID });
                    } else if (onDropNodesInCell) {
                      onDropNodesInCell({ ...createInput, nodeIDs });
                    }
                  }
                }}
              >
                {cellRows.length === 0 ? (
                  <div style={myWorkMatrixCellEmptyStyle}>No active work</div>
                ) : groups.length > 0 ? (
                  <MyWorkGroupList
                    groups={groups}
                    cellKey={cellKey}
                    role={role}
                    expandedGroupIDs={expandedGroupIDs}
                    onToggleGroup={onToggleGroup}
                    onOpenNode={onOpenNode}
                    onOpenLogicGate={onOpenLogicGate}
                    onOpenProject={onOpenProject}
                    onRenameNode={onRenameNode}
                    onRequestDeleteNode={onRequestDeleteNode}
                    nodeByID={nodeByID}
                    logicGateByID={logicGateByID}
                    showProjectHeaders={showProjectHeaders}
                    showLogicGateHeaders={showLogicGateHeaders}
                  />
                ) : (
                  <MyWorkRows rows={cellRows} role={role} depth={0} showProjectHeaders={showProjectHeaders} showLogicGateHeaders={showLogicGateHeaders} onOpenNode={onOpenNode} onOpenLogicGate={onOpenLogicGate} onOpenProject={onOpenProject} onRenameNode={onRenameNode} onRequestDeleteNode={onRequestDeleteNode} nodeByID={nodeByID} logicGateByID={logicGateByID} />
                )}
              </div>
            );
          })}
        </React.Fragment>
      ))}
      </div>
      {createMenu && (
        <FrameRightClickMenu x={createMenu.x} y={createMenu.y} onClose={() => setCreateMenu(null)} minWidth={190}>
          {onCreateNodeInCell && (
            <button type="button" style={sharedInboxContextMenuButtonStyle} onClick={() => { onCreateNodeInCell(createMenu.input); setCreateMenu(null); }}>Create Node</button>
          )}        </FrameRightClickMenu>
      )}
    </>
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
  const responsibleUserIDsByContext = new Map<string, Set<string>>();
  for (const item of matrixCells) {
    const contextKey = myWorkMatrixAssignmentContextKey(item);
    const responsibleUserIDs = cleanIDList(item.responsible_user_ids ?? []);
    if (normalizeRACIRole(item.gvic_assignment) === "responsible") {
      responsibleUserIDs.push(item.userID.trim() || item.user_id?.trim() || "");
    }
    if (responsibleUserIDs.length === 0) continue;
    const users = responsibleUserIDsByContext.get(contextKey) ?? new Set<string>();
    for (const userID of responsibleUserIDs) if (userID) users.add(userID);
    responsibleUserIDsByContext.set(contextKey, users);
  }
  for (const item of matrixCells) {
    const role = normalizeRACIRole(item.gvic_assignment);
    if (!role) continue;
    const userID = item.userID.trim() || item.user_id?.trim() || "";
    const nodeID = item.node_id?.trim() || "";
    if (!nodeID) continue;
    const logicGateID = item.logic_gate_id?.trim() || "";
    const projectID = item.project_id?.trim() || "";
    const title = item.node_name?.trim() || nodeID;
    const projectName = item.project_name?.trim() || projectID;
    const logicGateName = item.logic_gate_name?.trim() || logicGateID;
    const responsibleUserIDs = Array.from(responsibleUserIDsByContext.get(myWorkMatrixAssignmentContextKey(item)) ?? []);
    const people = responsibleUserIDs.map((responsibleUserID) => personForUserID(responsibleUserID, userByID));
    rows.push({
      rowKey: item.projection_row_id?.trim() || `${userID}:${role}:node:${nodeID}:project:${projectID || "none"}:logic_gate:${logicGateID || "none"}`,
      companyID: item.companyID || item.company_id,
      kind: "node",
      id: nodeID,
      title,
      status: item.status,
      dueDate: item.due_date,
      priority: item.priority,
      accounts: item.accounts ?? [],
      projectLabels: projectName ? [projectName] : [],
      people,
      teams: teamsForUsers(userID ? [userID] : [], groupIDsByUserID, groupByID),
      gvicRoles: [role],
      primaryRACIRole: role,
      participantUserIDs: userID ? [userID] : [],
      projectID,
      projectName,
      logicGateLabels: logicGateName ? [logicGateName] : [],
      logicGateIDs: logicGateID ? [logicGateID] : [],
      nodeLeafID: nodeID,
      depth: 0,
      sortOrder: Number.isFinite(Number(item.sort_order)) ? Number(item.sort_order) : 0,
    });
  }

  return sortMyWorkRows(rows);
}

function myWorkMatrixAssignmentContextKey(item: MyWorkMatrixRow): string {
  return [
    item.company_id?.trim() ?? "",
    item.project_id?.trim() ?? "",
    item.logic_gate_id?.trim() ?? "",
    item.node_id?.trim() ?? "",
  ].join("\u0000");
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

function myWorkCellBucketKey(role: LogicGateRACIRole, priority: MyWorkMatrixPriority): string {
  return role + ":" + String(priority);
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

function hasMyWorkDragType(dataTransfer: DataTransfer, mime: string): boolean {
  return Array.from(dataTransfer.types ?? []).includes(mime);
}

function normalizeRACIRole(role: string | null | undefined): LogicGateRACIRole | "" {
  if (role === "responsible" || role === "accountable" || role === "consulted" || role === "informed") return role;
  return "";
}

function myWorkRACIRoleLetter(role: LogicGateRACIRole): string {
  if (role === "responsible") return "R";
  if (role === "consulted") return "C";
  if (role === "accountable") return "V";
  return "I";
}

function defaultMyWorkRoleColumnWidths(): MyWorkRoleColumnWidths {
  return {
    responsible: MY_WORK_ROLE_COLUMN_DEFAULT_WIDTH,
    accountable: MY_WORK_ROLE_COLUMN_DEFAULT_WIDTH,
    consulted: MY_WORK_ROLE_COLUMN_DEFAULT_WIDTH,
    informed: MY_WORK_ROLE_COLUMN_DEFAULT_WIDTH,
  };
}

function myWorkRoleColumnWidthsStorageKey(companyID: string): string {
  const cleanCompanyID = companyID.trim();
  return cleanCompanyID ? `${MY_WORK_ROLE_COLUMN_WIDTHS_STORAGE_KEY}:${cleanCompanyID}` : MY_WORK_ROLE_COLUMN_WIDTHS_STORAGE_KEY;
}

function myWorkSelectedViewStorageKey(companyID: string, userID: string): string {
  const cleanCompanyID = companyID.trim();
  const cleanUserID = userID.trim();
  return cleanCompanyID && cleanUserID
    ? `${MY_WORK_SELECTED_VIEW_STORAGE_KEY}:${cleanCompanyID}:${cleanUserID}`
    : MY_WORK_SELECTED_VIEW_STORAGE_KEY;
}

function clampMyWorkRoleColumnWidth(width: number): number {
  return Math.max(MY_WORK_ROLE_COLUMN_MIN_WIDTH, Math.min(MY_WORK_ROLE_COLUMN_MAX_WIDTH, Math.round(width)));
}

function normalizeMyWorkRoleColumnWidths(value: unknown): MyWorkRoleColumnWidths {
  const fallback = defaultMyWorkRoleColumnWidths();
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as Partial<Record<LogicGateRACIRole, unknown>>;
  return {
    responsible: typeof candidate.responsible === "number" && Number.isFinite(candidate.responsible) ? clampMyWorkRoleColumnWidth(candidate.responsible) : fallback.responsible,
    accountable: typeof candidate.accountable === "number" && Number.isFinite(candidate.accountable) ? clampMyWorkRoleColumnWidth(candidate.accountable) : fallback.accountable,
    consulted: typeof candidate.consulted === "number" && Number.isFinite(candidate.consulted) ? clampMyWorkRoleColumnWidth(candidate.consulted) : fallback.consulted,
    informed: typeof candidate.informed === "number" && Number.isFinite(candidate.informed) ? clampMyWorkRoleColumnWidth(candidate.informed) : fallback.informed,
  };
}

function readMyWorkRoleColumnWidths(companyID: string): MyWorkRoleColumnWidths {
  try {
    return normalizeMyWorkRoleColumnWidths(JSON.parse(localStorage.getItem(myWorkRoleColumnWidthsStorageKey(companyID)) ?? "null"));
  } catch {
    return defaultMyWorkRoleColumnWidths();
  }
}

function storeMyWorkRoleColumnWidths(companyID: string, widths: MyWorkRoleColumnWidths): void {
  try {
    localStorage.setItem(myWorkRoleColumnWidthsStorageKey(companyID), JSON.stringify(widths));
  } catch {}
}

function readMyWorkSelectedViewID(companyID: string, userID: string): string {
  try {
    return localStorage.getItem(myWorkSelectedViewStorageKey(companyID, userID))?.trim() ?? "";
  } catch {
    return "";
  }
}

function storeMyWorkSelectedViewID(companyID: string, userID: string, settingID: string): void {
  const cleanSettingID = settingID.trim();
  if (!cleanSettingID) return;
  try {
    localStorage.setItem(myWorkSelectedViewStorageKey(companyID, userID), cleanSettingID);
  } catch {}
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
    setting_id: createSavedViewID(),
    company_id: companyID,
    user_id: currentUserID,
    surface: "my_work",
    principal: "user",
    principal_id: currentUserID,
    name: "Project",
    selected_scope: defaultMyWorkSelectedScope(currentUserID),
    groupings: [...DEFAULT_MY_WORK_GROUPINGS],
    panel_collapsed: true,
    position: 1000,
    created_timestamp: now,
    updated_timestamp: now,
  };
}

function savedViewsToMyWorkSettings(savedViews: SavedView[], fallback: MyWorkSavedGroupingSetting, currentUserID: string): MyWorkSavedGroupingSetting[] {
  return savedViews
    .filter((view) => view.surface === "my_work")
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }) || left.saved_view_id.localeCompare(right.saved_view_id))
    .map((view) => savedViewToMyWorkSetting(view, fallback, currentUserID));
}

function savedViewToMyWorkSetting(view: SavedView, fallback: MyWorkSavedGroupingSetting, currentUserID: string): MyWorkSavedGroupingSetting {
  return normalizeMyWorkSavedGroupingSetting({
    setting_id: view.saved_view_id,
    company_id: view.company_id,
    user_id: currentUserID,
    surface: "my_work",
    principal: view.principal,
    principal_id: view.principal_id,
    name: view.name,
    selected_scope: fallback.selected_scope,
    groupings: view.groupings,
    panel_collapsed: fallback.panel_collapsed,
    position: view.position,
    created_timestamp: view.created_timestamp,
    updated_timestamp: view.updated_timestamp,
  }, fallback, currentUserID);
}

function savedViewErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
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

function GroupHeaderIcon({ field, role }: { field: MyWorkGroupingField; role: LogicGateRACIRole }) {
  if (field === "project") return <ExplorerRowIcon kind="project" />;
  if (field === "logic_gate") return <ExplorerRowIcon kind="logic_gate" />;
  return <span aria-hidden="true" style={groupHeaderBadgeStyle(role)}>{groupHeaderBadgeLabel(field)}</span>;
}

function groupHeaderBadgeLabel(field: MyWorkGroupingField): string {
  if (field === "account") return "A";
  if (field === "due_date") return "D";
  if (field === "logic_gate") return "L";
  if (field === "person") return "P";
  if (field === "project") return "P";
  if (field === "status") return "S";
  return "T";
}

const peopleIconStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#2563eb",
};

function groupHeaderBadgeStyle(role: LogicGateRACIRole): React.CSSProperties {
  const accent = homeRACIRoleAccent(role);
  return {
    width: 18,
    height: 18,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${homeColorWithAlpha(accent, 0.28)}`,
    borderRadius: 5,
    color: accent,
    background: `linear-gradient(135deg, rgba(255,255,255,0.96), ${homeColorWithAlpha(accent, 0.14)})`,
    fontSize: 10,
    lineHeight: 1,
    fontWeight: 850,
    boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.86)",
  };
}
const myWorkShellStyle: React.CSSProperties = {
  ...logicGateRACIMatrixSurfaceStyle,
  minWidth: 0,
  minHeight: 0,
  height: "100%",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  padding: "12px 14px 14px",
  color: "#111827",
};

const myWorkHeaderStyle: React.CSSProperties = {
  ...logicGateRACIHeaderStyle,
  minWidth: 0,
  minHeight: 54,
  display: "grid",
  gridTemplateColumns: "minmax(180px, 1fr) auto",
  alignItems: "center",
  gap: 10,
  position: "relative",
  zIndex: 6,
  overflow: "visible",
  padding: "10px 12px",
  border: "1px solid rgba(255, 255, 255, 0.74)",
  borderRadius: 10,
  background: "linear-gradient(110deg, rgba(255, 241, 242, 0.82), rgba(254, 249, 195, 0.58) 30%, rgba(236, 253, 245, 0.66) 62%, rgba(239, 246, 255, 0.82))",
  boxShadow: "0 12px 28px rgba(15, 23, 42, 0.10), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
};

const myWorkTitleStackStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 44,
  display: "grid",
  alignContent: "center",
  gap: 6,
  padding: "4px 0",
};

const myWorkTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#0f172a",
  fontSize: 17,
  lineHeight: 1.18,
  fontWeight: 850,
  letterSpacing: 0,
};

const myWorkMetaStyle: React.CSSProperties = {
  width: "fit-content",
  maxWidth: "100%",
  minHeight: 22,
  display: "inline-flex",
  alignItems: "center",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  border: "1px solid rgba(14, 165, 233, 0.22)",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.68)",
  color: "#475569",
  fontSize: 11,
  fontWeight: 760,
  padding: "0 9px",
};

const myWorkMatrixScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: "2px 10px 24px 0",
  ["--kanban-board-scroll-accent" as string]: "#475569",
  ["--kanban-board-scroll-track" as string]: "rgba(71, 85, 105, 0.10)",
};

function myWorkMatrixGridStyle(roleColumnWidths: MyWorkRoleColumnWidths): React.CSSProperties {
  const columns = MY_WORK_MATRIX_ROLES.map((role) => `minmax(${MY_WORK_ROLE_COLUMN_MIN_WIDTH}px, ${Math.max(MY_WORK_ROLE_COLUMN_MIN_WIDTH, roleColumnWidths[role])}fr)`);
  return {
    width: "100%",
    minWidth: MY_WORK_PRIORITY_COLUMN_WIDTH + (MY_WORK_ROLE_COLUMN_MIN_WIDTH * MY_WORK_MATRIX_ROLES.length),
    display: "grid",
    gridTemplateColumns: `${MY_WORK_PRIORITY_COLUMN_WIDTH}px ${columns.join(" ")}`,
    alignItems: "stretch",
    borderTop: "1px solid rgba(148, 163, 184, 0.34)",
    borderLeft: "1px solid rgba(148, 163, 184, 0.34)",
    background: "rgba(255, 255, 255, 0.16)",
    filter: "drop-shadow(0 8px 18px rgba(96, 165, 250, 0.08))",
  };
}

const myWorkMatrixCornerStyle: React.CSSProperties = {
  ...logicGateRACICornerStyle,
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 3,
  minHeight: 54,
  display: "flex",
  alignItems: "center",
  borderRight: "1px solid rgba(148, 163, 184, 0.34)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  color: "#475569",
  fontSize: 11,
  fontWeight: 850,
  padding: "0 10px",
};

function myWorkMatrixColumnHeaderStyle(role: LogicGateRACIRole): React.CSSProperties {
  return {
    ...logicGateRACIColumnHeaderStyle(role),
    position: "sticky",
    top: 0,
    zIndex: 2,
    minHeight: 54,
    borderRight: "1px solid rgba(148, 163, 184, 0.34)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
    paddingRight: 22,
  };
}

const myWorkColumnResizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  right: -4,
  width: 8,
  height: "100%",
  border: "none",
  background: "transparent",
  cursor: "col-resize",
  padding: 0,
  zIndex: 4,
};

function myWorkMatrixPriorityHeaderStyle(priority: MyWorkMatrixPriority): React.CSSProperties {
  return {
    ...logicGateRACIPriorityHeaderStyle(priority === 0 ? undefined : priority),
    position: "sticky",
    left: 0,
    zIndex: 1,
    minHeight: 96,
    borderRight: "1px solid rgba(148, 163, 184, 0.34)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
  };
}

function myWorkMatrixCellStyle(role: LogicGateRACIRole): React.CSSProperties {
  const accent = homeRACIRoleAccent(role);
  return {
    minWidth: 0,
    minHeight: 96,
    borderRight: "1px solid rgba(148, 163, 184, 0.34)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.34)",
    background: `linear-gradient(180deg, rgba(255,255,255,0.90), ${homeColorWithAlpha(accent, 0.055)})`,
    boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.74)",
    padding: "8px 6px 10px",
  };
}

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

const scopeControlRowStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  alignItems: "center",
  justifySelf: "end",
  width: "min(280px, 34vw)",
  minWidth: 220,
};

const scopeTabsAnchorStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

const scopeTabsStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 3,
  border: "1px solid rgba(15, 23, 42, 0.08)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.70), rgba(226,232,240,0.42))",
  boxShadow: "inset 3px 3px 8px rgba(148, 163, 184, 0.18), inset -3px -3px 8px rgba(255, 255, 255, 0.78)",
  padding: 2,
  overflow: "hidden",
};

function myWorkScopeAccent(level: MyWorkScopeLevel): string {
  if (level === "me") return "#2563eb";
  if (level === "team") return "#0f766e";
  return "#7c3aed";
}

function scopeTabStyle(level: MyWorkScopeLevel, active: boolean): React.CSSProperties {
  const accent = myWorkScopeAccent(level);
  return {
    minHeight: 26,
    border: `1px solid ${homeColorWithAlpha(accent, active ? 0.30 : 0.10)}`,
    borderRadius: 6,
    background: active
      ? `linear-gradient(145deg, rgba(255,255,255,0.92), ${homeColorWithAlpha(accent, 0.15)})`
      : "rgba(255, 255, 255, 0.54)",
    color: active ? accent : "#334155",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 850 : 720,
    cursor: "pointer",
    boxShadow: active ? `5px 5px 12px ${homeColorWithAlpha(accent, 0.10)}, -4px -4px 10px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255, 255, 255, 0.78)` : "none",
  };
}

const scopePickerStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 60,
  top: "calc(100% + 4px)",
  left: 0,
  width: "min(352px, calc(100vw - 96px))",
  maxHeight: "min(390px, calc(100vh - 180px))",
  overflow: "auto",
  display: "grid",
  gap: 4,
  padding: 8,
  border: "1px solid rgba(37, 99, 235, 0.16)",
  borderRadius: 14,
  background: "linear-gradient(145deg, rgba(248, 252, 255, 0.98), rgba(236, 244, 250, 0.94))",
  boxShadow: "12px 12px 28px rgba(148, 163, 184, 0.24), -8px -8px 22px rgba(255, 255, 255, 0.86), inset 1px 1px 0 rgba(255, 255, 255, 0.88)",
  backdropFilter: "blur(18px) saturate(1.16)",
};

function scopePickerRowStyle(depth: number, active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "18px 16px minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    border: active ? "1px solid rgba(37, 99, 235, 0.22)" : "1px solid rgba(255, 255, 255, 0.58)",
    borderRadius: 9,
    background: active ? "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(219,234,254,0.64))" : "rgba(255, 255, 255, 0.44)",
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
    boxShadow: active ? "5px 5px 14px rgba(148, 163, 184, 0.18), -4px -4px 12px rgba(255, 255, 255, 0.72)" : "inset 1px 1px 0 rgba(255, 255, 255, 0.66)",
    padding: `4px 8px 4px ${8 + depth * 14}px`,
  };
}

const scopePickerDisclosureStyle: React.CSSProperties = {
  width: 18,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 6,
  background: "transparent",
  color: "#2563eb",
  cursor: "pointer",
  padding: 0,
};

const scopePickerDisclosureSpacerStyle: React.CSSProperties = {
  width: 18,
  height: 24,
};

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

function groupHeaderStyle(depth: number, role: LogicGateRACIRole): React.CSSProperties {
  const accent = homeRACIRoleAccent(role);
  return {
    width: "max-content",
    maxWidth: "100%",
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "14px minmax(0, auto)",
    alignItems: "center",
    gap: 5,
    marginLeft: depth * 28,
    border: `1px solid ${homeColorWithAlpha(accent, 0.20)}`,
    borderRadius: 7,
    background: `linear-gradient(135deg, rgba(255,255,255,0.94), ${homeColorWithAlpha(accent, 0.10)})`,
    color: "#111827",
    textAlign: "left",
    padding: "0 8px 0 5px",
    boxShadow: `0 7px 16px ${homeColorWithAlpha(accent, 0.08)}, inset 1px 1px 0 rgba(255,255,255,0.82)`,
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
  gridTemplateColumns: "18px minmax(0, auto)",
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
  gridTemplateColumns: "18px minmax(0, auto)",
  alignItems: "center",
  gap: 5,
};

const myWorkContextMenuDividerStyle: React.CSSProperties = {
  height: 1,
  margin: "5px 8px",
  background: "rgba(15, 23, 42, 0.12)",
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
  justifyItems: "start",
};

const logicGateSectionBlockStyle: React.CSSProperties = {
  minWidth: 0,
  maxWidth: "100%",
  display: "grid",
  alignContent: "start",
  justifyItems: "start",
};

function workRowStyle(depth: number, role: LogicGateRACIRole, kind: MyWorkResourceRow["kind"], displayHeader: boolean): React.CSSProperties {
  const accent = homeRACIRoleAccent(role);
  const headerAccent = kind === "project" ? "#64748b" : accent;
  return {
    width: "fit-content",
    minWidth: "min(230px, calc(100% - 18px))",
    maxWidth: "calc(100% - 18px)",
    minHeight: displayHeader ? 31 : 34,
    display: "grid",
    gridTemplateColumns: displayHeader ? "minmax(120px, max-content)" : "minmax(120px, max-content) max-content",
    alignItems: "center",
    gap: 8,
    marginLeft: depth * 28,
    marginBottom: 3,
    border: `1px solid ${homeColorWithAlpha(displayHeader ? headerAccent : accent, displayHeader ? 0.28 : 0.15)}`,
    borderLeft: `3px solid ${homeColorWithAlpha(displayHeader ? headerAccent : accent, displayHeader ? 0.74 : 0.62)}`,
    borderRadius: 6,
    background: displayHeader
      ? `linear-gradient(135deg, rgba(248,250,252,0.98), ${homeColorWithAlpha(headerAccent, 0.08)})`
      : `linear-gradient(135deg, rgba(255,255,255,0.96), ${homeColorWithAlpha(accent, 0.06)})`,
    color: "#111827",
    font: "inherit",
    textAlign: "left",
    padding: "0 8px 0 7px",
    boxShadow: "0 4px 10px rgba(15, 23, 42, 0.035), inset 1px 1px 0 rgba(255, 255, 255, 0.72)",
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

const workRowTitleStaticCellStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 7,
};

function workRowTitleTextStyle(displayHeader: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    fontWeight: displayHeader ? 850 : 780,
  };
}

function workRowStatusStyle(role: LogicGateRACIRole): React.CSSProperties {
  const accent = homeRACIRoleAccent(role);
  return {
    minWidth: 0,
    maxWidth: 120,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    border: `1px solid ${homeColorWithAlpha(accent, 0.18)}`,
    borderRadius: 5,
    background: homeColorWithAlpha(accent, 0.08),
    color: "#334155",
    fontSize: 11,
    fontWeight: 750,
    padding: "3px 7px",
  };
}

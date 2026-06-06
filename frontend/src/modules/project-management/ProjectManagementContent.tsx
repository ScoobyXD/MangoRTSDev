import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser, readAuthConfig } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { buildCompanyExplorerTreeRows } from "../company-explorer/companyExplorerTreeRows.js";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import { toLogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import { subscribeRealtimeScope, type RealtimeProjectionDeltaMessage } from "../realtime/realtimeWebSocket.js";
import {
  fetchCommunicationsWorkspacePanel,
  listCompanyUserGroups,
  listCompanyUsers,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
} from "../communications/communicationsApi.js";
import {
  CompanyPerspectiveSelector,
  companyPerspectiveLabel,
  userIDsForPerspective,
  type CompanyPerspective,
} from "../perspectives/PerspectiveSelector.js";
import {
  createProjectManagementTimelineItem,
  deleteProjectManagementTimelineItem,
  fetchProjectManagementTimeline,
  updateProjectManagementTimelineItem,
  type ProjectManagementEntityType,
  type ProjectManagementTimelineRow,
} from "./projectManagementApi.js";

type ProjectManagementContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
  onNodeOpen?: (nodeID: string) => void;
};

type ProjectTimelinePayload = {
  entityType: ProjectManagementEntityType;
  entityID: string;
  label: string;
  color?: string;
};

type WorkspacePanelState = {
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  nodes: NodeRecord[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
  logicGates: LogicGateRecord[];
};

type ResizeState =
  | { kind: "vertical"; pageTop: number; pageHeight: number }
  | { kind: "horizontal"; bottomLeft: number; bottomWidth: number };

type BarDraft = {
  itemID: string;
  startOffset: number;
  durationDays: number;
};

type BarInteraction = {
  item: ProjectManagementTimelineRow;
  mode: "move" | "left" | "right";
  startX: number;
  startOffset: number;
  durationDays: number;
};

const PROJECT_TIMELINE_ENTITY_MIME = "application/x-mangorts-project-timeline-entity";
const EMPTY_WORKSPACE_PANEL: WorkspacePanelState = {
  nodeFolders: [],
  nodeFolderItems: [],
  nodes: [],
  logicGateFolders: [],
  logicGateFolderItems: [],
  logicGates: [],
};
const WEEK_DAY_COUNT = 7;
const TIMELINE_LABEL_W = 280;
const TIMELINE_DAY_W = 142;
const TIMELINE_ROW_H = 44;

function defaultUserPerspective(currentUserID: string): CompanyPerspective {
  return { scope: "mine", subjectType: "user", subjectID: currentUserID.trim() };
}

function weekStart(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  next.setDate(next.getDate() + mondayOffset);
  return next;
}

function addDays(date: Date, count: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
}

function dateFromISO(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function endDate(startDate: string, durationDays: number): string {
  const parsed = dateFromISO(startDate);
  if (!parsed) return startDate;
  return isoDate(addDays(parsed, Math.max(1, durationDays) - 1));
}

function daysBetween(left: Date, right: Date): number {
  const a = new Date(left.getFullYear(), left.getMonth(), left.getDate()).getTime();
  const b = new Date(right.getFullYear(), right.getMonth(), right.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

function shortDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeTimelineRow(row: ProjectManagementTimelineRow): ProjectManagementTimelineRow {
  const durationDays = clampInteger(Number(row.duration_days) || 1, 1, 90);
  const startDate = /^\d{4}-\d{2}-\d{2}$/.test(row.start_date ?? "") ? row.start_date : isoDate(weekStart(new Date()));
  return {
    ...row,
    start_date: startDate,
    end_date: row.end_date || endDate(startDate, durationDays),
    duration_days: durationDays,
    position: Number.isFinite(Number(row.position)) ? Number(row.position) : 0,
    display_title: row.display_title?.trim() || row.resource_id,
  };
}

function rowColor(row: ProjectManagementTimelineRow): string {
  const explicit = row.status_color?.trim();
  if (explicit) return explicit;
  if (row.resource_type === "logic_gate") return "#8b5cf6";
  const status = row.status?.trim().toLowerCase() ?? "";
  if (status.includes("done") || status.includes("complete")) return "#22c55e";
  if (status.includes("progress")) return "#3b82f6";
  if (status.includes("verify")) return "#a855f7";
  if (status.includes("blocked")) return "#ef4444";
  return "#06b6d4";
}

function targetUserIDsForPerspective(input: {
  perspective: CompanyPerspective;
  companyUsers: CompanyUser[];
  groupMembers: CompanyUserGroupMember[];
  currentUserID: string;
}): string[] {
  const currentUserID = input.currentUserID.trim();
  if (input.perspective.scope === "company" || input.perspective.subjectType === "company") {
    const userIDs = input.companyUsers.map((user) => user.user_id.trim()).filter(Boolean);
    return userIDs.length > 0 ? Array.from(new Set(userIDs)).sort() : currentUserID ? [currentUserID] : [];
  }
  const scoped = userIDsForPerspective(input.perspective, input.groupMembers, currentUserID);
  const userIDs = Array.from(scoped ?? new Set(input.companyUsers.map((user) => user.user_id.trim()).filter(Boolean))).filter(Boolean);
  return userIDs.length > 0 ? Array.from(new Set(userIDs)).sort() : currentUserID ? [currentUserID] : [];
}

function writeUserIDForPerspective(userIDs: string[], currentUserID: string): string {
  const current = currentUserID.trim();
  if (current && userIDs.includes(current)) return current;
  return userIDs[0] ?? current;
}

function filterNodesByPerspective(nodes: NodeRecord[], perspective: CompanyPerspective, members: CompanyUserGroupMember[], currentUserID: string): NodeRecord[] {
  const userIDs = userIDsForPerspective(perspective, members, currentUserID);
  if (!userIDs) return nodes;
  return nodes.filter((node) => {
    const assignee = node.assignee_user_id?.trim() ?? "";
    return assignee && userIDs.has(assignee);
  });
}

function filterLogicGatesByPerspective(logicGates: LogicGateRecord[], perspective: CompanyPerspective, members: CompanyUserGroupMember[], currentUserID: string): LogicGateRecord[] {
  const userIDs = userIDsForPerspective(perspective, members, currentUserID);
  if (!userIDs) return logicGates;
  return logicGates.filter((logicGate) => (logicGate.raci_assignments ?? []).some((assignment) => userIDs.has(assignment.user_id.trim())));
}

function readTimelinePayload(dataTransfer: DataTransfer): ProjectTimelinePayload | null {
  const raw = dataTransfer.getData(PROJECT_TIMELINE_ENTITY_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectTimelinePayload>;
    const entityType = parsed.entityType === "logic_gate" ? "logic_gate" : parsed.entityType === "node" ? "node" : "";
    const entityID = typeof parsed.entityID === "string" ? parsed.entityID.trim() : "";
    const label = typeof parsed.label === "string" ? parsed.label.trim() : "";
    if (!entityType || !entityID || !label) return null;
    return { entityType, entityID, label, color: typeof parsed.color === "string" ? parsed.color : undefined };
  } catch {
    return null;
  }
}

function hasTimelinePayloadType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes(PROJECT_TIMELINE_ENTITY_MIME);
}

function visibleRowsForKind(rows: ExplorerTreeNode[], kind: ProjectManagementEntityType): ExplorerTreeNode[] {
  return rows.filter((row) => row.kind === "folder" || row.kind === kind);
}

function buildEntityRows(input: {
  kind: ProjectManagementEntityType;
  expanded: Set<string>;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
}): ExplorerTreeNode[] {
  const rows = buildCompanyExplorerTreeRows({
    expanded: input.expanded,
    nodes: input.kind === "node" ? input.nodes : [],
    logicGates: input.kind === "logic_gate" ? input.logicGates.map(toLogicGateCanvasRecord) : [],
    kanbanBoards: [],
    folders: input.folders,
    folderItems: input.folderItems,
    rootRowOrder: {},
  });
  return visibleRowsForKind(rows, input.kind);
}

function rowOverlapsWeek(row: ProjectManagementTimelineRow, weekStartDate: Date): boolean {
  const start = dateFromISO(row.start_date);
  if (!start) return false;
  const offset = daysBetween(start, weekStartDate);
  const endOffset = offset + Math.max(1, row.duration_days) - 1;
  return endOffset >= 0 && offset < WEEK_DAY_COUNT;
}

function displayStartOffset(row: ProjectManagementTimelineRow, weekStartDate: Date): number {
  const start = dateFromISO(row.start_date);
  return start ? daysBetween(start, weekStartDate) : 0;
}

function sortTimelineRows(rows: ProjectManagementTimelineRow[]): ProjectManagementTimelineRow[] {
  return rows.slice().sort((left, right) => (
    left.start_date.localeCompare(right.start_date) ||
    (left.position ?? 0) - (right.position ?? 0) ||
    left.display_title.localeCompare(right.display_title, undefined, { numeric: true, sensitivity: "base" }) ||
    left.item_id.localeCompare(right.item_id)
  ));
}

export const ProjectManagementContent: React.FC<ProjectManagementContentProps> = ({
  accent,
  widgetId,
  hideTopControls: _hideTopControls,
  theme: _theme,
  onNodeOpen,
}) => {
  const companyID = getActiveCompanyID();
  const pageRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const sequenceByUserRef = useRef(new Map<string, number>());
  const [currentUserID, setCurrentUserID] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePanelState>(EMPTY_WORKSPACE_PANEL);
  const [loading, setLoading] = useState(true);
  const [timelineLoading, setTimelineLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(new Date()));
  const [timelineRows, setTimelineRows] = useState<ProjectManagementTimelineRow[]>([]);
  const [timelinePerspective, setTimelinePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [logicGatePerspective, setLogicGatePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [nodePerspective, setNodePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [logicGateExpanded, setLogicGateExpanded] = useState<Set<string>>(() => new Set());
  const [nodeExpanded, setNodeExpanded] = useState<Set<string>>(() => new Set());
  const [verticalSplit, setVerticalSplit] = useState(54);
  const [horizontalSplit, setHorizontalSplit] = useState(50);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [barInteraction, setBarInteraction] = useState<BarInteraction | null>(null);
  const [barDraft, setBarDraft] = useState<BarDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      fetchCurrentUser().catch(() => null),
      fetchCommunicationsWorkspacePanel(companyID),
      listCompanyUsers(companyID),
      listCompanyUserGroups(companyID),
    ])
      .then(([current, panel, users, userGroups]) => {
        if (cancelled) return;
        const userID = current?.user.user_id.trim() ?? "";
        setCurrentUserID(userID);
        setCompanyUsers(users);
        setGroups(userGroups.groups);
        setGroupMembers(userGroups.members);
        setWorkspace({
          nodeFolders: panel.nodeFolders,
          nodeFolderItems: panel.nodeFolderItems,
          nodes: panel.nodes,
          logicGateFolders: panel.logicGateFolders,
          logicGateFolderItems: panel.logicGateFolderItems,
          logicGates: panel.logicGates,
        });
        const defaultPerspective = defaultUserPerspective(userID);
        setTimelinePerspective((currentValue) => currentValue.subjectID.trim() ? currentValue : defaultPerspective);
        setLogicGatePerspective((currentValue) => currentValue.subjectID.trim() ? currentValue : defaultPerspective);
        setNodePerspective((currentValue) => currentValue.subjectID.trim() ? currentValue : defaultPerspective);
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load project management data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID]);

  useEffect(() => {
    setLogicGateExpanded((current) => {
      const next = new Set(current);
      for (const folder of workspace.logicGateFolders) next.add(`workspace-folder-${folder.folder_id}`);
      return next;
    });
  }, [workspace.logicGateFolders]);

  useEffect(() => {
    setNodeExpanded((current) => {
      const next = new Set(current);
      for (const folder of workspace.nodeFolders) next.add(`workspace-folder-${folder.folder_id}`);
      return next;
    });
  }, [workspace.nodeFolders]);

  const weekDays = useMemo(() => Array.from({ length: WEEK_DAY_COUNT }, (_, index) => addDays(weekAnchor, index)), [weekAnchor]);
  const timelineTargetUserIDs = useMemo(() => targetUserIDsForPerspective({
    perspective: timelinePerspective,
    companyUsers,
    groupMembers,
    currentUserID,
  }), [companyUsers, currentUserID, groupMembers, timelinePerspective]);
  const timelineTargetKey = timelineTargetUserIDs.join("|");
  const timelineWriteUserID = writeUserIDForPerspective(timelineTargetUserIDs, currentUserID);

  const loadTimelineRows = useCallback(async () => {
    if (!companyID || timelineTargetUserIDs.length === 0) {
      setTimelineRows([]);
      setTimelineLoading(false);
      return;
    }
    setTimelineLoading(true);
    setError("");
    const settled = await Promise.allSettled(timelineTargetUserIDs.map((userID) => fetchProjectManagementTimeline(companyID, userID)));
    const rows: ProjectManagementTimelineRow[] = [];
    let failureCount = 0;
    settled.forEach((result, index) => {
      const userID = timelineTargetUserIDs[index];
      if (result.status === "fulfilled") {
        sequenceByUserRef.current.set(userID, Number(result.value.projection_sequence) || 0);
        rows.push(...result.value.rows.map(normalizeTimelineRow));
      } else {
        failureCount += 1;
      }
    });
    setTimelineRows(sortTimelineRows(rows));
    if (failureCount > 0 && rows.length === 0) {
      setError("Failed to load project management timeline");
    }
    setTimelineLoading(false);
  }, [companyID, timelineTargetUserIDs]);

  useEffect(() => {
    void loadTimelineRows();
  }, [loadTimelineRows]);

  useEffect(() => {
    if (!companyID || !timelineTargetKey) return undefined;
    const apiBase = readAuthConfig().apiBase;
    const unsubscribes = timelineTargetUserIDs.map((userID) => {
      const scope = `project_management:user:${userID}`;
      return subscribeRealtimeScope(apiBase, companyID, scope, {
        getAfterSequence: () => sequenceByUserRef.current.get(userID),
        onDelta: (message: RealtimeProjectionDeltaMessage) => {
          if (message.projection !== "project_management_timeline") return;
          if (typeof message.projection_sequence === "number") {
            sequenceByUserRef.current.set(userID, Math.max(sequenceByUserRef.current.get(userID) ?? 0, message.projection_sequence));
          }
          void loadTimelineRows();
        },
        onRefetch: () => {
          void loadTimelineRows();
        },
        onPermissionRevoked: () => {
          void loadTimelineRows();
        },
      });
    });
    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [companyID, loadTimelineRows, timelineTargetKey, timelineTargetUserIDs]);

  useEffect(() => {
    if (!resizeState) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      if (resizeState.kind === "vertical") {
        const pct = ((event.clientY - resizeState.pageTop) / resizeState.pageHeight) * 100;
        setVerticalSplit(clampInteger(pct, 36, 70));
      } else {
        const pct = ((event.clientX - resizeState.bottomLeft) / resizeState.bottomWidth) * 100;
        setHorizontalSplit(clampInteger(pct, 34, 66));
      }
    };
    const onPointerUp = () => setResizeState(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [resizeState]);

  const updateTimelineItem = useCallback(async (item: ProjectManagementTimelineRow, startOffset: number, durationDays: number) => {
    const nextStartDate = isoDate(addDays(weekDays[0], clampInteger(startOffset, 0, WEEK_DAY_COUNT - 1)));
    const nextDuration = clampInteger(durationDays, 1, WEEK_DAY_COUNT);
    const optimistic = normalizeTimelineRow({ ...item, start_date: nextStartDate, end_date: endDate(nextStartDate, nextDuration), duration_days: nextDuration });
    setTimelineRows((current) => sortTimelineRows(current.map((row) => row.item_id === item.item_id ? optimistic : row)));
    try {
      const result = await updateProjectManagementTimelineItem({
        companyID,
        itemID: item.item_id,
        startDate: nextStartDate,
        durationDays: nextDuration,
        position: item.position ?? 0,
      });
      if (result.item) {
        setTimelineRows((current) => sortTimelineRows(current.map((row) => row.item_id === item.item_id ? normalizeTimelineRow(result.item!) : row)));
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Failed to update timeline item");
      void loadTimelineRows();
    }
  }, [companyID, loadTimelineRows, weekDays]);

  useEffect(() => {
    if (!barInteraction) return undefined;
    const onPointerMove = (event: PointerEvent) => {
      const deltaDays = Math.round((event.clientX - barInteraction.startX) / TIMELINE_DAY_W);
      if (barInteraction.mode === "move") {
        setBarDraft({
          itemID: barInteraction.item.item_id,
          startOffset: clampInteger(barInteraction.startOffset + deltaDays, 0, WEEK_DAY_COUNT - barInteraction.durationDays),
          durationDays: barInteraction.durationDays,
        });
      } else if (barInteraction.mode === "left") {
        const nextStart = clampInteger(barInteraction.startOffset + deltaDays, 0, barInteraction.startOffset + barInteraction.durationDays - 1);
        const nextDuration = clampInteger(barInteraction.durationDays + (barInteraction.startOffset - nextStart), 1, WEEK_DAY_COUNT - nextStart);
        setBarDraft({ itemID: barInteraction.item.item_id, startOffset: nextStart, durationDays: nextDuration });
      } else {
        setBarDraft({
          itemID: barInteraction.item.item_id,
          startOffset: barInteraction.startOffset,
          durationDays: clampInteger(barInteraction.durationDays + deltaDays, 1, WEEK_DAY_COUNT - barInteraction.startOffset),
        });
      }
    };
    const onPointerUp = () => {
      const draft = barDraft;
      const interaction = barInteraction;
      setBarInteraction(null);
      setBarDraft(null);
      if (draft && interaction && (draft.startOffset !== interaction.startOffset || draft.durationDays !== interaction.durationDays)) {
        void updateTimelineItem(interaction.item, draft.startOffset, draft.durationDays);
      }
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [barDraft, barInteraction, updateTimelineItem]);

  const filteredLogicGates = useMemo(() => filterLogicGatesByPerspective(workspace.logicGates, logicGatePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, logicGatePerspective, workspace.logicGates]);
  const filteredNodes = useMemo(() => filterNodesByPerspective(workspace.nodes, nodePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, nodePerspective, workspace.nodes]);
  const visibleTimelineRows = useMemo(() => sortTimelineRows(timelineRows.filter((row) => rowOverlapsWeek(row, weekDays[0]))), [timelineRows, weekDays]);
  const logicGateRows = useMemo(() => buildEntityRows({
    kind: "logic_gate",
    expanded: logicGateExpanded,
    nodes: [],
    logicGates: filteredLogicGates,
    folders: workspace.logicGateFolders,
    folderItems: workspace.logicGateFolderItems,
  }), [filteredLogicGates, logicGateExpanded, workspace.logicGateFolderItems, workspace.logicGateFolders]);
  const nodeRows = useMemo(() => buildEntityRows({
    kind: "node",
    expanded: nodeExpanded,
    nodes: filteredNodes,
    logicGates: [],
    folders: workspace.nodeFolders,
    folderItems: workspace.nodeFolderItems,
  }), [filteredNodes, nodeExpanded, workspace.nodeFolderItems, workspace.nodeFolders]);
  const defaultTimelineStartOffset = useMemo(() => clampInteger(daysBetween(new Date(), weekDays[0]), 0, WEEK_DAY_COUNT - 1), [weekDays]);

  const addTimelineItem = useCallback(async (payload: ProjectTimelinePayload, startOffset: number) => {
    if (!timelineWriteUserID) return;
    const startDate = isoDate(addDays(weekDays[0], startOffset));
    const durationDays = payload.entityType === "logic_gate" ? 2 : 1;
    try {
      const result = await createProjectManagementTimelineItem({
        companyID,
        userID: timelineWriteUserID,
        entityType: payload.entityType,
        entityID: payload.entityID,
        startDate,
        durationDays,
        position: visibleTimelineRows.length,
      });
      if (result.item) {
        setTimelineRows((current) => sortTimelineRows([...current.filter((row) => row.item_id !== result.item!.item_id), normalizeTimelineRow(result.item!)]));
      } else {
        void loadTimelineRows();
      }
      setNotice(`${payload.label} scheduled`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to add timeline item");
    }
  }, [companyID, loadTimelineRows, timelineWriteUserID, visibleTimelineRows.length, weekDays]);
  const addExplorerEntityToTimeline = useCallback((payload: ProjectTimelinePayload) => {
    void addTimelineItem(payload, defaultTimelineStartOffset);
  }, [addTimelineItem, defaultTimelineStartOffset]);

  const removeTimelineItem = useCallback(async (item: ProjectManagementTimelineRow) => {
    setTimelineRows((current) => current.filter((row) => row.item_id !== item.item_id));
    try {
      await deleteProjectManagementTimelineItem(companyID, item.item_id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete timeline item");
      void loadTimelineRows();
    }
  }, [companyID, loadTimelineRows]);

  const clearTimelinePerspective = useCallback(() => {
    const items = visibleTimelineRows.slice();
    setTimelineRows((current) => current.filter((row) => !items.some((item) => item.item_id === row.item_id)));
    void Promise.allSettled(items.map((item) => deleteProjectManagementTimelineItem(companyID, item.item_id))).then(() => loadTimelineRows());
  }, [companyID, loadTimelineRows, visibleTimelineRows]);

  const startVerticalResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    setResizeState({ kind: "vertical", pageTop: rect.top, pageHeight: rect.height });
  };

  const startHorizontalResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = bottomRef.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    setResizeState({ kind: "horizontal", bottomLeft: rect.left, bottomWidth: rect.width });
  };

  return (
    <div ref={pageRef} style={pageStyle(verticalSplit)}>
      <section style={timelineSurfaceStyle}>
        <div style={surfaceHeaderStyle}>
          <div style={titleClusterStyle}>
            <h2 style={surfaceTitleStyle}>Project Management</h2>
            <div style={surfaceMetaStyle}>{shortDayLabel(weekDays[0])} - {shortDayLabel(weekDays[WEEK_DAY_COUNT - 1])}</div>
          </div>
          <CompanyPerspectiveSelector
            companyUsers={companyUsers}
            groups={groups}
            groupMembers={groupMembers}
            currentUserID={currentUserID}
            value={timelinePerspective}
            onChange={setTimelinePerspective}
            label="Timeline"
          />
          <div style={weekControlsStyle}>
            <button type="button" aria-label="Previous week" style={iconButtonStyle} onClick={() => setWeekAnchor((current) => addDays(current, -WEEK_DAY_COUNT))}>{"<"}</button>
            <button type="button" style={todayButtonStyle} onClick={() => setWeekAnchor(weekStart(new Date()))}>Today</button>
            <button type="button" aria-label="Next week" style={iconButtonStyle} onClick={() => setWeekAnchor((current) => addDays(current, WEEK_DAY_COUNT))}>{">"}</button>
            <button type="button" style={secondaryButtonStyle} onClick={clearTimelinePerspective}>Clear</button>
          </div>
        </div>
        <div style={timelineMessageSlotStyle}>
          {error && <div style={errorStyle}>{error}</div>}
          {!error && notice && <div style={noticeStyle}>{notice}</div>}
        </div>
        <TimelineChart
          accent={accent}
          loading={loading || timelineLoading}
          weekDays={weekDays}
          rows={visibleTimelineRows}
          draft={barDraft}
          onDropEntity={addTimelineItem}
          onRemoveItem={removeTimelineItem}
          onNodeOpen={onNodeOpen}
          onStartBarInteraction={setBarInteraction}
        />
      </section>
      <div role="separator" aria-orientation="horizontal" style={verticalResizerStyle} onPointerDown={startVerticalResize} />
      <section ref={bottomRef} style={bottomGridStyle(horizontalSplit)}>
        <ProjectEntityExplorerPanel
          title="Logic Gates"
          rootLabel={`${companyPerspectiveLabel(logicGatePerspective, companyUsers, groups, currentUserID)} Logic Gates`}
          kind="logic_gate"
          rows={logicGateRows}
          expanded={logicGateExpanded}
          onSetExpanded={setLogicGateExpanded}
          perspective={logicGatePerspective}
          onPerspectiveChange={setLogicGatePerspective}
          companyUsers={companyUsers}
          groups={groups}
          groupMembers={groupMembers}
          currentUserID={currentUserID}
          count={filteredLogicGates.length}
          onAddEntity={addExplorerEntityToTimeline}
        />
        <div role="separator" aria-orientation="vertical" style={horizontalResizerStyle} onPointerDown={startHorizontalResize} />
        <ProjectEntityExplorerPanel
          title="Nodes"
          rootLabel={`${companyPerspectiveLabel(nodePerspective, companyUsers, groups, currentUserID)} Nodes`}
          kind="node"
          rows={nodeRows}
          expanded={nodeExpanded}
          onSetExpanded={setNodeExpanded}
          perspective={nodePerspective}
          onPerspectiveChange={setNodePerspective}
          companyUsers={companyUsers}
          groups={groups}
          groupMembers={groupMembers}
          currentUserID={currentUserID}
          count={filteredNodes.length}
          onNodeOpen={onNodeOpen}
          onAddEntity={addExplorerEntityToTimeline}
        />
      </section>
      <div aria-hidden="true" data-project-management-scope={widgetId?.trim() || "project-management"} style={{ display: "none" }} />
    </div>
  );
};

function TimelineChart({
  accent,
  loading,
  weekDays,
  rows,
  draft,
  onDropEntity,
  onRemoveItem,
  onNodeOpen,
  onStartBarInteraction,
}: {
  accent: string;
  loading: boolean;
  weekDays: Date[];
  rows: ProjectManagementTimelineRow[];
  draft: BarDraft | null;
  onDropEntity: (payload: ProjectTimelinePayload, startOffset: number) => void;
  onRemoveItem: (item: ProjectManagementTimelineRow) => void;
  onNodeOpen?: (nodeID: string) => void;
  onStartBarInteraction: (interaction: BarInteraction) => void;
}) {
  const [dropOffset, setDropOffset] = useState<number | null>(null);
  const gridWidth = TIMELINE_LABEL_W + WEEK_DAY_COUNT * TIMELINE_DAY_W;
  const weekStartDate = weekDays[0];
  const bodyRowCount = loading ? 3 : Math.max(rows.length, 6);
  const dropOffsetForEvent = (event: React.DragEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - TIMELINE_LABEL_W;
    return clampInteger(Math.floor(x / TIMELINE_DAY_W), 0, WEEK_DAY_COUNT - 1);
  };
  return (
    <div className="kanban-board-scroll" style={timelineScrollStyle}>
      <div
        style={{ ...timelineGridStyle(bodyRowCount), width: gridWidth }}
        onDragOver={(event) => {
          if (!hasTimelinePayloadType(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDropOffset(dropOffsetForEvent(event));
        }}
        onDragLeave={() => setDropOffset(null)}
        onDrop={(event) => {
          const payload = readTimelinePayload(event.dataTransfer);
          if (!payload) return;
          event.preventDefault();
          onDropEntity(payload, dropOffsetForEvent(event));
          setDropOffset(null);
        }}
      >
        <div style={timelineCornerStyle}>Week</div>
        {weekDays.map((day, index) => (
          <div key={isoDate(day)} style={timelineHeaderCellStyle(index === dropOffset, accent)}>
            <span style={timelineHeaderDayStyle}>{shortDayLabel(day)}</span>
          </div>
        ))}
        {loading ? (
          <div style={{ ...timelineEmptyStyle, gridColumn: `1 / span ${WEEK_DAY_COUNT + 1}` }}>Loading</div>
        ) : rows.length > 0 ? rows.map((item, rowIndex) => {
          const actualStartOffset = displayStartOffset(item, weekStartDate);
          const baseStart = clampInteger(actualStartOffset, 0, WEEK_DAY_COUNT - 1);
          const baseDuration = clampInteger(Math.min(item.duration_days, WEEK_DAY_COUNT - baseStart), 1, WEEK_DAY_COUNT - baseStart);
          const activeDraft = draft?.itemID === item.item_id ? draft : null;
          const startOffset = activeDraft?.startOffset ?? baseStart;
          const durationDays = activeDraft?.durationDays ?? baseDuration;
          return (
            <React.Fragment key={item.item_id}>
              <div style={timelineRowLabelStyle(rowIndex)}>
                <span style={entityTypePillStyle(rowColor(item))}>{item.resource_type === "logic_gate" ? "Gate" : "Node"}</span>
                <span style={timelineRowTitleStyle}>{item.display_title}</span>
                <span style={timelineStatusStyle}>{item.status || (item.resource_type === "logic_gate" ? "Logic Gate" : "Node")}</span>
              </div>
              {weekDays.map((day, dayIndex) => (
                <div key={`${item.item_id}:${isoDate(day)}`} style={timelineCellStyle(rowIndex, dayIndex === dropOffset, accent)} />
              ))}
              <div
                style={timelineBarStyle(item, rowIndex, startOffset, durationDays)}
                title={item.display_title}
                onDoubleClick={() => {
                  const nodeID = item.node_id?.trim() || (item.resource_type === "node" ? item.resource_id : "");
                  if (nodeID) onNodeOpen?.(nodeID);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  onStartBarInteraction({ item, mode: "move", startX: event.clientX, startOffset, durationDays });
                }}
              >
                <button
                  type="button"
                  aria-label={`Resize ${item.display_title} start`}
                  style={barHandleStyle("left")}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onStartBarInteraction({ item, mode: "left", startX: event.clientX, startOffset, durationDays });
                  }}
                />
                <span style={timelineBarLabelStyle}>{item.display_title}</span>
                <button
                  type="button"
                  aria-label={`Remove ${item.display_title}`}
                  style={removeBarButtonStyle}
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemoveItem(item);
                  }}
                >
                  x
                </button>
                <button
                  type="button"
                  aria-label={`Resize ${item.display_title} end`}
                  style={barHandleStyle("right")}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    onStartBarInteraction({ item, mode: "right", startX: event.clientX, startOffset, durationDays });
                  }}
                />
              </div>
            </React.Fragment>
          );
        }) : (
          <>
            {Array.from({ length: bodyRowCount }).map((_, rowIndex) => (
              <React.Fragment key={`empty-lane:${rowIndex}`}>
                <div style={timelineEmptyLaneLabelStyle(rowIndex, dropOffset !== null, accent)}>
                  {rowIndex === 0 ? (
                    <>
                      <span style={timelineLanePlusStyle}>+</span>
                      <span style={timelineLaneTextStyle}>Drop work here</span>
                    </>
                  ) : null}
                </div>
                {weekDays.map((day, dayIndex) => (
                  <div key={`empty-lane:${rowIndex}:${isoDate(day)}`} style={timelineCellStyle(rowIndex, dayIndex === dropOffset, accent)} />
                ))}
              </React.Fragment>
            ))}
            <div style={timelineEmptyOverlayStyle}>Drag a node or logic gate into the week, or use the + buttons in the lists below.</div>
          </>
        )}
      </div>
    </div>
  );
}

function ProjectEntityExplorerPanel({
  title,
  rootLabel,
  kind,
  rows,
  expanded,
  onSetExpanded,
  perspective,
  onPerspectiveChange,
  companyUsers,
  groups,
  groupMembers,
  currentUserID,
  count,
  onNodeOpen,
  onAddEntity,
}: {
  title: string;
  rootLabel: string;
  kind: ProjectManagementEntityType;
  rows: ExplorerTreeNode[];
  expanded: Set<string>;
  onSetExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  perspective: CompanyPerspective;
  onPerspectiveChange: (perspective: CompanyPerspective) => void;
  companyUsers: CompanyUser[];
  groups: CompanyUserGroup[];
  groupMembers: CompanyUserGroupMember[];
  currentUserID: string;
  count: number;
  onNodeOpen?: (nodeID: string) => void;
  onAddEntity?: (payload: ProjectTimelinePayload) => void;
}) {
  const [rootOpen, setRootOpen] = useState(true);
  const toggleRow = (rowID: string) => {
    onSetExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowID)) next.delete(rowID);
      else next.add(rowID);
      return next;
    });
  };
  return (
    <div style={entityPanelStyle}>
      <div style={entityPanelHeaderStyle}>
        <div style={titleClusterStyle}>
          <h3 style={entityPanelTitleStyle}>{title}</h3>
          <div style={surfaceMetaStyle}>{count} visible</div>
        </div>
        <CompanyPerspectiveSelector
          companyUsers={companyUsers}
          groups={groups}
          groupMembers={groupMembers}
          currentUserID={currentUserID}
          value={perspective}
          onChange={onPerspectiveChange}
          compact
        />
      </div>
      <div className="kanban-board-scroll" style={treeScrollStyle}>
        <button type="button" style={treeRootRowStyle} onClick={() => setRootOpen((open) => !open)}>
          <span style={treeDisclosureStyle}><ExplorerDisclosureIcon open={rootOpen} color="#64748b" /></span>
          <span style={treeIconStyle}><ExplorerRowIcon kind="folder" /></span>
          <span style={treeLabelStyle}>{rootLabel}</span>
        </button>
        {rootOpen && rows.map((row) => (
          <ProjectExplorerRow key={row.id} row={row} kind={kind} expanded={expanded} onToggle={toggleRow} onNodeOpen={onNodeOpen} onAddEntity={onAddEntity} />
        ))}
        {rootOpen && rows.length === 0 && <div style={emptyTreeStyle}>No {kind === "logic_gate" ? "logic gates" : "nodes"}</div>}
      </div>
    </div>
  );
}

function ProjectExplorerRow({
  row,
  kind,
  expanded,
  onToggle,
  onNodeOpen,
  onAddEntity,
}: {
  row: ExplorerTreeNode;
  kind: ProjectManagementEntityType;
  expanded: Set<string>;
  onToggle: (rowID: string) => void;
  onNodeOpen?: (nodeID: string) => void;
  onAddEntity?: (payload: ProjectTimelinePayload) => void;
}) {
  const isFolder = row.kind === "folder";
  const entityID = kind === "logic_gate" ? row.logicGateID : row.nodeID;
  const color = kind === "logic_gate" ? "#8b5cf6" : "#06b6d4";
  const depth = Math.max(0, row.depth + 1);
  const draggable = !isFolder && !!entityID;
  const payload: ProjectTimelinePayload | null = draggable && entityID ? {
    entityType: kind,
    entityID,
    label: row.label,
    color,
  } : null;
  const startDrag = (event: React.DragEvent<HTMLElement>) => {
    if (!payload) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData(PROJECT_TIMELINE_ENTITY_MIME, JSON.stringify(payload));
    event.dataTransfer.setData("text/plain", row.label);
  };
  return (
    <div
      draggable={draggable}
      onDragStart={startDrag}
      onDoubleClick={() => {
        if (kind === "node" && entityID) onNodeOpen?.(entityID);
      }}
      style={treeRowWrapStyle(depth, draggable)}
    >
      <div style={treeRowInnerStyle(draggable)}>
        {payload ? (
          <button
            type="button"
            aria-label={`Add ${row.label} to timeline`}
            title="Add to timeline"
            draggable={false}
            style={treeAddButtonStyle}
            onClick={(event) => {
              event.stopPropagation();
              onAddEntity?.(payload);
            }}
          >
            +
          </button>
        ) : null}
        <button
          type="button"
          draggable={draggable}
          style={treeRowButtonStyle(draggable)}
          onDragStart={startDrag}
          onClick={() => {
            if (isFolder) onToggle(row.id);
          }}
        >
          <span style={treeDisclosureStyle}>{isFolder ? <ExplorerDisclosureIcon open={expanded.has(row.id)} color="#64748b" /> : null}</span>
          <span style={{ ...treeIconStyle, color }}><ExplorerRowIcon kind={row.kind} /></span>
          <span style={treeLabelStyle}>{row.label}</span>
        </button>
      </div>
    </div>
  );
}

function pageStyle(verticalSplit: number): React.CSSProperties {
  return {
    width: "100%",
    height: "100%",
    minHeight: 0,
    display: "grid",
    gridTemplateRows: `minmax(260px, ${verticalSplit}%) 8px minmax(220px, 1fr)`,
    gap: 0,
    padding: 12,
    borderRadius: 0,
    background: "linear-gradient(145deg, #f8fafc 0%, #eef2f7 100%)",
    boxSizing: "border-box",
    color: "#111827",
    overflow: "hidden",
  };
}

const timelineSurfaceStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 8,
  padding: 12,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 247, 251, 0.92))",
  boxShadow: "9px 9px 20px rgba(174, 174, 192, 0.26), -8px -8px 18px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const verticalResizerStyle: React.CSSProperties = {
  cursor: "row-resize",
  borderRadius: 999,
  margin: "2px 34px",
  background: "linear-gradient(90deg, transparent, rgba(100, 116, 139, 0.34), transparent)",
};

function bottomGridStyle(horizontalSplit: number): React.CSSProperties {
  return {
    minHeight: 0,
    display: "grid",
    gridTemplateColumns: `minmax(260px, ${horizontalSplit}%) 8px minmax(260px, 1fr)`,
    gap: 0,
    overflow: "hidden",
  };
}

const horizontalResizerStyle: React.CSSProperties = {
  cursor: "col-resize",
  borderRadius: 999,
  margin: "34px 2px",
  background: "linear-gradient(180deg, transparent, rgba(100, 116, 139, 0.32), transparent)",
};

const surfaceHeaderStyle: React.CSSProperties = {
  minHeight: 38,
  display: "grid",
  gridTemplateColumns: "minmax(190px, 1fr) minmax(340px, auto) auto",
  alignItems: "center",
  gap: 12,
};

const titleClusterStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const surfaceTitleStyle: React.CSSProperties = {
  margin: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 16,
  fontWeight: 950,
  letterSpacing: 0,
};

const surfaceMetaStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
};

const weekControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
};

const iconButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
  fontWeight: 950,
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.16), -4px -4px 10px rgba(255, 255, 255, 0.84)",
};

const todayButtonStyle: React.CSSProperties = {
  height: 30,
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 900,
  padding: "0 10px",
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.16), -4px -4px 10px rgba(255, 255, 255, 0.84)",
};

const secondaryButtonStyle: React.CSSProperties = {
  ...todayButtonStyle,
  color: "#64748b",
};

const errorStyle: React.CSSProperties = {
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  border: "1px solid rgba(248, 113, 113, 0.28)",
  borderRadius: 8,
  background: "rgba(254, 242, 242, 0.82)",
  color: "#991b1b",
  fontSize: 11,
  fontWeight: 800,
};

const noticeStyle: React.CSSProperties = {
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  border: "1px solid rgba(34, 197, 94, 0.24)",
  borderRadius: 8,
  background: "rgba(240, 253, 244, 0.82)",
  color: "#166534",
  fontSize: 11,
  fontWeight: 800,
};

const timelineMessageSlotStyle: React.CSSProperties = {
  minHeight: 0,
};

const timelineScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.74)",
};

function timelineGridStyle(bodyRowCount: number): React.CSSProperties {
  return {
    position: "relative",
    display: "grid",
    gridTemplateColumns: `${TIMELINE_LABEL_W}px repeat(${WEEK_DAY_COUNT}, ${TIMELINE_DAY_W}px)`,
    gridTemplateRows: `${TIMELINE_ROW_H}px repeat(${Math.max(1, bodyRowCount)}, minmax(${TIMELINE_ROW_H}px, 1fr))`,
    minHeight: "100%",
  };
}

const timelineCornerStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  top: 0,
  zIndex: 8,
  display: "flex",
  alignItems: "center",
  padding: "0 12px",
  borderRight: "1px solid rgba(148, 163, 184, 0.20)",
  borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
  background: "linear-gradient(145deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.92))",
  color: "#475569",
  fontSize: 11,
  fontWeight: 950,
  boxSizing: "border-box",
};

function timelineHeaderCellStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    position: "sticky",
    top: 0,
    zIndex: 7,
    display: "flex",
    alignItems: "center",
    padding: "0 10px",
    borderRight: "1px solid rgba(148, 163, 184, 0.16)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.22)",
    background: active ? `linear-gradient(145deg, rgba(239, 246, 255, 0.98), ${accent}18)` : "linear-gradient(145deg, rgba(248, 250, 252, 0.98), rgba(255, 255, 255, 0.92))",
    color: "#334155",
    boxSizing: "border-box",
  };
}

const timelineHeaderDayStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 950,
};

function timelineRowLabelStyle(rowIndex: number): React.CSSProperties {
  return {
    position: "sticky",
    left: 0,
    zIndex: 5,
    gridColumn: 1,
    gridRow: rowIndex + 2,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "48px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 7,
    padding: "0 10px",
    borderRight: "1px solid rgba(148, 163, 184, 0.18)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.13)",
    background: rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.96)" : "rgba(248, 250, 252, 0.96)",
    boxSizing: "border-box",
  };
}

function timelineCellStyle(rowIndex: number, active: boolean, accent: string): React.CSSProperties {
  return {
    gridRow: rowIndex + 2,
    borderRight: "1px solid rgba(148, 163, 184, 0.13)",
    borderBottom: "1px solid rgba(148, 163, 184, 0.13)",
    background: active ? `${accent}10` : rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.48)" : "rgba(248, 250, 252, 0.62)",
    boxSizing: "border-box",
  };
}

function timelineBarStyle(item: ProjectManagementTimelineRow, rowIndex: number, startOffset: number, durationDays: number): React.CSSProperties {
  const start = clampInteger(startOffset, 0, WEEK_DAY_COUNT - 1);
  const duration = clampInteger(durationDays, 1, WEEK_DAY_COUNT - start);
  const color = rowColor(item);
  return {
    zIndex: 6,
    gridColumn: `${start + 2} / span ${duration}`,
    gridRow: rowIndex + 2,
    alignSelf: "center",
    minWidth: 0,
    height: 26,
    display: "grid",
    gridTemplateColumns: "8px minmax(0, 1fr) 22px 8px",
    alignItems: "center",
    gap: 3,
    margin: "0 8px",
    padding: "0 5px",
    border: `1px solid ${color}66`,
    borderRadius: 7,
    background: `linear-gradient(145deg, ${color}18, rgba(255, 255, 255, 0.94))`,
    boxShadow: `0 7px 16px ${color}18, inset 1px 1px 0 rgba(255, 255, 255, 0.88)`,
    color: "#111827",
    boxSizing: "border-box",
    cursor: "grab",
  };
}

function barHandleStyle(side: "left" | "right"): React.CSSProperties {
  return {
    width: 8,
    height: 18,
    border: 0,
    borderRadius: 4,
    background: "rgba(100, 116, 139, 0.34)",
    cursor: side === "left" ? "w-resize" : "e-resize",
    padding: 0,
  };
}

const timelineBarLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 950,
};

const removeBarButtonStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 6,
  background: "rgba(255, 255, 255, 0.86)",
  color: "#64748b",
  cursor: "pointer",
  fontSize: 10,
  fontWeight: 950,
  lineHeight: 1,
};

const timelineEmptyStyle: React.CSSProperties = {
  gridRow: 2,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
  minHeight: 96,
};

function timelineEmptyLaneLabelStyle(rowIndex: number, active: boolean, accent: string): React.CSSProperties {
  return {
    ...timelineRowLabelStyle(rowIndex),
    gridTemplateColumns: "24px minmax(0, 1fr)",
    background: active && rowIndex === 0 ? `${accent}10` : rowIndex % 2 === 0 ? "rgba(255, 255, 255, 0.96)" : "rgba(248, 250, 252, 0.96)",
  };
}

const timelineLanePlusStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(14, 165, 233, 0.30)",
  borderRadius: 6,
  background: "rgba(240, 249, 255, 0.88)",
  color: "#0284c7",
  fontSize: 14,
  fontWeight: 950,
  lineHeight: 1,
};

const timelineLaneTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 900,
};

const timelineEmptyOverlayStyle: React.CSSProperties = {
  zIndex: 4,
  gridColumn: `2 / span ${WEEK_DAY_COUNT}`,
  gridRow: "2 / span 6",
  alignSelf: "center",
  justifySelf: "center",
  maxWidth: 460,
  padding: "8px 12px",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 9,
  background: "rgba(255, 255, 255, 0.78)",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
  textAlign: "center",
  pointerEvents: "none",
  boxShadow: "4px 4px 12px rgba(174, 174, 192, 0.12), -4px -4px 12px rgba(255, 255, 255, 0.8)",
};

function entityTypePillStyle(color: string): React.CSSProperties {
  return {
    minWidth: 0,
    height: 20,
    display: "inline-grid",
    placeItems: "center",
    border: `1px solid ${color}66`,
    borderRadius: 6,
    background: `${color}12`,
    color,
    fontSize: 9,
    fontWeight: 950,
    textTransform: "uppercase",
    letterSpacing: 0,
  };
}

const timelineRowTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#111827",
  fontSize: 11,
  fontWeight: 900,
};

const timelineStatusStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 850,
};

const entityPanelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 12,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 247, 251, 0.92))",
  boxShadow: "8px 8px 18px rgba(174, 174, 192, 0.18), -7px -7px 16px rgba(255, 255, 255, 0.86)",
  boxSizing: "border-box",
  overflow: "hidden",
};

const entityPanelHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(130px, 1fr) minmax(250px, auto)",
  alignItems: "start",
  gap: 10,
};

const entityPanelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 13,
  fontWeight: 950,
  letterSpacing: 0,
};

const treeScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 8,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.64)",
  boxSizing: "border-box",
};

const treeRootRowStyle: React.CSSProperties = {
  width: "100%",
  height: 32,
  display: "grid",
  gridTemplateColumns: "18px 20px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(248, 250, 252, 0.9))",
  color: "#334155",
  cursor: "pointer",
  padding: "0 10px",
  fontFamily: "inherit",
  boxSizing: "border-box",
  boxShadow: "4px 4px 10px rgba(174, 174, 192, 0.12), -4px -4px 10px rgba(255, 255, 255, 0.82)",
};

function treeRowWrapStyle(depth: number, draggable: boolean): React.CSSProperties {
  return {
    paddingLeft: depth * 16,
    cursor: draggable ? "grab" : "default",
  };
}

function treeRowInnerStyle(draggable: boolean): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: draggable ? "24px minmax(0, 1fr)" : "minmax(0, 1fr)",
    alignItems: "center",
    gap: 4,
  };
}

function treeRowButtonStyle(draggable: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 30,
    display: "grid",
    gridTemplateColumns: "18px 20px minmax(0, 1fr)",
    alignItems: "center",
    gap: 6,
    border: 0,
    borderRadius: 7,
    background: "transparent",
    color: "#475569",
    cursor: draggable ? "grab" : "pointer",
    padding: "0 8px",
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
}

const treeAddButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(14, 165, 233, 0.28)",
  borderRadius: 7,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(240, 249, 255, 0.90))",
  color: "#0284c7",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 950,
  lineHeight: 1,
  padding: 0,
  boxShadow: "3px 3px 8px rgba(174, 174, 192, 0.14), -3px -3px 8px rgba(255, 255, 255, 0.86)",
};

const treeDisclosureStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
};

const treeIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
};

const treeLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 800,
};

const emptyTreeStyle: React.CSSProperties = {
  minHeight: 80,
  display: "grid",
  placeItems: "center",
  color: "#94a3b8",
  fontSize: 12,
  fontWeight: 800,
};

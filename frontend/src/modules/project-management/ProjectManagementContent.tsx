import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchCurrentUser } from "../../auth/cognitoAuth.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../company-explorer/CompanyExplorerIcons.js";
import { buildCompanyExplorerTreeRows } from "../company-explorer/companyExplorerTreeRows.js";
import type { ExplorerTreeNode } from "../company-explorer/companyExplorerTypes.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../logic-gate-map/shared.js";
import { toLogicGateCanvasRecord } from "../logic-gate-map/shared.js";
import type { NodeRecord } from "../node-map/shared.js";
import { getNodeTitle } from "../node-map/shared.js";
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
  perspectiveStorageKey,
  userIDsForPerspective,
  type CompanyPerspective,
} from "../perspectives/PerspectiveSelector.js";

type ProjectManagementContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
};

type ProjectEntityType = "node" | "logic_gate";

type ProjectTimelinePayload = {
  entityType: ProjectEntityType;
  entityID: string;
  label: string;
  color?: string;
};

type ProjectTimelineItem = ProjectTimelinePayload & {
  id: string;
  timelineKey: string;
  startOffset: number;
  durationDays: number;
  status: string;
  source: "stored" | "suggested";
};

type WorkspacePanelState = {
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  nodes: NodeRecord[];
  logicGateFolders: CompanyExplorerFolder[];
  logicGateFolderItems: CompanyExplorerFolderItem[];
  logicGates: LogicGateRecord[];
};

const PROJECT_TIMELINE_ENTITY_MIME = "application/x-mangorts-project-timeline-entity";
const PROJECT_TIMELINE_STORAGE_KEY_PREFIX = "mangorts.project-management.timeline.v1";
const EMPTY_WORKSPACE_PANEL: WorkspacePanelState = {
  nodeFolders: [],
  nodeFolderItems: [],
  nodes: [],
  logicGateFolders: [],
  logicGateFolderItems: [],
  logicGates: [],
};
const WEEK_DAY_COUNT = 7;
const TIMELINE_LABEL_W = 258;
const TIMELINE_DAY_W = 138;
const TIMELINE_ROW_H = 42;

function projectTimelineStorageKey(companyID: string): string {
  return `${PROJECT_TIMELINE_STORAGE_KEY_PREFIX}:${companyID.trim() || "global"}`;
}

function readStoredTimelineItems(companyID: string): ProjectTimelineItem[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(projectTimelineStorageKey(companyID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    const items: ProjectTimelineItem[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<ProjectTimelineItem>;
      const entityType = candidate.entityType === "logic_gate" ? "logic_gate" : candidate.entityType === "node" ? "node" : "";
      const entityID = typeof candidate.entityID === "string" ? candidate.entityID.trim() : "";
      const timelineKey = typeof candidate.timelineKey === "string" ? candidate.timelineKey.trim() : "";
      const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
      if (!entityType || !entityID || !timelineKey || !label) continue;
      const key = `${timelineKey}:${entityType}:${entityID}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : key,
        timelineKey,
        entityType,
        entityID,
        label,
        color: typeof candidate.color === "string" ? candidate.color : undefined,
        startOffset: clampInteger(candidate.startOffset, 0, WEEK_DAY_COUNT - 1),
        durationDays: clampInteger(candidate.durationDays, 1, WEEK_DAY_COUNT),
        status: typeof candidate.status === "string" && candidate.status.trim() ? candidate.status.trim() : entityType === "logic_gate" ? "Logic Gate" : "Node",
        source: "stored",
      });
    }
    return items;
  } catch {
    return [];
  }
}

function saveStoredTimelineItems(companyID: string, items: ProjectTimelineItem[]): void {
  if (typeof localStorage === "undefined") return;
  const stored = items.filter((item) => item.source === "stored");
  localStorage.setItem(projectTimelineStorageKey(companyID), JSON.stringify(stored));
}

function clampInteger(value: unknown, min: number, max: number): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : min;
  return Math.max(min, Math.min(max, numeric));
}

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

function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function shortDayLabel(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(date);
}

function normalizeISODate(value: string | null | undefined): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : "";
}

function nodeStatusLabel(node: NodeRecord): string {
  return node.status?.trim() || "Node";
}

function nodeColor(node: NodeRecord): string {
  const explicit = node.status_color?.trim();
  if (explicit) return explicit;
  const status = node.status?.trim().toLowerCase() ?? "";
  if (status.includes("done") || status.includes("complete")) return "#22c55e";
  if (status.includes("progress")) return "#3b82f6";
  if (status.includes("verify")) return "#a855f7";
  if (status.includes("blocked")) return "#ef4444";
  return "#06b6d4";
}

function logicGateColor(logicGate: LogicGateRecord): string {
  const assignments = logicGate.raci_assignments ?? [];
  if (assignments.some((assignment) => assignment.role === "responsible")) return "#8b5cf6";
  if (assignments.some((assignment) => assignment.role === "accountable")) return "#f97316";
  return "#64748b";
}

function logicGateLabel(logicGate: LogicGateRecord): string {
  return logicGate.header.trim() || logicGate.logic_gate_id;
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
    return {
      entityType,
      entityID,
      label,
      color: typeof parsed.color === "string" ? parsed.color : undefined,
    };
  } catch {
    return null;
  }
}

function visibleRowsForKind(rows: ExplorerTreeNode[], kind: ProjectEntityType): ExplorerTreeNode[] {
  return rows.filter((row) => row.kind === "folder" || row.kind === kind);
}

function buildEntityRows(input: {
  kind: ProjectEntityType;
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

function suggestedTimelineItems(input: {
  timelineKey: string;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  weekDays: Date[];
}): ProjectTimelineItem[] {
  const weekIndexByISO = new Map(input.weekDays.map((day, index) => [isoDate(day), index]));
  const nodeItems = input.nodes
    .slice()
    .sort((left, right) => (normalizeISODate(left.due_date) || "9999-99-99").localeCompare(normalizeISODate(right.due_date) || "9999-99-99") || getNodeTitle(left).localeCompare(getNodeTitle(right)))
    .slice(0, 14)
    .map((node, index): ProjectTimelineItem => {
      const dueDate = normalizeISODate(node.due_date);
      const dueOffset = dueDate ? weekIndexByISO.get(dueDate) : undefined;
      const startOffset = dueOffset ?? (index % WEEK_DAY_COUNT);
      return {
        id: `suggested:node:${node.node_id}`,
        timelineKey: input.timelineKey,
        entityType: "node",
        entityID: node.node_id,
        label: getNodeTitle(node) || node.node_id,
        color: nodeColor(node),
        startOffset,
        durationDays: Math.max(1, Math.min(3, node.priority ? Math.ceil(Number(node.priority) / 2) : 1)),
        status: nodeStatusLabel(node),
        source: "suggested",
      };
    });
  const logicGateItems = input.logicGates
    .slice()
    .sort((left, right) => logicGateLabel(left).localeCompare(logicGateLabel(right)))
    .slice(0, Math.max(0, 18 - nodeItems.length))
    .map((logicGate, index): ProjectTimelineItem => ({
      id: `suggested:logic_gate:${logicGate.logic_gate_id}`,
      timelineKey: input.timelineKey,
      entityType: "logic_gate",
      entityID: logicGate.logic_gate_id,
        label: logicGateLabel(logicGate),
      color: logicGateColor(logicGate),
      startOffset: (index * 2) % WEEK_DAY_COUNT,
      durationDays: 2,
      status: "Logic Gate",
      source: "suggested",
    }));
  return [...logicGateItems, ...nodeItems];
}

export const ProjectManagementContent: React.FC<ProjectManagementContentProps> = ({
  accent,
  widgetId,
  hideTopControls: _hideTopControls,
  theme: _theme,
}) => {
  const companyID = getActiveCompanyID();
  const storageScope = widgetId?.trim() || "project-management";
  const [currentUserID, setCurrentUserID] = useState("");
  const [companyUsers, setCompanyUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [workspace, setWorkspace] = useState<WorkspacePanelState>(EMPTY_WORKSPACE_PANEL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [weekAnchor, setWeekAnchor] = useState(() => weekStart(new Date()));
  const [timelineItems, setTimelineItems] = useState<ProjectTimelineItem[]>([]);
  const timelineLoadedRef = useRef(false);
  const [timelinePerspective, setTimelinePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [logicGatePerspective, setLogicGatePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [nodePerspective, setNodePerspective] = useState<CompanyPerspective>(() => defaultUserPerspective(""));
  const [logicGateExpanded, setLogicGateExpanded] = useState<Set<string>>(() => new Set());
  const [nodeExpanded, setNodeExpanded] = useState<Set<string>>(() => new Set());

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
        setTimelineItems(readStoredTimelineItems(companyID));
        timelineLoadedRef.current = true;
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load project management data");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID]);

  useEffect(() => {
    if (!timelineLoadedRef.current) return;
    saveStoredTimelineItems(companyID, timelineItems);
  }, [companyID, timelineItems]);

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
  const timelineKey = perspectiveStorageKey(timelinePerspective, currentUserID);
  const timelineNodes = useMemo(() => filterNodesByPerspective(workspace.nodes, timelinePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, timelinePerspective, workspace.nodes]);
  const timelineLogicGates = useMemo(() => filterLogicGatesByPerspective(workspace.logicGates, timelinePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, timelinePerspective, workspace.logicGates]);
  const storedTimelineRows = useMemo(() => timelineItems.filter((item) => item.timelineKey === timelineKey), [timelineItems, timelineKey]);
  const timelineRows = useMemo(() => (
    storedTimelineRows.length > 0
      ? storedTimelineRows
      : suggestedTimelineItems({ timelineKey, nodes: timelineNodes, logicGates: timelineLogicGates, weekDays })
  ), [storedTimelineRows, timelineKey, timelineLogicGates, timelineNodes, weekDays]);

  const filteredLogicGates = useMemo(() => filterLogicGatesByPerspective(workspace.logicGates, logicGatePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, logicGatePerspective, workspace.logicGates]);
  const filteredNodes = useMemo(() => filterNodesByPerspective(workspace.nodes, nodePerspective, groupMembers, currentUserID), [currentUserID, groupMembers, nodePerspective, workspace.nodes]);
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

  const addTimelineItem = useCallback((payload: ProjectTimelinePayload, startOffset: number) => {
    const status = payload.entityType === "logic_gate"
      ? "Logic Gate"
      : workspace.nodes.find((node) => node.node_id === payload.entityID)?.status?.trim() || "Node";
    const color = payload.color || (payload.entityType === "logic_gate"
      ? logicGateColor(workspace.logicGates.find((logicGate) => logicGate.logic_gate_id === payload.entityID) ?? { company_id: companyID, logic_gate_id: payload.entityID, header: payload.label, created_timestamp: "" })
      : nodeColor(workspace.nodes.find((node) => node.node_id === payload.entityID) ?? { company_id: companyID, node_id: payload.entityID, title: payload.label, created_timestamp: "" }));
    setTimelineItems((current) => {
      const key = `${timelineKey}:${payload.entityType}:${payload.entityID}`;
      const nextItem: ProjectTimelineItem = {
        id: key,
        timelineKey,
        entityType: payload.entityType,
        entityID: payload.entityID,
        label: payload.label,
        color,
        startOffset,
        durationDays: payload.entityType === "logic_gate" ? 2 : 1,
        status,
        source: "stored",
      };
      return [...current.filter((item) => !(item.timelineKey === timelineKey && item.entityType === payload.entityType && item.entityID === payload.entityID)), nextItem];
    });
    setNotice(`${payload.label} added to ${companyPerspectiveLabel(timelinePerspective, companyUsers, groups, currentUserID)}`);
  }, [companyID, companyUsers, currentUserID, groups, timelineKey, timelinePerspective, workspace.logicGates, workspace.nodes]);

  const removeTimelineItem = (itemID: string) => {
    setTimelineItems((current) => current.filter((item) => item.id !== itemID));
  };

  const clearTimelinePerspective = () => {
    setTimelineItems((current) => current.filter((item) => item.timelineKey !== timelineKey));
  };

  return (
    <div style={pageStyle}>
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
        {error && <div style={errorStyle}>{error}</div>}
        {!error && notice && <div style={noticeStyle}>{notice}</div>}
        <TimelineChart
          accent={accent}
          loading={loading}
          weekDays={weekDays}
          rows={timelineRows}
          onDropEntity={addTimelineItem}
          onRemoveItem={removeTimelineItem}
        />
      </section>
      <section style={bottomGridStyle}>
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
        />
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
        />
      </section>
      <div aria-hidden="true" data-project-management-scope={storageScope} style={{ display: "none" }} />
    </div>
  );
};

function TimelineChart({
  accent,
  loading,
  weekDays,
  rows,
  onDropEntity,
  onRemoveItem,
}: {
  accent: string;
  loading: boolean;
  weekDays: Date[];
  rows: ProjectTimelineItem[];
  onDropEntity: (payload: ProjectTimelinePayload, startOffset: number) => void;
  onRemoveItem: (itemID: string) => void;
}) {
  const [dropOffset, setDropOffset] = useState<number | null>(null);
  const gridWidth = TIMELINE_LABEL_W + WEEK_DAY_COUNT * TIMELINE_DAY_W;
  const dropOffsetForEvent = (event: React.DragEvent<HTMLDivElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left - TIMELINE_LABEL_W;
    return clampInteger(Math.floor(x / TIMELINE_DAY_W), 0, WEEK_DAY_COUNT - 1);
  };
  const hasRows = rows.length > 0;
  return (
    <div className="kanban-board-scroll" style={timelineScrollStyle}>
      <div
        style={{ ...timelineGridStyle, width: gridWidth }}
        onDragOver={(event) => {
          if (!readTimelinePayload(event.dataTransfer)) return;
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
        ) : hasRows ? rows.map((item, rowIndex) => (
          <React.Fragment key={item.id}>
            <div style={timelineRowLabelStyle(rowIndex)}>
              <span style={entityTypePillStyle(item.entityType, item.color)}>{item.entityType === "logic_gate" ? "Gate" : "Node"}</span>
              <span style={timelineRowTitleStyle}>{item.label}</span>
              <span style={timelineStatusStyle}>{item.status}</span>
            </div>
            {weekDays.map((day, dayIndex) => (
              <div key={`${item.id}:${isoDate(day)}`} style={timelineCellStyle(rowIndex, dayIndex === dropOffset, accent)} />
            ))}
            <div
              style={timelineBarStyle(item, rowIndex)}
              title={item.label}
            >
              <span style={timelineBarLabelStyle}>{item.label}</span>
              {item.source === "stored" && (
                <button type="button" aria-label={`Remove ${item.label}`} style={removeBarButtonStyle} onClick={() => onRemoveItem(item.id)}>x</button>
              )}
            </div>
          </React.Fragment>
        )) : (
          <div style={{ ...timelineEmptyStyle, gridColumn: `1 / span ${WEEK_DAY_COUNT + 1}` }}>No scheduled work</div>
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
}: {
  title: string;
  rootLabel: string;
  kind: ProjectEntityType;
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
          <ProjectExplorerRow key={row.id} row={row} kind={kind} expanded={expanded} onToggle={toggleRow} />
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
}: {
  row: ExplorerTreeNode;
  kind: ProjectEntityType;
  expanded: Set<string>;
  onToggle: (rowID: string) => void;
}) {
  const isFolder = row.kind === "folder";
  const entityID = kind === "logic_gate" ? row.logicGateID : row.nodeID;
  const color = kind === "logic_gate" ? "#8b5cf6" : "#06b6d4";
  const depth = Math.max(0, row.depth + 1);
  const draggable = !isFolder && !!entityID;
  return (
    <div
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable || !entityID) {
          event.preventDefault();
          return;
        }
        const payload: ProjectTimelinePayload = {
          entityType: kind,
          entityID,
          label: row.label,
          color,
        };
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(PROJECT_TIMELINE_ENTITY_MIME, JSON.stringify(payload));
        event.dataTransfer.setData("text/plain", row.label);
      }}
      style={treeRowWrapStyle(depth, draggable)}
    >
      <button
        type="button"
        style={treeRowButtonStyle(draggable)}
        onClick={() => {
          if (isFolder) onToggle(row.id);
        }}
      >
        <span style={treeDisclosureStyle}>{isFolder ? <ExplorerDisclosureIcon open={expanded.has(row.id)} color="#64748b" /> : null}</span>
        <span style={{ ...treeIconStyle, color }}><ExplorerRowIcon kind={row.kind} /></span>
        <span style={treeLabelStyle}>{row.label}</span>
      </button>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "minmax(318px, 1.08fr) minmax(238px, 0.92fr)",
  gap: 12,
  padding: 12,
  borderRadius: 14,
  background: "linear-gradient(145deg, #f8fafc 0%, #eef2f7 100%)",
  boxSizing: "border-box",
  color: "#111827",
  overflow: "visible",
};

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
  overflow: "visible",
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

const timelineScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  border: "1px solid rgba(148, 163, 184, 0.20)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.74)",
};

const timelineGridStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gridTemplateColumns: `${TIMELINE_LABEL_W}px repeat(${WEEK_DAY_COUNT}, ${TIMELINE_DAY_W}px)`,
  gridAutoRows: `${TIMELINE_ROW_H}px`,
  minHeight: "100%",
};

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

function timelineBarStyle(item: ProjectTimelineItem, rowIndex: number): React.CSSProperties {
  const start = Math.max(0, Math.min(WEEK_DAY_COUNT - 1, item.startOffset));
  const duration = Math.max(1, Math.min(WEEK_DAY_COUNT - start, item.durationDays));
  return {
    zIndex: 6,
    gridColumn: `${start + 2} / span ${duration}`,
    gridRow: rowIndex + 2,
    alignSelf: "center",
    height: 25,
    margin: "0 8px",
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 8px",
    border: `1px solid ${item.color || "#64748b"}66`,
    borderRadius: 7,
    background: `linear-gradient(145deg, ${item.color || "#64748b"}24, rgba(255, 255, 255, 0.88))`,
    color: "#1f2937",
    boxShadow: `0 6px 14px ${item.color || "#64748b"}22, inset 1px 1px 0 rgba(255, 255, 255, 0.82)`,
    boxSizing: "border-box",
    overflow: "hidden",
  };
}

const timelineBarLabelStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

const removeBarButtonStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  flex: "0 0 18px",
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.20)",
  borderRadius: 5,
  background: "rgba(255, 255, 255, 0.78)",
  color: "#64748b",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 950,
  padding: 0,
};

function entityTypePillStyle(kind: ProjectEntityType, color?: string): React.CSSProperties {
  const resolved = color || (kind === "logic_gate" ? "#8b5cf6" : "#06b6d4");
  return {
    height: 21,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: `1px solid ${resolved}55`,
    borderRadius: 6,
    background: `${resolved}14`,
    color: resolved,
    fontSize: 9,
    fontWeight: 950,
    textTransform: "uppercase",
  };
}

const timelineRowTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#1f2937",
  fontSize: 11,
  fontWeight: 900,
};

const timelineStatusStyle: React.CSSProperties = {
  maxWidth: 78,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#64748b",
  fontSize: 10,
  fontWeight: 800,
};

const timelineEmptyStyle: React.CSSProperties = {
  minHeight: 72,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#64748b",
  fontSize: 12,
  fontWeight: 850,
};

const bottomGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 12,
};

const entityPanelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  padding: 11,
  border: "1px solid rgba(255, 255, 255, 0.76)",
  borderRadius: 12,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(246, 247, 251, 0.90))",
  boxShadow: "8px 8px 18px rgba(174, 174, 192, 0.24), -7px -7px 16px rgba(255, 255, 255, 0.9), inset 1px 1px 0 rgba(255, 255, 255, 0.88)",
  overflow: "hidden",
  boxSizing: "border-box",
};

const entityPanelHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(108px, 1fr) minmax(248px, auto)",
  alignItems: "center",
  gap: 10,
  marginBottom: 9,
};

const entityPanelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#111827",
  fontSize: 13,
  fontWeight: 950,
};

const treeScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: 6,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.66)",
  boxSizing: "border-box",
};

const treeRootRowStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "22px 22px minmax(0, 1fr)",
  alignItems: "center",
  gap: 5,
  border: "1px solid rgba(148, 163, 184, 0.18)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.86))",
  color: "#334155",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 11,
  fontWeight: 950,
  padding: "0 8px",
  textAlign: "left",
  boxShadow: "0 4px 11px rgba(15, 23, 42, 0.06), inset 1px 1px 0 rgba(255, 255, 255, 0.9)",
  boxSizing: "border-box",
};

function treeRowWrapStyle(depth: number, draggable: boolean): React.CSSProperties {
  return {
    paddingLeft: depth * 16,
    opacity: draggable ? 1 : 0.92,
  };
}

function treeRowButtonStyle(draggable: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "20px 22px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    border: "1px solid transparent",
    borderRadius: 7,
    background: "transparent",
    color: "#334155",
    cursor: draggable ? "grab" : "pointer",
    fontFamily: "inherit",
    padding: "0 8px",
    textAlign: "left",
    boxSizing: "border-box",
  };
}

const treeDisclosureStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-grid",
  placeItems: "center",
  color: "#64748b",
};

const treeIconStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "inline-grid",
  placeItems: "center",
  color: "#64748b",
};

const treeLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const emptyTreeStyle: React.CSSProperties = {
  padding: "12px 10px",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 800,
};

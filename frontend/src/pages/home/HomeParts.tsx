import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { requestAppSidebarPin, type SidebarPinKind } from "../../app/sidebarPins";
import { MinimizeToLineIcon, NODE_EDITOR_POPUP_RESIZE_HANDLES, type NodeEditorPopupResizeHandle } from "../../app/nodeEditorPopupControls";
import { getActiveCompanyID } from "../../auth/currentCompany";
import type { CommunicationsSharedInbox, CommunicationsSharedInboxRaciRole, CompanyUser, EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { NodeRecord } from "../../modules/node-map/shared";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { fetchNotifications, markNotificationRead, type NotificationItem, type NotificationRaciRole, type NotificationSummary } from "../../modules/notifications/notificationsApi";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import { EXPLORER_DRAG_MIME, getExplorerDragPayloadForSelection, readExplorerDragPayload } from "../../modules/company-explorer/companyExplorerDragDrop";
import { ACI_COLUMNS, HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY, HOME_INBOX_GROUP_MAX_HEIGHT_PX, HOME_INBOX_GROUP_MIN_HEIGHT_PX, HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, HOME_ROW_RESIZER_HEIGHT, INBOX_NO_LOGIC_GATE_ID, INBOX_PRIORITIES, RESPONSIBLE_STATUS_COLUMNS } from "./homeConstants";
import type { AciInboxRole, ComposeState, HomeViewID, InboxLogicGateNodeGroup, InboxPriority, MyNodeGroup, ResponsibleInboxStatus } from "./homeTypes";
import { aciCellKey, buildAciInboxGroupsByCell, buildResponsibleInboxGroupsByCell, buildSharedInboxRows, cleanIDList, clampNumber, collectSharedInboxSubtreeIDs, formatAddressList, formatMessageDate, getSharedInboxChildPosition, getSharedInboxSiblingPosition, hasExplorerDrag, hasTriageMessageDrag, isSharedInboxFolderDescendant, logicGateIDsFromExplorerPayload, logicGateTitle, logicGateTreeID, messageDocument, nodeIDFromTreeID, nodeIDsFromExplorerPayload, nodeTitle, nodeTreeID, readTriageMessageIDs, responsibleCellKey, responsibleStatusColor, responsibleStatusLetter, setLogicGateDragData, setNodeDragData, type SharedInboxDropPlacement, type SharedInboxTreeRow } from "./homeUtils";
import { HOME_CYAN, allLogicGateRowsStyle, columnResizeGripStyle, columnResizeHandleStyle, composeStyle, dangerButtonStyle, deleteModalBackdropStyle, deleteModalDetailStyle, deleteModalStyle, detailStyle, detailSubjectStyle, emptySmallStyle, homeColorWithAlpha, iframeStyle, inboxMatrixGridStyle, inputStyle, logicGateDisclosureStyle, logicGateInboxGroupCountStyle, logicGateInboxGroupHeaderStyle, logicGateInboxGroupNotificationStyle, logicGateInboxGroupResizeGripStyle, logicGateInboxGroupResizeHandleStyle, logicGateInboxGroupStyle, logicGateInboxGroupTitleStyle, logicGateInboxNodeGuideStyle, logicGateInboxNodeIconStyle, logicGateInboxNodeListStyle, logicGateInboxNodeRemoveStyle, logicGateInboxNodeRowStyle, logicGateInboxNodeStatusStyle, logicGateInboxNodeTitleStyle, logicGateRaciCellStyle, logicGateRaciColumnHeaderStyle, logicGateRaciColumnLabelStyle, logicGateRaciColumnLetterStyle, logicGateRaciCornerStyle, logicGateRaciHeaderStyle, logicGateRaciMetaStyle, logicGateRaciPanelStyle, logicGateRaciPriorityHeaderStyle, logicGateRaciScrollStyle, logicGateRailHeaderStyle, logicGateRailSectionStyle, logicGateRailStyle, logicGateTreeRowStyle, logicGateTreeRowTextStyle, messagePlacementIconStyle, messageSelectDotStyle, mutedSmallStyle, myLogicGateFolderLabelStyle, myLogicGateGridStyle, myLogicGateGroupStyle, myLogicGateTileIconStyle, myLogicGateTileStyle, myLogicGateTileTextStyle, myLogicGatesListStyle, navButtonStyle, navLabelStyle, navMetaStyle, nodeEditorPopupBackdropStyle, nodeEditorPopupCloseButtonStyle, nodeEditorPopupCollapseButtonStyle, nodeEditorPopupStyle, panelHeaderStyle, panelTitleStyle, primaryButtonStyle, railRowResizeGripStyle, railRowResizeHandleStyle, sharedInboxAccountMetaStyle, sharedInboxContextMenuButtonStyle, sharedInboxCreateButtonStyle, sharedInboxCreateStyle, sharedInboxDisclosureButtonStyle, sharedInboxFolderRowStyle, sharedInboxInputStyle, sharedInboxLabelStackStyle, sharedInboxRenameInputStyle, sharedInboxRowsStyle, shortcutRemoveStyle, sidebarNavStyle, sidebarSectionStyle, sidebarStyle, smallButtonStyle, textareaStyle, toolbarStyle } from "./homeStyles";

const SHARED_TRIAGE_FOLDER_DRAG_MIME = "application/x-mangorts-shared-triage-folder";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;
const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = 64;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "home-node-editor-popup-size-v1";
const HOME_INBOX_GROUP_COLLAPSED_STORAGE_KEY_PREFIX = "mangorts.communications.inboxLogicGateGroupCollapsed.v1";
const LazyHomeNodeEditorContent = React.lazy(() => import("../../modules/editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
  }>,
})));

function isValidSharedInboxEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

type HomePinContextMenuState = {
  x: number;
  y: number;
  kind: SidebarPinKind;
  id: string;
  label: string;
};

function openHomePinContextMenu(
  event: React.MouseEvent,
  target: Omit<HomePinContextMenuState, "x" | "y">,
  setMenu: React.Dispatch<React.SetStateAction<HomePinContextMenuState | null>>,
): void {
  event.preventDefault();
  event.stopPropagation();
  const id = target.id.trim();
  if (!id) return;
  setMenu({ x: event.clientX, y: event.clientY, ...target, id });
}

function HomePinContextMenu({ menu, onClose }: {
  menu: HomePinContextMenuState | null;
  onClose: () => void;
}) {
  if (!menu) return null;
  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      <button
        type="button"
        style={sharedInboxContextMenuButtonStyle}
        onClick={() => {
          requestAppSidebarPin(menu);
          onClose();
        }}
      >
        Pin {menu.kind === "logic_gate" ? "Logic Gate" : "Node"}
      </button>
    </FrameRightClickMenu>
  );
}

export function HomeBulkEditMenu({ menu, companyUsers, logicGates, busy, onClose, onApplyNodePatch, onApplyLogicGateRaci, onAddNodesToLogicGate }: {
  menu: { x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null;
  companyUsers: CompanyUser[];
  logicGates: LogicGateRecord[];
  busy: boolean;
  onClose: () => void;
  onApplyNodePatch: (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">>) => void;
  onApplyLogicGateRaci: (logicGateIDs: string[], role: CommunicationsSharedInboxRaciRole, userID: string, action: "add" | "remove") => void;
  onAddNodesToLogicGate: (nodeIDs: string[], logicGateID: string) => void;
}) {
  const [assignee, setAssignee] = useState("__no_change__");
  const [priority, setPriority] = useState("__no_change__");
  const [status, setStatus] = useState("__no_change__");
  const [dueDateMode, setDueDateMode] = useState<"no_change" | "set" | "clear">("no_change");
  const [dueDate, setDueDate] = useState("");
  const [targetLogicGateID, setTargetLogicGateID] = useState("");
  const [raciRole, setRaciRole] = useState<CommunicationsSharedInboxRaciRole>("responsible");
  const [raciUserID, setRaciUserID] = useState("");
  const [raciAction, setRaciAction] = useState<"add" | "remove">("add");
  const sortedLogicGates = useMemo(() => [...logicGates].sort((a, b) => (
    logicGateTitle(a).localeCompare(logicGateTitle(b), undefined, { numeric: true, sensitivity: "base" })
    || a.logic_gate_id.localeCompare(b.logic_gate_id)
  )), [logicGates]);

  useEffect(() => {
    setAssignee("__no_change__");
    setPriority("__no_change__");
    setStatus("__no_change__");
    setDueDateMode("no_change");
    setDueDate("");
    setTargetLogicGateID(sortedLogicGates[0]?.logic_gate_id ?? "");
    setRaciRole("responsible");
    setRaciUserID(companyUsers[0]?.user_id ?? "");
    setRaciAction("add");
  }, [companyUsers, menu?.kind, menu?.ids.join("\u001f"), sortedLogicGates]);

  if (!menu) return null;
  const title = menu.kind === "node"
    ? `${menu.ids.length} node${menu.ids.length === 1 ? "" : "s"}`
    : `${menu.ids.length} Logic Gate${menu.ids.length === 1 ? "" : "s"}`;
  const fieldStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 30,
    border: "1px solid rgba(255, 136, 32, 0.24)",
    borderRadius: 6,
    background: "#ffffff",
    color: "#24120a",
    font: "inherit",
    fontSize: 12,
    padding: "0 8px",
  };
  const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 4,
    minWidth: 0,
    color: "#24120a",
    fontSize: 11,
    fontWeight: 700,
  };
  const actionButtonStyle: React.CSSProperties = {
    minHeight: 31,
    border: "1px solid rgba(255, 136, 32, 0.38)",
    borderRadius: 6,
    background: "#fff2e0",
    color: "#24120a",
    cursor: busy ? "not-allowed" : "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 800,
  };

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      <form
        style={{ width: 280, display: "grid", gap: 9, padding: "8px 10px 10px" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (menu.kind === "node") {
            const patch: Partial<Pick<NodeRecord, "assignee_user_id" | "priority" | "status" | "due_date">> = {};
            if (assignee !== "__no_change__") patch.assignee_user_id = assignee === "__clear__" ? null : assignee;
            if (priority !== "__no_change__") patch.priority = priority === "0" ? null : Number(priority);
            if (status !== "__no_change__") patch.status = status;
            if (dueDateMode === "clear") patch.due_date = null;
            if (dueDateMode === "set") patch.due_date = dueDate;
            if (Object.keys(patch).length > 0) onApplyNodePatch(menu.ids, patch);
            else onClose();
            return;
          }
          onApplyLogicGateRaci(menu.ids, raciRole, raciUserID, raciAction);
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <strong style={{ fontSize: 12, color: "#24120a" }}>{title}</strong>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#7c2d12", font: "inherit", fontWeight: 800 }}>x</button>
        </div>
        {menu.kind === "node" ? (
          <>
            <label style={labelStyle}>
              Assignment
              <select value={assignee} onChange={(event) => setAssignee(event.target.value)} style={fieldStyle}>
                <option value="__no_change__">No change</option>
                <option value="__clear__">Unassigned</option>
                {companyUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.display_name || user.email || user.user_id}</option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value)} style={fieldStyle}>
                <option value="__no_change__">No change</option>
                <option value="0">Unassigned</option>
                <option value="1">1 Urgent</option>
                <option value="2">2 End of day</option>
                <option value="3">3 Few days</option>
                <option value="4">4 This week</option>
                <option value="5">5 Later</option>
              </select>
            </label>
            <label style={labelStyle}>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={fieldStyle}>
                <option value="__no_change__">No change</option>
                <option value="Pending">Pending</option>
                <option value="In Progress">In Progress</option>
                <option value="Done">Done</option>
              </select>
            </label>
            <label style={labelStyle}>
              Due Date
              <select value={dueDateMode} onChange={(event) => setDueDateMode(event.target.value as "no_change" | "set" | "clear")} style={fieldStyle}>
                <option value="no_change">No change</option>
                <option value="set">Set date</option>
                <option value="clear">Clear date</option>
              </select>
              {dueDateMode === "set" && <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} style={fieldStyle} />}
            </label>
            <label style={labelStyle}>
              Add to Logic Gate
              <select value={targetLogicGateID} onChange={(event) => setTargetLogicGateID(event.target.value)} style={fieldStyle}>
                {sortedLogicGates.length === 0 ? (
                  <option value="">No Logic Gates</option>
                ) : sortedLogicGates.map((logicGate) => (
                  <option key={logicGate.logic_gate_id} value={logicGate.logic_gate_id}>{logicGateTitle(logicGate)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !targetLogicGateID}
              style={actionButtonStyle}
              onClick={() => {
                if (busy || !targetLogicGateID) return;
                onAddNodesToLogicGate(menu.ids, targetLogicGateID);
              }}
            >
              Add to Logic Gate
            </button>
          </>
        ) : (
          <>
            <label style={labelStyle}>
              Assignment Action
              <select value={raciAction} onChange={(event) => setRaciAction(event.target.value as "add" | "remove")} style={fieldStyle}>
                <option value="add">Add person</option>
                <option value="remove">Remove person</option>
              </select>
            </label>
            <label style={labelStyle}>
              Role
              <select value={raciRole} onChange={(event) => setRaciRole(event.target.value as CommunicationsSharedInboxRaciRole)} style={fieldStyle}>
                <option value="responsible">Responsible</option>
                <option value="accountable">Accountable</option>
                <option value="consulted">Consulted</option>
                <option value="informed">Informed</option>
              </select>
            </label>
            <label style={labelStyle}>
              Person
              <select value={raciUserID} onChange={(event) => setRaciUserID(event.target.value)} style={fieldStyle}>
                {companyUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.display_name || user.email || user.user_id}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" disabled={busy || (menu.kind === "logic_gate" && !raciUserID)} style={actionButtonStyle}>
          {busy ? "Applying" : "Apply"}
        </button>
      </form>
    </FrameRightClickMenu>
  );
}

type InboxMatrixViewID = Extract<HomeViewID, "aci-inbox" | "r-inbox">;

type InboxNodeDropInput = {
  logicGateID: string;
  nodeIDs: string[];
  priority: InboxPriority;
  status?: ResponsibleInboxStatus;
};

type InboxGroupResizeState = {
  key: string;
  startY: number;
  startHeight: number;
  ownerDocument: Document;
  previousCursor: string;
  previousUserSelect: string;
};

function clampInboxGroupHeight(heightPx: number): number {
  if (!Number.isFinite(heightPx)) return HOME_INBOX_GROUP_MIN_HEIGHT_PX;
  return Math.max(HOME_INBOX_GROUP_MIN_HEIGHT_PX, Math.min(HOME_INBOX_GROUP_MAX_HEIGHT_PX, Math.round(heightPx)));
}

function inboxGroupHeightsStorageKey(viewID: InboxMatrixViewID): string {
  const companyID = getActiveCompanyID().trim() || "global";
  return `${HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY}:${companyID}:${viewID}`;
}

function readInboxGroupHeights(viewID: InboxMatrixViewID): Record<string, number> {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(inboxGroupHeightsStorageKey(viewID)) ?? "{}") as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const heights: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      heights[key] = clampInboxGroupHeight(value);
    }
    return heights;
  } catch {
    return {};
  }
}

function storeInboxGroupHeights(viewID: InboxMatrixViewID, heights: Record<string, number>): void {
  if (typeof localStorage === "undefined") return;
  const cleanEntries = Object.entries(heights)
    .filter(([key, value]) => key.trim() && Number.isFinite(value))
    .map(([key, value]) => [key, clampInboxGroupHeight(value)] as const);
  const storageKey = inboxGroupHeightsStorageKey(viewID);
  if (cleanEntries.length === 0) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(Object.fromEntries(cleanEntries)));
}

function inboxGroupResizeKey(cellKey: string, group: InboxLogicGateNodeGroup): string {
  return `${cellKey}:${group.logicGateID || group.label}`;
}

function useInboxGroupCardHeights(viewID: InboxMatrixViewID): {
  groupHeights: Record<string, number>;
  startGroupResize: (key: string, event: React.PointerEvent<HTMLDivElement>) => void;
} {
  const [groupHeights, setGroupHeights] = useState<Record<string, number>>(() => readInboxGroupHeights(viewID));
  const groupHeightsRef = useRef(groupHeights);
  const resizeRef = useRef<InboxGroupResizeState | null>(null);

  useEffect(() => {
    groupHeightsRef.current = groupHeights;
  }, [groupHeights]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      event.preventDefault();
      const nextHeight = clampInboxGroupHeight(state.startHeight + event.clientY - state.startY);
      setGroupHeights((previous) => {
        if (previous[state.key] === nextHeight) return previous;
        const next = { ...previous, [state.key]: nextHeight };
        groupHeightsRef.current = next;
        return next;
      });
    };
    const finishResize = () => {
      const state = resizeRef.current;
      if (!state) return;
      resizeRef.current = null;
      state.ownerDocument.body.style.cursor = state.previousCursor;
      state.ownerDocument.body.style.userSelect = state.previousUserSelect;
      storeInboxGroupHeights(viewID, groupHeightsRef.current);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
    return () => {
      finishResize();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };
  }, [viewID]);

  const startGroupResize = useCallback((key: string, event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const ownerDocument = event.currentTarget.ownerDocument;
    const card = event.currentTarget.closest("[data-inbox-logic-gate-group-card='true']") as HTMLElement | null;
    const startHeight = clampInboxGroupHeight(card?.getBoundingClientRect().height ?? groupHeightsRef.current[key] ?? HOME_INBOX_GROUP_MIN_HEIGHT_PX);
    resizeRef.current = {
      key,
      startY: event.clientY,
      startHeight,
      ownerDocument,
      previousCursor: ownerDocument.body.style.cursor,
      previousUserSelect: ownerDocument.body.style.userSelect,
    };
    ownerDocument.body.style.cursor = "row-resize";
    ownerDocument.body.style.userSelect = "none";
    setGroupHeights((previous) => {
      if (previous[key] === startHeight) return previous;
      const next = { ...previous, [key]: startHeight };
      groupHeightsRef.current = next;
      return next;
    });
  }, []);

  return { groupHeights, startGroupResize };
}

function inboxCollapsedGroupsStorageKey(viewID: InboxMatrixViewID): string {
  const companyID = getActiveCompanyID().trim() || "global";
  return `${HOME_INBOX_GROUP_COLLAPSED_STORAGE_KEY_PREFIX}:${companyID}:${viewID}`;
}

function readInboxCollapsedGroups(viewID: InboxMatrixViewID): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const parsed = JSON.parse(localStorage.getItem(inboxCollapsedGroupsStorageKey(viewID)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0));
  } catch {
    return new Set();
  }
}

function storeInboxCollapsedGroups(viewID: InboxMatrixViewID, collapsed: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  const storageKey = inboxCollapsedGroupsStorageKey(viewID);
  const values = Array.from(collapsed).filter((item) => item.trim());
  if (values.length === 0) {
    localStorage.removeItem(storageKey);
    return;
  }
  localStorage.setItem(storageKey, JSON.stringify(values));
}

function useInboxGroupCollapsedState(viewID: InboxMatrixViewID): {
  collapsedGroupKeys: Set<string>;
  toggleCollapsedGroup: (key: string) => void;
} {
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => readInboxCollapsedGroups(viewID));

  useEffect(() => {
    setCollapsedGroupKeys(readInboxCollapsedGroups(viewID));
  }, [viewID]);

  const toggleCollapsedGroup = useCallback((key: string) => {
    const cleanKey = key.trim();
    if (!cleanKey) return;
    setCollapsedGroupKeys((previous) => {
      const next = new Set(previous);
      if (next.has(cleanKey)) next.delete(cleanKey);
      else next.add(cleanKey);
      storeInboxCollapsedGroups(viewID, next);
      return next;
    });
  }, [viewID]);

  return { collapsedGroupKeys, toggleCollapsedGroup };
}

function nodeEditorPopupMaxSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1180, height: 820 };
  return {
    width: Math.max(NODE_EDITOR_POPUP_MIN_WIDTH, window.innerWidth - NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET),
    height: Math.max(NODE_EDITOR_POPUP_MIN_HEIGHT, window.innerHeight - NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET),
  };
}

function clampNodeEditorPopupSize(size: { width: number; height: number }): { width: number; height: number } {
  const max = nodeEditorPopupMaxSize();
  return {
    width: Math.max(NODE_EDITOR_POPUP_MIN_WIDTH, Math.min(Math.round(size.width), max.width)),
    height: Math.max(NODE_EDITOR_POPUP_MIN_HEIGHT, Math.min(Math.round(size.height), max.height)),
  };
}

function nodeEditorPopupSizeStorageKey(): string {
  const companyID = getActiveCompanyID().trim() || "global";
  return `${NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX}:${companyID}`;
}

function readStoredNodeEditorPopupSize(): { width: number; height: number } | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(nodeEditorPopupSizeStorageKey()) ?? "") as Partial<{ width: number; height: number }>;
    const width = parsed.width;
    const height = parsed.height;
    if (typeof width !== "number" || typeof height !== "number") return null;
    return clampNodeEditorPopupSize({ width, height });
  } catch {
    return null;
  }
}

function storeNodeEditorPopupSize(size: { width: number; height: number }) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(nodeEditorPopupSizeStorageKey(), JSON.stringify(clampNodeEditorPopupSize(size)));
}

function defaultNodeEditorPopupSize(): { width: number; height: number } {
  return readStoredNodeEditorPopupSize() ?? clampNodeEditorPopupSize({ width: 1180, height: 820 });
}

export function NodeEditorPopup({ nodeID, nodeTitle, onClose, onCollapseToTab }: {
  nodeID: string;
  nodeTitle: string;
  onClose: () => void;
  onCollapseToTab?: () => void;
}) {
  const [popupSize, setPopupSize] = useState(defaultNodeEditorPopupSize);
  const popupSizeRef = useRef(popupSize);

  useEffect(() => {
    popupSizeRef.current = popupSize;
  }, [popupSize]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const onResize = () => setPopupSize((current) => clampNodeEditorPopupSize(current));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const startPopupResize = useCallback((event: React.PointerEvent<HTMLDivElement>, handle: NodeEditorPopupResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startY = event.clientY;
    const startSize = popupSizeRef.current;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = handle.cursor;

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const nextSize = clampNodeEditorPopupSize({
        width: startSize.width + (pointerEvent.clientX - startX) * handle.horizontal,
        height: startSize.height + (pointerEvent.clientY - startY) * handle.vertical,
      });
      popupSizeRef.current = nextSize;
      setPopupSize(nextSize);
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeNodeEditorPopupSize(popupSizeRef.current);
    };

    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, []);

  return (
    <div
      style={nodeEditorPopupBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${nodeTitle} node editor`}
        data-frame-interactive="true"
        style={{ ...nodeEditorPopupStyle, width: popupSize.width, height: popupSize.height }}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
      >
        {NODE_EDITOR_POPUP_RESIZE_HANDLES.map((handle) => (
          <div
            key={handle.key}
            role="separator"
            aria-label={`Resize node editor ${handle.key}`}
            data-frame-interactive="true"
            onPointerDown={(event) => startPopupResize(event, handle)}
            style={{
              position: "absolute",
              zIndex: 9,
              touchAction: "none",
              cursor: handle.cursor,
              background: "transparent",
              ...handle.style,
            }}
          />
        ))}
        {onCollapseToTab && (
          <button
            type="button"
            title="Collapse node editor to app tab"
            aria-label="Collapse node editor to app tab"
            onClick={onCollapseToTab}
            style={nodeEditorPopupCollapseButtonStyle}
          >
            <MinimizeToLineIcon />
          </button>
        )}
        <button
          type="button"
          title="Close node editor"
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
        <React.Suspense fallback={<div aria-busy="true" style={{ width: "100%", height: "100%", background: "#ffffff" }} />}>
          <LazyHomeNodeEditorContent
            accent="#ff8820"
            widgetId={`communications-node-editor-overlay:${nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={nodeID}
            forcedLabel={nodeTitle}
          />
        </React.Suspense>
      </div>
    </div>
  );
}

export function HomeNavButton({ label, active, depth = 0, meta, onClick }: {
  label: string;
  active: boolean;
  depth?: number;
  meta?: React.ReactNode;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button type="button" style={{ ...navButtonStyle(active), paddingLeft: 10 + depth * 14 }} onClick={onClick}>
      <span style={navLabelStyle}>{label}</span>
      {meta}
    </button>
  );
}

function readSharedTriageFolderDrag(dataTransfer: DataTransfer): string {
  return dataTransfer.getData(SHARED_TRIAGE_FOLDER_DRAG_MIME).trim();
}

function getSharedTriageDropPlacement(event: React.DragEvent<HTMLElement>): SharedInboxDropPlacement {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = event.clientY - rect.top;
  if (y < rect.height * 0.25) return "before";
  if (y > rect.height * 0.75) return "after";
  return "inside";
}

export function HomeSidebar({
  activeViewID,
  connectedAccountEmail,
  sharedInboxes,
  loadingSharedInboxes,
  newSharedInboxName,
  busy,
  notificationSummary,
  onSelectView,
  onOpenMentionNotification,
  onNewSharedInboxNameChange,
  onSubmitSharedInbox,
  onCreateSharedInbox,
  onRenameSharedInbox,
  onSetSharedInboxAccountEmail,
  onMoveSharedInbox,
  onDeleteSharedInbox,
}: {
  activeViewID: HomeViewID;
  connectedAccountEmail?: string;
  sharedInboxes: CommunicationsSharedInbox[];
  loadingSharedInboxes: boolean;
  newSharedInboxName: string;
  busy: string;
  notificationSummary: NotificationSummary;
  onSelectView: (viewID: HomeViewID, mailbox?: EmailMailbox) => void;
  onOpenMentionNotification: (notification: NotificationItem) => void;
  onNewSharedInboxNameChange: (value: string) => void;
  onSubmitSharedInbox: (event: React.FormEvent<HTMLFormElement>) => void;
  onCreateSharedInbox: (parentFolderID: string, name?: string, accountEmail?: string) => Promise<CommunicationsSharedInbox | null>;
  onRenameSharedInbox: (folderID: string, name: string) => Promise<void>;
  onSetSharedInboxAccountEmail: (folderID: string, accountEmail: string) => Promise<void>;
  onMoveSharedInbox: (folderID: string, parentFolderID: string, position: number) => Promise<void>;
  onDeleteSharedInbox: (folderID: string) => Promise<void>;
}) {
  const [sharedRootOpen, setSharedRootOpen] = useState(true);
  const [expandedSharedFolderIDs, setExpandedSharedFolderIDs] = useState<Set<string>>(new Set());
  const [selectedSharedTreeIDs, setSelectedSharedTreeIDs] = useState<Set<string>>(new Set());
  const [sharedSelectionAnchorTreeID, setSharedSelectionAnchorTreeID] = useState("");
  const [renamingSharedFolderID, setRenamingSharedFolderID] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [draggingSharedFolderID, setDraggingSharedFolderID] = useState("");
  const [dropTarget, setDropTarget] = useState<{ folderID: string; placement: SharedInboxDropPlacement } | null>(null);
  const [sharedContextMenu, setSharedContextMenu] = useState<{ x: number; y: number; folder: CommunicationsSharedInbox | null } | null>(null);
  const [sharedEmailDialog, setSharedEmailDialog] = useState<{ folder: CommunicationsSharedInbox; draft: string; error: string } | null>(null);
  const [mentionNotificationMenu, setMentionNotificationMenu] = useState<InboxNotificationMenuState | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedEmailInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);
  const cleanConnectedAccountEmail = connectedAccountEmail?.trim().toLowerCase() ?? "";
  const sharedRows = useMemo(() => sharedRootOpen ? buildSharedInboxRows(sharedInboxes, expandedSharedFolderIDs) : [], [expandedSharedFolderIDs, sharedInboxes, sharedRootOpen]);
  const sharedBusy = busy === "shared-inbox";
  const mentionUnreadCount = notificationCountForType(notificationSummary, "mention.created");

  useEffect(() => {
    setExpandedSharedFolderIDs((previous) => {
      if (previous.size > 0 || sharedInboxes.length === 0) return previous;
      return new Set(sharedInboxes.filter((folder) => !folder.parent_folder_id).map((folder) => folder.folder_id));
    });
  }, [sharedInboxes]);

  useEffect(() => {
    const activeFolderID = activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length) : "";
    if (!activeFolderID) return;
    setSharedRootOpen(true);
    setExpandedSharedFolderIDs((previous) => {
      const next = new Set(previous);
      let current = sharedInboxes.find((folder) => folder.folder_id === activeFolderID);
      let changed = false;
      const seen = new Set<string>();
      while (current?.parent_folder_id && !seen.has(current.parent_folder_id)) {
        seen.add(current.parent_folder_id);
        if (!next.has(current.parent_folder_id)) {
          next.add(current.parent_folder_id);
          changed = true;
        }
        current = sharedInboxes.find((folder) => folder.folder_id === current?.parent_folder_id);
      }
      return changed ? next : previous;
    });
  }, [activeViewID, sharedInboxes]);

  useEffect(() => {
    if (!renamingSharedFolderID) return;
    window.setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  }, [renamingSharedFolderID]);

  useEffect(() => {
    if (!sharedEmailDialog) return;
    window.setTimeout(() => {
      sharedEmailInputRef.current?.focus();
      sharedEmailInputRef.current?.select();
    }, 0);
  }, [sharedEmailDialog?.folder.folder_id]);

  useEffect(() => {
    if (activeViewID.startsWith("shared:")) return;
    setSelectedSharedTreeIDs((previous) => previous.size === 0 ? previous : new Set());
    setSharedSelectionAnchorTreeID("");
  }, [activeViewID]);

  const toggleSharedFolder = useCallback((folderID: string) => {
    setExpandedSharedFolderIDs((previous) => {
      const next = new Set(previous);
      if (next.has(folderID)) next.delete(folderID);
      else next.add(folderID);
      return next;
    });
  }, []);

  const startSharedRename = useCallback((folder: CommunicationsSharedInbox) => {
    setSharedContextMenu(null);
    skipRenameBlurRef.current = false;
    setRenamingSharedFolderID(folder.folder_id);
    setRenameDraft(folder.name);
  }, []);

  const commitSharedRename = useCallback(async () => {
    const folderID = renamingSharedFolderID.trim();
    const name = renameDraft.trim();
    if (!folderID) return;
    const current = sharedInboxes.find((folder) => folder.folder_id === folderID);
    setRenamingSharedFolderID("");
    setRenameDraft("");
    if (!name || name === current?.name) return;
    await onRenameSharedInbox(folderID, name);
  }, [onRenameSharedInbox, renameDraft, renamingSharedFolderID, sharedInboxes]);

  const createSharedFolder = useCallback(async (parentFolderID: string) => {
    setSharedContextMenu(null);
    const folder = await onCreateSharedInbox(parentFolderID, "New Folder");
    if (!folder) return;
    if (parentFolderID) {
      setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
    }
    setSharedRootOpen(true);
    setRenamingSharedFolderID(folder.folder_id);
    setRenameDraft(folder.name);
  }, [onCreateSharedInbox]);

  const setSharedFolderAccountEmail = useCallback(async (folderID: string, accountEmail: string) => {
    setSharedContextMenu(null);
    await onSetSharedInboxAccountEmail(folderID, accountEmail);
  }, [onSetSharedInboxAccountEmail]);

  const openSharedEmailDialog = useCallback((folder: CommunicationsSharedInbox) => {
    setSharedContextMenu(null);
    setSharedEmailDialog({
      folder,
      draft: (folder.account_email ?? cleanConnectedAccountEmail).trim().toLowerCase(),
      error: "",
    });
  }, [cleanConnectedAccountEmail]);

  const submitSharedEmailDialog = useCallback(() => {
    if (!sharedEmailDialog || sharedBusy) return;
    const accountEmail = sharedEmailDialog.draft.trim().toLowerCase();
    if (!isValidSharedInboxEmail(accountEmail)) {
      setSharedEmailDialog((current) => current ? { ...current, error: "Enter a valid email address." } : current);
      return;
    }
    const folderID = sharedEmailDialog.folder.folder_id;
    setSharedEmailDialog(null);
    void setSharedFolderAccountEmail(folderID, accountEmail);
  }, [setSharedFolderAccountEmail, sharedBusy, sharedEmailDialog]);

  const requestDeleteSharedFolder = useCallback(async (folder: CommunicationsSharedInbox) => {
    setSharedContextMenu(null);
    const count = collectSharedInboxSubtreeIDs(sharedInboxes, folder.folder_id).size || 1;
    const label = folder.name.trim() || "this folder";
    const detail = count === 1 ? "this folder" : `this folder and ${count - 1} child folder${count === 2 ? "" : "s"}`;
    if (!window.confirm(`Delete ${detail}: ${label}?`)) return;
    await onDeleteSharedInbox(folder.folder_id);
  }, [onDeleteSharedInbox, sharedInboxes]);

  const openSharedContextMenu = useCallback((event: React.MouseEvent, folder: CommunicationsSharedInbox | null) => {
    event.preventDefault();
    event.stopPropagation();
    setSharedContextMenu({ x: event.clientX, y: event.clientY, folder });
  }, []);

  const selectSharedFolderRow = useCallback((row: SharedInboxTreeRow, event?: React.MouseEvent) => {
    const orderedIDs = sharedRows.map((item) => item.treeID);
    const selected = resolveExplorerClickSelection({
      orderedIDs,
      previousSelectedIDs: selectedSharedTreeIDs,
      anchorID: sharedSelectionAnchorTreeID,
      clickedID: row.treeID,
      shiftKey: !!event?.shiftKey,
      ctrlKey: !!event?.ctrlKey || !!event?.metaKey,
    });
    if (selected.selectedIDs.size === 0) selected.selectedIDs.add(row.treeID);
    const orderedSelectedIDs = orderedIDs.filter((id) => selected.selectedIDs.has(id));
    const nextSelectedIDs = orderedSelectedIDs.length > 0 ? orderedSelectedIDs : [row.treeID];
    setSelectedSharedTreeIDs(new Set(nextSelectedIDs));
    setSharedSelectionAnchorTreeID(selected.anchorID);
    const primaryTreeID = (selected.selectedIDs.has(row.treeID) ? row.treeID : nextSelectedIDs[0]) ?? row.treeID;
    onSelectView(primaryTreeID as HomeViewID, "primary");
  }, [onSelectView, selectedSharedTreeIDs, sharedRows, sharedSelectionAnchorTreeID]);

  const canDropSharedFolder = useCallback((sourceFolderID: string, targetFolderID: string) => {
    if (!sourceFolderID || sourceFolderID === targetFolderID) return false;
    if (targetFolderID && isSharedInboxFolderDescendant(sharedInboxes, sourceFolderID, targetFolderID)) return false;
    return sharedInboxes.some((folder) => folder.folder_id === sourceFolderID);
  }, [sharedInboxes]);

  const moveSharedFolder = useCallback(async (sourceFolderID: string, targetFolderID: string, placement: SharedInboxDropPlacement) => {
    if (!canDropSharedFolder(sourceFolderID, targetFolderID)) return;
    let parentFolderID = "";
    let position = getSharedInboxChildPosition(sharedInboxes, "", sourceFolderID);
    if (targetFolderID) {
      const target = sharedInboxes.find((folder) => folder.folder_id === targetFolderID);
      if (!target) return;
      if (placement === "inside") {
        parentFolderID = target.folder_id;
        position = getSharedInboxChildPosition(sharedInboxes, target.folder_id, sourceFolderID);
        setExpandedSharedFolderIDs((previous) => new Set(previous).add(target.folder_id));
      } else {
        parentFolderID = target.parent_folder_id ?? "";
        position = getSharedInboxSiblingPosition(sharedInboxes, sourceFolderID, target.folder_id, placement);
      }
    }
    setDropTarget(null);
    await onMoveSharedInbox(sourceFolderID, parentFolderID, position);
  }, [canDropSharedFolder, onMoveSharedInbox, sharedInboxes]);

  const handleRootDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
    if (!canDropSharedFolder(sourceFolderID, "")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ folderID: "", placement: "inside" });
  }, [canDropSharedFolder, draggingSharedFolderID]);

  const handleRootDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
    if (!canDropSharedFolder(sourceFolderID, "")) return;
    event.preventDefault();
    void moveSharedFolder(sourceFolderID, "", "inside");
  }, [canDropSharedFolder, draggingSharedFolderID, moveSharedFolder]);

  const openMentionNotifications = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      title: "@ Mentions",
      loading: true,
      error: "",
      items: [],
    };
    setMentionNotificationMenu(nextMenu);
    fetchNotifications({ companyID: getActiveCompanyID(), type: "mention.created", unreadOnly: true, limit: 100 })
      .then((items) => {
        setMentionNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, items }
            : current
        ));
      })
      .catch((error) => {
        setMentionNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load @ mentions" }
            : current
        ));
      });
  }, []);

  const openMentionNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setMentionNotificationMenu((current) => current ? { ...current, items: current.items.filter((item) => item.notification_id !== notificationID) } : current);
      void markNotificationRead(notificationID, true).catch((error) => console.error("Failed to clear @ mention notification", error));
    }
    setMentionNotificationMenu(null);
    onOpenMentionNotification(notification);
  }, [onOpenMentionNotification]);

  const renderSharedRow = (row: SharedInboxTreeRow) => {
    const folder = row.folder;
    const isRenaming = renamingSharedFolderID === folder.folder_id;
    const active = activeViewID === row.treeID || selectedSharedTreeIDs.has(row.treeID);
    const rowDropPlacement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : null;
    const folderHasAccess = folder.effective_access_level !== "no_access";
    return (
      <div
        key={folder.folder_id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming && !sharedBusy && folderHasAccess}
        style={sharedInboxFolderRowStyle(row.depth, active, rowDropPlacement)}
        onClick={(event) => {
          if (!folderHasAccess) {
            if (row.hasChildren) toggleSharedFolder(folder.folder_id);
            return;
          }
          selectSharedFolderRow(row, event);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          if (!folderHasAccess) {
            if (row.hasChildren) toggleSharedFolder(folder.folder_id);
            return;
          }
          selectSharedFolderRow(row);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (folderHasAccess) startSharedRename(folder);
        }}
        onContextMenu={(event) => {
          if (!folderHasAccess) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          openSharedContextMenu(event, folder);
        }}
        onDragStart={(event) => {
          if (sharedBusy || !folderHasAccess) {
            event.preventDefault();
            return;
          }
          setDraggingSharedFolderID(folder.folder_id);
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData(SHARED_TRIAGE_FOLDER_DRAG_MIME, folder.folder_id);
          event.dataTransfer.setData("text/plain", folder.name);
        }}
        onDragOver={(event) => {
          const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
          const placement = getSharedTriageDropPlacement(event);
          if (!canDropSharedFolder(sourceFolderID, folder.folder_id)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropTarget({ folderID: folder.folder_id, placement });
        }}
        onDragLeave={() => {
          setDropTarget((current) => current?.folderID === folder.folder_id ? null : current);
        }}
        onDrop={(event) => {
          const sourceFolderID = readSharedTriageFolderDrag(event.dataTransfer) || draggingSharedFolderID;
          const placement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : getSharedTriageDropPlacement(event);
          if (!canDropSharedFolder(sourceFolderID, folder.folder_id)) return;
          event.preventDefault();
          void moveSharedFolder(sourceFolderID, folder.folder_id, placement);
        }}
        onDragEnd={() => {
          setDraggingSharedFolderID("");
          setDropTarget(null);
        }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            title={expandedSharedFolderIDs.has(folder.folder_id) ? "Collapse folder" : "Expand folder"}
            draggable={false}
            style={sharedInboxDisclosureButtonStyle}
            onClick={(event) => {
              event.stopPropagation();
              toggleSharedFolder(folder.folder_id);
            }}
          >
            <ExplorerDisclosureIcon open={expandedSharedFolderIDs.has(folder.folder_id)} color="rgba(36, 18, 10, 0.62)" />
          </button>
        ) : (
          <span style={{ width: 18, height: 20 }} />
        )}
        <ExplorerRowIcon kind="folder" />
        {isRenaming ? (
          <input
            ref={renameInputRef}
            style={sharedInboxRenameInputStyle}
            value={renameDraft}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                void commitSharedRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                skipRenameBlurRef.current = true;
                setRenamingSharedFolderID("");
                setRenameDraft("");
              }
            }}
            onBlur={() => {
              if (skipRenameBlurRef.current) {
                skipRenameBlurRef.current = false;
                return;
              }
              void commitSharedRename();
            }}
          />
        ) : (
          <span style={sharedInboxLabelStackStyle}>
            <span style={navLabelStyle}>{folder.name}</span>
            {folder.account_email && <span style={sharedInboxAccountMetaStyle}>{folder.account_email}</span>}
          </span>
        )}
      </div>
    );
  };

  return (
    <aside style={sidebarStyle}>
      <nav className="mango-home-scroll" style={sidebarNavStyle} aria-label="Home triage">
        <HomeNavButton label="My Triage" active={activeViewID === "my-triage" || activeViewID === "primary"} onClick={() => onSelectView("my-triage", "primary")} />
        <section style={sidebarSectionStyle}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) 24px",
              gap: 0,
              minWidth: 0,
              borderRadius: 6,
              boxShadow: dropTarget?.folderID === "" ? `inset 0 0 0 2px ${homeColorWithAlpha(HOME_CYAN, 0.35)}` : undefined,
            }}
            onContextMenu={(event) => openSharedContextMenu(event, null)}
            onDragOver={handleRootDragOver}
            onDragLeave={() => setDropTarget((current) => current?.folderID === "" ? null : current)}
            onDrop={handleRootDrop}
          >
            <button
              type="button"
              style={{
                ...navButtonStyle(activeViewID === "shared-root" || activeViewID.startsWith("shared:")),
                minHeight: 30,
                paddingLeft: 8,
              }}
              onClick={() => onSelectView("shared-root", "primary")}
            >
              <span style={navLabelStyle}>Shared Triage</span>
              {loadingSharedInboxes && <span style={navMetaStyle}>Loading</span>}
            </button>
            <button
              type="button"
              title={sharedRootOpen ? "Collapse Shared Triage folders" : "Expand Shared Triage folders"}
              aria-label={sharedRootOpen ? "Collapse Shared Triage folders" : "Expand Shared Triage folders"}
              style={sharedInboxDisclosureButtonStyle}
              onClick={(event) => {
                event.stopPropagation();
                setSharedRootOpen((open) => !open);
              }}
            >
              <ExplorerDisclosureIcon open={sharedRootOpen} color="rgba(36, 18, 10, 0.62)" />
            </button>
          </div>
          {sharedRootOpen && (
            <div style={sharedInboxRowsStyle}>
              {sharedRows.map(renderSharedRow)}
            </div>
          )}
          <form style={sharedInboxCreateStyle} onSubmit={onSubmitSharedInbox}>
            <input
              style={sharedInboxInputStyle}
              value={newSharedInboxName}
              onChange={(event) => onNewSharedInboxNameChange(event.target.value)}
              placeholder="New shared triage"
            />
            <button style={sharedInboxCreateButtonStyle} disabled={busy === "shared-inbox" || !newSharedInboxName.trim()} aria-label="Create Shared Triage">+</button>
          </form>
        </section>
        <HomeNavButton label="ACIO Nodes" active={activeViewID === "aci-inbox"} onClick={() => onSelectView("aci-inbox", "all")} />
        <HomeNavButton label="R Nodes" active={activeViewID === "r-inbox"} onClick={() => onSelectView("r-inbox", "all")} />
        <HomeNavButton
          label="@ Mentions"
          active={mentionNotificationMenu !== null}
          meta={<span style={mentionNotificationBadgeStyle}>{formatInboxNotificationCount(mentionUnreadCount)}</span>}
          onClick={openMentionNotifications}
        />
        <HomeNavButton label="My Nodes" active={activeViewID === "my-nodes"} onClick={() => onSelectView("my-nodes", "all")} />
        <HomeNavButton label="My Logic Gates" active={activeViewID === "my-logic-gates"} onClick={() => onSelectView("my-logic-gates", "all")} />
      </nav>
      {sharedContextMenu && (
        <FrameRightClickMenu x={sharedContextMenu.x} y={sharedContextMenu.y} onClose={() => setSharedContextMenu(null)}>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            disabled={sharedBusy}
            onClick={() => void createSharedFolder(sharedContextMenu.folder?.folder_id ?? "")}
          >
            {sharedContextMenu.folder ? "New Child Folder" : "New Folder"}
          </button>
          {sharedContextMenu.folder && (
            <>
              <button
                type="button"
                style={sharedInboxContextMenuButtonStyle}
                disabled={sharedBusy}
                onClick={() => openSharedEmailDialog(sharedContextMenu.folder!)}
              >
                Assign email to inbox
              </button>
              {sharedContextMenu.folder.account_email && (
                <button
                  type="button"
                  style={sharedInboxContextMenuButtonStyle}
                  disabled={sharedBusy}
                  onClick={() => void setSharedFolderAccountEmail(sharedContextMenu.folder!.folder_id, "")}
                >
                  Detach Email
                </button>
              )}
              <button
                type="button"
                style={sharedInboxContextMenuButtonStyle}
                onClick={() => startSharedRename(sharedContextMenu.folder!)}
              >
                Rename
              </button>
              <button
                type="button"
                style={{ ...sharedInboxContextMenuButtonStyle, color: "#8b123f" }}
                disabled={sharedBusy}
                onClick={() => void requestDeleteSharedFolder(sharedContextMenu.folder!)}
              >
                Delete
              </button>
            </>
          )}
        </FrameRightClickMenu>
      )}
      {sharedEmailDialog && (
        <SharedInboxEmailDialog
          inputRef={sharedEmailInputRef}
          folderName={sharedEmailDialog.folder.name}
          draft={sharedEmailDialog.draft}
          error={sharedEmailDialog.error}
          busy={sharedBusy}
          onDraftChange={(draft) => setSharedEmailDialog((current) => current ? { ...current, draft, error: "" } : current)}
          onCancel={() => setSharedEmailDialog(null)}
          onSubmit={submitSharedEmailDialog}
        />
      )}
      <InboxNotificationMenu menu={mentionNotificationMenu} onClose={() => setMentionNotificationMenu(null)} onOpen={openMentionNotificationTarget} />
    </aside>
  );
}

function SharedInboxEmailDialog({ inputRef, folderName, draft, error, busy, onDraftChange, onSubmit, onCancel }: {
  inputRef: React.RefObject<HTMLInputElement>;
  folderName: string;
  draft: string;
  error: string;
  busy: boolean;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const label = folderName.trim() || "this inbox";
  return (
    <div style={deleteModalBackdropStyle} onPointerDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Assign email to inbox"
        style={deleteModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700 }}>Assign email to inbox</div>
        <div style={deleteModalDetailStyle}>Type down the email that you want to use here.</div>
        <label style={{ display: "grid", gap: 5, minWidth: 0, fontSize: 11, fontWeight: 700 }}>
          <span>{label}</span>
          <input
            ref={inputRef}
            type="email"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="name@example.com"
            disabled={busy}
            style={inputStyle}
          />
        </label>
        {error && <div style={{ color: "#8b123f", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onCancel} style={smallButtonStyle}>Cancel</button>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? "Saving" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}

const SHARED_INBOX_RACI_ROLES: ReadonlyArray<{ role: CommunicationsSharedInboxRaciRole; label: string; help: string }> = [
  { role: "responsible", label: "Triage", help: "Can triage and archive" },
  { role: "accountable", label: "Manage", help: "Can triage and archive" },
  { role: "consulted", label: "Collaborate", help: "Can view and comment" },
  { role: "informed", label: "View", help: "Can view and comment" },
];

function companyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return user.display_name?.trim() || user.email?.trim() || user.user_id;
}

function sharedInboxRaciAssignmentLabel(
  assignment: { user_id: string; user_display_name?: string; user_email?: string },
  userByID: Map<string, CompanyUser>,
): string {
  const user = userByID.get(assignment.user_id);
  return assignment.user_display_name?.trim() || assignment.user_email?.trim() || (user ? companyUserLabel(user) : assignment.user_id);
}

export function SharedInboxRaciSettingsModal({
  folder,
  companyUsers,
  busy,
  onAddUser,
  onRemoveUser,
  onClose,
}: {
  folder: CommunicationsSharedInbox;
  companyUsers: CompanyUser[];
  busy: boolean;
  onAddUser: (folderID: string, role: CommunicationsSharedInboxRaciRole, userID: string) => void;
  onRemoveUser: (folderID: string, role: CommunicationsSharedInboxRaciRole, userID: string) => void;
  onClose: () => void;
}) {
  const [draftByRole, setDraftByRole] = useState<Record<CommunicationsSharedInboxRaciRole, string>>({
    responsible: "",
    accountable: "",
    consulted: "",
    informed: "",
  });
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id, user])), [companyUsers]);
  const assignments = folder.raci_assignments ?? [];
  const updateDraft = (role: CommunicationsSharedInboxRaciRole, value: string) => {
    setDraftByRole((previous) => ({ ...previous, [role]: value }));
  };

  return (
    <div style={sharedRaciBackdropStyle}>
      <section style={sharedRaciModalStyle} aria-modal="true" role="dialog" aria-label={`${folder.name} access settings`}>
        <div style={panelHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <h2 style={panelTitleStyle}>{folder.name} Access</h2>
            <div style={mutedSmallStyle}>Triage and Manage can archive. Collaborate and View are view/comment only.</div>
          </div>
          <button type="button" style={smallButtonStyle} disabled={busy} onClick={onClose}>Close</button>
        </div>
        <div style={sharedRaciRoleGridStyle}>
          {SHARED_INBOX_RACI_ROLES.map(({ role, label, help }) => {
            const roleAssignments = assignments.filter((assignment) => assignment.role === role);
            const assignedIDs = new Set(roleAssignments.map((assignment) => assignment.user_id));
            const selectableUsers = companyUsers.filter((user) => !assignedIDs.has(user.user_id));
            const draft = draftByRole[role];
            return (
              <section key={role} style={sharedRaciRoleColumnStyle}>
                <div style={{ display: "grid", gap: 2 }}>
                  <strong style={{ fontSize: 12 }}>{label}</strong>
                  <span style={mutedSmallStyle}>{help}</span>
                </div>
                <div style={sharedRaciChipListStyle}>
                  {roleAssignments.length === 0 ? (
                    <span style={mutedSmallStyle}>No one assigned</span>
                  ) : roleAssignments.map((assignment) => {
                    const inherited = assignment.folder_id !== folder.folder_id;
                    return (
                      <span key={`${role}:${assignment.folder_id}:${assignment.user_id}`} style={sharedRaciChipStyle}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sharedInboxRaciAssignmentLabel(assignment, userByID)}
                        </span>
                        {inherited ? (
                          <span style={mutedSmallStyle}>Inherited</span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Remove ${sharedInboxRaciAssignmentLabel(assignment, userByID)} from ${label}`}
                            style={shortcutRemoveStyle}
                            disabled={busy}
                            onClick={() => onRemoveUser(folder.folder_id, role, assignment.user_id)}
                          >
                            X
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div style={sharedRaciAddRowStyle}>
                  <select
                    style={sharedRaciSelectStyle}
                    value={draft}
                    disabled={busy || selectableUsers.length === 0}
                    onChange={(event) => updateDraft(role, event.target.value)}
                  >
                    <option value="">{selectableUsers.length === 0 ? "All users added" : "Add user"}</option>
                    {selectableUsers.map((user) => (
                      <option key={user.user_id} value={user.user_id}>{companyUserLabel(user)}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    style={smallButtonStyle}
                    disabled={busy || !draft}
                    onClick={() => {
                      onAddUser(folder.folder_id, role, draft);
                      updateDraft(role, "");
                    }}
                  >
                    Add
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const sharedRaciBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(20, 10, 4, 0.22)",
};

const sharedRaciModalStyle: React.CSSProperties = {
  width: "min(920px, calc(100vw - 40px))",
  maxHeight: "min(620px, calc(100vh - 40px))",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 12,
  padding: 14,
  border: "1px solid rgba(255, 136, 32, 0.3)",
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 18px 44px rgba(36, 18, 10, 0.22)",
  overflow: "hidden",
};

const sharedRaciRoleGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
  gap: 10,
  overflow: "auto",
};

const sharedRaciRoleColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 240,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: 10,
  padding: 10,
  border: "1px solid rgba(255, 136, 32, 0.2)",
  borderRadius: 8,
  background: "#fffaf4",
};

const sharedRaciChipListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 6,
  overflow: "auto",
};

const sharedRaciChipStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  padding: "3px 4px 3px 8px",
  border: "1px solid rgba(255, 136, 32, 0.2)",
  borderRadius: 6,
  background: "#ffffff",
  fontSize: 11,
  fontWeight: 600,
};

const sharedRaciAddRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
  minWidth: 0,
};

const sharedRaciSelectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(255, 136, 32, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#24120a",
  font: "inherit",
  fontSize: 11,
  padding: "0 6px",
};

export function MessagePlacementIcon({ message, active }: { message: EmailMessage; active: boolean }) {
  const count = message.logic_gate_count ?? message.logic_gate_ids?.length ?? 0;
  if (count > 0) {
    return (
      <span style={messagePlacementIconStyle(active)} title={count === 1 ? "Sent to a Logic Gate" : `Sent to ${count} Logic Gates`}>
        <ExplorerRowIcon kind="logic_gate" />
      </span>
    );
  }
  return <span style={messageSelectDotStyle(active, message.unread)} title="Not sent to a Logic Gate" />;
}

type MyLogicGateGroup = {
  key: string;
  label: string;
  logicGates: LogicGateRecord[];
};

export function HomeColumnResizeHandle({
  dividerIndex,
  onPointerDown,
}: {
  dividerIndex: 0 | 1 | 2;
  onPointerDown: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Resize Home column ${dividerIndex + 1}`}
      style={columnResizeHandleStyle}
      onPointerDown={(event) => onPointerDown(dividerIndex, event)}
    >
      <span style={columnResizeGripStyle} />
    </button>
  );
}

export function useRailTopResize(storageKey: string, fallbackHeight = 240) {
  const railRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number; availableHeight: number } | null>(null);
  const [topHeight, setTopHeight] = useState(() => readRailTopHeight(storageKey, fallbackHeight));

  useEffect(() => {
    saveRailTopHeight(storageKey, topHeight);
  }, [storageKey, topHeight]);

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const maxTopHeight = Math.max(120, drag.availableHeight - HOME_ROW_RESIZER_HEIGHT - 160);
      setTopHeight(clampNumber(drag.startHeight + event.clientY - drag.startY, 96, maxTopHeight));
    };
    const onPointerUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const startResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const availableHeight = railRef.current?.clientHeight ?? window.innerHeight;
    dragRef.current = { startY: event.clientY, startHeight: topHeight, availableHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [topHeight]);

  return { railRef, topHeight, startResize };
}

export function readRailTopHeight(storageKey: string, fallbackHeight: number): number {
  try {
    const stored = Number(localStorage.getItem(storageKey));
    return Number.isFinite(stored) ? clampNumber(stored, 96, 520) : fallbackHeight;
  } catch {
    return fallbackHeight;
  }
}

export function saveRailTopHeight(storageKey: string, height: number): void {
  try {
    localStorage.setItem(storageKey, String(Math.round(height)));
  } catch {}
}

export function RailRowResizeHandle({ onPointerDown }: { onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => void }) {
  return (
    <button
      type="button"
      aria-label="Resize rail sections"
      style={railRowResizeHandleStyle}
      onPointerDown={onPointerDown}
    >
      <span style={railRowResizeGripStyle} />
    </button>
  );
}

export function LogicGateRail({
  loading,
  logicGateByID,
  folders,
  folderItems,
  allRows,
  selectedRowIDs,
  expandedRowIDs,
  search,
  myGroups,
  busy,
  getLogicGateDragIDs,
  shortcutLogicGateIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectShortcut,
  onOpenLogicGate,
  onAddShortcuts,
  onRemoveShortcut,
  onConvertMessages,
  onCreateLogicGate,
}: {
  loading: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  folders: CompanyExplorerFolder[];
  folderItems: CompanyExplorerFolderItem[];
  allRows: ExplorerTreeNode[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  myGroups: MyLogicGateGroup[];
  busy: boolean;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  shortcutLogicGateIDs: Set<string>;
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onAddShortcuts: (payload: ExplorerDragPayload | null) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
  onCreateLogicGate: (options?: { assignCurrentUser?: boolean }) => void;
}) {
  const railSplit = useRailTopResize(HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, 240);
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [createContextMenu, setCreateContextMenu] = useState<{ x: number; y: number; assignCurrentUser: boolean } | null>(null);
  const openCreateLogicGateMenu = useCallback((event: React.MouseEvent, assignCurrentUser: boolean) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCreateContextMenu({ x: event.clientX, y: event.clientY, assignCurrentUser });
  }, []);

  return (
    <>
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section
        style={logicGateRailSectionStyle}
        onContextMenu={(event) => openCreateLogicGateMenu(event, true)}
        onDragOver={(event) => {
          if (!hasExplorerDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const payload = readExplorerDragPayload(event.dataTransfer);
          if (logicGateIDsFromExplorerPayload(payload, folders, folderItems).length === 0) return;
          event.preventDefault();
          onAddShortcuts(payload);
        }}
      >
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div className="mango-home-scroll" style={myLogicGatesListStyle}>
          {myGroups.length === 0 ? (
            <div style={emptySmallStyle}>No assigned Logic Gates</div>
          ) : myGroups.map((group) => (
            <div key={group.key} style={myLogicGateGroupStyle}>
              <div style={myLogicGateFolderLabelStyle}>
                <ExplorerRowIcon kind="folder" />
                <span>{group.label}</span>
              </div>
              <div style={myLogicGateGridStyle}>
                {group.logicGates.map((logicGate) => (
                  <MyLogicGateTile
                    key={logicGate.logic_gate_id}
                    logicGate={logicGate}
                    selected={selectedRowIDs.has(logicGateTreeID(logicGate.logic_gate_id))}
                    busy={busy}
                    getLogicGateDragIDs={getLogicGateDragIDs}
                    logicGateByID={logicGateByID}
                    shortcut={shortcutLogicGateIDs.has(logicGate.logic_gate_id)}
                    onSelectShortcut={onSelectShortcut}
                    onOpenLogicGate={onOpenLogicGate}
                    onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                    onRemoveShortcut={onRemoveShortcut}
                    onConvertMessages={onConvertMessages}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }} onContextMenu={(event) => openCreateLogicGateMenu(event, false)}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Logic Gates</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Logic Gates"
        />
        <div className="mango-home-scroll" style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No Logic Gates</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const logicGateID = row.logicGateID ?? "";
            const logicGate = logicGateID ? logicGateByID.get(logicGateID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "logic_gate")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
                }}
                onContextMenu={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  openHomePinContextMenu(event, {
                    kind: "logic_gate",
                    id: logicGateID,
                    label: logicGateTitle(logicGate),
                  }, setPinContextMenu);
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
                onDragOver={(event) => {
                  if (row.kind !== "logic_gate" || !hasTriageMessageDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDrop={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  const messageIDs = readTriageMessageIDs(event.dataTransfer);
                  if (messageIDs.length === 0) return;
                  event.preventDefault();
                  onConvertMessages(logicGateID, messageIDs);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{logicGate?.header || row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} />
    {createContextMenu && (
      <FrameRightClickMenu x={createContextMenu.x} y={createContextMenu.y} onClose={() => setCreateContextMenu(null)}>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            const assignCurrentUser = createContextMenu.assignCurrentUser;
            setCreateContextMenu(null);
            onCreateLogicGate({ assignCurrentUser });
          }}
        >
          Create Logic Gate
        </button>
      </FrameRightClickMenu>
    )}
    </>
  );
}

export function MyLogicGateTile({
  logicGate,
  selected,
  busy,
  logicGateByID,
  getLogicGateDragIDs,
  shortcut,
  onSelectShortcut,
  onOpenLogicGate,
  onOpenPinContextMenu,
  onRemoveShortcut,
  onConvertMessages,
}: {
  logicGate: LogicGateRecord;
  selected: boolean;
  busy: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
  getLogicGateDragIDs: (logicGateID: string) => string[];
  shortcut: boolean;
  onSelectShortcut: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenPinContextMenu: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[]) => void;
}) {
  const logicGateID = logicGate.logic_gate_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectShortcut(logicGateID, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenLogicGate(logicGateID, logicGateTitle(logicGate));
      }}
      onContextMenu={(event) => onOpenPinContextMenu(event, {
        kind: "logic_gate",
        id: logicGateID,
        label: logicGateTitle(logicGate),
      })}
      onDragStart={(event) => {
        const dragIDs = getLogicGateDragIDs(logicGateID);
        setLogicGateDragData(event.dataTransfer, dragIDs, logicGateByID);
      }}
      onDragOver={(event) => {
        if (!hasTriageMessageDrag(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(event) => {
        const messageIDs = readTriageMessageIDs(event.dataTransfer);
        if (messageIDs.length === 0) return;
        event.preventDefault();
        onConvertMessages(logicGateID, messageIDs);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
      <span style={myLogicGateTileTextStyle}>{logicGateTitle(logicGate)}</span>
      {shortcut && <span
        role="button"
        tabIndex={0}
        aria-label="Remove shortcut"
        style={shortcutRemoveStyle}
        onClick={(event) => {
          event.stopPropagation();
          if (!busy) onRemoveShortcut(logicGateID);
        }}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !busy) {
            event.preventDefault();
            event.stopPropagation();
            onRemoveShortcut(logicGateID);
          }
        }}
      >
        x
      </span>}
    </button>
  );
}

export function NodeInboxRail({
  loading,
  nodeByID,
  allRows,
  myNodeGroups,
  selectedRowIDs,
  expandedRowIDs,
  search,
  getNodeDragIDs,
  onSearchChange,
  onToggleFolder,
  onSelectRow,
  onSelectNode,
  onOpenNode,
  onOpenNodeBulkMenu,
  onCreateNode,
}: {
  loading: boolean;
  nodeByID: Map<string, NodeRecord>;
  allRows: ExplorerTreeNode[];
  myNodeGroups: MyNodeGroup[];
  selectedRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  getNodeDragIDs: (nodeID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenNodeBulkMenu: (nodeID: string, event: React.MouseEvent) => void;
  onCreateNode: () => void;
}) {
  const myNodeOrderedRowIDs = useMemo(() => myNodeGroups.flatMap((group) => group.nodes.map((node) => nodeTreeID(node.node_id))), [myNodeGroups]);
  const railSplit = useRailTopResize(HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, 220);
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [createContextMenu, setCreateContextMenu] = useState<{ x: number; y: number } | null>(null);
  const openCreateNodeMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCreateContextMenu({ x: event.clientX, y: event.clientY });
  }, []);

  return (
    <>
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section style={logicGateRailSectionStyle} onContextMenu={openCreateNodeMenu}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>My Nodes (nodes assigned to me)</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <div className="mango-home-scroll" style={myLogicGatesListStyle}>
          {myNodeGroups.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No assigned nodes</div>
          ) : (
            myNodeGroups.map((group) => (
              <div key={group.key} style={myLogicGateGroupStyle}>
                <div style={myLogicGateFolderLabelStyle}>
                  <ExplorerRowIcon kind="folder" />
                  <span>{group.label}</span>
                  <span>{group.nodes.length}</span>
                </div>
                <div style={myLogicGateGridStyle}>
                  {group.nodes.map((node) => (
                    <MyNodeTile
                      key={node.node_id}
                      node={node}
                      selected={selectedRowIDs.has(nodeTreeID(node.node_id))}
                      orderedRowIDs={myNodeOrderedRowIDs}
                      nodeByID={nodeByID}
                      getNodeDragIDs={getNodeDragIDs}
                      onSelectNode={onSelectNode}
                      onOpenNode={onOpenNode}
                      onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                      onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }} onContextMenu={openCreateNodeMenu}>
        <div style={logicGateRailHeaderStyle}>
          <h2 style={panelTitleStyle}>All Nodes</h2>
          {loading && <span style={mutedSmallStyle}>Loading</span>}
        </div>
        <input
          style={inputStyle}
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search Nodes"
        />
        <div className="mango-home-scroll" style={allLogicGateRowsStyle}>
          {allRows.length === 0 && !loading ? (
            <div style={emptySmallStyle}>No nodes</div>
          ) : allRows.map((row) => {
            const selected = selectedRowIDs.has(row.id);
            const isFolder = row.kind === "folder";
            const nodeID = row.nodeID ?? "";
            const node = nodeID ? nodeByID.get(nodeID) : undefined;
            return (
              <div
                key={row.id}
                draggable
                style={logicGateTreeRowStyle(row.depth, selected, row.kind === "node")}
                onClick={(event) => onSelectRow(row, event)}
                onDoubleClick={(event) => {
                  if (row.kind !== "node" || !node) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onOpenNode(node);
                }}
                onContextMenu={(event) => {
                  if (row.kind !== "node" || !node) return;
                  onOpenNodeBulkMenu(node.node_id, event);
                }}
                onDragStart={(event) => {
                  const payload = getExplorerDragPayloadForSelection(row, selectedRowIDs, allRows);
                  if (!payload) return;
                  event.dataTransfer.effectAllowed = row.kind === "folder" ? "copyMove" : "copy";
                  event.dataTransfer.setData(EXPLORER_DRAG_MIME, JSON.stringify(payload));
                  event.dataTransfer.setData("text/plain", row.label);
                }}
              >
                {isFolder ? (
                  <button
                    type="button"
                    draggable={false}
                    style={logicGateDisclosureStyle}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleFolder(row.id);
                    }}
                  >
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(36, 18, 10, 0.62)" />
                  </button>
                ) : (
                  <span style={{ width: 18, flexShrink: 0 }} />
                )}
                <ExplorerRowIcon kind={row.kind} systemKey={row.systemKey} />
                <span style={logicGateTreeRowTextStyle}>{node ? nodeTitle(node) : row.label}</span>
              </div>
            );
          })}
        </div>
      </section>
    </aside>
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} />
    {createContextMenu && (
      <FrameRightClickMenu x={createContextMenu.x} y={createContextMenu.y} onClose={() => setCreateContextMenu(null)}>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            setCreateContextMenu(null);
            onCreateNode();
          }}
        >
          Create node
        </button>
      </FrameRightClickMenu>
    )}
    </>
  );
}

export function MyNodeTile({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenNodeBulkMenu,
  onOpenPinContextMenu,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenPinContextMenu: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
}) {
  const nodeID = node.node_id;
  return (
    <button
      type="button"
      draggable
      style={myLogicGateTileStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onContextMenu={(event) => {
        if (onOpenNodeBulkMenu) {
          onOpenNodeBulkMenu(nodeID, event);
          return;
        }
        onOpenPinContextMenu(event, {
          kind: "node",
          id: nodeID,
          label: nodeTitle(node),
        });
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={myLogicGateTileIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={myLogicGateTileTextStyle}>{nodeTitle(node)}</span>
    </button>
  );
}

function notificationCountForInboxGroup(summary: NotificationSummary, role: NotificationRaciRole, group: InboxLogicGateNodeGroup): number {
  if (!group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return 0;
  const groupNodeIDs = new Set(group.nodeIDs);
  return (summary.logic_gate_counts ?? []).reduce((count, item) => {
    if (item.logic_gate_id !== group.logicGateID || item.role !== role) return count;
    const nodeID = item.node_id?.trim() ?? "";
    if (nodeID && !groupNodeIDs.has(nodeID)) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function hasUnreadNotificationForInboxNode(summary: NotificationSummary | undefined, group: InboxLogicGateNodeGroup, nodeID: string): boolean {
  const cleanNodeID = nodeID.trim();
  if (!summary || !cleanNodeID || !group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return false;
  return (summary.logic_gate_counts ?? []).some((item) => {
    const count = typeof item.count === "number" && Number.isFinite(item.count) ? item.count : 0;
    return count > 0 && item.logic_gate_id === group.logicGateID && item.node_id?.trim() === cleanNodeID;
  });
}

function aciColumnNotificationRole(role: AciInboxRole): NotificationRaciRole | undefined {
  if (role === "accountable" || role === "consulted" || role === "informed") return role;
  return undefined;
}

function notificationCountForType(summary: NotificationSummary, type: string): number {
  const cleanType = type.trim();
  if (!cleanType) return 0;
  return (summary.type_counts ?? []).reduce((count, item) => {
    if (item.type !== cleanType) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function formatInboxNotificationCount(count: number): string {
  const normalized = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return normalized > 99 ? "99+" : String(normalized);
}

function logicGateInboxGroupNotificationButtonStyle(role: NotificationRaciRole): React.CSSProperties {
  return {
    ...logicGateInboxGroupNotificationStyle(role),
    border: logicGateInboxGroupNotificationStyle(role).border,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "0 4px",
  };
}

type InboxNotificationMenuState = {
  x: number;
  y: number;
  title: string;
  loading: boolean;
  error: string;
  items: NotificationItem[];
};

function inboxNotificationMatchesGroup(item: NotificationItem, role: NotificationRaciRole, group: InboxLogicGateNodeGroup): boolean {
  if (item.role !== role || item.logic_gate_id !== group.logicGateID) return false;
  const nodeID = item.node_id?.trim() ?? "";
  return !nodeID || group.nodeIDs.includes(nodeID);
}

function formatInboxNotificationTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) return "Now";
  if (deltaMs < 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / 60_000))}m`;
  if (deltaMs < 24 * 60 * 60_000) return `${Math.max(1, Math.floor(deltaMs / (60 * 60_000)))}h`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}

function InboxNotificationMenu({
  menu,
  onClose,
  onOpen,
}: {
  menu: InboxNotificationMenuState | null;
  onClose: () => void;
  onOpen: (notification: NotificationItem) => void;
}) {
  if (!menu) return null;
  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      <div style={inboxNotificationMenuStyle}>
        <div style={inboxNotificationMenuHeaderStyle}>{menu.title}</div>
        {menu.loading ? (
          <div style={inboxNotificationMenuEmptyStyle}>Loading</div>
        ) : menu.error ? (
          <div style={inboxNotificationMenuErrorStyle}>{menu.error}</div>
        ) : menu.items.length === 0 ? (
          <div style={inboxNotificationMenuEmptyStyle}>No unread notifications</div>
        ) : menu.items.map((notification) => (
          <button
            key={notification.notification_id}
            type="button"
            style={inboxNotificationMenuItemStyle}
            onClick={() => onOpen(notification)}
          >
            <span style={inboxNotificationMenuTitleStyle}>{notification.title}</span>
            {notification.body_preview && <span style={inboxNotificationMenuBodyStyle}>{notification.body_preview}</span>}
            <span style={inboxNotificationMenuMetaStyle}>{formatInboxNotificationTimestamp(notification.created_timestamp)}</span>
          </button>
        ))}
      </div>
    </FrameRightClickMenu>
  );
}

const inboxNotificationMenuStyle: React.CSSProperties = {
  width: 300,
  maxHeight: 360,
  display: "grid",
  alignContent: "start",
  overflowY: "auto",
  padding: "6px 0",
};

const inboxNotificationMenuHeaderStyle: React.CSSProperties = {
  padding: "5px 12px 8px",
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 11,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: 0,
};

const inboxNotificationMenuItemStyle: React.CSSProperties = {
  width: "100%",
  display: "grid",
  gap: 3,
  border: "none",
  background: "transparent",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  textAlign: "left",
  padding: "8px 12px",
};

const inboxNotificationMenuTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 750,
};

const inboxNotificationMenuBodyStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  fontWeight: 500,
};

const inboxNotificationMenuMetaStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.45)",
  fontSize: 10,
  fontWeight: 700,
};

const inboxNotificationMenuEmptyStyle: React.CSSProperties = {
  padding: "10px 12px",
  color: "rgba(36, 18, 10, 0.55)",
  fontSize: 12,
  fontWeight: 600,
};

const inboxNotificationMenuErrorStyle: React.CSSProperties = {
  ...inboxNotificationMenuEmptyStyle,
  color: "#8b123f",
};

const mentionNotificationBadgeStyle: React.CSSProperties = {
  minWidth: 22,
  height: 18,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 999,
  background: "#fff7eb",
  color: "#7c2d12",
  fontSize: 10,
  fontWeight: 800,
  padding: "0 6px",
};

export function AciInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  nodeFolders,
  nodeFolderItems,
  currentUserID,
  notificationSummary,
  selectedRowIDs,
  selectedLogicGateRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onOpenLogicGateBulkMenuAt,
  onCreateNodeInLogicGate,
  onDropNodes,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  currentUserID: string;
  notificationSummary: NotificationSummary;
  selectedRowIDs: Set<string>;
  selectedLogicGateRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate: (logicGateID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
  onOpenNodeBulkMenu: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenuAt: (logicGateID: string, x: number, y: number) => void;
  onCreateNodeInLogicGate: (input: InboxNodeDropInput) => void;
  onDropNodes: (input: InboxNodeDropInput) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildAciInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const { groupHeights, startGroupResize } = useInboxGroupCardHeights("aci-inbox");
  const { collapsedGroupKeys, toggleCollapsedGroup } = useInboxGroupCollapsedState("aci-inbox");
  const [activeDropKey, setActiveDropKey] = useState("");
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<InboxNotificationMenuState | null>(null);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of ACI_COLUMNS) {
        const groups = cellLogicGateGroups.get(aciCellKey(column.role, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const orderedLogicGateRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of ACI_COLUMNS) {
        const groups = cellLogicGateGroups.get(aciCellKey(column.role, priority.value)) ?? [];
        for (const group of groups) ids.push(group.logicGateID);
      }
    }
    return cleanIDList(ids).filter((id) => id !== INBOX_NO_LOGIC_GATE_ID).map(logicGateTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;
  const openGroupNotifications = useCallback((event: React.MouseEvent, role: NotificationRaciRole, group: InboxLogicGateNodeGroup) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      title: `${group.label} notifications`,
      loading: true,
      error: "",
      items: [],
    };
    setNotificationMenu(nextMenu);
    fetchNotifications({ companyID: getActiveCompanyID(), unreadOnly: true, limit: 100 })
      .then((items) => {
        const filtered = items.filter((item) => inboxNotificationMatchesGroup(item, role, group));
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, items: filtered }
            : current
        ));
      })
      .catch((error) => {
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load notifications" }
            : current
        ));
      });
  }, []);
  const openNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setNotificationMenu((current) => current ? { ...current, items: current.items.filter((item) => item.notification_id !== notificationID) } : current);
      void markNotificationRead(notificationID, true).catch((error) => console.error("Failed to clear notification", error));
    }
    setNotificationMenu(null);
    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    const node = nodeID ? nodeByID.get(nodeID) : undefined;
    if (node) {
      onOpenNode(node);
      return;
    }
    if (logicGateID) onOpenLogicGate(logicGateID, notification.title || logicGateID, nodeID);
  }, [nodeByID, onOpenLogicGate, onOpenNode]);

  return (
    <>
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>ACIO Nodes</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(ACI_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {ACI_COLUMNS.map((column) => (
            <div key={column.role} style={logicGateRaciColumnHeaderStyle}>
              <strong style={logicGateRaciColumnLetterStyle}>{column.letter}</strong>
              <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
            </div>
          ))}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {ACI_COLUMNS.map((column) => {
                const cellKey = aciCellKey(column.role, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => {
                      const resizeKey = inboxGroupResizeKey(cellKey, group);
                      const notificationRole = aciColumnNotificationRole(column.role);
                      return (
                        <LogicGateInboxNodeGroupCard
                          key={group.logicGateID}
                          group={group}
                          selectedRowIDs={selectedRowIDs}
                          selectedLogicGate={selectedLogicGateRowIDs.has(logicGateTreeID(group.logicGateID))}
                          orderedLogicGateRowIDs={orderedLogicGateRowIDs}
                          orderedRowIDs={orderedRowIDs}
                          nodeByID={nodeByID}
                          nodeFolders={nodeFolders}
                          nodeFolderItems={nodeFolderItems}
                          getNodeDragIDs={getNodeDragIDs}
                          onSelectNode={onSelectNode}
                          onSelectLogicGate={onSelectLogicGate}
                          onOpenNode={onOpenNode}
                          onOpenLogicGate={onOpenLogicGate}
                          onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                          onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
                          onOpenLogicGateBulkMenuAt={onOpenLogicGateBulkMenuAt}
                          onCreateNode={() => onCreateNodeInLogicGate({ logicGateID: group.logicGateID, nodeIDs: [], priority: priority.value })}
                          onDropNodes={(nodeIDs) => onDropNodes({ logicGateID: group.logicGateID, nodeIDs, priority: priority.value })}
                          dropActive={activeDropKey === resizeKey}
                          onDropActiveChange={(active) => setActiveDropKey(active ? resizeKey : "")}
                          notificationSummary={notificationSummary}
                          notificationCount={notificationRole ? notificationCountForInboxGroup(notificationSummary, notificationRole, group) : 0}
                          notificationRole={notificationRole}
                          onOpenNotifications={notificationRole ? (event) => openGroupNotifications(event, notificationRole, group) : undefined}
                          resizeKey={resizeKey}
                          heightPx={groupHeights[resizeKey]}
                          onStartResize={startGroupResize}
                          collapsed={collapsedGroupKeys.has(resizeKey)}
                          onToggleCollapsed={() => toggleCollapsedGroup(resizeKey)}
                          onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} />
    <InboxNotificationMenu menu={notificationMenu} onClose={() => setNotificationMenu(null)} onOpen={openNotificationTarget} />
    </>
  );
}

export function ResponsibleInboxMatrix({
  loading,
  nodes,
  nodeByID,
  logicGateByID,
  nodeFolders,
  nodeFolderItems,
  currentUserID,
  notificationSummary,
  selectedRowIDs,
  selectedLogicGateRowIDs,
  getNodeDragIDs,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onOpenLogicGateBulkMenuAt,
  onCreateNodeInLogicGate,
  onDropNodes,
}: {
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  currentUserID: string;
  notificationSummary: NotificationSummary;
  selectedRowIDs: Set<string>;
  selectedLogicGateRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate: (logicGateID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
  onOpenNodeBulkMenu: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenuAt: (logicGateID: string, x: number, y: number) => void;
  onCreateNodeInLogicGate: (input: InboxNodeDropInput) => void;
  onDropNodes: (input: InboxNodeDropInput) => void;
}) {
  const cellLogicGateGroups = useMemo(() => buildResponsibleInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID), [currentUserID, logicGateByID, nodeByID, nodes]);
  const { groupHeights, startGroupResize } = useInboxGroupCardHeights("r-inbox");
  const { collapsedGroupKeys, toggleCollapsedGroup } = useInboxGroupCollapsedState("r-inbox");
  const [activeDropKey, setActiveDropKey] = useState("");
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<InboxNotificationMenuState | null>(null);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RESPONSIBLE_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(responsibleCellKey(column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups]);
  const orderedLogicGateRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RESPONSIBLE_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(responsibleCellKey(column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(group.logicGateID);
      }
    }
    return cleanIDList(ids).filter((id) => id !== INBOX_NO_LOGIC_GATE_ID).map(logicGateTreeID);
  }, [cellLogicGateGroups]);
  const placedCount = orderedRowIDs.length;
  const openGroupNotifications = useCallback((event: React.MouseEvent, role: NotificationRaciRole, group: InboxLogicGateNodeGroup) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      title: `${group.label} notifications`,
      loading: true,
      error: "",
      items: [],
    };
    setNotificationMenu(nextMenu);
    fetchNotifications({ companyID: getActiveCompanyID(), unreadOnly: true, limit: 100 })
      .then((items) => {
        const filtered = items.filter((item) => inboxNotificationMatchesGroup(item, role, group));
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, items: filtered }
            : current
        ));
      })
      .catch((error) => {
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load notifications" }
            : current
        ));
      });
  }, []);
  const openNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setNotificationMenu((current) => current ? { ...current, items: current.items.filter((item) => item.notification_id !== notificationID) } : current);
      void markNotificationRead(notificationID, true).catch((error) => console.error("Failed to clear notification", error));
    }
    setNotificationMenu(null);
    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    const node = nodeID ? nodeByID.get(nodeID) : undefined;
    if (node) {
      onOpenNode(node);
      return;
    }
    if (logicGateID) onOpenLogicGate(logicGateID, notification.title || logicGateID, nodeID);
  }, [nodeByID, onOpenLogicGate, onOpenNode]);

  return (
    <>
    <section style={logicGateRaciPanelStyle}>
      <div style={logicGateRaciHeaderStyle}>
        <h2 style={panelTitleStyle}>R Nodes</h2>
        <div style={logicGateRaciMetaStyle}>
          {placedCount > 0 && <span>{placedCount} active</span>}
          {loading && <span>Loading</span>}
        </div>
      </div>
      <div className="kanban-board-scroll" style={logicGateRaciScrollStyle}>
        <div style={inboxMatrixGridStyle(RESPONSIBLE_STATUS_COLUMNS.length)}>
          <div style={logicGateRaciCornerStyle} />
          {RESPONSIBLE_STATUS_COLUMNS.map((column) => {
            const statusColor = responsibleStatusColor(column.status);
            return (
              <div key={column.status} style={logicGateRaciColumnHeaderStyle}>
                <strong style={{ ...logicGateRaciColumnLetterStyle, borderColor: statusColor, background: homeColorWithAlpha(statusColor, 0.12), color: statusColor }}>{column.letter}</strong>
                <span style={logicGateRaciColumnLabelStyle}>{column.label}</span>
              </div>
            );
          })}
          {INBOX_PRIORITIES.map((priority) => (
            <React.Fragment key={priority.value}>
              <div style={logicGateRaciPriorityHeaderStyle}>{priority.label}</div>
              {RESPONSIBLE_STATUS_COLUMNS.map((column) => {
                const cellKey = responsibleCellKey(column.status, priority.value);
                const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                const statusColor = responsibleStatusColor(column.status);
                return (
                  <div key={cellKey} style={logicGateRaciCellStyle(false)}>
                    {logicGateGroups.map((group) => {
                      const resizeKey = inboxGroupResizeKey(cellKey, group);
                      return (
                        <LogicGateInboxNodeGroupCard
                          key={group.logicGateID}
                          group={group}
                          selectedRowIDs={selectedRowIDs}
                          selectedLogicGate={selectedLogicGateRowIDs.has(logicGateTreeID(group.logicGateID))}
                          orderedLogicGateRowIDs={orderedLogicGateRowIDs}
                          orderedRowIDs={orderedRowIDs}
                          nodeByID={nodeByID}
                          nodeFolders={nodeFolders}
                          nodeFolderItems={nodeFolderItems}
                          getNodeDragIDs={getNodeDragIDs}
                          onSelectNode={onSelectNode}
                          onSelectLogicGate={onSelectLogicGate}
                          onOpenNode={onOpenNode}
                          onOpenLogicGate={onOpenLogicGate}
                          onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                          onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
                          onOpenLogicGateBulkMenuAt={onOpenLogicGateBulkMenuAt}
                          onCreateNode={() => onCreateNodeInLogicGate({ logicGateID: group.logicGateID, nodeIDs: [], priority: priority.value, status: column.status })}
                          onDropNodes={(nodeIDs) => onDropNodes({ logicGateID: group.logicGateID, nodeIDs, priority: priority.value, status: column.status })}
                          dropActive={activeDropKey === resizeKey}
                          onDropActiveChange={(active) => setActiveDropKey(active ? resizeKey : "")}
                          notificationSummary={notificationSummary}
                          notificationCount={notificationCountForInboxGroup(notificationSummary, "responsible", group)}
                          notificationRole="responsible"
                          onOpenNotifications={(event) => openGroupNotifications(event, "responsible", group)}
                          groupColor={statusColor}
                          resizeKey={resizeKey}
                          heightPx={groupHeights[resizeKey]}
                          onStartResize={startGroupResize}
                          collapsed={collapsedGroupKeys.has(resizeKey)}
                          onToggleCollapsed={() => toggleCollapsedGroup(resizeKey)}
                          onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} />
    <InboxNotificationMenu menu={notificationMenu} onClose={() => setNotificationMenu(null)} onOpen={openNotificationTarget} />
    </>
  );
}

export function LogicGateInboxNodeGroupCard({
  group,
  selectedRowIDs,
  selectedLogicGate = false,
  orderedLogicGateRowIDs = [],
  orderedRowIDs,
  nodeByID,
  nodeFolders = [],
  nodeFolderItems = [],
  getNodeDragIDs,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onOpenLogicGateBulkMenuAt,
  onCreateNode,
  onDropNodes,
  dropActive = false,
  onDropActiveChange,
  notificationSummary,
  notificationCount = 0,
  notificationRole,
  onOpenNotifications,
  groupColor,
  canRemoveNode,
  onRemovePlacement,
  resizeKey,
  heightPx,
  onStartResize,
  collapsed = false,
  onToggleCollapsed,
  onOpenPinContextMenu,
}: {
  group: InboxLogicGateNodeGroup;
  selectedRowIDs: Set<string>;
  selectedLogicGate?: boolean;
  orderedLogicGateRowIDs?: string[];
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  nodeFolders?: CompanyExplorerFolder[];
  nodeFolderItems?: CompanyExplorerFolderItem[];
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate?: (logicGateID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenuAt?: (logicGateID: string, x: number, y: number) => void;
  onCreateNode?: () => void;
  onDropNodes?: (nodeIDs: string[]) => void;
  dropActive?: boolean;
  onDropActiveChange?: (active: boolean) => void;
  notificationSummary?: NotificationSummary;
  notificationCount?: number;
  notificationRole?: NotificationRaciRole;
  onOpenNotifications?: (event: React.MouseEvent) => void;
  groupColor?: string;
  canRemoveNode?: (nodeID: string) => boolean;
  onRemovePlacement?: (nodeID: string) => void;
  resizeKey?: string;
  heightPx?: number;
  onStartResize?: (key: string, event: React.PointerEvent<HTMLDivElement>) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onOpenPinContextMenu?: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
}) {
  const canOpenLogicGate = group.logicGateID !== INBOX_NO_LOGIC_GATE_ID;
  const firstNodeID = group.nodeIDs[0] ?? "";
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectedNodeIDsForMenu = useMemo(() => cleanIDList(Array.from(selectedRowIDs).map(nodeIDFromTreeID)).filter((nodeID) => nodeByID.has(nodeID)), [nodeByID, selectedRowIDs]);
  const explicitHeight = !collapsed && typeof heightPx === "number" && Number.isFinite(heightPx);
  const groupStyleBase = explicitHeight
    ? { ...logicGateInboxGroupStyle, height: clampInboxGroupHeight(heightPx), gridTemplateRows: "30px minmax(0, 1fr)" }
    : collapsed
      ? { ...logicGateInboxGroupStyle, gridTemplateRows: "30px" }
      : logicGateInboxGroupStyle;
  const columnTint = groupColor ? homeColorWithAlpha(groupColor, 0.08) : undefined;
  const groupStyle = {
    ...groupStyleBase,
    border: selectedLogicGate ? `1px solid ${HOME_CYAN}` : dropActive ? `1px solid ${HOME_CYAN}` : groupColor ? `1px solid ${groupColor}` : groupStyleBase.border,
    background: columnTint ?? groupStyleBase.background,
    boxShadow: selectedLogicGate
      ? `0 0 0 2px ${homeColorWithAlpha(HOME_CYAN, 0.16)} inset`
      : dropActive
        ? `0 0 0 2px ${homeColorWithAlpha(HOME_CYAN, 0.20)} inset`
        : groupStyleBase.boxShadow,
  };
  const nodeListStyle = explicitHeight
    ? { ...logicGateInboxNodeListStyle, maxHeight: "none" }
    : logicGateInboxNodeListStyle;
  const readDroppedNodeIDs = (dataTransfer: DataTransfer): string[] => {
    if (!hasExplorerDrag(dataTransfer)) return [];
    return nodeIDsFromExplorerPayload(readExplorerDragPayload(dataTransfer), nodeFolders, nodeFolderItems)
      .filter((nodeID) => nodeByID.has(nodeID));
  };
  const openGroupContextMenu = (event: React.MouseEvent) => {
    if (!canOpenLogicGate) return;
    event.preventDefault();
    event.stopPropagation();
    setGroupContextMenu({ x: event.clientX, y: event.clientY });
  };
  return (
    <div
      data-inbox-logic-gate-group-card="true"
      style={groupStyle}
      onContextMenu={openGroupContextMenu}
      onDragOver={(event) => {
        if (!canOpenLogicGate || !onDropNodes || readDroppedNodeIDs(event.dataTransfer).length === 0) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        onDropActiveChange?.(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropActiveChange?.(false);
      }}
      onDrop={(event) => {
        const nodeIDs = readDroppedNodeIDs(event.dataTransfer);
        onDropActiveChange?.(false);
        if (!canOpenLogicGate || !onDropNodes || nodeIDs.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onDropNodes(nodeIDs);
      }}
    >
      <div
        role="button"
        tabIndex={canOpenLogicGate ? 0 : -1}
        title={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        aria-label={canOpenLogicGate ? `Open ${group.label} in Logic Gate Arena` : group.label}
        style={logicGateInboxGroupHeaderStyle(canOpenLogicGate, groupColor)}
        onClick={(event) => {
          event.stopPropagation();
          if (canOpenLogicGate) onSelectLogicGate?.(group.logicGateID, orderedLogicGateRowIDs, event);
        }}
        onContextMenu={(event) => {
          if (!canOpenLogicGate) return;
          if (onOpenLogicGateBulkMenu && !onCreateNode && !onOpenLogicGateBulkMenuAt) {
            onOpenLogicGateBulkMenu(group.logicGateID, event);
            return;
          }
          openGroupContextMenu(event);
        }}
        onDoubleClick={(event) => {
          if (!canOpenLogicGate) return;
          event.preventDefault();
          event.stopPropagation();
          onOpenLogicGate(group.logicGateID, group.label, firstNodeID);
        }}
      >
        <ExplorerRowIcon kind="logic_gate" />
        <span style={logicGateInboxGroupTitleStyle}>{group.label}</span>
        {notificationCount > 0 && notificationRole && (
          <button
            type="button"
            title="Show notifications"
            aria-label="Show notifications"
            style={logicGateInboxGroupNotificationButtonStyle(notificationRole)}
            onClick={(event) => onOpenNotifications?.(event)}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {formatInboxNotificationCount(notificationCount)}
          </button>
        )}
        {onToggleCollapsed && (
          <button
            type="button"
            title={collapsed ? "Expand node list" : "Collapse node list"}
            aria-label={collapsed ? "Expand node list" : "Collapse node list"}
            style={{ ...logicGateInboxGroupCountStyle, minWidth: 18, cursor: "pointer" }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleCollapsed();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {collapsed ? "+" : "-"}
          </button>
        )}
        <span style={logicGateInboxGroupCountStyle}>{group.nodeIDs.length}</span>
      </div>
      {!collapsed && <div className="kanban-board-scroll" style={nodeListStyle}>
        {group.nodeIDs.map((nodeID) => {
          const node = nodeByID.get(nodeID);
          if (!node) return null;
          return (
            <LogicGateInboxNodeRow
              key={nodeID}
              node={node}
              selected={selectedRowIDs.has(nodeTreeID(nodeID))}
              orderedRowIDs={orderedRowIDs}
              nodeByID={nodeByID}
              getNodeDragIDs={getNodeDragIDs}
              onSelectNode={onSelectNode}
              onOpenNode={onOpenNode}
              onOpenNodeBulkMenu={onOpenNodeBulkMenu}
              onOpenPinContextMenu={onOpenPinContextMenu}
              onRemovePlacement={canRemoveNode?.(nodeID) ? onRemovePlacement : undefined}
              hasUnreadNotification={hasUnreadNotificationForInboxNode(notificationSummary, group, nodeID)}
            />
          );
        })}
      </div>}
      {!collapsed && resizeKey && onStartResize && (
        <div
          title="Resize Logic Gate card"
          onPointerDown={(event) => onStartResize(resizeKey, event)}
          style={logicGateInboxGroupResizeHandleStyle}
        >
          <span style={logicGateInboxGroupResizeGripStyle} />
        </div>
      )}
      {groupContextMenu && (
        <FrameRightClickMenu x={groupContextMenu.x} y={groupContextMenu.y} onClose={() => setGroupContextMenu(null)}>
          {onCreateNode && (
            <button
              type="button"
              style={sharedInboxContextMenuButtonStyle}
              onClick={() => {
                setGroupContextMenu(null);
                onCreateNode();
              }}
            >
              Create node
            </button>
          )}
          {onDropNodes && selectedNodeIDsForMenu.length > 0 && (
            <button
              type="button"
              style={sharedInboxContextMenuButtonStyle}
              onClick={() => {
                const nodeIDs = selectedNodeIDsForMenu;
                setGroupContextMenu(null);
                onDropNodes(nodeIDs);
              }}
            >
              Add selected node{selectedNodeIDsForMenu.length === 1 ? "" : "s"}
            </button>
          )}
          {onOpenLogicGateBulkMenuAt && (
            <button
              type="button"
              style={sharedInboxContextMenuButtonStyle}
              onClick={() => {
                const { x, y } = groupContextMenu;
                setGroupContextMenu(null);
                onOpenLogicGateBulkMenuAt(group.logicGateID, x, y);
              }}
            >
              Edit Logic Gate assignments
            </button>
          )}
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              requestAppSidebarPin({ kind: "logic_gate", id: group.logicGateID, label: group.label });
              setGroupContextMenu(null);
            }}
          >
            Pin Logic Gate
          </button>
        </FrameRightClickMenu>
      )}
    </div>
  );
}

export function LogicGateInboxNodeRow({
  node,
  selected,
  orderedRowIDs,
  nodeByID,
  getNodeDragIDs,
  onSelectNode,
  onOpenNode,
  onOpenNodeBulkMenu,
  onOpenPinContextMenu,
  onRemovePlacement,
  hasUnreadNotification = false,
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenPinContextMenu?: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
  onRemovePlacement?: (nodeID: string) => void;
  hasUnreadNotification?: boolean;
}) {
  const nodeID = node.node_id;
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      style={logicGateInboxNodeRowStyle(selected)}
      onClick={(event) => onSelectNode(nodeID, orderedRowIDs, event)}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onOpenNode(node);
      }}
      onContextMenu={(event) => {
        if (onOpenNodeBulkMenu) {
          onOpenNodeBulkMenu(nodeID, event);
          return;
        }
        onOpenPinContextMenu?.(event, {
          kind: "node",
          id: nodeID,
          label: nodeTitle(node),
        });
      }}
      onDragStart={(event) => {
        const dragIDs = getNodeDragIDs(nodeID);
        setNodeDragData(event.dataTransfer, dragIDs, nodeByID);
      }}
    >
      <span style={logicGateInboxNodeGuideStyle} />
      <span style={logicGateInboxNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={logicGateInboxNodeTitleStyle(hasUnreadNotification)}>{nodeTitle(node)}</span>
      {onRemovePlacement ? (
        <button
          type="button"
          aria-label={`Remove ${nodeTitle(node)} from ACIO nodes`}
          style={logicGateInboxNodeRemoveStyle}
          onClick={(event) => {
            event.stopPropagation();
            onRemovePlacement(nodeID);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          x
        </button>
      ) : (
        <span style={logicGateInboxNodeStatusStyle(node.status)}>{responsibleStatusLetter(node.status)}</span>
      )}
    </div>
  );
}

export function ComposePanel({ compose, busy, onChange, onCancel, onSubmit }: {
  compose: ComposeState;
  busy: boolean;
  onChange: (next: ComposeState) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const update = (patch: Partial<ComposeState>) => onChange({ ...compose, ...patch });
  return (
    <form style={composeStyle} onSubmit={onSubmit}>
      <div style={panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.replyToMessageID ? "Reply" : "New Message"}</h2>
        <button type="button" style={smallButtonStyle} onClick={onCancel}>Close</button>
      </div>
      <input style={inputStyle} value={compose.to} onChange={(event) => update({ to: event.target.value })} placeholder="To" />
      <input style={inputStyle} value={compose.cc} onChange={(event) => update({ cc: event.target.value })} placeholder="Cc" />
      <input style={inputStyle} value={compose.bcc} onChange={(event) => update({ bcc: event.target.value })} placeholder="Bcc" />
      <input style={inputStyle} value={compose.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="Subject" />
      <textarea style={textareaStyle} value={compose.body} onChange={(event) => update({ body: event.target.value })} placeholder="Message" />
      <button style={primaryButtonStyle} disabled={busy}>{busy ? "Sending" : "Send"}</button>
    </form>
  );
}

export function MessageDetail({ message, loading, archiveAvailable, archiveLabel, busy, deleteAvailable, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  loading: boolean;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: boolean;
  deleteAvailable: boolean;
  onReply: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
}) {
  const messageDate = formatMessageDate(message.date);
  return (
    <div style={detailStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          <div style={mutedSmallStyle}>From {formatAddressList(message.from) || "Unknown sender"} to {formatAddressList(message.to) || "me"}</div>
          {messageDate && <div style={mutedSmallStyle}>{messageDate}</div>}
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      <div style={toolbarStyle}>
        <button style={smallButtonStyle} disabled={busy} onClick={onReply}>Reply</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
        <button style={smallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
        <button style={smallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>{archiveLabel}</button>
        <button style={{ ...smallButtonStyle, ...dangerButtonStyle }} disabled={busy || !deleteAvailable} onClick={onDelete}>Delete</button>
      </div>
      <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={iframeStyle} />
    </div>
  );
}

export function DeleteMessagesConfirmationModal({ count, busy, onConfirm, onCancel }: {
  count: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={deleteModalBackdropStyle}>
      <div style={deleteModalStyle}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {count === 1 ? "Are you sure you want to delete this?" : `Are you sure you want to delete these ${count} emails?`}
        </div>
        <div style={deleteModalDetailStyle}>
          This deletes the selected email{count === 1 ? "" : "s"} from your mailbox immediately.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onConfirm} style={{ border: "1px solid rgba(255,136,32,0.45)", background: "#ffffff", color: "#111111", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            {busy ? "Deleting" : "Yes"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel} style={{ border: "1px solid #ff3d7f", boxShadow: "inset 0 0 0 1px rgba(255,130,170,0.25), 0 0 10px rgba(255,61,127,0.18)", color: "#8b123f", background: "#ffffff", cursor: busy ? "not-allowed" : "pointer", fontWeight: 700 }}>
            No
          </button>
        </div>
      </div>
    </div>
  );
}


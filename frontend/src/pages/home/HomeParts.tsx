import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { NotificationPopover } from "../../app/NotificationPopover";
import { buildLogicGateRoute, buildNodeRoute, buildProjectRoute } from "../../app/deepLinkRoutes";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { requestAppSidebarPin, type SidebarPinKind } from "../../app/sidebarPins";
import { MinimizeToLineIcon, NODE_EDITOR_POPUP_RESIZE_HANDLES, type NodeEditorPopupResizeHandle } from "../../app/nodeEditorPopupControls";
import { HeaderRecycleBinIcon } from "../../app/HeaderIcons";
import { getActiveCompanyID } from "../../auth/currentCompany";
import type { BoundRequestJSON } from "../../modules/api/requestJSON";
import { downloadEmailAttachment, parseEmailAddressList, type CommunicationsSharedInbox, type CommunicationsSharedInboxGVICRole, type CommunicationsSharedInboxGVICPrincipalType, type CompanyUser, type EmailAddress, type EmailAttachment, type EmailMailbox, type EmailMessage } from "../../modules/communications/communicationsApi";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../modules/folders/companyExplorerFolders";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import { resolveExplorerClickSelection } from "../../modules/company-explorer/treePresentation";
import type { NodeRecord, NodeRelationship } from "../../modules/node-map/shared";
import { buildNodeRelationshipHierarchyRows } from "../../modules/node-map/nodeRelationshipStructure";
import type { LogicGateGVICRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { deleteNotification, fetchNotifications, type NotificationItem, type NotificationGVICRole, type NotificationSummary } from "../../modules/notifications/notificationsApi";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import { EXPLORER_DRAG_MIME, getExplorerDragPayloadForSelection, readExplorerDragPayload } from "../../modules/company-explorer/companyExplorerDragDrop";
import { HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY, HOME_INBOX_GROUP_MAX_HEIGHT_PX, HOME_INBOX_GROUP_MIN_HEIGHT_PX, HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, HOME_MY_WORK_SAVED_VIEWS_SLOT_ID, HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, HOME_ROW_RESIZER_HEIGHT, HOME_UPDATES_SAVED_VIEWS_SLOT_ID, INBOX_NO_LOGIC_GATE_ID, INBOX_PRIORITIES, GVIC_INBOX_SECTIONS, GVIC_STATUS_COLUMNS } from "./homeConstants";
import type { ComposeAttachment, ComposeState, HomeEntityDeleteTarget, HomeViewID, InboxLogicGateNodeGroup, InboxPriority, MyNodeGroup, GVICInboxRole, GVICInboxStatus } from "./homeTypes";
import { buildGVICRoleInboxGroupsByCell, buildSharedInboxRows, cleanIDList, clampNumber, collectSharedInboxSubtreeIDs, formatAddressList, formatMessageDate, getSharedInboxChildPosition, getSharedInboxSiblingPosition, hasExplorerDrag, hasTriageMessageDrag, isSharedInboxFolderDescendant, logicGateIDsFromExplorerPayload, logicGateTitle, logicGateTreeID, messageDocument, messageIsSent, messageReadStatusLabel, messageReadStatusTitle, nodeIDFromTreeID, nodeIDsFromExplorerPayload, nodeTitle, nodeTreeID, GVICRoleCellKey, readTriageMessageIDs, gvicStatusColor, setLogicGateDragData, setNodeDragData, type SharedInboxDropPlacement, type SharedInboxTreeRow } from "./homeUtils";
import { HOME_CYAN, allLogicGateRowsStyle, columnResizeGripStyle, columnResizeHandleStyle, composeStyle, dangerButtonStyle, deleteModalBackdropStyle, deleteModalDetailStyle, deleteModalStyle, detailStyle, detailSubjectStyle, emptySmallStyle, homeColorWithAlpha, iframeStyle, inboxMatrixGridStyle, inputStyle, logicGateDisclosureStyle, logicGateInboxGroupDisclosureStyle, logicGateInboxGroupHeaderStyle, logicGateInboxGroupIconStyle, logicGateInboxGroupNotificationStyle, logicGateInboxGroupResizeGripStyle, logicGateInboxGroupResizeHandleStyle, logicGateInboxGroupStyle, logicGateInboxGroupTitleStyle, logicGateInboxNodeGuideStyle, logicGateInboxNodeIconStyle, logicGateInboxNodeListStyle, logicGateInboxNodeNotificationStyle, logicGateInboxNodeRemoveStyle, logicGateInboxNodeRowStyle, logicGateInboxNodeTitleStyle, logicGateGVICCellStyle, logicGateGVICColumnHeaderStyle, logicGateGVICColumnLabelStyle, logicGateGVICColumnLetterStyle, logicGateGVICCornerStyle, logicGateGVICHeaderStyle, logicGateGVICMatrixSurfaceStyle, logicGateGVICMetaStyle, logicGateGVICPanelStyle, logicGateGVICPriorityHeaderStyle, logicGateGVICScrollStyle, logicGateRailHeaderStyle, logicGateRailSectionStyle, logicGateRailStyle, logicGateTreeRowStyle, logicGateTreeRowTextStyle, mailAttachmentFileIconStyle, mailAttachmentGridStyle, mailAttachmentHeaderStyle, mailAttachmentMetaStyle, mailAttachmentNameStyle, mailAttachmentSectionStyle, mailAttachmentThumbnailStyle, mailAttachmentTileStyle, mailComposeAttachmentRemoveStyle, mailComposeAttachmentRowStyle, mailComposeOriginalFrameStyle, mailComposeOriginalStyle, mailComposeSendButtonStyle, mailComposeSignatureBoxStyle, mailComposeSignatureTextareaStyle, mailPanelInputStyle, mailPanelSmallButtonStyle, mailPanelTextareaStyle, messagePlacementIconStyle, messageReadStatusStyle, messageSelectDotStyle, messageTimestampStatusRowStyle, mutedSmallStyle, myLogicGateFolderLabelStyle, myLogicGateGridStyle, myLogicGateGroupStyle, myLogicGateTileIconStyle, myLogicGateTileStyle, myLogicGateTileTextStyle, myLogicGatesListStyle, navButtonStyle, navLabelStyle, navMetaStyle, nodeEditorPopupBackdropStyle, nodeEditorPopupCloseButtonStyle, nodeEditorPopupCollapseButtonStyle, nodeEditorPopupStyle, nodeInboxEmptyStyle, nodeInboxFolderLabelStyle, nodeInboxGridStyle, nodeInboxGroupCountStyle, nodeInboxGroupStyle, nodeInboxListStyle, nodeInboxMutedSmallStyle, nodeInboxOtherEmptyStyle, nodeInboxOtherListStyle, nodeInboxOtherMutedSmallStyle, nodeInboxOtherPanelTitleStyle, nodeInboxOtherSectionStyle, nodeInboxPanelTitleStyle, nodeInboxPrimarySectionStyle, nodeInboxRailHeaderStyle, nodeInboxRailStyle, nodeInboxTileIconStyle, nodeInboxTileStyle, nodeInboxTileTextStyle, panelHeaderStyle, panelTitleStyle, primaryButtonStyle, railRowResizeGripStyle, railRowResizeHandleStyle, sharedInboxAccountMetaStyle, sharedInboxContextMenuButtonStyle, sharedInboxDisclosureButtonStyle, sharedInboxFolderRowStyle, sharedInboxLabelStackStyle, sharedInboxNameLineStyle, sharedInboxPermissionLockStyle, sharedInboxRenameInputStyle, sharedInboxRowsStyle, shortcutRemoveStyle, sidebarNavStyle, sidebarSectionStyle, sidebarStyle, smallButtonStyle, toolbarStyle } from "./homeStyles";

const SHARED_TRIAGE_FOLDER_DRAG_MIME = "application/x-mangorts-shared-triage-folder";
const HOME_INBOX_NODE_DRAG_MIME = "application/x-mangorts-home-inbox-node";
const HOME_INBOX_LOGIC_GATE_DRAG_MIME = "application/x-mangorts-home-inbox-logic-gate";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;
const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = 64;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "home-node-editor-popup-size-v1";
const HOME_INBOX_GROUP_COLLAPSED_STORAGE_KEY_PREFIX = "mangorts.communications.inboxLogicGateGroupCollapsed.v1";
const HOME_COMPACT_CONTEXT_MENU_WIDTH = 210;
const HOME_LOGIC_GATE_PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "1  URGENT(<1hr)" },
  { value: 2, label: "2  By end of day" },
  { value: 3, label: "3  Tomorrow" },
  { value: 4, label: "4  Sprint (1 week)" },
  { value: 5, label: "5  Later (low priority)" },
];

function MessageReadStatusText({ message }: { message: EmailMessage }) {
  const label = messageReadStatusLabel(message.read_status);
  if (!label) return null;
  const title = messageReadStatusTitle(message.read_status) || label;
  return <span style={messageReadStatusStyle} title={title}>{label}</span>;
}

const LazyHomeNodeEditorContent = React.lazy(() => import("../../modules/editor/EditorContent").then((module) => ({
  default: module.EditorContent as React.FC<{
    accent: string;
    widgetId?: string;
    theme?: "mango" | "teal" | "light" | "dark";
    forcedEntityKind?: "node" | "logic_gate";
    forcedEntityID?: string;
    forcedLabel?: string;
    focusInformationID?: string;
    focusRequestID?: number;
  }>,
})));

function isValidSharedInboxEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase());
}

type SharedInboxPermissionMarkerShape = CommunicationsSharedInbox & {
  default_access_level?: string;
  defaultAccess?: string;
  has_permission_rules?: boolean;
  permissions?: CommunicationsSharedInbox["access_grants"];
};

function sharedInboxHasPermissionMarker(folder: CommunicationsSharedInbox): boolean {
  const markerShape = folder as SharedInboxPermissionMarkerShape;
  const defaultAccess = String(folder.default_access ?? markerShape.default_access_level ?? markerShape.defaultAccess ?? "").trim().toLowerCase();
  const accessGrants = folder.access_grants ?? markerShape.permissions ?? [];
  return Boolean(markerShape.has_permission_rules) || defaultAccess === "no_access" || accessGrants.length > 0;
}

function SharedInboxPermissionLockIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={sharedInboxPermissionLockStyle}>
      <rect x="5" y="10" width="14" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M8 10V8a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

type HomePinContextMenuState = {
  x: number;
  y: number;
  kind: SidebarPinKind;
  id: string;
  label: string;
};

type TriageConversionPriorityMenuState = {
  x: number;
  y: number;
  logicGateID: string;
  messageIDs: string[];
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

function HomePinContextMenu({ menu, onClose, onDelete }: {
  menu: HomePinContextMenuState | null;
  onClose: () => void;
  onDelete?: (target: HomePinContextMenuState, position?: ConfirmActionMenuPosition) => void;
}) {
  if (!menu) return null;
  const openRoute = menu.kind === "logic_gate"
    ? buildLogicGateRoute(menu.id)
    : menu.kind === "project"
      ? buildProjectRoute(menu.id)
      : buildNodeRoute(menu.id);
  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      <button
        type="button"
        style={sharedInboxContextMenuButtonStyle}
        onClick={() => {
          openAppPathInNewTab(openRoute);
          onClose();
        }}
      >
        Open in new browser tab
      </button>
      <button
        type="button"
        style={sharedInboxContextMenuButtonStyle}
        onClick={() => {
          requestAppSidebarPin({ kind: menu.kind, id: menu.id, name: menu.label });
          onClose();
        }}
      >
        Pin {menu.kind === "logic_gate" ? "Logic Gate" : menu.kind === "project" ? "Project" : "Node"}
      </button>
      {onDelete && (
        <button
          type="button"
          style={{ ...sharedInboxContextMenuButtonStyle, color: "#dc2626" }}
          onClick={(event) => {
            onDelete(menu, confirmMenuPositionFromElement(event.currentTarget));
          }}
        >
          Delete
        </button>
      )}
    </FrameRightClickMenu>
  );
}

export function HomeBulkEditMenu({ menu, companyUsers, logicGates, nodeByID, busy, onClose, onApplyNodePatch, onApplyLogicGateGVIC, onAddNodesToLogicGate, onRequestDelete }: {
  menu: { x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null;
  companyUsers: CompanyUser[];
  logicGates: LogicGateRecord[];
  nodeByID: Map<string, NodeRecord>;
  busy: boolean;
  onClose: () => void;
  onApplyNodePatch: (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "priority" | "status" | "due_date">>) => void;
  onApplyLogicGateGVIC: (logicGateIDs: string[], role: CommunicationsSharedInboxGVICRole, userID: string, action: "add" | "remove") => void;
  onAddNodesToLogicGate: (nodeIDs: string[], logicGateID: string) => void;
  onRequestDelete: (kind: "node" | "logic_gate", ids: string[], position?: ConfirmActionMenuPosition) => void;
}) {
  const [priority, setPriority] = useState("__no_change__");
  const [status, setStatus] = useState("__no_change__");
  const [dueDateMode, setDueDateMode] = useState<"no_change" | "set" | "clear">("no_change");
  const [dueDate, setDueDate] = useState("");
  const [targetLogicGateID, setTargetLogicGateID] = useState("");
  const [GVICRole, setGVICRole] = useState<CommunicationsSharedInboxGVICRole>("generated");
  const [GVICUserID, setGVICUserID] = useState("");
  const [GVICAction, setGVICAction] = useState<"add" | "remove">("add");
  const sortedLogicGates = useMemo(() => [...logicGates].sort((a, b) => (
    logicGateTitle(a).localeCompare(logicGateTitle(b), undefined, { numeric: true, sensitivity: "base" })
    || a.logic_gate_id.localeCompare(b.logic_gate_id)
  )), [logicGates]);
  const logicGateByID = useMemo(() => new Map(logicGates.map((logicGate) => [logicGate.logic_gate_id, logicGate])), [logicGates]);

  useEffect(() => {
    setPriority("__no_change__");
    setStatus("__no_change__");
    setDueDateMode("no_change");
    setDueDate("");
    setTargetLogicGateID(sortedLogicGates[0]?.logic_gate_id ?? "");
    setGVICRole("generated");
    setGVICUserID(companyUsers[0]?.user_id ?? "");
    setGVICAction("add");
  }, [companyUsers, menu?.kind, menu?.ids.join("\u001f"), sortedLogicGates]);

  if (!menu) return null;
  const title = menu.kind === "node"
    ? `${menu.ids.length} node${menu.ids.length === 1 ? "" : "s"}`
    : `${menu.ids.length} Logic Gate${menu.ids.length === 1 ? "" : "s"}`;
  const fieldStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 30,
    border: "1px solid rgba(100, 116, 139, 0.24)",
    borderRadius: 6,
    background: "#ffffff",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    padding: "0 8px",
  };
  const labelStyle: React.CSSProperties = {
    display: "grid",
    gap: 4,
    minWidth: 0,
    color: "#111827",
    fontSize: 11,
    fontWeight: 700,
  };
  const actionButtonStyle: React.CSSProperties = {
    minHeight: 31,
    border: "1px solid rgba(100, 116, 139, 0.38)",
    borderRadius: 6,
    background: "#f8fafc",
    color: "#111827",
    cursor: busy ? "not-allowed" : "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 800,
  };
  const pinSelectedTargets = () => {
    if (busy) return;
    for (const id of menu.ids) {
      requestAppSidebarPin({
        kind: menu.kind,
        id,
        name: menu.kind === "node" ? nodeTitle(nodeByID.get(id)) : logicGateTitle(logicGateByID.get(id)),
      });
    }
    onClose();
  };

  return (
    <FrameRightClickMenu x={menu.x} y={menu.y} onClose={onClose}>
      <form
        style={{ width: 280, display: "grid", gap: 9, padding: "8px 10px 10px" }}
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (menu.kind === "node") {
            const patch: Partial<Pick<NodeRecord, "priority" | "status" | "due_date">> = {};
            if (priority !== "__no_change__") patch.priority = priority === "0" ? null : Number(priority);
            if (status !== "__no_change__") patch.status = status;
            if (dueDateMode === "clear") patch.due_date = null;
            if (dueDateMode === "set") patch.due_date = dueDate;
            if (Object.keys(patch).length > 0) onApplyNodePatch(menu.ids, patch);
            else onClose();
            return;
          }
          onApplyLogicGateGVIC(menu.ids, GVICRole, GVICUserID, GVICAction);
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <strong style={{ fontSize: 12, color: "#111827" }}>{title}</strong>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#334155", font: "inherit", fontWeight: 800 }}>x</button>
        </div>
        <button
          type="button"
          disabled={busy}
          style={actionButtonStyle}
          onClick={pinSelectedTargets}
        >
          Pin {menu.kind === "node" ? "Node" : "Logic Gate"}
        </button>
        {menu.kind === "node" ? (
          <>
            <label style={labelStyle}>
              Priority
              <select value={priority} onChange={(event) => setPriority(event.target.value)} style={fieldStyle}>
                <option value="__no_change__">No change</option>
                <option value="0">Unassigned to a Logic Gate</option>
                <option value="1">1 URGENT(&lt;1hr)</option>
                <option value="2">2 By end of day</option>
                <option value="3">3 Tomorrow</option>
                <option value="4">4 Sprint (1 week)</option>
                <option value="5">5 Later (low priority)</option>
              </select>
            </label>
            <label style={labelStyle}>
              Status
              <select value={status} onChange={(event) => setStatus(event.target.value)} style={fieldStyle}>
                <option value="__no_change__">No change</option>
                <option value="Pending">Pending</option>
                <option value="In Progress">In Progress</option>
                <option value="Review">Review</option>
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
              <select value={GVICAction} onChange={(event) => setGVICAction(event.target.value as "add" | "remove")} style={fieldStyle}>
                <option value="add">Add person</option>
                <option value="remove">Remove person</option>
              </select>
            </label>
            <label style={labelStyle}>
              Role
              <select value={GVICRole} onChange={(event) => setGVICRole(event.target.value as CommunicationsSharedInboxGVICRole)} style={fieldStyle}>
                <option value="generated">Generated</option>
                <option value="verified">Verified</option>
                <option value="consulted">Consulted</option>
                <option value="informed">Informed</option>
              </select>
            </label>
            <label style={labelStyle}>
              Person
              <select value={GVICUserID} onChange={(event) => setGVICUserID(event.target.value)} style={fieldStyle}>
                {companyUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.display_name || user.email || user.user_id}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" disabled={busy || (menu.kind === "logic_gate" && !GVICUserID)} style={actionButtonStyle}>
          {busy ? "Applying" : "Apply"}
        </button>
        <button
          type="button"
          disabled={busy}
          style={{ ...actionButtonStyle, color: "#dc2626", background: "#fff7fb", borderColor: "rgba(220, 38, 38, 0.34)" }}
          onClick={(event) => {
            if (busy) return;
            onRequestDelete(menu.kind, menu.ids, confirmMenuPositionFromElement(event.currentTarget));
          }}
        >
          Delete
        </button>
      </form>
    </FrameRightClickMenu>
  );
}

type InboxMatrixViewID = Extract<HomeViewID, "r-inbox" | "a-inbox" | "c-inbox" | "i-inbox" | "o-inbox">;

type InboxNodeDropInput = {
  logicGateID: string;
  nodeIDs: string[];
  priority: InboxPriority;
  status?: GVICInboxStatus;
  fromLogicGateID?: string;
};

type InboxCellCreateInput = {
  priority: InboxPriority;
  status?: GVICInboxStatus;
  creatorGVICRole?: LogicGateGVICRole;
};

type InboxCellNodeDropInput = InboxCellCreateInput & {
  nodeIDs: string[];
  fromLogicGateID?: string;
};

type InboxCellLogicGateDropInput = InboxCellCreateInput & {
  logicGateIDs: string[];
  nodeIDsByLogicGateID?: Record<string, string[]>;
};

type InboxNodeDragPayload = {
  nodeIDs: string[];
  fromLogicGateID?: string;
};

type InboxLogicGateDragPayload = {
  logicGateIDs: string[];
  nodeIDsByLogicGateID?: Record<string, string[]>;
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

function safeParseInboxDragPayload<T>(dataTransfer: DataTransfer, mime: string): T | null {
  try {
    const raw = dataTransfer.getData(mime);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function setInboxNodeDragPayload(dataTransfer: DataTransfer, nodeIDs: string[], fromLogicGateID?: string): void {
  const ids = cleanIDList(nodeIDs);
  if (ids.length === 0) return;
  const cleanLogicGateID = fromLogicGateID?.trim() ?? "";
  const payload: InboxNodeDragPayload = {
    nodeIDs: ids,
    fromLogicGateID: cleanLogicGateID || undefined,
  };
  dataTransfer.setData(HOME_INBOX_NODE_DRAG_MIME, JSON.stringify(payload));
}

function readInboxNodeDragPayload(dataTransfer: DataTransfer): InboxNodeDragPayload | null {
  const payload = safeParseInboxDragPayload<InboxNodeDragPayload>(dataTransfer, HOME_INBOX_NODE_DRAG_MIME);
  if (!payload) return null;
  const nodeIDs = cleanIDList(Array.isArray(payload.nodeIDs) ? payload.nodeIDs : []);
  if (nodeIDs.length === 0) return null;
  const fromLogicGateID = typeof payload.fromLogicGateID === "string" ? payload.fromLogicGateID.trim() : "";
  return { nodeIDs, fromLogicGateID: fromLogicGateID || undefined };
}

function setInboxLogicGateDragPayload(dataTransfer: DataTransfer, logicGateIDs: string[], nodeIDsByLogicGateID?: Record<string, string[]>): void {
  const ids = cleanIDList(logicGateIDs);
  if (ids.length === 0) return;
  const cleanNodeIDsByGate: Record<string, string[]> = {};
  for (const logicGateID of ids) {
    const nodeIDs = cleanIDList(nodeIDsByLogicGateID?.[logicGateID] ?? []);
    if (nodeIDs.length > 0) cleanNodeIDsByGate[logicGateID] = nodeIDs;
  }
  const payload: InboxLogicGateDragPayload = {
    logicGateIDs: ids,
    nodeIDsByLogicGateID: Object.keys(cleanNodeIDsByGate).length > 0 ? cleanNodeIDsByGate : undefined,
  };
  dataTransfer.setData(HOME_INBOX_LOGIC_GATE_DRAG_MIME, JSON.stringify(payload));
}

function readInboxLogicGateDragPayload(dataTransfer: DataTransfer): InboxLogicGateDragPayload | null {
  const payload = safeParseInboxDragPayload<InboxLogicGateDragPayload>(dataTransfer, HOME_INBOX_LOGIC_GATE_DRAG_MIME);
  if (!payload) return null;
  const logicGateIDs = cleanIDList(Array.isArray(payload.logicGateIDs) ? payload.logicGateIDs : []);
  if (logicGateIDs.length === 0) return null;
  const nodeIDsByLogicGateID: Record<string, string[]> = {};
  if (payload.nodeIDsByLogicGateID && typeof payload.nodeIDsByLogicGateID === "object") {
    for (const logicGateID of logicGateIDs) {
      const nodeIDs = cleanIDList(payload.nodeIDsByLogicGateID[logicGateID] ?? []);
      if (nodeIDs.length > 0) nodeIDsByLogicGateID[logicGateID] = nodeIDs;
    }
  }
  return {
    logicGateIDs,
    nodeIDsByLogicGateID: Object.keys(nodeIDsByLogicGateID).length > 0 ? nodeIDsByLogicGateID : undefined,
  };
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

type NodeEditorPopupRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function nodeEditorPopupViewportPadding(): { x: number; y: number } {
  return {
    x: NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET / 2,
    y: NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET / 2,
  };
}

function clampNodeEditorPopupRect(rect: NodeEditorPopupRect): NodeEditorPopupRect {
  const size = clampNodeEditorPopupSize(rect);
  if (typeof window === "undefined") {
    return { left: Math.max(0, Math.round(rect.left)), top: Math.max(0, Math.round(rect.top)), ...size };
  }
  const padding = nodeEditorPopupViewportPadding();
  const minLeft = padding.x;
  const minTop = padding.y;
  const maxLeft = Math.max(minLeft, window.innerWidth - padding.x - size.width);
  const maxTop = Math.max(minTop, window.innerHeight - padding.y - size.height);
  return {
    left: Math.max(minLeft, Math.min(Math.round(rect.left), maxLeft)),
    top: Math.max(minTop, Math.min(Math.round(rect.top), maxTop)),
    ...size,
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
  return readStoredNodeEditorPopupSize() ?? nodeEditorPopupMaxSize();
}

function defaultNodeEditorPopupRect(): NodeEditorPopupRect {
  const size = defaultNodeEditorPopupSize();
  if (typeof window === "undefined") return { left: 0, top: 0, ...size };
  return clampNodeEditorPopupRect({
    left: (window.innerWidth - size.width) / 2,
    top: (window.innerHeight - size.height) / 2,
    ...size,
  });
}

function fullscreenNodeEditorPopupRect(): NodeEditorPopupRect {
  if (typeof window === "undefined") return defaultNodeEditorPopupRect();
  const padding = nodeEditorPopupViewportPadding();
  return clampNodeEditorPopupRect({
    left: padding.x,
    top: padding.y,
    width: window.innerWidth - (padding.x * 2),
    height: window.innerHeight - (padding.y * 2),
  });
}

function NodeEditorPopupFullscreenIcon({ active = false }: { active?: boolean }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      {active ? (
        <>
          <path d="M6.2 2.2v3.6H2.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.8 13.8v-3.6h3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d="M2.6 6V2.6H6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.4 10v3.4H10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

export function NodeEditorPopup({ nodeID, nodeTitle, focusInformationID, focusRequestID, onClose, onCollapseToTab, onDeleteNode }: {
  nodeID: string;
  nodeTitle: string;
  focusInformationID?: string;
  focusRequestID?: number;
  onClose: () => void;
  onCollapseToTab?: () => void;
  onDeleteNode?: (nodeID: string, confirmationDisplayName: string) => boolean | void | Promise<boolean | void>;
}) {
  const [popupRect, setPopupRect] = useState(defaultNodeEditorPopupRect);
  const [popupFullscreen, setPopupFullscreen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ position?: ConfirmActionMenuPosition | null } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const popupRectRef = useRef(popupRect);
  const restorePopupRectRef = useRef<NodeEditorPopupRect | null>(null);

  useEffect(() => {
    popupRectRef.current = popupRect;
  }, [popupRect]);

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
    const onResize = () => setPopupRect((current) => (popupFullscreen ? fullscreenNodeEditorPopupRect() : clampNodeEditorPopupRect(current)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [popupFullscreen]);

  const togglePopupFullscreen = useCallback(() => {
    setPopupRect((current) => {
      if (popupFullscreen) {
        const restored = restorePopupRectRef.current ? clampNodeEditorPopupRect(restorePopupRectRef.current) : defaultNodeEditorPopupRect();
        restorePopupRectRef.current = null;
        popupRectRef.current = restored;
        return restored;
      }
      restorePopupRectRef.current = current;
      const next = fullscreenNodeEditorPopupRect();
      popupRectRef.current = next;
      return next;
    });
    setPopupFullscreen((current) => !current);
  }, [popupFullscreen]);

  const startPopupResize = useCallback((event: React.PointerEvent<HTMLDivElement>, handle: NodeEditorPopupResizeHandle) => {
    event.preventDefault();
    event.stopPropagation();
    const ownerDocument = event.currentTarget.ownerDocument;
    const startX = event.clientX;
    const startY = event.clientY;
    const startRect = popupRectRef.current;
    const previousCursor = ownerDocument.body.style.cursor;
    ownerDocument.body.style.cursor = handle.cursor;

    const onPointerMove = (pointerEvent: PointerEvent) => {
      const deltaX = pointerEvent.clientX - startX;
      const deltaY = pointerEvent.clientY - startY;
      const desiredWidth = handle.horizontal < 0
        ? startRect.width - deltaX
        : handle.horizontal > 0
          ? startRect.width + deltaX
          : startRect.width;
      const desiredHeight = handle.vertical < 0
        ? startRect.height - deltaY
        : handle.vertical > 0
          ? startRect.height + deltaY
          : startRect.height;
      const nextSize = clampNodeEditorPopupSize({ width: desiredWidth, height: desiredHeight });
      const nextRect = clampNodeEditorPopupRect({
        left: handle.horizontal < 0 ? startRect.left + startRect.width - nextSize.width : startRect.left,
        top: handle.vertical < 0 ? startRect.top + startRect.height - nextSize.height : startRect.top,
        ...nextSize,
      });
      popupRectRef.current = nextRect;
      setPopupRect(nextRect);
      setPopupFullscreen(false);
    };
    const finish = () => {
      ownerDocument.body.style.cursor = previousCursor;
      ownerDocument.removeEventListener("pointermove", onPointerMove);
      ownerDocument.removeEventListener("pointerup", finish);
      ownerDocument.removeEventListener("pointercancel", finish);
      storeNodeEditorPopupSize(popupRectRef.current);
    };

    ownerDocument.addEventListener("pointermove", onPointerMove);
    ownerDocument.addEventListener("pointerup", finish);
    ownerDocument.addEventListener("pointercancel", finish);
  }, []);

  const requestDeleteNode = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setDeleteConfirmation({ position: confirmMenuPositionFromElement(event.currentTarget) });
  }, []);

  const confirmDeleteNode = useCallback(async (confirmationDisplayName: string) => {
    if (!onDeleteNode || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const deleted = await onDeleteNode(nodeID, confirmationDisplayName);
      if (deleted === false) return;
      setDeleteConfirmation(null);
      onClose();
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteBusy, nodeID, onClose, onDeleteNode]);

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
        style={{ ...nodeEditorPopupStyle, left: popupRect.left, top: popupRect.top, width: popupRect.width, height: popupRect.height }}
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
        {onDeleteNode && (
          <button
            className="mango-elevated-action"
            type="button"
            title="Move node to Recycle Bin"
            aria-label="Move node to Recycle Bin"
            data-frame-interactive="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={requestDeleteNode}
            style={{ ...nodeEditorPopupCollapseButtonStyle, right: onCollapseToTab ? 98 : 68, color: "#be123c" }}
          >
            <HeaderRecycleBinIcon />
          </button>
        )}
        {onCollapseToTab && (
          <button
            className="mango-elevated-action"
            type="button"
            title="Collapse node editor to app tab"
            aria-label="Collapse node editor to app tab"
            data-frame-interactive="true"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onCollapseToTab}
            style={{ ...nodeEditorPopupCollapseButtonStyle, right: 68 }}
          >
            <MinimizeToLineIcon />
          </button>
        )}
        <button
          className="mango-elevated-action"
          type="button"
          title={popupFullscreen ? "Restore node editor" : "Fullscreen node editor"}
          aria-label={popupFullscreen ? "Restore node editor" : "Fullscreen node editor"}
          aria-pressed={popupFullscreen}
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={togglePopupFullscreen}
          style={{ ...nodeEditorPopupCollapseButtonStyle, right: 38 }}
        >
          <NodeEditorPopupFullscreenIcon active={popupFullscreen} />
        </button>
        <button
          className="mango-elevated-action"
          type="button"
          title="Close node editor"
          aria-label="Close node editor"
          data-frame-interactive="true"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={onClose}
          style={nodeEditorPopupCloseButtonStyle}
        >
          X
        </button>
        <React.Suspense fallback={<div aria-busy="true" style={{ width: "100%", height: "100%", background: "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)" }} />}>
          <LazyHomeNodeEditorContent
            accent="#334155"
            widgetId={`communications-node-editor-overlay:${nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={nodeID}
            forcedLabel={nodeTitle}
            focusInformationID={focusInformationID}
            focusRequestID={focusRequestID}
          />
        </React.Suspense>
        {deleteConfirmation && (
          <ConfirmActionMenu
            title="Are you sure you want to delete this node?"
            detail="This moves the node to the Recycle Bin."
            position={deleteConfirmation.position}
            confirmLabel={deleteBusy ? "Deleting" : "Yes"}
            cancelLabel="No"
            confirmDisabled={deleteBusy}
            onConfirm={(confirmationDisplayName) => { void confirmDeleteNode(confirmationDisplayName); }}
            onCancel={() => setDeleteConfirmation(null)}
          />
        )}
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
  busy,
  canManageSharedTriage,
  onSelectView,
  onCreateSharedInbox,
  onRenameSharedInbox,
  onSetSharedInboxAccountEmail,
  onMoveSharedInbox,
  onDeleteSharedInbox,
  onRemoveSharedInbox,
}: {
  activeViewID: HomeViewID;
  connectedAccountEmail?: string;
  sharedInboxes: CommunicationsSharedInbox[];
  loadingSharedInboxes: boolean;
  busy: string;
  canManageSharedTriage: boolean;
  onSelectView: (viewID: HomeViewID, mailbox?: EmailMailbox) => void;
  onCreateSharedInbox: (parentFolderID: string, name?: string, accountEmail?: string) => Promise<CommunicationsSharedInbox | null>;
  onRenameSharedInbox: (folderID: string, name: string) => Promise<void>;
  onSetSharedInboxAccountEmail: (folderID: string, accountEmail: string) => Promise<void>;
  onMoveSharedInbox: (folderID: string, parentFolderID: string, position: number) => Promise<void>;
  onDeleteSharedInbox: (folderID: string) => Promise<void>;
  onRemoveSharedInbox: (folderID: string) => Promise<void>;
}) {
  const [sharedRootOpen, setSharedRootOpen] = useState(true);
  const [expandedSharedFolderIDs, setExpandedSharedFolderIDs] = useState<Set<string>>(new Set());
  const [selectedSharedTreeIDs, setSelectedSharedTreeIDs] = useState<Set<string>>(new Set());
  const [sharedSelectionAnchorTreeID, setSharedSelectionAnchorTreeID] = useState("");
  const [renamingSharedFolderID, setRenamingSharedFolderID] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [draggingSharedFolderID, setDraggingSharedFolderID] = useState("");
  const [hoveredSharedFolderID, setHoveredSharedFolderID] = useState("");
  const [dropTarget, setDropTarget] = useState<{ folderID: string; placement: SharedInboxDropPlacement } | null>(null);
  const [sharedContextMenu, setSharedContextMenu] = useState<{ x: number; y: number; folder: CommunicationsSharedInbox | null } | null>(null);
  const [sharedCreateDialog, setSharedCreateDialog] = useState<{ mode: "folder" | "shared_inbox"; parentFolderID: string; parentName: string; name: string; accountEmail: string; error: string } | null>(null);
  const [sharedEmailDialog, setSharedEmailDialog] = useState<{ folder: CommunicationsSharedInbox; draft: string; error: string } | null>(null);
  const [sharedDeleteDialog, setSharedDeleteDialog] = useState<{ folder: CommunicationsSharedInbox; action: "delete" | "remove"; title: string; detail: string; label: string; confirmLabel: string; position?: ConfirmActionMenuPosition | null } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedCreateNameInputRef = useRef<HTMLInputElement | null>(null);
  const sharedEmailInputRef = useRef<HTMLInputElement | null>(null);
  const skipRenameBlurRef = useRef(false);
  const cleanConnectedAccountEmail = connectedAccountEmail?.trim().toLowerCase() ?? "";
  const sharedRows = useMemo(() => sharedRootOpen ? buildSharedInboxRows(sharedInboxes, expandedSharedFolderIDs) : [], [expandedSharedFolderIDs, sharedInboxes, sharedRootOpen]);
  const sharedBusy = busy === "shared-inbox";

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
    if (!sharedCreateDialog) return;
    window.setTimeout(() => {
      sharedCreateNameInputRef.current?.focus();
      sharedCreateNameInputRef.current?.select();
    }, 0);
  }, [sharedCreateDialog?.parentFolderID]);

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

  const openSharedInboxCreateDialog = useCallback((parentFolder: CommunicationsSharedInbox | null, mode: "folder" | "shared_inbox") => {
    if (!canManageSharedTriage) return;
    setSharedContextMenu(null);
    setSharedCreateDialog({
      mode,
      parentFolderID: parentFolder?.folder_id ?? "",
      parentName: parentFolder?.name ?? "",
      name: "",
      accountEmail: mode === "shared_inbox" ? cleanConnectedAccountEmail : "",
      error: "",
    });
  }, [canManageSharedTriage, cleanConnectedAccountEmail]);

  const submitSharedInboxCreateDialog = useCallback(async () => {
    if (!sharedCreateDialog || sharedBusy) return;
    if (!canManageSharedTriage) {
      setSharedCreateDialog(null);
      return;
    }
    const name = sharedCreateDialog.name.trim();
    const accountEmail = sharedCreateDialog.accountEmail.trim().toLowerCase();
    if (!name) {
      setSharedCreateDialog((current) => current ? { ...current, error: sharedCreateDialog.mode === "shared_inbox" ? "Enter a shared inbox name." : "Enter a folder name." } : current);
      return;
    }
    if (sharedCreateDialog.mode === "shared_inbox" && !isValidSharedInboxEmail(accountEmail)) {
      setSharedCreateDialog((current) => current ? { ...current, error: "Enter a valid email address." } : current);
      return;
    }
    const parentFolderID = sharedCreateDialog.parentFolderID;
    setSharedCreateDialog(null);
    const folder = await onCreateSharedInbox(parentFolderID, name, sharedCreateDialog.mode === "shared_inbox" ? accountEmail : "");
    if (!folder) return;
    if (parentFolderID) {
      setExpandedSharedFolderIDs((previous) => new Set(previous).add(parentFolderID));
    }
    setSharedRootOpen(true);
  }, [canManageSharedTriage, onCreateSharedInbox, sharedBusy, sharedCreateDialog]);

  const setSharedFolderAccountEmail = useCallback(async (folderID: string, accountEmail: string) => {
    setSharedContextMenu(null);
    if (!canManageSharedTriage) return;
    const current = sharedInboxes.find((folder) => folder.folder_id === folderID.trim());
    if (!current || current.entry_type !== "shared_inbox") {
      return;
    }
    await onSetSharedInboxAccountEmail(folderID, accountEmail);
  }, [canManageSharedTriage, onSetSharedInboxAccountEmail, sharedInboxes]);

  const openSharedEmailDialog = useCallback((folder: CommunicationsSharedInbox) => {
    if (!canManageSharedTriage) {
      setSharedContextMenu(null);
      return;
    }
    if (folder.entry_type !== "shared_inbox") {
      setSharedContextMenu(null);
      return;
    }
    setSharedContextMenu(null);
    setSharedEmailDialog({
      folder,
      draft: (folder.account_email ?? cleanConnectedAccountEmail).trim().toLowerCase(),
      error: "",
    });
  }, [canManageSharedTriage, cleanConnectedAccountEmail, sharedInboxes]);

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

  const requestRemoveSharedFolder = useCallback(async (folder: CommunicationsSharedInbox, position?: ConfirmActionMenuPosition) => {
    const label = folder.name.trim() || "this folder";
    if (folder.entry_type === "shared_inbox") {
      setSharedDeleteDialog({
        folder,
        action: "remove",
        title: "Remove from Shared Triage",
        detail: "this Shared Triage inbox while keeping the company email connection",
        label,
        confirmLabel: "Remove",
        position: position ?? null,
      });
      return;
    }
  }, []);

  const requestDeleteSharedFolder = useCallback(async (folder: CommunicationsSharedInbox, position?: ConfirmActionMenuPosition) => {
    const label = folder.name.trim() || "this folder";
    if (folder.entry_type === "shared_inbox") {
      setSharedDeleteDialog({
        folder,
        action: "delete",
        title: "Delete email connection",
        detail: "this Shared Triage inbox and its company email connection",
        label,
        confirmLabel: "Delete email",
        position: position ?? null,
      });
      return;
    }
    const count = collectSharedInboxSubtreeIDs(sharedInboxes, folder.folder_id).size || 1;
    const detail = count === 1 ? "this folder" : `this folder and ${count - 1} child item${count === 2 ? "" : "s"}`;
    setSharedDeleteDialog({ folder, action: "delete", title: "Delete folder", detail, label, confirmLabel: "Delete", position: position ?? null });
  }, [sharedInboxes]);

  const openSharedContextMenu = useCallback((event: React.MouseEvent, folder: CommunicationsSharedInbox | null) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canManageSharedTriage) {
      setSharedContextMenu(null);
      return;
    }
    setSharedContextMenu({ x: event.clientX, y: event.clientY, folder });
  }, [canManageSharedTriage]);

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
    const primaryRow = sharedRows.find((item) => item.treeID === primaryTreeID) ?? row;
    if (primaryRow.folder.entry_type === "shared_inbox") {
      onSelectView(primaryTreeID as HomeViewID, "primary");
    }
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
        if (target.entry_type === "shared_inbox") return;
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

  const renderSharedRow = (row: SharedInboxTreeRow) => {
    const folder = row.folder;
    const isSharedInbox = folder.entry_type === "shared_inbox";
    const isRenaming = renamingSharedFolderID === folder.folder_id;
    const active = activeViewID === row.treeID || selectedSharedTreeIDs.has(row.treeID);
    const hovered = hoveredSharedFolderID === folder.folder_id;
    const rowDropPlacement = dropTarget?.folderID === folder.folder_id ? dropTarget.placement : null;
    const folderHasAccess = folder.effective_access_level !== "no_access";
    const showPermissionMarker = sharedInboxHasPermissionMarker(folder);
    return (
      <div
        key={folder.folder_id}
        role="button"
        tabIndex={0}
        draggable={!isRenaming && !sharedBusy && folderHasAccess}
        style={sharedInboxFolderRowStyle(row.depth, active, rowDropPlacement, hovered)}
        onMouseEnter={() => setHoveredSharedFolderID(folder.folder_id)}
        onMouseLeave={() => setHoveredSharedFolderID((current) => current === folder.folder_id ? "" : current)}
        onClick={(event) => {
          if (folderHasAccess) {
            selectSharedFolderRow(row, event);
          }
          if (!isSharedInbox && row.hasChildren && event.detail <= 1 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
            toggleSharedFolder(folder.folder_id);
          }
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
          event.preventDefault();
          if (folderHasAccess) {
            selectSharedFolderRow(row);
          }
          if (!isSharedInbox && row.hasChildren) {
            toggleSharedFolder(folder.folder_id);
          }
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
          if (placement === "inside" && folder.entry_type === "shared_inbox") return;
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
            <ExplorerDisclosureIcon open={expandedSharedFolderIDs.has(folder.folder_id)} color="rgba(15, 23, 42, 0.62)" />
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
            <span style={sharedInboxNameLineStyle}>
              <span style={navLabelStyle}>{folder.name}</span>
              {showPermissionMarker && (
                <span title="Permissions set" aria-label="Permissions set">
                  <SharedInboxPermissionLockIcon />
                </span>
              )}
            </span>
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
              cursor: "pointer",
            }}
            onContextMenu={(event) => {
              if (!canManageSharedTriage) {
                event.preventDefault();
                event.stopPropagation();
                setSharedContextMenu(null);
                return;
              }
              openSharedContextMenu(event, null);
            }}
            onClick={() => {
              setSharedRootOpen((open) => !open);
            }}
            onDragOver={handleRootDragOver}
            onDragLeave={() => setDropTarget((current) => current?.folderID === "" ? null : current)}
            onDrop={handleRootDrop}
          >
            <button
              type="button"
              style={{
                ...navButtonStyle(activeViewID.startsWith("shared:")),
                minHeight: 30,
                paddingLeft: 8,
              }}
              onClick={(event) => {
                event.stopPropagation();
                setSharedRootOpen((open) => !open);
              }}
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
              <ExplorerDisclosureIcon open={sharedRootOpen} color="rgba(15, 23, 42, 0.62)" />
            </button>
          </div>
          {sharedRootOpen && (
            <div style={sharedInboxRowsStyle}>
              {sharedRows.map(renderSharedRow)}
            </div>
          )}
        </section>
        <section style={sidebarSectionStyle}>
          <HomeNavButton label="My Work" active={activeViewID === "my-work"} onClick={() => onSelectView("my-work", "all")} />
          <div id={HOME_MY_WORK_SAVED_VIEWS_SLOT_ID} />
        </section>
        <section style={sidebarSectionStyle}>
          <HomeNavButton label="Updates" active={activeViewID === "updates"} onClick={() => onSelectView("updates", "all")} />
          <div id={HOME_UPDATES_SAVED_VIEWS_SLOT_ID} />
        </section>
      </nav>
      {sharedContextMenu && (() => {
        if (!canManageSharedTriage) return null;
        const contextFolder = sharedContextMenu.folder;
        const contextFolderAcceptsChildren = !contextFolder || contextFolder.entry_type !== "shared_inbox";
        const showSharedCreateActions = canManageSharedTriage && contextFolderAcceptsChildren;
        if (!contextFolder && !showSharedCreateActions) return null;
        return (
          <FrameRightClickMenu x={sharedContextMenu.x} y={sharedContextMenu.y} onClose={() => setSharedContextMenu(null)} width={HOME_COMPACT_CONTEXT_MENU_WIDTH}>
            {showSharedCreateActions && (
              <>
                <button
                  type="button"
                  style={sharedInboxContextMenuButtonStyle}
                  disabled={sharedBusy}
                  onClick={() => openSharedInboxCreateDialog(contextFolder, "folder")}
                >
                  Create folder
                </button>
                <button
                  type="button"
                  style={sharedInboxContextMenuButtonStyle}
                  disabled={sharedBusy}
                  onClick={() => openSharedInboxCreateDialog(contextFolder, "shared_inbox")}
                >
                  Create shared inbox
                </button>
              </>
            )}
            {contextFolder && (
              <>
                {canManageSharedTriage && contextFolder.entry_type === "shared_inbox" && (
                  <>
                    <button
                      type="button"
                      style={sharedInboxContextMenuButtonStyle}
                      disabled={sharedBusy}
                      onClick={() => openSharedEmailDialog(contextFolder)}
                    >
                      Change inbox email
                    </button>
                    <button
                      type="button"
                      style={sharedInboxContextMenuButtonStyle}
                      disabled={sharedBusy}
                      onClick={(event) => void requestRemoveSharedFolder(contextFolder, confirmMenuPositionFromElement(event.currentTarget))}
                    >
                      Remove from Shared Triage
                    </button>
                  </>
                )}
                <button
                  type="button"
                  style={sharedInboxContextMenuButtonStyle}
                  onClick={() => startSharedRename(contextFolder)}
                >
                  Rename
                </button>
                <button
                  type="button"
                  style={{ ...sharedInboxContextMenuButtonStyle, color: "#dc2626" }}
                  disabled={sharedBusy}
                  onClick={(event) => void requestDeleteSharedFolder(contextFolder, confirmMenuPositionFromElement(event.currentTarget))}
                >
                  {contextFolder.entry_type === "shared_inbox" ? "Delete email" : "Delete"}
                </button>
              </>
            )}
          </FrameRightClickMenu>
        );
      })()}
      {sharedCreateDialog && (
        <SharedInboxCreateDialog
          nameInputRef={sharedCreateNameInputRef}
          parentName={sharedCreateDialog.parentName}
          mode={sharedCreateDialog.mode}
          name={sharedCreateDialog.name}
          accountEmail={sharedCreateDialog.accountEmail}
          error={sharedCreateDialog.error}
          busy={sharedBusy}
          onNameChange={(name) => setSharedCreateDialog((current) => current ? { ...current, name, error: "" } : current)}
          onAccountEmailChange={(accountEmail) => setSharedCreateDialog((current) => current ? { ...current, accountEmail, error: "" } : current)}
          onCancel={() => setSharedCreateDialog(null)}
          onSubmit={() => { void submitSharedInboxCreateDialog(); }}
        />
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
      {sharedDeleteDialog && (
        <SharedInboxDeleteDialog
          title={sharedDeleteDialog.title}
          label={sharedDeleteDialog.label}
          detail={sharedDeleteDialog.detail}
          confirmLabel={sharedDeleteDialog.confirmLabel}
          position={sharedDeleteDialog.position}
          busy={sharedBusy}
          onCancel={() => setSharedDeleteDialog(null)}
          onConfirm={() => {
            const folderID = sharedDeleteDialog.folder.folder_id;
            const action = sharedDeleteDialog.action;
            setSharedDeleteDialog(null);
            if (action === "remove") void onRemoveSharedInbox(folderID);
            else void onDeleteSharedInbox(folderID);
          }}
        />
      )}
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

function SharedInboxCreateDialog({ nameInputRef, parentName, mode, name, accountEmail, error, busy, onNameChange, onAccountEmailChange, onSubmit, onCancel }: {
  nameInputRef: React.RefObject<HTMLInputElement>;
  parentName: string;
  mode: "folder" | "shared_inbox";
  name: string;
  accountEmail: string;
  error: string;
  busy: boolean;
  onNameChange: (name: string) => void;
  onAccountEmailChange: (accountEmail: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const parentLabel = parentName.trim();
  const isSharedInbox = mode === "shared_inbox";
  return (
    <div style={deleteModalBackdropStyle} onPointerDown={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isSharedInbox ? "Create shared inbox" : "Create Shared Triage folder"}
        style={deleteModalStyle}
        onPointerDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700 }}>{isSharedInbox ? "Create shared inbox" : "Create folder"}</div>
        <div style={deleteModalDetailStyle}>{parentLabel ? `Inside ${parentLabel}` : "Shared Triage"}</div>
        <label style={{ display: "grid", gap: 5, minWidth: 0, fontSize: 11, fontWeight: 700 }}>
          <span>Name</span>
          <input
            ref={nameInputRef}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={isSharedInbox ? "Support inbox" : "Finance"}
            disabled={busy}
            style={inputStyle}
          />
        </label>
        {isSharedInbox && (
          <label style={{ display: "grid", gap: 5, minWidth: 0, fontSize: 11, fontWeight: 700 }}>
            <span>Email</span>
            <input
              type="email"
              value={accountEmail}
              onChange={(event) => onAccountEmailChange(event.target.value)}
              placeholder="support@example.com"
              disabled={busy}
              style={inputStyle}
            />
          </label>
        )}
        {error && <div style={{ color: "#8b123f", fontSize: 11, fontWeight: 700 }}>{error}</div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onCancel} style={smallButtonStyle}>Cancel</button>
          <button type="submit" disabled={busy} style={primaryButtonStyle}>{busy ? "Creating" : "Create"}</button>
        </div>
      </form>
    </div>
  );
}

function SharedInboxDeleteDialog({ title, label, detail, confirmLabel, position, busy, onConfirm, onCancel }: {
  title: string;
  label: string;
  detail: string;
  confirmLabel: string;
  position?: ConfirmActionMenuPosition | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmActionMenu
      title={title}
      detail={`Delete ${detail}: ${label}?`}
      position={position}
      confirmLabel={busy ? "Deleting" : confirmLabel}
      cancelLabel="No"
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

type CompanyUserGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

type CompanyUserGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
};

const SHARED_INBOX_GVIC_ROLES: ReadonlyArray<{ role: CommunicationsSharedInboxGVICRole; label: string }> = [
  { role: "generated", label: "Generated" },
  { role: "verified", label: "Verified" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
];

function companyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return user.display_name?.trim() || user.email?.trim() || user.user_id;
}

function companyGroupLabel(group: Pick<CompanyUserGroup, "group_id" | "name">): string {
  return group.name?.trim() || group.group_id;
}

function sharedInboxGVICAssignmentPrincipalKey(assignment: { principal_type?: string; principal_id?: string; user_id: string }): string {
  const principalType = assignment.principal_type?.trim() || "user";
  const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
  return `${principalType}:${principalID}`;
}

function sharedInboxGVICAssignmentLabel(
  assignment: { principal_type?: string; principal_id?: string; principal_name?: string; user_id: string; user_display_name?: string; user_email?: string },
  userByID: Map<string, CompanyUser>,
  groupByID: Map<string, CompanyUserGroup>,
): string {
  if ((assignment.principal_type ?? "user") === "group") {
    const groupID = assignment.principal_id?.trim() ?? "";
    const group = groupByID.get(groupID);
    return assignment.principal_name?.trim() || (group ? companyGroupLabel(group) : groupID || "Group");
  }
  const user = userByID.get(assignment.user_id);
  return assignment.user_display_name?.trim() || assignment.user_email?.trim() || (user ? companyUserLabel(user) : assignment.user_id);
}

export function SharedInboxGVICSettingsModal({
  requestJSON,
  companyID,
  folder,
  companyUsers,
  busy,
  onAddPrincipal,
  onRemovePrincipal,
  onClose,
}: {
  requestJSON: BoundRequestJSON;
  companyID: string;
  folder: CommunicationsSharedInbox;
  companyUsers: CompanyUser[];
  busy: boolean;
  onAddPrincipal: (folderID: string, role: CommunicationsSharedInboxGVICRole, principalType: CommunicationsSharedInboxGVICPrincipalType, principalID: string, principalName?: string) => void;
  onRemovePrincipal: (folderID: string, role: CommunicationsSharedInboxGVICRole, principalType: CommunicationsSharedInboxGVICPrincipalType, principalID: string) => void;
  onClose: () => void;
}) {
  const [userDraftByRole, setUserDraftByRole] = useState<Record<CommunicationsSharedInboxGVICRole, string>>({
    generated: "",
    verified: "",
    consulted: "",
    informed: "",
  });
  const [groupDraftByRole, setGroupDraftByRole] = useState<Record<CommunicationsSharedInboxGVICRole, string>>({
    generated: "",
    verified: "",
    consulted: "",
    informed: "",
  });
  const [groups, setGroups] = useState<CompanyUserGroup[]>([]);
  const [groupMembers, setGroupMembers] = useState<CompanyUserGroupMember[]>([]);
  const [loadError, setLoadError] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(false);
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id, user])), [companyUsers]);
  const groupByID = useMemo(() => new Map(groups.map((group) => [group.group_id, group])), [groups]);
  const assignments = folder.gvic_assignments ?? [];
  const updateUserDraft = (role: CommunicationsSharedInboxGVICRole, value: string) => {
    setUserDraftByRole((previous) => ({ ...previous, [role]: value }));
  };
  const updateGroupDraft = (role: CommunicationsSharedInboxGVICRole, value: string) => {
    setGroupDraftByRole((previous) => ({ ...previous, [role]: value }));
  };

  const groupsByParent = useMemo(() => {
    const grouped = new Map<string, CompanyUserGroup[]>();
    for (const group of groups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      const list = grouped.get(parentID) ?? [];
      list.push(group);
      grouped.set(parentID, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.position - b.position || companyGroupLabel(a).localeCompare(companyGroupLabel(b)));
    return grouped;
  }, [groups]);

  const memberCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const member of groupMembers) counts.set(member.group_id, (counts.get(member.group_id) ?? 0) + 1);
    return counts;
  }, [groupMembers]);

  useEffect(() => {
    let cancelled = false;
    setLoadingGroups(true);
    setLoadError("");
    requestJSON<{ groups?: CompanyUserGroup[]; members?: CompanyUserGroupMember[] }>(`/v1/companies/${encodeURIComponent(companyID)}/user-groups`)
      .then((payload) => {
        if (cancelled) return;
        setGroups(payload.groups ?? []);
        setGroupMembers(payload.members ?? []);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load shared inbox GVIC groups", error);
        setLoadError("User groups could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoadingGroups(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyID, requestJSON]);

  const groupOptions = (selectableGroupIDs: Set<string>, parentID = "", depth = 0): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    for (const group of groupsByParent.get(parentID) ?? []) {
      if (selectableGroupIDs.has(group.group_id)) {
        out.push(
          <option key={group.group_id} value={group.group_id}>
            {`${"  ".repeat(depth)}${companyGroupLabel(group)} (${memberCountByGroup.get(group.group_id) ?? 0})`}
          </option>,
        );
      }
      out.push(...groupOptions(selectableGroupIDs, group.group_id, depth + 1));
    }
    return out;
  };

  return (
    <div style={sharedGVICBackdropStyle}>
      <section style={sharedGVICModalStyle} aria-modal="true" role="dialog" aria-label={`${folder.name} GVIC assignments`}>
        <div style={panelHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <h2 style={panelTitleStyle}>{folder.name} GVIC assignments</h2>
            {loadError && <div style={{ ...mutedSmallStyle, color: "#8b123f" }}>{loadError}</div>}
          </div>
          <button type="button" style={smallButtonStyle} disabled={busy} onClick={onClose}>Close</button>
        </div>
        <div style={sharedGVICRoleGridStyle}>
          {SHARED_INBOX_GVIC_ROLES.map(({ role, label }) => {
            const roleAssignments = assignments.filter((assignment) => assignment.role === role);
            const assignedPrincipalKeys = new Set(roleAssignments.map(sharedInboxGVICAssignmentPrincipalKey));
            const selectableUsers = companyUsers.filter((user) => !assignedPrincipalKeys.has(`user:${user.user_id}`));
            const selectableGroups = groups.filter((group) => !assignedPrincipalKeys.has(`group:${group.group_id}`));
            const selectableGroupIDs = new Set(selectableGroups.map((group) => group.group_id));
            const userDraft = userDraftByRole[role];
            const groupDraft = groupDraftByRole[role];
            return (
              <section key={role} style={sharedGVICRoleColumnStyle}>
                <div style={{ display: "grid", gap: 2 }}>
                  <strong style={{ fontSize: 12 }}>{label}</strong>
                </div>
                <div style={sharedGVICChipListStyle}>
                  {roleAssignments.length === 0 ? (
                    <span style={mutedSmallStyle}>No one assigned</span>
                  ) : roleAssignments.map((assignment) => {
                    const inherited = assignment.folder_id !== folder.folder_id;
                    const principalType = (assignment.principal_type ?? "user") as CommunicationsSharedInboxGVICPrincipalType;
                    const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
                    const labelText = sharedInboxGVICAssignmentLabel(assignment, userByID, groupByID);
                    return (
                      <span key={`${role}:${assignment.folder_id}:${principalType}:${principalID}`} style={sharedGVICChipStyle}>
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {labelText}
                        </span>
                        {inherited ? (
                          <span style={mutedSmallStyle}>Inherited</span>
                        ) : (
                          <button
                            type="button"
                            aria-label={`Remove ${labelText} from ${label}`}
                            style={shortcutRemoveStyle}
                            disabled={busy}
                            onClick={() => onRemovePrincipal(folder.folder_id, role, principalType, principalID)}
                          >
                            X
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
                <div style={sharedGVICControlStackStyle}>
                  <div style={sharedGVICAddRowStyle}>
                    <select
                      style={sharedGVICSelectStyle}
                      value={userDraft}
                      disabled={busy || selectableUsers.length === 0}
                      onChange={(event) => updateUserDraft(role, event.target.value)}
                    >
                      <option value="">{selectableUsers.length === 0 ? "All people added" : "Add person"}</option>
                      {selectableUsers.map((user) => (
                        <option key={user.user_id} value={user.user_id}>{companyUserLabel(user)}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      disabled={busy || !userDraft}
                      onClick={() => {
                        const user = userByID.get(userDraft);
                        onAddPrincipal(folder.folder_id, role, "user", userDraft, user ? companyUserLabel(user) : userDraft);
                        updateUserDraft(role, "");
                      }}
                    >
                      Add
                    </button>
                  </div>
                  <div style={sharedGVICAddRowStyle}>
                    <select
                      style={sharedGVICSelectStyle}
                      value={groupDraft}
                      disabled={busy || loadingGroups || selectableGroups.length === 0}
                      onChange={(event) => updateGroupDraft(role, event.target.value)}
                    >
                      <option value="">{selectableGroups.length === 0 ? "All groups added" : "Add group"}</option>
                      {groupOptions(selectableGroupIDs)}
                    </select>
                    <button
                      type="button"
                      style={smallButtonStyle}
                      disabled={busy || !groupDraft}
                      onClick={() => {
                        const group = groupByID.get(groupDraft);
                        onAddPrincipal(folder.folder_id, role, "group", groupDraft, group ? companyGroupLabel(group) : groupDraft);
                        updateGroupDraft(role, "");
                      }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </section>
    </div>
  );
}

const sharedGVICBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(15, 23, 42, 0.22)",
};

const sharedGVICModalStyle: React.CSSProperties = {
  width: "min(920px, calc(100vw - 40px))",
  maxHeight: "min(620px, calc(100vh - 40px))",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 12,
  padding: 14,
  border: "1px solid rgba(100, 116, 139, 0.3)",
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 18px 44px rgba(15, 23, 42, 0.22)",
  overflow: "hidden",
};

const sharedGVICRoleGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(170px, 1fr))",
  gap: 10,
  overflow: "auto",
};

const sharedGVICRoleColumnStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 240,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
  gap: 10,
  padding: 10,
  border: "1px solid rgba(100, 116, 139, 0.2)",
  borderRadius: 8,
  background: "#f8fafc",
};

const sharedGVICControlStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const sharedGVICChipListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 6,
  overflow: "auto",
};

const sharedGVICChipStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 28,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  padding: "3px 4px 3px 8px",
  border: "1px solid rgba(100, 116, 139, 0.2)",
  borderRadius: 6,
  background: "#ffffff",
  fontSize: 11,
  fontWeight: 600,
};

const sharedGVICAddRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
  minWidth: 0,
};

const sharedGVICSelectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: "1px solid rgba(100, 116, 139, 0.24)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#111827",
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
  onRequestDeleteLogicGate,
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
  onConvertMessages: (logicGateID: string, messageIDs: string[], priority: number) => void;
  onCreateLogicGate: (options?: { creatorGVICRole?: LogicGateGVICRole }) => void;
  onRequestDeleteLogicGate: (logicGateID: string, position?: ConfirmActionMenuPosition) => void;
}) {
  const railSplit = useRailTopResize(HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, 240);
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [createContextMenu, setCreateContextMenu] = useState<{ x: number; y: number; creatorGVICRole?: LogicGateGVICRole } | null>(null);
  const [triagePriorityMenu, setTriagePriorityMenu] = useState<TriageConversionPriorityMenuState | null>(null);
  const [logicGateDropTargetRowID, setLogicGateDropTargetRowID] = useState("");
  const openCreateLogicGateMenu = useCallback((event: React.MouseEvent, creatorGVICRole?: LogicGateGVICRole) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setLogicGateDropTargetRowID("");
    setTriagePriorityMenu(null);
    setCreateContextMenu({ x: event.clientX, y: event.clientY, creatorGVICRole });
  }, []);
  const requestTriageConversionPriority = useCallback((event: React.DragEvent<HTMLElement>, logicGateID: string, messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID || ids.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCreateContextMenu(null);
    setLogicGateDropTargetRowID("");
    setTriagePriorityMenu({ x: event.clientX, y: event.clientY, logicGateID: cleanLogicGateID, messageIDs: ids });
  }, []);

  return (
    <>
    <aside ref={railSplit.railRef} style={logicGateRailStyle(railSplit.topHeight)}>
      <section
        style={logicGateRailSectionStyle}
        onContextMenu={(event) => openCreateLogicGateMenu(event, "generated")}
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
                    onConvertMessages={requestTriageConversionPriority}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <RailRowResizeHandle onPointerDown={railSplit.startResize} />

      <section style={{ ...logicGateRailSectionStyle, gridTemplateRows: "auto auto minmax(0, 1fr)" }} onContextMenu={(event) => openCreateLogicGateMenu(event)}>
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
                style={logicGateTreeRowStyle(row.depth, selected, logicGateDropTargetRowID === row.id)}
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
                onDragEnd={() => setLogicGateDropTargetRowID("")}
                onDragOver={(event) => {
                  if (row.kind !== "logic_gate" || !hasTriageMessageDrag(event.dataTransfer)) return;
                  event.preventDefault();
                  setLogicGateDropTargetRowID(row.id);
                  event.dataTransfer.dropEffect = "copy";
                }}
                onDragLeave={() => {
                  setLogicGateDropTargetRowID((current) => current === row.id ? "" : current);
                }}
                onDrop={(event) => {
                  if (row.kind !== "logic_gate" || !logicGateID) return;
                  const messageIDs = readTriageMessageIDs(event.dataTransfer);
                  if (messageIDs.length === 0) return;
                  setLogicGateDropTargetRowID("");
                  requestTriageConversionPriority(event, logicGateID, messageIDs);
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
                    <ExplorerDisclosureIcon open={expandedRowIDs.has(row.id)} color="rgba(15, 23, 42, 0.62)" />
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
    <HomePinContextMenu
      menu={pinContextMenu}
      onClose={() => setPinContextMenu(null)}
      onDelete={(target, position) => {
        if (target.kind === "logic_gate") onRequestDeleteLogicGate(target.id, position);
      }}
    />
    {createContextMenu && (
      <FrameRightClickMenu x={createContextMenu.x} y={createContextMenu.y} onClose={() => setCreateContextMenu(null)}>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            const creatorGVICRole = createContextMenu.creatorGVICRole;
            setCreateContextMenu(null);
            onCreateLogicGate({ creatorGVICRole });
          }}
        >
          Create Logic Gate
        </button>
      </FrameRightClickMenu>
    )}
    {triagePriorityMenu && (
      <FrameRightClickMenu x={triagePriorityMenu.x} y={triagePriorityMenu.y} onClose={() => setTriagePriorityMenu(null)}>
        {HOME_LOGIC_GATE_PRIORITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              const menu = triagePriorityMenu;
              setTriagePriorityMenu(null);
              onConvertMessages(menu.logicGateID, menu.messageIDs, option.value);
            }}
          >
            {option.label}
          </button>
        ))}
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
  onConvertMessages: (event: React.DragEvent<HTMLElement>, logicGateID: string, messageIDs: string[]) => void;
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
        onConvertMessages(event, logicGateID, messageIDs);
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
  logicGateByID,
  myNodeGroups,
  otherNodes,
  myLogicGateGroups,
  inboxRole,
  selectedRowIDs,
  selectedLogicGateRowIDs,
  busy,
  getNodeDragIDs,
  getLogicGateDragIDs,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onRemoveLogicGateShortcut,
  onConvertMessages,
  onRequestDeleteLogicGate,
  onCreateNode,
}: {
  loading: boolean;
  nodeByID: Map<string, NodeRecord>;
  logicGateByID: Map<string, LogicGateRecord>;
  allRows: ExplorerTreeNode[];
  myNodeGroups: MyNodeGroup[];
  otherNodes: NodeRecord[];
  myLogicGateGroups: MyLogicGateGroup[];
  inboxRole: GVICInboxRole;
  selectedRowIDs: Set<string>;
  selectedLogicGateRowIDs: Set<string>;
  expandedRowIDs: Set<string>;
  search: string;
  busy: boolean;
  getNodeDragIDs: (nodeID: string) => string[];
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSearchChange: (value: string) => void;
  onToggleFolder: (rowID: string) => void;
  onSelectRow: (row: ExplorerTreeNode, event: React.MouseEvent) => void;
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate: (treeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID?: string) => void;
  onOpenNodeBulkMenu: (nodeID: string, event: React.MouseEvent) => void;
  onRemoveLogicGateShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[], priority: number) => void;
  onRequestDeleteLogicGate: (logicGateID: string, position?: ConfirmActionMenuPosition) => void;
  onCreateNode: () => void;
}) {
  const myNodeOrderedRowIDs = useMemo(() => myNodeGroups.flatMap((group) => group.nodes.map((node) => nodeTreeID(node.node_id))), [myNodeGroups]);
  const otherNodeOrderedRowIDs = useMemo(() => otherNodes.map((node) => nodeTreeID(node.node_id)), [otherNodes]);
  const myLogicGateOrderedRowIDs = useMemo(() => (
    myLogicGateGroups.flatMap((group) => group.logicGates.map((logicGate) => logicGateTreeID(logicGate.logic_gate_id)))
  ), [myLogicGateGroups]);
  const railSplit = useRailTopResize(HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, 220);
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [createContextMenu, setCreateContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [triagePriorityMenu, setTriagePriorityMenu] = useState<TriageConversionPriorityMenuState | null>(null);
  const openCreateNodeMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setTriagePriorityMenu(null);
    setCreateContextMenu({ x: event.clientX, y: event.clientY });
  }, []);
  const selectInboxLogicGate = useCallback((logicGateID: string, event: React.MouseEvent) => {
    onSelectLogicGate(logicGateTreeID(logicGateID), myLogicGateOrderedRowIDs, event);
  }, [myLogicGateOrderedRowIDs, onSelectLogicGate]);
  const requestTriageConversionPriority = useCallback((event: React.DragEvent<HTMLElement>, logicGateID: string, messageIDs: string[]) => {
    const ids = cleanIDList(messageIDs);
    const cleanLogicGateID = logicGateID.trim();
    if (!cleanLogicGateID || ids.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCreateContextMenu(null);
    setTriagePriorityMenu({ x: event.clientX, y: event.clientY, logicGateID: cleanLogicGateID, messageIDs: ids });
  }, []);
  const showRoleLogicGates = inboxRole !== "other";
  const renderMyNodesSection = (
    sectionStyle: React.CSSProperties,
    titleStyle: React.CSSProperties,
    mutedStyle: React.CSSProperties,
    listStyle: React.CSSProperties,
  ) => (
    <section style={sectionStyle} onContextMenu={openCreateNodeMenu}>
      <div style={nodeInboxRailHeaderStyle}>
        <h2 style={titleStyle}>My Nodes</h2>
        {loading && <span style={mutedStyle}>Loading</span>}
      </div>
      <div className="mango-home-scroll" style={listStyle}>
        {myNodeGroups.length === 0 && !loading ? (
          <div style={nodeInboxEmptyStyle}>No assigned nodes</div>
        ) : (
          myNodeGroups.map((group) => (
            <div key={group.key} style={nodeInboxGroupStyle}>
              <div style={nodeInboxFolderLabelStyle}>
                <ExplorerRowIcon kind="folder" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.label}</span>
                <span style={nodeInboxGroupCountStyle}>{group.nodes.length}</span>
              </div>
              <div style={nodeInboxGridStyle}>
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
                    tone="orange"
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
  const renderMyLogicGatesSection = (
    sectionStyle: React.CSSProperties,
    titleStyle: React.CSSProperties,
    mutedStyle: React.CSSProperties,
  ) => (
    <section style={sectionStyle}>
      <div style={nodeInboxRailHeaderStyle}>
        <h2 style={titleStyle}>My Logic Gates</h2>
        {loading && <span style={mutedStyle}>Loading</span>}
      </div>
      <div className="mango-home-scroll" style={myLogicGatesListStyle}>
        {myLogicGateGroups.length === 0 && !loading ? (
          <div style={nodeInboxOtherEmptyStyle}>No assigned Logic Gates</div>
        ) : myLogicGateGroups.map((group) => (
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
                  selected={selectedLogicGateRowIDs.has(logicGateTreeID(logicGate.logic_gate_id))}
                  busy={busy}
                  getLogicGateDragIDs={getLogicGateDragIDs}
                  logicGateByID={logicGateByID}
                  shortcut={false}
                  onSelectShortcut={selectInboxLogicGate}
                  onOpenLogicGate={onOpenLogicGate}
                  onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                  onRemoveShortcut={onRemoveLogicGateShortcut}
                  onConvertMessages={requestTriageConversionPriority}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
  const renderOtherNodesSection = () => (
    <section style={nodeInboxOtherSectionStyle} onContextMenu={openCreateNodeMenu}>
      <div style={nodeInboxRailHeaderStyle}>
        <h2 style={nodeInboxOtherPanelTitleStyle}>Others</h2>
        {loading && <span style={nodeInboxOtherMutedSmallStyle}>Loading</span>}
      </div>
      <div className="mango-home-scroll" style={nodeInboxOtherListStyle}>
        {otherNodes.length === 0 && !loading ? (
          <div style={nodeInboxOtherEmptyStyle}>No other nodes</div>
        ) : (
          <div style={nodeInboxGridStyle}>
            {otherNodes.map((node) => (
              <MyNodeTile
                key={node.node_id}
                node={node}
                selected={selectedRowIDs.has(nodeTreeID(node.node_id))}
                orderedRowIDs={otherNodeOrderedRowIDs}
                nodeByID={nodeByID}
                getNodeDragIDs={getNodeDragIDs}
                onSelectNode={onSelectNode}
                onOpenNode={onOpenNode}
                onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                onOpenPinContextMenu={(event, target) => openHomePinContextMenu(event, target, setPinContextMenu)}
                tone="light"
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <>
    <aside ref={railSplit.railRef} style={nodeInboxRailStyle(railSplit.topHeight)}>
      {showRoleLogicGates
        ? renderMyLogicGatesSection(nodeInboxPrimarySectionStyle, nodeInboxPanelTitleStyle, nodeInboxMutedSmallStyle)
        : renderMyNodesSection(nodeInboxPrimarySectionStyle, nodeInboxPanelTitleStyle, nodeInboxMutedSmallStyle, nodeInboxListStyle)}
      <RailRowResizeHandle onPointerDown={railSplit.startResize} />
      {showRoleLogicGates
        ? renderMyNodesSection(nodeInboxOtherSectionStyle, nodeInboxOtherPanelTitleStyle, nodeInboxOtherMutedSmallStyle, nodeInboxOtherListStyle)
        : renderOtherNodesSection()}
    </aside>
    <HomePinContextMenu
      menu={pinContextMenu}
      onClose={() => setPinContextMenu(null)}
      onDelete={(target, position) => {
        if (target.kind === "logic_gate") onRequestDeleteLogicGate(target.id, position);
      }}
    />
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
    {triagePriorityMenu && (
      <FrameRightClickMenu x={triagePriorityMenu.x} y={triagePriorityMenu.y} onClose={() => setTriagePriorityMenu(null)}>
        {HOME_LOGIC_GATE_PRIORITY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              const menu = triagePriorityMenu;
              setTriagePriorityMenu(null);
              onConvertMessages(menu.logicGateID, menu.messageIDs, option.value);
            }}
          >
            {option.label}
          </button>
        ))}
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
  tone = "orange",
}: {
  node: NodeRecord;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord, informationID?: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenPinContextMenu: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
  tone?: "orange" | "light";
}) {
  const nodeID = node.node_id;
  return (
    <button
      type="button"
      draggable
      style={nodeInboxTileStyle(selected, tone)}
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
      <span style={nodeInboxTileIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={nodeInboxTileTextStyle(tone)}>{nodeTitle(node)}</span>
    </button>
  );
}

function notificationCountForInboxGroup(summary: NotificationSummary, role: NotificationGVICRole, group: InboxLogicGateNodeGroup): number {
  if (!group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return 0;
  const groupNodeIDs = new Set(group.nodeIDs);
  return (summary.logic_gate_counts ?? []).reduce((count, item) => {
    if (item.logic_gate_id !== group.logicGateID || item.role !== role) return count;
    const nodeID = item.node_id?.trim() ?? "";
    if (nodeID && !groupNodeIDs.has(nodeID)) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function notificationCountForInboxNode(summary: NotificationSummary | undefined, group: InboxLogicGateNodeGroup, nodeID: string, role?: NotificationGVICRole): number {
  const cleanNodeID = nodeID.trim();
  if (!summary || !cleanNodeID || !group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return 0;
  return (summary.logic_gate_counts ?? []).reduce((count, item) => {
    if (item.logic_gate_id !== group.logicGateID || item.node_id?.trim() !== cleanNodeID) return count;
    if (role && item.role !== role) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function filterInboxGroupsForUnread(groups: InboxLogicGateNodeGroup[], summary: NotificationSummary, role: NotificationGVICRole): InboxLogicGateNodeGroup[] {
  return groups.reduce<InboxLogicGateNodeGroup[]>((out, group) => {
    const groupUnread = notificationCountForInboxGroup(summary, role, group);
    if (groupUnread <= 0) return out;
    out.push({
      ...group,
      nodeIDs: group.nodeIDs.filter((nodeID) => notificationCountForInboxNode(summary, group, nodeID, role) > 0),
    });
    return out;
  }, []);
}

function filterInboxGroupMapForUnread(groupsByCell: Map<string, InboxLogicGateNodeGroup[]>, summary: NotificationSummary, role: NotificationGVICRole, unreadOnly: boolean): Map<string, InboxLogicGateNodeGroup[]> {
  if (!unreadOnly) return groupsByCell;
  const filtered = new Map<string, InboxLogicGateNodeGroup[]>();
  for (const [cellKey, groups] of groupsByCell.entries()) {
    const unreadGroups = filterInboxGroupsForUnread(groups, summary, role);
    if (unreadGroups.length > 0) filtered.set(cellKey, unreadGroups);
  }
  return filtered;
}

function InboxMatrixUnreadToggle({ unreadOnly, onChange }: { unreadOnly: boolean; onChange: (value: boolean) => void }) {
  const labelStyle = (active: boolean): React.CSSProperties => ({
    position: "relative",
    zIndex: 1,
    color: active ? "#334155" : "#64748b",
    display: "grid",
    placeItems: "center",
    fontSize: 11,
    fontWeight: 800,
    lineHeight: 1,
    transition: "color 160ms ease",
  });
  return (
    <button
      type="button"
      role="switch"
      aria-checked={unreadOnly}
      aria-label={unreadOnly ? "Showing unread matrix nodes" : "Showing all matrix nodes"}
      onClick={() => onChange(!unreadOnly)}
      style={{
        position: "relative",
        height: 28,
        width: 122,
        flex: "0 0 122px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        alignItems: "center",
        padding: 2,
        border: "1px solid rgba(100, 116, 139, 0.18)",
        borderRadius: 8,
        background: "rgba(255, 255, 255, 0.56)",
        boxSizing: "border-box",
        color: "#334155",
        cursor: "pointer",
        font: "inherit",
        appearance: "none",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          left: 2,
          top: 2,
          width: "calc((100% - 4px) / 2)",
          height: 22,
          border: "1px solid rgba(71, 85, 105, 0.38)",
          borderRadius: 6,
          background: "#ffffff",
          boxShadow: "0 3px 8px rgba(15, 23, 42, 0.10)",
          transform: unreadOnly ? "translateX(100%)" : "translateX(0)",
          transition: "transform 180ms cubic-bezier(0.2, 0, 0, 1)",
          boxSizing: "border-box",
        }}
      />
      <span style={labelStyle(!unreadOnly)}>All</span>
      <span style={labelStyle(unreadOnly)}>Unread</span>
    </button>
  );
}

const inboxMatrixHeaderControlsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  minWidth: 202,
  flex: "0 0 auto",
};

const inboxMatrixHeaderMetaStyle: React.CSSProperties = {
  ...logicGateGVICMetaStyle,
  minWidth: 72,
};

export type GVICMatrixViewerListEntry = {
  kind: "group" | "user";
  id: string;
};

type GVICMatrixViewerGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

type GVICMatrixViewerGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
};

function GVICMatrixViewerUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID;
}

function GVICMatrixViewerSearchText(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return `${user.display_name ?? ""} ${user.email ?? ""} ${user.user_id}`.trim().toLowerCase();
}

function GVICMatrixViewerGroupLabel(group: Pick<GVICMatrixViewerGroup, "group_id" | "name"> | null | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID;
}

function GVICMatrixViewerEntryKey(entry: GVICMatrixViewerListEntry): string {
  return `${entry.kind}:${entry.id.trim()}`;
}

function normalizeGVICMatrixViewerEntries(entries: GVICMatrixViewerListEntry[]): GVICMatrixViewerListEntry[] {
  const out: GVICMatrixViewerListEntry[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const kind = entry.kind === "group" ? "group" : entry.kind === "user" ? "user" : "";
    const id = entry.id.trim();
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ kind, id });
  }
  return out;
}

function firstGVICMatrixViewerDefaultGroupID(groups: GVICMatrixViewerGroup[], members: GVICMatrixViewerGroupMember[], currentUserID: string): string {
  const cleanCurrentUserID = currentUserID.trim();
  if (!cleanCurrentUserID) return "";
  const ownGroupIDs = new Set(members.filter((member) => member.user_id.trim() === cleanCurrentUserID).map((member) => member.group_id.trim()).filter(Boolean));
  return groups
    .filter((group) => ownGroupIDs.has(group.group_id))
    .sort((left, right) => (
      left.position - right.position ||
      GVICMatrixViewerGroupLabel(left, left.group_id).localeCompare(GVICMatrixViewerGroupLabel(right, right.group_id), undefined, { numeric: true, sensitivity: "base" }) ||
      left.group_id.localeCompare(right.group_id)
    ))[0]?.group_id ?? "";
}

export function GVICMatrixViewerSelector({
  companyUsers,
  groups,
  groupMembers,
  currentUserID,
  selectedUserID,
  entries,
  onEntriesChange,
  onSelectUser,
}: {
  companyUsers: CompanyUser[];
  groups: GVICMatrixViewerGroup[];
  groupMembers: GVICMatrixViewerGroupMember[];
  currentUserID: string;
  selectedUserID: string;
  entries: GVICMatrixViewerListEntry[];
  onEntriesChange: (entries: GVICMatrixViewerListEntry[]) => void;
  onSelectUser: (userID: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const cleanEntries = useMemo(() => normalizeGVICMatrixViewerEntries(entries), [entries]);
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const groupByID = useMemo(() => new Map(groups.map((group) => [group.group_id.trim(), group])), [groups]);
  const membersByGroupID = useMemo(() => {
    const grouped = new Map<string, GVICMatrixViewerGroupMember[]>();
    for (const member of groupMembers) {
      const groupID = member.group_id.trim();
      if (!groupID) continue;
      const list = grouped.get(groupID) ?? [];
      list.push(member);
      grouped.set(groupID, list);
    }
    for (const [groupID, list] of grouped) {
      list.sort((left, right) => (
        GVICMatrixViewerUserLabel(userByID.get(left.user_id.trim()), left.user_id).localeCompare(
          GVICMatrixViewerUserLabel(userByID.get(right.user_id.trim()), right.user_id),
          undefined,
          { numeric: true, sensitivity: "base" },
        ) ||
        left.user_id.localeCompare(right.user_id)
      ));
      grouped.set(groupID, list);
    }
    return grouped;
  }, [groupMembers, userByID]);
  const defaultGroupID = useMemo(() => firstGVICMatrixViewerDefaultGroupID(groups, groupMembers, currentUserID), [currentUserID, groupMembers, groups]);
  const effectiveEntries = cleanEntries.length > 0
    ? cleanEntries
    : defaultGroupID
      ? [{ kind: "group" as const, id: defaultGroupID }]
      : [];
  const selectedUser = userByID.get(selectedUserID.trim()) ?? null;
  const selectedLabel = GVICMatrixViewerUserLabel(selectedUser, selectedUserID.trim() || currentUserID.trim() || "User");
  const selectedInList = useMemo(() => {
    const selected = selectedUserID.trim();
    if (!selected) return false;
    for (const entry of effectiveEntries) {
      if (entry.kind === "user" && entry.id === selected) return true;
      if (entry.kind === "group" && (membersByGroupID.get(entry.id) ?? []).some((member) => member.user_id.trim() === selected)) return true;
    }
    return false;
  }, [effectiveEntries, membersByGroupID, selectedUserID]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return companyUsers
      .filter((user) => GVICMatrixViewerSearchText(user).includes(query))
      .sort((left, right) => (
        GVICMatrixViewerUserLabel(left, left.user_id).localeCompare(GVICMatrixViewerUserLabel(right, right.user_id), undefined, { numeric: true, sensitivity: "base" }) ||
        left.user_id.localeCompare(right.user_id)
      ))
      .slice(0, 8);
  }, [companyUsers, searchQuery]);
  const groupedUserIDs = useMemo(() => {
    const ids = new Set<string>();
    for (const member of groupMembers) {
      const userID = member.user_id.trim();
      if (userID) ids.add(userID);
    }
    return ids;
  }, [groupMembers]);
  const ungroupedUsers = useMemo(() => (
    companyUsers.filter((user) => !groupedUserIDs.has(user.user_id.trim()))
  ), [companyUsers, groupedUserIDs]);

  useEffect(() => {
    if (!open && !searchOpen && !addMenuOpen) return undefined;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setSearchOpen(false);
      setAddMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [addMenuOpen, open, searchOpen]);

  const selectUser = (userID: string) => {
    const cleanUserID = userID.trim();
    if (!cleanUserID) return;
    onSelectUser(cleanUserID);
    setSearchOpen(false);
  };
  const addEntry = (entry: GVICMatrixViewerListEntry) => {
    const baseEntries = cleanEntries.length > 0 ? cleanEntries : effectiveEntries;
    const next = normalizeGVICMatrixViewerEntries([...baseEntries, entry]);
    onEntriesChange(next);
  };
  const chooseAddEntry = (entry: GVICMatrixViewerListEntry) => {
    addEntry(entry);
    setAddMenuOpen(false);
  };
  const entryAlreadyIncluded = (entry: GVICMatrixViewerListEntry) => {
    const key = GVICMatrixViewerEntryKey(entry);
    return effectiveEntries.some((item) => GVICMatrixViewerEntryKey(item) === key);
  };
  const deleteEntry = (entry: GVICMatrixViewerListEntry) => {
    const key = GVICMatrixViewerEntryKey(entry);
    onEntriesChange(cleanEntries.filter((item) => GVICMatrixViewerEntryKey(item) !== key));
  };
  const moveEntry = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= cleanEntries.length || toIndex >= cleanEntries.length) return;
    const next = [...cleanEntries];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onEntriesChange(next);
  };
  const toggleCollapsedGroup = (groupKey: string) => {
    setCollapsedGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };
  const renderCheck = (userID: string) => (
    userID.trim() === selectedUserID.trim() ? <span aria-hidden="true" style={GVICMatrixViewerCheckStyle}>{"\u2713"}</span> : <span style={GVICMatrixViewerCheckSpacerStyle} />
  );
  const renderUserRow = (userID: string, options: { key: string; entry?: GVICMatrixViewerListEntry; draggableIndex?: number; compact?: boolean }) => {
    const user = userByID.get(userID.trim()) ?? null;
    const label = GVICMatrixViewerUserLabel(user, userID);
    return (
      <div
        key={options.key}
        role="button"
        tabIndex={0}
        draggable={options.draggableIndex !== undefined}
        onDragStart={(event) => {
          if (options.draggableIndex === undefined) return;
          setDragIndex(options.draggableIndex);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (options.draggableIndex === undefined || dragIndex === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (options.draggableIndex === undefined || dragIndex === null) return;
          event.preventDefault();
          moveEntry(dragIndex, options.draggableIndex);
          setDragIndex(null);
        }}
        onClick={() => selectUser(userID)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          selectUser(userID);
        }}
        style={GVICMatrixViewerUserRowStyle(userID.trim() === selectedUserID.trim(), options.compact)}
      >
        {options.draggableIndex !== undefined && <span aria-hidden="true" style={GVICMatrixViewerDragGripStyle}>::</span>}
        <span style={GVICMatrixViewerUserTextStyle}>
          <span style={GVICMatrixViewerUserLabelStyle}>{label}</span>
          {user?.email?.trim() && user.email.trim() !== label && <span style={GVICMatrixViewerUserEmailStyle}>{user.email}</span>}
        </span>
        {options.entry && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`Remove ${label}`}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              deleteEntry(options.entry!);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              deleteEntry(options.entry!);
            }}
            style={GVICMatrixViewerDeleteButtonStyle}
          >
            x
          </span>
        )}
        {renderCheck(userID)}
      </div>
    );
  };
  const renderEntry = (entry: GVICMatrixViewerListEntry, index: number) => {
    if (entry.kind === "user") {
      return renderUserRow(entry.id, { key: GVICMatrixViewerEntryKey(entry), entry, draggableIndex: index });
    }
    const group = groupByID.get(entry.id) ?? null;
    const members = membersByGroupID.get(entry.id) ?? [];
    const groupKey = GVICMatrixViewerEntryKey(entry);
    const collapsed = collapsedGroupKeys.has(groupKey);
    return (
      <div
        key={groupKey}
        draggable={cleanEntries.length > 0}
        onDragStart={(event) => {
          setDragIndex(index);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (dragIndex === null) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }}
        onDrop={(event) => {
          if (dragIndex === null) return;
          event.preventDefault();
          moveEntry(dragIndex, index);
          setDragIndex(null);
        }}
        style={GVICMatrixViewerGroupBlockStyle(entry.id)}
      >
        <div style={GVICMatrixViewerGroupHeaderStyle}>
          <button
            type="button"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${GVICMatrixViewerGroupLabel(group, entry.id)}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsedGroup(groupKey);
            }}
            style={GVICMatrixViewerCollapseButtonStyle}
          >
            {collapsed ? "\u25b8" : "\u25be"}
          </button>
          {cleanEntries.length > 0 && <span aria-hidden="true" style={GVICMatrixViewerDragGripStyle}>::</span>}
          <span style={GVICMatrixViewerGroupTitleStyle}>{GVICMatrixViewerGroupLabel(group, entry.id)}</span>
          {cleanEntries.length > 0 && (
            <button
              type="button"
              aria-label={`Remove ${GVICMatrixViewerGroupLabel(group, entry.id)}`}
              onClick={() => deleteEntry(entry)}
              style={GVICMatrixViewerSmallIconButtonStyle}
            >
              x
            </button>
          )}
        </div>
        {!collapsed && (
          <div style={GVICMatrixViewerGroupUsersStyle}>
            {members.length > 0
              ? members.map((member) => renderUserRow(member.user_id, { key: `${entry.id}:${member.user_id}`, compact: true }))
              : <div style={GVICMatrixViewerEmptyStyle}>No users</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} style={GVICMatrixViewerSelectorRootStyle}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={GVICMatrixViewerDropdownButtonStyle(open)}
      >
        <span style={GVICMatrixViewerDropdownLabelStyle}>{selectedLabel}</span>
        <span aria-hidden="true" style={GVICMatrixViewerChevronStyle}>v</span>
      </button>
      {open && (
        <div className="kanban-board-scroll" style={GVICMatrixViewerDropdownStyle}>
          <div style={GVICMatrixViewerCustomizeStyle}>
            <div style={GVICMatrixViewerAddRowStyle}>
              <div style={GVICMatrixViewerAddMenuRootStyle}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  onClick={() => setAddMenuOpen((value) => !value)}
                  style={GVICMatrixViewerAddMenuButtonStyle(addMenuOpen)}
                >
                  <span style={GVICMatrixViewerDropdownLabelStyle}>Add users</span>
                  <span aria-hidden="true" style={GVICMatrixViewerChevronStyle}>v</span>
                </button>
                {addMenuOpen && (
                  <div style={GVICMatrixViewerAddMenuStyle}>
                    {groups.map((group) => {
                      const groupID = group.group_id.trim();
                      const members = membersByGroupID.get(groupID) ?? [];
                      const selectedGroup = entryAlreadyIncluded({ kind: "group", id: groupID });
                      return (
                        <div key={groupID} style={GVICMatrixViewerAddGroupBlockStyle(groupID)}>
                          <button
                            type="button"
                            onClick={() => chooseAddEntry({ kind: "group", id: groupID })}
                            style={GVICMatrixViewerAddGroupRowStyle(groupID, selectedGroup)}
                          >
                            <span style={GVICMatrixViewerAddGroupDotStyle(groupID)} />
                            <span style={GVICMatrixViewerAddGroupTextStyle}>{GVICMatrixViewerGroupLabel(group, groupID)}</span>
                            {selectedGroup && <span aria-hidden="true" style={GVICMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
                          </button>
                          <div style={GVICMatrixViewerAddNestedUsersStyle}>
                            {members.map((member) => {
                              const userID = member.user_id.trim();
                              const user = userByID.get(userID) ?? null;
                              const selectedUser = entryAlreadyIncluded({ kind: "user", id: userID });
                              return (
                                <button
                                  key={`${groupID}:${userID}`}
                                  type="button"
                                  onClick={() => chooseAddEntry({ kind: "user", id: userID })}
                                  style={GVICMatrixViewerAddUserRowStyle(selectedUser)}
                                >
                                  <span style={GVICMatrixViewerAddUserTextStyle}>{GVICMatrixViewerUserLabel(user, userID)}</span>
                                  {selectedUser && <span aria-hidden="true" style={GVICMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {ungroupedUsers.length > 0 && (
                      <div style={GVICMatrixViewerAddGroupBlockStyle("users")}>
                        <div style={GVICMatrixViewerAddGroupRowStyle("users", false)}>
                          <span style={GVICMatrixViewerAddGroupDotStyle("users")} />
                          <span style={GVICMatrixViewerAddGroupTextStyle}>Users</span>
                        </div>
                        <div style={GVICMatrixViewerAddNestedUsersStyle}>
                          {ungroupedUsers.map((user) => {
                            const userID = user.user_id.trim();
                            const selectedUser = entryAlreadyIncluded({ kind: "user", id: userID });
                            return (
                              <button
                                key={user.user_id}
                                type="button"
                                onClick={() => chooseAddEntry({ kind: "user", id: userID })}
                                style={GVICMatrixViewerAddUserRowStyle(selectedUser)}
                              >
                                <span style={GVICMatrixViewerAddUserTextStyle}>{GVICMatrixViewerUserLabel(user, userID)}</span>
                                {selectedUser && <span aria-hidden="true" style={GVICMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          {!selectedInList && selectedUserID.trim() && (
            <div style={GVICMatrixViewerCurrentBlockStyle}>
              <div style={GVICMatrixViewerGroupTitleStyle}>Current view</div>
              {renderUserRow(selectedUserID, { key: `current:${selectedUserID}`, compact: true })}
            </div>
          )}
          <div style={GVICMatrixViewerEntriesStyle}>
            {effectiveEntries.length > 0
              ? effectiveEntries.map(renderEntry)
              : (
                <div style={GVICMatrixViewerGroupBlockStyle("company")}>
                  <div style={GVICMatrixViewerGroupHeaderStyle}>
                    <button
                      type="button"
                      aria-label={`${collapsedGroupKeys.has("company") ? "Expand" : "Collapse"} Company`}
                      onClick={() => toggleCollapsedGroup("company")}
                      style={GVICMatrixViewerCollapseButtonStyle}
                    >
                      {collapsedGroupKeys.has("company") ? "\u25b8" : "\u25be"}
                    </button>
                    <span style={GVICMatrixViewerGroupTitleStyle}>Company</span>
                  </div>
                  {!collapsedGroupKeys.has("company") && (
                    <div style={GVICMatrixViewerGroupUsersStyle}>
                      {companyUsers.map((user) => renderUserRow(user.user_id, { key: `company:${user.user_id}`, compact: true }))}
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
      <div style={GVICMatrixViewerSearchWrapStyle}>
        <input
          value={searchQuery}
          onFocus={() => setSearchOpen(true)}
          onChange={(event) => {
            setSearchQuery(event.currentTarget.value);
            setSearchOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && searchResults[0]) {
              event.preventDefault();
              selectUser(searchResults[0].user_id);
            }
            if (event.key === "Escape") setSearchOpen(false);
          }}
          placeholder="Search people"
          aria-label="Search GVIC matrix people"
          spellCheck={false}
          style={GVICMatrixViewerSearchInputStyle}
        />
        {searchOpen && searchQuery.trim() && (
          <div style={GVICMatrixViewerSearchResultsStyle}>
            {searchResults.length > 0
              ? searchResults.map((user) => renderUserRow(user.user_id, { key: `search:${user.user_id}`, compact: true }))
              : <div style={GVICMatrixViewerEmptyStyle}>No matches</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const GVICMatrixViewerSelectorRootStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 6,
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  flex: "0 1 auto",
  flexWrap: "nowrap",
};

function GVICMatrixViewerDropdownButtonStyle(open: boolean): React.CSSProperties {
  return {
    height: 28,
    minWidth: 142,
    maxWidth: 220,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "0 8px",
    border: `1px solid ${open ? "rgba(59, 130, 246, 0.48)" : "rgba(100, 116, 139, 0.20)"}`,
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.72)",
    color: "#334155",
    boxShadow: open ? "0 6px 16px rgba(59, 130, 246, 0.14)" : "inset 1px 1px 0 rgba(255, 255, 255, 0.88)",
    cursor: "pointer",
    font: "inherit",
    boxSizing: "border-box",
  };
}

const GVICMatrixViewerDropdownLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 800,
};

const GVICMatrixViewerChevronStyle: React.CSSProperties = {
  flex: "0 0 auto",
  fontSize: 10,
  fontWeight: 900,
  color: "#64748b",
};

const GVICMatrixViewerDropdownStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 34,
  width: 318,
  maxHeight: 420,
  overflowY: "auto",
  padding: 9,
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.94))",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.18), 0 1px 0 rgba(255, 255, 255, 0.96) inset",
  boxSizing: "border-box",
  zIndex: 30,
};

const GVICMatrixViewerEntriesStyle: React.CSSProperties = {
  display: "grid",
  gap: 9,
};

const GVICMatrixViewerColorPalette = [
  { accent: "#f97316", border: "rgba(249, 115, 22, 0.34)", tint: "rgba(255, 237, 213, 0.68)", soft: "rgba(249, 115, 22, 0.10)", text: "#9a3412" },
  { accent: "#06b6d4", border: "rgba(6, 182, 212, 0.34)", tint: "rgba(207, 250, 254, 0.66)", soft: "rgba(6, 182, 212, 0.10)", text: "#155e75" },
  { accent: "#22c55e", border: "rgba(34, 197, 94, 0.34)", tint: "rgba(220, 252, 231, 0.68)", soft: "rgba(34, 197, 94, 0.10)", text: "#166534" },
  { accent: "#8b5cf6", border: "rgba(139, 92, 246, 0.32)", tint: "rgba(237, 233, 254, 0.68)", soft: "rgba(139, 92, 246, 0.10)", text: "#5b21b6" },
  { accent: "#3b82f6", border: "rgba(59, 130, 246, 0.34)", tint: "rgba(219, 234, 254, 0.70)", soft: "rgba(59, 130, 246, 0.10)", text: "#1d4ed8" },
  { accent: "#ec4899", border: "rgba(236, 72, 153, 0.30)", tint: "rgba(252, 231, 243, 0.64)", soft: "rgba(236, 72, 153, 0.09)", text: "#9d174d" },
];

function GVICMatrixViewerColorForID(id: string): (typeof GVICMatrixViewerColorPalette)[number] {
  const clean = id.trim() || "default";
  let hash = 0;
  for (let index = 0; index < clean.length; index++) {
    hash = ((hash * 31) + clean.charCodeAt(index)) >>> 0;
  }
  return GVICMatrixViewerColorPalette[hash % GVICMatrixViewerColorPalette.length];
}

const GVICMatrixViewerCurrentBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  padding: 8,
  marginBottom: 8,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.88))",
  boxShadow: "0 5px 14px rgba(15, 23, 42, 0.08), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
};

function GVICMatrixViewerGroupBlockStyle(groupID: string): React.CSSProperties {
  const color = GVICMatrixViewerColorForID(groupID);
  return {
    display: "grid",
    gap: 7,
    padding: 7,
    border: `1px solid ${color.border}`,
    borderLeft: `3px solid ${color.accent}`,
    borderRadius: 8,
    background: `linear-gradient(145deg, rgba(255, 255, 255, 0.98), ${color.tint})`,
    boxShadow: `0 6px 16px rgba(15, 23, 42, 0.08), inset 1px 1px 0 rgba(255, 255, 255, 0.94), 0 0 0 1px ${color.soft}`,
  };
}

const GVICMatrixViewerGroupHeaderStyle: React.CSSProperties = {
  height: 30,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "0 4px",
  borderRadius: 6,
  background: "linear-gradient(145deg, rgba(248, 250, 252, 0.96), rgba(255, 255, 255, 0.82))",
  color: "#334155",
  boxShadow: "inset 1px 1px 0 rgba(255, 255, 255, 0.90)",
  boxSizing: "border-box",
};

const GVICMatrixViewerCollapseButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  flex: "0 0 22px",
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#64748b",
  cursor: "pointer",
  fontSize: 10,
  fontWeight: 900,
  fontFamily: "inherit",
  padding: 0,
  boxShadow: "0 2px 5px rgba(15, 23, 42, 0.06)",
};

const GVICMatrixViewerDragGripStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 12,
  color: "#94a3b8",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0,
};

const GVICMatrixViewerGroupTitleStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

const GVICMatrixViewerSmallIconButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.18)",
  borderRadius: 6,
  background: "#ffffff",
  color: "#64748b",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 900,
  fontFamily: "inherit",
  padding: 0,
};

const GVICMatrixViewerGroupUsersStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

function GVICMatrixViewerUserRowStyle(selected: boolean, compact?: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: compact ? 34 : 36,
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: compact ? "4px 6px 4px 9px" : "5px 7px",
    border: selected ? "1px solid rgba(37, 99, 235, 0.75)" : "1px solid rgba(148, 163, 184, 0.20)",
    borderRadius: 7,
    background: selected ? "linear-gradient(145deg, rgba(219, 234, 254, 0.95), rgba(239, 246, 255, 0.84))" : "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.86))",
    color: "#334155",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    boxShadow: selected ? "0 5px 13px rgba(37, 99, 235, 0.16), inset 1px 1px 0 rgba(255, 255, 255, 0.88)" : "0 4px 11px rgba(15, 23, 42, 0.07), inset 1px 1px 0 rgba(255, 255, 255, 0.90)",
    boxSizing: "border-box",
  };
}

const GVICMatrixViewerUserTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  display: "grid",
  gap: 1,
};

const GVICMatrixViewerUserLabelStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 800,
};

const GVICMatrixViewerUserEmailStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 10,
  fontWeight: 600,
  color: "#64748b",
};

const GVICMatrixViewerDeleteButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  flex: "0 0 auto",
  display: "inline-grid",
  placeItems: "center",
  borderRadius: 6,
  color: "#64748b",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 900,
};

const GVICMatrixViewerCheckStyle: React.CSSProperties = {
  width: 18,
  flex: "0 0 18px",
  color: "#2563eb",
  fontSize: 13,
  fontWeight: 900,
  textAlign: "center",
};

const GVICMatrixViewerCheckSpacerStyle: React.CSSProperties = {
  width: 18,
  flex: "0 0 18px",
};

const GVICMatrixViewerCustomizeStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  marginBottom: 8,
  paddingBottom: 8,
  borderBottom: "1px solid rgba(100, 116, 139, 0.14)",
};

const GVICMatrixViewerAddRowStyle: React.CSSProperties = {
  display: "block",
  position: "relative",
};

const GVICMatrixViewerAddMenuRootStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

function GVICMatrixViewerAddMenuButtonStyle(open: boolean): React.CSSProperties {
  return {
    width: "100%",
    height: 28,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    border: `1px solid ${open ? "rgba(59, 130, 246, 0.42)" : "rgba(100, 116, 139, 0.20)"}`,
    borderRadius: 7,
    background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.90))",
    color: "#334155",
    padding: "0 8px",
    fontSize: 11,
    fontWeight: 800,
    fontFamily: "inherit",
    cursor: "pointer",
    boxShadow: open ? "0 5px 13px rgba(59, 130, 246, 0.14)" : "inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
    boxSizing: "border-box",
  };
}

const GVICMatrixViewerAddMenuStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 32,
  zIndex: 40,
  width: "min(292px, calc(100vw - 32px))",
  maxHeight: 330,
  overflowY: "auto",
  display: "grid",
  gap: 7,
  padding: 8,
  border: "1px solid rgba(148, 163, 184, 0.28)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.99), rgba(248, 250, 252, 0.96))",
  boxShadow: "0 18px 38px rgba(15, 23, 42, 0.18), inset 1px 1px 0 rgba(255, 255, 255, 0.94)",
  boxSizing: "border-box",
};

function GVICMatrixViewerAddGroupBlockStyle(groupID: string): React.CSSProperties {
  const color = GVICMatrixViewerColorForID(groupID);
  return {
    display: "grid",
    gap: 4,
    padding: 5,
    border: `1px solid ${color.border}`,
    borderRadius: 7,
    background: `linear-gradient(145deg, rgba(255, 255, 255, 0.98), ${color.tint})`,
    boxShadow: "0 4px 11px rgba(15, 23, 42, 0.07), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
  };
}

function GVICMatrixViewerAddGroupRowStyle(groupID: string, selected: boolean): React.CSSProperties {
  const color = GVICMatrixViewerColorForID(groupID);
  return {
    minHeight: 28,
    display: "flex",
    alignItems: "center",
    gap: 7,
    border: `1px solid ${selected ? color.accent : "transparent"}`,
    borderRadius: 6,
    background: selected ? color.soft : "rgba(255, 255, 255, 0.62)",
    color: color.text,
    cursor: "pointer",
    padding: "0 7px",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 900,
    textAlign: "left",
    boxSizing: "border-box",
  };
}

function GVICMatrixViewerAddGroupDotStyle(groupID: string): React.CSSProperties {
  const color = GVICMatrixViewerColorForID(groupID);
  return {
    width: 8,
    height: 8,
    flex: "0 0 8px",
    borderRadius: 999,
    background: color.accent,
    boxShadow: `0 0 0 3px ${color.soft}`,
  };
}

const GVICMatrixViewerAddGroupTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const GVICMatrixViewerAddNestedUsersStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  paddingLeft: 20,
};

function GVICMatrixViewerAddUserRowStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 25,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: selected ? "1px solid rgba(59, 130, 246, 0.70)" : "1px solid transparent",
    borderRadius: 6,
    background: selected ? "rgba(219, 234, 254, 0.86)" : "rgba(255, 255, 255, 0.56)",
    color: "#334155",
    cursor: "pointer",
    padding: "0 7px",
    fontFamily: "inherit",
    fontSize: 11,
    fontWeight: 700,
    textAlign: "left",
    boxSizing: "border-box",
  };
}

const GVICMatrixViewerAddUserTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const GVICMatrixViewerAddSelectedStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 900,
};

const GVICMatrixViewerSearchWrapStyle: React.CSSProperties = {
  position: "relative",
  width: 190,
  minWidth: 150,
  flex: "0 0 190px",
};

const GVICMatrixViewerSearchInputStyle: React.CSSProperties = {
  width: "100%",
  height: 28,
  border: "1px solid rgba(100, 116, 139, 0.20)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.72)",
  color: "#334155",
  outline: "none",
  padding: "0 9px",
  fontSize: 11,
  fontWeight: 750,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const GVICMatrixViewerSearchResultsStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 34,
  width: "100%",
  minWidth: 230,
  maxHeight: 260,
  overflowY: "auto",
  padding: 6,
  border: "1px solid rgba(100, 116, 139, 0.20)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.97)",
  boxShadow: "0 16px 36px rgba(15, 23, 42, 0.16)",
  boxSizing: "border-box",
  zIndex: 31,
};

const GVICMatrixViewerEmptyStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const GVICMatrixHeaderLeftStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  overflow: "visible",
};

const GVICMatrixHeaderTitleStyle: React.CSSProperties = {
  ...panelTitleStyle,
  flex: "0 0 auto",
  minWidth: 78,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function formatInboxNotificationCount(count: number): string {
  const normalized = typeof count === "number" && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return normalized > 99 ? "99+" : String(normalized);
}

function logicGateInboxGroupNotificationButtonStyle(role: NotificationGVICRole): React.CSSProperties {
  return {
    ...logicGateInboxGroupNotificationStyle(role),
    border: logicGateInboxGroupNotificationStyle(role).border,
    cursor: "pointer",
    fontFamily: "inherit",
    padding: "0 4px",
  };
}

function logicGateInboxNodeNotificationButtonStyle(role: string): React.CSSProperties {
  return {
    ...logicGateInboxNodeNotificationStyle(role),
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
  seenNotificationIDs: string[];
};

function inboxNotificationMatchesGroup(item: NotificationItem, role: NotificationGVICRole, group: InboxLogicGateNodeGroup): boolean {
  if (item.role !== role || item.logic_gate_id !== group.logicGateID) return false;
  const nodeID = item.node_id?.trim() ?? "";
  return !nodeID || group.nodeIDs.includes(nodeID);
}

function inboxNotificationMatchesNode(item: NotificationItem, role: NotificationGVICRole, group: InboxLogicGateNodeGroup, nodeID: string): boolean {
  const cleanNodeID = nodeID.trim();
  return cleanNodeID !== "" && inboxNotificationMatchesGroup(item, role, group) && item.node_id?.trim() === cleanNodeID;
}

function InboxNotificationMenu({
  menu,
  onClose,
  onOpen,
  onClear,
}: {
  menu: InboxNotificationMenuState | null;
  onClose: () => void;
  onOpen: (notification: NotificationItem) => void;
  onClear: (menu: InboxNotificationMenuState) => void;
}) {
  if (!menu) return null;
  return (
    <NotificationPopover
      x={menu.x}
      y={menu.y}
      title={menu.title}
      loading={menu.loading}
      error={menu.error}
      items={menu.items}
      seenNotificationIDs={new Set(menu.seenNotificationIDs)}
      onClose={onClose}
      onOpen={onOpen}
      onClear={() => onClear(menu)}
    />
  );
}

export function GVICRoleInboxMatrix({
  section,
  loading,
  nodes,
  nodeByID,
  nodeRelationships,
  logicGateByID,
  nodeFolders,
  nodeFolderItems,
  currentUserID,
  viewerSelector,
  accountFilter,
  notificationSummary,
  selectedRowIDs,
  selectedLogicGateRowIDs,
  getNodeDragIDs,
  getLogicGateDragIDs,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onOpenLogicGateBulkMenuAt,
  onRequestDeleteLogicGate,
  onCreateNodeInLogicGate,
  onCreateLogicGateInCell,
  onCreateNodeInCell,
  onDropNodes,
  onDropNodesInCell,
  onDropLogicGates,
}: {
  section: (typeof GVIC_INBOX_SECTIONS)[number];
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  nodeRelationships: NodeRelationship[];
  logicGateByID: Map<string, LogicGateRecord>;
  nodeFolders: CompanyExplorerFolder[];
  nodeFolderItems: CompanyExplorerFolderItem[];
  currentUserID: string;
  viewerSelector?: React.ReactNode;
  accountFilter?: React.ReactNode;
  notificationSummary: NotificationSummary;
  selectedRowIDs: Set<string>;
  selectedLogicGateRowIDs: Set<string>;
  getNodeDragIDs: (nodeID: string) => string[];
  getLogicGateDragIDs: (logicGateID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate: (logicGateID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string, informationID?: string) => void;
  onOpenNodeBulkMenu: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenuAt: (logicGateID: string, x: number, y: number) => void;
  onRequestDeleteLogicGate: (logicGateID: string, position?: ConfirmActionMenuPosition) => void;
  onCreateNodeInLogicGate: (input: InboxNodeDropInput) => void;
  onCreateLogicGateInCell: (input: InboxCellCreateInput) => void;
  onCreateNodeInCell: (input: InboxCellCreateInput) => void;
  onDropNodes: (input: InboxNodeDropInput) => void;
  onDropNodesInCell: (input: InboxCellNodeDropInput) => void;
  onDropLogicGates: (input: InboxCellLogicGateDropInput) => void;
}) {
  const allCellLogicGateGroups = useMemo(() => buildGVICRoleInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID, section.role), [currentUserID, logicGateByID, nodeByID, nodes, section.role]);
  const { groupHeights, startGroupResize } = useInboxGroupCardHeights(section.viewID);
  const { collapsedGroupKeys, toggleCollapsedGroup } = useInboxGroupCollapsedState(section.viewID);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeDropKey, setActiveDropKey] = useState("");
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<InboxNotificationMenuState | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<(InboxCellCreateInput & { x: number; y: number }) | null>(null);
  const creatorGVICRole = section.role === "other" ? undefined : section.role;
  const notificationRole: NotificationGVICRole = section.role;
  const cellLogicGateGroups = useMemo(() => filterInboxGroupMapForUnread(allCellLogicGateGroups, notificationSummary, notificationRole, unreadOnly), [allCellLogicGateGroups, notificationRole, notificationSummary, unreadOnly]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of GVIC_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(GVICRoleCellKey(section.role, column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups, section.role]);
  const orderedLogicGateRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of GVIC_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(GVICRoleCellKey(section.role, column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(group.logicGateID);
      }
    }
    return cleanIDList(ids).filter((id) => id !== INBOX_NO_LOGIC_GATE_ID).map(logicGateTreeID);
  }, [cellLogicGateGroups, section.role]);
  const placedCount = orderedRowIDs.length;
  const openGroupNotifications = useCallback((event: React.MouseEvent, role: NotificationGVICRole, group: InboxLogicGateNodeGroup) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      title: `${group.label} updates`,
      loading: true,
      error: "",
      items: [],
      seenNotificationIDs: [],
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
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load updates" }
            : current
        ));
      });
  }, []);
  const openNodeNotifications = useCallback((event: React.MouseEvent, role: NotificationGVICRole, group: InboxLogicGateNodeGroup, nodeID: string) => {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeByID.get(nodeID);
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      title: `${node ? nodeTitle(node) : "Node"} updates`,
      loading: true,
      error: "",
      items: [],
      seenNotificationIDs: [],
    };
    setNotificationMenu(nextMenu);
    fetchNotifications({ companyID: getActiveCompanyID(), unreadOnly: true, limit: 100 })
      .then((items) => {
        const filtered = items.filter((item) => inboxNotificationMatchesNode(item, role, group, nodeID));
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, items: filtered }
            : current
        ));
      })
      .catch((error) => {
        setNotificationMenu((current) => (
          current?.x === nextMenu.x && current?.y === nextMenu.y
            ? { ...current, loading: false, error: error instanceof Error ? error.message : "Failed to load updates" }
            : current
        ));
      });
  }, [nodeByID]);
  const openNotificationTarget = useCallback((notification: NotificationItem) => {
    const notificationID = notification.notification_id.trim();
    if (notificationID) {
      setNotificationMenu((current) => {
        if (!current) return current;
        const seen = new Set(current.seenNotificationIDs);
        seen.add(notificationID);
        return { ...current, seenNotificationIDs: Array.from(seen) };
      });
      setNotificationMenu((current) => current ? { ...current, items: current.items.filter((item) => item.notification_id !== notificationID) } : current);
      void deleteNotification(notificationID, notification.company_id || getActiveCompanyID()).catch((error) => console.error("Failed to delete notification", error));
    }
    const informationID = notification.information_id?.trim() ?? "";
    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    const node = nodeID ? nodeByID.get(nodeID) : undefined;
    if (node) {
      onOpenNode(node, informationID || undefined);
      return;
    }
    if (logicGateID) onOpenLogicGate(logicGateID, notification.title || logicGateID, nodeID, informationID || undefined);
  }, [nodeByID, onOpenLogicGate, onOpenNode]);
  const clearGroupNotifications = useCallback((menu: InboxNotificationMenuState) => {
    const notificationIDs = menu.items.map((item) => item.notification_id.trim()).filter(Boolean);
    if (menu.loading || notificationIDs.length === 0) return;
    setNotificationMenu((current) => current ? { ...current, items: [], seenNotificationIDs: [] } : current);
    void Promise.all(notificationIDs.map((notificationID) => deleteNotification(notificationID, getActiveCompanyID()))).catch((error) => {
      console.error("Failed to clear updates", error);
      setNotificationMenu((current) => current ? { ...current, error: error instanceof Error ? error.message : "Failed to clear updates" } : current);
    });
  }, []);
  const openCellCreateMenu = useCallback((event: React.MouseEvent, input: InboxCellCreateInput) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCellContextMenu({ ...input, x: event.clientX, y: event.clientY });
  }, []);
  const readCellDropPayload = useCallback((dataTransfer: DataTransfer) => {
    const explorerPayload = readExplorerDragPayload(dataTransfer);
    const matrixNodePayload = readInboxNodeDragPayload(dataTransfer);
    const matrixLogicGatePayload = readInboxLogicGateDragPayload(dataTransfer);
    const nodeIDs = cleanIDList([
      ...nodeIDsFromExplorerPayload(explorerPayload, nodeFolders, nodeFolderItems),
      ...(matrixNodePayload?.nodeIDs ?? []),
    ]).filter((nodeID) => nodeByID.has(nodeID));
    const logicGateIDs = cleanIDList([
      ...logicGateIDsFromExplorerPayload(explorerPayload, [], []),
      ...(matrixLogicGatePayload?.logicGateIDs ?? []),
    ]).filter((logicGateID) => logicGateByID.has(logicGateID));
    return {
      nodeIDs,
      logicGateIDs,
      fromLogicGateID: matrixNodePayload?.fromLogicGateID,
      nodeIDsByLogicGateID: matrixLogicGatePayload?.nodeIDsByLogicGateID,
    };
  }, [logicGateByID, nodeByID, nodeFolderItems, nodeFolders]);

  return (
    <>
    <section style={logicGateGVICPanelStyle}>
      <div style={logicGateGVICMatrixSurfaceStyle}>
        <div style={logicGateGVICHeaderStyle}>
          <div style={GVICMatrixHeaderLeftStyle}>
            <h2 style={GVICMatrixHeaderTitleStyle}>{section.title}</h2>
            {viewerSelector}
          </div>
          <div style={inboxMatrixHeaderControlsStyle}>
            {accountFilter}
            <InboxMatrixUnreadToggle unreadOnly={unreadOnly} onChange={setUnreadOnly} />
            <div style={inboxMatrixHeaderMetaStyle}>
              {placedCount > 0 && <span>{placedCount} active</span>}
              {loading && <span>Loading</span>}
            </div>
          </div>
        </div>
        <div className="kanban-board-scroll" style={logicGateGVICScrollStyle}>
          <div style={inboxMatrixGridStyle(GVIC_STATUS_COLUMNS.length)}>
            <div className="mango-inbox-matrix-cell" data-rail-right="true" data-rail-bottom="true" style={logicGateGVICCornerStyle} />
            {GVIC_STATUS_COLUMNS.map((column, columnIndex) => (
              <div
                key={column.status}
                className="mango-inbox-matrix-cell"
                data-rail-right={columnIndex === GVIC_STATUS_COLUMNS.length - 1 ? undefined : "true"}
                data-rail-bottom="true"
                style={logicGateGVICColumnHeaderStyle(column.status)}
              >
                <strong style={logicGateGVICColumnLetterStyle(column.status)}>{column.letter}</strong>
                <span style={logicGateGVICColumnLabelStyle(column.status)}>{column.label}</span>
              </div>
            ))}
            {INBOX_PRIORITIES.map((priority, priorityIndex) => (
              <React.Fragment key={priority.value}>
                <div
                  className="mango-inbox-matrix-cell"
                  data-rail-right="true"
                  data-rail-bottom={priorityIndex === INBOX_PRIORITIES.length - 1 ? undefined : "true"}
                  style={logicGateGVICPriorityHeaderStyle(priority.value)}
                >
                  {priority.label}
                </div>
                {GVIC_STATUS_COLUMNS.map((column, columnIndex) => {
                  const cellKey = GVICRoleCellKey(section.role, column.status, priority.value);
                  const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                  const statusColor = gvicStatusColor(column.status);
                  const cellDropKey = `cell:${cellKey}`;
                  const cellStyle = logicGateGVICCellStyle(activeDropKey === cellDropKey);
                  return (
                    <div
                      key={cellKey}
                      className="mango-inbox-matrix-cell"
                      data-rail-right={columnIndex === GVIC_STATUS_COLUMNS.length - 1 ? undefined : "true"}
                      data-rail-bottom={priorityIndex === INBOX_PRIORITIES.length - 1 ? undefined : "true"}
                      style={cellStyle}
                      onContextMenu={(event) => openCellCreateMenu(event, {
                        priority: priority.value,
                        status: column.status,
                        creatorGVICRole,
                      })}
                      onDragOver={(event) => {
                        const drop = readCellDropPayload(event.dataTransfer);
                        if (drop.nodeIDs.length === 0 && drop.logicGateIDs.length === 0) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = drop.logicGateIDs.length > 0 || drop.fromLogicGateID ? "move" : "copy";
                        setActiveDropKey(cellDropKey);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setActiveDropKey((current) => current === cellDropKey ? "" : current);
                        }
                      }}
                      onDrop={(event) => {
                        const drop = readCellDropPayload(event.dataTransfer);
                        setActiveDropKey((current) => current === cellDropKey ? "" : current);
                        if (drop.nodeIDs.length === 0 && drop.logicGateIDs.length === 0) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (drop.logicGateIDs.length > 0) {
                          onDropLogicGates({
                            logicGateIDs: drop.logicGateIDs,
                            priority: priority.value,
                            status: column.status,
                            creatorGVICRole,
                            nodeIDsByLogicGateID: drop.nodeIDsByLogicGateID,
                          });
                        }
                        if (drop.nodeIDs.length > 0) {
                          onDropNodesInCell({
                            nodeIDs: drop.nodeIDs,
                            priority: priority.value,
                            status: column.status,
                            creatorGVICRole,
                            fromLogicGateID: drop.fromLogicGateID,
                          });
                        }
                      }}
                    >
                      {logicGateGroups.map((group) => {
                        const resizeKey = inboxGroupResizeKey(cellKey, group);
                        return (
                          <LogicGateInboxNodeGroupCard
                            key={group.logicGateID}
                            group={group}
                            dragNodeIDs={(allCellLogicGateGroups.get(cellKey) ?? []).find((item) => item.logicGateID === group.logicGateID)?.nodeIDs ?? group.nodeIDs}
                            selectedRowIDs={selectedRowIDs}
                            selectedLogicGate={selectedLogicGateRowIDs.has(logicGateTreeID(group.logicGateID))}
                            orderedLogicGateRowIDs={orderedLogicGateRowIDs}
                            orderedRowIDs={orderedRowIDs}
                            nodeByID={nodeByID}
                            nodeRelationships={nodeRelationships}
                            nodeFolders={nodeFolders}
                            nodeFolderItems={nodeFolderItems}
                            getNodeDragIDs={getNodeDragIDs}
                            getLogicGateDragIDs={getLogicGateDragIDs}
                            logicGateByID={logicGateByID}
                            onSelectNode={onSelectNode}
                            onSelectLogicGate={onSelectLogicGate}
                            onOpenNode={onOpenNode}
                            onOpenLogicGate={onOpenLogicGate}
                            onOpenNodeBulkMenu={onOpenNodeBulkMenu}
                            onOpenLogicGateBulkMenu={onOpenLogicGateBulkMenu}
                            onOpenLogicGateBulkMenuAt={onOpenLogicGateBulkMenuAt}
                            onRequestDeleteLogicGate={onRequestDeleteLogicGate}
                            onCreateLogicGate={() => onCreateLogicGateInCell({ priority: priority.value, status: column.status, creatorGVICRole })}
                            onCreateNode={() => onCreateNodeInLogicGate({ logicGateID: group.logicGateID, nodeIDs: [], priority: priority.value, status: column.status })}
                            onDropNodes={(nodeIDs, fromLogicGateID) => onDropNodes({ logicGateID: group.logicGateID, nodeIDs, priority: priority.value, status: column.status, fromLogicGateID })}
                            dropActive={activeDropKey === resizeKey}
                            onDropActiveChange={(active) => setActiveDropKey(active ? resizeKey : "")}
                            notificationSummary={notificationSummary}
                            notificationCount={notificationCountForInboxGroup(notificationSummary, notificationRole, group)}
                            notificationRole={notificationRole}
                            onOpenNotifications={(event) => openGroupNotifications(event, notificationRole, group)}
                            onOpenNodeNotifications={(event, nodeID) => openNodeNotifications(event, notificationRole, group, nodeID)}
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
      </div>
    </section>
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} />
    {cellContextMenu && (
      <FrameRightClickMenu x={cellContextMenu.x} y={cellContextMenu.y} onClose={() => setCellContextMenu(null)} width={HOME_COMPACT_CONTEXT_MENU_WIDTH}>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            const input = { priority: cellContextMenu.priority, status: cellContextMenu.status, creatorGVICRole: cellContextMenu.creatorGVICRole };
            setCellContextMenu(null);
            onCreateLogicGateInCell(input);
          }}
        >
          Create Logic Gate
        </button>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            const input = { priority: cellContextMenu.priority, status: cellContextMenu.status, creatorGVICRole: cellContextMenu.creatorGVICRole };
            setCellContextMenu(null);
            onCreateNodeInCell(input);
          }}
        >
          Create Note
        </button>
      </FrameRightClickMenu>
    )}
    <InboxNotificationMenu menu={notificationMenu} onClose={() => setNotificationMenu(null)} onOpen={openNotificationTarget} onClear={clearGroupNotifications} />
  </>
  );
}

export function LogicGateInboxNodeGroupCard({
  group,
  dragNodeIDs,
  selectedRowIDs,
  selectedLogicGate = false,
  orderedLogicGateRowIDs = [],
  orderedRowIDs,
  nodeByID,
  nodeRelationships = [],
  nodeFolders = [],
  nodeFolderItems = [],
  getNodeDragIDs,
  getLogicGateDragIDs,
  logicGateByID,
  onSelectNode,
  onSelectLogicGate,
  onOpenNode,
  onOpenLogicGate,
  onOpenNodeBulkMenu,
  onOpenLogicGateBulkMenu,
  onOpenLogicGateBulkMenuAt,
  onRequestDeleteLogicGate,
  onCreateLogicGate,
  onCreateNode,
  onDropNodes,
  dropActive = false,
  onDropActiveChange,
  notificationSummary,
  notificationCount = 0,
  notificationRole,
  onOpenNotifications,
  onOpenNodeNotifications,
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
  dragNodeIDs?: string[];
  selectedRowIDs: Set<string>;
  selectedLogicGate?: boolean;
  orderedLogicGateRowIDs?: string[];
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  nodeRelationships?: NodeRelationship[];
  nodeFolders?: CompanyExplorerFolder[];
  nodeFolderItems?: CompanyExplorerFolderItem[];
  getNodeDragIDs: (nodeID: string) => string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onSelectLogicGate?: (logicGateID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord, informationID?: string) => void;
  onOpenLogicGate: (logicGateID: string, label: string, nodeID: string, informationID?: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenu?: (logicGateID: string, event: React.MouseEvent) => void;
  onOpenLogicGateBulkMenuAt?: (logicGateID: string, x: number, y: number) => void;
  onRequestDeleteLogicGate?: (logicGateID: string, position?: ConfirmActionMenuPosition) => void;
  onCreateLogicGate?: () => void;
  onCreateNode?: () => void;
  getLogicGateDragIDs?: (logicGateID: string) => string[];
  logicGateByID?: Map<string, LogicGateRecord>;
  onDropNodes?: (nodeIDs: string[], fromLogicGateID?: string) => void;
  dropActive?: boolean;
  onDropActiveChange?: (active: boolean) => void;
  notificationSummary?: NotificationSummary;
  notificationCount?: number;
  notificationRole?: NotificationGVICRole;
  onOpenNotifications?: (event: React.MouseEvent) => void;
  onOpenNodeNotifications?: (event: React.MouseEvent, nodeID: string) => void;
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
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number } | null>(null);
  const selectedNodeIDsForMenu = useMemo(() => cleanIDList(Array.from(selectedRowIDs).map(nodeIDFromTreeID)).filter((nodeID) => nodeByID.has(nodeID)), [nodeByID, selectedRowIDs]);
  const explicitHeight = !collapsed && typeof heightPx === "number" && Number.isFinite(heightPx);
  const groupStyleBase = explicitHeight
    ? { ...logicGateInboxGroupStyle, height: clampInboxGroupHeight(heightPx), gridTemplateRows: "44px minmax(0, 1fr)" }
    : collapsed
      ? { ...logicGateInboxGroupStyle, aspectRatio: "auto", gridTemplateRows: "44px" }
      : logicGateInboxGroupStyle;
  const groupStyle = {
    ...groupStyleBase,
    border: selectedLogicGate || dropActive ? `1px solid ${HOME_CYAN}` : groupStyleBase.border,
    background: groupStyleBase.background,
    boxShadow: selectedLogicGate
      ? `0 0 0 2px ${homeColorWithAlpha(HOME_CYAN, 0.16)} inset`
      : dropActive
        ? `0 0 0 2px ${homeColorWithAlpha(HOME_CYAN, 0.20)} inset`
        : groupStyleBase.boxShadow,
  };
  const nodeListStyle = explicitHeight
    ? { ...logicGateInboxNodeListStyle, maxHeight: "none" }
    : logicGateInboxNodeListStyle;
  const nodeRows = useMemo(() => buildNodeRelationshipHierarchyRows({
    nodeIDs: group.nodeIDs,
    nodes: group.nodeIDs.map((nodeID) => nodeByID.get(nodeID)).filter((node): node is NodeRecord => Boolean(node)),
    relationships: nodeRelationships,
  }), [group.nodeIDs, nodeByID, nodeRelationships]);
  const readDroppedNodes = (dataTransfer: DataTransfer): InboxNodeDragPayload => {
    const matrixPayload = readInboxNodeDragPayload(dataTransfer);
    const explorerNodeIDs = hasExplorerDrag(dataTransfer)
      ? nodeIDsFromExplorerPayload(readExplorerDragPayload(dataTransfer), nodeFolders, nodeFolderItems)
      : [];
    const nodeIDs = cleanIDList([...(matrixPayload?.nodeIDs ?? []), ...explorerNodeIDs])
      .filter((nodeID) => nodeByID.has(nodeID));
    return { nodeIDs, fromLogicGateID: matrixPayload?.fromLogicGateID };
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
      draggable={canOpenLogicGate && !!getLogicGateDragIDs && !!logicGateByID}
      style={groupStyle}
      onContextMenu={openGroupContextMenu}
      onDragStart={(event) => {
        if (!canOpenLogicGate || !getLogicGateDragIDs || !logicGateByID) return;
        const dragIDs = getLogicGateDragIDs(group.logicGateID);
        setLogicGateDragData(event.dataTransfer, dragIDs, logicGateByID);
        setInboxLogicGateDragPayload(event.dataTransfer, dragIDs, { [group.logicGateID]: dragNodeIDs ?? group.nodeIDs });
      }}
      onDragOver={(event) => {
        const drop = readDroppedNodes(event.dataTransfer);
        if (!canOpenLogicGate || !onDropNodes || drop.nodeIDs.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = drop.fromLogicGateID ? "move" : "copy";
        onDropActiveChange?.(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onDropActiveChange?.(false);
      }}
      onDrop={(event) => {
        const drop = readDroppedNodes(event.dataTransfer);
        onDropActiveChange?.(false);
        if (!canOpenLogicGate || !onDropNodes || drop.nodeIDs.length === 0) return;
        event.preventDefault();
        event.stopPropagation();
        onDropNodes(drop.nodeIDs, drop.fromLogicGateID);
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
          onOpenLogicGate(group.logicGateID, group.label, "");
        }}
      >
        <span style={logicGateInboxGroupIconStyle}><ExplorerRowIcon kind="logic_gate" /></span>
        <span style={logicGateInboxGroupTitleStyle}>{group.label}</span>
        {notificationCount > 0 && notificationRole && (
          <button
            type="button"
            title="Show updates"
            aria-label="Show updates"
            style={logicGateInboxGroupNotificationButtonStyle(notificationRole)}
            draggable={false}
            onPointerDown={(event) => event.stopPropagation()}
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
            style={logicGateInboxGroupDisclosureStyle}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleCollapsed();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <ExplorerDisclosureIcon open={!collapsed} color="currentColor" />
          </button>
        )}
      </div>
      {!collapsed && <div className="kanban-board-scroll" style={nodeListStyle}>
        {nodeRows.map((row) => {
          const node = nodeByID.get(row.nodeID);
          if (!node) return null;
          const nodeNotificationCount = notificationCountForInboxNode(notificationSummary, group, row.nodeID, notificationRole);
          return (
            <LogicGateInboxNodeRow
              key={row.nodeID}
              node={node}
              depth={row.depth}
              selected={selectedRowIDs.has(nodeTreeID(row.nodeID))}
              orderedRowIDs={orderedRowIDs}
              nodeByID={nodeByID}
              getNodeDragIDs={getNodeDragIDs}
              sourceLogicGateID={group.logicGateID}
              sourceGroupNodeIDs={dragNodeIDs ?? group.nodeIDs}
              onSelectNode={onSelectNode}
              onOpenNode={onOpenNode}
              onOpenNodeBulkMenu={onOpenNodeBulkMenu}
              onOpenPinContextMenu={onOpenPinContextMenu}
              onRemovePlacement={canRemoveNode?.(row.nodeID) ? onRemovePlacement : undefined}
              hasUnreadNotification={nodeNotificationCount > 0}
              notificationCount={nodeNotificationCount}
              notificationRole={notificationRole}
              onOpenNotifications={onOpenNodeNotifications}
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
        <FrameRightClickMenu x={groupContextMenu.x} y={groupContextMenu.y} onClose={() => setGroupContextMenu(null)} width={HOME_COMPACT_CONTEXT_MENU_WIDTH}>
          {onCreateLogicGate && (
            <button
              type="button"
              style={sharedInboxContextMenuButtonStyle}
              onClick={() => {
                setGroupContextMenu(null);
                onCreateLogicGate();
              }}
            >
              Create Logic Gate
            </button>
          )}
          {onCreateNode && (
            <button
              type="button"
              style={sharedInboxContextMenuButtonStyle}
              onClick={() => {
                setGroupContextMenu(null);
                onCreateNode();
              }}
            >
              Create Note
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
              openAppPathInNewTab(buildLogicGateRoute(group.logicGateID));
              setGroupContextMenu(null);
            }}
          >
            Open in new browser tab
          </button>
          <button
            type="button"
            style={sharedInboxContextMenuButtonStyle}
            onClick={() => {
              requestAppSidebarPin({ kind: "logic_gate", id: group.logicGateID, name: group.label });
              setGroupContextMenu(null);
            }}
          >
            Pin Logic Gate
          </button>
          {onRequestDeleteLogicGate && (
            <button
              type="button"
              style={{ ...sharedInboxContextMenuButtonStyle, color: "#dc2626" }}
              onClick={(event) => {
                onRequestDeleteLogicGate(group.logicGateID, confirmMenuPositionFromElement(event.currentTarget));
              }}
            >
              Delete
            </button>
          )}
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
  sourceLogicGateID,
  sourceGroupNodeIDs = [],
  onSelectNode,
  onOpenNode,
  onOpenNodeBulkMenu,
  onOpenPinContextMenu,
  onRemovePlacement,
  hasUnreadNotification = false,
  notificationCount = 0,
  notificationRole,
  onOpenNotifications,
}: {
  node: NodeRecord;
  depth?: number;
  selected: boolean;
  orderedRowIDs: string[];
  nodeByID: Map<string, NodeRecord>;
  getNodeDragIDs: (nodeID: string) => string[];
  sourceLogicGateID?: string;
  sourceGroupNodeIDs?: string[];
  onSelectNode: (nodeID: string, orderedIDs: string[], event: React.MouseEvent) => void;
  onOpenNode: (node: NodeRecord, informationID?: string) => void;
  onOpenNodeBulkMenu?: (nodeID: string, event: React.MouseEvent) => void;
  onOpenPinContextMenu?: (event: React.MouseEvent, target: Omit<HomePinContextMenuState, "x" | "y">) => void;
  onRemovePlacement?: (nodeID: string) => void;
  hasUnreadNotification?: boolean;
  notificationCount?: number;
  notificationRole?: NotificationGVICRole;
  onOpenNotifications?: (event: React.MouseEvent, nodeID: string) => void;
}) {
  const nodeID = node.node_id;
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      data-inbox-node-row="true"
      draggable
      style={logicGateInboxNodeRowStyle(selected, hovered, hasUnreadNotification)}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
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
        const sourceIDs = new Set(sourceGroupNodeIDs);
        const sourceLogicGateIDForDrag = sourceLogicGateID?.trim() ?? "";
        const canUseSourceLogicGate = !!sourceLogicGateIDForDrag && dragIDs.every((dragID) => sourceIDs.has(dragID));
        setInboxNodeDragPayload(event.dataTransfer, dragIDs, canUseSourceLogicGate ? sourceLogicGateIDForDrag : undefined);
        event.stopPropagation();
      }}
    >
      <span style={logicGateInboxNodeGuideStyle} />
      <span style={logicGateInboxNodeIconStyle}><ExplorerRowIcon kind="node" /></span>
      <span style={logicGateInboxNodeTitleStyle(hasUnreadNotification)}>{nodeTitle(node)}</span>
      {notificationCount > 0 && onOpenNotifications && (
        <button
          type="button"
          title={`${formatInboxNotificationCount(notificationCount)} unread updates`}
          aria-label="Show node updates"
          style={logicGateInboxNodeNotificationButtonStyle(notificationRole ?? "")}
          draggable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onOpenNotifications?.(event, nodeID);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {formatInboxNotificationCount(notificationCount)}
        </button>
      )}
      {onRemovePlacement && (
        <button
          type="button"
          aria-label={`Remove ${nodeTitle(node)} from matrix`}
          style={logicGateInboxNodeRemoveStyle}
          onClick={(event) => {
            event.stopPropagation();
            onRemovePlacement(nodeID);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          x
        </button>
      )}
    </div>
  );
}

const COMPOSE_ATTACHMENT_MAX_TOTAL_BYTES = 24_000_000;

function formatComposeAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size >= 1_000_000) return `${(size / 1_000_000).toFixed(1)} MB`;
  if (size >= 1_000) return `${Math.ceil(size / 1_000)} KB`;
  return `${size} B`;
}

function emailAttachmentFileName(attachment: EmailAttachment): string {
  return attachment.filename?.trim() || "attachment";
}

function emailAttachmentContentType(attachment: EmailAttachment): string {
  return attachment.content_type?.trim() || "application/octet-stream";
}

function attachmentIsImageContentType(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith("image/");
}

function attachmentCanRenderInline(contentType: string): boolean {
  const cleanType = contentType.trim().toLowerCase();
  return attachmentIsImageContentType(cleanType) || cleanType.startsWith("application/pdf");
}

function emailAttachmentIsImage(attachment: EmailAttachment): boolean {
  return attachmentIsImageContentType(emailAttachmentContentType(attachment));
}

function emailAttachmentDataURL(attachment: EmailAttachment): string {
  const content = attachment.content?.trim() ?? "";
  if (!content) return "";
  return `data:${emailAttachmentContentType(attachment)};base64,${content}`;
}

function downloadURL(url: string, filename: string, revoke = false): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openAttachmentURL(url: string, filename: string, revoke = false): void {
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
    if (revoke) window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }
  downloadURL(url, filename, revoke);
}

function attachmentExtension(filename: string, contentType: string): string {
  const cleanName = filename.trim();
  const dotIndex = cleanName.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < cleanName.length - 1) {
    return cleanName.slice(dotIndex + 1, dotIndex + 6).toUpperCase();
  }
  const subtype = contentType.trim().toLowerCase().split("/")[1]?.split(";")[0]?.split("+")[0] ?? "";
  if (!subtype || subtype === "octet-stream") return "FILE";
  if (subtype === "jpeg") return "JPG";
  if (subtype === "plain") return "TXT";
  if (subtype.length > 5) return subtype.slice(0, 5).toUpperCase();
  return subtype.toUpperCase();
}

function attachmentKindLabel(contentType: string): string {
  const cleanType = contentType.trim().toLowerCase();
  if (cleanType.startsWith("image/")) return "Image";
  if (cleanType.startsWith("video/")) return "Video";
  if (cleanType.startsWith("audio/")) return "Audio";
  if (cleanType.startsWith("application/pdf")) return "PDF";
  if (cleanType.includes("spreadsheet") || cleanType.includes("excel")) return "Sheet";
  if (cleanType.includes("presentation") || cleanType.includes("powerpoint")) return "Slides";
  if (cleanType.includes("word") || cleanType.includes("document")) return "Doc";
  if (cleanType.startsWith("text/")) return "Text";
  return "File";
}

function attachmentAccent(contentType: string): { background: string; color: string; stripe: string } {
  const cleanType = contentType.trim().toLowerCase();
  if (cleanType.startsWith("image/")) return { background: "linear-gradient(145deg, #eef9ff, #f8fbff)", color: "#0369a1", stripe: "#38bdf8" };
  if (cleanType.startsWith("application/pdf")) return { background: "linear-gradient(145deg, #fff1f2, #fff7ed)", color: "#be123c", stripe: "#fb7185" };
  if (cleanType.includes("spreadsheet") || cleanType.includes("excel")) return { background: "linear-gradient(145deg, #ecfdf5, #f7fee7)", color: "#047857", stripe: "#34d399" };
  if (cleanType.includes("presentation") || cleanType.includes("powerpoint")) return { background: "linear-gradient(145deg, #fff7ed, #fffbeb)", color: "#c2410c", stripe: "#fb923c" };
  if (cleanType.includes("word") || cleanType.includes("document")) return { background: "linear-gradient(145deg, #eff6ff, #f8fafc)", color: "#1d4ed8", stripe: "#60a5fa" };
  if (cleanType.startsWith("audio/") || cleanType.startsWith("video/")) return { background: "linear-gradient(145deg, #f5f3ff, #faf5ff)", color: "#6d28d9", stripe: "#a78bfa" };
  return { background: "linear-gradient(145deg, #ffffff, #f1f5f9)", color: "#475569", stripe: "#94a3b8" };
}

function attachmentTileStyle(interactive: boolean, highlighted: boolean): React.CSSProperties {
  return {
    ...mailAttachmentTileStyle,
    position: "relative",
    gap: 7,
    cursor: interactive ? "grab" : "default",
    borderColor: highlighted ? "rgba(14, 165, 233, 0.34)" : mailAttachmentTileStyle.borderColor,
    boxShadow: highlighted ? "0 14px 30px rgba(15, 23, 42, 0.12), inset 1px 1px 0 rgba(255, 255, 255, 0.9)" : mailAttachmentTileStyle.boxShadow,
  };
}

const attachmentPreviewWrapStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

function attachmentActionButtonStyle(visible: boolean): React.CSSProperties {
  return {
    position: "absolute",
    right: 7,
    bottom: 7,
    width: 28,
    height: 28,
    display: "grid",
    placeItems: "center",
    border: "1px solid rgba(255, 255, 255, 0.82)",
    borderRadius: 7,
    background: "rgba(15, 23, 42, 0.86)",
    color: "#ffffff",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.22)",
    cursor: "pointer",
    padding: 0,
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? "auto" : "none",
    transition: "opacity 140ms ease, transform 140ms ease",
    transform: visible ? "translateY(0)" : "translateY(3px)",
  };
}

const DownloadAttachmentIcon: React.FC = () => (
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M8 2.5v7.2" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
    <path d="m4.8 6.7 3.2 3.2 3.2-3.2" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.1 12.8h9.8" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" />
  </svg>
);

function attachmentRemoveButtonStyle(visible: boolean): React.CSSProperties {
  return {
    ...mailComposeAttachmentRemoveStyle,
    position: "absolute",
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    display: "grid",
    placeItems: "center",
    border: "1px solid rgba(255, 255, 255, 0.82)",
    borderRadius: 999,
    background: "rgba(15, 23, 42, 0.78)",
    color: "#ffffff",
    boxShadow: "0 8px 18px rgba(15, 23, 42, 0.18)",
    opacity: visible ? 1 : 0.86,
  };
}

function AttachmentVisual({ filename, contentType, sourceURL, loading, failed }: {
  filename: string;
  contentType: string;
  sourceURL?: string;
  loading?: boolean;
  failed?: boolean;
}) {
  const cleanType = contentType.trim() || "application/octet-stream";
  if (sourceURL && attachmentIsImageContentType(cleanType)) {
    return <img src={sourceURL} alt={filename} style={mailAttachmentThumbnailStyle} />;
  }
  if (sourceURL && cleanType.toLowerCase().startsWith("application/pdf")) {
    return (
      <object data={sourceURL} type="application/pdf" aria-label={filename} style={mailAttachmentThumbnailStyle}>
        <div style={mailAttachmentFileIconStyle}>PDF</div>
      </object>
    );
  }
  const accent = attachmentAccent(cleanType);
  const extension = attachmentExtension(filename, cleanType);
  return (
    <div style={{
      ...mailAttachmentFileIconStyle,
      position: "relative",
      overflow: "hidden",
      alignContent: "center",
      gap: 5,
      background: accent.background,
      color: accent.color,
      padding: 10,
    }}>
      <span style={{ position: "absolute", top: 0, left: 0, right: 0, height: 5, background: accent.stripe }} />
      <span style={{ fontSize: 18, lineHeight: 1, fontWeight: 840 }}>{failed ? "!" : loading ? "..." : extension}</span>
      <span style={{ fontSize: 10, color: "rgba(15, 23, 42, 0.58)", fontWeight: 720 }}>{failed ? "Preview unavailable" : attachmentKindLabel(cleanType)}</span>
    </div>
  );
}

function EmailAttachmentTile({ messageID, attachment, companyID, sharedInboxID }: {
  messageID: string;
  attachment: EmailAttachment;
  companyID: string;
  sharedInboxID?: string;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [previewRequested, setPreviewRequested] = React.useState(false);
  const [previewURL, setPreviewURL] = React.useState("");
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const attachmentID = attachment.id?.trim() ?? "";
  const filename = emailAttachmentFileName(attachment);
  const contentType = emailAttachmentContentType(attachment);
  const canRenderInline = attachmentCanRenderInline(contentType);
  const shouldLoadPreview = canRenderInline && (emailAttachmentIsImage(attachment) || previewRequested);
  const canDownload = !!attachmentID || !!attachment.content?.trim();
  const showActions = hovered || focused;

  React.useEffect(() => {
    if (!shouldLoadPreview) {
      setPreviewURL("");
      setLoadingPreview(false);
      setPreviewFailed(false);
      return undefined;
    }
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) {
      setPreviewURL(inlineURL);
      setLoadingPreview(false);
      setPreviewFailed(false);
      return undefined;
    }
    if (!attachmentID) {
      setPreviewURL("");
      setLoadingPreview(false);
      setPreviewFailed(true);
      return undefined;
    }
    let cancelled = false;
    let objectURL = "";
    setPreviewURL("");
    setLoadingPreview(true);
    setPreviewFailed(false);
    void downloadEmailAttachment(messageID, attachmentID, companyID, sharedInboxID)
      .then((blob) => {
        if (cancelled) return;
        objectURL = URL.createObjectURL(blob);
        setPreviewURL(objectURL);
      })
      .catch(() => {
        if (!cancelled) setPreviewFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [attachment, attachmentID, companyID, messageID, sharedInboxID, shouldLoadPreview]);

  const handleDownload = React.useCallback(() => {
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) {
      downloadURL(inlineURL, filename);
      return;
    }
    if (!attachmentID) return;
    void downloadEmailAttachment(messageID, attachmentID, companyID, sharedInboxID)
      .then((blob) => {
        const objectURL = URL.createObjectURL(blob);
        downloadURL(objectURL, filename, true);
      });
  }, [attachment, attachmentID, companyID, filename, messageID, sharedInboxID]);

  const handleOpen = React.useCallback(() => {
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) {
      openAttachmentURL(inlineURL, filename);
      return;
    }
    if (!attachmentID) return;
    void downloadEmailAttachment(messageID, attachmentID, companyID, sharedInboxID)
      .then((blob) => {
        const objectURL = URL.createObjectURL(blob);
        openAttachmentURL(objectURL, filename, true);
      });
  }, [attachment, attachmentID, companyID, filename, messageID, sharedInboxID]);

  return (
    <div
      role={canDownload ? "button" : undefined}
      tabIndex={canDownload ? 0 : undefined}
      style={attachmentTileStyle(canDownload, showActions)}
      title={canDownload ? `Open ${filename}` : filename}
      onMouseEnter={() => {
        setHovered(true);
        setPreviewRequested(true);
      }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        setFocused(true);
        setPreviewRequested(true);
      }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setFocused(false);
      }}
      onClick={() => {
        if (canDownload) handleOpen();
      }}
      onKeyDown={(event) => {
        if (!canDownload || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        handleOpen();
      }}
    >
      <div style={attachmentPreviewWrapStyle}>
        <AttachmentVisual
          filename={filename}
          contentType={contentType}
          sourceURL={previewURL || emailAttachmentDataURL(attachment) || undefined}
          loading={loadingPreview}
          failed={previewFailed}
        />
        <button
          type="button"
          style={attachmentActionButtonStyle(showActions)}
          disabled={!canDownload}
          aria-label={`Download ${filename}`}
          title={`Download ${filename}`}
          onClick={(event) => {
            event.stopPropagation();
            handleDownload();
          }}
        >
          <DownloadAttachmentIcon />
        </button>
      </div>
      <div style={mailAttachmentNameStyle} title={filename}>{filename}</div>
      <div style={mailAttachmentMetaStyle}>{formatComposeAttachmentSize(attachment.size ?? 0) || contentType}</div>
    </div>
  );
}

function composeAttachmentContentType(attachment: ComposeAttachment): string {
  return attachment.contentType?.trim() || "application/octet-stream";
}

function composeAttachmentDataURL(attachment: ComposeAttachment): string {
  const content = attachment.content?.trim() ?? "";
  if (!content) return "";
  return `data:${composeAttachmentContentType(attachment)};base64,${content}`;
}

function ComposeAttachmentTile({ attachment, onRemove }: {
  attachment: ComposeAttachment;
  onRemove: (attachmentID: string) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const filename = attachment.filename.trim() || "attachment";
  const contentType = composeAttachmentContentType(attachment);
  const sourceURL = composeAttachmentDataURL(attachment);
  const showActions = hovered || focused;

  return (
    <div
      role="button"
      tabIndex={0}
      style={attachmentTileStyle(true, showActions)}
      title={`Open ${filename}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
        setFocused(false);
      }}
      onClick={() => {
        if (sourceURL) openAttachmentURL(sourceURL, filename);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        if (sourceURL) openAttachmentURL(sourceURL, filename);
      }}
    >
      <div style={attachmentPreviewWrapStyle}>
        <AttachmentVisual filename={filename} contentType={contentType} sourceURL={sourceURL || undefined} />
        <button
          type="button"
          style={attachmentRemoveButtonStyle(showActions)}
          aria-label={`Remove ${filename}`}
          title={`Remove ${filename}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove(attachment.id);
          }}
        >
          x
        </button>
      </div>
      <div style={mailAttachmentNameStyle} title={filename}>{filename}</div>
      <div style={mailAttachmentMetaStyle}>{formatComposeAttachmentSize(attachment.size) || contentType}</div>
    </div>
  );
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read attachment."));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const commaIndex = value.indexOf(",");
      resolve(commaIndex >= 0 ? value.slice(commaIndex + 1) : value);
    };
    reader.readAsDataURL(file);
  });
}

type ComposeRecipientField = "to" | "cc";

const recipientSuggestionsStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  marginTop: 4,
  marginBottom: 2,
  padding: 6,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 8,
  background: "rgba(255, 255, 255, 0.9)",
  boxShadow: "0 12px 24px rgba(15, 23, 42, 0.08)",
};

const recipientSuggestionButtonStyle: React.CSSProperties = {
  ...mailPanelSmallButtonStyle,
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  justifyItems: "start",
  textAlign: "left",
  boxShadow: "none",
};

const recipientFieldShellStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const recipientFieldStyle: React.CSSProperties = {
  ...mailPanelInputStyle,
  minHeight: 40,
  height: "auto",
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  padding: "4px 8px",
  cursor: "text",
};

const recipientFieldLabelStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#475569",
  fontSize: 13,
  fontWeight: 650,
  padding: "0 2px",
};

const recipientChipStyle: React.CSSProperties = {
  maxWidth: "min(100%, 360px)",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 28,
  border: "1px solid rgba(100, 116, 139, 0.42)",
  borderRadius: 999,
  background: "rgba(255, 255, 255, 0.78)",
  color: "#111827",
  fontSize: 13,
  fontWeight: 650,
  padding: "2px 8px 2px 3px",
};

const recipientChipAvatarStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  display: "inline-grid",
  placeItems: "center",
  background: "#0f766e",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 800,
  flexShrink: 0,
};

const recipientChipTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const recipientChipRemoveStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "#475569",
  cursor: "pointer",
  font: "inherit",
  fontSize: 18,
  lineHeight: 1,
  padding: 0,
};

const recipientDraftInputStyle: React.CSSProperties = {
  minWidth: 120,
  flex: "1 1 160px",
  border: "none",
  outline: "none",
  background: "transparent",
  color: "#111827",
  font: "inherit",
  fontSize: 13,
  minHeight: 28,
  padding: 0,
};

const composeMessageEditorShellStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

const composeMessagePreviewStyle: React.CSSProperties = {
  ...mailPanelTextareaStyle,
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  resize: "none",
  pointerEvents: "none",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  color: "#1f2937",
  borderColor: "transparent",
  boxShadow: "none",
};

const composeMessageTextareaStyle: React.CSSProperties = {
  ...mailPanelTextareaStyle,
  position: "relative",
  zIndex: 1,
  background: "transparent",
  color: "transparent",
  caretColor: "#0f172a",
  overflowWrap: "anywhere",
};

const composeMessageLinkStyle: React.CSSProperties = {
  color: "#0369a1",
  textDecoration: "underline",
  textDecorationThickness: 1.5,
  textUnderlineOffset: 2,
  fontWeight: 650,
};

function composePanelStyle(replyMode: boolean): React.CSSProperties {
  if (!replyMode) return composeStyle;
  return {
    ...composeStyle,
    height: "100%",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    alignContent: "stretch",
    overflow: "hidden",
  };
}

const composeReplyHeaderStyle: React.CSSProperties = {
  ...panelHeaderStyle,
  alignItems: "start",
  justifyContent: "flex-start",
  gap: 12,
};

const composeReplyHeaderFieldsStyle: React.CSSProperties = {
  flex: "1 1 720px",
  maxWidth: "72%",
  minWidth: 320,
  display: "grid",
  gap: 6,
  minHeight: 0,
};

const composeHeaderActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flex: "0 0 auto",
  flexWrap: "wrap",
  justifyContent: "flex-end",
  marginLeft: "auto",
};

const composeReplySubjectFieldStyle: React.CSSProperties = {
  ...mailPanelInputStyle,
  minHeight: 40,
  height: "auto",
  display: "grid",
  gridTemplateColumns: "28px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  padding: "4px 8px",
};

const composeReplySubjectLabelStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.66)",
  fontSize: 12,
  fontWeight: 760,
};

const composeReplySubjectInputStyle: React.CSSProperties = {
  border: "none",
  outline: "none",
  background: "transparent",
  minWidth: 0,
  color: "#111827",
  font: "inherit",
  fontSize: 13,
};

const composeReplyOriginalStyle: React.CSSProperties = {
  ...mailComposeOriginalStyle,
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  overflow: "hidden",
  paddingBottom: 0,
};

const composeReplyOriginalFrameStyle: React.CSSProperties = {
  ...mailComposeOriginalFrameStyle,
  minHeight: 0,
  height: "100%",
};

const composeReplyDockStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gap: 8,
  alignContent: "end",
};

const composeReplyResizeHandleStyle: React.CSSProperties = {
  height: 10,
  margin: "-2px 0",
  display: "grid",
  placeItems: "center",
  cursor: "row-resize",
  touchAction: "none",
};

const composeReplyResizeGripStyle: React.CSSProperties = {
  width: 44,
  height: 3,
  borderRadius: 999,
  background: "rgba(100, 116, 139, 0.38)",
};

function composeReplyMessageEditorShellStyle(height: number): React.CSSProperties {
  return {
    ...composeMessageEditorShellStyle,
    height,
    minHeight: 150,
  };
}

function composeReplyMessagePreviewStyle(height: number): React.CSSProperties {
  return {
    ...composeMessagePreviewStyle,
    height,
    minHeight: 0,
    maxHeight: "none",
  };
}

function composeReplyMessageTextareaStyle(height: number): React.CSSProperties {
  return {
    ...composeMessageTextareaStyle,
    height,
    minHeight: 150,
    maxHeight: "none",
    resize: "none",
  };
}

function recipientQuery(value: string): string {
  return value.trim().toLowerCase();
}

function renderComposePreviewLine(value: string, lineKey: string): React.ReactNode[] {
  const urlPattern = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
  const output: React.ReactNode[] = [];
  let cursor = 0;
  let indexKey = 0;
  for (const match of value.matchAll(urlPattern)) {
    const matchText = match[0] ?? "";
    const matchIndex = match.index ?? 0;
    if (matchIndex > cursor) output.push(value.slice(cursor, matchIndex));
    const trailingPunctuation = matchText.match(/[),.;:!?]+$/)?.[0] ?? "";
    const cleanURL = trailingPunctuation ? matchText.slice(0, -trailingPunctuation.length) : matchText;
    output.push(
      <span key={`${lineKey}:link:${indexKey}`} style={composeMessageLinkStyle}>
        {cleanURL}
      </span>,
    );
    if (trailingPunctuation) output.push(trailingPunctuation);
    cursor = matchIndex + matchText.length;
    indexKey += 1;
  }
  if (cursor < value.length) output.push(value.slice(cursor));
  return output;
}

function renderComposeMessagePreview(value: string): React.ReactNode {
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized) return <span style={{ color: "#94a3b8" }}>Message</span>;
  const lines = normalized.split("\n");
  return lines.map((line, lineIndex) => (
    <React.Fragment key={`line:${lineIndex}`}>
      {renderComposePreviewLine(line, `line:${lineIndex}`)}
      {lineIndex < lines.length - 1 ? "\n" : ""}
    </React.Fragment>
  ));
}

function companyUserRecipient(user: CompanyUser): EmailAddress | null {
  const email = user.email?.trim().toLowerCase() ?? "";
  if (!email) return null;
  const name = user.display_name?.trim() ?? "";
  return name ? { name, email } : { email };
}

function serializeRecipient(address: EmailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim() ?? "";
  return name ? `${name} <${email}>` : email;
}

function serializeRecipients(addresses: EmailAddress[]): string {
  return addresses.map(serializeRecipient).join(", ");
}

function recipientChipLabel(address: EmailAddress): string {
  const email = address.email.trim();
  const name = address.name?.trim() ?? "";
  return name ? `${name} (${email})` : email;
}

function recipientChipInitial(address: EmailAddress): string {
  const label = (address.name?.trim() || address.email.trim()).trim();
  return (label[0] ?? "?").toUpperCase();
}

function recipientKey(address: EmailAddress): string {
  return address.email.trim().toLowerCase();
}

function appendRecipient(addresses: EmailAddress[], address: EmailAddress): EmailAddress[] {
  const key = recipientKey(address);
  if (!key) return addresses;
  return addresses.some((item) => recipientKey(item) === key) ? addresses : [...addresses, address];
}

function matchingCompanyUsers(users: CompanyUser[], value: string, existingRecipients: EmailAddress[]): CompanyUser[] {
  const query = recipientQuery(value);
  const existingEmails = new Set(existingRecipients.map(recipientKey));
  if (query.length < 1) return [];
  return users
    .filter((user) => {
      const email = user.email?.trim() ?? "";
      if (!email) return false;
      if (existingEmails.has(email.toLowerCase())) return false;
      const displayName = user.display_name?.trim() ?? "";
      return email.toLowerCase().includes(query) || displayName.toLowerCase().includes(query);
    })
    .slice(0, 6);
}

export function ComposePanel({ compose, busy, replyMessage, emailSignature, companyUsers, onChange, onCancel, onSubmit, onEmailSignatureChange, onSaveEmailSignature, onSaveDraft }: {
  compose: ComposeState;
  busy: boolean;
  replyMessage?: EmailMessage | null;
  emailSignature: string;
  companyUsers: CompanyUser[];
  onChange: (next: ComposeState) => void;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent) => void;
  onEmailSignatureChange: (value: string) => void;
  onSaveEmailSignature: () => void;
  onSaveDraft: () => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const bodyPreviewRef = React.useRef<HTMLDivElement | null>(null);
  const recipientInputRefs = React.useRef<Record<ComposeRecipientField, HTMLInputElement | null>>({ to: null, cc: null });
  const [attachmentError, setAttachmentError] = React.useState("");
  const [signatureEditorOpen, setSignatureEditorOpen] = React.useState(false);
  const [activeRecipientField, setActiveRecipientField] = React.useState<ComposeRecipientField | "">("");
  const [recipientDrafts, setRecipientDrafts] = React.useState<Record<ComposeRecipientField, string>>({ to: "", cc: "" });
  const [replyEditorHeight, setReplyEditorHeight] = React.useState(220);
  const update = (patch: Partial<ComposeState>) => onChange({ ...compose, ...patch });
  const totalAttachmentBytes = compose.attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size || 0), 0);
  const focusRecipientInput = (field: ComposeRecipientField) => {
    window.requestAnimationFrame(() => {
      const input = recipientInputRefs.current[field];
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };
  const updateRecipientField = (field: ComposeRecipientField, recipients: EmailAddress[]) => {
    const value = serializeRecipients(recipients);
    if (field === "to") update({ to: value });
    else update({ cc: value });
  };
  const addRecipient = (field: ComposeRecipientField, recipient: EmailAddress) => {
    updateRecipientField(field, appendRecipient(parseEmailAddressList(compose[field]), recipient));
    setRecipientDrafts((current) => ({ ...current, [field]: "" }));
    setActiveRecipientField(field);
    focusRecipientInput(field);
  };
  const pickRecipient = (field: ComposeRecipientField, user: CompanyUser) => {
    const recipient = companyUserRecipient(user);
    if (!recipient) return;
    addRecipient(field, recipient);
  };
  const commitRecipientDraft = (field: ComposeRecipientField, suggestions: CompanyUser[], options?: { forceRaw?: boolean }) => {
    const draft = recipientDrafts[field].trim();
    if (suggestions.length > 0 && !options?.forceRaw) {
      pickRecipient(field, suggestions[0]);
      return true;
    }
    const parsed = parseEmailAddressList(draft);
    if (parsed.length === 0) return false;
    updateRecipientField(field, parsed.reduce(appendRecipient, parseEmailAddressList(compose[field])));
    setRecipientDrafts((current) => ({ ...current, [field]: "" }));
    setActiveRecipientField(field);
    focusRecipientInput(field);
    return true;
  };
  const removeRecipient = (field: ComposeRecipientField, address: EmailAddress) => {
    updateRecipientField(field, parseEmailAddressList(compose[field]).filter((item) => recipientKey(item) !== recipientKey(address)));
    setActiveRecipientField(field);
    focusRecipientInput(field);
  };
  const renderRecipientInput = (field: ComposeRecipientField, placeholder: string) => {
    const recipients = parseEmailAddressList(compose[field]);
    const draft = recipientDrafts[field];
    const suggestions = activeRecipientField === field ? matchingCompanyUsers(companyUsers, draft, recipients) : [];
    return (
      <div style={recipientFieldShellStyle}>
        <div
          style={recipientFieldStyle}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) event.preventDefault();
            focusRecipientInput(field);
          }}
        >
          <span style={recipientFieldLabelStyle}>{placeholder}</span>
          {recipients.map((recipient) => (
            <span key={recipientKey(recipient)} style={recipientChipStyle} title={serializeRecipient(recipient)}>
              <span style={recipientChipAvatarStyle}>{recipientChipInitial(recipient)}</span>
              <span style={recipientChipTextStyle}>{recipientChipLabel(recipient)}</span>
              <button
                type="button"
                style={recipientChipRemoveStyle}
                aria-label={`Remove ${recipientChipLabel(recipient)}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => removeRecipient(field, recipient)}
              >
                x
              </button>
            </span>
          ))}
          <input
            ref={(element) => { recipientInputRefs.current[field] = element; }}
            style={recipientDraftInputStyle}
            value={draft}
            onFocus={() => setActiveRecipientField(field)}
            onBlur={() => {
              window.setTimeout(() => {
                setActiveRecipientField((current) => current === field ? "" : current);
              }, 120);
            }}
            onChange={(event) => {
              setActiveRecipientField(field);
              setRecipientDrafts((current) => ({ ...current, [field]: event.target.value }));
            }}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                if (!commitRecipientDraft(field, suggestions)) return;
                event.preventDefault();
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                commitRecipientDraft(field, suggestions);
                return;
              }
              if (event.key === "," || event.key === ";") {
                event.preventDefault();
                commitRecipientDraft(field, suggestions, { forceRaw: parseEmailAddressList(draft).length > 0 });
                return;
              }
              if (event.key === "Backspace" && draft.length === 0 && recipients.length > 0) {
                event.preventDefault();
                updateRecipientField(field, recipients.slice(0, -1));
                focusRecipientInput(field);
              }
            }}
          />
        </div>
        {suggestions.length > 0 && (
          <div style={recipientSuggestionsStyle}>
            {suggestions.map((user) => (
              <button
                key={user.user_id || user.email}
                type="button"
                style={recipientSuggestionButtonStyle}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pickRecipient(field, user);
                }}
              >
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.display_name?.trim() || user.email?.trim() || "User"}
                </span>
                {user.display_name?.trim() && <span style={mutedSmallStyle}>{user.email?.trim() ?? ""}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };
  const attachFiles = async (files: FileList | null) => {
    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0) return;
    setAttachmentError("");
    const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalAttachmentBytes + selectedBytes > COMPOSE_ATTACHMENT_MAX_TOTAL_BYTES) {
      setAttachmentError("Attachments are limited to 24 MB total.");
      return;
    }
    try {
      const additions = await Promise.all(selectedFiles.map(async (file) => ({
        id: `attachment:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
        filename: file.name || "attachment",
        contentType: file.type || "application/octet-stream",
        size: file.size,
        content: await readFileAsBase64(file),
      })));
      update({ attachments: [...compose.attachments, ...additions] });
    } catch (attachError) {
      setAttachmentError(attachError instanceof Error ? attachError.message : "Failed to read attachment.");
    }
  };
  const removeAttachment = (attachmentID: string) => {
    update({ attachments: compose.attachments.filter((attachment) => attachment.id !== attachmentID) });
  };
  const insertSignature = () => {
    const signature = emailSignature.trim();
    if (!signature) return;
    const body = compose.body.trimEnd();
    if (body.endsWith(signature)) return;
    update({ body: body ? `${body}\n\n\n${signature}` : `\n\n\n${signature}` });
  };
  const isReplyMode = !!replyMessage;
  const startReplyEditorResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = replyEditorHeight;
    const maxHeight = Math.max(260, Math.floor((typeof window === "undefined" ? 900 : window.innerHeight) * 0.48));
    const onPointerMove = (moveEvent: PointerEvent) => {
      setReplyEditorHeight(clampNumber(startHeight + startY - moveEvent.clientY, 150, maxHeight));
    };
    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  };
  const renderSubjectInput = (replyMode: boolean) => replyMode ? (
    <div style={composeReplySubjectFieldStyle}>
      <span style={composeReplySubjectLabelStyle}>Re</span>
      <input
        style={composeReplySubjectInputStyle}
        value={compose.subject}
        onChange={(event) => update({ subject: event.target.value })}
        placeholder="Subject"
      />
    </div>
  ) : (
    <input style={mailPanelInputStyle} value={compose.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="Subject" />
  );
  const messageEditorShellStyle = isReplyMode ? composeReplyMessageEditorShellStyle(replyEditorHeight) : composeMessageEditorShellStyle;
  const messagePreviewStyle = isReplyMode ? composeReplyMessagePreviewStyle(replyEditorHeight) : composeMessagePreviewStyle;
  const messageTextareaStyle = isReplyMode ? composeReplyMessageTextareaStyle(replyEditorHeight) : composeMessageTextareaStyle;
  return (
    <form style={composePanelStyle(isReplyMode)} onSubmit={onSubmit}>
      <div style={isReplyMode ? composeReplyHeaderStyle : panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.replyToMessageID ? "Reply" : compose.draftID ? "Draft" : "New Message"}</h2>
        {isReplyMode && (
          <div style={composeReplyHeaderFieldsStyle}>
            {renderRecipientInput("to", "To")}
            {renderRecipientInput("cc", "Cc")}
            {renderSubjectInput(true)}
          </div>
        )}
        <div style={isReplyMode ? composeHeaderActionsStyle : { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" style={mailPanelSmallButtonStyle} onClick={onSaveDraft}>Save to My Drafts</button>
          <button type="button" style={mailPanelSmallButtonStyle} onClick={onCancel}>Close</button>
        </div>
      </div>
      {replyMessage && (
        <div style={composeReplyOriginalStyle}>
          <div style={mutedSmallStyle}>
            Original from {formatAddressList(replyMessage.from) || "Unknown sender"} to {formatAddressList(replyMessage.to) || "me"}
          </div>
          <iframe title="Original email" sandbox="" srcDoc={messageDocument(replyMessage.body || replyMessage.snippet || "")} style={composeReplyOriginalFrameStyle} />
        </div>
      )}
      <div style={isReplyMode ? composeReplyDockStyle : undefined}>
        {!isReplyMode && renderRecipientInput("to", "To")}
        {!isReplyMode && renderRecipientInput("cc", "Cc")}
        {!isReplyMode && renderSubjectInput(false)}
        {isReplyMode && (
          <div
            style={composeReplyResizeHandleStyle}
            onPointerDown={startReplyEditorResize}
            role="separator"
            aria-orientation="horizontal"
          >
            <div style={composeReplyResizeGripStyle} />
          </div>
        )}
        <div style={messageEditorShellStyle}>
          <div ref={bodyPreviewRef} aria-hidden="true" style={messagePreviewStyle}>
            {renderComposeMessagePreview(compose.body)}
          </div>
          <textarea
            aria-label="Message"
            style={messageTextareaStyle}
            value={compose.body}
            onChange={(event) => update({ body: event.target.value })}
            onScroll={(event) => {
              if (!bodyPreviewRef.current) return;
              bodyPreviewRef.current.scrollTop = event.currentTarget.scrollTop;
              bodyPreviewRef.current.scrollLeft = event.currentTarget.scrollLeft;
            }}
          />
        </div>
        <div style={mailComposeAttachmentRowStyle}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(event) => {
              void attachFiles(event.currentTarget.files);
              event.currentTarget.value = "";
            }}
          />
          <button type="button" style={mailPanelSmallButtonStyle} onClick={() => fileInputRef.current?.click()}>Attach files</button>
          <button type="button" style={mailPanelSmallButtonStyle} onClick={() => setSignatureEditorOpen((current) => !current)}>
            {signatureEditorOpen ? "Hide Signature" : "Edit Signature"}
          </button>
          {attachmentError && <span style={mutedSmallStyle}>{attachmentError}</span>}
          {compose.draftID && <span style={mutedSmallStyle}>Saved in My Drafts</span>}
          <span aria-hidden="true" style={{ flex: "1 1 160px" }} />
          <button type="submit" style={mailComposeSendButtonStyle} disabled={busy}>{busy ? "Sending" : "Send"}</button>
        </div>
        {compose.attachments.length > 0 && (
          <div style={mailAttachmentGridStyle}>
            {compose.attachments.map((attachment) => (
              <ComposeAttachmentTile key={attachment.id} attachment={attachment} onRemove={removeAttachment} />
            ))}
          </div>
        )}
        {signatureEditorOpen && (
          <div style={mailComposeSignatureBoxStyle}>
            <textarea
              style={mailComposeSignatureTextareaStyle}
              value={emailSignature}
              onChange={(event) => onEmailSignatureChange(event.target.value)}
              placeholder="Email signature"
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={mailPanelSmallButtonStyle} onClick={onSaveEmailSignature}>Save signature</button>
              <button type="button" style={mailPanelSmallButtonStyle} onClick={insertSignature} disabled={!emailSignature.trim()}>Insert signature</button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

export function MessageDetail({ message, companyID, sharedInboxID, loading, archiveAvailable, archiveLabel, busy, deleteAvailable, onReply, onArchive, onDelete, onToggleRead, onToggleStar }: {
  message: EmailMessage;
  companyID: string;
  sharedInboxID?: string;
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
  const localReplies = message.local_replies ?? [];
  const hasLocalReplies = localReplies.length > 0;
  const attachments = (message.attachments ?? []).filter((attachment) => emailAttachmentFileName(attachment) || attachment.id?.trim());
  const hasAttachments = attachments.length > 0;
  const bodyFrameStyle = hasLocalReplies || hasAttachments ? { ...iframeStyle, minHeight: 320, height: 360 } : iframeStyle;
  const replyFrameStyle = { ...iframeStyle, minHeight: 220, height: 220, boxShadow: "none" };
  const bodyContainerStyle = hasLocalReplies || hasAttachments ? {
    minHeight: 0,
    overflow: "auto",
    display: "grid",
    gap: 10,
    alignContent: "start",
  } : { minHeight: 0 };
  return (
    <div style={detailStyle}>
      <div style={panelHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          <div style={mutedSmallStyle}>From {formatAddressList(message.from) || "Unknown sender"} to {formatAddressList(message.to) || "me"}</div>
          {messageDate && (
            <div style={{ ...mutedSmallStyle, ...messageTimestampStatusRowStyle, justifyContent: "flex-start" }}>
              <span>{messageDate}</span>
            </div>
          )}
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      <div style={toolbarStyle}>
        <button style={mailPanelSmallButtonStyle} disabled={busy} onClick={onReply}>Reply</button>
        <button style={mailPanelSmallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
        <button style={mailPanelSmallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
        <button style={mailPanelSmallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>{archiveLabel}</button>
        <button style={{ ...mailPanelSmallButtonStyle, ...dangerButtonStyle }} disabled={busy || !deleteAvailable} onClick={onDelete}>Delete</button>
      </div>
      <div style={bodyContainerStyle}>
        {hasAttachments && (
          <div style={mailAttachmentSectionStyle}>
            <div style={mailAttachmentHeaderStyle}>
              <span>{attachments.length === 1 ? "1 attachment" : `${attachments.length} attachments`}</span>
            </div>
            <div style={mailAttachmentGridStyle}>
              {attachments.map((attachment, index) => (
                <EmailAttachmentTile
                  key={attachment.id?.trim() || `${attachment.filename}:${index}`}
                  messageID={message.id}
                  attachment={attachment}
                  companyID={companyID}
                  sharedInboxID={sharedInboxID}
                />
              ))}
            </div>
          </div>
        )}
        <iframe title="Email body" sandbox="" srcDoc={messageDocument(message.body || message.snippet || "")} style={bodyFrameStyle} />
        {localReplies.map((reply) => (
          <div key={reply.id} style={{
            display: "grid",
            gap: 6,
            paddingTop: 10,
            borderTop: "1px solid rgba(148, 163, 184, 0.28)",
          }}>
            <div style={mutedSmallStyle}>
              From {formatAddressList(reply.from) || "me"} to {formatAddressList(reply.to) || "recipient"}
              {formatMessageDate(reply.date) && (
                <span style={{ ...messageTimestampStatusRowStyle, display: "inline-flex", marginLeft: 4 }}>
                  <span>- {formatMessageDate(reply.date)}</span>
                  <MessageReadStatusText message={reply} />
                </span>
              )}
            </div>
            <iframe title="Sent reply body" sandbox="" srcDoc={messageDocument(reply.body || reply.snippet || "")} style={replyFrameStyle} />
          </div>
        ))}
      </div>
      {messageIsSent(message) && (
        <div style={{ ...messageTimestampStatusRowStyle, justifyContent: "flex-end" }}>
          <MessageReadStatusText message={message} />
        </div>
      )}
    </div>
  );
}

export function DeleteMessagesConfirmationModal({ count, busy, position, onConfirm, onCancel }: {
  count: number;
  busy: boolean;
  position?: ConfirmActionMenuPosition | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <ConfirmActionMenu
      title={count === 1 ? "Are you sure you want to delete this?" : `Are you sure you want to delete these ${count} emails?`}
      detail={`This deletes the selected email${count === 1 ? "" : "s"} from your mailbox immediately.`}
      position={position}
      confirmLabel={busy ? "Deleting" : "Yes"}
      cancelLabel="No"
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

export function DeleteHomeEntitiesConfirmationModal({ targets, busy, position, onConfirm, onCancel }: {
  targets: HomeEntityDeleteTarget[];
  busy: boolean;
  position?: ConfirmActionMenuPosition | null;
  onConfirm: (confirmationDisplayName: string) => void;
  onCancel: () => void;
}) {
  const count = targets.length;
  const logicGateCount = targets.filter((target) => target.kind === "logic_gate").length;
  const nodeCount = targets.filter((target) => target.kind === "node").length;
  const targetList = targets.slice(0, 5).map((target) => target.label || target.id);
  if (targets.length > targetList.length) targetList.push(`${targets.length - targetList.length} more`);
  const description = [
    nodeCount ? `${nodeCount} node${nodeCount === 1 ? "" : "s"}` : "",
    logicGateCount ? `${logicGateCount} Logic Gate${logicGateCount === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" and ");
  return (
    <ConfirmActionMenu
      title={count === 1 ? `Are you sure you want to delete ${targetList[0]}?` : `Are you sure you want to delete these ${count} items?`}
      detail={(
        <>
          <div>This deletes {description || "the selected items"} immediately.</div>
          <div>Selected: {targetList.join(", ")}</div>
        </>
      )}
      position={position}
      confirmLabel={busy ? "Deleting" : "Yes"}
      cancelLabel="No"
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}


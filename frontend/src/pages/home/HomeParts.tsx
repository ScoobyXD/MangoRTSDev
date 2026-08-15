import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import FrameRightClickMenu from "../../app/framerightclickmenu";
import { NotificationPopover } from "../../app/NotificationPopover";
import { buildLogicGateRoute, buildNodeRoute, buildProjectRoute } from "../../app/deepLinkRoutes";
import { openAppPathInNewTab } from "../../app/resourceLinks";
import { requestAppSidebarPin, type SidebarPinKind } from "../../app/sidebarPins";
import { NODE_EDITOR_POPUP_RESIZE_HANDLES, type NodeEditorPopupResizeHandle } from "../../app/nodeEditorPopupControls";
import { readAuthConfig } from "../../auth/cognitoAuth";
import {
  NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX,
  NODE_EDITOR_STANDARD_VERTICAL_INSET_PX,
  NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX,
  fullscreenNodeEditorViewportRect,
  setNodeEditorFullscreenChromeActive,
} from "../../modules/editor/nodeEditorFullscreenChrome";
import { getActiveCompanyID } from "../../auth/currentCompany";
import type { BoundRequestJSON } from "../../modules/api/requestJSON";
import {
  defaultAttachmentRequestJSON,
  downloadMangoAttachment,
  loadMangoAttachmentObjectURL,
  mangoEmailDraftResourceID,
  mangoEmailSignatureResourceID,
  uploadMangoAttachment,
} from "../../modules/attachments/attachmentApi";
import { downloadEmailAttachment, parseEmailAddressList, type CommunicationsSharedInbox, type CommunicationsSharedInboxRACIRole, type CommunicationsSharedInboxRACIPrincipalType, type CompanyUser, type EmailAddress, type EmailAttachment, type EmailMessage } from "../../modules/communications/communicationsApi";
import { CalendarInviteCard } from "../../modules/communications/CalendarInviteCard";
import { emailAttachmentHasResolvableContent } from "../../modules/communications/emailAttachments";
import { emailThreadMessageRenderKey, emailThreadMessageSourceLabel, normalizeEmailThreadMessages } from "../../modules/communications/emailThreadMessages";
import { EditorTabBar } from "../../modules/editor/EditorTabBar";
import { UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS, type EditorTabID } from "../../modules/editor/editorTabs";
import { beginEditorAttachmentMutation, finishEditorAttachmentMutation, type EditorAttachmentMutationState } from "../../modules/editor/editorAttachmentPreparation";
import { UnifiedRichEditorSurface, type UnifiedRichEditorFormattingController } from "../../modules/editor/UnifiedRichEditorSurface";
import { UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE, UnifiedNodeShell, UnifiedNodeShellFullscreenIcon, type UnifiedNodeShellAction } from "../../modules/editor/UnifiedNodeShell";
import { ChatIcon } from "../../modules/editor/NodeWorkspaceSurfaceShared";
import { applyEmailBodyHighlights, type EmailBodyHighlightRange } from "../../modules/editor/emailBodyHighlights";
import type { EditorOutlineStyleID } from "../../modules/editor/plainTextEditing";
import type { EditorHighlightColor } from "../../modules/editor/richTextEditing";
import type { EditorInlineStyleCommand, EditorSelectionInlineFormatState, EditorTextAlignment } from "../../modules/editor/useEditorDocumentSurfaceHandlers";
import { EDITOR_DOCUMENT_FONT_SIZE_PX } from "../../modules/editor/useEditorPreferences";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../icons/index.js";
import type { NodeRecord, NodeRelationship } from "../../modules/nodes/types";
import { buildNodeRelationshipHierarchyRows } from "../../modules/nodes/nodeRelationshipStructure";
import type { LogicGateRACIRole, LogicGateRecord } from "../../modules/logic-gates/types";
import {
  markNotificationRead,
  fetchNotifications,
  type NotificationItem,
  type NotificationRACIRole,
  type NotificationSummary,
} from "../../modules/notifications/notificationsApi";
import type { ExplorerDragPayload, ExplorerTreeNode } from "../../modules/company-explorer/companyExplorerTypes";
import { EXPLORER_DRAG_MIME, getExplorerDragPayloadForSelection, readExplorerDragPayload } from "../../modules/company-explorer/companyExplorerDragDrop";
import { fetchCompanyExplorerBranchResourceIDs } from "../../modules/company-explorer/companyExplorerLazyApi";
import { HOME_INBOX_GROUP_HEIGHTS_STORAGE_KEY, HOME_INBOX_GROUP_MAX_HEIGHT_PX, HOME_INBOX_GROUP_MIN_HEIGHT_PX, HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, HOME_NODE_RAIL_HEIGHT_STORAGE_KEY, HOME_ROW_RESIZER_HEIGHT, INBOX_NO_LOGIC_GATE_ID, INBOX_PRIORITIES, RACI_INBOX_SECTIONS, RACI_STATUS_COLUMNS } from "./homeConstants";
import type { ComposeAttachment, ComposeState, HomeEntityDeleteTarget, HomeViewID, InboxLogicGateNodeGroup, InboxPriority, MyNodeGroup, RACIInboxRole, RACIInboxStatus } from "./homeTypes";
import type { EmailCollaborationSelection } from "./EmailCollaborationChatSurface";

export type EmailCollaborationNavigation = EmailCollaborationSelection & { requestID: number };
import { applyHomeMailSignature, createHomeMailDraftID } from "./homeMailDrafts";
import { buildRACIRoleInboxGroupsByCell, cleanIDList, clampNumber, emailAttachmentContentIDKeys, emailAttachmentIsReferencedInline, emailConversationLogicGateIDs, emailMessageHasMultipleThreadMessages, emailThreadMessageCount, formatAddressList, formatMessageDate, hasExplorerDrag, hasTriageMessageDrag, logicGateIDsFromExplorerPayload, logicGateTitle, logicGateTreeID, messageDocument, messageIsSent, messageReadStatusLabel, messageReadStatusTitle, nodeIDFromTreeID, nodeIDsFromExplorerPayload, nodeTitle, nodeTreeID, orderEmailConversationMessages, rewriteEmailDocumentCIDSources, visibleEmailAttachmentsForBody, RACIRoleCellKey, readTriageMessageIDs, gvicStatusColor, setLogicGateDragData, setNodeDragData, type EmailConversationOrder } from "./homeUtils";
import { HOME_CYAN, allLogicGateRowsStyle, columnResizeGripStyle, columnResizeHandleStyle, composeStyle, dangerButtonStyle, detailStyle, detailSubjectStyle, emptySmallStyle, homeColorWithAlpha, iframeStyle, inboxMatrixGridStyle, inputStyle, logicGateDisclosureStyle, logicGateInboxGroupDisclosureStyle, logicGateInboxGroupHeaderStyle, logicGateInboxGroupIconStyle, logicGateInboxGroupNotificationStyle, logicGateInboxGroupResizeGripStyle, logicGateInboxGroupResizeHandleStyle, logicGateInboxGroupStyle, logicGateInboxGroupTitleStyle, logicGateInboxNodeGuideStyle, logicGateInboxNodeIconStyle, logicGateInboxNodeListStyle, logicGateInboxNodeNotificationStyle, logicGateInboxNodeRemoveStyle, logicGateInboxNodeRowStyle, logicGateInboxNodeTitleStyle, logicGateRACICellStyle, logicGateRACIColumnHeaderStyle, logicGateRACIColumnLabelStyle, logicGateRACIColumnLetterStyle, logicGateRACICornerStyle, logicGateRACIHeaderStyle, logicGateRACIMatrixSurfaceStyle, logicGateRACIMetaStyle, logicGateRACIPanelStyle, logicGateRACIPriorityHeaderStyle, logicGateRACIScrollStyle, logicGateRailHeaderStyle, logicGateRailSectionStyle, logicGateRailStyle, logicGateTreeRowStyle, logicGateTreeRowTextStyle, mailAttachmentFileIconStyle, mailAttachmentGridStyle, mailAttachmentHeaderStyle, mailAttachmentMetaStyle, mailAttachmentNameStyle, mailAttachmentSectionStyle, mailAttachmentThumbnailStyle, mailAttachmentTileStyle, mailComposeAttachmentRemoveStyle, mailComposeAttachmentRowStyle, mailComposeOriginalFrameStyle, mailComposeOriginalStyle, mailComposeSendButtonStyle, mailComposeSignatureBoxStyle, mailComposeSignatureTextareaStyle, mailPanelInputStyle, mailPanelSmallButtonStyle, mailPanelTextareaStyle, messageLeadingIndicatorsStyle, messageReadStatusStyle, messageThreadIconStyle, messageTimestampStatusRowStyle, messageUnreadDotStyle, mutedSmallStyle, myLogicGateFolderLabelStyle, myLogicGateGridStyle, myLogicGateGroupStyle, myLogicGateTileIconStyle, myLogicGateTileStyle, myLogicGateTileTextStyle, myLogicGatesListStyle, nodeEditorPopupBackdropStyle, nodeEditorPopupCloseButtonStyle, nodeEditorPopupCollapseButtonStyle, nodeEditorPopupStyle, nodeInboxEmptyStyle, nodeInboxFolderLabelStyle, nodeInboxGridStyle, nodeInboxGroupCountStyle, nodeInboxGroupStyle, nodeInboxListStyle, nodeInboxMutedSmallStyle, nodeInboxOtherEmptyStyle, nodeInboxOtherListStyle, nodeInboxOtherMutedSmallStyle, nodeInboxOtherPanelTitleStyle, nodeInboxOtherSectionStyle, nodeInboxPanelTitleStyle, nodeInboxPrimarySectionStyle, nodeInboxRailHeaderStyle, nodeInboxRailStyle, nodeInboxTileIconStyle, nodeInboxTileStyle, nodeInboxTileTextStyle, panelHeaderStyle, panelTitleStyle, railRowResizeGripStyle, railRowResizeHandleStyle, sharedInboxContextMenuButtonStyle, shortcutRemoveStyle, smallButtonStyle, toolbarStyle } from "./homeStyles";
import { mailConversationCardStyle, mailConversationTimelineDotStyle } from "./homeStyles";
import { MessageReadReceiptChip } from "./MessageReadReceiptChip";
import { buildForwardedEmailHTML } from "./emailForwarding";

const HOME_INBOX_NODE_DRAG_MIME = "application/x-mangorts-home-inbox-node";
const HOME_INBOX_LOGIC_GATE_DRAG_MIME = "application/x-mangorts-home-inbox-logic-gate";
const NODE_EDITOR_POPUP_MIN_WIDTH = 420;
const NODE_EDITOR_POPUP_MIN_HEIGHT = 320;
const NODE_EDITOR_POPUP_VIEWPORT_WIDTH_INSET = 44;
const NODE_EDITOR_POPUP_VIEWPORT_HEIGHT_INSET = NODE_EDITOR_STANDARD_VERTICAL_INSET_PX;
const NODE_EDITOR_POPUP_SIZE_STORAGE_KEY_PREFIX = "home-node-editor-popup-size-v2";
const HOME_INBOX_GROUP_COLLAPSED_STORAGE_KEY_PREFIX = "mangorts.communications.inboxLogicGateGroupCollapsed.v1";
const HOME_COMPACT_CONTEXT_MENU_WIDTH = 210;
const HOME_LOGIC_GATE_PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "1  URGENT(<1hr)" },
  { value: 2, label: "2  By end of day" },
  { value: 3, label: "3  Tomorrow" },
  { value: 4, label: "4  Sprint (1 week)" },
  { value: 5, label: "5  Later (low priority)" },
];

function explorerPayloadMayContainLogicGates(payload: ExplorerDragPayload | null): boolean {
  return logicGateIDsFromExplorerPayload(payload).length > 0
    || Boolean(payload?.kind === "folder" && payload.folderID);
}

async function resolveHomeExplorerLogicGateIDs(
  apiBase: string,
  companyID: string,
  payload: ExplorerDragPayload | null,
): Promise<string[]> {
  const directLogicGateIDs = logicGateIDsFromExplorerPayload(payload);
  if (directLogicGateIDs.length > 0) return directLogicGateIDs;
  if (payload?.kind !== "folder" || !payload.folderID) return [];
  return fetchCompanyExplorerBranchResourceIDs(apiBase, companyID, payload.folderID, "logic_gate");
}

function MessageReadStatusText({ message }: { message: EmailMessage }) {
  const label = messageReadStatusLabel(message.read_status);
  if (!label) return null;
  const title = messageReadStatusTitle(message.read_status) || label;
  return <span style={messageReadStatusStyle} title={title}><MessageReadReceiptChip message={message} /></span>;
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
    focusEmailMessageID?: string;
    focusRequestID?: number;
  }>,
})));

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

function HomePinContextMenu({ menu, onClose, onDelete, resolveLabel }: {
  menu: HomePinContextMenuState | null;
  onClose: () => void;
  onDelete?: (target: HomePinContextMenuState, position?: ConfirmActionMenuPosition) => void;
  resolveLabel?: (target: HomePinContextMenuState) => string;
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
          requestAppSidebarPin({ kind: menu.kind, id: menu.id, name: resolveLabel?.(menu) || menu.label });
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

export function HomeBulkEditMenu({ menu, companyUsers, logicGates, nodeByID, busy, onClose, onApplyNodePatch, onApplyLogicGateRACI, onAddNodesToLogicGate, onRequestDelete }: {
  menu: { x: number; y: number; kind: "node" | "logic_gate"; ids: string[] } | null;
  companyUsers: CompanyUser[];
  logicGates: LogicGateRecord[];
  nodeByID: Map<string, NodeRecord>;
  busy: boolean;
  onClose: () => void;
  onApplyNodePatch: (nodeIDs: string[], patch: Partial<Pick<NodeRecord, "priority" | "status" | "due_date">>) => void;
  onApplyLogicGateRACI: (logicGateIDs: string[], role: CommunicationsSharedInboxRACIRole, userID: string, action: "add" | "remove") => void;
  onAddNodesToLogicGate: (nodeIDs: string[], logicGateID: string) => void;
  onRequestDelete: (kind: "node" | "logic_gate", ids: string[], position?: ConfirmActionMenuPosition) => void;
}) {
  const [priority, setPriority] = useState("__no_change__");
  const [status, setStatus] = useState("__no_change__");
  const [dueDateMode, setDueDateMode] = useState<"no_change" | "set" | "clear">("no_change");
  const [dueDate, setDueDate] = useState("");
  const [targetLogicGateID, setTargetLogicGateID] = useState("");
  const [RACIRole, setRACIRole] = useState<CommunicationsSharedInboxRACIRole>("responsible");
  const [RACIUserID, setRACIUserID] = useState("");
  const [RACIAction, setRACIAction] = useState<"add" | "remove">("add");
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
    setRACIRole("responsible");
    setRACIUserID(companyUsers[0]?.user_id ?? "");
    setRACIAction("add");
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
          onApplyLogicGateRACI(menu.ids, RACIRole, RACIUserID, RACIAction);
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
              <select value={RACIAction} onChange={(event) => setRACIAction(event.target.value as "add" | "remove")} style={fieldStyle}>
                <option value="add">Add person</option>
                <option value="remove">Remove person</option>
              </select>
            </label>
            <label style={labelStyle}>
              Role
              <select value={RACIRole} onChange={(event) => setRACIRole(event.target.value as CommunicationsSharedInboxRACIRole)} style={fieldStyle}>
                <option value="responsible">Responsible</option>
                <option value="consulted">Consulted</option>
                <option value="accountable">Accountable</option>
                <option value="informed">Informed</option>
              </select>
            </label>
            <label style={labelStyle}>
              Person
              <select value={RACIUserID} onChange={(event) => setRACIUserID(event.target.value)} style={fieldStyle}>
                {companyUsers.map((user) => (
                  <option key={user.user_id} value={user.user_id}>{user.display_name || user.email || user.user_id}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <button type="submit" disabled={busy || (menu.kind === "logic_gate" && !RACIUserID)} style={actionButtonStyle}>
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
  status?: RACIInboxStatus;
  fromLogicGateID?: string;
};

type InboxCellCreateInput = {
  priority: InboxPriority;
  status?: RACIInboxStatus;
  creatorRACIRole?: LogicGateRACIRole;
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
  return fullscreenNodeEditorViewportRect();
}

const nodeEditorPopupFullscreenStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 0,
  maxWidth: `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)`,
  maxHeight: `calc(100vh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)`,
  borderRadius: 14,
};

export function NodeEditorPopup({ nodeID, nodeTitle, focusInformationID, focusEmailMessageID, focusRequestID, onClose, onCollapseToTab, onDeleteNode }: {
  nodeID: string;
  nodeTitle: string;
  focusInformationID?: string;
  focusEmailMessageID?: string;
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

  useEffect(() => setNodeEditorFullscreenChromeActive(popupFullscreen), [popupFullscreen]);

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
    <AppModalPortal onRequestClose={onClose}>
      <div
      style={nodeEditorPopupBackdropStyle}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <UnifiedNodeShell
        surfaceID="home-node-popup"
        title={nodeTitle}
        role="dialog"
        ariaModal
        actionButtonClassName="mango-elevated-action"
        actionButtonStyle={nodeEditorPopupCollapseButtonStyle}
        closeButtonStyle={nodeEditorPopupCloseButtonStyle}
        style={{ ...nodeEditorPopupStyle, ...(popupFullscreen ? nodeEditorPopupFullscreenStyle : {}), left: popupRect.left, top: popupRect.top, width: popupRect.width, height: popupRect.height }}
        onMouseDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        actions={([
          onDeleteNode ? {
            id: "delete",
            danger: true,
            onClick: requestDeleteNode,
          } : null,
          onCollapseToTab ? {
            id: "minimize",
            onClick: onCollapseToTab,
          } : null,
          {
            id: "pin",
            title: "Pin node to Pinned",
            ariaLabel: "Pin node to Pinned",
            onClick: () => requestAppSidebarPin({ kind: "node", id: nodeID, name: nodeTitle }),
          },
          {
            id: "fullscreen",
            pressed: popupFullscreen,
            onClick: togglePopupFullscreen,
          },
          {
            id: "close",
            onClick: onClose,
          },
        ].filter(Boolean) as UnifiedNodeShellAction[])}
        chrome={NODE_EDITOR_POPUP_RESIZE_HANDLES.map((handle) => (
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
      >
        <React.Suspense fallback={<div aria-busy="true" style={{ width: "100%", height: "100%", background: "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)" }} />}>
          <LazyHomeNodeEditorContent
            accent="#334155"
            widgetId={`communications-node-editor-overlay:${nodeID}`}
            theme="mango"
            forcedEntityKind="node"
            forcedEntityID={nodeID}
            forcedLabel={nodeTitle}
            focusInformationID={focusInformationID}
            focusEmailMessageID={focusEmailMessageID}
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
      </UnifiedNodeShell>
      </div>
    </AppModalPortal>
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

const SHARED_INBOX_RACI_ROLES: ReadonlyArray<{ role: CommunicationsSharedInboxRACIRole; label: string }> = [
  { role: "responsible", label: "Responsible" },
  { role: "accountable", label: "Accountable" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
];

function companyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return user.display_name?.trim() || user.email?.trim() || user.user_id;
}

function companyGroupLabel(group: Pick<CompanyUserGroup, "group_id" | "name">): string {
  return group.name?.trim() || group.group_id;
}

function sharedInboxRACIAssignmentPrincipalKey(assignment: { principal_type?: string; principal_id?: string; user_id: string }): string {
  const principalType = assignment.principal_type?.trim() || "user";
  const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
  return `${principalType}:${principalID}`;
}

function sharedInboxRACIAssignmentLabel(
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

export function SharedInboxRACISettingsModal({
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
  onAddPrincipal: (folderID: string, role: CommunicationsSharedInboxRACIRole, principalType: CommunicationsSharedInboxRACIPrincipalType, principalID: string, principalName?: string) => void;
  onRemovePrincipal: (folderID: string, role: CommunicationsSharedInboxRACIRole, principalType: CommunicationsSharedInboxRACIPrincipalType, principalID: string) => void;
  onClose: () => void;
}) {
  const [userDraftByRole, setUserDraftByRole] = useState<Record<CommunicationsSharedInboxRACIRole, string>>({
    responsible: "",
    accountable: "",
    consulted: "",
    informed: "",
  });
  const [groupDraftByRole, setGroupDraftByRole] = useState<Record<CommunicationsSharedInboxRACIRole, string>>({
    responsible: "",
    accountable: "",
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
  const updateUserDraft = (role: CommunicationsSharedInboxRACIRole, value: string) => {
    setUserDraftByRole((previous) => ({ ...previous, [role]: value }));
  };
  const updateGroupDraft = (role: CommunicationsSharedInboxRACIRole, value: string) => {
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
        console.error("Failed to load shared inbox RACI groups", error);
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
    <AppModalPortal onRequestClose={busy ? undefined : onClose}>
    <div style={sharedRACIBackdropStyle}>
      <section style={sharedRACIModalStyle} aria-modal="true" role="dialog" aria-label={`${folder.name} RACI assignments`}>
        <div style={panelHeaderStyle}>
          <div style={{ minWidth: 0 }}>
            <h2 style={panelTitleStyle}>{folder.name} RACI assignments</h2>
            {loadError && <div style={{ ...mutedSmallStyle, color: "#8b123f" }}>{loadError}</div>}
          </div>
          <button type="button" style={smallButtonStyle} disabled={busy} onClick={onClose}>Close</button>
        </div>
        <div style={sharedRACIRoleGridStyle}>
          {SHARED_INBOX_RACI_ROLES.map(({ role, label }) => {
            const roleAssignments = assignments.filter((assignment) => assignment.role === role);
            const assignedPrincipalKeys = new Set(roleAssignments.map(sharedInboxRACIAssignmentPrincipalKey));
            const selectableUsers = companyUsers.filter((user) => !assignedPrincipalKeys.has(`user:${user.user_id}`));
            const selectableGroups = groups.filter((group) => !assignedPrincipalKeys.has(`group:${group.group_id}`));
            const selectableGroupIDs = new Set(selectableGroups.map((group) => group.group_id));
            const userDraft = userDraftByRole[role];
            const groupDraft = groupDraftByRole[role];
            return (
              <section key={role} style={sharedRACIRoleColumnStyle}>
                <div style={{ display: "grid", gap: 2 }}>
                  <strong style={{ fontSize: 12 }}>{label}</strong>
                </div>
                <div style={sharedRACIChipListStyle}>
                  {roleAssignments.length === 0 ? (
                    <span style={mutedSmallStyle}>No one assigned</span>
                  ) : roleAssignments.map((assignment) => {
                    const inherited = assignment.folder_id !== folder.folder_id;
                    const principalType = (assignment.principal_type ?? "user") as CommunicationsSharedInboxRACIPrincipalType;
                    const principalID = assignment.principal_id?.trim() || assignment.user_id.trim();
                    const labelText = sharedInboxRACIAssignmentLabel(assignment, userByID, groupByID);
                    return (
                      <span key={`${role}:${assignment.folder_id}:${principalType}:${principalID}`} style={sharedRACIChipStyle}>
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
                <div style={sharedRACIControlStackStyle}>
                  <div style={sharedRACIAddRowStyle}>
                    <select
                      style={sharedRACISelectStyle}
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
                  <div style={sharedRACIAddRowStyle}>
                    <select
                      style={sharedRACISelectStyle}
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
    </AppModalPortal>
  );
}

const sharedRACIBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1,
  display: "grid",
  placeItems: "center",
  padding: 20,
  background: "rgba(15, 23, 42, 0.22)",
};

const sharedRACIModalStyle: React.CSSProperties = {
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

const sharedRACIRoleGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(170px, 1fr))",
  gap: 10,
  overflow: "auto",
};

const sharedRACIRoleColumnStyle: React.CSSProperties = {
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

const sharedRACIControlStackStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  minWidth: 0,
};

const sharedRACIChipListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 6,
  overflow: "auto",
};

const sharedRACIChipStyle: React.CSSProperties = {
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

const sharedRACIAddRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 6,
  minWidth: 0,
};

const sharedRACISelectStyle: React.CSSProperties = {
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

function MessageThreadIndicator({ message, active }: { message: EmailMessage; active: boolean }) {
  if (!emailMessageHasMultipleThreadMessages(message)) return null;
  const count = emailThreadMessageCount(message);
  const label = `${count} messages in this thread`;
  return (
    <span role="img" aria-label={label} title={label} style={messageThreadIconStyle(active)}>
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" style={{ display: "block" }}>
        <path d="M5.2 3.2h9.4v6.6H5.2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" opacity="0.58" />
        <path d="m5.8 4 4.1 2.9L14 4" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" opacity="0.58" />
        <path d="M2.6 6.3h10.2v7.2H2.6z" fill="#ffffff" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        <path d="m3.25 7.05 4.45 3.2 4.45-3.2" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function EmailEntityIconButton({ kind, label, placement, onClick }: {
  kind: "node" | "logic_gate";
  label: string;
  placement: "mailbox-card" | "thread-header";
  onClick: React.MouseEventHandler<HTMLButtonElement>;
}) {
  const compact = placement === "mailbox-card";
  const node = kind === "node";
  return (
    <button
      type="button"
      data-email-node-indicator={node ? placement : undefined}
      data-email-logic-gate-indicator={node ? undefined : placement}
      title={label}
      aria-label={label}
      onClick={onClick}
      style={{
        width: compact ? 24 : 32,
        minWidth: compact ? 24 : 32,
        height: compact ? 22 : 30,
        minHeight: compact ? 22 : 30,
        border: `1px solid ${node ? "rgba(51,221,213,0.3)" : "rgba(25,240,122,0.38)"}`,
        borderRadius: compact ? 7 : 8,
        background: node ? "rgba(236,254,255,0.86)" : "rgba(236,253,245,0.9)",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        padding: 0,
        flex: "0 0 auto",
      }}
    >
      <ExplorerRowIcon kind={kind} />
    </button>
  );
}

export function MessageLeadingIndicators({ message, active }: { message: EmailMessage; active: boolean }) {
  return (
    <span style={messageLeadingIndicatorsStyle}>
      <span aria-hidden="true" style={messageUnreadDotStyle(message.unread)} />
      <MessageThreadIndicator message={message} active={active} />
    </span>
  );
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
  apiBase,
  companyID,
  loading,
  logicGateByID,
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
  apiBase: string;
  companyID: string;
  loading: boolean;
  logicGateByID: Map<string, LogicGateRecord>;
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
  onAddShortcuts: (logicGateIDs: string[]) => void;
  onRemoveShortcut: (logicGateID: string) => void;
  onConvertMessages: (logicGateID: string, messageIDs: string[], priority: number) => void;
  onCreateLogicGate: (options?: { creatorRACIRole?: LogicGateRACIRole }) => void;
  onRequestDeleteLogicGate: (logicGateID: string, position?: ConfirmActionMenuPosition) => void;
}) {
  const railSplit = useRailTopResize(HOME_LOGIC_GATE_RAIL_HEIGHT_STORAGE_KEY, 240);
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [createContextMenu, setCreateContextMenu] = useState<{ x: number; y: number; creatorRACIRole?: LogicGateRACIRole } | null>(null);
  const [triagePriorityMenu, setTriagePriorityMenu] = useState<TriageConversionPriorityMenuState | null>(null);
  const [logicGateDropTargetRowID, setLogicGateDropTargetRowID] = useState("");
  const openCreateLogicGateMenu = useCallback((event: React.MouseEvent, creatorRACIRole?: LogicGateRACIRole) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setLogicGateDropTargetRowID("");
    setTriagePriorityMenu(null);
    setCreateContextMenu({ x: event.clientX, y: event.clientY, creatorRACIRole });
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
        onContextMenu={(event) => openCreateLogicGateMenu(event, "responsible")}
        onDragOver={(event) => {
          if (!hasExplorerDrag(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(event) => {
          const payload = readExplorerDragPayload(event.dataTransfer);
          if (!explorerPayloadMayContainLogicGates(payload)) return;
          event.preventDefault();
          void resolveHomeExplorerLogicGateIDs(apiBase, companyID, payload).then((logicGateIDs) => {
            if (logicGateIDs.length > 0) onAddShortcuts(logicGateIDs);
          }, (cause) => console.error("Failed to load Company Explorer folder", cause));
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
      resolveLabel={(target) => logicGateTitle(logicGateByID.get(target.id)) || target.label}
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
            const creatorRACIRole = createContextMenu.creatorRACIRole;
            setCreateContextMenu(null);
            onCreateLogicGate({ creatorRACIRole });
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
  inboxRole: RACIInboxRole;
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
      resolveLabel={(target) => target.kind === "node" ? nodeTitle(nodeByID.get(target.id)) || target.label : target.kind === "logic_gate" ? logicGateTitle(logicGateByID.get(target.id)) || target.label : target.label}
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

function notificationCountForInboxGroup(summary: NotificationSummary, role: NotificationRACIRole, group: InboxLogicGateNodeGroup): number {
  if (!group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return 0;
  const groupNodeIDs = new Set(group.nodeIDs);
  return (summary.logic_gate_counts ?? []).reduce((count, item) => {
    if (item.logic_gate_id !== group.logicGateID || item.role !== role) return count;
    const nodeID = item.node_id?.trim() ?? "";
    if (nodeID && !groupNodeIDs.has(nodeID)) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function notificationCountForInboxNode(summary: NotificationSummary | undefined, group: InboxLogicGateNodeGroup, nodeID: string, role?: NotificationRACIRole): number {
  const cleanNodeID = nodeID.trim();
  if (!summary || !cleanNodeID || !group.logicGateID || group.logicGateID === INBOX_NO_LOGIC_GATE_ID) return 0;
  return (summary.logic_gate_counts ?? []).reduce((count, item) => {
    if (item.logic_gate_id !== group.logicGateID || item.node_id?.trim() !== cleanNodeID) return count;
    if (role && item.role !== role) return count;
    return count + (typeof item.count === "number" && Number.isFinite(item.count) ? Math.max(0, Math.floor(item.count)) : 0);
  }, 0);
}

function filterInboxGroupsForUnread(groups: InboxLogicGateNodeGroup[], summary: NotificationSummary, role: NotificationRACIRole): InboxLogicGateNodeGroup[] {
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

function filterInboxGroupMapForUnread(groupsByCell: Map<string, InboxLogicGateNodeGroup[]>, summary: NotificationSummary, role: NotificationRACIRole, unreadOnly: boolean): Map<string, InboxLogicGateNodeGroup[]> {
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
  ...logicGateRACIMetaStyle,
  minWidth: 72,
};

export type RACIMatrixViewerListEntry = {
  kind: "group" | "user";
  id: string;
};

type RACIMatrixViewerGroup = {
  company_id: string;
  group_id: string;
  parent_group_id?: string;
  name: string;
  position: number;
};

type RACIMatrixViewerGroupMember = {
  company_id: string;
  group_id: string;
  user_id: string;
  user_display_name?: string;
  user_email?: string;
};

function RACIMatrixViewerUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID;
}

function RACIMatrixViewerSearchText(user: Pick<CompanyUser, "user_id" | "display_name" | "email">): string {
  return `${user.display_name ?? ""} ${user.email ?? ""} ${user.user_id}`.trim().toLowerCase();
}

function RACIMatrixViewerGroupLabel(group: Pick<RACIMatrixViewerGroup, "group_id" | "name"> | null | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID;
}

function RACIMatrixViewerEntryKey(entry: RACIMatrixViewerListEntry): string {
  return `${entry.kind}:${entry.id.trim()}`;
}

function normalizeRACIMatrixViewerEntries(entries: RACIMatrixViewerListEntry[]): RACIMatrixViewerListEntry[] {
  const out: RACIMatrixViewerListEntry[] = [];
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

function firstRACIMatrixViewerDefaultGroupID(groups: RACIMatrixViewerGroup[], members: RACIMatrixViewerGroupMember[], currentUserID: string): string {
  const cleanCurrentUserID = currentUserID.trim();
  if (!cleanCurrentUserID) return "";
  const ownGroupIDs = new Set(members.filter((member) => member.user_id.trim() === cleanCurrentUserID).map((member) => member.group_id.trim()).filter(Boolean));
  return groups
    .filter((group) => ownGroupIDs.has(group.group_id))
    .sort((left, right) => (
      left.position - right.position ||
      RACIMatrixViewerGroupLabel(left, left.group_id).localeCompare(RACIMatrixViewerGroupLabel(right, right.group_id), undefined, { numeric: true, sensitivity: "base" }) ||
      left.group_id.localeCompare(right.group_id)
    ))[0]?.group_id ?? "";
}

export function RACIMatrixViewerSelector({
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
  groups: RACIMatrixViewerGroup[];
  groupMembers: RACIMatrixViewerGroupMember[];
  currentUserID: string;
  selectedUserID: string;
  entries: RACIMatrixViewerListEntry[];
  onEntriesChange: (entries: RACIMatrixViewerListEntry[]) => void;
  onSelectUser: (userID: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set());
  const cleanEntries = useMemo(() => normalizeRACIMatrixViewerEntries(entries), [entries]);
  const userByID = useMemo(() => new Map(companyUsers.map((user) => [user.user_id.trim(), user])), [companyUsers]);
  const groupByID = useMemo(() => new Map(groups.map((group) => [group.group_id.trim(), group])), [groups]);
  const membersByGroupID = useMemo(() => {
    const grouped = new Map<string, RACIMatrixViewerGroupMember[]>();
    for (const member of groupMembers) {
      const groupID = member.group_id.trim();
      if (!groupID) continue;
      const list = grouped.get(groupID) ?? [];
      list.push(member);
      grouped.set(groupID, list);
    }
    for (const [groupID, list] of grouped) {
      list.sort((left, right) => (
        RACIMatrixViewerUserLabel(userByID.get(left.user_id.trim()), left.user_id).localeCompare(
          RACIMatrixViewerUserLabel(userByID.get(right.user_id.trim()), right.user_id),
          undefined,
          { numeric: true, sensitivity: "base" },
        ) ||
        left.user_id.localeCompare(right.user_id)
      ));
      grouped.set(groupID, list);
    }
    return grouped;
  }, [groupMembers, userByID]);
  const defaultGroupID = useMemo(() => firstRACIMatrixViewerDefaultGroupID(groups, groupMembers, currentUserID), [currentUserID, groupMembers, groups]);
  const effectiveEntries = cleanEntries.length > 0
    ? cleanEntries
    : defaultGroupID
      ? [{ kind: "group" as const, id: defaultGroupID }]
      : [];
  const selectedUser = userByID.get(selectedUserID.trim()) ?? null;
  const selectedLabel = RACIMatrixViewerUserLabel(selectedUser, selectedUserID.trim() || currentUserID.trim() || "User");
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
      .filter((user) => RACIMatrixViewerSearchText(user).includes(query))
      .sort((left, right) => (
        RACIMatrixViewerUserLabel(left, left.user_id).localeCompare(RACIMatrixViewerUserLabel(right, right.user_id), undefined, { numeric: true, sensitivity: "base" }) ||
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
  const addEntry = (entry: RACIMatrixViewerListEntry) => {
    const baseEntries = cleanEntries.length > 0 ? cleanEntries : effectiveEntries;
    const next = normalizeRACIMatrixViewerEntries([...baseEntries, entry]);
    onEntriesChange(next);
  };
  const chooseAddEntry = (entry: RACIMatrixViewerListEntry) => {
    addEntry(entry);
    setAddMenuOpen(false);
  };
  const entryAlreadyIncluded = (entry: RACIMatrixViewerListEntry) => {
    const key = RACIMatrixViewerEntryKey(entry);
    return effectiveEntries.some((item) => RACIMatrixViewerEntryKey(item) === key);
  };
  const deleteEntry = (entry: RACIMatrixViewerListEntry) => {
    const key = RACIMatrixViewerEntryKey(entry);
    onEntriesChange(cleanEntries.filter((item) => RACIMatrixViewerEntryKey(item) !== key));
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
    userID.trim() === selectedUserID.trim() ? <span aria-hidden="true" style={RACIMatrixViewerCheckStyle}>{"\u2713"}</span> : <span style={RACIMatrixViewerCheckSpacerStyle} />
  );
  const renderUserRow = (userID: string, options: { key: string; entry?: RACIMatrixViewerListEntry; draggableIndex?: number; compact?: boolean }) => {
    const user = userByID.get(userID.trim()) ?? null;
    const label = RACIMatrixViewerUserLabel(user, userID);
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
        style={RACIMatrixViewerUserRowStyle(userID.trim() === selectedUserID.trim(), options.compact)}
      >
        {options.draggableIndex !== undefined && <span aria-hidden="true" style={RACIMatrixViewerDragGripStyle}>::</span>}
        <span style={RACIMatrixViewerUserTextStyle}>
          <span style={RACIMatrixViewerUserLabelStyle}>{label}</span>
          {user?.email?.trim() && user.email.trim() !== label && <span style={RACIMatrixViewerUserEmailStyle}>{user.email}</span>}
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
            style={RACIMatrixViewerDeleteButtonStyle}
          >
            x
          </span>
        )}
        {renderCheck(userID)}
      </div>
    );
  };
  const renderEntry = (entry: RACIMatrixViewerListEntry, index: number) => {
    if (entry.kind === "user") {
      return renderUserRow(entry.id, { key: RACIMatrixViewerEntryKey(entry), entry, draggableIndex: index });
    }
    const group = groupByID.get(entry.id) ?? null;
    const members = membersByGroupID.get(entry.id) ?? [];
    const groupKey = RACIMatrixViewerEntryKey(entry);
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
        style={RACIMatrixViewerGroupBlockStyle(entry.id)}
      >
        <div style={RACIMatrixViewerGroupHeaderStyle}>
          <button
            type="button"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${RACIMatrixViewerGroupLabel(group, entry.id)}`}
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsedGroup(groupKey);
            }}
            style={RACIMatrixViewerCollapseButtonStyle}
          >
            {collapsed ? "\u25b8" : "\u25be"}
          </button>
          {cleanEntries.length > 0 && <span aria-hidden="true" style={RACIMatrixViewerDragGripStyle}>::</span>}
          <span style={RACIMatrixViewerGroupTitleStyle}>{RACIMatrixViewerGroupLabel(group, entry.id)}</span>
          {cleanEntries.length > 0 && (
            <button
              type="button"
              aria-label={`Remove ${RACIMatrixViewerGroupLabel(group, entry.id)}`}
              onClick={() => deleteEntry(entry)}
              style={RACIMatrixViewerSmallIconButtonStyle}
            >
              x
            </button>
          )}
        </div>
        {!collapsed && (
          <div style={RACIMatrixViewerGroupUsersStyle}>
            {members.length > 0
              ? members.map((member) => renderUserRow(member.user_id, { key: `${entry.id}:${member.user_id}`, compact: true }))
              : <div style={RACIMatrixViewerEmptyStyle}>No users</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} style={RACIMatrixViewerSelectorRootStyle}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={RACIMatrixViewerDropdownButtonStyle(open)}
      >
        <span style={RACIMatrixViewerDropdownLabelStyle}>{selectedLabel}</span>
        <span aria-hidden="true" style={RACIMatrixViewerChevronStyle}>v</span>
      </button>
      {open && (
        <div className="kanban-board-scroll" style={RACIMatrixViewerDropdownStyle}>
          <div style={RACIMatrixViewerCustomizeStyle}>
            <div style={RACIMatrixViewerAddRowStyle}>
              <div style={RACIMatrixViewerAddMenuRootStyle}>
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={addMenuOpen}
                  onClick={() => setAddMenuOpen((value) => !value)}
                  style={RACIMatrixViewerAddMenuButtonStyle(addMenuOpen)}
                >
                  <span style={RACIMatrixViewerDropdownLabelStyle}>Add users</span>
                  <span aria-hidden="true" style={RACIMatrixViewerChevronStyle}>v</span>
                </button>
                {addMenuOpen && (
                  <div style={RACIMatrixViewerAddMenuStyle}>
                    {groups.map((group) => {
                      const groupID = group.group_id.trim();
                      const members = membersByGroupID.get(groupID) ?? [];
                      const selectedGroup = entryAlreadyIncluded({ kind: "group", id: groupID });
                      return (
                        <div key={groupID} style={RACIMatrixViewerAddGroupBlockStyle(groupID)}>
                          <button
                            type="button"
                            onClick={() => chooseAddEntry({ kind: "group", id: groupID })}
                            style={RACIMatrixViewerAddGroupRowStyle(groupID, selectedGroup)}
                          >
                            <span style={RACIMatrixViewerAddGroupDotStyle(groupID)} />
                            <span style={RACIMatrixViewerAddGroupTextStyle}>{RACIMatrixViewerGroupLabel(group, groupID)}</span>
                            {selectedGroup && <span aria-hidden="true" style={RACIMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
                          </button>
                          <div style={RACIMatrixViewerAddNestedUsersStyle}>
                            {members.map((member) => {
                              const userID = member.user_id.trim();
                              const user = userByID.get(userID) ?? null;
                              const selectedUser = entryAlreadyIncluded({ kind: "user", id: userID });
                              return (
                                <button
                                  key={`${groupID}:${userID}`}
                                  type="button"
                                  onClick={() => chooseAddEntry({ kind: "user", id: userID })}
                                  style={RACIMatrixViewerAddUserRowStyle(selectedUser)}
                                >
                                  <span style={RACIMatrixViewerAddUserTextStyle}>{RACIMatrixViewerUserLabel(user, userID)}</span>
                                  {selectedUser && <span aria-hidden="true" style={RACIMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                    {ungroupedUsers.length > 0 && (
                      <div style={RACIMatrixViewerAddGroupBlockStyle("users")}>
                        <div style={RACIMatrixViewerAddGroupRowStyle("users", false)}>
                          <span style={RACIMatrixViewerAddGroupDotStyle("users")} />
                          <span style={RACIMatrixViewerAddGroupTextStyle}>Users</span>
                        </div>
                        <div style={RACIMatrixViewerAddNestedUsersStyle}>
                          {ungroupedUsers.map((user) => {
                            const userID = user.user_id.trim();
                            const selectedUser = entryAlreadyIncluded({ kind: "user", id: userID });
                            return (
                              <button
                                key={user.user_id}
                                type="button"
                                onClick={() => chooseAddEntry({ kind: "user", id: userID })}
                                style={RACIMatrixViewerAddUserRowStyle(selectedUser)}
                              >
                                <span style={RACIMatrixViewerAddUserTextStyle}>{RACIMatrixViewerUserLabel(user, userID)}</span>
                                {selectedUser && <span aria-hidden="true" style={RACIMatrixViewerAddSelectedStyle}>{"\u2713"}</span>}
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
            <div style={RACIMatrixViewerCurrentBlockStyle}>
              <div style={RACIMatrixViewerGroupTitleStyle}>Current view</div>
              {renderUserRow(selectedUserID, { key: `current:${selectedUserID}`, compact: true })}
            </div>
          )}
          <div style={RACIMatrixViewerEntriesStyle}>
            {effectiveEntries.length > 0
              ? effectiveEntries.map(renderEntry)
              : (
                <div style={RACIMatrixViewerGroupBlockStyle("company")}>
                  <div style={RACIMatrixViewerGroupHeaderStyle}>
                    <button
                      type="button"
                      aria-label={`${collapsedGroupKeys.has("company") ? "Expand" : "Collapse"} Company`}
                      onClick={() => toggleCollapsedGroup("company")}
                      style={RACIMatrixViewerCollapseButtonStyle}
                    >
                      {collapsedGroupKeys.has("company") ? "\u25b8" : "\u25be"}
                    </button>
                    <span style={RACIMatrixViewerGroupTitleStyle}>Company</span>
                  </div>
                  {!collapsedGroupKeys.has("company") && (
                    <div style={RACIMatrixViewerGroupUsersStyle}>
                      {companyUsers.map((user) => renderUserRow(user.user_id, { key: `company:${user.user_id}`, compact: true }))}
                    </div>
                  )}
                </div>
              )}
          </div>
        </div>
      )}
      <div style={RACIMatrixViewerSearchWrapStyle}>
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
          aria-label="Search RACI matrix people"
          spellCheck={false}
          style={RACIMatrixViewerSearchInputStyle}
        />
        {searchOpen && searchQuery.trim() && (
          <div style={RACIMatrixViewerSearchResultsStyle}>
            {searchResults.length > 0
              ? searchResults.map((user) => renderUserRow(user.user_id, { key: `search:${user.user_id}`, compact: true }))
              : <div style={RACIMatrixViewerEmptyStyle}>No matches</div>}
          </div>
        )}
      </div>
    </div>
  );
}

const RACIMatrixViewerSelectorRootStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 6,
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  flex: "0 1 auto",
  flexWrap: "nowrap",
};

function RACIMatrixViewerDropdownButtonStyle(open: boolean): React.CSSProperties {
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

const RACIMatrixViewerDropdownLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 800,
};

const RACIMatrixViewerChevronStyle: React.CSSProperties = {
  flex: "0 0 auto",
  fontSize: 10,
  fontWeight: 900,
  color: "#64748b",
};

const RACIMatrixViewerDropdownStyle: React.CSSProperties = {
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

const RACIMatrixViewerEntriesStyle: React.CSSProperties = {
  display: "grid",
  gap: 9,
};

const RACIMatrixViewerColorPalette = [
  { accent: "#f97316", border: "rgba(249, 115, 22, 0.34)", tint: "rgba(255, 237, 213, 0.68)", soft: "rgba(249, 115, 22, 0.10)", text: "#9a3412" },
  { accent: "#06b6d4", border: "rgba(6, 182, 212, 0.34)", tint: "rgba(207, 250, 254, 0.66)", soft: "rgba(6, 182, 212, 0.10)", text: "#155e75" },
  { accent: "#22c55e", border: "rgba(34, 197, 94, 0.34)", tint: "rgba(220, 252, 231, 0.68)", soft: "rgba(34, 197, 94, 0.10)", text: "#166534" },
  { accent: "#8b5cf6", border: "rgba(139, 92, 246, 0.32)", tint: "rgba(237, 233, 254, 0.68)", soft: "rgba(139, 92, 246, 0.10)", text: "#5b21b6" },
  { accent: "#3b82f6", border: "rgba(59, 130, 246, 0.34)", tint: "rgba(219, 234, 254, 0.70)", soft: "rgba(59, 130, 246, 0.10)", text: "#1d4ed8" },
  { accent: "#ec4899", border: "rgba(236, 72, 153, 0.30)", tint: "rgba(252, 231, 243, 0.64)", soft: "rgba(236, 72, 153, 0.09)", text: "#9d174d" },
];

function RACIMatrixViewerColorForID(id: string): (typeof RACIMatrixViewerColorPalette)[number] {
  const clean = id.trim() || "default";
  let hash = 0;
  for (let index = 0; index < clean.length; index++) {
    hash = ((hash * 31) + clean.charCodeAt(index)) >>> 0;
  }
  return RACIMatrixViewerColorPalette[hash % RACIMatrixViewerColorPalette.length];
}

const RACIMatrixViewerCurrentBlockStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  padding: 8,
  marginBottom: 8,
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.98), rgba(241, 245, 249, 0.88))",
  boxShadow: "0 5px 14px rgba(15, 23, 42, 0.08), inset 1px 1px 0 rgba(255, 255, 255, 0.92)",
};

function RACIMatrixViewerGroupBlockStyle(groupID: string): React.CSSProperties {
  const color = RACIMatrixViewerColorForID(groupID);
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

const RACIMatrixViewerGroupHeaderStyle: React.CSSProperties = {
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

const RACIMatrixViewerCollapseButtonStyle: React.CSSProperties = {
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

const RACIMatrixViewerDragGripStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 12,
  color: "#94a3b8",
  fontSize: 10,
  fontWeight: 900,
  letterSpacing: 0,
};

const RACIMatrixViewerGroupTitleStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 900,
};

const RACIMatrixViewerSmallIconButtonStyle: React.CSSProperties = {
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

const RACIMatrixViewerGroupUsersStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
};

function RACIMatrixViewerUserRowStyle(selected: boolean, compact?: boolean): React.CSSProperties {
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

const RACIMatrixViewerUserTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  display: "grid",
  gap: 1,
};

const RACIMatrixViewerUserLabelStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 800,
};

const RACIMatrixViewerUserEmailStyle: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 10,
  fontWeight: 600,
  color: "#64748b",
};

const RACIMatrixViewerDeleteButtonStyle: React.CSSProperties = {
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

const RACIMatrixViewerCheckStyle: React.CSSProperties = {
  width: 18,
  flex: "0 0 18px",
  color: "#2563eb",
  fontSize: 13,
  fontWeight: 900,
  textAlign: "center",
};

const RACIMatrixViewerCheckSpacerStyle: React.CSSProperties = {
  width: 18,
  flex: "0 0 18px",
};

const RACIMatrixViewerCustomizeStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  marginBottom: 8,
  paddingBottom: 8,
  borderBottom: "1px solid rgba(100, 116, 139, 0.14)",
};

const RACIMatrixViewerAddRowStyle: React.CSSProperties = {
  display: "block",
  position: "relative",
};

const RACIMatrixViewerAddMenuRootStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

function RACIMatrixViewerAddMenuButtonStyle(open: boolean): React.CSSProperties {
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

const RACIMatrixViewerAddMenuStyle: React.CSSProperties = {
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

function RACIMatrixViewerAddGroupBlockStyle(groupID: string): React.CSSProperties {
  const color = RACIMatrixViewerColorForID(groupID);
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

function RACIMatrixViewerAddGroupRowStyle(groupID: string, selected: boolean): React.CSSProperties {
  const color = RACIMatrixViewerColorForID(groupID);
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

function RACIMatrixViewerAddGroupDotStyle(groupID: string): React.CSSProperties {
  const color = RACIMatrixViewerColorForID(groupID);
  return {
    width: 8,
    height: 8,
    flex: "0 0 8px",
    borderRadius: 999,
    background: color.accent,
    boxShadow: `0 0 0 3px ${color.soft}`,
  };
}

const RACIMatrixViewerAddGroupTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const RACIMatrixViewerAddNestedUsersStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  paddingLeft: 20,
};

function RACIMatrixViewerAddUserRowStyle(selected: boolean): React.CSSProperties {
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

const RACIMatrixViewerAddUserTextStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const RACIMatrixViewerAddSelectedStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 900,
};

const RACIMatrixViewerSearchWrapStyle: React.CSSProperties = {
  position: "relative",
  width: 190,
  minWidth: 150,
  flex: "0 0 190px",
};

const RACIMatrixViewerSearchInputStyle: React.CSSProperties = {
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

const RACIMatrixViewerSearchResultsStyle: React.CSSProperties = {
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

const RACIMatrixViewerEmptyStyle: React.CSSProperties = {
  padding: "8px 10px",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 700,
};

const RACIMatrixHeaderLeftStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 10,
  overflow: "visible",
};

const RACIMatrixHeaderTitleStyle: React.CSSProperties = {
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

function logicGateInboxGroupNotificationButtonStyle(role: NotificationRACIRole): React.CSSProperties {
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
  targetKind: "node" | "logic_gate";
  targetID: string;
  title: string;
  loading: boolean;
  error: string;
  items: NotificationItem[];
  seenNotificationIDs: string[];
};

function inboxNotificationMatchesGroup(item: NotificationItem, role: NotificationRACIRole, group: InboxLogicGateNodeGroup): boolean {
  if (item.role !== role || item.logic_gate_id !== group.logicGateID) return false;
  const nodeID = item.node_id?.trim() ?? "";
  return !nodeID || group.nodeIDs.includes(nodeID);
}

function inboxNotificationMatchesNode(item: NotificationItem, role: NotificationRACIRole, group: InboxLogicGateNodeGroup, nodeID: string): boolean {
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

export function RACIRoleInboxMatrix({
  apiBase,
  companyID,
  section,
  loading,
  nodes,
  nodeByID,
  nodeRelationships,
  logicGateByID,
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
  apiBase: string;
  companyID: string;
  section: (typeof RACI_INBOX_SECTIONS)[number];
  loading: boolean;
  nodes: NodeRecord[];
  nodeByID: Map<string, NodeRecord>;
  nodeRelationships: NodeRelationship[];
  logicGateByID: Map<string, LogicGateRecord>;
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
  const allCellLogicGateGroups = useMemo(() => buildRACIRoleInboxGroupsByCell(nodes, nodeByID, logicGateByID, currentUserID, section.role), [currentUserID, logicGateByID, nodeByID, nodes, section.role]);
  const { groupHeights, startGroupResize } = useInboxGroupCardHeights(section.viewID);
  const { collapsedGroupKeys, toggleCollapsedGroup } = useInboxGroupCollapsedState(section.viewID);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [activeDropKey, setActiveDropKey] = useState("");
  const [pinContextMenu, setPinContextMenu] = useState<HomePinContextMenuState | null>(null);
  const [notificationMenu, setNotificationMenu] = useState<InboxNotificationMenuState | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<(InboxCellCreateInput & { x: number; y: number }) | null>(null);
  const creatorRACIRole = section.role === "other" ? undefined : section.role;
  const notificationRole: NotificationRACIRole = section.role;
  const cellLogicGateGroups = useMemo(() => filterInboxGroupMapForUnread(allCellLogicGateGroups, notificationSummary, notificationRole, unreadOnly), [allCellLogicGateGroups, notificationRole, notificationSummary, unreadOnly]);
  const orderedRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RACI_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(RACIRoleCellKey(section.role, column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(...group.nodeIDs);
      }
    }
    return cleanIDList(ids).map(nodeTreeID);
  }, [cellLogicGateGroups, section.role]);
  const orderedLogicGateRowIDs = useMemo(() => {
    const ids: string[] = [];
    for (const priority of INBOX_PRIORITIES) {
      for (const column of RACI_STATUS_COLUMNS) {
        const groups = cellLogicGateGroups.get(RACIRoleCellKey(section.role, column.status, priority.value)) ?? [];
        for (const group of groups) ids.push(group.logicGateID);
      }
    }
    return cleanIDList(ids).filter((id) => id !== INBOX_NO_LOGIC_GATE_ID).map(logicGateTreeID);
  }, [cellLogicGateGroups, section.role]);
  const placedCount = orderedRowIDs.length;
  const openGroupNotifications = useCallback((event: React.MouseEvent, role: NotificationRACIRole, group: InboxLogicGateNodeGroup) => {
    event.preventDefault();
    event.stopPropagation();
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      targetKind: "logic_gate",
      targetID: group.logicGateID,
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
  const openNodeNotifications = useCallback((event: React.MouseEvent, role: NotificationRACIRole, group: InboxLogicGateNodeGroup, nodeID: string) => {
    event.preventDefault();
    event.stopPropagation();
    const node = nodeByID.get(nodeID);
    const nextMenu: InboxNotificationMenuState = {
      x: event.clientX,
      y: event.clientY,
      targetKind: "node",
      targetID: nodeID,
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
      void markNotificationRead(notificationID, true).catch((error) => console.error("Failed to archive notification", error));
    }
    const informationID = notification.information_id?.trim() ?? "";
    const nodeID = notification.node_id?.trim() || (notification.entity_type === "node" ? notification.entity_id.trim() : "");
    const logicGateID = notification.logic_gate_id?.trim() || (notification.entity_type === "logic_gate" ? notification.entity_id.trim() : "");
    const node = nodeID ? nodeByID.get(nodeID) : undefined;
    if (node) {
      onOpenNode(node, informationID || undefined);
      return;
    }
    const logicGateLabel = logicGateID ? logicGateTitle(logicGateByID.get(logicGateID)) : "";
    if (logicGateID) onOpenLogicGate(logicGateID, logicGateLabel || notification.title || logicGateID, nodeID, informationID || undefined);
  }, [logicGateByID, nodeByID, onOpenLogicGate, onOpenNode]);
  const clearGroupNotifications = useCallback((menu: InboxNotificationMenuState) => {
    const notificationIDs = menu.items.map((item) => item.notification_id.trim()).filter(Boolean);
    if (menu.loading || notificationIDs.length === 0) return;
    setNotificationMenu((current) => current ? { ...current, items: [], seenNotificationIDs: [] } : current);
    void Promise.all(notificationIDs.map((notificationID) => markNotificationRead(notificationID, true))).catch((error) => {
      console.error("Failed to clear updates", error);
      setNotificationMenu((current) => current ? { ...current, error: error instanceof Error ? error.message : "Failed to clear updates" } : current);
    });
  }, []);
  const currentNotificationMenu = useMemo(() => {
    if (!notificationMenu) return null;
    const currentLabel = notificationMenu.targetKind === "node"
      ? nodeTitle(nodeByID.get(notificationMenu.targetID))
      : logicGateTitle(logicGateByID.get(notificationMenu.targetID));
    const title = currentLabel ? `${currentLabel} updates` : notificationMenu.title;
    return title === notificationMenu.title ? notificationMenu : { ...notificationMenu, title };
  }, [logicGateByID, nodeByID, notificationMenu]);
  const openCellCreateMenu = useCallback((event: React.MouseEvent, input: InboxCellCreateInput) => {
    event.preventDefault();
    event.stopPropagation();
    setPinContextMenu(null);
    setCellContextMenu({ ...input, x: event.clientX, y: event.clientY });
  }, []);
  const readCellDropPayload = useCallback(async (dataTransfer: DataTransfer) => {
    const explorerPayload = readExplorerDragPayload(dataTransfer);
    const matrixNodePayload = readInboxNodeDragPayload(dataTransfer);
    const matrixLogicGatePayload = readInboxLogicGateDragPayload(dataTransfer);
    const nodeIDs = cleanIDList([
      ...nodeIDsFromExplorerPayload(explorerPayload),
      ...(matrixNodePayload?.nodeIDs ?? []),
    ]).filter((nodeID) => nodeByID.has(nodeID));
    const explorerLogicGateIDs = await resolveHomeExplorerLogicGateIDs(apiBase, companyID, explorerPayload);
    const logicGateIDs = cleanIDList([
      ...explorerLogicGateIDs,
      ...(matrixLogicGatePayload?.logicGateIDs ?? []),
    ]).filter((logicGateID) => logicGateByID.has(logicGateID));
    return {
      nodeIDs,
      logicGateIDs,
      fromLogicGateID: matrixNodePayload?.fromLogicGateID,
      nodeIDsByLogicGateID: matrixLogicGatePayload?.nodeIDsByLogicGateID,
    };
  }, [apiBase, companyID, logicGateByID, nodeByID]);

  const canReadCellDropPayload = useCallback((dataTransfer: DataTransfer) => {
    const explorerPayload = readExplorerDragPayload(dataTransfer);
    const matrixNodePayload = readInboxNodeDragPayload(dataTransfer);
    const matrixLogicGatePayload = readInboxLogicGateDragPayload(dataTransfer);
    return nodeIDsFromExplorerPayload(explorerPayload).length > 0
      || explorerPayloadMayContainLogicGates(explorerPayload)
      || (matrixNodePayload?.nodeIDs.length ?? 0) > 0
      || (matrixLogicGatePayload?.logicGateIDs.length ?? 0) > 0;
  }, []);

  return (
    <>
    <section style={logicGateRACIPanelStyle}>
      <div style={logicGateRACIMatrixSurfaceStyle}>
        <div style={logicGateRACIHeaderStyle}>
          <div style={RACIMatrixHeaderLeftStyle}>
            <h2 style={RACIMatrixHeaderTitleStyle}>{section.title}</h2>
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
        <div className="kanban-board-scroll" style={logicGateRACIScrollStyle}>
          <div style={inboxMatrixGridStyle(RACI_STATUS_COLUMNS.length)}>
            <div className="mango-inbox-matrix-cell" data-rail-right="true" data-rail-bottom="true" style={logicGateRACICornerStyle} />
            {RACI_STATUS_COLUMNS.map((column, columnIndex) => (
              <div
                key={column.status}
                className="mango-inbox-matrix-cell"
                data-rail-right={columnIndex === RACI_STATUS_COLUMNS.length - 1 ? undefined : "true"}
                data-rail-bottom="true"
                style={logicGateRACIColumnHeaderStyle(column.status)}
              >
                <strong style={logicGateRACIColumnLetterStyle(column.status)}>{column.letter}</strong>
                <span style={logicGateRACIColumnLabelStyle(column.status)}>{column.label}</span>
              </div>
            ))}
            {INBOX_PRIORITIES.map((priority, priorityIndex) => (
              <React.Fragment key={priority.value}>
                <div
                  className="mango-inbox-matrix-cell"
                  data-rail-right="true"
                  data-rail-bottom={priorityIndex === INBOX_PRIORITIES.length - 1 ? undefined : "true"}
                  style={logicGateRACIPriorityHeaderStyle(priority.value)}
                >
                  {priority.label}
                </div>
                {RACI_STATUS_COLUMNS.map((column, columnIndex) => {
                  const cellKey = RACIRoleCellKey(section.role, column.status, priority.value);
                  const logicGateGroups = cellLogicGateGroups.get(cellKey) ?? [];
                  const statusColor = gvicStatusColor(column.status);
                  const cellDropKey = `cell:${cellKey}`;
                  const cellStyle = logicGateRACICellStyle(activeDropKey === cellDropKey);
                  return (
                    <div
                      key={cellKey}
                      className="mango-inbox-matrix-cell"
                      data-rail-right={columnIndex === RACI_STATUS_COLUMNS.length - 1 ? undefined : "true"}
                      data-rail-bottom={priorityIndex === INBOX_PRIORITIES.length - 1 ? undefined : "true"}
                      style={cellStyle}
                      onContextMenu={(event) => openCellCreateMenu(event, {
                        priority: priority.value,
                        status: column.status,
                        creatorRACIRole,
                      })}
                      onDragOver={(event) => {
                        if (!canReadCellDropPayload(event.dataTransfer)) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setActiveDropKey(cellDropKey);
                      }}
                      onDragLeave={(event) => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setActiveDropKey((current) => current === cellDropKey ? "" : current);
                        }
                      }}
                      onDrop={(event) => {
                        setActiveDropKey((current) => current === cellDropKey ? "" : current);
                        if (!canReadCellDropPayload(event.dataTransfer)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        void readCellDropPayload(event.dataTransfer).then((drop) => {
                          if (drop.logicGateIDs.length > 0) {
                            onDropLogicGates({
                              logicGateIDs: drop.logicGateIDs,
                              priority: priority.value,
                              status: column.status,
                              creatorRACIRole,
                              nodeIDsByLogicGateID: drop.nodeIDsByLogicGateID,
                            });
                          }
                          if (drop.nodeIDs.length > 0) {
                            onDropNodesInCell({
                              nodeIDs: drop.nodeIDs,
                              priority: priority.value,
                              status: column.status,
                              creatorRACIRole,
                              fromLogicGateID: drop.fromLogicGateID,
                            });
                          }
                        }, (cause) => console.error("Failed to load Company Explorer folder", cause));
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
                            onCreateLogicGate={() => onCreateLogicGateInCell({ priority: priority.value, status: column.status, creatorRACIRole })}
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
    <HomePinContextMenu menu={pinContextMenu} onClose={() => setPinContextMenu(null)} resolveLabel={(target) => target.kind === "node" ? nodeTitle(nodeByID.get(target.id)) || target.label : target.kind === "logic_gate" ? logicGateTitle(logicGateByID.get(target.id)) || target.label : target.label} />
    {cellContextMenu && (
      <FrameRightClickMenu x={cellContextMenu.x} y={cellContextMenu.y} onClose={() => setCellContextMenu(null)} width={HOME_COMPACT_CONTEXT_MENU_WIDTH}>
        <button
          type="button"
          style={sharedInboxContextMenuButtonStyle}
          onClick={() => {
            const input = { priority: cellContextMenu.priority, status: cellContextMenu.status, creatorRACIRole: cellContextMenu.creatorRACIRole };
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
            const input = { priority: cellContextMenu.priority, status: cellContextMenu.status, creatorRACIRole: cellContextMenu.creatorRACIRole };
            setCellContextMenu(null);
            onCreateNodeInCell(input);
          }}
        >
          Create Note
        </button>
      </FrameRightClickMenu>
    )}
    <InboxNotificationMenu menu={currentNotificationMenu} onClose={() => setNotificationMenu(null)} onOpen={openNotificationTarget} onClear={clearGroupNotifications} />
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
  notificationRole?: NotificationRACIRole;
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
      ? nodeIDsFromExplorerPayload(readExplorerDragPayload(dataTransfer))
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
  notificationRole?: NotificationRACIRole;
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

// Mail provider send constraint; Mango's browser-upload policy remains the
// authoritative per-file storage limit.
const EMAIL_PROVIDER_ATTACHMENT_MAX_TOTAL_BYTES = 24_000_000;

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

function emailAttachmentIsCalendarInvite(attachment: EmailAttachment): boolean {
  return (emailAttachmentContentType(attachment).toLowerCase().split(";", 1)[0] ?? "").trim() === "text/calendar"
    || emailAttachmentFileName(attachment).toLowerCase().endsWith(".ics");
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

function EmailAttachmentTile({ messageID, attachment, companyID, sharedInboxID, accountEmail, collaborationID }: {
  messageID: string;
  attachment: EmailAttachment;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  collaborationID?: string;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const [previewRequested, setPreviewRequested] = React.useState(false);
  const [previewURL, setPreviewURL] = React.useState("");
  const [loadingPreview, setLoadingPreview] = React.useState(false);
  const [previewFailed, setPreviewFailed] = React.useState(false);
  const apiBase = readAuthConfig().apiBase;
  const mangoAttachmentID = attachment.attachment_id?.trim() ?? "";
  const providerAttachmentID = attachment.id?.trim() ?? "";
  const filename = emailAttachmentFileName(attachment);
  const contentType = emailAttachmentContentType(attachment);
  const canRenderInline = attachmentCanRenderInline(contentType);
  const shouldLoadPreview = canRenderInline && (emailAttachmentIsImage(attachment) || previewRequested);
  const canDownload = !!mangoAttachmentID || !!providerAttachmentID || !!attachment.content?.trim();
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
    if (!mangoAttachmentID && !providerAttachmentID) {
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
    const controller = new AbortController();
    const previewPromise = mangoAttachmentID
      ? loadMangoAttachmentObjectURL(apiBase, companyID, mangoAttachmentID, "display", { signal: controller.signal })
      : downloadEmailAttachment(messageID, providerAttachmentID, companyID, sharedInboxID, { signal: controller.signal, accountEmail, collaborationID }).then((blob) => URL.createObjectURL(blob));
    void previewPromise
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectURL = url;
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
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [accountEmail, apiBase, attachment, collaborationID, companyID, mangoAttachmentID, messageID, providerAttachmentID, sharedInboxID, shouldLoadPreview]);

  const handleDownload = React.useCallback(() => {
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) {
      downloadURL(inlineURL, filename);
      return;
    }
    if (mangoAttachmentID) {
      void downloadMangoAttachment({ apiBase, companyID, attachmentID: mangoAttachmentID, filename });
      return;
    }
    if (!providerAttachmentID) return;
    void downloadEmailAttachment(messageID, providerAttachmentID, companyID, sharedInboxID, { accountEmail, collaborationID })
      .then((blob) => {
        const objectURL = URL.createObjectURL(blob);
        downloadURL(objectURL, filename, true);
      });
  }, [accountEmail, apiBase, attachment, collaborationID, companyID, filename, mangoAttachmentID, messageID, providerAttachmentID, sharedInboxID]);

  const handleOpen = React.useCallback(() => {
    const inlineURL = emailAttachmentDataURL(attachment);
    if (inlineURL) {
      openAttachmentURL(inlineURL, filename);
      return;
    }
    if (mangoAttachmentID) {
      void loadMangoAttachmentObjectURL(apiBase, companyID, mangoAttachmentID, "original")
        .then((objectURL) => {
          openAttachmentURL(objectURL, filename, true);
        });
      return;
    }
    if (!providerAttachmentID) return;
    void downloadEmailAttachment(messageID, providerAttachmentID, companyID, sharedInboxID, { accountEmail, collaborationID })
      .then((blob) => {
        const objectURL = URL.createObjectURL(blob);
        openAttachmentURL(objectURL, filename, true);
      });
  }, [accountEmail, apiBase, attachment, collaborationID, companyID, filename, mangoAttachmentID, messageID, providerAttachmentID, sharedInboxID]);

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

function useComposeAttachmentObjectURL(attachment: ComposeAttachment, companyID: string, enabled: boolean): string {
  const apiBase = readAuthConfig().apiBase;
  const attachmentID = attachment.attachmentID.trim();
  const [objectURL, setObjectURL] = React.useState("");

  React.useEffect(() => {
    setObjectURL("");
    if (!enabled || !apiBase.trim() || !companyID.trim() || !attachmentID) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    void loadMangoAttachmentObjectURL(apiBase, companyID, attachmentID, "display", { signal: controller.signal })
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setObjectURL(url);
      })
      .catch(() => {
        if (!cancelled) setObjectURL("");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiBase, attachmentID, companyID, enabled]);

  React.useEffect(() => () => {
    if (objectURL) URL.revokeObjectURL(objectURL);
  }, [objectURL]);

  return objectURL;
}

function ComposeAttachmentTile({ attachment, companyID, onRemove }: {
  attachment: ComposeAttachment;
  companyID: string;
  onRemove: (attachmentID: string) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const filename = attachment.filename.trim() || "attachment";
  const contentType = composeAttachmentContentType(attachment);
  const sourceURL = useComposeAttachmentObjectURL(attachment, companyID, contentType.startsWith("image/"));
  const attachmentID = attachment.attachmentID.trim();
  const showActions = hovered || focused;
  const openAttachment = () => {
    if (!attachmentID) return;
    void downloadMangoAttachment({
      apiBase: readAuthConfig().apiBase,
      companyID,
      attachmentID,
      filename,
    });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      style={attachmentTileStyle(Boolean(attachmentID), showActions)}
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
        openAttachment();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openAttachment();
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

type ComposeRecipientField = "to" | "cc" | "bcc";

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

const composeRichToolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  flexWrap: "wrap",
  padding: "5px 6px",
  border: "1px solid rgba(148, 163, 184, 0.24)",
  borderRadius: 7,
  background: "rgba(255, 255, 255, 0.72)",
};

const composeRichEditorStyle: React.CSSProperties = {
  ...mailPanelTextareaStyle,
  minHeight: 180,
  height: "100%",
  overflowY: "auto",
  outline: "none",
  color: "#111827",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

function composePanelStyle(replyMode: boolean): React.CSSProperties {
  return {
    ...composeStyle,
    height: "100%",
    gridTemplateRows: replyMode ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr)",
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

const composeNewMessageDockStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto auto auto auto minmax(180px, 1fr) auto",
  gap: 8,
  overflowY: "auto",
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

const MAIL_REPLY_EDITOR_HEIGHT_STORAGE_KEY_PREFIX = "mango-mail-reply-editor-height-v1";
const MAIL_REPLY_EDITOR_DEFAULT_HEIGHT_PX = 320;
const MAIL_REPLY_EDITOR_MIN_HEIGHT_PX = 240;

function mailReplyEditorMaxHeight(): number {
  const viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight;
  return Math.max(MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, Math.floor(viewportHeight * 0.62));
}

function mailReplyEditorHeightStorageKey(companyID: string, currentUserID: string, sharedInboxID: string, accountEmail: string): string {
  const scope = sharedInboxID.trim()
    ? `shared:${sharedInboxID.trim()}`
    : `personal:${accountEmail.trim().toLowerCase() || "default"}`;
  return [MAIL_REPLY_EDITOR_HEIGHT_STORAGE_KEY_PREFIX, companyID.trim(), currentUserID.trim(), scope]
    .map(encodeURIComponent)
    .join(":");
}

export function readMailReplyEditorHeight(companyID: string, currentUserID: string, sharedInboxID: string, accountEmail = ""): number {
  const fallback = clampNumber(MAIL_REPLY_EDITOR_DEFAULT_HEIGHT_PX, MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, mailReplyEditorMaxHeight());
  if (typeof localStorage === "undefined") return fallback;
  try {
    const stored = Number.parseInt(localStorage.getItem(mailReplyEditorHeightStorageKey(companyID, currentUserID, sharedInboxID, accountEmail)) ?? "", 10);
    return Number.isFinite(stored)
      ? clampNumber(stored, MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, mailReplyEditorMaxHeight())
      : fallback;
  } catch {
    return fallback;
  }
}

export function saveMailReplyEditorHeight(companyID: string, currentUserID: string, sharedInboxID: string, height: number, accountEmail = ""): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      mailReplyEditorHeightStorageKey(companyID, currentUserID, sharedInboxID, accountEmail),
      String(Math.round(clampNumber(height, MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, mailReplyEditorMaxHeight()))),
    );
  } catch {
    // Browser privacy/storage settings can disable preferences; keep the in-memory height.
  }
}

function composeReplyRichEditorStyle(height: number): React.CSSProperties {
  return {
    ...composeRichEditorStyle,
    height,
    minHeight: MAIL_REPLY_EDITOR_MIN_HEIGHT_PX,
    maxHeight: "none",
    resize: "none",
  };
}

function recipientQuery(value: string): string {
  return value.trim().toLowerCase();
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

export function ComposePanel({ compose, busy, replyMessage, emailSignature, emailSignatureID, emailSignatureAccountEmail, companyID, currentUserID, companyUsers, onChange, onCancel, onSubmit, onEmailSignatureChange, onSaveEmailSignature, onSaveDraft, onEnsureDraft, onDiscardEmptyDraft }: {
  compose: ComposeState;
  busy: boolean;
  replyMessage?: EmailMessage | null;
  emailSignature: string;
  emailSignatureID: string;
  emailSignatureAccountEmail: string;
  companyID: string;
  currentUserID: string;
  companyUsers: CompanyUser[];
  onChange: React.Dispatch<React.SetStateAction<ComposeState>>;
  onCancel: () => void;
  onSubmit: (event: React.FormEvent, compose: ComposeState) => void;
  onEmailSignatureChange: (value: string) => void;
  onSaveEmailSignature: (signature: string) => void;
  onSaveDraft: (compose: ComposeState) => void;
  onEnsureDraft: (compose: ComposeState) => Promise<ComposeState>;
  onDiscardEmptyDraft: (compose: ComposeState) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const bodyEditorControllerRef = React.useRef<UnifiedRichEditorFormattingController | null>(null);
  const signatureEditorControllerRef = React.useRef<UnifiedRichEditorFormattingController | null>(null);
  const recipientInputRefs = React.useRef<Record<ComposeRecipientField, HTMLInputElement | null>>({ to: null, cc: null, bcc: null });
  const attachmentMutationStatesRef = React.useRef<Map<string, EditorAttachmentMutationState>>(new Map());
  const [attachmentError, setAttachmentError] = React.useState("");
  const [signatureEditorOpen, setSignatureEditorOpen] = React.useState(false);
  const [signatureEditorMode, setSignatureEditorMode] = React.useState<"edit" | "preview">("edit");
  const [activeRecipientField, setActiveRecipientField] = React.useState<ComposeRecipientField | "">("");
  const [recipientDrafts, setRecipientDrafts] = React.useState<Record<ComposeRecipientField, string>>({ to: "", cc: "", bcc: "" });
  const [replyEditorHeight, setReplyEditorHeight] = React.useState(() => (
    readMailReplyEditorHeight(companyID, currentUserID, compose.sharedInboxID, compose.accountEmail)
  ));
  const [bodyOutlineStyle, setBodyOutlineStyle] = React.useState<EditorOutlineStyleID>("automatic-outline-numbering");
  const [bodyToolbarTab, setBodyToolbarTab] = React.useState<EditorTabID>("format");
  const [bodySelectionFontSize, setBodySelectionFontSize] = React.useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [bodySelectionInlineFormat, setBodySelectionInlineFormat] = React.useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [bodyHighlightColor, setBodyHighlightColor] = React.useState<EditorHighlightColor | null>(null);
  const [bodyTextAlignment, setBodyTextAlignment] = React.useState<EditorTextAlignment>("left");
  const [signatureOutlineStyle, setSignatureOutlineStyle] = React.useState<EditorOutlineStyleID>("automatic-outline-numbering");
  const [signatureToolbarTab, setSignatureToolbarTab] = React.useState<EditorTabID>("format");
  const [signatureSelectionFontSize, setSignatureSelectionFontSize] = React.useState(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [signatureSelectionInlineFormat, setSignatureSelectionInlineFormat] = React.useState<EditorSelectionInlineFormatState>({ bold: false, underline: false, italic: false, strikethrough: false });
  const [signatureHighlightColor, setSignatureHighlightColor] = React.useState<EditorHighlightColor | null>(null);
  const [signatureTextAlignment, setSignatureTextAlignment] = React.useState<EditorTextAlignment>("left");
  const apiBase = readAuthConfig().apiBase;
  const attachmentRequestJSON = React.useMemo(() => defaultAttachmentRequestJSON(apiBase), [apiBase]);
  const attachmentMutationKey = (value: ComposeState) => JSON.stringify([
    companyID.trim(),
    currentUserID.trim(),
    value.draftID.trim(),
    value.sharedInboxID.trim(),
    value.accountEmail.trim().toLowerCase(),
  ]);
  const createAttachmentMutationLifecycle = (value: ComposeState) => {
    const key = attachmentMutationKey(value);
    return {
      begin: () => beginEditorAttachmentMutation(attachmentMutationStatesRef.current, key),
      finish: (succeeded: boolean) => {
        if (finishEditorAttachmentMutation(attachmentMutationStatesRef.current, key, succeeded)) {
          onDiscardEmptyDraft(value);
        }
      },
    };
  };
  const update = (patch: Partial<ComposeState> | ((current: ComposeState) => Partial<ComposeState>)) => {
    onChange((current) => ({
      ...current,
      ...(typeof patch === "function" ? patch(current) : patch),
    }));
  };
  const totalAttachmentBytes = compose.attachments.reduce((sum, attachment) => sum + Math.max(0, attachment.size || 0), 0);
  React.useEffect(() => {
    setReplyEditorHeight(readMailReplyEditorHeight(companyID, currentUserID, compose.sharedInboxID, compose.accountEmail));
  }, [companyID, compose.accountEmail, compose.sharedInboxID, currentUserID]);
  React.useEffect(() => {
    const clampToViewport = () => {
      setReplyEditorHeight((current) => clampNumber(current, MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, mailReplyEditorMaxHeight()));
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, []);
  React.useEffect(() => {
    if (!compose.replyToMessageID.trim()) return undefined;
    const frame = window.requestAnimationFrame(() => bodyEditorControllerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [compose.draftID, compose.focusRequestID, compose.replyToMessageID]);
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
    else if (field === "cc") update({ cc: value });
    else update({ bcc: value });
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
    const cleanCompanyID = companyID.trim();
    const cleanDraftID = compose.draftID.trim() || createHomeMailDraftID();
    const cleanSharedInboxID = compose.sharedInboxID.trim();
    const cleanAccountEmail = compose.accountEmail.trim().toLowerCase();
    const cleanCollaborationID = compose.sharedDraft ? compose.collaborationID.trim() : "";
    if (!cleanCompanyID || (!cleanCollaborationID && !cleanSharedInboxID && (!currentUserID.trim() || !cleanAccountEmail))) {
      setAttachmentError("Email attachment context is unavailable.");
      return;
    }
    const selectedBytes = selectedFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalAttachmentBytes + selectedBytes > EMAIL_PROVIDER_ATTACHMENT_MAX_TOTAL_BYTES) {
      setAttachmentError("Attachments are limited to 24 MB total.");
      return;
    }
    const preparedTarget = { ...compose, draftID: cleanDraftID };
    const attachmentMutationLifecycle = createAttachmentMutationLifecycle(preparedTarget);
    attachmentMutationLifecycle.begin();
    let attachmentMutationSucceeded = false;
    try {
      const preparedCompose = await onEnsureDraft(preparedTarget);
      const preparedSharedInboxID = preparedCompose.sharedInboxID.trim();
      const resourceID = mangoEmailDraftResourceID({ draftID: cleanDraftID });
      const results = await Promise.allSettled(selectedFiles.map(async (file) => {
        const uploaded = await uploadMangoAttachment(attachmentRequestJSON, {
          companyID: cleanCompanyID,
          resourceType: "email_draft",
          resourceID,
          file,
          sourceKind: "email_outgoing",
          relationshipKind: "email_attachment",
          messageID: preparedCompose.replyToMessageID.trim() || undefined,
          editorSurface: preparedCompose.sharedDraft && preparedCompose.collaborationID.trim()
            ? "email-collaboration-shared-draft"
            : preparedSharedInboxID ? "shared-triage-compose" : "my-triage-compose",
        });
        const attachment = uploaded.attachment;
        return {
          id: attachment.attachment_id,
          attachmentID: attachment.attachment_id,
          filename: attachment.original_filename || file.name || "attachment",
          contentType: attachment.mime_type || file.type || "application/octet-stream",
          size: attachment.byte_size || file.size,
        };
      }));
      const additions = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      attachmentMutationSucceeded = additions.length > 0;
      if (additions.length > 0) update((current) => ({ draftID: cleanDraftID, attachments: [...current.attachments, ...additions] }));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failures.length > 0) {
        const first = failures[0]?.reason;
        setAttachmentError(first instanceof Error ? first.message : `${failures.length} attachment upload${failures.length === 1 ? "" : "s"} failed.`);
      }
    } catch (attachError) {
      setAttachmentError(attachError instanceof Error ? attachError.message : "Failed to upload attachment.");
    } finally {
      attachmentMutationLifecycle.finish(attachmentMutationSucceeded);
    }
  };
  const removeAttachment = (attachmentID: string) => {
    update((current) => ({ attachments: current.attachments.filter((attachment) => attachment.id !== attachmentID) }));
  };
  const insertSignature = () => {
    const signature = emailSignature.trim();
    if (!signature) return;
    const currentBody = bodyEditorControllerRef.current?.flush() ?? compose.body;
    const body = applyHomeMailSignature(currentBody, signature);
    if (body === currentBody) return;
    update({ body });
  };
  const syncBodyToolbarFormatState = () => {
    const state = bodyEditorControllerRef.current?.readFormatState();
    if (!state) return;
    setBodySelectionFontSize(state.fontSize);
    setBodySelectionInlineFormat({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
    setBodyHighlightColor(state.highlightColor);
    setBodyTextAlignment(state.textAlignment);
  };
  const adjustBodyFontSize = (delta: number) => {
    bodyEditorControllerRef.current?.adjustFontSize(delta);
    syncBodyToolbarFormatState();
  };
  const setBodyFontSize = (fontSize: number) => {
    bodyEditorControllerRef.current?.applyFontSizeValue(fontSize);
    syncBodyToolbarFormatState();
  };
  const toggleBodyInlineFormat = (command: EditorInlineStyleCommand) => {
    bodyEditorControllerRef.current?.toggleInlineFormat(command);
    syncBodyToolbarFormatState();
  };
  const setBodySelectionHighlightColor = (color: EditorHighlightColor | null) => {
    bodyEditorControllerRef.current?.applyHighlightColor(color);
    syncBodyToolbarFormatState();
  };
  const setBodySelectionTextAlignment = (alignment: EditorTextAlignment) => {
    bodyEditorControllerRef.current?.applyTextAlignment(alignment);
    syncBodyToolbarFormatState();
  };
  const syncSignatureToolbarFormatState = () => {
    const state = signatureEditorControllerRef.current?.readFormatState();
    if (!state) return;
    setSignatureSelectionFontSize(state.fontSize);
    setSignatureSelectionInlineFormat({ bold: state.bold, underline: state.underline, italic: state.italic, strikethrough: state.strikethrough });
    setSignatureHighlightColor(state.highlightColor);
    setSignatureTextAlignment(state.textAlignment);
  };
  const adjustSignatureFontSize = (delta: number) => {
    signatureEditorControllerRef.current?.adjustFontSize(delta);
    syncSignatureToolbarFormatState();
  };
  const setSignatureFontSize = (fontSize: number) => {
    signatureEditorControllerRef.current?.applyFontSizeValue(fontSize);
    syncSignatureToolbarFormatState();
  };
  const toggleSignatureInlineFormat = (command: EditorInlineStyleCommand) => {
    signatureEditorControllerRef.current?.toggleInlineFormat(command);
    syncSignatureToolbarFormatState();
  };
  const setSignatureSelectionHighlightColor = (color: EditorHighlightColor | null) => {
    signatureEditorControllerRef.current?.applyHighlightColor(color);
    syncSignatureToolbarFormatState();
  };
  const isReplyMode = compose.kind === "reply" && !!replyMessage;
  const isForwardMode = compose.kind === "forward" && !!replyMessage;
  const setSignatureSelectionTextAlignment = (alignment: EditorTextAlignment) => {
    signatureEditorControllerRef.current?.applyTextAlignment(alignment);
    syncSignatureToolbarFormatState();
  };
  const startReplyEditorResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const pointerID = event.pointerId;
    const startY = event.clientY;
    const startHeight = replyEditorHeight;
    const maxHeight = mailReplyEditorMaxHeight();
    let finalHeight = startHeight;
    let finished = false;
    try {
      handle.setPointerCapture(pointerID);
    } catch {
      // Window-level listeners still provide a safe fallback.
    }
    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerID || finished) return;
      finalHeight = clampNumber(startHeight + startY - moveEvent.clientY, MAIL_REPLY_EDITOR_MIN_HEIGHT_PX, maxHeight);
      setReplyEditorHeight(finalHeight);
    };
    const finishResize = () => {
      if (finished) return;
      finished = true;
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("blur", finishResize);
      handle.removeEventListener("lostpointercapture", finishResize);
      try {
        if (handle.hasPointerCapture(pointerID)) handle.releasePointerCapture(pointerID);
      } catch {
        // The pointer may already have been released outside the window.
      }
      saveMailReplyEditorHeight(companyID, currentUserID, compose.sharedInboxID, finalHeight, compose.accountEmail);
    };
    const onPointerUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === pointerID) finishResize();
    };
    const onPointerCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerID) finishResize();
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("blur", finishResize, { once: true });
    handle.addEventListener("lostpointercapture", finishResize, { once: true });
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
  const richEditorStyle = isReplyMode ? composeReplyRichEditorStyle(replyEditorHeight) : composeRichEditorStyle;
  const composeEditorSurfaceID = compose.sharedDraft
    ? "email-collaboration-shared-draft"
    : compose.sharedInboxID.trim() ? "shared-triage-compose" : "my-triage-compose";
  const composeAttachmentResourceID = React.useMemo(
    () => mangoEmailDraftResourceID({ draftID: compose.draftID }),
    [compose.draftID],
  );
  const composeEditorImageAttachmentContext = companyID.trim() && composeAttachmentResourceID
    ? {
      requestJSON: attachmentRequestJSON,
      apiBase,
      companyID: companyID.trim(),
      resourceType: "email_draft" as const,
      resourceID: composeAttachmentResourceID,
      editorSurface: composeEditorSurfaceID,
      mutationLifecycle: createAttachmentMutationLifecycle(compose),
      prepareResource: async () => {
        await onEnsureDraft(compose);
      },
      onError: (message: string) => {
        setAttachmentError(message);
      },
    }
    : undefined;
  const signatureAttachmentResourceID = React.useMemo(
    () => mangoEmailSignatureResourceID({ signatureID: emailSignatureID }),
    [emailSignatureID],
  );
  const signatureEditorImageAttachmentContext = companyID.trim() && signatureAttachmentResourceID
    ? {
      requestJSON: attachmentRequestJSON,
      apiBase,
      companyID: companyID.trim(),
      resourceType: "email_signature" as const,
      resourceID: signatureAttachmentResourceID,
      editorSurface: compose.sharedInboxID.trim() ? "shared-email-signature" : "personal-email-signature",
    }
    : undefined;
  const handleSubmit = (event: React.FormEvent) => {
    const body = bodyEditorControllerRef.current?.flush() ?? compose.body;
    const submittedCompose = body === compose.body ? compose : { ...compose, body };
    onChange(submittedCompose);
    onSubmit(event, submittedCompose);
  };
  const handleSaveDraft = () => {
    const body = bodyEditorControllerRef.current?.flush() ?? compose.body;
    const composeToSave = body === compose.body ? compose : { ...compose, body };
    onChange(composeToSave);
    onSaveDraft(composeToSave);
  };
  return (
    <form style={composePanelStyle(isReplyMode)} onSubmit={handleSubmit}>
      <div style={isReplyMode ? composeReplyHeaderStyle : panelHeaderStyle}>
        <h2 style={panelTitleStyle}>{compose.kind === "forward" ? "Forward" : compose.kind === "reply" ? "Reply" : compose.draftID ? "Draft" : "New Message"}</h2>
        {isReplyMode && (
          <div style={composeReplyHeaderFieldsStyle}>
            {renderRecipientInput("to", "To")}
            {renderRecipientInput("cc", "Cc")}
            {renderRecipientInput("bcc", "Bcc")}
            {renderSubjectInput(true)}
          </div>
        )}
        <div style={isReplyMode ? composeHeaderActionsStyle : { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" style={mailPanelSmallButtonStyle} onClick={handleSaveDraft}>
            {compose.sharedDraft ? "Save shared draft" : "Save to My Drafts"}
          </button>
          <button type="button" style={mailPanelSmallButtonStyle} onClick={onCancel}>Close</button>
        </div>
      </div>
      {isReplyMode && replyMessage && (
        <div style={composeReplyOriginalStyle}>
          <div style={mutedSmallStyle}>
            Original from {formatAddressList(replyMessage.from) || "Unknown sender"} to {formatAddressList(replyMessage.to) || "me"}
          </div>
          <iframe title="Original email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={messageDocument(replyMessage.body || replyMessage.snippet || "")} style={composeReplyOriginalFrameStyle} />
        </div>
      )}
      <div style={isReplyMode ? composeReplyDockStyle : composeNewMessageDockStyle}>
        {!isReplyMode && renderRecipientInput("to", "To")}
        {!isReplyMode && renderRecipientInput("cc", "Cc")}
        {!isReplyMode && renderRecipientInput("bcc", "Bcc")}
        {!isReplyMode && renderSubjectInput(false)}
        {isReplyMode && (
          <div
            style={composeReplyResizeHandleStyle}
            onPointerDown={startReplyEditorResize}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize reply editor"
            aria-valuemin={MAIL_REPLY_EDITOR_MIN_HEIGHT_PX}
            aria-valuemax={mailReplyEditorMaxHeight()}
            aria-valuenow={Math.round(replyEditorHeight)}
            title="Drag to resize. Mango saves this reply editor height automatically."
          >
            <div style={composeReplyResizeGripStyle} />
          </div>
        )}
        <div style={composeRichToolbarStyle}>
          <EditorTabBar
            activeTab={bodyToolbarTab}
            outlineStyle={bodyOutlineStyle}
            accent={HOME_CYAN}
            strokeColor="rgba(148, 163, 184, 0.34)"
            surfaceText="#111827"
            tabBackground="rgba(255, 255, 255, 0.76)"
            tabSelectedBackground="rgba(240, 253, 255, 0.9)"
            outlineMenuAccent={HOME_CYAN}
            onSelectTab={setBodyToolbarTab}
            onAdjustSelectionFontSize={adjustBodyFontSize}
            documentFontSize={bodySelectionFontSize}
            onSetSelectionFontSize={setBodyFontSize}
            boldActive={bodySelectionInlineFormat.bold}
            underlineActive={bodySelectionInlineFormat.underline}
            italicActive={bodySelectionInlineFormat.italic}
            strikethroughActive={bodySelectionInlineFormat.strikethrough}
            highlightColor={bodyHighlightColor}
            textAlignment={bodyTextAlignment}
            onToggleBold={() => toggleBodyInlineFormat("bold")}
            onToggleUnderline={() => toggleBodyInlineFormat("underline")}
            onToggleItalic={() => toggleBodyInlineFormat("italic")}
            onToggleStrikethrough={() => toggleBodyInlineFormat("strikethrough")}
            onSetSelectionHighlightColor={setBodySelectionHighlightColor}
            onSetTextAlignment={setBodySelectionTextAlignment}
            onInsertTable={() => bodyEditorControllerRef.current?.insertTable()}
            onOutlineStyleFocus={() => setBodyToolbarTab("outline-styles")}
            onOutlineStyleChange={(nextOutlineStyle) => {
              setBodyOutlineStyle(nextOutlineStyle);
              setBodyToolbarTab("outline-styles");
            }}
            reserveHeaderOffset={false}
            visibleTabIDs={UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS}
          />
        </div>
        <UnifiedRichEditorSurface
          key={`compose-editor:${composeAttachmentResourceID || `${composeEditorSurfaceID}:${compose.draftID}:${compose.accountEmail}`}`}
          value={compose.body}
          outlineStyle={bodyOutlineStyle}
          surfaceID={composeEditorSurfaceID}
          ariaLabel="Message"
          placeholder="Message"
          surfaceText="#111827"
          accent={HOME_CYAN}
          indentGuideColor="rgba(14,165,233,0.38)"
          mentionUsers={companyUsers}
          formattingControllerRef={bodyEditorControllerRef}
          style={richEditorStyle}
          onSelectionFontSizeChange={setBodySelectionFontSize}
          onSelectionInlineFormatChange={setBodySelectionInlineFormat}
          onSelectionHighlightColorChange={setBodyHighlightColor}
          onSelectionTextAlignmentChange={setBodyTextAlignment}
          entityLinkContext={{ companyID, requestJSON: attachmentRequestJSON }}
          editorImageAttachmentContext={composeEditorImageAttachmentContext}
          eagerEditorImageHydration
          onEditorImageAttachmentError={setAttachmentError}
          onChange={(body) => update({ body })}
        />
        {isForwardMode && replyMessage && (
          <section
            aria-label="Forwarded message preview"
            style={{ display: "grid", gap: 7, padding: 12, border: "1px solid rgba(148,163,184,0.34)", borderRadius: 10, background: "rgba(248,250,252,0.78)" }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <strong style={{ color: "#334155", fontSize: 13 }}>Forwarded message preview</strong>
              <span style={mutedSmallStyle}>Locked to preserve the original formatting</span>
            </div>
            <iframe
              title="Forwarded email preview"
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={messageDocument(buildForwardedEmailHTML(replyMessage))}
              style={{ ...mailComposeOriginalFrameStyle, minHeight: 280, height: 320, background: "#fff", borderRadius: 8 }}
            />
          </section>
        )}
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
          <button
            type="button"
            style={mailPanelSmallButtonStyle}
            onClick={() => setSignatureEditorOpen((current) => {
              if (!current) setSignatureEditorMode("edit");
              return !current;
            })}
          >
            {signatureEditorOpen ? "Hide Signature" : "Edit Signature"}
          </button>
          {!compose.sharedDraft && (
            <input
              type="datetime-local"
              aria-label="Schedule send"
              style={{ ...mailPanelInputStyle, width: 190, minHeight: 30, height: 30, padding: "0 8px" }}
              value={compose.scheduledAt}
              onChange={(event) => update({ scheduledAt: event.currentTarget.value })}
            />
          )}
          {attachmentError && <span style={mutedSmallStyle}>{attachmentError}</span>}
          {compose.draftID && <span style={mutedSmallStyle}>{compose.sharedDraft ? "Shared draft - visible to all email participants" : "Saved in My Drafts"}</span>}
          {compose.scheduledAt && <span style={mutedSmallStyle}>Scheduled</span>}
          <span aria-hidden="true" style={{ flex: "1 1 160px" }} />
          <button type="submit" style={mailComposeSendButtonStyle} disabled={busy}>{busy ? "Sending" : compose.scheduledAt ? "Schedule" : "Send"}</button>
        </div>
        {compose.attachments.length > 0 && (
          <div style={mailAttachmentGridStyle}>
            {compose.attachments.map((attachment) => (
              <ComposeAttachmentTile key={attachment.id} attachment={attachment} companyID={companyID} onRemove={removeAttachment} />
            ))}
          </div>
        )}
        {signatureEditorOpen && (
          <div style={mailComposeSignatureBoxStyle}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>Mailbox signature</strong>
                <div style={mutedSmallStyle}>Edit the full signature, then preview it exactly as it will appear in the message editor.</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" style={mailPanelSmallButtonStyle} aria-pressed={signatureEditorMode === "edit"} onClick={() => setSignatureEditorMode("edit")}>Edit</button>
                <button
                  type="button"
                  style={mailPanelSmallButtonStyle}
                  aria-pressed={signatureEditorMode === "preview"}
                  onClick={() => {
                    const signature = signatureEditorControllerRef.current?.flush() ?? emailSignature;
                    onEmailSignatureChange(signature);
                    setSignatureEditorMode("preview");
                  }}
                >
                  Preview
                </button>
              </div>
            </div>
            {signatureEditorMode === "edit" && <EditorTabBar
              activeTab={signatureToolbarTab}
              outlineStyle={signatureOutlineStyle}
              accent={HOME_CYAN}
              strokeColor="rgba(148, 163, 184, 0.34)"
              surfaceText="#111827"
              tabBackground="rgba(255, 255, 255, 0.76)"
              tabSelectedBackground="rgba(240, 253, 255, 0.9)"
              outlineMenuAccent={HOME_CYAN}
              onSelectTab={setSignatureToolbarTab}
              onAdjustSelectionFontSize={adjustSignatureFontSize}
              documentFontSize={signatureSelectionFontSize}
              onSetSelectionFontSize={setSignatureFontSize}
              boldActive={signatureSelectionInlineFormat.bold}
              underlineActive={signatureSelectionInlineFormat.underline}
              italicActive={signatureSelectionInlineFormat.italic}
              strikethroughActive={signatureSelectionInlineFormat.strikethrough}
              highlightColor={signatureHighlightColor}
              textAlignment={signatureTextAlignment}
              onToggleBold={() => toggleSignatureInlineFormat("bold")}
              onToggleUnderline={() => toggleSignatureInlineFormat("underline")}
              onToggleItalic={() => toggleSignatureInlineFormat("italic")}
              onToggleStrikethrough={() => toggleSignatureInlineFormat("strikethrough")}
              onSetSelectionHighlightColor={setSignatureSelectionHighlightColor}
              onSetTextAlignment={setSignatureSelectionTextAlignment}
              onInsertTable={() => signatureEditorControllerRef.current?.insertTable()}
              onOutlineStyleFocus={() => setSignatureToolbarTab("outline-styles")}
              onOutlineStyleChange={(nextOutlineStyle) => {
                setSignatureOutlineStyle(nextOutlineStyle);
                setSignatureToolbarTab("outline-styles");
              }}
              reserveHeaderOffset={false}
              visibleTabIDs={UNIFIED_EDITOR_FORMAT_TOOLBAR_TAB_IDS}
            />}
            <UnifiedRichEditorSurface
              key={`signature-editor:${signatureAttachmentResourceID || `${compose.sharedInboxID}:${emailSignatureAccountEmail}`}`}
              value={emailSignature}
              outlineStyle={signatureOutlineStyle}
              surfaceID="email-signature"
              editable={signatureEditorMode === "edit"}
              ariaLabel={signatureEditorMode === "edit" ? "Email signature editor" : "Email signature preview"}
              placeholder={signatureEditorMode === "edit" ? "Email signature" : "No signature saved"}
              surfaceText="#111827"
              accent={HOME_CYAN}
              indentGuideColor="rgba(14,165,233,0.38)"
              mentionUsers={companyUsers}
              formattingControllerRef={signatureEditorControllerRef}
              style={mailComposeSignatureTextareaStyle}
              onSelectionFontSizeChange={setSignatureSelectionFontSize}
              onSelectionInlineFormatChange={setSignatureSelectionInlineFormat}
              onSelectionHighlightColorChange={setSignatureHighlightColor}
              onSelectionTextAlignmentChange={setSignatureTextAlignment}
              entityLinkContext={{ companyID, requestJSON: attachmentRequestJSON }}
              editorImageAttachmentContext={signatureEditorImageAttachmentContext}
              eagerEditorImageHydration
              onEditorImageAttachmentError={setAttachmentError}
              onChange={onEmailSignatureChange}
            />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                style={mailPanelSmallButtonStyle}
                onClick={() => {
                  const signature = signatureEditorControllerRef.current?.flush() ?? emailSignature;
                  onSaveEmailSignature(signature);
                }}
              >
                Save signature
              </button>
              <button type="button" style={mailPanelSmallButtonStyle} onClick={insertSignature} disabled={!emailSignature.trim()}>Insert signature</button>
            </div>
          </div>
        )}
      </div>
    </form>
  );
}

export function conversationMessagesForDetail(message: EmailMessage, threadMessages: EmailMessage[]): EmailMessage[] {
  const fallbackScopeKey = message.client_source_scope_key?.trim() || "mailbox";
  const sourceMessages = threadMessages.length > 0 ? threadMessages : [message];
  return normalizeEmailThreadMessages(sourceMessages.map((candidate) => ({
    message: candidate,
    source: candidate.collaboration_id?.trim() ? "collaboration" : "provider",
    scopeKey: candidate.client_source_scope_key?.trim() || fallbackScopeKey,
  })), "oldest");
}
const emailBodyLoadingStyle: React.CSSProperties = {
  minHeight: 260,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(148, 163, 184, 0.22)",
  borderRadius: 8,
  background: "#ffffff",
  color: "rgba(100, 116, 139, 0.76)",
  fontSize: 12,
  fontWeight: 800,
};

function emailBodyDocumentHeight(frameDocument: Document): number {
  const root = frameDocument.documentElement;
  const body = frameDocument.body;
  return Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.getBoundingClientRect().height,
    body.scrollHeight,
    body.offsetHeight,
    body.getBoundingClientRect().height,
  );
}

function emailBodySelectionRange(
  frameDocument: Document,
  selection: Pick<EmailCollaborationSelection, "quote" | "startOffset" | "endOffset">,
): Range | null {
  const view = frameDocument.defaultView;
  if (!view || !frameDocument.body) return null;
  const walker = frameDocument.createTreeWalker(frameDocument.body, view.NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let bodyText = "";
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    textNodes.push(node);
    bodyText += node.data;
  }
  if (!bodyText || textNodes.length === 0) return null;
  const quote = selection.quote.trim();
  if (!quote) return null;
  let start = Math.max(0, Math.min(bodyText.length, selection.startOffset));
  let end = Math.max(start, Math.min(bodyText.length, selection.endOffset));
  if (bodyText.slice(start, end) !== quote) {
    const exactIndex = bodyText.indexOf(quote);
    if (exactIndex < 0) return null;
    start = exactIndex;
    end = exactIndex + quote.length;
  }
  const boundary = (offset: number): { node: Text; offset: number } | null => {
    let consumed = 0;
    for (const node of textNodes) {
      const next = consumed + node.data.length;
      if (offset <= next) return { node, offset: Math.max(0, Math.min(node.data.length, offset - consumed)) };
      consumed = next;
    }
    const last = textNodes[textNodes.length - 1];
    return last ? { node: last, offset: last.data.length } : null;
  };
  const startBoundary = boundary(start);
  const endBoundary = boundary(end);
  if (!startBoundary || !endBoundary) return null;
  const range = frameDocument.createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
}

function AutoHeightEmailBodyFrame({ srcDoc, minHeight, fillAvailableHeight = false, style, onTextSelection, highlights = [], activeSelection, selectionNavigation }: {
  srcDoc: string;
  minHeight: number;
  fillAvailableHeight?: boolean;
  style?: React.CSSProperties;
  onTextSelection?: (selection: Omit<EmailCollaborationSelection, "messageID">) => void;
  highlights?: readonly EmailBodyHighlightRange[];
  activeSelection?: EmailCollaborationSelection | null;
  selectionNavigation?: EmailCollaborationNavigation | null;
}) {
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const cleanupRef = React.useRef<() => void>(() => undefined);
  const [selectedImage, setSelectedImage] = React.useState<{ src: string; filename: string } | null>(null);
  const [previewImage, setPreviewImage] = React.useState<{ src: string; filename: string } | null>(null);
  const [pendingTextSelection, setPendingTextSelection] = React.useState<(Omit<EmailCollaborationSelection, "messageID"> & { left: number; top: number }) | null>(null);

  React.useEffect(() => () => cleanupRef.current(), []);
  React.useEffect(() => {
    setSelectedImage(null);
    setPreviewImage(null);
    setPendingTextSelection(null);
  }, [srcDoc]);

  const paintEmailHighlights = React.useCallback(() => {
    applyEmailBodyHighlights(frameRef.current?.contentDocument, highlights, selectionNavigation ?? activeSelection);
  }, [activeSelection, highlights, selectionNavigation]);

  const applySelectionNavigation = React.useCallback(() => {
    if (!selectionNavigation) return;
    const frame = frameRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument?.body) return;
    paintEmailHighlights();
    const range = emailBodySelectionRange(frameDocument, selectionNavigation);
    if (!range) return;
    const scrollContainer = frame.closest<HTMLElement>("[data-email-conversation-scroll]");
    const targetRect = range.getBoundingClientRect();
    if (scrollContainer && targetRect.height >= 0) {
      const frameRect = frame.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      scrollContainer.scrollBy({ top: frameRect.top + targetRect.top - containerRect.top - 64, behavior: "smooth" });
    } else {
      frame.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [paintEmailHighlights, selectionNavigation]);

  React.useEffect(() => {
    const frameID = window.requestAnimationFrame(paintEmailHighlights);
    return () => window.cancelAnimationFrame(frameID);
  }, [paintEmailHighlights]);

  React.useEffect(() => {
    if (!selectionNavigation) return undefined;
    const frameID = window.requestAnimationFrame(applySelectionNavigation);
    return () => window.cancelAnimationFrame(frameID);
  }, [applySelectionNavigation, selectionNavigation]);

  const handleLoad = () => {
    cleanupRef.current();
    cleanupRef.current = () => undefined;
    const frame = frameRef.current;
    const frameDocument = frame?.contentDocument;
    if (!frame || !frameDocument?.documentElement || !frameDocument.body) return;
    frameDocument.documentElement.style.overflow = "hidden";
    frameDocument.body.style.overflow = "hidden";
    paintEmailHighlights();
    const resize = () => {
      const frameMinHeight = frame.style.minHeight;
      frame.style.minHeight = "0px";
      frame.style.height = "0px";
      const documentHeight = emailBodyDocumentHeight(frameDocument);
      frame.style.minHeight = frameMinHeight;
      frame.style.height = `${Math.max(minHeight, Math.ceil(documentHeight) + 2)}px`;
    };
    const captureTextSelection = () => {
      if (!onTextSelection) return;
      const frameSelection = frame.contentWindow?.getSelection();
      if (!frameSelection || frameSelection.rangeCount === 0 || frameSelection.isCollapsed) return;
      const range = frameSelection.getRangeAt(0);
      if (!frameDocument.body.contains(range.commonAncestorContainer)) return;
      const rawQuote = frameSelection.toString();
      const quote = rawQuote.trim();
      if (!quote) return;
      const prefixRange = frameDocument.createRange();
      prefixRange.selectNodeContents(frameDocument.body);
      prefixRange.setEnd(range.startContainer, range.startOffset);
      const leadingWhitespace = rawQuote.length - rawQuote.trimStart().length;
      const startOffset = prefixRange.toString().length + leadingWhitespace;
      const bounds = range.getBoundingClientRect();
      setPendingTextSelection({
        quote,
        startOffset,
        endOffset: startOffset + quote.length,
        left: Math.max(8, Math.min(frame.clientWidth - 36, bounds.right - 12)),
        top: Math.max(8, bounds.top - 34),
      });
    };
    const images = Array.from(frameDocument.images);
    const imageCleanups: Array<() => void> = [];
    images.forEach((image, index) => {
      image.style.cursor = "zoom-in";
      const selectImage = (event: MouseEvent) => {
        event.preventDefault();
        event.stopPropagation();
        images.forEach((candidate) => { candidate.style.outline = ""; });
        image.style.outline = `2px solid ${HOME_CYAN}`;
        image.style.outlineOffset = "2px";
        setSelectedImage({ src: image.currentSrc || image.src, filename: image.alt?.trim() || `email-image-${index + 1}` });
      };
      const previewSelectedImage = (event: MouseEvent) => {
        selectImage(event);
        setPreviewImage({ src: image.currentSrc || image.src, filename: image.alt?.trim() || `email-image-${index + 1}` });
      };
      image.addEventListener("click", selectImage);
      image.addEventListener("dblclick", previewSelectedImage);
      image.addEventListener("load", resize);
      image.addEventListener("error", resize);
      imageCleanups.push(() => {
        image.removeEventListener("click", selectImage);
        image.removeEventListener("dblclick", previewSelectedImage);
      });
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (observer) {
      observer.observe(frameDocument.documentElement);
      observer.observe(frameDocument.body);
    }
    frameDocument.addEventListener("pointerup", captureTextSelection);
    resize();
    applySelectionNavigation();
    cleanupRef.current = () => {
      observer?.disconnect();
      frameDocument.removeEventListener("pointerup", captureTextSelection);
      images.forEach((image) => {
        image.removeEventListener("load", resize);
        image.removeEventListener("error", resize);
      });
      imageCleanups.forEach((cleanup) => cleanup());
    };
  };

  const availableHeightStyle: React.CSSProperties = fillAvailableHeight
    ? { minHeight: "100%", alignSelf: "stretch" }
    : {};
  const frameInitialHeight: React.CSSProperties["height"] = fillAvailableHeight ? "100%" : minHeight;

  return (
    <>
      <div style={{ position: "relative", minWidth: 0, display: "grid", ...availableHeightStyle }}>
        {selectedImage && (
          <button
            type="button"
            style={{ ...mailPanelSmallButtonStyle, position: "absolute", zIndex: 3, top: 8, right: 8, boxShadow: "0 8px 18px rgba(15,23,42,0.16)" }}
            onClick={() => downloadURL(selectedImage.src, selectedImage.filename)}
          >
            Download image
          </button>
        )}
        {pendingTextSelection && onTextSelection && (
          <button
            type="button"
            data-email-selection-chat-action="true"
            title="Turn highlighted email text into a chat"
            aria-label="Turn highlighted email text into a chat"
            onClick={() => {
              const { quote, startOffset, endOffset } = pendingTextSelection;
              onTextSelection({ quote, startOffset, endOffset });
              setPendingTextSelection(null);
            }}
            style={{ ...mailPanelSmallButtonStyle, position: "absolute", zIndex: 4, left: pendingTextSelection.left, top: pendingTextSelection.top, width: 30, minWidth: 30, height: 28, minHeight: 28, display: "grid", placeItems: "center", padding: 0, boxShadow: "0 8px 18px rgba(15,23,42,0.18)" }}
          >
            <ChatIcon color="rgba(71,85,105,0.9)" />
          </button>
        )}
        <iframe
          ref={frameRef}
          title="Email body"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          srcDoc={srcDoc}
          scrolling="no"
          onLoad={handleLoad}
          style={{ ...iframeStyle, ...style, ...availableHeightStyle, height: frameInitialHeight, overflow: "hidden" }}
        />
      </div>
      {previewImage && (
        <AppModalPortal onRequestClose={() => setPreviewImage(null)}>
        <div role="dialog" aria-modal="true" aria-label="Email image preview" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewImage(null); }} style={{ position: "fixed", zIndex: 1, inset: 0, display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", placeItems: "center", background: "rgba(15,23,42,0.82)", padding: 18 }}>
          <img src={previewImage.src} alt={previewImage.filename} style={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 90px)", objectFit: "contain" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 10 }}>
            <button type="button" style={mailPanelSmallButtonStyle} onClick={() => downloadURL(previewImage.src, previewImage.filename)}>Download</button>
            <button type="button" style={mailPanelSmallButtonStyle} onClick={() => setPreviewImage(null)}>Close</button>
          </div>
        </div>
        </AppModalPortal>
      )}
    </>
  );
}

function emailAttachmentDownloadID(attachment: EmailAttachment): string {
  return attachment.id?.trim() || attachment.attachment_id?.trim() || "";
}

function emailMessageBodyIsLoaded(message: EmailMessage): boolean {
  return message.detail_fetched === true || typeof message.body === "string";
}

function useEmailBodyDocument(messageID: string, body: string, attachments: EmailAttachment[], companyID: string, sharedInboxID: string | undefined, accountEmail: string | undefined, collaborationID: string | undefined, enabled: boolean): { srcDoc: string } {
  const apiBase = readAuthConfig().apiBase;
  const collaborationIDRef = React.useRef(collaborationID);
  collaborationIDRef.current = collaborationID;
  const inlineAttachments = React.useMemo(
    () => attachments.filter((attachment) => emailAttachmentIsReferencedInline(body, attachment)),
    [attachments, body],
  );
  const inlineAttachmentKey = React.useMemo(() => (
    inlineAttachments
      .map((attachment) => [
        emailAttachmentDownloadID(attachment),
        attachment.content_id?.trim() ?? "",
        attachment.filename?.trim() ?? "",
        attachment.content_type?.trim() ?? "",
        attachment.content?.trim() ? "inline-content" : "",
      ].join(":"))
      .join("|")
  ), [inlineAttachments]);
  const embeddedSourceByContentID = React.useMemo(() => {
    const sources: Record<string, string> = {};
    for (const attachment of inlineAttachments) {
      const inlineURL = emailAttachmentDataURL(attachment);
      if (!inlineURL) continue;
      for (const key of emailAttachmentContentIDKeys(attachment)) sources[key] = inlineURL;
    }
    return sources;
  }, [inlineAttachments]);
  const hydrationKey = `${companyID}\x1f${sharedInboxID ?? ""}\x1f${sharedInboxID ? "" : accountEmail?.trim().toLowerCase() ?? ""}\x1f${messageID}\x1f${inlineAttachmentKey}`;
  const [downloadedCIDState, setDownloadedSourceByContentID] = React.useState<{
    hydrationKey: string;
    sources: Record<string, string>;
  }>({ hydrationKey: "", sources: {} });

  React.useEffect(() => {
    setDownloadedSourceByContentID({ hydrationKey, sources: {} });
    if (!enabled || !body.trim() || inlineAttachments.length === 0) return undefined;
    const attachmentsToDownload = inlineAttachments.filter((attachment) => !emailAttachmentDataURL(attachment));
    if (attachmentsToDownload.length === 0) return undefined;
    let cancelled = false;
    const objectURLs: string[] = [];
    const controller = new AbortController();
    const loadInlineAttachment = async (attachment: EmailAttachment): Promise<{ keys: string[]; sourceURL: string }> => {
      const keys = emailAttachmentContentIDKeys(attachment);
      try {
        const mangoAttachmentID = attachment.attachment_id?.trim() ?? "";
        const providerAttachmentID = attachment.id?.trim() ?? "";
        let sourceURL = "";
        if (mangoAttachmentID) {
          sourceURL = await loadMangoAttachmentObjectURL(apiBase, companyID, mangoAttachmentID, "display", { signal: controller.signal });
        } else if (providerAttachmentID) {
          const blob = await downloadEmailAttachment(messageID, providerAttachmentID, companyID, sharedInboxID, { signal: controller.signal, accountEmail, collaborationID: collaborationIDRef.current });
          if (cancelled) return { keys, sourceURL: "" };
          sourceURL = URL.createObjectURL(blob);
        }
        if (cancelled) {
          if (sourceURL.startsWith("blob:")) URL.revokeObjectURL(sourceURL);
          return { keys, sourceURL: "" };
        }
        if (sourceURL && sourceURL.startsWith("blob:")) objectURLs.push(sourceURL);
        return { keys, sourceURL };
      } catch {
        return { keys, sourceURL: "" };
      }
    };
    void Promise.all(attachmentsToDownload.map(async (attachment) => {
      const item = await loadInlineAttachment(attachment);
      if (cancelled || !item.sourceURL) return;
      setDownloadedSourceByContentID((current) => {
        const next = current.hydrationKey === hydrationKey ? { ...current.sources } : {};
        for (const key of item.keys) next[key] = item.sourceURL;
        return { hydrationKey, sources: next };
      });
    }));
    return () => {
      cancelled = true;
      controller.abort();
      objectURLs.forEach((objectURL) => URL.revokeObjectURL(objectURL));
    };
  }, [accountEmail, apiBase, body, companyID, enabled, hydrationKey, inlineAttachmentKey, inlineAttachments, messageID, sharedInboxID]);

  const srcDoc = React.useMemo(() => {
    if (!enabled) return "";
    const documentHTML = messageDocument(body);
    const downloadedSources = downloadedCIDState.hydrationKey === hydrationKey ? downloadedCIDState.sources : {};
    return rewriteEmailDocumentCIDSources(documentHTML, { ...embeddedSourceByContentID, ...downloadedSources });
  }, [body, downloadedCIDState, embeddedSourceByContentID, enabled, hydrationKey]);

  return { srcDoc };
}

function EmailConversationMessage({ message, companyID, sharedInboxID, accountEmail, fill, expanded, latest, showReplyActions, timelineStart, timelineEnd, busy, calendarResponseAvailable, loadingBody = false, chatHighlights = [], activeSelection, selectionNavigation, onToggleExpanded, onLoadBody, onReply, onReplyAll, onEmailSelection }: {
  message: EmailMessage;
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  fill: boolean;
  expanded: boolean;
  latest: boolean;
  showReplyActions: boolean;
  timelineStart: boolean;
  timelineEnd: boolean;
  busy: boolean;
  calendarResponseAvailable: boolean;
  loadingBody?: boolean;
  chatHighlights?: readonly EmailBodyHighlightRange[];
  activeSelection?: EmailCollaborationSelection | null;
  selectionNavigation?: EmailCollaborationNavigation | null;
  onToggleExpanded: () => void;
  onLoadBody: () => void;
  onReply: (message: EmailMessage) => void;
  onReplyAll: (message: EmailMessage) => void;
  onEmailSelection?: (selection: EmailCollaborationSelection) => void;
}) {
  const allAttachments = React.useMemo(
    () => (message.attachments ?? []).filter((attachment) => emailAttachmentFileName(attachment) || emailAttachmentHasResolvableContent(attachment)),
    [message.attachments],
  );
  const messageDate = formatMessageDate(message.date);
  const bodyLoaded = emailMessageBodyIsLoaded(message);
  const body = bodyLoaded ? (message.body ?? "") : "";
  const attachments = visibleEmailAttachmentsForBody(body, allAttachments);
  const hasAttachments = attachments.length > 0;
  const hasCalendarInvite = allAttachments.some(emailAttachmentIsCalendarInvite);
  const collaborationID = message.collaboration_id?.trim() || undefined;
  const bodyDocument = useEmailBodyDocument(message.id, body, allAttachments, companyID, sharedInboxID, accountEmail, collaborationID, expanded && bodyLoaded);
  const sent = messageIsSent(message);
  const frameMinHeight = fill ? 0 : 120;
  const frameStyle: React.CSSProperties | undefined = fill ? undefined : {
    border: "1px solid rgba(148, 163, 184, 0.16)",
    borderRadius: 10,
    boxShadow: "none",
  };
  const itemStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: fill ? "100%" : undefined,
    display: "grid",
    gridTemplateColumns: fill ? "minmax(0, 1fr)" : "20px minmax(0, 1fr)",
    gap: fill ? 0 : 8,
    alignItems: fill ? "start" : "stretch",
  };
  return (
    <article data-email-timeline-item="true" data-email-message-id={message.id} data-email-message-sources={emailThreadMessageSourceLabel(message)} data-message-direction={sent ? "sent" : "received"} style={itemStyle}>
      {!fill && (
        <span aria-hidden="true" style={{ position: "relative", minHeight: 48 }}>
          <span
            style={{
              position: "absolute",
              top: timelineStart ? 19 : -14,
              bottom: timelineEnd ? "calc(100% - 19px)" : -14,
              left: 9,
              width: 2,
              borderRadius: 2,
              background: "linear-gradient(180deg, rgba(14,165,233,0.34), rgba(124,58,237,0.3))",
            }}
          />
          <span style={mailConversationTimelineDotStyle(expanded, sent)} />
        </span>
      )}
      <div style={mailConversationCardStyle(expanded, sent, fill)}>
        <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 10, minWidth: 0, flexWrap: "wrap" }}>
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} message from ${formatAddressList(message.from) || "Unknown sender"}`}
            onClick={onToggleExpanded}
            style={{ border: "none", background: "transparent", padding: 0, minWidth: 180, display: "grid", gridTemplateColumns: "16px minmax(0, 1fr)", gap: 7, alignItems: "start", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit", flex: "1 1 280px" }}
          >
            <span aria-hidden="true" style={{ color: sent ? "#7c3aed" : "#0284c7", lineHeight: 1.35, fontSize: 15, fontWeight: 850 }}>{expanded ? "▾" : "›"}</span>
            <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
              <span style={{ ...mutedSmallStyle, fontSize: 12, fontWeight: 850, color: "#1e293b" }}>
                {formatAddressList(message.from) || "Unknown sender"}
                {messageDate && <span style={{ fontWeight: 650, color: "rgba(71, 85, 105, 0.78)" }}> · {messageDate}</span>}
              </span>
              {!expanded && message.snippet && <span style={{ ...mutedSmallStyle, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "min(68vw, 760px)" }}>{message.snippet}</span>}
              {expanded && (
                <span style={{ display: "grid", gap: 2 }}>
                  <span style={mutedSmallStyle}><strong>From:</strong> {formatAddressList(message.from) || "Unknown sender"}</span>
                  <span style={mutedSmallStyle}><strong>To:</strong> {formatAddressList(message.to) || "me"}</span>
                  {formatAddressList(message.cc) && <span style={mutedSmallStyle}><strong>Cc:</strong> {formatAddressList(message.cc)}</span>}
                  {formatAddressList(message.bcc) && <span style={mutedSmallStyle}><strong>Bcc:</strong> {formatAddressList(message.bcc)}</span>}
                </span>
              )}
              {expanded && sent && (
                <span style={{ ...messageTimestampStatusRowStyle, justifyContent: "flex-start" }}>
                  <MessageReadStatusText message={message} />
                </span>
              )}
            </span>
          </button>
        </div>
        {expanded && (!bodyLoaded ? (
          <div style={emailBodyLoadingStyle}>
            <span>{loadingBody ? "Loading message" : "Message body unavailable"}</span>
            {!loadingBody && <button type="button" style={mailPanelSmallButtonStyle} onClick={onLoadBody}>Retry</button>}
          </div>
        ) : (
          <AutoHeightEmailBodyFrame
            srcDoc={bodyDocument.srcDoc}
            minHeight={frameMinHeight}
            fillAvailableHeight={fill}
            style={frameStyle}
            onTextSelection={onEmailSelection ? (selection) => onEmailSelection({ ...selection, messageID: message.id }) : undefined}
            highlights={chatHighlights}
            activeSelection={activeSelection}
            selectionNavigation={selectionNavigation}
          />
        ))}
        {expanded && hasAttachments && (
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
                  accountEmail={accountEmail}
                  collaborationID={collaborationID}
                />
              ))}
            </div>
          </div>
        )}
        {expanded && hasCalendarInvite && (
          <CalendarInviteCard
            messageID={message.id}
            companyID={companyID}
            sharedInboxID={sharedInboxID}
            accountEmail={accountEmail}
            disabled={busy || !calendarResponseAvailable}
          />
        )}
        {expanded && latest && showReplyActions && (
          <div data-email-primary-reply-actions="true" style={{ display: "flex", gap: 7, flexWrap: "wrap", paddingTop: 2 }}>
            <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onReply(message)}>Reply</button>
            <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onReplyAll(message)}>Reply all</button>
          </div>
        )}
      </div>
    </article>
  );
}
export function MessageDetail({ message, threadMessages = [], nodes, companyID, sharedInboxID, accountEmail, loading, archiveAvailable, archiveLabel, busy, deleteAvailable, chatAvailable, chatOpen, previewOnly = false, previewHeaderResources, emailNodeDestinationSearch, emailChatHighlights = [], activeEmailSelection, selectionNavigation, onLoadMessageBody, onReply, onReplyAll, onCreateSharedDraft, onForward, onArchive, onDelete, onToggleRead, onToggleStar, onEmailSelection, onToggleEmailChat, onOpenCollaborationNode, onOpenLogicGate, onContentTopChange }: {
  message: EmailMessage;
  threadMessages?: EmailMessage[];
  nodes: NodeRecord[];
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  loading: boolean;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: boolean;
  deleteAvailable: boolean;
  chatAvailable: boolean;
  chatOpen: boolean;
  previewOnly?: boolean;
  previewHeaderResources?: React.ReactNode;
  emailNodeDestinationSearch: React.ReactNode;
  emailChatHighlights?: readonly EmailCollaborationSelection[];
  activeEmailSelection?: EmailCollaborationSelection | null;
  selectionNavigation?: EmailCollaborationNavigation | null;
  onLoadMessageBody: (messageID: string) => Promise<EmailMessage | null>;
  onReply: (message: EmailMessage) => void;
  onReplyAll: (message: EmailMessage) => void;
  onCreateSharedDraft: (message: EmailMessage) => void;
  onForward: (message: EmailMessage) => void;
  onArchive: () => void;
  onDelete: () => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onEmailSelection?: (selection: EmailCollaborationSelection) => void;
  onToggleEmailChat: () => void;
  onOpenCollaborationNode?: (message: EmailMessage) => void;
  onOpenLogicGate?: (logicGateID: string) => void;
  onContentTopChange?: (offset: number) => void;
}) {
  const canonicalConversationMessages = conversationMessagesForDetail(message, threadMessages);
  const nodeByID = new Map(nodes.map((node) => [node.node_id, node]));
  const associatedNodeMessage = canonicalConversationMessages.find((candidate) => candidate.collaboration_node_id?.trim()) ?? null;
  const conversationLogicGateIDs = emailConversationLogicGateIDs(canonicalConversationMessages, nodeByID);
  const singleMessage = canonicalConversationMessages.length <= 1;
  const newestMessageID = canonicalConversationMessages[canonicalConversationMessages.length - 1]?.id ?? message.id;
  const [conversationOrder, setConversationOrder] = React.useState<EmailConversationOrder>("oldest");
  const conversationIdentity = message.thread_id?.trim() || message.id;
  const conversationMessages = React.useMemo(
    () => orderEmailConversationMessages(canonicalConversationMessages, conversationOrder),
    [canonicalConversationMessages, conversationOrder],
  );
  const conversationMessageIdentity = canonicalConversationMessages.map((conversationMessage) => conversationMessage.id).join("\x1f");
  const [expandedMessageIDs, setExpandedMessageIDs] = React.useState<Set<string>>(() => new Set([newestMessageID]));
  const [loadingMessageBodyIDs, setLoadingMessageBodyIDs] = React.useState<Set<string>>(() => new Set());
  const messageBodyInflightRef = React.useRef<Map<string, Promise<EmailMessage | null>>>(new Map());
  const detailRootRef = React.useRef<HTMLDivElement | null>(null);
  const conversationScrollRef = React.useRef<HTMLDivElement | null>(null);
  const conversationScrollIdentityRef = React.useRef("");
  React.useEffect(() => {
    setConversationOrder("oldest");
  }, [conversationIdentity]);
  const loadConversationMessageBody = React.useCallback((conversationMessage: EmailMessage): Promise<EmailMessage | null> => {
    if (emailMessageBodyIsLoaded(conversationMessage)) return Promise.resolve(conversationMessage);
    const messageID = conversationMessage.id.trim();
    if (!messageID) return Promise.resolve(null);
    const existing = messageBodyInflightRef.current.get(messageID);
    if (existing) return existing;
    setLoadingMessageBodyIDs((current) => new Set(current).add(messageID));
    const request = onLoadMessageBody(messageID).finally(() => {
      if (messageBodyInflightRef.current.get(messageID) === request) messageBodyInflightRef.current.delete(messageID);
      setLoadingMessageBodyIDs((current) => {
        if (!current.has(messageID)) return current;
        const next = new Set(current);
        next.delete(messageID);
        return next;
      });
    });
    messageBodyInflightRef.current.set(messageID, request);
    return request;
  }, [onLoadMessageBody]);
  const navigationTargetMessage = selectionNavigation
    ? conversationMessages.find((candidate) => candidate.id === selectionNavigation.messageID || candidate.email_message_id === selectionNavigation.messageID) ?? null
    : null;
  React.useLayoutEffect(() => {
    if (!selectionNavigation || !navigationTargetMessage) return;
    setExpandedMessageIDs((current) => {
      if (current.has(navigationTargetMessage.id)) return current;
      const next = new Set(current);
      next.add(navigationTargetMessage.id);
      return next;
    });
    if (!emailMessageBodyIsLoaded(navigationTargetMessage)) void loadConversationMessageBody(navigationTargetMessage);
  }, [loadConversationMessageBody, navigationTargetMessage?.id, selectionNavigation?.requestID]);
  React.useLayoutEffect(() => {
    if (previewOnly) return;
    setExpandedMessageIDs(newestMessageID ? new Set([newestMessageID]) : new Set());
    const newestMessage = canonicalConversationMessages[canonicalConversationMessages.length - 1];
    if (!loading && newestMessage && !emailMessageBodyIsLoaded(newestMessage)) void loadConversationMessageBody(newestMessage);
  }, [loadConversationMessageBody, loading, newestMessageID, previewOnly]);
  React.useLayoutEffect(() => {
    if (!previewOnly) return;
    setExpandedMessageIDs(new Set(canonicalConversationMessages.map((conversationMessage) => conversationMessage.id)));
    if (loading) return;
    void Promise.all(canonicalConversationMessages
      .filter((conversationMessage) => !emailMessageBodyIsLoaded(conversationMessage))
      .map(loadConversationMessageBody));
  }, [conversationMessageIdentity, loadConversationMessageBody, loading, previewOnly]);
  React.useLayoutEffect(() => {
    if (singleMessage || conversationOrder !== "oldest") return undefined;
    const scrollIdentity = `${conversationIdentity}:${conversationMessages.length}`;
    if (conversationScrollIdentityRef.current === scrollIdentity) return undefined;
    conversationScrollIdentityRef.current = scrollIdentity;
    let timeoutID = 0;
    const frameID = window.requestAnimationFrame(() => {
      const scrollConversationToNewest = () => {
        const scrollContainer = conversationScrollRef.current;
        if (scrollContainer) scrollContainer.scrollTop = scrollContainer.scrollHeight;
      };
      scrollConversationToNewest();
      timeoutID = window.setTimeout(scrollConversationToNewest, 160);
    });
    return () => {
      window.cancelAnimationFrame(frameID);
      if (timeoutID) window.clearTimeout(timeoutID);
    };
  }, [conversationIdentity, conversationMessages.length, conversationOrder, singleMessage]);
  const toggleConversationMessage = (conversationMessage: EmailMessage) => {
    const messageID = conversationMessage.id;
    const expanding = !expandedMessageIDs.has(messageID);
    setExpandedMessageIDs((current) => {
      const next = new Set(current);
      if (next.has(messageID)) next.delete(messageID);
      else next.add(messageID);
      return next;
    });
    if (expanding) void loadConversationMessageBody(conversationMessage);
  };
  const allConversationMessagesExpanded = conversationMessages.every((conversationMessage) => expandedMessageIDs.has(conversationMessage.id));
  const expandAllConversationMessages = () => {
    setExpandedMessageIDs(new Set(conversationMessages.map((conversationMessage) => conversationMessage.id)));
    for (const conversationMessage of conversationMessages) void loadConversationMessageBody(conversationMessage);
  };
  const runMessageAction = (conversationMessage: EmailMessage, action: (loadedMessage: EmailMessage) => void) => {
    if (emailMessageBodyIsLoaded(conversationMessage)) {
      action(conversationMessage);
      return;
    }
    void loadConversationMessageBody(conversationMessage).then((loadedMessage) => {
      if (loadedMessage) action(loadedMessage);
    });
  };
  const bodyContainerStyle: React.CSSProperties = {
    minWidth: 0,
    minHeight: 0,
    overflowX: "hidden",
    overflowY: "auto",
    display: "grid",
    gridTemplateRows: singleMessage ? "minmax(0, 1fr)" : undefined,
    gap: singleMessage ? 0 : 10,
    alignContent: singleMessage ? "stretch" : "start",
    padding: singleMessage ? 4 : "8px 10px 18px 2px",
  };
  React.useLayoutEffect(() => {
    if (!onContentTopChange) return;
    const root = detailRootRef.current;
    const content = conversationScrollRef.current;
    if (!root || !content) return;
    const measure = () => {
      const paddingTop = Number.parseFloat(window.getComputedStyle(content).paddingTop) || 0;
      onContentTopChange(Math.max(0, content.getBoundingClientRect().top - root.getBoundingClientRect().top + paddingTop));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(root);
    observer?.observe(content);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [onContentTopChange]);
  return (
    <div ref={detailRootRef} style={{ ...detailStyle, position: "relative", gridTemplateRows: previewOnly ? "auto minmax(0, 1fr)" : detailStyle.gridTemplateRows }}>
      <div style={{ ...panelHeaderStyle, paddingRight: previewOnly ? 66 : undefined }}>
        <div style={{ minWidth: 0, display: "grid", gap: 6 }}>
          <h2 style={detailSubjectStyle}>{message.subject || "(no subject)"}</h2>
          {previewOnly && previewHeaderResources}
        </div>
        {loading && <span style={mutedSmallStyle}>Loading</span>}
      </div>
      {!previewOnly && <div style={{ ...toolbarStyle, display: "flex", alignItems: "center", flexWrap: "nowrap", minWidth: 0 }}>
        <div className="mango-editor-header-scroll" style={{ minWidth: 0, display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 6, overflowX: "auto", overflowY: "hidden" }}>
          {!singleMessage && (
            <>
              <label style={{ ...mutedSmallStyle, display: "inline-flex", alignItems: "center", gap: 6 }}>
                Order
                <select
                  aria-label="Email conversation order"
                  style={{ ...mailPanelInputStyle, minHeight: 30, height: 30, width: 132, padding: "0 8px" }}
                  value={conversationOrder}
                  onChange={(event) => setConversationOrder(event.currentTarget.value as EmailConversationOrder)}
                >
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
              </label>
              <button type="button" style={mailPanelSmallButtonStyle} disabled={allConversationMessagesExpanded} onClick={expandAllConversationMessages}>Expand all threads</button>
            </>
          )}
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onReply(message)}>Reply</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onReplyAll(message)}>Reply all</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onCreateSharedDraft(message)}>Create shared draft</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={() => onForward(message)}>Forward</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={onToggleRead}>{message.unread ? "Mark read" : "Mark unread"}</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy} onClick={onToggleStar}>{message.starred ? "Unstar" : "Star"}</button>
          <button type="button" style={mailPanelSmallButtonStyle} disabled={busy || !archiveAvailable} onClick={onArchive}>{archiveLabel}</button>
          <button type="button" style={{ ...mailPanelSmallButtonStyle, ...dangerButtonStyle }} disabled={busy || !deleteAvailable} onClick={onDelete}>Delete</button>
          {chatAvailable && (
            <div data-email-node-actions="true" aria-label="Email node actions" style={{ flex: "0 0 auto", display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 6, paddingLeft: 8, borderLeft: "1px solid rgba(51,221,213,0.28)", whiteSpace: "nowrap" }}>
              {associatedNodeMessage && onOpenCollaborationNode && (
                <EmailEntityIconButton
                  kind="node"
                  placement="thread-header"
                  label="Open node for this email thread"
                  onClick={() => onOpenCollaborationNode(associatedNodeMessage)}
                />
              )}
              {onOpenLogicGate && conversationLogicGateIDs.map((logicGateID) => (
                <EmailEntityIconButton
                  key={logicGateID}
                  kind="logic_gate"
                  placement="thread-header"
                  label="Open Logic Gate for this email thread"
                  onClick={() => onOpenLogicGate(logicGateID)}
                />
              ))}
              {emailNodeDestinationSearch}
            </div>
          )}
        </div>
        {chatAvailable && (
          <button
            type="button"
            data-email-thread-chat-toggle="true"
            aria-label={chatOpen ? "Close email thread chat" : "Open email thread chat"}
            title={chatOpen ? "Close email thread chat" : "Open email thread chat"}
            aria-pressed={chatOpen}
            onClick={onToggleEmailChat}
            style={{ ...mailPanelSmallButtonStyle, flex: "0 0 auto", minWidth: 34, minHeight: 32, display: "grid", placeItems: "center", padding: "0 8px", marginLeft: 7 }}
          >
            <ChatIcon color={chatOpen ? "#475569" : "rgba(71,85,105,0.88)"} />
          </button>
        )}
      </div>}
      <div ref={conversationScrollRef} data-email-conversation-scroll="true" data-email-conversation-count={conversationMessages.length} style={bodyContainerStyle}>
        {conversationMessages.map((conversationMessage, index) => (
          <EmailConversationMessage
            key={emailThreadMessageRenderKey(conversationMessage)}
            message={conversationMessage}
            companyID={companyID}
            sharedInboxID={sharedInboxID}
            accountEmail={accountEmail}
            fill={singleMessage}
            timelineStart={index === 0}
            timelineEnd={index === conversationMessages.length - 1}
            expanded={singleMessage || expandedMessageIDs.has(conversationMessage.id)}
            latest={conversationMessage.id === newestMessageID}
            showReplyActions={!previewOnly}
            busy={busy}
            calendarResponseAvailable={!sharedInboxID || archiveAvailable}
            loadingBody={loadingMessageBodyIDs.has(conversationMessage.id) || (loading && conversationMessage.id === message.id && !emailMessageBodyIsLoaded(conversationMessage))}
            chatHighlights={emailChatHighlights
              .filter((highlight) => highlight.messageID === conversationMessage.id || highlight.messageID === conversationMessage.email_message_id)
              .map((highlight, highlightIndex) => ({ ...highlight, id: `${highlight.messageID}:${highlightIndex}:${highlight.startOffset}:${highlight.endOffset}` }))}
            activeSelection={activeEmailSelection?.messageID === conversationMessage.id || activeEmailSelection?.messageID === conversationMessage.email_message_id ? activeEmailSelection : null}
            selectionNavigation={selectionNavigation?.messageID === conversationMessage.id || selectionNavigation?.messageID === conversationMessage.email_message_id ? selectionNavigation : null}
            onToggleExpanded={() => toggleConversationMessage(conversationMessage)}
            onLoadBody={() => { void loadConversationMessageBody(conversationMessage); }}
            onReply={(replyMessage) => runMessageAction(replyMessage, onReply)}
            onReplyAll={(replyMessage) => runMessageAction(replyMessage, onReplyAll)}
            onEmailSelection={onEmailSelection}
          />
        ))}
      </div>
    </div>
  );
}

export function EmailReferencePreviewModal({ message, threadMessages, resources, nodes, companyID, sharedInboxID, accountEmail, loading, error, onLoadMessageBody, onOpenNode, onOpenLogicGate, onClose }: {
  message: EmailMessage | null;
  threadMessages: EmailMessage[];
  resources: Array<{ kind: "node" | "logic_gate"; id: string; label: string }>;
  nodes: NodeRecord[];
  companyID: string;
  sharedInboxID?: string;
  accountEmail?: string;
  loading: boolean;
  error: string;
  onLoadMessageBody: (messageID: string) => Promise<EmailMessage | null>;
  onOpenNode: (nodeID: string) => void;
  onOpenLogicGate: (logicGateID: string) => void;
  onClose: () => void;
}) {
  const [fullscreen, setFullscreen] = React.useState(false);
  React.useEffect(() => setNodeEditorFullscreenChromeActive(fullscreen), [fullscreen]);
  const resourceButtons = resources.length > 0 ? (
    <div data-email-reference-preview-resources="true" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      {resources.map((resource) => (
        <button
          key={`${resource.kind}:${resource.id}`}
          type="button"
          data-email-reference-resource={resource.kind}
          title={`Open ${resource.kind === "node" ? "node" : "Logic Gate"}: ${resource.label}`}
          onClick={() => resource.kind === "node" ? onOpenNode(resource.id) : onOpenLogicGate(resource.id)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 28, maxWidth: 280, padding: "3px 9px 3px 6px", border: `1px solid ${resource.kind === "node" ? "rgba(51,221,213,0.34)" : "rgba(25,240,122,0.38)"}`, borderRadius: 8, background: resource.kind === "node" ? "rgba(236,254,255,0.9)" : "rgba(236,253,245,0.92)", color: "#334155", fontSize: 11, fontWeight: 850, cursor: "pointer" }}
        >
          <ExplorerRowIcon kind={resource.kind} />
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{resource.label}</span>
        </button>
      ))}
    </div>
  ) : null;
  return (
    <AppModalPortal onRequestClose={onClose}>
      <div
        data-email-reference-preview-backdrop="true"
        onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
        style={{ position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", padding: fullscreen ? 0 : 16, background: "rgba(15,23,42,0.42)" }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={message?.subject ? `Email thread: ${message.subject}` : "Email thread preview"}
          data-email-reference-preview="true"
          onPointerDown={(event) => event.stopPropagation()}
          style={{ position: "relative", width: fullscreen ? `calc(100vw - ${NODE_EDITOR_FULLSCREEN_HORIZONTAL_INSET_PX * 2}px)` : "min(1180px, calc(100vw - 32px))", height: fullscreen ? `calc(100dvh - ${NODE_EDITOR_FULLSCREEN_VERTICAL_INSET_PX * 2}px)` : "min(860px, calc(100dvh - 32px))", minHeight: "min(360px, calc(100dvh - 32px))", display: "grid", gridTemplateRows: error ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 8, padding: "14px 12px 12px", boxSizing: "border-box", border: "1px solid rgba(148,163,184,0.26)", borderRadius: fullscreen ? 14 : 16, background: "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)", boxShadow: "0 24px 70px rgba(15,23,42,0.28)", overflow: "hidden" }}
        >
          <button
            type="button"
            title={fullscreen ? "Restore email preview" : "Fullscreen email preview"}
            aria-label={fullscreen ? "Restore email preview" : "Fullscreen email preview"}
            aria-pressed={fullscreen}
            data-email-reference-preview-fullscreen="true"
            onClick={() => setFullscreen((current) => !current)}
            style={{ position: "absolute", top: 8, right: 39, zIndex: 3, width: 24, height: 24, display: "grid", placeItems: "center", padding: 0, border: "1px solid rgba(148,163,184,0.34)", borderRadius: 8, background: "linear-gradient(180deg, #ffffff 0%, #eef2f7 100%)", color: "#475569", boxShadow: "0 6px 16px rgba(15,23,42,0.14)", cursor: "pointer" }}
          >
            <UnifiedNodeShellFullscreenIcon active={fullscreen} />
          </button>
          <button
            type="button"
            title="Close email preview"
            aria-label="Close email preview"
            data-email-reference-preview-close="true"
            onClick={onClose}
            style={{ ...UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE, position: "absolute", top: 8, right: 9, zIndex: 3 }}
          >
            X
          </button>
          {error && (
            <div role="status" style={{ marginRight: 30, border: "1px solid rgba(185,28,28,0.24)", borderRadius: 9, background: "rgba(254,242,242,0.92)", color: "#991b1b", padding: "7px 9px", fontSize: 11, fontWeight: 800 }}>
              {error}
            </div>
          )}
          {message ? (
            <MessageDetail
              message={message}
              threadMessages={threadMessages}
              nodes={nodes}
              companyID={companyID}
              sharedInboxID={sharedInboxID}
              accountEmail={accountEmail}
              loading={loading}
              archiveAvailable={false}
              archiveLabel="Archive"
              busy={false}
              deleteAvailable={false}
              chatAvailable={false}
              chatOpen={false}
              previewOnly
              previewHeaderResources={resourceButtons}
              emailNodeDestinationSearch={null}
              onLoadMessageBody={onLoadMessageBody}
              onReply={() => undefined}
              onReplyAll={() => undefined}
              onCreateSharedDraft={() => undefined}
              onForward={() => undefined}
              onArchive={() => undefined}
              onDelete={() => undefined}
              onToggleRead={() => undefined}
              onToggleStar={() => undefined}
              onToggleEmailChat={() => undefined}
            />
          ) : (
            <div style={{ minHeight: 0, display: "grid", placeItems: "center", color: error ? "#991b1b" : "rgba(71,85,105,0.78)", fontSize: 12, fontWeight: 850 }}>
              {loading ? "Loading email thread" : "Email thread unavailable"}
            </div>
          )}
        </section>
      </div>
    </AppModalPortal>
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

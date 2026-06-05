import React from "react";
import type { EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import { ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { NodeRecord } from "../../modules/node-map/shared";
import type { ComposeState, HomeViewID, MessageSelectionModifiers, MyLogicGateGroup } from "./homeTypes";
import { canDragTriageMessageFromMailbox, cleanIDList, formatAddressList, formatMessageDate, logicGateTitle, mailboxLabel, nodeTitle } from "./homeUtils";
import { HomeColumnResizeHandle, ComposePanel, DeleteMessagesConfirmationModal, MessageDetail, MessagePlacementIcon } from "./HomeParts";
import {
  accountEmailStyle,
  accountRowStyle,
  checkboxStyle,
  contextMenuActionStyle,
  emptyStateStyle,
  inlineErrorStyle,
  inlineNoticeStyle,
  listHeaderStyle,
  loadingMoreStyle,
  mailAutoArchiveGuideStyle,
  mailAutoArchiveGuideLabelStyle,
  mailAutoArchiveGuideLineStyle,
  mailAutoArchiveTailSpacerStyle,
  mailArchiveActionButtonStyle,
  mailArchiveActionCountStyle,
  mailArchiveActionLabelStyle,
  mailArchiveActionsStyle,
  mailComposeSentActionsStyle,
  mailFiltersRowStyle,
  mailListTitleStackStyle,
  mailListToolbarStyle,
  mailListPrimaryTitleStyle,
  mailMessageListFrameStyle,
  mailPanelInputStyle,
  mailPanelPrimaryButtonStyle,
  mailPanelSearchButtonStyle,
  mailPanelSmallButtonStyle,
  mailPanelControlsStyle,
  mailPanelStyle,
  mailViewerPanelStyle,
  messageContextMenuStyle,
  messageListStyle,
  messageRowStyle,
  messageNodeButtonStyle,
  messageRowTopStyle,
  messageStarButtonStyle,
  panelTitleStyle,
  searchRowStyle,
  selectedCountStyle,
  snippetStyle,
  triageDateStyle,
  triageMailListHeaderStyle,
  triageMessageContentStyle,
  triageMessageActionRowStyle,
  triageMessageMetaStyle,
  triageMessageRowStyle,
  triageSenderStyle,
  triageSubjectStyle,
  mailUnreadFilterRowStyle,
  unreadCountInlineStyle,
} from "./homeStyles";

type TriageMailboxCountKey = Extract<EmailMailbox, "primary" | "starred" | "archive">;
type TriageMailboxCounts = Partial<Record<TriageMailboxCountKey, number>>;
type ArchiveProgressByMessageID = Record<string, number>;

const ARCHIVE_GUIDE_FALLBACK_TOP = 176;
const ARCHIVE_TAIL_SPACER_MIN_HEIGHT = 260;

function formatMailboxCount(count: number | undefined): string {
  if (typeof count !== "number" || !Number.isFinite(count)) return "";
  return Math.max(0, Math.floor(count)).toLocaleString();
}

function MailboxActionContent({ label, count }: { label: string; count?: number }) {
  const formattedCount = formatMailboxCount(count);
  return (
    <>
      <span style={mailArchiveActionLabelStyle}>{label}</span>
      {formattedCount && <span style={mailArchiveActionCountStyle}>{formattedCount}</span>}
    </>
  );
}

function collectScrolledOutMessageIDs(container: HTMLDivElement): string[] {
  if (container.scrollTop <= 0) return [];
  const thresholdTop = container.getBoundingClientRect().top;
  const ids: string[] = [];
  container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]").forEach((row) => {
    if (row.getBoundingClientRect().bottom > thresholdTop + 1) return;
    const messageID = row.dataset.homeMailMessageId?.trim();
    if (messageID) ids.push(messageID);
  });
  return ids;
}

function clampArchiveGuideTop(container: HTMLDivElement, top: number): number {
  const maxTop = Math.max(56, container.clientHeight - 24);
  return Math.max(56, Math.min(maxTop, top));
}

function measureArchiveGuideTop(container: HTMLDivElement): number {
  const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]"));
  if (rows.length >= 2) {
    const firstBottom = rows[0].offsetTop + rows[0].offsetHeight;
    return clampArchiveGuideTop(container, firstBottom + (rows[1].offsetTop - firstBottom) / 2);
  }
  if (rows.length === 1) return clampArchiveGuideTop(container, rows[0].offsetTop + rows[0].offsetHeight + 10);
  return clampArchiveGuideTop(container, ARCHIVE_GUIDE_FALLBACK_TOP);
}

function archiveProgressMapsEqual(left: ArchiveProgressByMessageID, right: ArchiveProgressByMessageID): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} style={{ display: "block" }}>
      <path
        d="M12 3.2l2.67 5.42 5.98.87-4.33 4.22 1.02 5.96L12 16.86l-5.35 2.81 1.02-5.96-4.33-4.22 5.98-.87L12 3.2z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendPointerIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <path d="M2.1 2.35 14 8 2.1 13.65l1.45-4.25L8.2 8 3.55 6.6z" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <path d="M8.2 8H3.65" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

type MailNodeMenuState = {
  messageID: string;
  x: number;
  y: number;
};

type MailNodeTarget =
  | { kind: "logic_gate"; logicGateID: string; label: string }
  | { kind: "node"; logicGateID: string; nodeID: string; label: string };

type MailLogicGateNodeGroup = {
  key: string;
  label: string;
  logicGates: Array<{
    logicGate: LogicGateRecord;
    nodes: NodeRecord[];
  }>;
};

export type HomeMailNoticeAction = {
  label: string;
  onClick: () => void;
};

type MailLogicGateNodeItem = {
  logicGate: LogicGateRecord;
  nodes: NodeRecord[];
};

const MAIL_NODE_MENU_WIDTH = 284;
const MAIL_NODE_PRIORITY_MENU_WIDTH = 190;
const MAIL_NODE_PRIORITY_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "1  Urgent (<1 hour)" },
  { value: 2, label: "2  By end of day" },
  { value: 3, label: "3  Tomorrow" },
  { value: 4, label: "4  Sprint (1 week)" },
  { value: 5, label: "5  Later" },
];

const mailNodeMenuStyle: React.CSSProperties = {
  position: "fixed",
  width: MAIL_NODE_MENU_WIDTH,
  maxHeight: "min(520px, calc(100vh - 28px))",
  overflow: "auto",
  zIndex: 50,
  padding: 8,
  borderRadius: 8,
  border: "1px solid rgba(148, 163, 184, 0.42)",
  background: "rgba(248, 250, 252, 0.98)",
  boxShadow: "10px 14px 34px rgba(15, 23, 42, 0.18), -4px -4px 18px rgba(255, 255, 255, 0.92)",
};

const mailNodePriorityMenuStyle: React.CSSProperties = {
  ...mailNodeMenuStyle,
  width: MAIL_NODE_PRIORITY_MENU_WIDTH,
  maxHeight: "none",
};

const mailNodeMenuGroupStyle: React.CSSProperties = {
  display: "grid",
  gap: 2,
};

const mailNodeFolderButtonStyle = (open: boolean, depth = 0): React.CSSProperties => ({
  width: "100%",
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: "12px 18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "1px solid transparent",
  borderRadius: 6,
  background: open ? "rgba(255, 151, 8, 0.08)" : "transparent",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 850,
  padding: `6px 8px 6px ${8 + depth * 16}px`,
  textAlign: "left",
  cursor: "pointer",
  letterSpacing: 0,
});

const mailNodeDisclosureStyle = (open: boolean): React.CSSProperties => ({
  width: 12,
  height: 12,
  display: "grid",
  placeItems: "center",
  color: "#475569",
  transform: open ? "rotate(90deg)" : "rotate(0deg)",
  transition: "transform 120ms ease",
  fontSize: 11,
  fontWeight: 900,
  lineHeight: 1,
});

const mailNodeMenuGateButtonStyle = (selected: boolean, depth = 0, hasChildren = false, open = false): React.CSSProperties => ({
  width: "100%",
  minHeight: 32,
  display: "grid",
  gridTemplateColumns: hasChildren ? "12px 18px minmax(0, 1fr)" : "18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  border: `1px solid ${selected ? "rgba(8, 145, 178, 0.46)" : "transparent"}`,
  borderRadius: 6,
  background: selected ? "rgba(8, 145, 178, 0.08)" : "transparent",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 800,
  padding: `6px 8px 6px ${8 + depth * 16}px`,
  textAlign: "left",
  cursor: "pointer",
  letterSpacing: 0,
  boxShadow: open && !selected ? "inset 0 0 0 1px rgba(148, 163, 184, 0.18)" : undefined,
});

const mailNodeMenuNodeButtonStyle = (selected: boolean, depth = 0): React.CSSProperties => ({
  ...mailNodeMenuGateButtonStyle(selected, depth),
  minHeight: 28,
  fontSize: 11,
  fontWeight: 700,
  color: "#334155",
});

const mailNodeMenuLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const mailNodeEmptyStyle: React.CSSProperties = {
  padding: "10px 8px",
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 11,
  fontWeight: 700,
};

function isSameMailNodeTarget(left: MailNodeTarget | null, right: MailNodeTarget): boolean {
  if (!left || left.logicGateID !== right.logicGateID || left.kind !== right.kind) return false;
  if (left.kind === "logic_gate" && right.kind === "logic_gate") return true;
  if (left.kind === "node" && right.kind === "node") return left.nodeID === right.nodeID;
  return false;
}

function mailNodeMenuPosition(x: number, y: number, width: number): { left: number; top: number } {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
  return {
    left: Math.max(8, Math.min(x, viewportWidth - width - 8)),
    top: Math.max(8, Math.min(y, viewportHeight - 120)),
  };
}

function mailNodePriorityMenuPosition(mainLeft: number, mainTop: number): { left: number; top: number } {
  const viewportWidth = typeof window === "undefined" ? 1280 : window.innerWidth;
  const rightSide = mainLeft + MAIL_NODE_MENU_WIDTH + 8;
  const left = rightSide + MAIL_NODE_PRIORITY_MENU_WIDTH <= viewportWidth - 8
    ? rightSide
    : mainLeft - MAIL_NODE_PRIORITY_MENU_WIDTH - 8;
  return mailNodeMenuPosition(left, mainTop, MAIL_NODE_PRIORITY_MENU_WIDTH);
}

function buildMailLogicGateNodeGroups(myGroups: MyLogicGateGroup[], nodes: NodeRecord[]): MailLogicGateNodeGroup[] {
  const nodesByLogicGateID = new Map<string, NodeRecord[]>();
  for (const node of nodes) {
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const bucket = nodesByLogicGateID.get(logicGateID) ?? [];
      bucket.push(node);
      nodesByLogicGateID.set(logicGateID, bucket);
    }
  }
  return myGroups
    .map((group) => ({
      key: group.key,
      label: group.label,
      logicGates: group.logicGates.map((logicGate): MailLogicGateNodeItem => ({
        logicGate,
        nodes: [...(nodesByLogicGateID.get(logicGate.logic_gate_id) ?? [])]
          .sort((a, b) => nodeTitle(a).localeCompare(nodeTitle(b), undefined, { numeric: true, sensitivity: "base" }) || a.node_id.localeCompare(b.node_id)),
      })),
    }))
    .filter((group) => group.logicGates.length > 0);
}

function MailNodeAttachmentMenu({
  menu,
  groups,
  selectedTarget,
  onClose,
  onSelectTarget,
  onPickPriority,
}: {
  menu: MailNodeMenuState;
  groups: MailLogicGateNodeGroup[];
  selectedTarget: MailNodeTarget | null;
  onClose: () => void;
  onSelectTarget: (target: MailNodeTarget) => void;
  onPickPriority: (target: MailNodeTarget, priority: number) => void;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const priorityRef = React.useRef<HTMLDivElement | null>(null);
  const [rootOpen, setRootOpen] = React.useState(true);
  const [openGroupKeys, setOpenGroupKeys] = React.useState<Set<string>>(new Set());
  const [openLogicGateIDs, setOpenLogicGateIDs] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    setRootOpen(true);
    setOpenGroupKeys(new Set(groups.map((group) => group.key)));
    setOpenLogicGateIDs(new Set(groups.flatMap((group) => group.logicGates.map((item) => item.logicGate.logic_gate_id))));
  }, [groups, menu.messageID]);
  React.useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as globalThis.Node | null;
      if (target && (menuRef.current?.contains(target) || priorityRef.current?.contains(target))) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const mainPosition = mailNodeMenuPosition(menu.x, menu.y, MAIL_NODE_MENU_WIDTH);
  const priorityPosition = mailNodePriorityMenuPosition(mainPosition.left, mainPosition.top);
  const toggleGroup = (groupKey: string) => {
    setOpenGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };
  const toggleLogicGate = (logicGateID: string) => {
    setOpenLogicGateIDs((current) => {
      const next = new Set(current);
      if (next.has(logicGateID)) next.delete(logicGateID);
      else next.add(logicGateID);
      return next;
    });
  };
  return (
    <>
      <div ref={menuRef} style={{ ...mailNodeMenuStyle, left: mainPosition.left, top: mainPosition.top }}>
        {groups.length === 0 ? (
          <div style={mailNodeEmptyStyle}>No My Logic Gates</div>
        ) : (
          <div style={mailNodeMenuGroupStyle}>
            <button type="button" style={mailNodeFolderButtonStyle(rootOpen)} onClick={() => setRootOpen((open) => !open)}>
              <span aria-hidden="true" style={mailNodeDisclosureStyle(rootOpen)}>&gt;</span>
              <ExplorerRowIcon kind="folder" />
              <span style={mailNodeMenuLabelStyle}>My Logic Gates</span>
            </button>
            {rootOpen && groups.map((group) => {
              const groupOpen = openGroupKeys.has(group.key);
              return (
                <div key={group.key} style={mailNodeMenuGroupStyle}>
                  <button type="button" style={mailNodeFolderButtonStyle(groupOpen, 1)} onClick={() => toggleGroup(group.key)}>
                    <span aria-hidden="true" style={mailNodeDisclosureStyle(groupOpen)}>&gt;</span>
                    <ExplorerRowIcon kind="folder" />
                    <span style={mailNodeMenuLabelStyle}>{group.label}</span>
                  </button>
                  {groupOpen && group.logicGates.map(({ logicGate, nodes: gateNodes }) => {
                    const gateOpen = openLogicGateIDs.has(logicGate.logic_gate_id);
                    const gateTarget: MailNodeTarget = { kind: "logic_gate", logicGateID: logicGate.logic_gate_id, label: logicGateTitle(logicGate) };
                    return (
                      <div key={logicGate.logic_gate_id} style={mailNodeMenuGroupStyle}>
                        <button
                          type="button"
                          style={mailNodeMenuGateButtonStyle(isSameMailNodeTarget(selectedTarget, gateTarget), 2, true, gateOpen)}
                          onClick={() => onSelectTarget(gateTarget)}
                        >
                          <span
                            aria-hidden="true"
                            style={mailNodeDisclosureStyle(gateOpen)}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleLogicGate(logicGate.logic_gate_id);
                            }}
                          >
                            &gt;
                          </span>
                          <ExplorerRowIcon kind="logic_gate" />
                          <span style={mailNodeMenuLabelStyle}>{gateTarget.label}</span>
                        </button>
                        {gateOpen && gateNodes.map((node) => {
                          const nodeTarget: MailNodeTarget = { kind: "node", logicGateID: logicGate.logic_gate_id, nodeID: node.node_id, label: nodeTitle(node) };
                          return (
                            <button
                              key={`${logicGate.logic_gate_id}:${node.node_id}`}
                              type="button"
                              style={mailNodeMenuNodeButtonStyle(isSameMailNodeTarget(selectedTarget, nodeTarget), 3)}
                              onClick={() => onSelectTarget(nodeTarget)}
                            >
                              <ExplorerRowIcon kind="node" />
                              <span style={mailNodeMenuLabelStyle}>{nodeTarget.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {selectedTarget && (
        <div ref={priorityRef} style={{ ...mailNodePriorityMenuStyle, left: priorityPosition.left, top: priorityPosition.top }}>
          {MAIL_NODE_PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              style={mailNodeMenuGateButtonStyle(false)}
              onClick={() => onPickPriority(selectedTarget, option.value)}
            >
              <span style={{ width: 18, textAlign: "center" }}>{option.value}</span>
              <span style={mailNodeMenuLabelStyle}>{option.label.replace(`${option.value}  `, "")}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

export function HomeMailWorkspace({
  activeViewID,
  accountEmail,
  archiveAvailable,
  archiveLabel,
  busy,
  compose,
  error,
  isArchivableListView,
  isArchiveMailbox,
  listViewLabel,
  loadingDetail,
  loadingMessages,
  loadingMoreMessages,
  mailFilterStatus,
  mailbox,
  mailboxCounts,
  messageListRef,
  messages,
  myLogicGateGroups,
  nodes,
  notice,
  noticeAction,
  pendingAutoArchiveMessageIDs,
  pendingStarredMessageIDs,
  searchDraft,
  selectedMessage,
  selectedMessageID,
  selectedMessageIDs,
  sharedInboxSettings,
  unassignedSharedInbox,
  showDetailResizeHandle,
  unreadOnly,
  unreadMessageCount,
  onArchiveSelected,
  onAttachMessageToNode,
  onAutoArchiveMessages,
  onCancelCompose,
  onColumnResizeStart,
  onComposeChange,
  onDeleteSelected,
  onDisconnect,
  onLoadMoreMessages,
  onPrefetchMessages,
  onOpenAllMailbox,
  onOpenArchivedMailbox,
  onOpenContextMenu,
  onOpenNewCompose,
  onOpenPendingMailbox,
  onOpenReply,
  onOpenSentMailbox,
  onOpenStarredMailbox,
  onCreateMessageNode,
  onSearchDraftChange,
  onSelectMessage,
  onStartMessageDrag,
  onSubmitCompose,
  onSubmitSearch,
  onToggleMessageStar,
  onToggleRead,
  onToggleStar,
  onToggleUnreadOnly,
}: {
  activeViewID: HomeViewID;
  accountEmail?: string;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: string;
  compose: ComposeState;
  error: string;
  isArchivableListView: boolean;
  isArchiveMailbox: boolean;
  listViewLabel: string;
  loadingDetail: boolean;
  loadingMessages: boolean;
  loadingMoreMessages: boolean;
  mailFilterStatus: string;
  mailbox: EmailMailbox;
  mailboxCounts: TriageMailboxCounts;
  messageListRef: React.RefObject<HTMLDivElement>;
  messages: EmailMessage[];
  myLogicGateGroups: MyLogicGateGroup[];
  nodes: NodeRecord[];
  notice: string;
  noticeAction?: HomeMailNoticeAction | null;
  pendingAutoArchiveMessageIDs: Set<string>;
  pendingStarredMessageIDs: Set<string>;
  searchDraft: string;
  selectedMessage: EmailMessage | null;
  selectedMessageID: string;
  selectedMessageIDs: Set<string>;
  sharedInboxSettings?: { onOpen: () => void; onOpenRaci?: () => void };
  unassignedSharedInbox?: { folderName: string; message?: string; onAssignEmail?: () => void };
  showDetailResizeHandle: boolean;
  unreadOnly: boolean;
  unreadMessageCount: number;
  onArchiveSelected: () => void;
  onAttachMessageToNode: (logicGateID: string, nodeID: string, messageIDs: string[], priority: number) => void;
  onAutoArchiveMessages: (messageIDs: string[]) => void;
  onCancelCompose: () => void;
  onColumnResizeStart: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
  onComposeChange: React.Dispatch<React.SetStateAction<ComposeState>>;
  onDeleteSelected: () => void;
  onDisconnect: () => void;
  onLoadMoreMessages: () => void;
  onPrefetchMessages: () => void;
  onOpenAllMailbox: () => void;
  onOpenArchivedMailbox: () => void;
  onOpenContextMenu: (message: EmailMessage, event: React.MouseEvent) => void;
  onOpenNewCompose: () => void;
  onOpenPendingMailbox: () => void;
  onOpenReply: () => void;
  onOpenSentMailbox: () => void;
  onOpenStarredMailbox: () => void;
  onCreateMessageNode: (logicGateID: string, messageIDs: string[], priority: number) => void;
  onSearchDraftChange: (value: string) => void;
  onSelectMessage: (message: EmailMessage, modifiers: MessageSelectionModifiers) => void;
  onStartMessageDrag: (message: EmailMessage, event: React.DragEvent<HTMLElement>) => void;
  onSubmitCompose: (event: React.FormEvent) => void;
  onSubmitSearch: (event: React.FormEvent) => void;
  onToggleMessageStar: (message: EmailMessage) => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleUnreadOnly: (checked: boolean) => void;
}) {
  const [hoveredMessageID, setHoveredMessageID] = React.useState("");
  const [hoveredStarMessageID, setHoveredStarMessageID] = React.useState("");
  const [hoveredNodeMessageID, setHoveredNodeMessageID] = React.useState("");
  const [nodeMenu, setNodeMenu] = React.useState<MailNodeMenuState | null>(null);
  const [nodeMenuTarget, setNodeMenuTarget] = React.useState<MailNodeTarget | null>(null);
  const [archiveGuideTop, setArchiveGuideTop] = React.useState(ARCHIVE_GUIDE_FALLBACK_TOP);
  const [archiveTailSpacerHeight, setArchiveTailSpacerHeight] = React.useState(ARCHIVE_TAIL_SPACER_MIN_HEIGHT);
  const [archiveProgressByMessageID, setArchiveProgressByMessageID] = React.useState<ArchiveProgressByMessageID>({});
  const archiveVisualFrameRef = React.useRef<number | null>(null);
  const autoArchiveEnabled = isArchivableListView && mailbox === "primary";
  const mailNodeGroups = React.useMemo(() => buildMailLogicGateNodeGroups(myLogicGateGroups, nodes), [myLogicGateGroups, nodes]);

  const closeNodeMenu = React.useCallback(() => {
    setNodeMenu(null);
    setNodeMenuTarget(null);
  }, []);

  const openNodeMenu = React.useCallback((messageID: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setNodeMenu({ messageID, x: rect.right + 8, y: rect.top });
    setNodeMenuTarget(null);
  }, []);

  const pickNodeMenuPriority = React.useCallback((target: MailNodeTarget, priority: number) => {
    const messageID = nodeMenu?.messageID.trim() ?? "";
    if (!messageID) return;
    closeNodeMenu();
    if (target.kind === "logic_gate") onCreateMessageNode(target.logicGateID, [messageID], priority);
    else onAttachMessageToNode(target.logicGateID, target.nodeID, [messageID], priority);
  }, [closeNodeMenu, nodeMenu, onAttachMessageToNode, onCreateMessageNode]);

  const updateArchiveVisuals = React.useCallback(() => {
    const list = messageListRef.current;
    if (!autoArchiveEnabled || !list) {
      setArchiveProgressByMessageID((current) => Object.keys(current).length === 0 ? current : {});
      return;
    }
    const nextGuideTop = measureArchiveGuideTop(list);
    setArchiveGuideTop((current) => Math.abs(current - nextGuideTop) < 0.5 ? current : nextGuideTop);
    const nextSpacerHeight = Math.max(ARCHIVE_TAIL_SPACER_MIN_HEIGHT, list.clientHeight + 24);
    setArchiveTailSpacerHeight((current) => Math.abs(current - nextSpacerHeight) < 1 ? current : nextSpacerHeight);
    const containerTop = list.getBoundingClientRect().top;
    const nextProgress: ArchiveProgressByMessageID = {};
    list.querySelectorAll<HTMLElement>("[data-home-mail-message-id]").forEach((row) => {
      const messageID = row.dataset.homeMailMessageId?.trim();
      if (!messageID) return;
      const rect = row.getBoundingClientRect();
      const rowCenter = rect.top + rect.height / 2 - containerTop;
      const progress = Math.max(0, Math.min(1, (nextGuideTop - rowCenter) / Math.max(1, nextGuideTop)));
      if (progress > 0.01) nextProgress[messageID] = Math.round(progress * 1000) / 1000;
    });
    setArchiveProgressByMessageID((current) => archiveProgressMapsEqual(current, nextProgress) ? current : nextProgress);
  }, [autoArchiveEnabled, messageListRef]);

  const scheduleArchiveVisuals = React.useCallback(() => {
    if (archiveVisualFrameRef.current !== null) return;
    archiveVisualFrameRef.current = window.requestAnimationFrame(() => {
      archiveVisualFrameRef.current = null;
      updateArchiveVisuals();
    });
  }, [updateArchiveVisuals]);

  React.useLayoutEffect(() => {
    updateArchiveVisuals();
  }, [messages.length, autoArchiveEnabled, updateArchiveVisuals]);

  React.useEffect(() => {
    return () => {
      if (archiveVisualFrameRef.current !== null) {
        window.cancelAnimationFrame(archiveVisualFrameRef.current);
        archiveVisualFrameRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    const list = messageListRef.current;
    if (!autoArchiveEnabled || !list || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(scheduleArchiveVisuals);
    observer.observe(list);
    return () => observer.disconnect();
  }, [autoArchiveEnabled, messageListRef, scheduleArchiveVisuals]);

  if (unassignedSharedInbox) {
    return (
      <>
        <section style={mailPanelStyle(showDetailResizeHandle)}>
          <div style={mailPanelControlsStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <h2 style={{ ...panelTitleStyle, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {unassignedSharedInbox.folderName}
              </h2>
              {sharedInboxSettings && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <button style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpen}>Permissions</button>
                  {sharedInboxSettings.onOpenRaci && <button style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpenRaci}>RACI</button>}
                </div>
              )}
            </div>
          </div>
          <div className="mango-home-scroll" ref={messageListRef} style={{ ...messageListStyle, alignContent: "center" }}>
            <div style={{ ...emptyStateStyle, minHeight: 220, gap: 12, color: "#111827", textAlign: "center" }}>
              <strong style={{ fontSize: 20, lineHeight: 1.2 }}>{unassignedSharedInbox.folderName}</strong>
              <span>{unassignedSharedInbox.message ?? "This folder has not been assigned an email"}</span>
              {unassignedSharedInbox.onAssignEmail && <button type="button" style={mailPanelPrimaryButtonStyle} onClick={unassignedSharedInbox.onAssignEmail}>Assign email to inbox</button>}
            </div>
          </div>
        </section>

        {showDetailResizeHandle && <HomeColumnResizeHandle dividerIndex={1} onPointerDown={onColumnResizeStart} />}

        <section style={mailViewerPanelStyle(showDetailResizeHandle)}>
          <div style={emptyStateStyle}>Select a message or compose a new one</div>
        </section>
      </>
    );
  }

  return (
    <>
      <section style={mailPanelStyle(showDetailResizeHandle)}>
        <div style={mailPanelControlsStyle}>
          {isArchivableListView ? (
            <div style={triageMailListHeaderStyle}>
              <div style={mailListTitleStackStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <h2 style={mailListPrimaryTitleStyle}>{listViewLabel}</h2>
                  {sharedInboxSettings && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button className="mango-elevated-action" style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpen}>Permissions</button>
                      {sharedInboxSettings.onOpenRaci && <button className="mango-elevated-action" style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpenRaci}>RACI</button>}
                    </div>
                  )}
                </div>
              </div>
              <div style={accountRowStyle}>
                <span style={accountEmailStyle}>{accountEmail}</span>
                <button className="mango-elevated-action" style={mailPanelSmallButtonStyle} disabled={busy === "disconnect"} onClick={onDisconnect}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div style={mailListToolbarStyle}>
              <div style={mailListTitleStackStyle}>
                <h2 style={panelTitleStyle}>{listViewLabel}</h2>
              </div>
              <button style={mailPanelPrimaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>
            </div>
          )}
          {error && <div style={inlineErrorStyle}>{error}</div>}
          {notice && !error && (
            <div style={{ ...inlineNoticeStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <span style={{ minWidth: 0 }}>{notice}</span>
              {noticeAction && (
                <button
                  type="button"
                  className="mango-elevated-action"
                  onClick={noticeAction.onClick}
                  style={{ ...mailPanelSmallButtonStyle, minHeight: 24, padding: "3px 10px", whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {noticeAction.label}
                </button>
              )}
            </div>
          )}
          {isArchivableListView && (
            <div style={mailArchiveActionsStyle}>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "primary")}
                title={mailboxCounts.primary === undefined ? "Inbox" : `Inbox (${formatMailboxCount(mailboxCounts.primary)})`}
                onClick={() => {
                  if (mailbox !== "primary") onOpenPendingMailbox();
                }}
              >
                <MailboxActionContent label="Inbox" count={mailboxCounts.primary} />
              </button>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "starred")}
                title={mailboxCounts.starred === undefined ? "Starred" : `Starred (${formatMailboxCount(mailboxCounts.starred)})`}
                onClick={() => {
                  if (mailbox !== "starred") onOpenStarredMailbox();
                }}
              >
                <MailboxActionContent label="Starred" count={mailboxCounts.starred} />
              </button>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "archive")}
                title={mailboxCounts.archive === undefined ? "Archive" : `Archive (${formatMailboxCount(mailboxCounts.archive)})`}
                onClick={() => {
                  if (mailbox !== "archive") onOpenArchivedMailbox();
                }}
              >
                <MailboxActionContent label="Archive" count={mailboxCounts.archive} />
              </button>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "all")}
                onClick={() => {
                  if (mailbox !== "all") onOpenAllMailbox();
                }}
              >
                All
              </button>
            </div>
          )}
          {isArchivableListView && (
            <div style={mailComposeSentActionsStyle}>
              <button className="mango-elevated-action" style={mailPanelPrimaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "sent")}
                onClick={() => {
                  if (mailbox !== "sent") onOpenSentMailbox();
                }}
              >
                <SendPointerIcon />
                <span style={mailArchiveActionLabelStyle}>Sent</span>
              </button>
            </div>
          )}
          {!isArchivableListView && (
            <div style={accountRowStyle}>
              <span style={accountEmailStyle}>{accountEmail}</span>
              <button className="mango-elevated-action" style={mailPanelSmallButtonStyle} disabled={busy === "disconnect"} onClick={onDisconnect}>Disconnect</button>
            </div>
          )}
          <form style={searchRowStyle} onSubmit={onSubmitSearch}>
            <input
              style={mailPanelInputStyle}
              value={searchDraft}
              onChange={(event) => onSearchDraftChange(event.target.value)}
              placeholder="Search mail"
            />
            <button className="mango-elevated-action" type="submit" style={mailPanelSearchButtonStyle}>Search</button>
          </form>
          {isArchivableListView ? (
            <div style={mailUnreadFilterRowStyle}>
              <span style={unreadCountInlineStyle}>{mailFilterStatus || `${unreadMessageCount} unread`}</span>
              <label style={checkboxStyle}>
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(event) => onToggleUnreadOnly(event.target.checked)}
                />
                <span>Unread only</span>
              </label>
            </div>
          ) : (
            <div style={mailFiltersRowStyle}>
              <label style={checkboxStyle}>
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(event) => onToggleUnreadOnly(event.target.checked)}
                />
                <span>Unread only</span>
              </label>
              {mailFilterStatus && <span style={selectedCountStyle}>{mailFilterStatus}</span>}
            </div>
          )}
          {!isArchivableListView && (
            <div style={listHeaderStyle}>
              <span>{mailboxLabel(mailbox)}</span>
              {(loadingMessages || loadingMoreMessages) && <span>Loading</span>}
            </div>
          )}
        </div>
        <div style={mailMessageListFrameStyle}>
          {autoArchiveEnabled && messages.length > 0 && (
            <div aria-hidden="true" style={mailAutoArchiveGuideStyle(archiveGuideTop)}>
              <span style={mailAutoArchiveGuideLabelStyle}>archive</span>
              <span style={mailAutoArchiveGuideLineStyle} />
            </div>
          )}
          <div
            className="mango-home-scroll"
            ref={messageListRef}
            style={messageListStyle}
            onScroll={(event) => {
              const target = event.currentTarget;
              if (autoArchiveEnabled) {
                scheduleArchiveVisuals();
                const scrolledOutIDs = collectScrolledOutMessageIDs(target);
                if (scrolledOutIDs.length > 0) onAutoArchiveMessages(scrolledOutIDs);
              }
              const tailReserve = autoArchiveEnabled && messages.length > 0 ? target.clientHeight : 0;
              const remaining = target.scrollHeight - target.scrollTop - target.clientHeight - tailReserve;
              const prefetchDistance = Math.max(800, target.clientHeight * 2);
              if (remaining < prefetchDistance) onPrefetchMessages();
              if (remaining < 160) onLoadMoreMessages();
            }}
          >
            {messages.length === 0 && !loadingMessages ? (
              <div style={emptyStateStyle}>{isArchiveMailbox ? "No archived messages" : "No messages"}</div>
            ) : messages.map((message) => {
              const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
              const hovered = hoveredMessageID === message.id;
              const triageView = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:");
              const draggable = triageView && canDragTriageMessageFromMailbox(mailbox);
              const pendingAutoArchive = mailbox === "primary" && pendingAutoArchiveMessageIDs.has(message.id);
              const pendingStarred = pendingStarredMessageIDs.has(message.id);
              const starHovered = hoveredStarMessageID === message.id;
              const starHighlighted = pendingStarred || message.starred || mailbox === "starred" || starHovered;
              const nodeHovered = hoveredNodeMessageID === message.id;
              const nodeLinked = (message.logic_gate_count ?? message.logic_gate_ids?.length ?? 0) > 0;
              const nodeBusy = busy === "triage-convert" || busy === "triage-attach";
              const nodeButtonTitle = nodeLinked ? "Attach email to node" : "Create or attach node from email";
              return (
                <div
                  key={message.id}
                  data-home-mail-message-id={message.id}
                  role="button"
                  tabIndex={0}
                  style={isArchivableListView
                    ? triageMessageRowStyle(active, message.unread, draggable, pendingAutoArchive, hovered, archiveProgressByMessageID[message.id] ?? 0, pendingStarred)
                    : messageRowStyle(active, message.unread, hovered, pendingStarred)}
                  draggable={draggable}
                  onPointerEnter={() => setHoveredMessageID(message.id)}
                  onPointerLeave={() => setHoveredMessageID((current) => current === message.id ? "" : current)}
                  onMouseDown={(event) => {
                    if (!event.shiftKey) return;
                    event.preventDefault();
                    event.currentTarget.ownerDocument.getSelection()?.removeAllRanges();
                  }}
                  onClick={(event) => onSelectMessage(message, event)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    onSelectMessage(message, event);
                  }}
                  onContextMenu={(event) => onOpenContextMenu(message, event)}
                  onDragStart={(event) => onStartMessageDrag(message, event)}
                >
                  {isArchivableListView ? (
                    <>
                      <MessagePlacementIcon message={message} active={active} />
                      <span style={triageMessageContentStyle}>
                        <strong style={triageSenderStyle}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                        <span style={triageSubjectStyle}>{message.subject || "(no subject)"}</span>
                        <span style={snippetStyle}>{message.snippet || ""}</span>
                      </span>
                      <span style={triageMessageMetaStyle}>
                        <span style={triageDateStyle}>{formatMessageDate(message.date)}</span>
                        <span style={triageMessageActionRowStyle}>
                          <button
                            type="button"
                            aria-label={message.starred ? "Remove star" : "Star message"}
                            title={message.starred ? "Remove star" : "Star message"}
                            draggable={false}
                            style={messageStarButtonStyle(starHighlighted, starHovered, pendingStarred)}
                            disabled={busy === "message" || pendingStarred}
                            onPointerEnter={() => setHoveredStarMessageID(message.id)}
                            onPointerLeave={() => setHoveredStarMessageID((current) => current === message.id ? "" : current)}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleMessageStar(message);
                            }}
                          >
                            <StarIcon filled={starHighlighted} />
                          </button>
                          <button
                            type="button"
                            aria-label={nodeButtonTitle}
                            title={nodeButtonTitle}
                            draggable={false}
                            style={messageNodeButtonStyle(nodeLinked || nodeHovered, nodeHovered, nodeBusy)}
                            disabled={nodeBusy}
                            onPointerEnter={() => setHoveredNodeMessageID(message.id)}
                            onPointerLeave={() => setHoveredNodeMessageID((current) => current === message.id ? "" : current)}
                            onClick={(event) => openNodeMenu(message.id, event)}
                          >
                            <ExplorerRowIcon kind="node" />
                          </button>
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={messageRowTopStyle}>
                        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{formatAddressList(message.from) || "Unknown sender"}</strong>
                        <span>{formatMessageDate(message.date)}</span>
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(no subject)"}</span>
                      <span style={snippetStyle}>{message.snippet || ""}</span>
                    </>
                  )}
                </div>
              );
            })}
            {loadingMoreMessages && <div style={loadingMoreStyle}>Loading</div>}
            {autoArchiveEnabled && messages.length > 0 && (
              <div
                aria-hidden="true"
                data-home-mail-auto-archive-spacer="true"
                style={mailAutoArchiveTailSpacerStyle(archiveTailSpacerHeight)}
              />
            )}
          </div>
        </div>
      </section>

      {showDetailResizeHandle && <HomeColumnResizeHandle dividerIndex={1} onPointerDown={onColumnResizeStart} />}

      <section style={mailViewerPanelStyle(showDetailResizeHandle)}>
        {compose.open ? (
          <ComposePanel
            compose={compose}
            busy={busy === "send"}
            onChange={onComposeChange}
            onCancel={onCancelCompose}
            onSubmit={onSubmitCompose}
          />
        ) : selectedMessage ? (
          <MessageDetail
            message={selectedMessage}
            loading={loadingDetail}
            archiveAvailable={archiveAvailable}
            archiveLabel={archiveLabel}
            busy={!!busy}
            onReply={onOpenReply}
            onArchive={onArchiveSelected}
            onDelete={onDeleteSelected}
            deleteAvailable={archiveAvailable}
            onToggleRead={onToggleRead}
            onToggleStar={onToggleStar}
          />
        ) : (
          <div style={emptyStateStyle}>Select a message or compose a new one</div>
        )}
      </section>
      {nodeMenu && (
        <MailNodeAttachmentMenu
          menu={nodeMenu}
          groups={mailNodeGroups}
          selectedTarget={nodeMenuTarget}
          onClose={closeNodeMenu}
          onSelectTarget={setNodeMenuTarget}
          onPickPriority={pickNodeMenuPriority}
        />
      )}
    </>
  );
}

export function HomeMailOverlays({
  busy,
  isArchiveMailbox,
  mailboxActionBusy,
  mailMutationAvailable,
  messageContextMenu,
  deleteConfirmation,
  onArchiveMessages,
  onCancelDelete,
  onCloseContextMenu,
  onConfirmDelete,
  onRequestDeleteMessages,
  onUnarchiveMessages,
}: {
  busy: string;
  isArchiveMailbox: boolean;
  mailboxActionBusy: boolean;
  mailMutationAvailable: boolean;
  messageContextMenu: { x: number; y: number; messageIDs: string[] } | null;
  deleteConfirmation: { messageIDs: string[] } | null;
  onArchiveMessages: (ids: string[]) => void;
  onCancelDelete: () => void;
  onCloseContextMenu: () => void;
  onConfirmDelete: (ids: string[]) => void;
  onRequestDeleteMessages: (ids: string[]) => void;
  onUnarchiveMessages: (ids: string[]) => void;
}) {
  return (
    <>
      {messageContextMenu && (
        <div
          style={{ ...messageContextMenuStyle, left: messageContextMenu.x, top: messageContextMenu.y }}
          onMouseLeave={onCloseContextMenu}
        >
          <button
            style={contextMenuActionStyle}
            disabled={mailboxActionBusy || !mailMutationAvailable}
            onClick={() => {
              if (!mailMutationAvailable) return;
              if (isArchiveMailbox) onUnarchiveMessages(messageContextMenu.messageIDs);
              else onArchiveMessages(messageContextMenu.messageIDs);
            }}
          >
            {isArchiveMailbox ? "Unarchive" : "Archive"}
          </button>
          <button
            style={{ ...contextMenuActionStyle, color: "#334155" }}
            disabled={busy === "delete" || !mailMutationAvailable}
            onClick={() => onRequestDeleteMessages(messageContextMenu.messageIDs)}
          >
            Delete
          </button>
        </div>
      )}
      {deleteConfirmation && (
        <DeleteMessagesConfirmationModal
          count={deleteConfirmation.messageIDs.length}
          busy={busy === "delete"}
          onConfirm={() => onConfirmDelete(deleteConfirmation.messageIDs)}
          onCancel={onCancelDelete}
        />
      )}
    </>
  );
}

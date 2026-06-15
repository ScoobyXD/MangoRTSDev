import React from "react";
import type { CompanyUser, CompanyUserGroup, CompanyUserGroupMember, EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import { ExplorerDisclosureIcon, ExplorerRowIcon } from "../../modules/company-explorer/CompanyExplorerIcons";
import type { LogicGateRaciRole, LogicGateRecord } from "../../modules/logic-gate-map/shared";
import type { NodeRecord } from "../../modules/node-map/shared";
import type { ComposeState, HomeViewID, MessageSelectionModifiers } from "./homeTypes";
import { canDragTriageMessageFromMailbox, cleanIDList, formatAddressList, formatMessageDate, logicGateHasRaciRole, logicGateTitle, mailboxLabel, messageReadStatusLabel, messageReadStatusTitle, nodeTitle } from "./homeUtils";
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
  messageReadStatusStyle,
  messageRowStyle,
  messageNodeButtonStyle,
  messageRowTopStyle,
  messageStarButtonStyle,
  messageTimestampStatusRowStyle,
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

type TriageMailboxCountKey = Extract<EmailMailbox, "primary" | "starred">;
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

function MessageReadStatusText({ message }: { message: EmailMessage }) {
  const label = messageReadStatusLabel(message.read_status);
  if (!label) return null;
  const title = messageReadStatusTitle(message.read_status) || label;
  return <span style={messageReadStatusStyle} title={title}>{label}</span>;
}

function MessageAttachmentCount({ message }: { message: EmailMessage }) {
  const count = message.attachments?.length ?? 0;
  if (count <= 0) return null;
  return <span style={messageReadStatusStyle}>{count === 1 ? "1 file" : `${count} files`}</span>;
}

function isDraftMessage(message: EmailMessage): boolean {
  return (message.folders ?? []).some((folder) => {
    const value = folder.trim().toLowerCase();
    return value === "draft" || value === "drafts";
  });
}

type MailNodeMenuState = {
  messageID: string;
  x: number;
  y: number;
};

type MailNodeTarget =
  | { kind: "logic_gate"; logicGateID: string; label: string }
  | { kind: "node"; logicGateID: string; nodeID: string; label: string };

type MailNodeExplorerScopeView = "me" | "team" | "company";

type MailNodeExplorerUserSummary = {
  userID: string;
  label: string;
  email?: string;
};

type MailNodeExplorerGroupSummary = {
  groupID: string;
  label: string;
  users: MailNodeExplorerUserSummary[];
};

type MailNodeExplorerTreeRow = {
  id: string;
  label: string;
  depth: number;
  kind: "folder" | "logic_gate" | "node";
  hasChildren?: boolean;
  logicGateID?: string;
  nodeID?: string;
  parentLogicGateID?: string;
  systemFolder?: boolean;
};

export type HomeMailNoticeAction = {
  label: string;
  onClick: () => void;
};

const MAIL_NODE_MENU_WIDTH = 356;
const MAIL_NODE_PRIORITY_MENU_WIDTH = 190;
const MAIL_NODE_RACI_FOLDERS: ReadonlyArray<{ role: LogicGateRaciRole | "other"; label: string }> = [
  { role: "responsible", label: "Responsible" },
  { role: "accountable", label: "Accountable" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
  { role: "other", label: "Others" },
];
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
  overflow: "hidden",
  zIndex: 50,
  padding: 0,
  borderRadius: 8,
  border: "1px solid rgba(225, 229, 238, 0.96)",
  background: "linear-gradient(180deg, rgba(249, 250, 252, 0.98) 0%, rgba(242, 244, 248, 0.97) 100%)",
  boxShadow: "10px 14px 34px rgba(15, 23, 42, 0.18), -4px -4px 18px rgba(255, 255, 255, 0.92)",
};

const mailNodePriorityMenuStyle: React.CSSProperties = {
  ...mailNodeMenuStyle,
  width: MAIL_NODE_PRIORITY_MENU_WIDTH,
  maxHeight: "none",
  overflow: "visible",
  padding: 8,
};

const mailNodeExplorerHeaderStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  padding: "9px 9px 10px",
  borderBottom: "1px solid rgba(226, 232, 240, 0.78)",
  background: "linear-gradient(180deg, rgba(248, 250, 252, 0.94) 0%, rgba(242, 244, 248, 0.76) 100%)",
  backdropFilter: "blur(14px) saturate(1.08)",
  WebkitBackdropFilter: "blur(14px) saturate(1.08)",
};

const mailNodeExplorerTitleStyle: React.CSSProperties = {
  minHeight: 30,
  display: "flex",
  alignItems: "center",
  padding: "0 10px",
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 9,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.94) 0%, rgba(246, 247, 251, 0.9) 100%)",
  color: "#111111",
  boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.2), -5px -5px 12px rgba(255, 255, 255, 0.82), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
  fontSize: 11.5,
  fontWeight: 760,
  letterSpacing: 0,
};

const mailNodeScopeTabsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
  gap: 5,
};

const mailNodeScopeTabStyle = (active: boolean): React.CSSProperties => ({
  minWidth: 0,
  height: 30,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${active ? "rgba(100, 116, 139, 0.76)" : "rgba(226, 232, 240, 0.94)"}`,
  borderRadius: 7,
  background: active
    ? "linear-gradient(145deg, rgba(226, 232, 240, 0.96) 0%, rgba(241, 245, 249, 0.92) 100%)"
    : "linear-gradient(145deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.88) 100%)",
  color: "#111827",
  boxShadow: active ? "inset 1px 1px 2px rgba(148, 163, 184, 0.2)" : "2px 2px 7px rgba(174, 174, 192, 0.16), -2px -2px 7px rgba(255, 255, 255, 0.7)",
  font: "inherit",
  fontSize: 11.5,
  fontWeight: 760,
  letterSpacing: 0,
  cursor: active ? "default" : "pointer",
});

const mailNodeSearchShellStyle: React.CSSProperties = {
  position: "relative",
  display: "block",
  minWidth: 0,
  height: 32,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 9,
  background: "linear-gradient(145deg, rgba(255, 255, 255, 0.96) 0%, rgba(246, 247, 251, 0.92) 100%)",
  boxShadow: "5px 5px 12px rgba(174, 174, 192, 0.18), -5px -5px 12px rgba(255, 255, 255, 0.84), inset 1px 1px 0 rgba(255, 255, 255, 0.82)",
};

const mailNodeSearchInputStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  boxSizing: "border-box",
  border: "none",
  borderRadius: 9,
  background: "transparent",
  color: "#111827",
  fontSize: 11,
  fontWeight: 560,
  padding: "0 30px 0 10px",
  outline: "none",
};

const mailNodeSearchIconStyle: React.CSSProperties = {
  position: "absolute",
  right: 9,
  top: 9,
  color: "#475569",
  pointerEvents: "none",
};

const mailNodeRowsStyle: React.CSSProperties = {
  maxHeight: "min(375px, calc(100vh - 170px))",
  overflowY: "auto",
  overflowX: "hidden",
  scrollbarGutter: "stable",
};

const mailNodeExplorerRowStyle = (row: MailNodeExplorerTreeRow, selected: boolean, disabled: boolean): React.CSSProperties => ({
  width: "100%",
  minHeight: row.kind === "node" ? 28 : 31,
  display: "grid",
  gridTemplateColumns: "15px 18px minmax(0, 1fr)",
  alignItems: "center",
  gap: 6,
  border: "none",
  borderBottom: "1px solid rgba(226, 232, 240, 0.72)",
  background: selected
    ? "linear-gradient(135deg, rgba(255, 255, 255, 0.94), rgba(228, 251, 255, 0.64) 46%, rgba(247, 240, 255, 0.72))"
    : "transparent",
  color: disabled ? "rgba(51, 65, 85, 0.48)" : "#1f2937",
  font: "inherit",
  fontSize: row.kind === "node" ? 11.5 : 12,
  fontWeight: row.kind === "folder" ? 760 : row.kind === "logic_gate" ? 760 : 620,
  padding: `3px 8px 3px ${10 + row.depth * 17}px`,
  textAlign: "left",
  cursor: disabled ? "default" : "pointer",
  letterSpacing: 0,
  opacity: disabled ? 0.72 : 1,
  boxShadow: selected ? "inset 3px 0 0 rgba(8, 145, 178, 0.78), inset 0 0 0 1px rgba(14, 165, 233, 0.22)" : "none",
  transition: "background 140ms ease, box-shadow 140ms ease, color 140ms ease",
});

const mailNodeMenuLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const mailNodeDisclosureSlotStyle: React.CSSProperties = {
  width: 15,
  height: 18,
  display: "grid",
  placeItems: "center",
  color: "#475569",
};

const mailNodeEmptyStyle: React.CSSProperties = {
  padding: "10px 8px",
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 11,
  fontWeight: 700,
};

const mailNodePriorityButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 30,
  display: "grid",
  gridTemplateColumns: "24px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  border: "1px solid transparent",
  borderRadius: 6,
  background: "transparent",
  color: "#0f172a",
  font: "inherit",
  fontSize: 12,
  fontWeight: 760,
  padding: "6px 8px",
  textAlign: "left",
  cursor: "pointer",
  letterSpacing: 0,
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

function cleanMailNodeID(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function compareMailNodeLabels(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function mailNodeCompanyUserLabel(user: Pick<CompanyUser, "user_id" | "display_name" | "email"> | null | undefined, fallbackUserID: string): string {
  return user?.display_name?.trim() || user?.email?.trim() || fallbackUserID.trim() || "Unknown user";
}

function mailNodeCompanyGroupLabel(group: Pick<CompanyUserGroup, "group_id" | "name"> | null | undefined, fallbackGroupID: string): string {
  return group?.name?.trim() || fallbackGroupID.trim() || "Team";
}

function mailNodeUserSummaryForID(userID: string, usersByID: Map<string, CompanyUser>, members: CompanyUserGroupMember[]): MailNodeExplorerUserSummary {
  const cleanUserID = cleanMailNodeID(userID);
  const user = usersByID.get(cleanUserID);
  const member = members.find((item) => cleanMailNodeID(item.user_id) === cleanUserID);
  return {
    userID: cleanUserID,
    label: mailNodeCompanyUserLabel(user ?? null, member?.user_display_name?.trim() || member?.user_email?.trim() || cleanUserID),
    email: user?.email?.trim() || member?.user_email?.trim() || undefined,
  };
}

function sortMailNodeUsers(users: MailNodeExplorerUserSummary[]): MailNodeExplorerUserSummary[] {
  return [...users].sort((left, right) => (
    compareMailNodeLabels(left.label, right.label)
    || compareMailNodeLabels(left.email ?? "", right.email ?? "")
    || left.userID.localeCompare(right.userID)
  ));
}

function sortMailNodeLogicGates(logicGates: LogicGateRecord[]): LogicGateRecord[] {
  return [...logicGates].sort((left, right) => (
    compareMailNodeLabels(logicGateTitle(left), logicGateTitle(right))
    || (left.created_timestamp ?? "").localeCompare(right.created_timestamp ?? "")
    || left.logic_gate_id.localeCompare(right.logic_gate_id)
  ));
}

function sortMailNodeRecords(nodes: NodeRecord[]): NodeRecord[] {
  return [...nodes].sort((left, right) => (
    compareMailNodeLabels(nodeTitle(left), nodeTitle(right))
    || (left.created_timestamp ?? "").localeCompare(right.created_timestamp ?? "")
    || left.node_id.localeCompare(right.node_id)
  ));
}

function mailNodeTeamMemberUserIDs(members: CompanyUserGroupMember[], currentUserID: string): Set<string> {
  const cleanCurrentUserID = cleanMailNodeID(currentUserID);
  const ownGroupIDs = new Set(
    members
      .filter((member) => cleanMailNodeID(member.user_id) === cleanCurrentUserID)
      .map((member) => cleanMailNodeID(member.group_id))
      .filter(Boolean),
  );
  const userIDs = new Set<string>();
  if (cleanCurrentUserID) userIDs.add(cleanCurrentUserID);
  for (const member of members) {
    if (!ownGroupIDs.has(cleanMailNodeID(member.group_id))) continue;
    const userID = cleanMailNodeID(member.user_id);
    if (userID) userIDs.add(userID);
  }
  return userIDs;
}

function mailNodeUsersByGroup(input: {
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
}): MailNodeExplorerGroupSummary[] {
  const usersByID = new Map(input.companyUsers.map((user) => [cleanMailNodeID(user.user_id), user]));
  const membersByGroupID = new Map<string, CompanyUserGroupMember[]>();
  for (const member of input.companyUserGroupMembers) {
    const groupID = cleanMailNodeID(member.group_id);
    if (!groupID) continue;
    const bucket = membersByGroupID.get(groupID) ?? [];
    bucket.push(member);
    membersByGroupID.set(groupID, bucket);
  }
  return [...input.companyUserGroups]
    .sort((left, right) => (
      compareMailNodeLabels(mailNodeCompanyGroupLabel(left, left.group_id), mailNodeCompanyGroupLabel(right, right.group_id))
      || left.group_id.localeCompare(right.group_id)
    ))
    .map((group) => {
      const userIDs = Array.from(new Set((membersByGroupID.get(cleanMailNodeID(group.group_id)) ?? [])
        .map((member) => cleanMailNodeID(member.user_id))
        .filter(Boolean)));
      return {
        groupID: cleanMailNodeID(group.group_id),
        label: mailNodeCompanyGroupLabel(group, group.group_id),
        users: sortMailNodeUsers(userIDs.map((userID) => mailNodeUserSummaryForID(userID, usersByID, input.companyUserGroupMembers))),
      };
    });
}

function mailNodeTargetForRow(row: MailNodeExplorerTreeRow): MailNodeTarget | null {
  if (row.kind === "logic_gate" && row.logicGateID) {
    return { kind: "logic_gate", logicGateID: row.logicGateID, label: row.label };
  }
  if (row.kind === "node" && row.nodeID && row.parentLogicGateID) {
    return { kind: "node", logicGateID: row.parentLogicGateID, nodeID: row.nodeID, label: row.label };
  }
  return null;
}

function mailNodeRowIsOpen(expanded: Set<string>, rowID: string): boolean {
  return expanded.has("*") || expanded.has(rowID);
}

function isMailNodeRaciRole(role: LogicGateRaciRole | "other"): role is LogicGateRaciRole {
  return role === "responsible" || role === "accountable" || role === "consulted" || role === "informed";
}

function buildMailNodeRaciRows(input: {
  prefix: string;
  depth: number;
  expanded: Set<string>;
  userID: string;
  logicGates: LogicGateRecord[];
  nodes: NodeRecord[];
}): MailNodeExplorerTreeRow[] {
  const rows: MailNodeExplorerTreeRow[] = [];
  const cleanUserID = cleanMailNodeID(input.userID);
  const nodesByLogicGateID = new Map<string, NodeRecord[]>();
  const nodesWithoutLogicGate: NodeRecord[] = [];
  for (const node of input.nodes) {
    const logicGateIDs = cleanIDList(node.logic_gate_ids ?? []);
    if (logicGateIDs.length === 0) {
      if (!cleanUserID || cleanMailNodeID(node.assignee_user_id) === cleanUserID) nodesWithoutLogicGate.push(node);
      continue;
    }
    for (const logicGateID of cleanIDList(node.logic_gate_ids ?? [])) {
      const bucket = nodesByLogicGateID.get(logicGateID) ?? [];
      bucket.push(node);
      nodesByLogicGateID.set(logicGateID, bucket);
    }
  }
  for (const folder of MAIL_NODE_RACI_FOLDERS) {
    const roleRowID = `${input.prefix}:raci:${folder.role}`;
    let roleLogicGates: LogicGateRecord[] = [];
    if (isMailNodeRaciRole(folder.role)) {
      const role = folder.role;
      roleLogicGates = sortMailNodeLogicGates(input.logicGates.filter((logicGate) => logicGateHasRaciRole(logicGate, role, cleanUserID)));
    }
    const otherNodes = folder.role === "other" ? sortMailNodeRecords(nodesWithoutLogicGate) : [];
    rows.push({
      id: roleRowID,
      label: folder.label,
      depth: input.depth,
      kind: "folder",
      hasChildren: roleLogicGates.length > 0 || folder.role === "other",
      systemFolder: true,
    });
    if (!mailNodeRowIsOpen(input.expanded, roleRowID)) continue;
    for (const logicGate of roleLogicGates) {
      const logicGateRowID = `${roleRowID}:logic-gate:${logicGate.logic_gate_id}`;
      const gateNodes = sortMailNodeRecords(nodesByLogicGateID.get(logicGate.logic_gate_id) ?? []);
      rows.push({
        id: logicGateRowID,
        label: logicGateTitle(logicGate),
        depth: input.depth + 1,
        kind: "logic_gate",
        logicGateID: logicGate.logic_gate_id,
        hasChildren: gateNodes.length > 0,
      });
      if (!mailNodeRowIsOpen(input.expanded, logicGateRowID)) continue;
      for (const node of gateNodes) {
        rows.push({
          id: `${logicGateRowID}:node:${node.node_id}`,
          label: nodeTitle(node),
          depth: input.depth + 2,
          kind: "node",
          nodeID: node.node_id,
          parentLogicGateID: logicGate.logic_gate_id,
          hasChildren: false,
        });
      }
    }
    if (folder.role === "other") {
      const noLogicGateRowID = `${roleRowID}:no-logic-gate`;
      rows.push({
        id: noLogicGateRowID,
        label: "No Logic Gate",
        depth: input.depth + 1,
        kind: "folder",
        hasChildren: otherNodes.length > 0,
        systemFolder: false,
      });
      if (mailNodeRowIsOpen(input.expanded, noLogicGateRowID)) {
        for (const node of otherNodes) {
          rows.push({
            id: `${noLogicGateRowID}:node:${node.node_id}`,
            label: nodeTitle(node),
            depth: input.depth + 2,
            kind: "node",
            nodeID: node.node_id,
            hasChildren: false,
          });
        }
      }
    }
  }
  return rows;
}

function buildMailNodeTeamRows(input: {
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  expanded: Set<string>;
  logicGates: LogicGateRecord[];
  nodes: NodeRecord[];
}): MailNodeExplorerTreeRow[] {
  const usersByID = new Map(input.companyUsers.map((user) => [cleanMailNodeID(user.user_id), user]));
  const teamUserIDs = Array.from(mailNodeTeamMemberUserIDs(input.companyUserGroupMembers, input.currentUserID));
  const teamUsers = sortMailNodeUsers(teamUserIDs.map((userID) => mailNodeUserSummaryForID(userID, usersByID, input.companyUserGroupMembers)));
  const rows: MailNodeExplorerTreeRow[] = [];
  for (const user of teamUsers) {
    const userRowID = `team:user:${user.userID}`;
    rows.push({
      id: userRowID,
      label: user.label,
      depth: 0,
      kind: "folder",
      hasChildren: true,
      systemFolder: true,
    });
    if (mailNodeRowIsOpen(input.expanded, userRowID)) {
      rows.push(...buildMailNodeRaciRows({
        prefix: userRowID,
        depth: 1,
        expanded: input.expanded,
        userID: user.userID,
        logicGates: input.logicGates,
        nodes: input.nodes,
      }));
    }
  }
  return rows;
}

function buildMailNodeCompanyRows(input: {
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  expanded: Set<string>;
  logicGates: LogicGateRecord[];
  nodes: NodeRecord[];
}): MailNodeExplorerTreeRow[] {
  const groups = mailNodeUsersByGroup(input);
  const rows: MailNodeExplorerTreeRow[] = [];
  for (const group of groups) {
    const groupRowID = `company:group:${group.groupID}`;
    rows.push({
      id: groupRowID,
      label: group.label,
      depth: 0,
      kind: "folder",
      hasChildren: group.users.length > 0,
      systemFolder: true,
    });
    if (!mailNodeRowIsOpen(input.expanded, groupRowID)) continue;
    for (const user of group.users) {
      const userRowID = `${groupRowID}:user:${user.userID}`;
      rows.push({
        id: userRowID,
        label: user.label,
        depth: 1,
        kind: "folder",
        hasChildren: true,
        systemFolder: true,
      });
      if (mailNodeRowIsOpen(input.expanded, userRowID)) {
        rows.push(...buildMailNodeRaciRows({
          prefix: userRowID,
          depth: 2,
          expanded: input.expanded,
          userID: user.userID,
          logicGates: input.logicGates,
          nodes: input.nodes,
        }));
      }
    }
  }
  return rows;
}

function buildMailNodeExplorerRows(input: {
  scopeView: MailNodeExplorerScopeView;
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  expanded: Set<string>;
  logicGates: LogicGateRecord[];
  nodes: NodeRecord[];
}): MailNodeExplorerTreeRow[] {
  if (input.scopeView === "team") return buildMailNodeTeamRows(input);
  if (input.scopeView === "company") return buildMailNodeCompanyRows(input);
  return buildMailNodeRaciRows({
    prefix: "me",
    depth: 0,
    expanded: input.expanded,
    userID: input.currentUserID,
    logicGates: input.logicGates,
    nodes: input.nodes,
  });
}

function buildMailNodeDefaultExpanded(input: {
  scopeView: MailNodeExplorerScopeView;
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  logicGates: LogicGateRecord[];
}): Set<string> {
  const expanded = new Set<string>();
  if (input.scopeView === "me") {
    for (const folder of MAIL_NODE_RACI_FOLDERS) {
      const roleRowID = `me:raci:${folder.role}`;
      expanded.add(roleRowID);
      if (folder.role === "other") {
        expanded.add(`${roleRowID}:no-logic-gate`);
        continue;
      }
      for (const logicGate of input.logicGates) {
        if (logicGateHasRaciRole(logicGate, folder.role, input.currentUserID)) {
          expanded.add(`${roleRowID}:logic-gate:${logicGate.logic_gate_id}`);
        }
      }
    }
    return expanded;
  }
  if (input.scopeView === "team") {
    const usersByID = new Map(input.companyUsers.map((user) => [cleanMailNodeID(user.user_id), user]));
    const teamUserIDs = Array.from(mailNodeTeamMemberUserIDs(input.companyUserGroupMembers, input.currentUserID));
    for (const user of sortMailNodeUsers(teamUserIDs.map((userID) => mailNodeUserSummaryForID(userID, usersByID, input.companyUserGroupMembers)))) {
      expanded.add(`team:user:${user.userID}`);
    }
    return expanded;
  }
  for (const group of mailNodeUsersByGroup(input)) expanded.add(`company:group:${group.groupID}`);
  return expanded;
}

function filterMailNodeExplorerRowsForSearch(rows: MailNodeExplorerTreeRow[], rawQuery: string): MailNodeExplorerTreeRow[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return rows;
  const included = new Set<string>();
  const includeDescendants = (startIndex: number) => {
    const parent = rows[startIndex];
    included.add(parent.id);
    for (let index = startIndex + 1; index < rows.length; index += 1) {
      if (rows[index].depth <= parent.depth) break;
      included.add(rows[index].id);
    }
  };
  const includeAncestors = (startIndex: number) => {
    let depth = rows[startIndex].depth;
    for (let index = startIndex - 1; index >= 0 && depth > 0; index -= 1) {
      const row = rows[index];
      if (row.depth >= depth) continue;
      included.add(row.id);
      depth = row.depth;
    }
  };
  rows.forEach((row, index) => {
    const text = [row.label, row.logicGateID, row.nodeID, row.parentLogicGateID].join(" ").toLowerCase();
    if (!text.includes(query)) return;
    included.add(row.id);
    includeAncestors(index);
    if (row.kind === "folder") includeDescendants(index);
  });
  return rows.filter((row) => included.has(row.id));
}

function MailNodeAttachmentMenu({
  menu,
  currentUserID,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  logicGates,
  nodes,
  selectedTarget,
  onClose,
  onSelectTarget,
  onPickPriority,
}: {
  menu: MailNodeMenuState;
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  logicGates: LogicGateRecord[];
  nodes: NodeRecord[];
  selectedTarget: MailNodeTarget | null;
  onClose: () => void;
  onSelectTarget: (target: MailNodeTarget | null) => void;
  onPickPriority: (target: MailNodeTarget, priority: number) => void;
}) {
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const priorityRef = React.useRef<HTMLDivElement | null>(null);
  const [scopeView, setScopeView] = React.useState<MailNodeExplorerScopeView>("me");
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const [explorerSearchQuery, setExplorerSearchQuery] = React.useState("");
  React.useEffect(() => {
    setScopeView("me");
    setExplorerSearchQuery("");
    setExpanded(buildMailNodeDefaultExpanded({
      scopeView: "me",
      currentUserID,
      companyUsers,
      companyUserGroups,
      companyUserGroupMembers,
      logicGates,
    }));
  }, [companyUserGroupMembers, companyUserGroups, companyUsers, currentUserID, logicGates, menu.messageID]);
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
  const buildInput = React.useMemo(() => ({
    scopeView,
    currentUserID,
    companyUsers,
    companyUserGroups,
    companyUserGroupMembers,
    logicGates,
    nodes,
  }), [companyUserGroupMembers, companyUserGroups, companyUsers, currentUserID, logicGates, nodes, scopeView]);
  const treeRows = React.useMemo(() => buildMailNodeExplorerRows({ ...buildInput, expanded }), [buildInput, expanded]);
  const searchRows = React.useMemo(() => buildMailNodeExplorerRows({ ...buildInput, expanded: new Set(["*"]) }), [buildInput]);
  const visibleRows = React.useMemo(() => (
    explorerSearchQuery.trim()
      ? filterMailNodeExplorerRowsForSearch(searchRows, explorerSearchQuery)
      : treeRows
  ), [explorerSearchQuery, searchRows, treeRows]);
  const toggleRow = (rowID: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(rowID)) next.delete(rowID);
      else next.add(rowID);
      return next;
    });
  };
  const selectScopeView = (nextScopeView: MailNodeExplorerScopeView) => {
    setScopeView(nextScopeView);
    setExplorerSearchQuery("");
    onSelectTarget(null);
    setExpanded(buildMailNodeDefaultExpanded({
      scopeView: nextScopeView,
      currentUserID,
      companyUsers,
      companyUserGroups,
      companyUserGroupMembers,
      logicGates,
    }));
  };
  const selectRow = (row: MailNodeExplorerTreeRow) => {
    if (row.kind === "folder") {
      if (row.hasChildren) toggleRow(row.id);
      return;
    }
    const target = mailNodeTargetForRow(row);
    if (target) onSelectTarget(target);
  };
  return (
    <>
      <div ref={menuRef} style={{ ...mailNodeMenuStyle, left: mainPosition.left, top: mainPosition.top }}>
        <div style={mailNodeExplorerHeaderStyle}>
          <div style={mailNodeExplorerTitleStyle}>Explorer</div>
          <div style={mailNodeScopeTabsStyle}>
            {(["me", "team", "company"] as const).map((scope) => (
              <button
                key={scope}
                type="button"
                aria-pressed={scopeView === scope}
                style={mailNodeScopeTabStyle(scopeView === scope)}
                onClick={() => selectScopeView(scope)}
              >
                {scope === "me" ? "Me" : scope === "team" ? "Team" : "Company"}
              </button>
            ))}
          </div>
          <label style={mailNodeSearchShellStyle}>
            <input
              aria-label="Search Explorer"
              placeholder="Search Explorer"
              value={explorerSearchQuery}
              onChange={(event) => setExplorerSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setExplorerSearchQuery("");
                }
              }}
              style={mailNodeSearchInputStyle}
            />
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={mailNodeSearchIconStyle}>
              <circle cx="7" cy="7" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.2 10.2 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </label>
        </div>
        <div
          style={mailNodeRowsStyle}
        >
          {visibleRows.length === 0 ? (
            <div style={mailNodeEmptyStyle}>{explorerSearchQuery.trim() ? "No matches" : "No Logic Gates"}</div>
          ) : visibleRows.map((row) => {
            const rowTarget = mailNodeTargetForRow(row);
            const selected = rowTarget ? isSameMailNodeTarget(selectedTarget, rowTarget) : false;
            const rowOpen = mailNodeRowIsOpen(expanded, row.id);
            const disabled = row.kind === "node" && !row.parentLogicGateID;
            return (
              <button
                key={row.id}
                type="button"
                aria-expanded={row.hasChildren ? rowOpen : undefined}
                disabled={disabled}
                style={mailNodeExplorerRowStyle(row, selected, disabled)}
                title={disabled ? "This node is not inside a Logic Gate" : row.label}
                onClick={() => selectRow(row)}
              >
                <span
                  aria-hidden="true"
                  style={mailNodeDisclosureSlotStyle}
                  onClick={(event) => {
                    if (!row.hasChildren) return;
                    event.stopPropagation();
                    toggleRow(row.id);
                  }}
                >
                  {row.hasChildren ? <ExplorerDisclosureIcon open={rowOpen} color="#475569" /> : null}
                </span>
                <ExplorerRowIcon kind={row.kind} mangoDefaultFolder={row.kind === "folder" && row.systemFolder} />
                <span style={mailNodeMenuLabelStyle}>{row.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {selectedTarget && (
        <div ref={priorityRef} style={{ ...mailNodePriorityMenuStyle, left: priorityPosition.left, top: priorityPosition.top }}>
          {MAIL_NODE_PRIORITY_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              style={mailNodePriorityButtonStyle}
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
  companyID,
  compose,
  draftCount,
  emailSignature,
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
  currentUserID,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  logicGates,
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
  onOpenContextMenu,
  onOpenNewCompose,
  onOpenDraftsMailbox,
  onOpenPendingMailbox,
  onOpenReply,
  onOpenSentMailbox,
  onOpenStarredMailbox,
  onEmailSignatureChange,
  onSaveEmailSignature,
  onSaveComposeDraft,
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
  companyID: string;
  compose: ComposeState;
  draftCount: number;
  emailSignature: string;
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
  currentUserID: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  logicGates: LogicGateRecord[];
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
  onOpenContextMenu: (message: EmailMessage, event: React.MouseEvent) => void;
  onOpenNewCompose: () => void;
  onOpenDraftsMailbox: () => void;
  onOpenPendingMailbox: () => void;
  onOpenReply: () => void;
  onOpenSentMailbox: () => void;
  onOpenStarredMailbox: () => void;
  onEmailSignatureChange: (value: string) => void;
  onSaveEmailSignature: () => void;
  onSaveComposeDraft: () => void;
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
                style={mailArchiveActionButtonStyle(mailbox === "drafts")}
                title={draftCount === 0 ? "My Drafts" : `My Drafts (${formatMailboxCount(draftCount)})`}
                onClick={() => {
                  if (mailbox !== "drafts") onOpenDraftsMailbox();
                }}
              >
                <MailboxActionContent label="My Drafts" count={draftCount} />
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
                <span style={mailArchiveActionLabelStyle}>Sent</span>
                <SendPointerIcon />
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
              <div style={emptyStateStyle}>{mailbox === "drafts" ? "No saved drafts" : isArchiveMailbox ? "No archived messages" : "No messages"}</div>
            ) : messages.map((message) => {
              const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
              const hovered = hoveredMessageID === message.id;
              const triageView = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:");
              const draftRow = mailbox === "drafts" || isDraftMessage(message);
              const draggable = triageView && !draftRow && canDragTriageMessageFromMailbox(mailbox);
              const pendingAutoArchive = mailbox === "primary" && pendingAutoArchiveMessageIDs.has(message.id);
              const pendingStarred = pendingStarredMessageIDs.has(message.id);
              const starHovered = hoveredStarMessageID === message.id;
              const starHighlighted = pendingStarred || message.starred || mailbox === "starred" || starHovered;
              const nodeHovered = hoveredNodeMessageID === message.id;
              const nodeLinked = (message.logic_gate_count ?? message.logic_gate_ids?.length ?? 0) > 0;
              const nodeBusy = busy === "triage-convert" || busy === "triage-attach";
              const nodeButtonTitle = nodeLinked ? "Attach email to node" : "Create or attach node from email";
              const rowAddressLabel = draftRow ? (formatAddressList(message.to) || "Draft") : (formatAddressList(message.from) || "Unknown sender");
              const showReadStatus = mailbox === "sent" && !draftRow;
              return (
                <div
                  key={message.id}
                  data-home-mail-message-id={message.id}
                  role="button"
                  tabIndex={0}
                  style={isArchivableListView
                    ? triageMessageRowStyle(active, message.unread, draggable, pendingAutoArchive, hovered, archiveProgressByMessageID[message.id] ?? 0, false)
                    : messageRowStyle(active, message.unread, hovered, false)}
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
                  onContextMenu={(event) => {
                    onOpenContextMenu(message, event);
                  }}
                  onDragStart={(event) => onStartMessageDrag(message, event)}
                >
                  {isArchivableListView ? (
                    <>
                      <MessagePlacementIcon message={message} active={active} />
                      <span style={triageMessageContentStyle}>
                        <strong style={triageSenderStyle}>{rowAddressLabel}</strong>
                        <span style={triageSubjectStyle}>{message.subject || "(no subject)"}</span>
                        <span style={snippetStyle}>{message.snippet || ""}</span>
                      </span>
                      <span style={triageMessageMetaStyle}>
                        <span style={messageTimestampStatusRowStyle}>
                          {showReadStatus && <MessageReadStatusText message={message} />}
                          <MessageAttachmentCount message={message} />
                          <span style={triageDateStyle}>{formatMessageDate(message.date)}</span>
                        </span>
                        {!draftRow && (
                          <span style={triageMessageActionRowStyle}>
                            <button
                              type="button"
                              aria-label={message.starred ? "Remove star" : "Star message"}
                              title={message.starred ? "Remove star" : "Star message"}
                              draggable={false}
                              style={messageStarButtonStyle(starHighlighted, starHovered, false)}
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
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={messageRowTopStyle}>
                        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{rowAddressLabel}</strong>
                        <span style={messageTimestampStatusRowStyle}>
                          {showReadStatus && <MessageReadStatusText message={message} />}
                          <MessageAttachmentCount message={message} />
                          <span>{formatMessageDate(message.date)}</span>
                        </span>
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
            replyMessage={selectedMessage?.id === compose.replyToMessageID ? selectedMessage : null}
            emailSignature={emailSignature}
            companyUsers={companyUsers}
            onChange={onComposeChange}
            onCancel={onCancelCompose}
            onSubmit={onSubmitCompose}
            onEmailSignatureChange={onEmailSignatureChange}
            onSaveEmailSignature={onSaveEmailSignature}
            onSaveDraft={onSaveComposeDraft}
          />
        ) : selectedMessage ? (
          <MessageDetail
            message={selectedMessage}
            companyID={companyID}
            sharedInboxID={activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length).trim() : undefined}
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
          currentUserID={currentUserID}
          companyUsers={companyUsers}
          companyUserGroups={companyUserGroups}
          companyUserGroupMembers={companyUserGroupMembers}
          logicGates={logicGates}
          nodes={nodes}
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
  isDraftMailbox,
  mailboxActionBusy,
  mailMutationAvailable,
  messageContextMenu,
  deleteConfirmation,
  onArchiveMessages,
  onCancelDelete,
  onCloseContextMenu,
  onConfirmDelete,
  onRequestDeleteDrafts,
  onRequestDeleteMessages,
  onUnarchiveMessages,
}: {
  busy: string;
  isArchiveMailbox: boolean;
  isDraftMailbox: boolean;
  mailboxActionBusy: boolean;
  mailMutationAvailable: boolean;
  messageContextMenu: { x: number; y: number; messageIDs: string[] } | null;
  deleteConfirmation: { messageIDs: string[] } | null;
  onArchiveMessages: (ids: string[]) => void;
  onCancelDelete: () => void;
  onCloseContextMenu: () => void;
  onConfirmDelete: (ids: string[]) => void;
  onRequestDeleteDrafts: (ids: string[]) => void;
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
          {isDraftMailbox ? (
            <button
              style={{ ...contextMenuActionStyle, color: "#334155" }}
              disabled={busy === "delete"}
              onClick={() => onRequestDeleteDrafts(messageContextMenu.messageIDs)}
            >
              Delete draft
            </button>
          ) : (
            <>
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
            </>
          )}
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

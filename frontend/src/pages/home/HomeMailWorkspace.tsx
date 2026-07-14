import React from "react";
import { confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import type { CommunicationsEmailCollaboration, CompanyUser, CompanyUserGroup, CompanyUserGroupMember, EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import type { ComposeState, HomeViewID, MessageSelectionModifiers } from "./homeTypes";
import { canDragTriageMessageFromMailbox, emailAttachmentIsInlineContent, emailMessageHasMultipleThreadMessages, emailMessageRowAriaLabel, emailThreadMessageCount, formatAddressList, formatMessageDate, isMailRowActivationKey, mailboxLabel, messageReadStatusLabel, messageReadStatusTitle, type EmailConversationOrder } from "./homeUtils";
import { HomeColumnResizeHandle, ComposePanel, DeleteMessagesConfirmationModal, MessageDetail, MessageLeadingIndicators, type EmailCollaborationNavigation } from "./HomeParts";
import { EmailCollaborationChatSurface, type EmailCollaborationSelection } from "./EmailCollaborationChatSurface";
import { emailMessageRowKey } from "./homeUtils";
import { emailCollaborationChatSessionMounted, emailCollaborationChatSessionVisible, reconcileEmailCollaborationChatSession, toggleEmailCollaborationChatSession, type EmailCollaborationChatSession } from "./emailCollaborationChat";
import { OutboundEmailUndoBanner } from "../../modules/communications/OutboundEmailUndoBanner";
import { MessageReadReceiptChip } from "./MessageReadReceiptChip";
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
  mailArchiveActionButtonStyle,
  mailArchiveActionCountStyle,
  mailArchiveActionLabelStyle,
  mailArchiveActionsStyle,
  mailComposeSentActionsStyle,
  mailComposeSentTriageActionsStyle,
  mailListTitleStackStyle,
  mailListToolbarStyle,
  mailListPrimaryTitleStyle,
  mailMessageListFrameStyle,
  mailControlStatusStyle,
  mailOrderButtonStyle,
  mailOrderLabelStyle,
  mailSearchControlsStyle,
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
  messageReadStatusSlotStyle,
  messageRowStyle,
  messageRowTopStyle,
  messageStarButtonStyle,
  messageTimestampStatusRowStyle,
  panelTitleStyle,
  searchRowStyle,
  selectedCountStyle,
  snippetStyle,
  triageDateStyle,
  triageAdvanceButtonStyle,
  triageMailListHeaderStyle,
  triageMessageContentStyle,
  triageMessageActionRowStyle,
  triageMessageMetaStyle,
  triageMessageTimestampStyle,
  triageMessageReadStatusSlotStyle,
  triageMessageRowStyle,
  triageSenderStyle,
  triageSnippetStyle,
  triageMessageStarButtonStyle,
  triageSubjectStyle,
  unreadCountInlineStyle,
} from "./homeStyles";

type TriageMailboxCountKey = Extract<EmailMailbox, "primary" | "starred">;
type TriageMailboxCounts = Partial<Record<TriageMailboxCountKey, number>>;

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

function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function MailOrderIcon({ order }: { order: EmailConversationOrder }) {
  const newestFirst = order === "newest";
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ display: "block", flexShrink: 0 }}>
      <path d="M2.5 3.25h6M2.5 6.25h4.5M2.5 9.25h3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <path
        d={newestFirst ? "M11.5 2.5v10.25m0 0-2-2m2 2 2-2" : "M11.5 13.5V3.25m0 0-2 2m2-2 2 2"}
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuCheckIcon() {
  return (
    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      <path d="M3.3 8.2 6.5 11.2 12.8 4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const mailboxDropdownWrapStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
};

const mailboxDropdownMenuStyle: React.CSSProperties = {
  position: "absolute",
  zIndex: 30,
  top: "100%",
  right: 0,
  minWidth: 132,
  display: "grid",
  gap: 4,
  padding: 6,
  border: "1px solid rgba(148, 163, 184, 0.32)",
  borderRadius: 8,
  background: "#ffffff",
  boxShadow: "0 14px 34px rgba(15, 23, 42, 0.16)",
};

function mailboxDropdownItemStyle(active: boolean): React.CSSProperties {
  return {
    border: active ? "1px solid rgba(14, 165, 233, 0.72)" : "1px solid transparent",
    borderRadius: 6,
    background: active ? "rgba(14, 165, 233, 0.12)" : "transparent",
    color: "#0f172a",
    minHeight: 30,
    padding: "0 8px",
    display: "grid",
    gridTemplateColumns: "16px minmax(0, 1fr)",
    gap: 6,
    alignItems: "center",
    textAlign: "left",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 650,
    cursor: "pointer",
  };
}

function MessageReadStatusText({ message }: { message: EmailMessage }) {
  const label = messageReadStatusLabel(message.read_status);
  if (!label) return null;
  const title = messageReadStatusTitle(message.read_status) || label;
  return <span title={title}><MessageReadReceiptChip message={message} /></span>;
}

function MessageAttachmentCount({ message }: { message: EmailMessage }) {
  const count = (message.attachments ?? []).filter((attachment) => !emailAttachmentIsInlineContent(attachment)).length;
  if (count <= 0) return null;
  return <span style={messageReadStatusStyle}>{count === 1 ? "1 file" : `${count} files`}</span>;
}

function MessageThreadCount({ message }: { message: EmailMessage }) {
  if (!emailMessageHasMultipleThreadMessages(message)) return null;
  const count = emailThreadMessageCount(message);
  return <span style={messageReadStatusStyle} title={`${count} messages in this thread`}>{count} msgs</span>;
}

function isDraftMessage(message: EmailMessage): boolean {
  return (message.folders ?? []).some((folder) => {
    const value = folder.trim().toLowerCase();
    return value === "draft" || value === "drafts";
  });
}

export type HomeMailNoticeAction = {
  label: string;
  onClick: () => void;
};

export function HomeMailWorkspace({
  activeViewID,
  accountEmail,
  archiveAvailable,
  archiveLabel,
  busy,
  companyID,
  currentUserID,
  compose,
  draftCount,
  emailSignature,
  emailSignatureAccountEmail,
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
  messageListOrder,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  notice,
  noticeAction,
  pendingStarredMessageIDs,
  searchDraft,
  selectedMessage,
  selectedMessageRowKey,
  selectedMessageIDs,
  selectedThreadMessages,
  sharedInboxSettings,
  unassignedSharedInbox,
  showDetailResizeHandle,
  unreadOnly,
  unreadMessageCount,
  canAdvanceTriagePage,
  hasNextMessagePage,
  onArchiveSelected,
  onAdvanceTriagePage,
  onCancelCompose,
  onColumnResizeStart,
  onComposeChange,
  onDeleteSelected,
  onDisconnect,
  onLoadMessageBody,
  onLoadMoreMessages,
  onPrefetchMessages,
  onOpenAllMailbox,
  onOpenContextMenu,
  onOpenNewCompose,
  onOpenDraftsMailbox,
  onOpenPendingMailbox,
  onOpenReply,
  onOpenReplyAll,
  onCreateSharedDraft,
  onOpenSentMailbox,
  onOpenSpamMailbox,
  onOpenStarredMailbox,
  onToggleMessageListOrder,
  onOpenForward,
  onEmailSignatureChange,
  onSaveEmailSignature,
  onSaveComposeDraft,
  onEnsureComposeDraft,
  onDiscardEmptyComposeDraft,
  onSearchDraftChange,
  onSelectMessage,
  onStartMessageDrag,
  onSubmitCompose,
  onSubmitSearch,
  onToggleMessageStar,
  onToggleRead,
  onToggleStar,
  onToggleUnreadOnly,
  onEmailCollaborationChange,
}: {
  activeViewID: HomeViewID;
  accountEmail?: string;
  archiveAvailable: boolean;
  archiveLabel: string;
  busy: string;
  companyID: string;
  messageListOrder: EmailConversationOrder;
  currentUserID: string;
  compose: ComposeState;
  draftCount: number;
  emailSignature: string;
  emailSignatureAccountEmail: string;
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
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  notice: string;
  noticeAction?: HomeMailNoticeAction | null;
  pendingStarredMessageIDs: Set<string>;
  searchDraft: string;
  selectedMessage: EmailMessage | null;
  selectedMessageRowKey: string;
  selectedMessageIDs: Set<string>;
  selectedThreadMessages: EmailMessage[];
  sharedInboxSettings?: { onOpen: () => void; onOpenGVIC?: () => void };
  unassignedSharedInbox?: { folderName: string; message?: string; onAssignEmail?: () => void };
  showDetailResizeHandle: boolean;
  unreadOnly: boolean;
  unreadMessageCount: number;
  canAdvanceTriagePage: boolean;
  hasNextMessagePage: boolean;
  onArchiveSelected: () => void;
  onAdvanceTriagePage: () => void;
  onCancelCompose: () => void;
  onColumnResizeStart: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
  onComposeChange: React.Dispatch<React.SetStateAction<ComposeState>>;
  onDeleteSelected: () => void;
  onDisconnect: (position?: ConfirmActionMenuPosition) => void;
  onLoadMessageBody: (messageID: string) => Promise<EmailMessage | null>;
  onLoadMoreMessages: () => void;
  onPrefetchMessages: () => void;
  onOpenAllMailbox: () => void;
  onOpenContextMenu: (message: EmailMessage, event: React.MouseEvent) => void;
  onOpenNewCompose: () => void;
  onOpenDraftsMailbox: () => void;
  onOpenPendingMailbox: () => void;
  onOpenReply: (message?: EmailMessage) => void;
  onOpenReplyAll: (message?: EmailMessage) => void;
  onCreateSharedDraft: (message: EmailMessage) => void;
  onOpenSentMailbox: () => void;
  onOpenSpamMailbox: () => void;
  onOpenStarredMailbox: () => void;
  onOpenForward: (message?: EmailMessage) => void;
  onToggleMessageListOrder: () => void;
  onEmailSignatureChange: (value: string) => void;
  onSaveEmailSignature: (signature: string) => void;
  onSaveComposeDraft: (compose: ComposeState) => void;
  onEnsureComposeDraft: (compose: ComposeState) => Promise<ComposeState>;
  onDiscardEmptyComposeDraft: (compose: ComposeState) => void;
  onSearchDraftChange: (value: string) => void;
  onSelectMessage: (message: EmailMessage, modifiers: MessageSelectionModifiers) => void;
  onStartMessageDrag: (message: EmailMessage, event: React.DragEvent<HTMLElement>) => void;
  onSubmitCompose: (event: React.FormEvent, compose: ComposeState) => void;
  onSubmitSearch: (event: React.FormEvent) => void;
  onToggleMessageStar: (message: EmailMessage) => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleUnreadOnly: (checked: boolean) => void;
  onEmailCollaborationChange: (collaboration: CommunicationsEmailCollaboration) => void;
}) {
  const [hoveredMessageID, setHoveredMessageID] = React.useState("");
  const [hoveredStarMessageID, setHoveredStarMessageID] = React.useState("");
  const [allMailboxMenuOpen, setAllMailboxMenuOpen] = React.useState(false);
  const [emailSelection, setEmailSelection] = React.useState<EmailCollaborationSelection | null>(null);
  const [emailNavigation, setEmailNavigation] = React.useState<EmailCollaborationNavigation | null>(null);
  const [emailChatSession, setEmailChatSession] = React.useState<EmailCollaborationChatSession>(null);
  const [emailCollaborationError, setEmailCollaborationError] = React.useState("");
  const emailChatAvailable = activeViewID === "my-triage" || activeViewID.startsWith("shared:");
  const emailChatKey = emailChatAvailable && selectedMessageRowKey
    ? JSON.stringify([activeViewID, mailbox, selectedMessageRowKey])
    : "";
  const emailChatMounted = emailCollaborationChatSessionMounted(emailChatSession, emailChatKey);
  const emailChatVisible = emailCollaborationChatSessionVisible(emailChatSession, emailChatKey);
  const visibleError = emailCollaborationError || error;
  const clearEmailCollaborationError = React.useCallback(() => setEmailCollaborationError(""), []);
  const emailNavigationSequenceRef = React.useRef(0);
  const clearEmailSelection = React.useCallback(() => setEmailSelection(null), []);
  const navigateToEmailSelection = React.useCallback((selection: EmailCollaborationSelection) => {
    emailNavigationSequenceRef.current += 1;
    setEmailNavigation({ ...selection, requestID: emailNavigationSequenceRef.current });
  }, []);
  const toggleEmailChat = React.useCallback(() => {
    if (!emailChatKey) return;
    setEmailChatSession((current) => toggleEmailCollaborationChatSession(current, emailChatKey));
  }, [emailChatKey]);
  React.useEffect(() => {
    setEmailSelection(null);
    setEmailNavigation(null);
    setEmailChatSession((current) => reconcileEmailCollaborationChatSession(current, emailChatKey));
    setEmailCollaborationError("");
  }, [activeViewID, emailChatKey, selectedMessageRowKey]);
  const triageAdvanceEnabled = isArchivableListView && mailbox === "primary";
  const advanceDisabled = !canAdvanceTriagePage || !!busy || loadingMessages || loadingMoreMessages || messages.length === 0;
  const allDropdownActive = mailbox === "all" || mailbox === "spam";

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
                  {sharedInboxSettings.onOpenGVIC && <button style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpenGVIC}>GVIC</button>}
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
                      {sharedInboxSettings.onOpenGVIC && <button className="mango-elevated-action" style={{ ...mailPanelSmallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpenGVIC}>GVIC</button>}
                    </div>
                  )}
                </div>
              </div>
              <div style={accountRowStyle}>
                <span style={accountEmailStyle}>{accountEmail}</span>
                <button className="mango-elevated-action" style={mailPanelSmallButtonStyle} disabled={busy === "disconnect"} onClick={(event) => onDisconnect(confirmMenuPositionFromElement(event.currentTarget))}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div style={mailListToolbarStyle}>
              <div style={mailListTitleStackStyle}>
                <h2 style={panelTitleStyle}>{listViewLabel}</h2>
              </div>
              <button style={compose.open ? mailArchiveActionButtonStyle(true) : mailPanelPrimaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>
            </div>
          )}
          {visibleError && <div style={inlineErrorStyle}>{visibleError}</div>}
          {!visibleError && <OutboundEmailUndoBanner />}
          {notice && !visibleError && (
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
              <div style={mailboxDropdownWrapStyle} onMouseLeave={() => setAllMailboxMenuOpen(false)}>
                <button
                  className="mango-elevated-action"
                  type="button"
                  style={mailArchiveActionButtonStyle(allDropdownActive)}
                  aria-haspopup="menu"
                  aria-expanded={allMailboxMenuOpen}
                  onClick={() => setAllMailboxMenuOpen((current) => !current)}
                >
                  <span style={mailArchiveActionLabelStyle}>{mailbox === "spam" ? "Spam" : "All"}</span>
                  <ChevronDownIcon />
                </button>
                {allMailboxMenuOpen && (
                  <div role="menu" style={mailboxDropdownMenuStyle}>
                    <button
                      type="button"
                      role="menuitem"
                      style={mailboxDropdownItemStyle(mailbox === "all")}
                      onClick={() => {
                        setAllMailboxMenuOpen(false);
                        if (mailbox !== "all") onOpenAllMailbox();
                      }}
                    >
                      <span>{mailbox === "all" ? <MenuCheckIcon /> : null}</span>
                      <span>All</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      style={mailboxDropdownItemStyle(mailbox === "spam")}
                      onClick={() => {
                        setAllMailboxMenuOpen(false);
                        if (mailbox !== "spam") onOpenSpamMailbox();
                      }}
                    >
                      <span>{mailbox === "spam" ? <MenuCheckIcon /> : null}</span>
                      <span>Spam folder</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {isArchivableListView && (
            <div style={triageAdvanceEnabled ? mailComposeSentTriageActionsStyle : mailComposeSentActionsStyle}>
              <button className="mango-elevated-action" style={compose.open ? mailArchiveActionButtonStyle(true) : mailPanelPrimaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>
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
              {triageAdvanceEnabled && (
                <button
                  className="mango-elevated-action"
                  type="button"
                  style={triageAdvanceButtonStyle}
                  disabled={advanceDisabled}
                  onClick={onAdvanceTriagePage}
                >
                  {busy === "advance-archive" ? "Archiving" : hasNextMessagePage ? "Archive page and go next ->" : "Archive page ->"}
                </button>
              )}
            </div>
          )}
          {!isArchivableListView && (
            <div style={accountRowStyle}>
              <span style={accountEmailStyle}>{accountEmail}</span>
              <button className="mango-elevated-action" style={mailPanelSmallButtonStyle} disabled={busy === "disconnect"} onClick={(event) => onDisconnect(confirmMenuPositionFromElement(event.currentTarget))}>Disconnect</button>
            </div>
          )}
          <form style={searchRowStyle} onSubmit={onSubmitSearch}>
            <div style={mailSearchControlsStyle}>
              <input
                aria-label="Search mail"
                style={mailPanelInputStyle}
                value={searchDraft}
                onChange={(event) => onSearchDraftChange(event.target.value)}
                placeholder="Search mail"
              />
              <button className="mango-elevated-action" type="submit" style={mailPanelSearchButtonStyle}>Search</button>
            </div>
            <div style={mailControlStatusStyle}>
              {(isArchivableListView || mailFilterStatus) && (
                <span style={isArchivableListView ? unreadCountInlineStyle : selectedCountStyle}>
                  {mailFilterStatus || `${unreadMessageCount} unread`}
                </span>
              )}
              <label style={checkboxStyle}>
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(event) => onToggleUnreadOnly(event.target.checked)}
                />
                <span>Unread only</span>
              </label>
              <button
                className="mango-elevated-action"
                type="button"
                style={mailOrderButtonStyle}
                aria-pressed={messageListOrder === "oldest"}
                aria-label={`Email order: ${messageListOrder === "newest" ? "newest first" : "oldest first"}. Activate for ${messageListOrder === "newest" ? "oldest first" : "newest first"}.`}
                title={`Currently ${messageListOrder === "newest" ? "newest first" : "oldest first"}; show ${messageListOrder === "newest" ? "oldest first" : "newest first"}`}
                data-mail-list-order={messageListOrder}
                onClick={onToggleMessageListOrder}
              >
                <MailOrderIcon order={messageListOrder} />
                <span style={mailOrderLabelStyle}>{messageListOrder === "newest" ? "Newest" : "Oldest"}</span>
              </button>
            </div>
          </form>
          {!isArchivableListView && (
            <div style={listHeaderStyle}>
              <span>{mailboxLabel(mailbox)}</span>
              {(loadingMessages || loadingMoreMessages) && <span>Loading</span>}
            </div>
          )}
        </div>
        <div style={mailMessageListFrameStyle}>
          <div
            className="mango-home-scroll"
            ref={messageListRef}
            style={messageListStyle}
            onScroll={(event) => {
              if (triageAdvanceEnabled) return;
              const target = event.currentTarget;
              const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
              const prefetchDistance = Math.max(800, target.clientHeight * 2);
              if (remaining < prefetchDistance) onPrefetchMessages();
              if (remaining < 160) onLoadMoreMessages();
            }}
          >
            {messages.length === 0 && !loadingMessages ? (
              <div style={emptyStateStyle}>{mailbox === "drafts" ? "No saved drafts" : isArchiveMailbox ? "No archived messages" : "No messages"}</div>
            ) : messages.map((message) => {
              const rowKey = emailMessageRowKey(message);
              const active = selectedMessageIDs.has(rowKey) || selectedMessageRowKey === rowKey;
              const hovered = hoveredMessageID === rowKey;
              const triageView = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:");
              const draftRow = mailbox === "drafts" || isDraftMessage(message);
              const draggable = triageView && !draftRow && canDragTriageMessageFromMailbox(mailbox);
              const pendingStarred = pendingStarredMessageIDs.has(message.id);
              const starHovered = hoveredStarMessageID === rowKey;
              const starHighlighted = pendingStarred || message.starred || starHovered;
              const sharedDraftSource = draftRow && message.collaboration_id?.trim()
                ? message.collaboration_account_email?.trim() || "email collaboration"
                : "";
              const rowAddressLabel = draftRow
                ? (sharedDraftSource ? `Shared draft · ${sharedDraftSource}` : (formatAddressList(message.to) || "Draft"))
                : (formatAddressList(message.from) || "Unknown sender");
              const showReadStatus = mailbox === "sent" && !draftRow;
              return (
                <div
                  key={rowKey}
                  data-home-mail-message-id={rowKey}
                  role="button"
                  tabIndex={0}
                  aria-pressed={active}
                  aria-label={emailMessageRowAriaLabel(message, rowAddressLabel)}
                  style={isArchivableListView
                    ? triageMessageRowStyle(active, message.unread, draggable, hovered, false)
                    : messageRowStyle(active, message.unread, hovered, false)}
                  draggable={draggable}
                  onPointerEnter={() => setHoveredMessageID(rowKey)}
                  onPointerLeave={() => setHoveredMessageID((current) => current === rowKey ? "" : current)}
                  onMouseDown={(event) => {
                    if (!event.shiftKey) return;
                    event.preventDefault();
                    event.currentTarget.ownerDocument.getSelection()?.removeAllRanges();
                  }}
                  onClick={(event) => onSelectMessage(message, event)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (!isMailRowActivationKey(event.key)) return;
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
                      <MessageLeadingIndicators message={message} active={active} />
                      <span style={triageMessageContentStyle}>
                        <strong style={triageSenderStyle}>{rowAddressLabel}</strong>
                        <span style={triageSubjectStyle}>{message.subject || "(no subject)"}</span>
                        <span style={{ ...snippetStyle, ...triageSnippetStyle }}>{message.snippet || ""}</span>
                      </span>
                      <span style={triageMessageMetaStyle}>
                        <span style={{ ...messageTimestampStatusRowStyle, ...triageMessageTimestampStyle }}>
                          <MessageAttachmentCount message={message} />
                          <MessageThreadCount message={message} />
                          <span style={triageDateStyle}>{formatMessageDate(message.date)}</span>
                        </span>
                        {!draftRow && (
                          <span style={triageMessageActionRowStyle}>
                            <button
                              type="button"
                              aria-label={message.starred ? "Remove star" : "Star message"}
                              title={message.starred ? "Remove star" : "Star message"}
                              draggable={false}
                              style={{ ...messageStarButtonStyle(starHighlighted, starHovered, false), ...triageMessageStarButtonStyle }}
                              disabled={busy === "message" || pendingStarred}
                              onPointerEnter={() => setHoveredStarMessageID(rowKey)}
                              onPointerLeave={() => setHoveredStarMessageID((current) => current === rowKey ? "" : current)}
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleMessageStar(message);
                              }}
                            >
                              <StarIcon filled={starHighlighted} />
                            </button>
                          </span>
                        )}
                        {showReadStatus && (
                          <span style={triageMessageReadStatusSlotStyle}>
                            <MessageReadStatusText message={message} />
                          </span>
                        )}
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={messageRowTopStyle}>
                        <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{rowAddressLabel}</strong>
                        <span style={messageTimestampStatusRowStyle}>
                          <MessageAttachmentCount message={message} />
                          <MessageThreadCount message={message} />
                          <span>{formatMessageDate(message.date)}</span>
                        </span>
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{message.subject || "(no subject)"}</span>
                      <span style={snippetStyle}>{message.snippet || ""}</span>
                      {showReadStatus && (
                        <span style={messageReadStatusSlotStyle}>
                          <MessageReadStatusText message={message} />
                        </span>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {loadingMoreMessages && <div style={loadingMoreStyle}>Loading</div>}
          </div>
        </div>
      </section>

      {showDetailResizeHandle && <HomeColumnResizeHandle dividerIndex={1} onPointerDown={onColumnResizeStart} />}

      <section style={mailViewerPanelStyle(showDetailResizeHandle)}>
        {compose.open ? (
          <ComposePanel
            compose={compose}
            busy={busy === "send"}
            replyMessage={compose.replyToMessage ?? (selectedMessage?.id === compose.replyToMessageID ? selectedMessage : null)}
            emailSignature={emailSignature}
            emailSignatureAccountEmail={emailSignatureAccountEmail}
            companyID={companyID}
            currentUserID={currentUserID}
            companyUsers={companyUsers}
            onChange={onComposeChange}
            onCancel={onCancelCompose}
            onSubmit={onSubmitCompose}
            onEmailSignatureChange={onEmailSignatureChange}
            onSaveEmailSignature={onSaveEmailSignature}
            onSaveDraft={onSaveComposeDraft}
            onEnsureDraft={onEnsureComposeDraft}
            onDiscardEmptyDraft={onDiscardEmptyComposeDraft}
          />
        ) : selectedMessage ? (
          <div
            style={{
              minWidth: 0,
              minHeight: 0,
              height: "100%",
              display: "grid",
              gridTemplateColumns: showDetailResizeHandle && emailChatVisible
                ? "minmax(0, 1fr) minmax(320px, 38%)"
                : "minmax(0, 1fr)",
              gridTemplateRows: !showDetailResizeHandle && emailChatVisible
                ? "auto auto"
                : "minmax(0, 1fr)",
              overflow: "hidden",
            }}
          >
            <MessageDetail
              message={selectedMessage}
              threadMessages={selectedThreadMessages}
              companyID={companyID}
              sharedInboxID={selectedMessage.collaboration_shared_inbox_id || (activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length).trim() : undefined)}
              accountEmail={selectedMessage.collaboration_account_email || accountEmail}
              loading={loadingDetail}
              archiveAvailable={archiveAvailable}
              archiveLabel={archiveLabel}
              busy={!!busy}
              chatAvailable={emailChatAvailable}
              chatOpen={emailChatVisible}
              onToggleChat={toggleEmailChat}
              onLoadMessageBody={onLoadMessageBody}
              onReply={onOpenReply}
              onReplyAll={onOpenReplyAll}
              onCreateSharedDraft={onCreateSharedDraft}
              onForward={onOpenForward}
              onArchive={onArchiveSelected}
              onDelete={onDeleteSelected}
              deleteAvailable={archiveAvailable}
              onToggleRead={onToggleRead}
              onToggleStar={onToggleStar}
              onEmailSelection={setEmailSelection}
              selectionNavigation={emailNavigation}
            />
            {emailChatMounted && (
              <EmailCollaborationChatSurface
                active={emailChatVisible}
                id="email-collaboration-chat"
                companyID={companyID}
                currentUserID={currentUserID}
                message={selectedMessage}
                sharedInboxID={selectedMessage.collaboration_shared_inbox_id || (activeViewID.startsWith("shared:") ? activeViewID.slice("shared:".length).trim() : undefined)}
                accountEmail={selectedMessage.collaboration_account_email || accountEmail}
                companyUsers={companyUsers}
                companyUserGroups={companyUserGroups}
                companyUserGroupMembers={companyUserGroupMembers}
                selection={emailSelection}
                onClearSelection={clearEmailSelection}
                onNavigateToEmailSelection={navigateToEmailSelection}
                onCollaborationChange={onEmailCollaborationChange}
                onError={setEmailCollaborationError}
                onSuccess={clearEmailCollaborationError}
              />
            )}
          </div>
        ) : (
          <div style={emptyStateStyle}>Select a message or compose a new one</div>
        )}
      </section>
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
  deleteConfirmation: { messageIDs: string[]; position?: ConfirmActionMenuPosition | null } | null;
  onArchiveMessages: (ids: string[]) => void;
  onCancelDelete: () => void;
  onCloseContextMenu: () => void;
  onConfirmDelete: (ids: string[]) => void;
  onRequestDeleteDrafts: (ids: string[]) => void;
  onRequestDeleteMessages: (ids: string[], position?: ConfirmActionMenuPosition) => void;
  onUnarchiveMessages: (ids: string[]) => void;
}) {
  return (
    <>
      {messageContextMenu && (
        <div
          style={{ ...messageContextMenuStyle, left: messageContextMenu.x, top: messageContextMenu.y }}
          onMouseLeave={deleteConfirmation ? undefined : onCloseContextMenu}
        >
          {isDraftMailbox ? (
            <button
              style={{ ...contextMenuActionStyle, color: "#dc2626" }}
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
                style={{ ...contextMenuActionStyle, color: "#dc2626" }}
                disabled={busy === "delete" || !mailMutationAvailable}
                onClick={(event) => onRequestDeleteMessages(messageContextMenu.messageIDs, confirmMenuPositionFromElement(event.currentTarget))}
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
          position={deleteConfirmation.position}
          busy={busy === "delete"}
          onConfirm={() => onConfirmDelete(deleteConfirmation.messageIDs)}
          onCancel={onCancelDelete}
        />
      )}
    </>
  );
}

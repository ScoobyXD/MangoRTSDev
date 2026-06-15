import React from "react";
import type { CompanyUser, EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import type { ComposeState, HomeViewID, MessageSelectionModifiers } from "./homeTypes";
import { canDragTriageMessageFromMailbox, formatAddressList, formatMessageDate, mailboxLabel, messageReadStatusLabel, messageReadStatusTitle } from "./homeUtils";
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
  companyUsers,
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
  companyUsers: CompanyUser[];
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
  const [archiveGuideTop, setArchiveGuideTop] = React.useState(ARCHIVE_GUIDE_FALLBACK_TOP);
  const [archiveTailSpacerHeight, setArchiveTailSpacerHeight] = React.useState(ARCHIVE_TAIL_SPACER_MIN_HEIGHT);
  const [archiveProgressByMessageID, setArchiveProgressByMessageID] = React.useState<ArchiveProgressByMessageID>({});
  const archiveVisualFrameRef = React.useRef<number | null>(null);
  const autoArchiveEnabled = isArchivableListView && mailbox === "primary";

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

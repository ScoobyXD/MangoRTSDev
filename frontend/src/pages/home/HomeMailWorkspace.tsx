import React from "react";
import { confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
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
  mailArchiveActionButtonStyle,
  mailArchiveActionCountStyle,
  mailArchiveActionLabelStyle,
  mailArchiveActionsStyle,
  mailComposeSentActionsStyle,
  mailComposeSentTriageActionsStyle,
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
  triageMessageReadStatusSlotStyle,
  triageMessageRowStyle,
  triageSenderStyle,
  triageSubjectStyle,
  mailUnreadFilterRowStyle,
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
  canAdvanceTriagePage,
  hasNextMessagePage,
  onArchiveSelected,
  onAdvanceTriagePage,
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
  pendingStarredMessageIDs: Set<string>;
  searchDraft: string;
  selectedMessage: EmailMessage | null;
  selectedMessageID: string;
  selectedMessageIDs: Set<string>;
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
  const triageAdvanceEnabled = isArchivableListView && mailbox === "primary";
  const advanceDisabled = !canAdvanceTriagePage || !!busy || loadingMessages || loadingMoreMessages || messages.length === 0;

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
                <button className="mango-elevated-action" style={mailPanelSmallButtonStyle} disabled={busy === "disconnect"} onClick={onDisconnect}>Disconnect</button>
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
              const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
              const hovered = hoveredMessageID === message.id;
              const triageView = activeViewID === "my-triage" || activeViewID === "shared-root" || activeViewID.startsWith("shared:");
              const draftRow = mailbox === "drafts" || isDraftMessage(message);
              const draggable = triageView && !draftRow && canDragTriageMessageFromMailbox(mailbox);
              const pendingStarred = pendingStarredMessageIDs.has(message.id);
              const starHovered = hoveredStarMessageID === message.id;
              const starHighlighted = pendingStarred || message.starred || starHovered;
              const rowAddressLabel = draftRow ? (formatAddressList(message.to) || "Draft") : (formatAddressList(message.from) || "Unknown sender");
              const showReadStatus = mailbox === "sent" && !draftRow;
              return (
                <div
                  key={message.id}
                  data-home-mail-message-id={message.id}
                  role="button"
                  tabIndex={0}
                  style={isArchivableListView
                    ? triageMessageRowStyle(active, message.unread, draggable, hovered, false)
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

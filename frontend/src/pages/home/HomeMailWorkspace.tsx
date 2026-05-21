import React from "react";
import type { EmailMailbox, EmailMessage } from "../../modules/communications/communicationsApi";
import type { ComposeState, HomeViewID, MessageSelectionModifiers } from "./homeTypes";
import { formatAddressList, formatMessageDate, mailboxLabel } from "./homeUtils";
import { HomeColumnResizeHandle, ComposePanel, DeleteMessagesConfirmationModal, MessageDetail, MessagePlacementIcon } from "./HomeParts";
import {
  accountEmailStyle,
  accountRowStyle,
  checkboxStyle,
  contextMenuActionStyle,
  emptyStateStyle,
  inlineErrorStyle,
  inlineNoticeStyle,
  inputStyle,
  listHeaderStyle,
  loadingMoreStyle,
  mailArchiveActionButtonStyle,
  mailArchiveActionCountStyle,
  mailArchiveActionLabelStyle,
  mailArchiveActionsStyle,
  mailFiltersRowStyle,
  mailListTitleStackStyle,
  mailListToolbarStyle,
  mailPanelControlsStyle,
  mailPanelStyle,
  messageContextMenuStyle,
  messageListStyle,
  messageRowStyle,
  messageRowTopStyle,
  messageStarButtonStyle,
  mutedSmallStyle,
  panelStyle,
  panelTitleStyle,
  primaryButtonStyle,
  searchButtonStyle,
  searchRowStyle,
  selectedCountStyle,
  smallButtonStyle,
  snippetStyle,
  triageDateStyle,
  triageMailListHeaderStyle,
  triageMessageContentStyle,
  triageMessageMetaStyle,
  triageMessageRowStyle,
  triageSenderStyle,
  triageSubjectStyle,
} from "./homeStyles";

type TriageMailboxCountKey = Extract<EmailMailbox, "primary" | "starred" | "archive">;
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

function collectScrolledOutMessageIDs(container: HTMLDivElement): string[] {
  if (container.scrollTop <= 0) return [];
  const containerTop = container.getBoundingClientRect().top;
  const ids: string[] = [];
  container.querySelectorAll<HTMLElement>("[data-home-mail-message-id]").forEach((row) => {
    if (row.getBoundingClientRect().bottom > containerTop + 1) return;
    const messageID = row.dataset.homeMailMessageId?.trim();
    if (messageID) ids.push(messageID);
  });
  return ids;
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
  notice,
  pendingAutoArchiveMessageIDs,
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
  onOpenAllMailbox,
  onOpenArchivedMailbox,
  onOpenContextMenu,
  onOpenNewCompose,
  onOpenPendingMailbox,
  onOpenReply,
  onOpenStarredMailbox,
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
  notice: string;
  pendingAutoArchiveMessageIDs: Set<string>;
  searchDraft: string;
  selectedMessage: EmailMessage | null;
  selectedMessageID: string;
  selectedMessageIDs: Set<string>;
  sharedInboxSettings?: { onOpen: () => void };
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
  onOpenAllMailbox: () => void;
  onOpenArchivedMailbox: () => void;
  onOpenContextMenu: (message: EmailMessage, event: React.MouseEvent) => void;
  onOpenNewCompose: () => void;
  onOpenPendingMailbox: () => void;
  onOpenReply: () => void;
  onOpenStarredMailbox: () => void;
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
  if (unassignedSharedInbox) {
    return (
      <>
        <section style={mailPanelStyle}>
          <div style={mailPanelControlsStyle}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <h2 style={{ ...panelTitleStyle, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {unassignedSharedInbox.folderName}
              </h2>
              {sharedInboxSettings && <button style={{ ...smallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpen}>RACI assignments</button>}
            </div>
          </div>
          <div className="mango-home-scroll" ref={messageListRef} style={{ ...messageListStyle, alignContent: "center" }}>
            <div style={{ ...emptyStateStyle, minHeight: 220, gap: 12, color: "#24120a", textAlign: "center" }}>
              <strong style={{ fontSize: 20, lineHeight: 1.2 }}>{unassignedSharedInbox.folderName}</strong>
              <span>{unassignedSharedInbox.message ?? "This folder has not been assigned an email"}</span>
              {unassignedSharedInbox.onAssignEmail && <button type="button" style={primaryButtonStyle} onClick={unassignedSharedInbox.onAssignEmail}>Assign email to inbox</button>}
            </div>
          </div>
        </section>

        {showDetailResizeHandle && <HomeColumnResizeHandle dividerIndex={1} onPointerDown={onColumnResizeStart} />}

        <section style={panelStyle}>
          <div style={emptyStateStyle}>Select a message or compose a new one</div>
        </section>
      </>
    );
  }

  return (
    <>
      <section style={mailPanelStyle}>
        <div style={mailPanelControlsStyle}>
          {isArchivableListView ? (
            <div style={triageMailListHeaderStyle}>
              <div style={mailListTitleStackStyle}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <h2 style={{ ...panelTitleStyle, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{listViewLabel}</h2>
                  {sharedInboxSettings && <button style={{ ...smallButtonStyle, flexShrink: 0 }} onClick={sharedInboxSettings.onOpen}>RACI assignments</button>}
                </div>
                <span style={mutedSmallStyle}>{unreadMessageCount} unread</span>
              </div>
              <div style={accountRowStyle}>
                <span style={accountEmailStyle}>{accountEmail}</span>
                <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={onDisconnect}>Disconnect</button>
              </div>
            </div>
          ) : (
            <div style={mailListToolbarStyle}>
              <div style={mailListTitleStackStyle}>
                <h2 style={panelTitleStyle}>{listViewLabel}</h2>
              </div>
              <button style={primaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>
            </div>
          )}
          {error && <div style={inlineErrorStyle}>{error}</div>}
          {notice && !error && <div style={inlineNoticeStyle}>{notice}</div>}
          {isArchivableListView && (
            <div style={mailArchiveActionsStyle}>
              <button
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "primary")}
                title={mailboxCounts.primary === undefined ? "My Triage" : `My Triage (${formatMailboxCount(mailboxCounts.primary)})`}
                onClick={() => {
                  if (mailbox !== "primary") onOpenPendingMailbox();
                }}
              >
                <MailboxActionContent label="My Triage" count={mailboxCounts.primary} />
              </button>
              <button
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
                type="button"
                style={mailArchiveActionButtonStyle(mailbox === "archive")}
                title={mailboxCounts.archive === undefined ? "Archived" : `Archived (${formatMailboxCount(mailboxCounts.archive)})`}
                onClick={() => {
                  if (mailbox !== "archive") onOpenArchivedMailbox();
                }}
              >
                <MailboxActionContent label="Archived" count={mailboxCounts.archive} />
              </button>
              <button
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
          {isArchivableListView && <button style={primaryButtonStyle} onClick={onOpenNewCompose}>Compose</button>}
          {!isArchivableListView && (
            <div style={accountRowStyle}>
              <span style={accountEmailStyle}>{accountEmail}</span>
              <button style={smallButtonStyle} disabled={busy === "disconnect"} onClick={onDisconnect}>Disconnect</button>
            </div>
          )}
          <form style={searchRowStyle} onSubmit={onSubmitSearch}>
            <input
              style={inputStyle}
              value={searchDraft}
              onChange={(event) => onSearchDraftChange(event.target.value)}
              placeholder="Search mail"
            />
            <button type="submit" style={searchButtonStyle}>Search</button>
          </form>
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
          {!isArchivableListView && (
            <div style={listHeaderStyle}>
              <span>{mailboxLabel(mailbox)}</span>
              {(loadingMessages || loadingMoreMessages) && <span>Loading</span>}
            </div>
          )}
        </div>
        <div
          className="mango-home-scroll"
          ref={messageListRef}
          style={messageListStyle}
          onScroll={(event) => {
            const target = event.currentTarget;
            if (isArchivableListView && mailbox === "primary") {
              const scrolledOutIDs = collectScrolledOutMessageIDs(target);
              if (scrolledOutIDs.length > 0) onAutoArchiveMessages(scrolledOutIDs);
            }
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) onLoadMoreMessages();
          }}
        >
          {messages.length === 0 && !loadingMessages ? (
            <div style={emptyStateStyle}>{isArchiveMailbox ? "No archived messages" : "No messages"}</div>
          ) : messages.map((message) => {
            const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
            const draggable = activeViewID === "my-triage" && mailbox === "primary";
            const pendingAutoArchive = mailbox === "primary" && pendingAutoArchiveMessageIDs.has(message.id);
            return (
              <div
                key={message.id}
                data-home-mail-message-id={message.id}
                role="button"
                tabIndex={0}
                style={isArchivableListView
                  ? triageMessageRowStyle(active, message.unread, draggable, pendingAutoArchive)
                  : messageRowStyle(active, message.unread)}
                draggable={draggable}
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
                      <button
                        type="button"
                        aria-label={message.starred ? "Remove star" : "Star message"}
                        title={message.starred ? "Remove star" : "Star message"}
                        draggable={false}
                        style={messageStarButtonStyle(message.starred)}
                        disabled={busy === "message"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleMessageStar(message);
                        }}
                      >
                        <StarIcon filled={message.starred} />
                      </button>
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
        </div>
      </section>

      {showDetailResizeHandle && <HomeColumnResizeHandle dividerIndex={1} onPointerDown={onColumnResizeStart} />}

      <section style={panelStyle}>
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
            style={{ ...contextMenuActionStyle, color: "#8b123f" }}
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

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
  mailArchiveActionsStyle,
  mailFiltersRowStyle,
  mailListTitleStackStyle,
  mailListToolbarStyle,
  mailPanelControlsStyle,
  mailPanelStyle,
  messageArchiveButtonStyle,
  messageContextMenuStyle,
  messageListStyle,
  messageRowStyle,
  messageRowTopStyle,
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
  mailboxActionBusy,
  messageListRef,
  messages,
  notice,
  searchDraft,
  selectedMessage,
  selectedMessageID,
  selectedMessageIDs,
  selectedMessageActionCount,
  returnMailboxLabel,
  showDetailResizeHandle,
  unreadOnly,
  unreadMessageCount,
  onArchiveMessage,
  onArchiveSelected,
  onArchiveSelection,
  onCancelCompose,
  onColumnResizeStart,
  onComposeChange,
  onDeleteSelected,
  onDisconnect,
  onLoadMoreMessages,
  onOpenArchives,
  onOpenContextMenu,
  onOpenMyTriageMailbox,
  onOpenNewCompose,
  onOpenReply,
  onSearchDraftChange,
  onSelectMessage,
  onStartMessageDrag,
  onSubmitCompose,
  onSubmitSearch,
  onToggleRead,
  onToggleStar,
  onToggleUnreadOnly,
  onUnarchiveMessage,
  onUnarchiveSelection,
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
  mailboxActionBusy: boolean;
  messageListRef: React.RefObject<HTMLDivElement>;
  messages: EmailMessage[];
  notice: string;
  searchDraft: string;
  selectedMessage: EmailMessage | null;
  selectedMessageID: string;
  selectedMessageIDs: Set<string>;
  selectedMessageActionCount: number;
  returnMailboxLabel: string;
  showDetailResizeHandle: boolean;
  unreadOnly: boolean;
  unreadMessageCount: number;
  onArchiveMessage: (messageID: string) => void;
  onArchiveSelected: () => void;
  onArchiveSelection: () => void;
  onCancelCompose: () => void;
  onColumnResizeStart: (dividerIndex: 0 | 1 | 2, event: React.PointerEvent<HTMLButtonElement>) => void;
  onComposeChange: React.Dispatch<React.SetStateAction<ComposeState>>;
  onDeleteSelected: () => void;
  onDisconnect: () => void;
  onLoadMoreMessages: () => void;
  onOpenArchives: () => void;
  onOpenContextMenu: (message: EmailMessage, event: React.MouseEvent) => void;
  onOpenMyTriageMailbox: () => void;
  onOpenNewCompose: () => void;
  onOpenReply: () => void;
  onSearchDraftChange: (value: string) => void;
  onSelectMessage: (message: EmailMessage, modifiers: MessageSelectionModifiers) => void;
  onStartMessageDrag: (message: EmailMessage, event: React.DragEvent<HTMLElement>) => void;
  onSubmitCompose: (event: React.FormEvent) => void;
  onSubmitSearch: (event: React.FormEvent) => void;
  onToggleRead: () => void;
  onToggleStar: () => void;
  onToggleUnreadOnly: (checked: boolean) => void;
  onUnarchiveMessage: (messageID: string) => void;
  onUnarchiveSelection: () => void;
}) {
  return (
    <>
      <section style={mailPanelStyle}>
        <div style={mailPanelControlsStyle}>
          {isArchivableListView ? (
            <div style={triageMailListHeaderStyle}>
              <div style={mailListTitleStackStyle}>
                <h2 style={panelTitleStyle}>{listViewLabel}</h2>
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
                style={mailArchiveActionButtonStyle(!isArchiveMailbox)}
                onClick={() => {
                  if (isArchiveMailbox) onOpenMyTriageMailbox();
                }}
              >
                {returnMailboxLabel}
              </button>
              <button
                type="button"
                style={mailArchiveActionButtonStyle(isArchiveMailbox)}
                onClick={() => {
                  if (!isArchiveMailbox) onOpenArchives();
                }}
              >
                All Archives
              </button>
              <button
                type="button"
                style={mailArchiveActionButtonStyle(false)}
                disabled={mailboxActionBusy || selectedMessageActionCount === 0}
                onClick={isArchiveMailbox ? onUnarchiveSelection : onArchiveSelection}
              >
                {mailboxActionBusy
                  ? isArchiveMailbox ? "Moving" : "Archiving"
                  : selectedMessageActionCount > 1
                    ? `${isArchiveMailbox ? "Unarchive" : "Archive"} ${selectedMessageActionCount}`
                    : isArchiveMailbox ? "Unarchive" : "Archive"}
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
          ref={messageListRef}
          style={messageListStyle}
          onScroll={(event) => {
            const target = event.currentTarget;
            if (target.scrollHeight - target.scrollTop - target.clientHeight < 160) onLoadMoreMessages();
          }}
        >
          {messages.length === 0 && !loadingMessages ? (
            <div style={emptyStateStyle}>{isArchiveMailbox ? "No archived messages" : "No messages"}</div>
          ) : messages.map((message) => {
            const active = selectedMessageIDs.has(message.id) || selectedMessageID === message.id;
            const draggable = activeViewID === "my-triage" && !isArchiveMailbox;
            return (
              <div
                key={message.id}
                role="button"
                tabIndex={0}
                style={isArchivableListView
                  ? triageMessageRowStyle(active, message.unread, draggable)
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
                        style={messageArchiveButtonStyle}
                        disabled={mailboxActionBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (isArchiveMailbox) onUnarchiveMessage(message.id);
                          else onArchiveMessage(message.id);
                        }}
                      >
                        {isArchiveMailbox ? "Unarchive" : "Archive"}
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
            disabled={mailboxActionBusy}
            onClick={() => {
              if (isArchiveMailbox) onUnarchiveMessages(messageContextMenu.messageIDs);
              else onArchiveMessages(messageContextMenu.messageIDs);
            }}
          >
            {isArchiveMailbox ? "Unarchive" : "Archive"}
          </button>
          <button
            style={{ ...contextMenuActionStyle, color: "#8b123f" }}
            disabled={busy === "delete"}
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

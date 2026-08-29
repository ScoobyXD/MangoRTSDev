import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import {
  deleteMangoAttachmentPermanently,
  groupMangoResourceAttachmentsByInformationID,
  listMangoResourceAttachments,
  uploadMangoAttachment,
  type MangoResourceAttachment,
} from "../attachments/attachmentApi.js";
import { remapEditorChatEntityLinks, trimEditorChatDraft, type EditorChatEntityLink } from "../editor/chatEntityLinks.js";
import type { EditorTextBlockChatMessage } from "../editor/editorProjection.js";
import { mentionedUserIDsFromChatDraft } from "../editor/editorMentions.js";
import {
  AttachmentCountDropdown,
  ChatPane,
  DeleteTextBlockConfirmationModal,
  NodeTextBlockEditor,
  TextBlockActionsMenu,
  TimelineCell,
} from "../editor/NodeWorkspaceSurfaceParts.js";
import {
  ChatIcon,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  PlusIcon,
  TextEditorIcon,
} from "../editor/NodeWorkspaceSurfaceShared.js";
import type { TextBlockSelectionAnchor, TextBlockSelectionDraft } from "../editor/NodeWorkspaceSurfaceShared.js";
import { EditorSavedTimestamp, EditorSaveStatusIcon, type EditorSaveState } from "../editor/EditorSaveStatusIcon.js";
import { mangoTiptapPendingStorageKey } from "../editor/tiptap/mangoTiptapSync.js";
import type { CompanyUser } from "../communications/communicationsApi.js";
import type { BareMangoEditorControls } from "./BareMangoEditor.js";
import {
  actionItemReferenceIDs,
  transitionActionItemReferenceRefresh,
  type ActionItemReferenceRefreshEvent,
  type ActionItemReferenceRefreshState,
} from "./huddleActionItems.js";
import {
  createHuddleNodeChat,
  createHuddleNodeTextBox,
  deleteHuddleNodeChat,
  deleteHuddleNodeTextBox,
  getHuddleNodeWorkspace,
  updateHuddleNodeChat,
  type HuddleNodeChat,
  type HuddleNodeTextBox,
  type HuddleNodeWorkspaceRequest,
} from "./huddleNodeWorkspaceApi.js";

type HuddleNodeWorkspaceProps = {
  apiBase: string;
  companyID: string;
  huddleNodeID: string;
  currentUserID: string;
  companyUsers: CompanyUser[];
  requestJSON: HuddleNodeWorkspaceRequest;
  controls: BareMangoEditorControls;
  onError: (message: string) => void;
  onActionItemsChanged: () => void;
  onActiveTextBoxIDChange?: (textBoxID: string) => void;
};

export const HuddleNodeWorkspace: React.FC<HuddleNodeWorkspaceProps> = ({
  apiBase,
  companyID,
  huddleNodeID,
  currentUserID,
  companyUsers,
  requestJSON,
  controls,
  onError,
  onActionItemsChanged,
  onActiveTextBoxIDChange,
}) => {
  const [textBoxes, setTextBoxes] = useState<HuddleNodeTextBox[]>([]);
  const [chats, setChats] = useState<HuddleNodeChat[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [activeTextBoxID, setActiveTextBoxID] = useState("");
  const [openChatTextBoxIDs, setOpenChatTextBoxIDs] = useState<Set<string>>(new Set());
  const [activeChatMessageIDs, setActiveChatMessageIDs] = useState<Record<string, string>>({});
  const [chatDrafts, setChatDrafts] = useState<Record<string, string>>({});
  const [chatDraftEntityLinks, setChatDraftEntityLinks] = useState<Record<string, EditorChatEntityLink[]>>({});
  const [chatReplyTargets, setChatReplyTargets] = useState<Record<string, string>>({});
  const [chatSelectionAnchors, setChatSelectionAnchors] = useState<Record<string, TextBlockSelectionAnchor>>({});
  const [chatNavigationRequests, setChatNavigationRequests] = useState<Record<string, { anchorMessageID: string; requestID: number }>>({});
  const [submittingChatTextBoxIDs, setSubmittingChatTextBoxIDs] = useState<Set<string>>(new Set());
  const [resourceAttachments, setResourceAttachments] = useState<MangoResourceAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [deleteTextBoxConfirmation, setDeleteTextBoxConfirmation] = useState<{
    textBoxID: string;
    title: string;
    chatCount: number;
    position: ConfirmActionMenuPosition;
  } | null>(null);
  const actionItemReferenceRefreshByTextBoxRef = useRef(new Map<string, ActionItemReferenceRefreshState>());
  const navigationRequestIDRef = useRef(0);
  const chatSubmissionsInProgressRef = useRef(new Set<string>());

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const workspace = await getHuddleNodeWorkspace(requestJSON, { companyID, huddleNodeID });
      setTextBoxes(workspace.textboxes);
      setActiveTextBoxID((current) => workspace.textboxes.some((item) => item.textbox_id === current)
        ? current
        : workspace.textboxes[0]?.textbox_id ?? "");
      setChats(workspace.chats);
      actionItemReferenceRefreshByTextBoxRef.current.clear();
    } catch (cause) {
      onError(errorMessage(cause, "Could not load the Huddle Node workspace"));
    } finally {
      setLoading(false);
    }
  }, [companyID, huddleNodeID, onError, requestJSON]);

  const loadAttachments = useCallback(async () => {
    setAttachmentsLoading(true);
    setAttachmentsError("");
    try {
      const payload = await listMangoResourceAttachments(requestJSON, {
        apiBase,
        companyID,
        resourceType: "huddle_node",
        resourceID: huddleNodeID,
      });
      setResourceAttachments(payload.attachments ?? []);
    } catch (cause) {
      const message = errorMessage(cause, "Could not load attachments");
      setAttachmentsError(message);
    } finally {
      setAttachmentsLoading(false);
    }
  }, [apiBase, companyID, huddleNodeID, requestJSON]);

  useEffect(() => { void loadWorkspace(); }, [loadWorkspace]);
  useEffect(() => { void loadAttachments(); }, [loadAttachments]);
  useEffect(() => { onActiveTextBoxIDChange?.(activeTextBoxID); }, [activeTextBoxID, onActiveTextBoxIDChange]);

  const attachmentsByTextBox = useMemo(
    () => groupMangoResourceAttachmentsByInformationID(resourceAttachments),
    [resourceAttachments],
  );

  const recordActionItemReferenceEvent = useCallback((textBoxID: string, event: ActionItemReferenceRefreshEvent) => {
    const result = transitionActionItemReferenceRefresh(
      actionItemReferenceRefreshByTextBoxRef.current.get(textBoxID),
      event,
    );
    if (result.state) actionItemReferenceRefreshByTextBoxRef.current.set(textBoxID, result.state);
    else actionItemReferenceRefreshByTextBoxRef.current.delete(textBoxID);
    if (result.refresh) onActionItemsChanged();
  }, [onActionItemsChanged]);

  const recordEditorSaveState = useCallback((textBoxID: string, state: EditorSaveState) => {
    if (state.status !== "saved") return;
    if (Number.isInteger(state.revision)) {
      setTextBoxes((current) => current.map((item) => item.textbox_id === textBoxID
        ? { ...item, revision: state.revision ?? item.revision }
        : item));
    }
    recordActionItemReferenceEvent(textBoxID, { type: "saved" });
  }, [recordActionItemReferenceEvent]);

  const recordActionItemReferenceSnapshot = useCallback((textBoxID: string, document: unknown) => {
    recordActionItemReferenceEvent(textBoxID, {
      type: "snapshot",
      signature: actionItemReferenceIDs(document).join("\n"),
    });
  }, [recordActionItemReferenceEvent]);

  const recordCanonicalActionItemReferences = useCallback((textBoxID: string, document: unknown) => {
    recordActionItemReferenceEvent(textBoxID, {
      type: "canonical",
      signature: actionItemReferenceIDs(document).join("\n"),
    });
  }, [recordActionItemReferenceEvent]);

  const createTextBox = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createHuddleNodeTextBox(requestJSON, { companyID, huddleNodeID, title: "New text box" });
      setTextBoxes((current) => [created, ...current]);
      setActiveTextBoxID(created.textbox_id);
    } catch (cause) {
      onError(errorMessage(cause, "Could not add a text box"));
    } finally {
      setCreating(false);
    }
  };

  const removeTextBox = async (textBox: HuddleNodeTextBox) => {
    try {
      await deleteHuddleNodeTextBox(requestJSON, {
        companyID,
        huddleNodeID,
        textBoxID: textBox.textbox_id,
        revision: textBox.revision,
      });
      const next = textBoxes.filter((item) => item.textbox_id !== textBox.textbox_id);
      recordActionItemReferenceEvent(textBox.textbox_id, { type: "removed" });
      setTextBoxes(next);
      setChats((current) => current.filter((item) => item.textbox_id !== textBox.textbox_id));
      setOpenChatTextBoxIDs((current) => withoutSetValue(current, textBox.textbox_id));
      setActiveTextBoxID((current) => current === textBox.textbox_id ? next[0]?.textbox_id ?? "" : current);
    } catch (cause) {
      onError(errorMessage(cause, "Could not delete the text box"));
    }
  };

  const confirmTextBoxDeletion = () => {
    if (!deleteTextBoxConfirmation) return;
    const textBox = textBoxes.find((item) => item.textbox_id === deleteTextBoxConfirmation.textBoxID);
    setDeleteTextBoxConfirmation(null);
    if (textBox) void removeTextBox(textBox);
  };

  const uploadTextBoxFiles = async (textBoxID: string, files: File[]) => {
    if (files.length === 0) return;
    const results = await Promise.allSettled(files.map((file) => uploadMangoAttachment(requestJSON, {
      companyID,
      resourceType: "huddle_node",
      resourceID: huddleNodeID,
      file,
      sourceKind: "user_upload",
      relationshipKind: "file_attachment",
      informationID: textBoxID,
      editorSurface: "huddle_node_textbox",
    })));
    await loadAttachments();
    const failures = results.filter((item) => item.status === "rejected");
    if (failures.length > 0) onError(`${failures.length} attachment${failures.length === 1 ? "" : "s"} could not be uploaded.`);
  };

  const removeTextBoxAttachment = async (resourceAttachment: MangoResourceAttachment) => {
    const attachmentID = resourceAttachment.attachment_id.trim();
    if (!attachmentID || !window.confirm(`Permanently delete ${resourceAttachment.attachment?.original_filename || "this file"}?`)) return;
    try {
      await deleteMangoAttachmentPermanently(requestJSON, {
        companyID,
        resourceType: "huddle_node",
        resourceID: huddleNodeID,
        attachmentID,
      });
      await loadAttachments();
    } catch (cause) {
      onError(errorMessage(cause, "Could not remove the attachment"));
    }
  };

  const submitChat = async (textBoxID: string) => {
    const { message, entityLinks } = trimEditorChatDraft(chatDrafts[textBoxID] ?? "", chatDraftEntityLinks[textBoxID] ?? []);
    if (!message) return;
    if (chatSubmissionsInProgressRef.current.has(textBoxID)) return;
    chatSubmissionsInProgressRef.current.add(textBoxID);
    setSubmittingChatTextBoxIDs((current) => new Set(current).add(textBoxID));
    const parentChatID = chatReplyTargets[textBoxID];
    const selectionAnchor = parentChatID ? undefined : chatSelectionAnchors[textBoxID];
    try {
      const created = await createHuddleNodeChat(requestJSON, {
        companyID,
        huddleNodeID,
        textBoxID,
        parentChatID,
        message,
        entityLinks,
        mentionedUserIDs: mentionedUserIDsFromChatDraft(message, companyUsers),
        selectionQuote: selectionAnchor?.quote,
        selectionStart: selectionAnchor?.startOffset,
        selectionEnd: selectionAnchor?.endOffset,
      });
      setChats((current) => [...current, created]);
      setChatDrafts((current) => ({ ...current, [textBoxID]: "" }));
      setChatDraftEntityLinks((current) => ({ ...current, [textBoxID]: [] }));
      setChatReplyTargets((current) => ({ ...current, [textBoxID]: "" }));
      setChatSelectionAnchors((current) => withoutRecordValue(current, textBoxID));
    } catch (cause) {
      onError(errorMessage(cause, "Could not send the chat message"));
    } finally {
      chatSubmissionsInProgressRef.current.delete(textBoxID);
      setSubmittingChatTextBoxIDs((current) => withoutSetValue(current, textBoxID));
    }
  };

  const editChat = async (chatID: string, message: string) => {
    const existing = chats.find((item) => item.chat_id === chatID);
    if (!existing) return;
    const entityLinks = remapEditorChatEntityLinks(existing.message, message, existing.entity_links);
    try {
      const updated = await updateHuddleNodeChat(requestJSON, {
        companyID,
        huddleNodeID,
        textBoxID: existing.textbox_id,
        chatID,
        revision: existing.revision,
        parentChatID: existing.parent_chat_id,
        message,
        entityLinks,
        selectionQuote: existing.selection_quote,
        selectionStart: existing.selection_start,
        selectionEnd: existing.selection_end,
        mentionedUserIDs: mentionedUserIDsFromChatDraft(message, companyUsers),
        mentionedGroupIDs: existing.mentioned_group_ids,
      });
      setChats((current) => current.map((item) => item.chat_id === chatID ? updated : item));
    } catch (cause) {
      onError(errorMessage(cause, "Could not edit the chat message"));
      throw cause;
    }
  };

  const removeChat = async (chatID: string) => {
    const existing = chats.find((item) => item.chat_id === chatID);
    if (!existing) return;
    try {
      await deleteHuddleNodeChat(requestJSON, { companyID, huddleNodeID, chatID, revision: existing.revision });
      setChats((current) => current.filter((item) => item.chat_id !== chatID));
    } catch (cause) {
      onError(errorMessage(cause, "Could not delete the chat message"));
    }
  };

  const openSelectionChat = (selection: TextBlockSelectionDraft) => {
    setChatSelectionAnchors((current) => ({ ...current, [selection.blockID]: selection }));
    setOpenChatTextBoxIDs((current) => new Set(current).add(selection.blockID));
  };

  if (loading) return <div role="status" style={emptyStyle}>Loading Huddle Node workspace…</div>;

  return (
    <section aria-label="Huddle Node editor" data-huddle-node-workspace="node-tools-without-email" style={workspaceStyle}>
      <div style={timelineGridStyle}>
        <div data-huddle-node-header-timeline-control="true" style={timelineHeaderControlStyle}>
          <button
            type="button"
            disabled={creating}
            title={creating ? "Adding text box" : "Add text box"}
            aria-label={creating ? "Adding text box" : "Add text box"}
            onClick={() => void createTextBox()}
            style={{ ...timelineAddButtonStyle, cursor: creating ? "wait" : "pointer", opacity: creating ? 0.6 : 1 }}
          >
            <PlusIcon color="#0f766e" />
          </button>
        </div>
        <div aria-hidden="true" style={timelineHeaderSpacerStyle} />
        {textBoxes.length === 0 && <div style={emptyStyle}>No text boxes yet.</div>}
        {textBoxes.map((textBox, index) => {
          const textBoxID = textBox.textbox_id;
          const textBoxChats = chats.filter((item) => item.textbox_id === textBoxID).map(toEditorChatMessage);
          const chatOpen = openChatTextBoxIDs.has(textBoxID);
          const selectionAnchor = chatSelectionAnchors[textBoxID];
          const textBoxAttachments = attachmentsByTextBox.get(textBoxID) ?? [];
          const textBoxSaveStorageKey = mangoTiptapPendingStorageKey({ companyID, resourceType: "huddle_node", resourceID: huddleNodeID, documentID: textBoxID });
          const textBoxSaveFallback = { status: "saved" as const, updatedTimestamp: textBox.updated_timestamp };
          return (
            <React.Fragment key={textBoxID}>
              <div style={timelineCellFrameStyle}>
                <TimelineCell accent="#0f766e" muted={false} isLast={index === textBoxes.length - 1} minHeight={HUDDLE_TEXT_BOX_ROW_HEIGHT} />
              </div>
              <article data-huddle-node-textbox={textBoxID} style={textBoxCardStyle}>
              <div style={textBoxHeaderStyle}>
                <div data-node-header-save-metadata="true" style={saveMetadataStyle}>
                  <EditorSaveStatusIcon state={textBoxSaveFallback} storageKey={textBoxSaveStorageKey} compact />
                  <EditorSavedTimestamp storageKey={textBoxSaveStorageKey} fallbackUpdatedTimestamp={textBox.updated_timestamp} createdTimestamp={textBox.created_timestamp} formatTimestamp={formatTextBlockMetadataTimestamp} />
                </div>
                <div data-node-pane-header="editor" style={editorHeaderControlsStyle}>
                  <AttachmentCountDropdown
                    items={textBoxAttachments.map((resourceAttachment) => ({ resourceAttachment }))}
                    apiBase={apiBase}
                    companyID={companyID}
                    accent="#0f766e"
                    surfaceText="#0f172a"
                    compact
                    loading={attachmentsLoading}
                    loadError={attachmentsError}
                    onRetry={() => void loadAttachments()}
                    onAddFiles={(files) => uploadTextBoxFiles(textBoxID, files)}
                    onRemove={({ resourceAttachment }) => void removeTextBoxAttachment(resourceAttachment)}
                    onError={onError}
                  />
                  <TextBlockActionsMenu
                    accent="#0f766e"
                    surfaceText="#0f172a"
                    panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
                    strokeColor="rgba(15,23,42,.18)"
                    onDelete={(position) => setDeleteTextBoxConfirmation({
                      textBoxID,
                      title: textBox.title,
                      chatCount: textBoxChats.length,
                      position,
                    })}
                  />
                  <span style={activeTextBoxID === textBoxID ? activeEditorBadgeStyle : editorBadgeStyle}>
                    <TextEditorIcon color="#0f766e" />
                    <span>Editor</span>
                  </span>
                </div>
                <div data-node-pane-header="chat" style={chatHeaderControlsStyle}>
                  <button
                    type="button"
                    title={chatOpen ? "Hide chat" : "Open chat"}
                    aria-label="Toggle chat column"
                    aria-pressed={chatOpen}
                    onClick={() => setOpenChatTextBoxIDs((current) => toggleSetValue(current, textBoxID))}
                    style={{ ...chatToggleButtonStyle, border: chatOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: chatOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE }}
                  >
                    <ChatIcon color="#0f766e" />
                    <span>Chat{textBoxChats.length > 0 ? ` ${textBoxChats.length}` : ""}</span>
                  </button>
                </div>
              </div>
              <div data-huddle-node-textbox-columns={chatOpen ? "editor-chat" : "editor"} style={{ ...textBoxBodyStyle, gridTemplateColumns: chatOpen ? "minmax(300px,1fr) minmax(280px,.72fr)" : "minmax(0,1fr)" }}>
                <div style={editorFrameStyle}>
                  <NodeTextBlockEditor
                    fillHeight
                    blockID={textBoxID}
                    surfaceKind="huddle_node"
                    editable
                    nodeID={huddleNodeID}
                    apiBase={apiBase}
                    companyID={companyID}
                    attachmentResourceType="huddle_node"
                    attachmentResourceID={huddleNodeID}
                    attachmentRequestJSON={requestJSON}
                    attachmentEditorSurface="huddle_node_textbox"
                    currentUserID={currentUserID}
                    companyUsers={companyUsers}
                    documentValue=""
                    chatMessages={textBoxChats}
                    pendingChatSelectionAnchor={selectionAnchor}
                    activeChatAnchorMessageID={activeChatMessageIDs[textBoxID] ?? ""}
                    chatNavigationRequest={chatNavigationRequests[textBoxID] ?? null}
                    onChatNavigationConsumed={() => setChatNavigationRequests((current) => withoutRecordValue(current, textBoxID))}
                    surfaceText="#0f172a"
                    accent="#0f766e"
                    outlineStyle={controls.outlineStyle}
                    indentGuideColor="rgba(15,118,110,.22)"
                    scrollbarTrack="rgba(226,232,240,.72)"
                    onFocus={() => setActiveTextBoxID(textBoxID)}
                    onBlur={() => undefined}
                    onDocumentChange={() => undefined}
                    onDocumentFlush={() => undefined}
                    onDocumentError={onError}
                    onSaveStateChange={(state) => recordEditorSaveState(textBoxID, state)}
                    onDocumentSnapshotChange={(document) => recordActionItemReferenceSnapshot(textBoxID, document)}
                    onCanonicalDocumentChange={(document) => recordCanonicalActionItemReferences(textBoxID, document)}
                    onChatHighlightActivate={(messageID) => {
                      setActiveChatMessageIDs((current) => ({ ...current, [textBoxID]: messageID }));
                      setOpenChatTextBoxIDs((current) => new Set(current).add(textBoxID));
                    }}
                    onSelectionChatRequest={openSelectionChat}
                    formattingControllerRef={controls.controllerRef}
                    formattingControllerActive={activeTextBoxID === textBoxID}
                    onSelectionFontSizeChange={controls.setFontSize}
                    onSelectionInlineFormatChange={controls.setInline}
                    onSelectionHighlightColorChange={controls.setHighlight}
                    onSelectionTextAlignmentChange={controls.setAlignment}
                  />
                </div>
                {chatOpen && (
                  <div style={chatFrameStyle}>
                    <ChatPane
                      blockID={textBoxID}
                      editable
                      submitting={submittingChatTextBoxIDs.has(textBoxID)}
                      apiBase={apiBase}
                      companyID={companyID}
                      entityRequestJSON={requestJSON}
                      messages={textBoxChats}
                      hideHeader
                      selectionAnchor={selectionAnchor}
                      draft={chatDrafts[textBoxID] ?? ""}
                      draftEntityLinks={chatDraftEntityLinks[textBoxID] ?? []}
                      companyUsers={companyUsers}
                      draftAttachments={[]}
                      attachmentsEnabled={false}
                      replyTargetID={chatReplyTargets[textBoxID] ?? ""}
                      heightStorageKey={`huddle-node-chat-height-v1:${companyID}:${huddleNodeID}:${textBoxID}`}
                      fillHeight
                      active
                      currentUserID={currentUserID}
                      activeMessageID={activeChatMessageIDs[textBoxID] ?? ""}
                      accent="#0f766e"
                      surfaceText="#0f172a"
                      panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
                      strokeColor="rgba(15,23,42,.18)"
                      ruleColor="rgba(15,118,110,.22)"
                      onFocus={() => undefined}
                      onDraftChange={(draft) => setChatDrafts((current) => ({ ...current, [textBoxID]: draft }))}
                      onDraftEntityLinksChange={(links) => setChatDraftEntityLinks((current) => ({ ...current, [textBoxID]: links }))}
                      onActivateMessage={(messageID) => setActiveChatMessageIDs((current) => ({ ...current, [textBoxID]: messageID }))}
                      onNavigateToMessage={(messageID) => {
                        navigationRequestIDRef.current += 1;
                        setActiveChatMessageIDs((current) => ({ ...current, [textBoxID]: messageID }));
                        setChatNavigationRequests((current) => ({ ...current, [textBoxID]: { anchorMessageID: messageID, requestID: navigationRequestIDRef.current } }));
                      }}
                      onReply={(messageID) => setChatReplyTargets((current) => ({ ...current, [textBoxID]: messageID }))}
                      onEditMessage={editChat}
                      onDeleteMessage={(messageID) => void removeChat(messageID)}
                      onClearReply={() => setChatReplyTargets((current) => ({ ...current, [textBoxID]: "" }))}
                      onClearSelectionAnchor={() => setChatSelectionAnchors((current) => withoutRecordValue(current, textBoxID))}
                      onAttachFiles={() => undefined}
                      onRemoveDraftAttachment={() => undefined}
                      onSubmit={() => void submitChat(textBoxID)}
                    />
                  </div>
                )}
              </div>
              </article>
            </React.Fragment>
          );
        })}
      </div>
      {deleteTextBoxConfirmation && (
        <DeleteTextBlockConfirmationModal
          title={deleteTextBoxConfirmation.title}
          chatCount={deleteTextBoxConfirmation.chatCount}
          accent="#0f766e"
          surfaceText="#0f172a"
          panelBackground={EDITOR_NEU_PANEL_BACKGROUND}
          ruleColor="rgba(15,118,110,.22)"
          position={deleteTextBoxConfirmation.position}
          onConfirm={confirmTextBoxDeletion}
          onCancel={() => setDeleteTextBoxConfirmation(null)}
        />
      )}
    </section>
  );
};

function toEditorChatMessage(chat: HuddleNodeChat): EditorTextBlockChatMessage {
  return {
    id: chat.chat_id,
    blockID: chat.textbox_id,
    parentID: chat.parent_chat_id,
    selectionSource: chat.selection_quote ? "text" : undefined,
    selectionBlockID: chat.selection_quote ? chat.textbox_id : undefined,
    selectionQuote: chat.selection_quote,
    selectionStart: chat.selection_start,
    selectionEnd: chat.selection_end,
    authorID: chat.author_id,
    authorName: chat.author_display_name,
    message: chat.message,
    createdTimestamp: chat.created_timestamp,
    editedTimestamp: chat.edited_timestamp || (chat.updated_timestamp && chat.updated_timestamp !== chat.created_timestamp ? chat.updated_timestamp : undefined),
    attachments: chat.attachments,
    entityLinks: chat.entity_links,
    mentionedUserIDs: chat.mentioned_user_ids,
    mentionedGroupIDs: chat.mentioned_group_ids,
  };
}

function toggleSetValue(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function withoutSetValue(current: Set<string>, value: string): Set<string> {
  if (!current.has(value)) return current;
  const next = new Set(current);
  next.delete(value);
  return next;
}

function withoutRecordValue<T>(current: Record<string, T>, key: string): Record<string, T> {
  if (!(key in current)) return current;
  const next = { ...current };
  delete next[key];
  return next;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim() ? cause.message : fallback;
}

function formatTextBlockMetadataTimestamp(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric" }).format(date);
  return `${time} ${day}`;
}

const HUDDLE_TEXT_BOX_BODY_HEIGHT = 320;
const HUDDLE_TEXT_BOX_ROW_HEIGHT = 358;
const workspaceStyle: React.CSSProperties = { minWidth: 0, minHeight: 0, overflowY: "auto", overflowX: "hidden", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 12, background: EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_SHADOW, scrollbarGutter: "stable" };
const timelineGridStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", columnGap: 4, rowGap: 12, alignItems: "start", alignContent: "start", padding: "0 14px 38px" };
const timelineHeaderControlStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 44, minHeight: 38, padding: "0 0 7px", background: EDITOR_NEU_PANEL_BACKGROUND, display: "flex", alignItems: "flex-start", justifyContent: "flex-start" };
const timelineHeaderSpacerStyle: React.CSSProperties = { position: "sticky", top: 0, zIndex: 43, minHeight: 38, background: EDITOR_NEU_PANEL_BACKGROUND };
const timelineAddButtonStyle: React.CSSProperties = { width: 30, height: 30, borderRadius: 9, border: "1px solid transparent", background: EDITOR_NEU_SURFACE, color: "#0f766e", display: "grid", placeItems: "center", padding: 0, boxShadow: EDITOR_NEU_SHADOW };
const timelineCellFrameStyle: React.CSSProperties = { minHeight: HUDDLE_TEXT_BOX_ROW_HEIGHT, height: HUDDLE_TEXT_BOX_ROW_HEIGHT };
const textBoxCardStyle: React.CSSProperties = { minWidth: 0, minHeight: HUDDLE_TEXT_BOX_ROW_HEIGHT, height: HUDDLE_TEXT_BOX_ROW_HEIGHT, display: "grid", gridTemplateRows: `38px ${HUDDLE_TEXT_BOX_BODY_HEIGHT}px`, overflow: "hidden", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, rgba(255,255,255,.76), rgba(255,255,255,.76)) border-box`, boxShadow: EDITOR_NEU_SHADOW };
const textBoxHeaderStyle: React.CSSProperties = { minWidth: 0, height: 38, display: "grid", gridTemplateColumns: "minmax(220px,1fr) auto auto", alignItems: "center", gap: 4, padding: "4px 6px", boxSizing: "border-box", borderBottom: "1px solid rgba(15,118,110,.22)", background: "linear-gradient(90deg, rgba(255,241,242,.62), rgba(236,253,245,.42) 52%, rgba(239,246,255,.66))" };
const saveMetadataStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-start", gap: 6, overflow: "hidden" };
const editorHeaderControlsStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 };
const chatHeaderControlsStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 5 };
const editorBadgeStyle: React.CSSProperties = { minHeight: 26, flex: "0 0 auto", borderRadius: 8, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, background: EDITOR_NEU_SURFACE, color: "#0f766e", display: "inline-flex", alignItems: "center", gap: 5, padding: "0 7px", fontSize: 10.5, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW };
const activeEditorBadgeStyle: React.CSSProperties = { ...editorBadgeStyle, border: "1px solid transparent", background: `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` };
const chatToggleButtonStyle: React.CSSProperties = { minHeight: 26, borderRadius: 8, color: "#0f766e", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "0 7px", font: "inherit", fontSize: 10.5, fontWeight: 900, boxShadow: EDITOR_NEU_SHADOW };
const textBoxBodyStyle: React.CSSProperties = { minWidth: 0, minHeight: 280, display: "grid", overflowX: "auto", overflowY: "hidden" };
const editorFrameStyle: React.CSSProperties = { minWidth: 300, minHeight: HUDDLE_TEXT_BOX_BODY_HEIGHT, height: HUDDLE_TEXT_BOX_BODY_HEIGHT, overflow: "hidden", background: "rgba(255,255,255,.72)" };
const chatFrameStyle: React.CSSProperties = { minWidth: 280, minHeight: HUDDLE_TEXT_BOX_BODY_HEIGHT, height: HUDDLE_TEXT_BOX_BODY_HEIGHT, overflow: "hidden", borderLeft: "1px solid rgba(148,163,184,.18)" };
const emptyStyle: React.CSSProperties = { gridColumn: "2", minHeight: 80, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 700, padding: 16 };

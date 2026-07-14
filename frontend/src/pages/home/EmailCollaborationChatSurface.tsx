import React from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON } from "../../modules/api/requestJSON";
import {
  ensureEmailCollaboration,
  getEmailCollaboration,
  resolveEmailCollaboration,
  type CommunicationsEmailCollaboration,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
  type EmailMessage,
} from "../../modules/communications/communicationsApi";
import { mentionUserDisplayName, splitTextByMentions, type MentionableCompanyUser } from "../../modules/editor/editorMentions";
import {
  buildEditorTextBlockChatPayload,
  canDeleteEditorTextBlockChatMessage,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  parseEditorTextBlockChats,
  type EditorChatAttachment,
  type EditorTextBlockChatMessage,
} from "../../modules/editor/editorProjection";
import { ChatPane } from "../../modules/editor/NodeWorkspaceSurfaceParts";
import {
  EDITOR_NEU_SURFACE,
  uploadEditorAttachment,
  type TextBlockSelectionAnchor,
} from "../../modules/editor/NodeWorkspaceSurfaceShared";
import { generateStableInformationID } from "../../modules/editor/editorTypes";
import {
  getNodeInformationProjectionSingleFlight,
  invalidateNodeRecordStoreCaches,
} from "../../modules/node-map/NodeRecordStore";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";

export type EmailCollaborationSelection = {
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

type EmailCollaborationChatSurfaceProps = {
  companyID: string;
  currentUserID: string;
  message: EmailMessage;
  sharedInboxID?: string;
  accountEmail?: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  selection: EmailCollaborationSelection | null;
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
  onError: (message: string) => void;
};

const GROUP_MENTION_PREFIX = "group:";

function collaborationMessageSnapshot(collaboration: CommunicationsEmailCollaboration): EmailMessage | null {
  return collaboration.latest_message ?? collaboration.message_snapshot ?? collaboration.message ?? null;
}

function collaborationMentionPrincipals(
  users: CompanyUser[],
  groups: CompanyUserGroup[],
  members: CompanyUserGroupMember[],
): MentionableCompanyUser[] {
  const memberCountByGroupID = new Map<string, number>();
  for (const member of members) {
    const groupID = member.group_id.trim();
    if (groupID) memberCountByGroupID.set(groupID, (memberCountByGroupID.get(groupID) ?? 0) + 1);
  }
  return [
    ...users,
    ...groups.map((group) => ({
      company_id: group.company_id,
      user_id: GROUP_MENTION_PREFIX + group.group_id,
      display_name: group.name,
      email: (memberCountByGroupID.get(group.group_id) ?? 0) + " members",
      role: "group",
    })),
  ];
}

function mentionedPrincipalIDs(draft: string, principals: MentionableCompanyUser[]): {
  mentionedUserIDs: string[];
  mentionedGroupIDs: string[];
} {
  const userIDs = new Set<string>();
  const groupIDs = new Set<string>();
  const aliasCounts = new Map<string, number>();
  for (const principal of principals) {
    const alias = mentionUserDisplayName(principal).trim().toLowerCase();
    if (alias) aliasCounts.set(alias, (aliasCounts.get(alias) ?? 0) + 1);
  }
  const unambiguousPrincipals = principals.filter((principal) => (
    aliasCounts.get(mentionUserDisplayName(principal).trim().toLowerCase()) === 1
  ));
  for (const segment of splitTextByMentions(draft, unambiguousPrincipals)) {
    const principalID = segment.mention ? segment.user?.user_id.trim() ?? "" : "";
    if (!principalID) continue;
    if (principalID.startsWith(GROUP_MENTION_PREFIX)) {
      const groupID = principalID.slice(GROUP_MENTION_PREFIX.length).trim();
      if (groupID) groupIDs.add(groupID);
    } else {
      userIDs.add(principalID);
    }
  }
  return { mentionedUserIDs: [...userIDs], mentionedGroupIDs: [...groupIDs] };
}

export function EmailCollaborationChatSurface({
  companyID,
  currentUserID,
  message,
  sharedInboxID,
  accountEmail,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  selection,
  onClearSelection,
  onNavigateToEmailSelection,
  onCollaborationChange,
  onError,
}: EmailCollaborationChatSurfaceProps) {
  const apiBase = readAuthConfig().apiBase;
  const requestJSON = React.useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [collaboration, setCollaboration] = React.useState<CommunicationsEmailCollaboration | null>(null);
  const [messages, setMessages] = React.useState<EditorTextBlockChatMessage[]>([]);
  const [draft, setDraft] = React.useState("");
  const [draftAttachments, setDraftAttachments] = React.useState<EditorChatAttachment[]>([]);
  const [selectedMentionPrincipals, setSelectedMentionPrincipals] = React.useState<MentionableCompanyUser[]>([]);
  const [replyTargetID, setReplyTargetID] = React.useState("");
  const [activeMessageID, setActiveMessageID] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const loadSequenceRef = React.useRef(0);
  const principals = React.useMemo(
    () => collaborationMentionPrincipals(companyUsers, companyUserGroups, companyUserGroupMembers),
    [companyUserGroupMembers, companyUserGroups, companyUsers],
  );
  const author = React.useMemo(() => {
    const user = companyUsers.find((candidate) => candidate.user_id === currentUserID);
    return {
      userID: currentUserID,
      name: user?.display_name?.trim() || user?.email?.trim() || "User",
    };
  }, [companyUsers, currentUserID]);
  const blockID = collaboration?.attached_email_information_id?.trim() ?? "";
  const nodeID = collaboration?.node_id?.trim() ?? "";
  const selectionAnchor: TextBlockSelectionAnchor | undefined = selection ? {
    blockID: blockID || "email-collaboration",
    source: "email",
    messageID: selection.messageID,
    quote: selection.quote,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  } : undefined;

  const loadProjection = React.useCallback(async (nextCollaboration: CommunicationsEmailCollaboration | null) => {
    const nextNodeID = nextCollaboration?.node_id?.trim() ?? "";
    if (!nextNodeID) {
      setMessages([]);
      return;
    }
    invalidateNodeRecordStoreCaches(apiBase, companyID, nextNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nextNodeID);
    const nextBlockID = nextCollaboration?.attached_email_information_id?.trim() ?? "";
    setMessages(parseEditorTextBlockChats(projections).filter((item) => !nextBlockID || item.blockID === nextBlockID));
  }, [apiBase, companyID]);

  React.useEffect(() => {
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    setLoading(true);
    setCollaboration(null);
    setMessages([]);
    setReplyTargetID("");
    setActiveMessageID("");
    setDraft("");
    setDraftAttachments([]);
    setSelectedMentionPrincipals([]);
    onClearSelection();
    const knownCollaborationID = message.collaboration_id?.trim() ?? "";
    const request = knownCollaborationID
      ? getEmailCollaboration(companyID, knownCollaborationID)
      : resolveEmailCollaboration({
          companyID,
          messageID: message.id,
          threadID: message.thread_id,
          sharedInboxID,
          accountEmail,
        });
    void request
      .then(async (resolved) => {
        if (loadSequenceRef.current !== requestSequence) return;
        setCollaboration(resolved);
        if (resolved) {
          onCollaborationChange?.(resolved);
          await loadProjection(resolved);
        }
      })
      .catch((cause) => {
        if (loadSequenceRef.current === requestSequence) {
          onError(cause instanceof Error ? cause.message : "failed_to_load_email_collaboration");
        }
      })
      .finally(() => {
        if (loadSequenceRef.current === requestSequence) setLoading(false);
      });
  }, [accountEmail, companyID, loadProjection, message.collaboration_id, message.id, message.thread_id, onClearSelection, onCollaborationChange, onError, sharedInboxID]);

  React.useEffect(() => {
    if (!companyID || !nodeID) return undefined;
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadProjection(collaboration).catch((cause) => {
          onError(cause instanceof Error ? cause.message : "failed_to_refresh_email_chat");
        });
      }, 80);
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, "chat:node:" + nodeID, {
      onAccepted: refresh,
      onChatMessageCreated(event) {
        if (event.company_id === companyID && event.node_id === nodeID) refresh();
      },
      onChatMessageDeleted(event) {
        if (event.company_id === companyID && event.node_id === nodeID) refresh();
      },
    });
    return () => {
      unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [apiBase, collaboration, companyID, loadProjection, nodeID, onError]);

  const ensureCollaboration = React.useCallback(async (): Promise<CommunicationsEmailCollaboration> => {
    if (collaboration) return collaboration;
    const created = await ensureEmailCollaboration({
      companyID,
      message,
      messageID: message.id,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
    });
    setCollaboration(created);
    onCollaborationChange?.(created);
    return created;
  }, [accountEmail, collaboration, companyID, message, onCollaborationChange, sharedInboxID]);

  const changeDraft = React.useCallback((nextDraft: string) => {
    setDraft(nextDraft);
    setSelectedMentionPrincipals((current) => current.filter((principal) => (
      nextDraft.includes("@" + mentionUserDisplayName(principal))
    )));
  }, []);

  const rememberMentionPrincipal = React.useCallback((principal: MentionableCompanyUser) => {
    setSelectedMentionPrincipals((current) => current.some((candidate) => candidate.user_id === principal.user_id)
      ? current
      : [...current, principal]);
  }, []);

  const submit = React.useCallback(async () => {
    const cleanDraft = draft.trim();
    if (!cleanDraft && draftAttachments.length === 0) return;
    let collaborationForRefresh = collaboration;
    let optimisticInformationID = "";
    try {
      const activeCollaboration = await ensureCollaboration();
      collaborationForRefresh = activeCollaboration;
      const activeNodeID = activeCollaboration.node_id.trim();
      const activeBlockID = activeCollaboration.attached_email_information_id.trim();
      if (!activeNodeID || !activeBlockID) throw new Error("email_collaboration_node_missing");
      const informationID = generateStableInformationID();
      optimisticInformationID = informationID;
      const createdTimestamp = new Date().toISOString();
      const mentions = mentionedPrincipalIDs(cleanDraft, principals);
      for (const principal of selectedMentionPrincipals) {
        const principalID = principal.user_id.trim();
        if (principalID.startsWith(GROUP_MENTION_PREFIX)) {
          const groupID = principalID.slice(GROUP_MENTION_PREFIX.length).trim();
          if (groupID && !mentions.mentionedGroupIDs.includes(groupID)) mentions.mentionedGroupIDs.push(groupID);
        } else if (principalID && !mentions.mentionedUserIDs.includes(principalID)) {
          mentions.mentionedUserIDs.push(principalID);
        }
      }
      const nextMessage: EditorTextBlockChatMessage = {
        id: informationID,
        blockID: activeBlockID,
        parentID: replyTargetID || undefined,
        selectionSource: !replyTargetID && selection ? "email" : undefined,
        selectionMessageID: !replyTargetID ? selection?.messageID : undefined,
        selectionQuote: !replyTargetID ? selection?.quote : undefined,
        selectionStart: !replyTargetID ? selection?.startOffset : undefined,
        selectionEnd: !replyTargetID ? selection?.endOffset : undefined,
        authorID: author.userID,
        authorName: author.name,
        message: cleanDraft,
        createdTimestamp,
        attachments: draftAttachments,
        mentionedUserIDs: mentions.mentionedUserIDs,
        mentionedGroupIDs: mentions.mentionedGroupIDs,
      };
      setMessages((current) => [...current, nextMessage]);
      await requestJSON("/v1/nodes/" + encodeURIComponent(activeNodeID) + "/information", {
        method: "POST",
        json: {
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          information_id: informationID,
          information: buildEditorTextBlockChatPayload({
            blockID: activeBlockID,
            parentID: replyTargetID,
            selectionSource: !replyTargetID && selection ? "email" : undefined,
            selectionMessageID: !replyTargetID ? selection?.messageID : undefined,
            selectionQuote: !replyTargetID ? selection?.quote : undefined,
            selectionStart: !replyTargetID ? selection?.startOffset : undefined,
            selectionEnd: !replyTargetID ? selection?.endOffset : undefined,
            authorID: author.userID,
            authorName: author.name,
            message: cleanDraft,
            createdTimestamp,
            attachments: draftAttachments,
            mentionedUserIDs: mentions.mentionedUserIDs,
            mentionedGroupIDs: mentions.mentionedGroupIDs,
          }),
        },
      });
      await loadProjection(activeCollaboration);
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setReplyTargetID("");
      onClearSelection();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_save_email_chat");
      if (collaborationForRefresh) void loadProjection(collaborationForRefresh);
      else if (optimisticInformationID) setMessages((current) => current.filter((item) => item.id !== optimisticInformationID));
    }
  }, [author.name, author.userID, collaboration, companyID, draft, draftAttachments, ensureCollaboration, loadProjection, onClearSelection, onError, principals, replyTargetID, requestJSON, selectedMentionPrincipals, selection]);

  const attachFiles = React.useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    try {
      const activeCollaboration = await ensureCollaboration();
      const uploaded = await Promise.all(candidates.map((file) => uploadEditorAttachment(file, {
        requestJSON,
        companyID,
        resourceType: "node",
        resourceID: activeCollaboration.node_id,
        sourceKind: "chat_upload",
        relationshipKind: "chat_attachment",
        informationID: activeCollaboration.attached_email_information_id,
        editorSurface: "email_collaboration_chat",
      })));
      setDraftAttachments((current) => [...current, ...uploaded]);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_upload_chat_attachment");
    }
  }, [companyID, ensureCollaboration, onError, requestJSON]);

  const deleteMessage = React.useCallback(async (messageID: string) => {
    const target = messages.find((item) => item.id === messageID);
    if (!target || !nodeID || !canDeleteEditorTextBlockChatMessage(target, currentUserID)) return;
    setMessages((current) => current.filter((item) => item.id !== messageID));
    try {
      await requestJSON(
        "/v1/nodes/" + encodeURIComponent(nodeID) + "/projection/" + encodeURIComponent(messageID)
          + "?company_id=" + encodeURIComponent(companyID),
        { method: "DELETE" },
      );
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_email_chat");
      void loadProjection(collaboration);
    }
  }, [collaboration, companyID, currentUserID, loadProjection, messages, nodeID, onError, requestJSON]);

  const navigateToChatMessage = React.useCallback((chatMessageID: string) => {
    setActiveMessageID(chatMessageID);
    const target = messages.find((item) => item.id === chatMessageID);
    const messageID = target?.selectionMessageID?.trim() ?? "";
    const quote = target?.selectionQuote?.trim() ?? "";
    const startOffset = Math.max(0, target?.selectionStart ?? 0);
    const endOffset = Math.max(startOffset, target?.selectionEnd ?? 0);
    if (target?.selectionSource === "email" && messageID && quote && endOffset > startOffset) {
      onNavigateToEmailSelection({ messageID, quote, startOffset, endOffset });
    }
  }, [messages, onNavigateToEmailSelection]);

  const snapshot = collaboration ? collaborationMessageSnapshot(collaboration) : null;
  return (
    <aside
      aria-label="Email collaboration chat"
      style={{ minWidth: 0, minHeight: 0, display: "grid", alignContent: "start", gap: 6, padding: "8px 8px 8px 0", overflowY: "auto", background: EDITOR_NEU_SURFACE }}
    >
      {loading && <div style={{ color: "rgba(100,116,139,0.78)", fontSize: 11, fontWeight: 800, padding: "4px 8px" }}>Loading chat</div>}
      {!loading && !collaboration && (
        <div style={{ color: "rgba(100,116,139,0.78)", fontSize: 10.5, fontWeight: 750, padding: "1px 8px" }}>
          The email stays unchanged until the first comment, mention, attachment, or shared draft.
        </div>
      )}
      {snapshot?.subject && snapshot.subject !== message.subject && (
        <div style={{ color: "rgba(100,116,139,0.72)", fontSize: 10, padding: "0 8px" }}>Thread: {snapshot.subject}</div>
      )}
      <ChatPane
        blockID={blockID || "email-collaboration"}
        editable
        apiBase={apiBase}
        companyID={companyID}
        messages={messages}
        selectionAnchor={selectionAnchor}
        draft={draft}
        companyUsers={principals}
        draftAttachments={draftAttachments}
        replyTargetID={replyTargetID}
        heightStorageKey={"mangorts.email-collaboration-chat-height:" + companyID}
        active
        currentUserID={currentUserID}
        activeMessageID={activeMessageID}
        accent="#f97316"
        surfaceText="#111827"
        panelBackground={EDITOR_NEU_SURFACE}
        strokeColor="rgba(148,163,184,0.34)"
        ruleColor="rgba(148,163,184,0.28)"
        onFocus={() => undefined}
        onDraftChange={changeDraft}
        onMentionPrincipal={rememberMentionPrincipal}
        onActivateMessage={setActiveMessageID}
        onNavigateToMessage={navigateToChatMessage}
        onReply={setReplyTargetID}
        onDeleteMessage={(messageID) => { void deleteMessage(messageID); }}
        onClearReply={() => setReplyTargetID("")}
        onClearSelectionAnchor={onClearSelection}
        onAttachFiles={(files) => { void attachFiles(files); }}
        onRemoveDraftAttachment={(attachmentID) => setDraftAttachments((current) => current.filter((item) => item.id !== attachmentID))}
        onSubmit={() => { void submit(); }}
      />
    </aside>
  );
}

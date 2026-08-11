import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON, isAbortError } from "../../modules/api/requestJSON";
import {
  ensureEmailCollaboration,
  listEmailThreadChatGroups,
  type CommunicationsEmailCollaboration,
  type CommunicationsEmailThreadChatGroup,
  type CompanyUser,
  type CompanyUserGroup,
  type CompanyUserGroupMember,
  type EmailMessage,
} from "../../modules/communications/communicationsApi";
import { mentionUserDisplayName, splitTextByMentions, type MentionableCompanyUser } from "../../modules/editor/editorMentions";
import {
  buildEditorTextBlockChatPayload,
  buildEditorTextBlockProjectionPayload,
  canDeleteEditorTextBlockChatMessage,
  canEditEditorTextBlockChatMessage,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
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
import { nextNodeTextBlockColor } from "../../modules/editor/nodeTextBlockCreation";
import { invalidateNodeRecordStoreCaches } from "../../modules/nodes/nodeRecordStore";
import type { NodeRecord } from "../../modules/nodes/types";
import { assignNodeToLogicGateStatus } from "../../modules/kanban/kanbanApi";
import { upsertProjectRelationship } from "../../modules/project-management/projectManagementApi";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import {
  emailNodeImportRequired,
  formatEmailCollaborationChatError,
  type EmailCollaborationActionRequest,
} from "./emailCollaborationChat";
import type { EmailNodeAttachmentChange } from "./emailCollaborationRows";

export type EmailCollaborationSelection = {
  messageID: string;
  quote: string;
  startOffset: number;
  endOffset: number;
};

type EmailCollaborationChatSurfaceProps = {
  active: boolean;
  id?: string;
  companyID: string;
  currentUserID: string;
  message: EmailMessage;
  targetMessage?: EmailMessage;
  sharedInboxID?: string;
  accountEmail?: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  nodes: NodeRecord[];
  actionRequest: EmailCollaborationActionRequest;
  selection: EmailCollaborationSelection | null;
  topOffset?: number;
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
  onNodeAttachmentChange?: (attachment: EmailNodeAttachmentChange) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  onActionSuccess: (message: string, delayedCollaboration?: CommunicationsEmailCollaboration) => void;
  onActionRequestHandled: () => void;
  onExistingChatsChange?: (hasChats: boolean) => void;
  onOpenNode?: (nodeID: string) => void;
};

const GROUP_MENTION_PREFIX = "group:";
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
  active,
  id,
  companyID,
  currentUserID,
  message,
  targetMessage,
  sharedInboxID,
  accountEmail,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  nodes,
  actionRequest,
  selection,
  topOffset = 0,
  onClearSelection,
  onNavigateToEmailSelection,
  onCollaborationChange,
  onNodeAttachmentChange,
  onError,
  onSuccess,
  onActionSuccess,
  onActionRequestHandled,
  onExistingChatsChange,
  onOpenNode,
}: EmailCollaborationChatSurfaceProps) {
  const apiBase = readAuthConfig().apiBase;
  const requestJSON = React.useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [collaboration, setCollaboration] = React.useState<CommunicationsEmailCollaboration | null>(null);
  const [collaborations, setCollaborations] = React.useState<CommunicationsEmailCollaboration[]>([]);
  const [messages, setMessages] = React.useState<EditorTextBlockChatMessage[]>([]);
  const [nodeIDByChatID, setNodeIDByChatID] = React.useState<Record<string, string>>({});
  const [activeTextBlockID, setActiveTextBlockID] = React.useState("");
  const [sectionLabelsByBlockID, setSectionLabelsByBlockID] = React.useState<Record<string, string>>({});
  const [sectionKeysByChatID, setSectionKeysByChatID] = React.useState<Record<string, string>>({});
  const [sectionNodeIDsByBlockID, setSectionNodeIDsByBlockID] = React.useState<Record<string, string>>({});
  const [threadChatNodeIDs, setThreadChatNodeIDs] = React.useState<string[]>([]);
  const [threadChatGroups, setThreadChatGroups] = React.useState<CommunicationsEmailThreadChatGroup[]>([]);
  const [draft, setDraft] = React.useState("");
  const [draftAttachments, setDraftAttachments] = React.useState<EditorChatAttachment[]>([]);
  const [selectedMentionPrincipals, setSelectedMentionPrincipals] = React.useState<MentionableCompanyUser[]>([]);
  const [replyTargetID, setReplyTargetID] = React.useState("");
  const [activeMessageID, setActiveMessageID] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const loadSequenceRef = React.useRef(0);
  const collaborationRef = React.useRef<CommunicationsEmailCollaboration | null>(null);
  const collaborationsRef = React.useRef<CommunicationsEmailCollaboration[]>([]);
  const sectionKeysByChatIDRef = React.useRef<Record<string, string>>({});
  const selectionInternalEmailMessageIDRef = React.useRef("");
  const sourceLoadKeyRef = React.useRef("");
  const handledDestinationRequestRef = React.useRef<NonNullable<EmailCollaborationActionRequest> | null>(null);
  const pendingNewNodeIDRef = React.useRef("");
  const locallySubmittedChatIDsRef = React.useRef<Set<string>>(new Set());
  const selectionChoiceKeyRef = React.useRef("");
  const enabled = Boolean(message.id.trim());
  const targetEmailMessageID = selection?.messageID?.trim() || message.id.trim();
  const collaborationTargetMessage = targetMessage?.id.trim() === targetEmailMessageID ? targetMessage : message;
  const sourceKey = React.useMemo(
    () => JSON.stringify([companyID, sharedInboxID?.trim() ?? "", accountEmail?.trim().toLowerCase() ?? "", message.id.trim(), message.thread_id?.trim() ?? ""]),
    [accountEmail, companyID, message.id, message.thread_id, sharedInboxID],
  );
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
  const blockID = activeTextBlockID;
  const nodeID = collaboration?.node_id?.trim() ?? "";
  const selectionAnchor: TextBlockSelectionAnchor | undefined = selection ? {
    blockID: blockID || "email-collaboration",
    source: "email",
    messageID: selection.messageID,
    quote: selection.quote,
    startOffset: selection.startOffset,
    endOffset: selection.endOffset,
  } : undefined;

  const applyThreadChatGroups = React.useCallback((
    groups: CommunicationsEmailThreadChatGroup[],
    destinations: CommunicationsEmailCollaboration[],
    activeDestination: CommunicationsEmailCollaboration | null,
  ) => {
    const orderedGroups = [...groups].sort((left, right) => (
      left.message_order - right.message_order
      || left.node_name.localeCompare(right.node_name)
      || left.textbox_id.localeCompare(right.textbox_id)
    ));
    collaborationsRef.current = destinations;
    setCollaborations(destinations);
    const blockLabels: Record<string, string> = {};
    const blockNodeIDs: Record<string, string> = {};
    const chatNodes: Record<string, string> = {};
    const chatSectionKeys: Record<string, string> = {};
    const allChats: EditorTextBlockChatMessage[] = [];
    let activeBlockID = "";
    for (const group of orderedGroups) {
      const sectionKey = `${group.node_id}:${group.textbox_id}`;
      blockLabels[sectionKey] = group.node_name.trim() || "Node " + group.node_id.slice(0, 8);
      blockNodeIDs[sectionKey] = group.node_id;
      if (group.provider_message_id === targetEmailMessageID) {
        selectionInternalEmailMessageIDRef.current = group.email_message_id;
        if (!activeBlockID && (!activeDestination || activeDestination.node_id === group.node_id)) {
          activeBlockID = group.textbox_id;
        }
      }
      for (const chat of parseEditorTextBlockChats(group.chats)) {
        if (chatNodes[chat.id]) continue;
        chatNodes[chat.id] = group.node_id;
        chatSectionKeys[chat.id] = sectionKey;
        allChats.push(chat);
      }
    }
    setMessages(allChats);
    setNodeIDByChatID(chatNodes);
    setSectionLabelsByBlockID(blockLabels);
    setSectionNodeIDsByBlockID(blockNodeIDs);
    setSectionKeysByChatID(chatSectionKeys);
    sectionKeysByChatIDRef.current = chatSectionKeys;
    setThreadChatNodeIDs([...new Set(orderedGroups.map((group) => group.node_id))]);
    setThreadChatGroups(orderedGroups);
    setActiveTextBlockID(activeBlockID);
    onExistingChatsChange?.(allChats.length > 0);
    return destinations;
  }, [onExistingChatsChange, targetEmailMessageID]);

  const loadThreadChats = React.useCallback(async (
    activeDestination: CommunicationsEmailCollaboration | null,
    expectedLoadSequence?: number,
  ) => {
    const result = await listEmailThreadChatGroups({
      companyID,
      messageID: message.id,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
    });
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return;
    applyThreadChatGroups(result.groups, result.collaborations, activeDestination);
  }, [accountEmail, applyThreadChatGroups, companyID, message.id, message.thread_id, sharedInboxID]);

  const acceptCollaboration = React.useCallback((nextCollaboration: CommunicationsEmailCollaboration | null, publishToMailbox = true) => {
    collaborationRef.current = nextCollaboration;
    setCollaboration(nextCollaboration);
    if (nextCollaboration) {
      setCollaborations((current) => {
        const next = current.some((item) => item.collaboration_id === nextCollaboration.collaboration_id)
          ? current.map((item) => item.collaboration_id === nextCollaboration.collaboration_id ? nextCollaboration : item)
          : [...current, nextCollaboration];
        collaborationsRef.current = next;
        return next;
      });
    }
    if (nextCollaboration && publishToMailbox) onCollaborationChange?.(nextCollaboration);
  }, [onCollaborationChange]);

  const realtimeErrorRef = React.useRef(onError);
  realtimeErrorRef.current = onError;

  React.useEffect(() => {
    const previousSourceKey = sourceLoadKeyRef.current;
    const sourceChanged = previousSourceKey !== sourceKey;
    sourceLoadKeyRef.current = sourceKey;
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    if (sourceChanged) {
      collaborationRef.current = null;
      selectionInternalEmailMessageIDRef.current = "";
      pendingNewNodeIDRef.current = "";
      selectionChoiceKeyRef.current = "";
      setCollaboration(null);
      collaborationsRef.current = [];
      setCollaborations([]);
      setMessages([]);
      setNodeIDByChatID({});
      setSectionLabelsByBlockID({});
      setSectionNodeIDsByBlockID({});
      setSectionKeysByChatID({});
      sectionKeysByChatIDRef.current = {};
      setThreadChatNodeIDs([]);
      setThreadChatGroups([]);
      setReplyTargetID("");
      setActiveTextBlockID("");
      setActiveMessageID("");
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setSubmitting(false);
      if (previousSourceKey) onClearSelection();
    }
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    void listEmailThreadChatGroups({
      companyID,
      messageID: message.id,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
    })
      .then((result) => {
		if (loadSequenceRef.current !== requestSequence) return;
		const items = applyThreadChatGroups(result.groups, result.collaborations, null);
		const nextCollaboration = items.length === 1 ? items[0] : null;
		acceptCollaboration(nextCollaboration, false);
		if (nextCollaboration) applyThreadChatGroups(result.groups, result.collaborations, nextCollaboration);
        if (loadSequenceRef.current === requestSequence) onSuccess();
      })
      .catch((cause) => {
        if (isAbortError(cause)) return;
        if (loadSequenceRef.current === requestSequence) {
          onError(formatEmailCollaborationChatError(cause, "Failed to load email chat."));
        }
      })
      .finally(() => {
        if (loadSequenceRef.current === requestSequence) setLoading(false);
      });
    return () => {
      if (loadSequenceRef.current === requestSequence) loadSequenceRef.current += 1;
    };
  }, [acceptCollaboration, accountEmail, applyThreadChatGroups, companyID, enabled, message.id, message.thread_id, onClearSelection, onError, onSuccess, sharedInboxID, sourceKey]);

  React.useEffect(() => {
    if (!active || !companyID || threadChatNodeIDs.length === 0) return undefined;
    let refreshTimer: number | null = null;
    const acceptedNodeIDs = new Set<string>();
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const refreshSequence = loadSequenceRef.current;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void loadThreadChats(collaborationRef.current, refreshSequence).catch((cause) => {
          if (loadSequenceRef.current !== refreshSequence || isAbortError(cause)) return;
          realtimeErrorRef.current(formatEmailCollaborationChatError(cause, "Failed to refresh email chat."));
        });
      }, 80);
    };
    const visibleNodeIDs = new Set(threadChatNodeIDs);
    const unsubscribes = threadChatNodeIDs.map((visibleNodeID) => subscribeRealtimeScope(apiBase, companyID, "chat:node:" + visibleNodeID, {
      onAccepted: () => {
        if (acceptedNodeIDs.has(visibleNodeID)) refresh();
        acceptedNodeIDs.add(visibleNodeID);
      },
      onChatMessageCreated(event) {
        if (event.company_id !== companyID || !visibleNodeIDs.has(event.node_id)) return;
        if (locallySubmittedChatIDsRef.current.delete(event.message_id)) return;
        refresh();
      },
      onChatMessageUpdated(event) {
        if (event.company_id === companyID && visibleNodeIDs.has(event.node_id)) refresh();
      },
      onChatMessageDeleted(event) {
        if (event.company_id === companyID && visibleNodeIDs.has(event.node_id)) refresh();
      },
    }));
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [active, apiBase, companyID, loadThreadChats, threadChatNodeIDs]);

  const ensureCollaboration = React.useCallback(async (priority?: number, createNew = false, publishToMailbox = true): Promise<CommunicationsEmailCollaboration> => {
    if (collaboration && !createNew) return collaboration;
    if (!pendingNewNodeIDRef.current) {
      pendingNewNodeIDRef.current = generateStableInformationID();
    }
    const newNodeID = pendingNewNodeIDRef.current;
    const created = await ensureEmailCollaboration({
      companyID,
      message: collaborationTargetMessage,
      messageID: targetEmailMessageID,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
      newNodeID,
      priority,
    });
    acceptCollaboration(created, publishToMailbox);
    pendingNewNodeIDRef.current = "";
    return created;
  }, [acceptCollaboration, accountEmail, collaboration, collaborationTargetMessage, companyID, message.thread_id, sharedInboxID, targetEmailMessageID]);

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

  const buildPendingChat = React.useCallback((textBlockID: string, emailMessageID: string, chatID = generateStableInformationID()) => {
    const cleanDraft = draft.trim();
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
    const information = buildEditorTextBlockChatPayload({
      blockID: textBlockID,
      parentID: replyTargetID || undefined,
      selectionSource: "email",
      selectionMessageID: emailMessageID,
      selectionQuote: selection?.quote,
      selectionStart: selection?.startOffset,
      selectionEnd: selection?.endOffset,
      authorID: author.userID,
      authorName: author.name,
      message: cleanDraft,
      createdTimestamp: new Date().toISOString(),
      attachments: draftAttachments,
      mentionedUserIDs: mentions.mentionedUserIDs,
      mentionedGroupIDs: mentions.mentionedGroupIDs,
    });
    const chat = parseEditorTextBlockChats([{
      information_id: chatID,
      type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
      information,
    }])[0];
    if (!chat) throw new Error("failed_to_build_email_chat");
    return {
      chat,
      write: { type: EDITOR_TEXT_BLOCK_CHAT_TYPE, informationID: chatID, information },
    };
  }, [author.name, author.userID, draft, draftAttachments, principals, replyTargetID, selectedMentionPrincipals, selection]);

  const showPendingChat = React.useCallback((chat: EditorTextBlockChatMessage, targetNodeID: string, textBlockID: string, nodeTitle: string) => {
    const sectionKey = `${targetNodeID}:${textBlockID}`;
    locallySubmittedChatIDsRef.current.add(chat.id);
    setMessages((current) => {
      if (current.some((item) => item.id === chat.id)) return current;
      let insertionIndex = -1;
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (sectionKeysByChatIDRef.current[current[index].id] === sectionKey) {
          insertionIndex = index + 1;
          break;
        }
      }
      if (insertionIndex < 0) return [...current, chat];
      const next = [...current];
      next.splice(insertionIndex, 0, chat);
      return next;
    });
    setNodeIDByChatID((current) => ({ ...current, [chat.id]: targetNodeID }));
    sectionKeysByChatIDRef.current = { ...sectionKeysByChatIDRef.current, [chat.id]: sectionKey };
    setSectionKeysByChatID(sectionKeysByChatIDRef.current);
    setSectionLabelsByBlockID((current) => ({ ...current, [sectionKey]: nodeTitle }));
    setSectionNodeIDsByBlockID((current) => ({ ...current, [sectionKey]: targetNodeID }));
    setActiveTextBlockID(textBlockID);
    setActiveMessageID(chat.id);
    setDraft("");
    setDraftAttachments([]);
    setSelectedMentionPrincipals([]);
    setReplyTargetID("");
  }, []);

  const rollBackPendingChat = React.useCallback((chatID: string) => {
    locallySubmittedChatIDsRef.current.delete(chatID);
    setMessages((current) => current.filter((item) => item.id !== chatID));
    setNodeIDByChatID((current) => {
      const next = { ...current };
      delete next[chatID];
      return next;
    });
    setSectionKeysByChatID((current) => {
      const next = { ...current };
      delete next[chatID];
      sectionKeysByChatIDRef.current = next;
      return next;
    });
    setActiveMessageID((current) => current === chatID ? "" : current);
  }, []);

  const expireLocalChatEchoSuppression = React.useCallback((chatID: string) => {
    window.setTimeout(() => locallySubmittedChatIDsRef.current.delete(chatID), 30_000);
  }, []);

  const submitExistingTextBoxChat = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration, textBlockID: string) => {
    const targetNodeID = activeCollaboration.node_id.trim();
    const activeGroup = threadChatGroups.find((group) => group.node_id === targetNodeID && group.textbox_id === textBlockID);
    const targetsGroupMessage = activeGroup?.provider_message_id === targetEmailMessageID;
    const emailMessageID = (targetsGroupMessage ? activeGroup?.email_message_id?.trim() : "")
      || collaborationTargetMessage.email_message_id?.trim()
      || (activeCollaboration.message?.id?.trim() === targetEmailMessageID ? activeCollaboration.root_message_id?.trim() : "")
      || selectionInternalEmailMessageIDRef.current
      || generateStableInformationID();
    if (!targetNodeID || !textBlockID || !emailMessageID || submitting) return;
    const originalDraft = draft;
    const originalAttachments = draftAttachments;
    const originalPrincipals = selectedMentionPrincipals;
    const originalReplyTargetID = replyTargetID;
    const pending = buildPendingChat(textBlockID, emailMessageID);
    const nodeTitle = nodes.find((node) => node.node_id === targetNodeID)?.name?.trim()
      || "Node " + targetNodeID.slice(0, 8);
    showPendingChat(pending.chat, targetNodeID, textBlockID, nodeTitle);
    setSubmitting(true);
    try {
      let acknowledgedEmailMessageID = emailMessageID;
      if (targetsGroupMessage) {
        await requestJSON<unknown>(`/v1/nodes/${encodeURIComponent(targetNodeID)}/information`, {
          method: "POST",
          body: JSON.stringify({
            company_id: companyID,
            type: pending.write.type,
            information: pending.write.information,
            information_id: pending.write.informationID,
          }),
        });
      } else {
        const ensured = await ensureEmailCollaboration({
          companyID,
          message: collaborationTargetMessage,
          messageID: targetEmailMessageID,
          threadID: collaborationTargetMessage.thread_id || activeCollaboration.provider_thread_id,
          sharedInboxID,
          accountEmail,
          targetNodeID,
          targetTextBoxID: textBlockID,
          initialChat: pending.write,
        });
        acceptCollaboration(ensured, false);
        acknowledgedEmailMessageID = ensured.root_message_id?.trim()
          || ensured.message?.email_message_id?.trim()
          || acknowledgedEmailMessageID;
        selectionInternalEmailMessageIDRef.current = acknowledgedEmailMessageID;
        setMessages((current) => current.map((item) => item.id === pending.chat.id
          ? { ...item, selectionMessageID: acknowledgedEmailMessageID }
          : item));
      }
      expireLocalChatEchoSuppression(pending.chat.id);
      invalidateNodeRecordStoreCaches(apiBase, companyID, targetNodeID);
      onClearSelection();
      onSuccess();
    } catch (cause) {
      rollBackPendingChat(pending.chat.id);
      setDraft(originalDraft);
      setDraftAttachments(originalAttachments);
      setSelectedMentionPrincipals(originalPrincipals);
      setReplyTargetID(originalReplyTargetID);
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is ready to retry."));
    } finally {
      setSubmitting(false);
    }
  }, [acceptCollaboration, accountEmail, apiBase, buildPendingChat, collaborationTargetMessage, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, nodes, onClearSelection, onError, onSuccess, replyTargetID, requestJSON, rollBackPendingChat, selectedMentionPrincipals, sharedInboxID, showPendingChat, submitting, targetEmailMessageID, threadChatGroups]);

  const importIntoExistingNode = React.useCallback(async (targetNodeID: string, includeChat: boolean) => {
    const cleanNodeID = targetNodeID.trim();
    if (!cleanNodeID || submitting) return;
    const cleanDraft = draft.trim();
    const originalAttachments = draftAttachments;
    const originalPrincipals = selectedMentionPrincipals;
    const originalReplyTargetID = replyTargetID;
    let pendingChat: ReturnType<typeof buildPendingChat> | null = null;
    setSubmitting(true);
    try {
      const providerMessageID = selection?.messageID?.trim() || message.id.trim();
      const existingGroup = threadChatGroups.find((group) => (
        group.node_id === cleanNodeID && group.provider_message_id === providerMessageID
      ));
      let emailMessageID = (collaborationTargetMessage.id.trim() === providerMessageID
        ? collaborationTargetMessage.email_message_id?.trim()
        : "")
        || (message.id.trim() === providerMessageID ? message.email_message_id?.trim() : "")
        || (collaboration?.message?.id?.trim() === providerMessageID ? collaboration.root_message_id?.trim() : "")
        || existingGroup?.email_message_id
        || "";
      const currentNodeCollaboration = collaborations.find((item) => item.node_id === cleanNodeID);
      const shouldAttachEmail = !existingGroup && emailNodeImportRequired(cleanNodeID, currentNodeCollaboration?.node_id ?? "", emailMessageID);
      const subject = message.subject?.trim() || "Email";
      let attachedEmailInformationID = collaboration?.attached_email_information_id?.trim() ?? "";
      const color = nextNodeTextBlockColor([]);
      const textBlockID = existingGroup?.textbox_id ?? generateStableInformationID();
      const payloadEmailMessageID = emailMessageID || generateStableInformationID();
      const textBlockWrite = existingGroup ? undefined : {
        type: EDITOR_TEXT_BLOCK_TYPE,
        informationID: textBlockID,
        information: buildEditorTextBlockProjectionPayload({
          title: "Email: " + subject,
          document: "",
          attachments: [],
          emailMessageID: payloadEmailMessageID,
          color,
        }),
      };
      let initialChatWrite: { type: string; informationID: string; information: string } | undefined;
      let initialChat: EditorTextBlockChatMessage | undefined;
      if (includeChat && (cleanDraft || draftAttachments.length > 0)) {
        pendingChat = buildPendingChat(textBlockID, payloadEmailMessageID);
        initialChatWrite = pendingChat.write;
        initialChat = pendingChat.chat;
        const nodeTitle = nodes.find((node) => node.node_id === cleanNodeID)?.name?.trim()
          || "Node " + cleanNodeID.slice(0, 8);
        showPendingChat(initialChat, cleanNodeID, textBlockID, nodeTitle);
      }
      if (shouldAttachEmail || textBlockWrite || initialChatWrite) {
        const ensured = await ensureEmailCollaboration({
          companyID,
          message: collaborationTargetMessage,
          messageID: providerMessageID,
          threadID: message.thread_id,
          sharedInboxID,
          accountEmail,
          targetNodeID: cleanNodeID,
          linkedTextBlock: textBlockWrite,
          initialChat: initialChatWrite,
        });
        acceptCollaboration(ensured);
        attachedEmailInformationID = ensured.attached_email_information_id?.trim() || attachedEmailInformationID;
        emailMessageID = ensured.root_message_id?.trim() || ensured.message?.email_message_id?.trim() || emailMessageID;
      }
      if (!emailMessageID) throw new Error("email_message_id_missing");
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      if (initialChat) {
        const acknowledgedChat = { ...initialChat, selectionMessageID: emailMessageID };
        setMessages((current) => current.map((item) => item.id === acknowledgedChat.id ? acknowledgedChat : item));
        expireLocalChatEchoSuppression(acknowledgedChat.id);
      }
      onNodeAttachmentChange?.({
        nodeID: cleanNodeID,
        messageID: providerMessageID,
        threadID: message.thread_id,
        informationID: attachedEmailInformationID,
        logicGateIDs: nodes.find((node) => node.node_id === cleanNodeID)?.logic_gate_ids,
      });
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      if (!initialChat) {
        setDraft("");
        setDraftAttachments([]);
        setSelectedMentionPrincipals([]);
        setReplyTargetID("");
      }
      onClearSelection();
      onSuccess();
      if (!includeChat) onActionSuccess("Email was added to node.");
      onActionRequestHandled();
    } catch (cause) {
      if (pendingChat) {
        rollBackPendingChat(pendingChat.chat.id);
        setDraft(cleanDraft);
        setDraftAttachments(originalAttachments);
        setSelectedMentionPrincipals(originalPrincipals);
        setReplyTargetID(originalReplyTargetID);
      }
      onError(formatEmailCollaborationChatError(cause, includeChat ? "Failed to save email chat. Your message is ready to retry." : "Failed to import this email into the node."));
      onActionRequestHandled();
    } finally {
      setSubmitting(false);
    }
  }, [acceptCollaboration, accountEmail, apiBase, buildPendingChat, collaboration?.attached_email_information_id, collaborationTargetMessage, collaborations, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, message.id, message.subject, message.thread_id, nodes, onActionRequestHandled, onActionSuccess, onClearSelection, onError, onNodeAttachmentChange, onSuccess, replyTargetID, rollBackPendingChat, selectedMentionPrincipals, selection?.messageID, sharedInboxID, showPendingChat, submitting, threadChatGroups]);

  const ensureLinkedEmailTextBlock = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration): Promise<string> => {
    const activeNodeID = activeCollaboration.node_id.trim();
    const providerMessageID = selection?.messageID?.trim() || message.id.trim();
    let emailMessageID = (collaborationTargetMessage.id.trim() === providerMessageID
      ? collaborationTargetMessage.email_message_id?.trim()
      : "")
      || (message.id.trim() === providerMessageID ? message.email_message_id?.trim() : "")
      || (activeCollaboration.message?.id?.trim() === providerMessageID ? activeCollaboration.root_message_id?.trim() : "")
      || "";
    if (!activeNodeID || !providerMessageID) throw new Error("email_collaboration_node_missing");
    const existingGroup = threadChatGroups.find((group) => (
      group.node_id === activeNodeID && group.provider_message_id === providerMessageID
    ));
    if (existingGroup) {
      emailMessageID = existingGroup.email_message_id;
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      setActiveTextBlockID(existingGroup.textbox_id);
      return existingGroup.textbox_id;
    }

    const textBlockID = generateStableInformationID();
    const payloadEmailMessageID = emailMessageID || generateStableInformationID();
    const color = nextNodeTextBlockColor([]);
    const linkedTextBlock = {
      type: EDITOR_TEXT_BLOCK_TYPE,
      informationID: textBlockID,
      information: buildEditorTextBlockProjectionPayload({
        title: "Email: " + (message.subject?.trim() || "Email"),
        document: "",
        attachments: [],
        emailMessageID: payloadEmailMessageID,
        color,
      }),
    };
    const ensured = await ensureEmailCollaboration({
      companyID,
      message: collaborationTargetMessage,
      messageID: providerMessageID,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
      targetNodeID: activeNodeID,
      linkedTextBlock,
    });
    acceptCollaboration(ensured);
    emailMessageID = ensured.root_message_id?.trim() || ensured.message?.email_message_id?.trim() || emailMessageID;
    if (!emailMessageID) throw new Error("email_message_id_missing");
    selectionInternalEmailMessageIDRef.current = emailMessageID;
    invalidateNodeRecordStoreCaches(apiBase, companyID, activeNodeID);
    setActiveTextBlockID(textBlockID);
    return textBlockID;
  }, [acceptCollaboration, accountEmail, apiBase, collaborationTargetMessage, companyID, message, selection?.messageID, sharedInboxID, threadChatGroups]);
  const createEmailNode = React.useCallback(async (priority?: number, logicGateID = "", projectID = "", createNew = false) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const cleanLogicGateID = logicGateID.trim();
      const cleanProjectID = projectID.trim();
      if (cleanProjectID && !cleanLogicGateID) throw new Error("A Project email Node must belong to a Logic Gate.");
      const delayFloatingNodeIndicator = createNew;
      const created = await ensureCollaboration(priority, createNew, !delayFloatingNodeIndicator);
      if (cleanLogicGateID) {
        await assignNodeToLogicGateStatus({
          apiBase,
          companyID,
          logicGateID: cleanLogicGateID,
          nodeID: created.node_id,
          status: "requested",
          priority,
          nodeTitle: message.subject?.trim() || undefined,
        });
        onNodeAttachmentChange?.({
          nodeID: created.node_id,
          messageID: targetEmailMessageID,
          threadID: message.thread_id,
          informationID: created.attached_email_information_id,
          logicGateIDs: [cleanLogicGateID],
        });
      }
      if (cleanProjectID) {
        await upsertProjectRelationship({
          companyID,
          projectID: cleanProjectID,
          resourceType: "node",
          resourceID: created.node_id,
        });
      }
      onSuccess();
      onActionSuccess(
        cleanProjectID
          ? "Email Node was sent to project."
          : cleanLogicGateID ? "Email Node was sent to Logic Gate." : "Floating node was created.",
        delayFloatingNodeIndicator ? created : undefined,
      );
      onActionRequestHandled();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to create a node for this email."));
      onActionRequestHandled();
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, companyID, ensureCollaboration, message.subject, message.thread_id, onActionRequestHandled, onActionSuccess, onError, onNodeAttachmentChange, onSuccess, submitting, targetEmailMessageID]);

  React.useEffect(() => {
    const request = actionRequest;
    const destination = request?.destination;
    if (!request || !destination || loading || submitting || handledDestinationRequestRef.current === request) return;
    handledDestinationRequestRef.current = request;
    if (destination.kind === "node") {
      void importIntoExistingNode(destination.nodeID, false);
      return;
    }
    if (destination.kind === "logic_gate") {
      void createEmailNode(undefined, destination.logicGateID, "", true);
      return;
    }
    if (destination.kind === "project") {
      void createEmailNode(undefined, destination.logicGateID, destination.projectID, true);
      return;
    }
    void createEmailNode(undefined, "", "", true);
  }, [actionRequest, createEmailNode, importIntoExistingNode, loading, submitting]);

  const submit = React.useCallback(async () => {
    const cleanDraft = draft.trim();
    if ((!cleanDraft && draftAttachments.length === 0) || submitting) return;
    if (collaborations.length > 0 && (!collaboration || !activeTextBlockID)) {
      onError("Choose a chat section before sending this message.");
      return;
    }
    if (collaboration) {
      if (activeTextBlockID) {
        await submitExistingTextBoxChat(collaboration, activeTextBlockID);
        return;
      }
      await importIntoExistingNode(collaboration.node_id, true);
      return;
    }
    const originalDraft = draft;
    const originalAttachments = draftAttachments;
    const originalPrincipals = selectedMentionPrincipals;
    const originalReplyTargetID = replyTargetID;
    const textBlockID = generateStableInformationID();
    const placeholderMessageID = generateStableInformationID();
    const requestedNodeID = pendingNewNodeIDRef.current || generateStableInformationID();
    pendingNewNodeIDRef.current = requestedNodeID;
    const pending = buildPendingChat(textBlockID, placeholderMessageID);
    showPendingChat(
      pending.chat,
      requestedNodeID,
      textBlockID,
      message.subject?.trim() || "Email Node",
    );
    setSubmitting(true);
    try {
      const created = await ensureEmailCollaboration({
        companyID,
        message: collaborationTargetMessage,
        messageID: targetEmailMessageID,
        threadID: message.thread_id,
        sharedInboxID,
        accountEmail,
        newNodeID: requestedNodeID,
        linkedTextBlock: {
          type: EDITOR_TEXT_BLOCK_TYPE,
          informationID: textBlockID,
          information: buildEditorTextBlockProjectionPayload({
            title: "Email: " + (message.subject?.trim() || "Email"),
            document: "",
            attachments: [],
            emailMessageID: placeholderMessageID,
            color: nextNodeTextBlockColor([]),
          }),
        },
        initialChat: pending.write,
      });
      pendingNewNodeIDRef.current = "";
      acceptCollaboration(created);
      const emailMessageID = created.root_message_id?.trim()
        || created.message?.email_message_id?.trim()
        || placeholderMessageID;
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      setMessages((current) => current.map((item) => item.id === pending.chat.id
        ? { ...item, selectionMessageID: emailMessageID }
        : item));
      setNodeIDByChatID((current) => ({ ...current, [pending.chat.id]: created.node_id }));
      const sectionKey = `${created.node_id}:${textBlockID}`;
      sectionKeysByChatIDRef.current = { ...sectionKeysByChatIDRef.current, [pending.chat.id]: sectionKey };
      setSectionKeysByChatID(sectionKeysByChatIDRef.current);
      setSectionLabelsByBlockID((current) => ({ ...current, [sectionKey]: message.subject?.trim() || "Email Node" }));
      setSectionNodeIDsByBlockID((current) => ({ ...current, [sectionKey]: created.node_id }));
      expireLocalChatEchoSuppression(pending.chat.id);
      invalidateNodeRecordStoreCaches(apiBase, companyID, created.node_id);
      onClearSelection();
      onSuccess();
    } catch (cause) {
      rollBackPendingChat(pending.chat.id);
      setDraft(originalDraft);
      setDraftAttachments(originalAttachments);
      setSelectedMentionPrincipals(originalPrincipals);
      setReplyTargetID(originalReplyTargetID);
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is ready to retry."));
    } finally {
      setSubmitting(false);
    }
  }, [acceptCollaboration, accountEmail, activeTextBlockID, apiBase, buildPendingChat, collaboration, collaborationTargetMessage, collaborations.length, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, importIntoExistingNode, message.subject, message.thread_id, onClearSelection, onError, onSuccess, replyTargetID, rollBackPendingChat, selectedMentionPrincipals, sharedInboxID, showPendingChat, submitExistingTextBoxChat, submitting, targetEmailMessageID]);
  const attachFiles = React.useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    try {
      if (!collaboration) throw new Error("Choose a Node or send the first text message before adding attachments.");
      const activeCollaboration = collaboration;
      const activeBlockID = await ensureLinkedEmailTextBlock(activeCollaboration);
      const uploaded = await Promise.all(candidates.map((file) => uploadEditorAttachment(file, {
        requestJSON,
        companyID,
        resourceType: "node",
        resourceID: activeCollaboration.node_id,
        sourceKind: "chat_upload",
        relationshipKind: "chat_attachment",
        informationID: activeBlockID,
        editorSurface: "email_collaboration_chat",
      })));
      setDraftAttachments((current) => [...current, ...uploaded]);
      onSuccess();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_upload_chat_attachment");
    }
  }, [collaboration, companyID, ensureLinkedEmailTextBlock, onError, onSuccess, requestJSON]);

  const deleteMessage = React.useCallback(async (messageID: string) => {
    const target = messages.find((item) => item.id === messageID);
    const targetNodeID = nodeIDByChatID[messageID] || nodeID;
    if (!target || !targetNodeID || !canDeleteEditorTextBlockChatMessage(target, currentUserID)) return;
    setMessages((current) => current.filter((item) => item.id !== messageID));
    try {
      await requestJSON(
        "/v1/nodes/" + encodeURIComponent(targetNodeID) + "/projection/" + encodeURIComponent(messageID)
          + "?company_id=" + encodeURIComponent(companyID),
        { method: "DELETE" },
      );
      onSuccess();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_email_chat");
      const rollbackSequence = loadSequenceRef.current;
      void loadThreadChats(collaboration, rollbackSequence).catch((refreshCause) => {
        if (loadSequenceRef.current !== rollbackSequence || isAbortError(refreshCause)) return;
        onError(formatEmailCollaborationChatError(refreshCause, "Delete failed, and email chat could not refresh."));
      });
    }
  }, [collaboration, companyID, currentUserID, loadThreadChats, messages, nodeID, nodeIDByChatID, onError, onSuccess, requestJSON]);

  const editMessage = React.useCallback(async (messageID: string, nextText: string) => {
    const existing = messages.find((item) => item.id === messageID);
    const targetNodeID = nodeIDByChatID[messageID] || nodeID;
    if (!existing || !targetNodeID || !canEditEditorTextBlockChatMessage(existing, currentUserID)) {
      const cause = new Error("cannot_edit_other_users_chat_message");
      onError(cause.message);
      throw cause;
    }
    const messageText = nextText.trim();
    if (!messageText && existing.attachments.length === 0) {
      const cause = new Error("chat_message_required");
      onError(cause.message);
      throw cause;
    }
    if (messageText === existing.message) return;
    const mentions = mentionedPrincipalIDs(messageText, principals);
    const editedTimestamp = new Date().toISOString();
    setMessages((current) => current.map((item) => item.id === messageID ? {
      ...item,
      message: messageText,
      editedTimestamp,
      mentionedUserIDs: mentions.mentionedUserIDs,
      mentionedGroupIDs: mentions.mentionedGroupIDs,
    } : item));
    try {
      await requestJSON("/v1/nodes/" + encodeURIComponent(targetNodeID) + "/projection/" + encodeURIComponent(messageID), {
        method: "PATCH",
        json: {
          company_id: companyID,
          message: messageText,
          mentioned_user_ids: mentions.mentionedUserIDs,
          mentioned_group_ids: mentions.mentionedGroupIDs,
        },
      });
      onSuccess();
    } catch (cause) {
      setMessages((current) => current.map((item) => item.id === messageID ? existing : item));
      onError(cause instanceof Error ? cause.message : "failed_to_edit_email_chat");
      throw cause;
    }
  }, [companyID, currentUserID, messages, nodeID, nodeIDByChatID, onError, onSuccess, principals, requestJSON]);

  const navigateToChatMessage = React.useCallback((chatMessageID: string) => {
    setActiveMessageID(chatMessageID);
    const target = messages.find((item) => item.id === chatMessageID);
    const messageID = target?.selectionMessageID?.trim() ?? "";
    const quote = target?.selectionQuote?.trim() ?? "";
    const startOffset = Math.max(0, target?.selectionStart ?? 0);
    const endOffset = Math.max(startOffset, target?.selectionEnd ?? 0);
    if (target?.selectionSource === "email" && messageID) {
      onNavigateToEmailSelection({ messageID, quote, startOffset, endOffset });
    }
  }, [messages, onNavigateToEmailSelection]);

  const collaborationNodeLabel = (item: CommunicationsEmailCollaboration) => {
    const node = nodes.find((candidate) => candidate.node_id === item.node_id);
    return node?.name?.trim() || "Node " + item.node_id.slice(0, 8);
  };

  const activateChatSection = React.useCallback((sectionKey: string) => {
    const group = threadChatGroups.find((candidate) => `${candidate.node_id}:${candidate.textbox_id}` === sectionKey);
    if (!group) return;
    const destination = collaborations.find((item) => item.collaboration_id === group.relationship_id)
      || collaborations.find((item) => item.node_id === group.node_id)
      || null;
    pendingNewNodeIDRef.current = "";
    acceptCollaboration(destination, false);
    selectionInternalEmailMessageIDRef.current = group.provider_message_id === targetEmailMessageID
      ? group.email_message_id
      : collaborationTargetMessage.email_message_id?.trim() || "";
    setActiveTextBlockID(group.textbox_id);
    setReplyTargetID("");
    setActiveMessageID("");
  }, [acceptCollaboration, collaborationTargetMessage.email_message_id, collaborations, targetEmailMessageID, threadChatGroups]);

  const selectCollaborationTarget = React.useCallback(async (nextCollaboration: CommunicationsEmailCollaboration) => {
    pendingNewNodeIDRef.current = "";
    acceptCollaboration(nextCollaboration);
    setReplyTargetID("");
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    setLoading(true);
    try {
      await loadThreadChats(nextCollaboration, requestSequence);
      if (loadSequenceRef.current === requestSequence) onSuccess();
    } catch (cause) {
      if (loadSequenceRef.current === requestSequence && !isAbortError(cause)) {
        onError(formatEmailCollaborationChatError(cause, "Failed to load this Node chat."));
      }
    } finally {
      if (loadSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [acceptCollaboration, loadThreadChats, onError, onSuccess]);

  const startNewFloatingNodeChat = React.useCallback(() => {
    pendingNewNodeIDRef.current = generateStableInformationID();
    acceptCollaboration(null);
    setActiveTextBlockID("");
    setReplyTargetID("");
    setActiveMessageID("");
  }, [acceptCollaboration]);

  React.useEffect(() => {
    if (!selection) {
      selectionChoiceKeyRef.current = "";
      return;
    }
    if (loading) return;
    const choiceKey = JSON.stringify([
      selection.messageID,
      selection.startOffset,
      selection.endOffset,
      selection.quote,
    ]);
    if (selectionChoiceKeyRef.current === choiceKey) return;
    selectionChoiceKeyRef.current = choiceKey;
    if (collaborations.length === 1) {
      if (collaboration?.collaboration_id !== collaborations[0].collaboration_id) {
        void selectCollaborationTarget(collaborations[0]);
      }
      return;
    }
    if (collaborations.length > 1) {
      acceptCollaboration(null, false);
      return;
    }
    startNewFloatingNodeChat();
  }, [acceptCollaboration, collaboration?.collaboration_id, collaborations, loading, selection, selectCollaborationTarget, startNewFloatingNodeChat]);

  return (
    <aside
      id={id}
      hidden={!active}
      aria-hidden={!active}
      aria-label="Email collaboration chat"
      className={active ? "mango-pane-enter" : undefined}
      style={{
        minWidth: 0,
        minHeight: 0,
        height: topOffset > 0 ? `calc(100% - ${topOffset}px)` : "100%",
        marginTop: topOffset,
        alignSelf: "stretch",
        display: active ? "grid" : "none",
        gridTemplateRows: "minmax(0, 1fr)",
        padding: "0 8px 0 0",
        overflow: "hidden",
        background: EDITOR_NEU_SURFACE,
      }}
    >
      <ChatPane
        blockID={blockID || "email-collaboration"}
        editable
        apiBase={apiBase}
        companyID={companyID}
        messages={messages}
        headerLeading={(
          <span data-email-chat-node-header="true" style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ExplorerRowIcon kind="node" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {collaboration ? collaborationNodeLabel(collaboration) : threadChatGroups.length > 0 ? "Email chats" : message.subject?.trim() || "New email Node"}
            </span>
          </span>
        )}
        sectionLabelsByBlockID={sectionLabelsByBlockID}
        sectionNodeIDsByBlockID={sectionNodeIDsByBlockID}
        sectionKeysByMessageID={sectionKeysByChatID}
        activeSectionKey={collaboration && activeTextBlockID ? `${collaboration.node_id}:${activeTextBlockID}` : ""}
        selectionAnchor={selectionAnchor}
        draft={draft}
        companyUsers={principals}
        draftAttachments={draftAttachments}
        replyTargetID={replyTargetID}
        heightStorageKey={"mangorts.email-collaboration-chat-height:" + companyID}
        fillHeight
        active={active}
        currentUserID={currentUserID}
        activeMessageID={activeMessageID}
        accent="#475569"
        surfaceText="#111827"
        panelBackground={EDITOR_NEU_SURFACE}
        strokeColor="rgba(148,163,184,0.34)"
        ruleColor="rgba(148,163,184,0.28)"
        onFocus={() => undefined}
        onDraftChange={changeDraft}
        onMentionPrincipal={rememberMentionPrincipal}
        onActivateMessage={setActiveMessageID}
        onNavigateToMessage={navigateToChatMessage}
        onOpenSectionNode={onOpenNode}
        onActivateSection={activateChatSection}
        onReply={(messageID) => {
          const replyMessage = messages.find((item) => item.id === messageID);
          const replyNodeID = nodeIDByChatID[messageID]?.trim() ?? "";
          const replyCollaboration = collaborations.find((item) => item.node_id === replyNodeID);
          if (replyCollaboration && replyCollaboration.collaboration_id !== collaboration?.collaboration_id) {
            acceptCollaboration(replyCollaboration, false);
          }
          if (replyMessage?.blockID) setActiveTextBlockID(replyMessage.blockID);
          setReplyTargetID(messageID);
        }}
        onEditMessage={editMessage}
        onDeleteMessage={(messageID) => { void deleteMessage(messageID); }}
        onClearReply={() => setReplyTargetID("")}
        onClearSelectionAnchor={onClearSelection}
        onAttachFiles={(files) => { void attachFiles(files); }}
        onRemoveDraftAttachment={(attachmentID) => setDraftAttachments((current) => current.filter((item) => item.id !== attachmentID))}
        onSubmit={() => { if (!submitting) void submit(); }}
      />
    </aside>
  );
}

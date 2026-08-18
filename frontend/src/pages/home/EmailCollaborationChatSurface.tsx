import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON, isAbortError } from "../../modules/api/requestJSON";
import {
  ensureEmailCollaboration,
  listEmailThreadChatGroups,
  type CommunicationsEmailCollaboration,
  type CommunicationsEmailThreadChatGroup,
  type CommunicationsEmailThreadTextboxLink,
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
import { nextEmailTextBoxColor } from "../../modules/editor/email/emailTextBoxRelationships";
import { invalidateNodeRecordStoreCaches } from "../../modules/nodes/nodeRecordStore";
import type { NodeRecord } from "../../modules/nodes/types";
import { assignNodeToLogicGateStatus } from "../../modules/kanban/kanbanApi";
import { upsertProjectRelationship } from "../../modules/project-management/projectManagementApi";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import {
  appendAcknowledgedEmailCollaborationChat,
  conflictingEmailTextboxLink,
  emailNodeImportRequired,
  emailTextboxLinkForMessage,
  emailThreadChatGroupKey,
  formatEmailCollaborationChatError,
  orderEmailCollaborationChatMessages,
  orderEmailThreadChatGroups,
  type EmailCollaborationActionRequest,
} from "./emailCollaborationChat";
import type { EmailNodeAttachmentChange } from "./emailCollaborationRows";

export type EmailCollaborationSelection = {
  messageID: string;
  emailMessageID?: string;
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
  onEmailChatHighlightsChange?: (highlights: EmailCollaborationSelection[]) => void;
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
  onEmailChatHighlightsChange,
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
  const [sectionNodeLabelsByNodeID, setSectionNodeLabelsByNodeID] = React.useState<Record<string, string>>({});
  const [sectionNodeOrder, setSectionNodeOrder] = React.useState<string[]>([]);
  const [threadChatNodeIDs, setThreadChatNodeIDs] = React.useState<string[]>([]);
  const [threadChatGroups, setThreadChatGroups] = React.useState<CommunicationsEmailThreadChatGroup[]>([]);
  const [threadTextboxLinks, setThreadTextboxLinks] = React.useState<CommunicationsEmailThreadTextboxLink[]>([]);
  const [selectedChatGroupKey, setSelectedChatGroupKey] = React.useState("");
  const [selectedChatNodeID, setSelectedChatNodeID] = React.useState("");
  const [newNodeDestinationSelected, setNewNodeDestinationSelected] = React.useState(false);
  const [selectionDestinationError, setSelectionDestinationError] = React.useState("");
  const [destinationFlash, setDestinationFlash] = React.useState({ nodeID: "", sectionKey: "" });
  const [draft, setDraft] = React.useState("");
  const [draftAttachments, setDraftAttachments] = React.useState<EditorChatAttachment[]>([]);
  const [selectedMentionPrincipals, setSelectedMentionPrincipals] = React.useState<MentionableCompanyUser[]>([]);
  const [replyTargetID, setReplyTargetID] = React.useState("");
  const [activeMessageID, setActiveMessageID] = React.useState("");
  const [composerFocusRequestID, setComposerFocusRequestID] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const loadSequenceRef = React.useRef(0);
  const collaborationRef = React.useRef<CommunicationsEmailCollaboration | null>(null);
  const collaborationsRef = React.useRef<CommunicationsEmailCollaboration[]>([]);
  const selectionInternalEmailMessageIDRef = React.useRef("");
  const selectedChatGroupKeyRef = React.useRef("");
  const sourceLoadKeyRef = React.useRef("");
  const handledDestinationRequestRef = React.useRef<NonNullable<EmailCollaborationActionRequest> | null>(null);
  const pendingNewNodeIDRef = React.useRef("");
  const locallySubmittedChatIDsRef = React.useRef<Set<string>>(new Set());
  const selectionChoiceKeyRef = React.useRef("");
  const destinationFlashTimerRef = React.useRef<number | null>(null);
  const destinationFlashFrameRef = React.useRef<number | null>(null);
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
  const emailChatHighlights = React.useMemo<EmailCollaborationSelection[]>(() => messages.flatMap((chatMessage) => {
    const messageID = chatMessage.selectionSource === "email" ? chatMessage.selectionMessageID?.trim() ?? "" : "";
    const quote = chatMessage.selectionQuote?.trim() ?? "";
    const startOffset = chatMessage.selectionStart;
    const endOffset = chatMessage.selectionEnd;
    if (!messageID || !quote || typeof startOffset !== "number" || typeof endOffset !== "number" || endOffset <= startOffset) return [];
    const highlight = { messageID, quote, startOffset, endOffset };
    const providerMessageID = threadTextboxLinks.find((link) => link.email_message_id === messageID)?.provider_message_id?.trim() ?? "";
    return providerMessageID && providerMessageID !== messageID
      ? [highlight, { ...highlight, messageID: providerMessageID }]
      : [highlight];
  }), [messages, threadTextboxLinks]);

  React.useEffect(() => {
    onEmailChatHighlightsChange?.(emailChatHighlights);
  }, [emailChatHighlights, onEmailChatHighlightsChange]);

  const nodeGroupLabel = React.useCallback((group: Pick<CommunicationsEmailThreadChatGroup, "node_id" | "node_name">) => (
    group.node_name.trim() || "Node " + group.node_id.slice(0, 8)
  ), []);

  const textboxGroupLabel = React.useCallback((group: Pick<CommunicationsEmailThreadChatGroup, "textbox_id" | "textbox_title">) => (
    group.textbox_title.trim() || "Chat " + group.textbox_id.slice(0, 8)
  ), []);

  const chatGroupLabel = React.useCallback((group: CommunicationsEmailThreadChatGroup) => (
    `${nodeGroupLabel(group)} · ${textboxGroupLabel(group)}`
  ), [nodeGroupLabel, textboxGroupLabel]);

  const flashChatDestination = React.useCallback((nodeID: string, sectionKey = "") => {
    if (destinationFlashTimerRef.current !== null) window.clearTimeout(destinationFlashTimerRef.current);
    if (destinationFlashFrameRef.current !== null) window.cancelAnimationFrame(destinationFlashFrameRef.current);
    setDestinationFlash({ nodeID: "", sectionKey: "" });
    destinationFlashFrameRef.current = window.requestAnimationFrame(() => {
      destinationFlashFrameRef.current = null;
      setDestinationFlash({ nodeID, sectionKey });
      destinationFlashTimerRef.current = window.setTimeout(() => {
        destinationFlashTimerRef.current = null;
        setDestinationFlash({ nodeID: "", sectionKey: "" });
      }, 1000);
    });
  }, []);

  React.useEffect(() => () => {
    if (destinationFlashTimerRef.current !== null) window.clearTimeout(destinationFlashTimerRef.current);
    if (destinationFlashFrameRef.current !== null) window.cancelAnimationFrame(destinationFlashFrameRef.current);
  }, []);

  const rememberSelectedChatGroup = React.useCallback((groupKey: string) => {
    selectedChatGroupKeyRef.current = groupKey;
    setSelectedChatGroupKey(groupKey);
  }, []);

  const applyThreadChatGroups = React.useCallback((
    groups: CommunicationsEmailThreadChatGroup[],
    destinations: CommunicationsEmailCollaboration[],
    activeDestination: CommunicationsEmailCollaboration | null,
    textboxLinks: CommunicationsEmailThreadTextboxLink[],
  ) => {
    const orderedGroups = orderEmailThreadChatGroups(groups);
    collaborationsRef.current = destinations;
    setCollaborations(destinations);
    const blockLabels: Record<string, string> = {};
    const blockNodeIDs: Record<string, string> = {};
    const nodeLabels: Record<string, string> = {};
    const chatNodes: Record<string, string> = {};
    const chatSectionKeys: Record<string, string> = {};
    const allChats: EditorTextBlockChatMessage[] = [];
    for (const destination of destinations) {
      const node = nodes.find((candidate) => candidate.node_id === destination.node_id);
      nodeLabels[destination.node_id] = node?.name?.trim() || "Node " + destination.node_id.slice(0, 8);
    }
    let activeGroup = orderedGroups.find((group) => emailThreadChatGroupKey(group) === selectedChatGroupKeyRef.current);
    let activeTextboxLink: CommunicationsEmailThreadTextboxLink | undefined;
    if (activeGroup) {
      const exactLink = emailTextboxLinkForMessage(textboxLinks, targetEmailMessageID, activeGroup.node_id);
      if (exactLink?.textbox_id === activeGroup.textbox_id) activeTextboxLink = exactLink;
    }
    if (!activeGroup) {
      const singleDestinationNodeID = activeDestination?.node_id
        ?? (destinations.length === 1 ? destinations[0]?.node_id : undefined)
        ?? "";
      if (singleDestinationNodeID) {
        activeTextboxLink = emailTextboxLinkForMessage(textboxLinks, targetEmailMessageID, singleDestinationNodeID);
        if (activeTextboxLink) {
          activeGroup = orderedGroups.find((group) => (
            group.node_id === activeTextboxLink?.node_id && group.textbox_id === activeTextboxLink.textbox_id
          ));
        }
      }
    }
    const activeBlockID = activeGroup?.textbox_id ?? activeTextboxLink?.textbox_id ?? "";
    const activeGroupKey = activeGroup ? emailThreadChatGroupKey(activeGroup) : "";
    selectionInternalEmailMessageIDRef.current = activeTextboxLink?.email_message_id ?? "";
    selectedChatGroupKeyRef.current = activeGroupKey;
    setSelectedChatGroupKey(activeGroupKey);
    for (const group of orderedGroups) {
      const sectionKey = emailThreadChatGroupKey(group);
      blockLabels[sectionKey] = textboxGroupLabel(group);
      blockNodeIDs[sectionKey] = group.node_id;
      nodeLabels[group.node_id] = nodeGroupLabel(group);
      for (const chat of orderEmailCollaborationChatMessages(parseEditorTextBlockChats(group.chats))) {
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
    setSectionNodeLabelsByNodeID(nodeLabels);
    setSectionKeysByChatID(chatSectionKeys);
    const orderedNodeIDs = [...new Set([
      ...destinations.map((destination) => destination.node_id),
      ...orderedGroups.map((group) => group.node_id),
    ])].sort((left, right) => (
      (nodeLabels[left] ?? "").localeCompare(nodeLabels[right] ?? "", undefined, { sensitivity: "base" })
      || left.localeCompare(right)
    ));
    setSectionNodeOrder(orderedNodeIDs);
    setThreadChatNodeIDs(orderedNodeIDs);
    setThreadChatGroups(orderedGroups);
    setThreadTextboxLinks(textboxLinks);
    setActiveTextBlockID(activeBlockID);
    onExistingChatsChange?.(allChats.length > 0);
    return destinations;
  }, [nodeGroupLabel, nodes, onExistingChatsChange, targetEmailMessageID, textboxGroupLabel]);

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
    applyThreadChatGroups(result.groups, result.collaborations, activeDestination, result.textbox_links);
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
      selectedChatGroupKeyRef.current = "";
      pendingNewNodeIDRef.current = "";
      selectionChoiceKeyRef.current = "";
      setCollaboration(null);
      collaborationsRef.current = [];
      setCollaborations([]);
      setMessages([]);
      setNodeIDByChatID({});
      setSectionLabelsByBlockID({});
      setSectionNodeIDsByBlockID({});
      setSectionNodeLabelsByNodeID({});
      setSectionNodeOrder([]);
      setSectionKeysByChatID({});
      setThreadChatNodeIDs([]);
      setThreadChatGroups([]);
      setThreadTextboxLinks([]);
      setSelectedChatGroupKey("");
      setSelectedChatNodeID("");
      setNewNodeDestinationSelected(false);
      setSelectionDestinationError("");
      setDestinationFlash({ nodeID: "", sectionKey: "" });
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
		const items = applyThreadChatGroups(result.groups, result.collaborations, null, result.textbox_links);
		const nextCollaboration = items.length === 1 ? items[0] : null;
		acceptCollaboration(nextCollaboration, false);
		if (nextCollaboration) applyThreadChatGroups(result.groups, result.collaborations, nextCollaboration, result.textbox_links);
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
    const hasEmailSelection = Boolean(emailMessageID.trim());
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
      selectionSource: hasEmailSelection ? "email" : undefined,
      selectionMessageID: hasEmailSelection ? emailMessageID : undefined,
      selectionQuote: hasEmailSelection ? selection?.quote : undefined,
      selectionStart: hasEmailSelection ? selection?.startOffset : undefined,
      selectionEnd: hasEmailSelection ? selection?.endOffset : undefined,
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
    setMessages((current) => appendAcknowledgedEmailCollaborationChat(current, chat));
    setNodeIDByChatID((current) => ({ ...current, [chat.id]: targetNodeID }));
    setSectionKeysByChatID((current) => ({ ...current, [chat.id]: sectionKey }));
    setSectionLabelsByBlockID((current) => {
      const label = current[sectionKey] || nodeTitle;
      const reordered = Object.fromEntries(Object.entries(current).filter(([key]) => key !== sectionKey));
      return { ...reordered, [sectionKey]: label };
    });
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
      return next;
    });
    setActiveMessageID((current) => current === chatID ? "" : current);
  }, []);

  const expireLocalChatEchoSuppression = React.useCallback((chatID: string) => {
    window.setTimeout(() => locallySubmittedChatIDsRef.current.delete(chatID), 30_000);
  }, []);

  const submitExistingTextBoxChat = React.useCallback(async (
    activeCollaboration: CommunicationsEmailCollaboration,
    textBlockID: string,
    exactEmailMessageID = "",
  ) => {
    const targetNodeID = activeCollaboration.node_id.trim();
    const emailMessageID = exactEmailMessageID.trim();
    if (!targetNodeID || !textBlockID || submitting) return;
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
      await requestJSON<unknown>(`/v1/nodes/${encodeURIComponent(targetNodeID)}/information`, {
        method: "POST",
        body: JSON.stringify({
          company_id: companyID,
          type: pending.write.type,
          information: pending.write.information,
          information_id: pending.write.informationID,
        }),
      });
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
  }, [apiBase, buildPendingChat, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, nodes, onClearSelection, onError, onSuccess, replyTargetID, requestJSON, rollBackPendingChat, selectedMentionPrincipals, showPendingChat, submitting]);

  const importIntoExistingNode = React.useCallback(async (
    targetNodeID: string,
    includeChat: boolean,
    selectedGroup?: CommunicationsEmailThreadChatGroup,
  ) => {
    const cleanNodeID = targetNodeID.trim();
    if (!cleanNodeID || submitting) return;
    const cleanDraft = draft.trim();
    const originalAttachments = draftAttachments;
    const originalPrincipals = selectedMentionPrincipals;
    const originalReplyTargetID = replyTargetID;
    let pendingChat: ReturnType<typeof buildPendingChat> | null = null;
    let ensuredCollaboration: CommunicationsEmailCollaboration | null = null;
    setSubmitting(true);
    try {
      const providerMessageID = selection?.messageID?.trim() || message.id.trim();
      const existingTextboxLink = emailTextboxLinkForMessage(threadTextboxLinks, providerMessageID, cleanNodeID);
      const linkedGroup = existingTextboxLink
        ? threadChatGroups.find((group) => (
          group.node_id === cleanNodeID && group.textbox_id === existingTextboxLink.textbox_id
        ))
        : undefined;
      const existingGroup = selectedGroup ?? linkedGroup;
      const destinationTextboxLink = selectedGroup
        ? (existingTextboxLink?.textbox_id === selectedGroup.textbox_id ? existingTextboxLink : undefined)
        : existingTextboxLink;
      let emailMessageID = (collaborationTargetMessage.id.trim() === providerMessageID
        ? collaborationTargetMessage.email_message_id?.trim()
        : "")
        || (message.id.trim() === providerMessageID ? message.email_message_id?.trim() : "")
        || (collaboration?.message?.id?.trim() === providerMessageID ? collaboration.root_message_id?.trim() : "")
        || destinationTextboxLink?.email_message_id
        || "";
      emailMessageID = selection?.emailMessageID?.trim() || emailMessageID;
      const currentNodeCollaboration = collaborations.find((item) => item.node_id === cleanNodeID);
      const shouldAttachEmail = !existingTextboxLink && emailNodeImportRequired(cleanNodeID, currentNodeCollaboration?.node_id ?? "", emailMessageID);
      const subject = message.subject?.trim() || "Email";
      let attachedEmailInformationID = collaboration?.attached_email_information_id?.trim() ?? "";
      const color = nextEmailTextBoxColor([]);
      const textBlockID = existingGroup?.textbox_id ?? existingTextboxLink?.textbox_id ?? generateStableInformationID();
      if (!emailMessageID && !existingGroup && !existingTextboxLink) {
        ensuredCollaboration = await ensureEmailCollaboration({
          companyID, message: collaborationTargetMessage, messageID: providerMessageID,
          threadID: message.thread_id, sharedInboxID, accountEmail, targetNodeID: cleanNodeID,
        });
        acceptCollaboration(ensuredCollaboration);
        emailMessageID = ensuredCollaboration.root_message_id?.trim() || ensuredCollaboration.message?.email_message_id?.trim() || "";
      }
      if (!emailMessageID) throw new Error("email_message_id_missing");
      const payloadEmailMessageID = emailMessageID;
      const textBlockWrite = existingGroup || existingTextboxLink ? undefined : {
        type: EDITOR_TEXT_BLOCK_TYPE,
        informationID: textBlockID,
        information: buildEditorTextBlockProjectionPayload({
          title: "Email: " + subject,
          document: "",
          attachments: [],
          color,
        }),
      };
      let initialChatWrite: { type: string; informationID: string; information: string } | undefined;
      let initialChat: EditorTextBlockChatMessage | undefined;
      if (includeChat && (cleanDraft || draftAttachments.length > 0)) {
        pendingChat = buildPendingChat(textBlockID, payloadEmailMessageID);
        initialChatWrite = pendingChat.write;
        initialChat = pendingChat.chat;
        const groupTitle = existingGroup
          ? chatGroupLabel(existingGroup)
          : nodes.find((node) => node.node_id === cleanNodeID)?.name?.trim() || "Node " + cleanNodeID.slice(0, 8);
        showPendingChat(initialChat, cleanNodeID, textBlockID, groupTitle);
      }
      if (shouldAttachEmail || textBlockWrite || initialChatWrite) {
        ensuredCollaboration = await ensureEmailCollaboration({
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
        acceptCollaboration(ensuredCollaboration);
        attachedEmailInformationID = ensuredCollaboration.attached_email_information_id?.trim() || attachedEmailInformationID;
        emailMessageID = ensuredCollaboration.root_message_id?.trim() || ensuredCollaboration.message?.email_message_id?.trim() || emailMessageID;
      } else if (currentNodeCollaboration) {
        acceptCollaboration(currentNodeCollaboration);
      }
      if (!emailMessageID) throw new Error("email_message_id_missing");
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      if (existingTextboxLink) setActiveTextBlockID(existingTextboxLink.textbox_id);
      if (initialChat) {
        const acknowledgedChat = { ...initialChat, selectionMessageID: emailMessageID };
        setMessages((current) => current.map((item) => item.id === acknowledgedChat.id ? acknowledgedChat : item));
        expireLocalChatEchoSuppression(acknowledgedChat.id);
        const activeDestination = ensuredCollaboration ?? currentNodeCollaboration ?? null;
        await loadThreadChats(activeDestination, loadSequenceRef.current);
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
  }, [acceptCollaboration, accountEmail, apiBase, buildPendingChat, chatGroupLabel, collaboration?.attached_email_information_id, collaborationTargetMessage, collaborations, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, loadThreadChats, message.id, message.subject, message.thread_id, nodes, onActionRequestHandled, onActionSuccess, onClearSelection, onError, onNodeAttachmentChange, onSuccess, replyTargetID, rollBackPendingChat, selectedMentionPrincipals, selection?.emailMessageID, selection?.messageID, sharedInboxID, showPendingChat, submitting, threadChatGroups, threadTextboxLinks]);

  const ensureLinkedEmailTextBlock = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration): Promise<string> => {
    const activeNodeID = activeCollaboration.node_id.trim();
    const providerMessageID = selection?.messageID?.trim() || message.id.trim();
    let emailMessageID = (collaborationTargetMessage.id.trim() === providerMessageID
      ? collaborationTargetMessage.email_message_id?.trim()
      : "")
      || (message.id.trim() === providerMessageID ? message.email_message_id?.trim() : "")
      || (activeCollaboration.message?.id?.trim() === providerMessageID ? activeCollaboration.root_message_id?.trim() : "")
      || "";
    emailMessageID = selection?.emailMessageID?.trim() || emailMessageID;
    if (!activeNodeID || !providerMessageID) throw new Error("email_collaboration_node_missing");
    const existingTextboxLink = emailTextboxLinkForMessage(threadTextboxLinks, providerMessageID, activeNodeID);
    if (existingTextboxLink) {
      emailMessageID = existingTextboxLink.email_message_id;
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      setActiveTextBlockID(existingTextboxLink.textbox_id);
      return existingTextboxLink.textbox_id;
    }

    const textBlockID = generateStableInformationID();
    if (!emailMessageID) {
      const ingested = await ensureEmailCollaboration({
        companyID, message: collaborationTargetMessage, messageID: providerMessageID,
        threadID: message.thread_id, sharedInboxID, accountEmail, targetNodeID: activeNodeID,
      });
      acceptCollaboration(ingested);
      emailMessageID = ingested.root_message_id?.trim() || ingested.message?.email_message_id?.trim() || "";
    }
    if (!emailMessageID) throw new Error("email_message_id_missing");
    const color = nextEmailTextBoxColor([]);
    const linkedTextBlock = {
      type: EDITOR_TEXT_BLOCK_TYPE,
      informationID: textBlockID,
      information: buildEditorTextBlockProjectionPayload({
        title: "Email: " + (message.subject?.trim() || "Email"),
        document: "",
        attachments: [],
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
  }, [acceptCollaboration, accountEmail, apiBase, collaborationTargetMessage, companyID, message, selection?.emailMessageID, selection?.messageID, sharedInboxID, threadTextboxLinks]);
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
    const replyMessage = replyTargetID ? messages.find((item) => item.id === replyTargetID) : undefined;
    const replySectionKey = replyTargetID ? sectionKeysByChatID[replyTargetID] ?? "" : "";
    const replyGroup = replySectionKey
      ? threadChatGroups.find((group) => emailThreadChatGroupKey(group) === replySectionKey)
      : undefined;
    if (replyMessage && replyGroup) {
      const replyCollaboration = collaborations.find((item) => item.node_id === replyGroup.node_id);
      const replyEmailMessageID = replyMessage.selectionMessageID?.trim() ?? "";
      if (!replyCollaboration) {
        onError("This reply destination is no longer available.");
        return;
      }
      await submitExistingTextBoxChat(replyCollaboration, replyGroup.textbox_id, replyEmailMessageID);
      return;
    }
    if (selection && !newNodeDestinationSelected && !selectedChatGroupKey && !selectedChatNodeID) {
      setSelectionDestinationError("Please select a destination.");
      return;
    }
    const selectedGroup = selectedChatGroupKey
      ? threadChatGroups.find((group) => emailThreadChatGroupKey(group) === selectedChatGroupKey)
      : undefined;
    if (selectedGroup) {
      const selectedCollaboration = collaborations.find((item) => item.node_id === selectedGroup.node_id);
      if (!selectedCollaboration) {
        onError("This chat grouping's Node is no longer available.");
        return;
      }
      if (!selection) {
        await submitExistingTextBoxChat(selectedCollaboration, selectedGroup.textbox_id);
        return;
      }
      const conflict = conflictingEmailTextboxLink(threadTextboxLinks, selectedGroup, targetEmailMessageID);
      if (conflict) {
        await submitExistingTextBoxChat(selectedCollaboration, conflict.textbox_id, conflict.email_message_id);
        return;
      }
      const exactTextboxLink = emailTextboxLinkForMessage(threadTextboxLinks, targetEmailMessageID, selectedGroup.node_id);
      if (exactTextboxLink?.textbox_id === selectedGroup.textbox_id) {
        await submitExistingTextBoxChat(selectedCollaboration, selectedGroup.textbox_id, exactTextboxLink.email_message_id);
      } else {
        await importIntoExistingNode(selectedGroup.node_id, true, selectedGroup);
      }
      return;
    }
    if (collaborations.length > 1 && !collaboration && !newNodeDestinationSelected) {
      onError("Choose a chat grouping or another destination before sending this chat.");
      return;
    }
    if (collaboration) {
      if (activeTextBlockID) {
        const activeSelectionMessageID = selection
          ? selectionInternalEmailMessageIDRef.current
            || collaborationTargetMessage.email_message_id?.trim()
            || collaboration.root_message_id?.trim()
            || targetEmailMessageID
          : "";
        await submitExistingTextBoxChat(collaboration, activeTextBlockID, activeSelectionMessageID);
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
            color: nextEmailTextBoxColor([]),
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
      setSectionKeysByChatID((current) => ({ ...current, [pending.chat.id]: sectionKey }));
      setSectionLabelsByBlockID((current) => ({ ...current, [sectionKey]: message.subject?.trim() || "Email Node" }));
      expireLocalChatEchoSuppression(pending.chat.id);
      invalidateNodeRecordStoreCaches(apiBase, companyID, created.node_id);
      let refreshFailed = false;
      try {
        await loadThreadChats(created, loadSequenceRef.current);
      } catch {
        refreshFailed = true;
      }
      onClearSelection();
      onSuccess();
      if (refreshFailed) {
        onError("Chat was saved, but its destination could not refresh. Reload this email before sending another highlighted chat.");
      }
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
  }, [acceptCollaboration, accountEmail, activeTextBlockID, apiBase, buildPendingChat, chatGroupLabel, collaboration, collaborationTargetMessage, collaborations, companyID, draft, draftAttachments, expireLocalChatEchoSuppression, importIntoExistingNode, loadThreadChats, message.subject, message.thread_id, messages, newNodeDestinationSelected, onClearSelection, onError, onSuccess, replyTargetID, rollBackPendingChat, sectionKeysByChatID, selectedChatGroupKey, selectedChatNodeID, selectedMentionPrincipals, selection, sharedInboxID, showPendingChat, submitExistingTextBoxChat, submitting, targetEmailMessageID, threadChatGroups, threadTextboxLinks]);
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

  const selectNodeChatDestination = React.useCallback((nodeID: string) => {
    const nextCollaboration = collaborations.find((item) => item.node_id === nodeID);
    if (!nextCollaboration) {
      onError("This Node is no longer available as a chat destination.");
      return;
    }
    const exactTextboxLink = selection
      ? emailTextboxLinkForMessage(threadTextboxLinks, targetEmailMessageID, nodeID)
      : undefined;
    const authoritativeGroup = exactTextboxLink
      ? threadChatGroups.find((candidate) => (
        candidate.node_id === exactTextboxLink.node_id && candidate.textbox_id === exactTextboxLink.textbox_id
      ))
      : undefined;
    pendingNewNodeIDRef.current = "";
    setNewNodeDestinationSelected(false);
    setSelectionDestinationError("");
    acceptCollaboration(nextCollaboration, false);
    setSelectedChatNodeID(nodeID);
    if (authoritativeGroup && exactTextboxLink) {
      const authoritativeKey = emailThreadChatGroupKey(authoritativeGroup);
      rememberSelectedChatGroup(authoritativeKey);
      selectionInternalEmailMessageIDRef.current = exactTextboxLink.email_message_id;
      setActiveTextBlockID(exactTextboxLink.textbox_id);
      flashChatDestination(nodeID, authoritativeKey);
    } else {
      rememberSelectedChatGroup("");
      selectionInternalEmailMessageIDRef.current = exactTextboxLink?.email_message_id ?? "";
      setActiveTextBlockID(exactTextboxLink?.textbox_id ?? "");
      flashChatDestination(nodeID);
    }
    setReplyTargetID("");
    setActiveMessageID("");
    setComposerFocusRequestID((current) => current + 1);
  }, [acceptCollaboration, collaborations, flashChatDestination, onError, rememberSelectedChatGroup, selection, targetEmailMessageID, threadChatGroups, threadTextboxLinks]);

  const selectExistingChatGroup = React.useCallback((sectionKey: string) => {
    let group = threadChatGroups.find((candidate) => emailThreadChatGroupKey(candidate) === sectionKey);
    if (!group) return;
    if (selection) {
      const conflict = conflictingEmailTextboxLink(threadTextboxLinks, group, targetEmailMessageID);
      if (conflict) {
        const authoritativeGroup = threadChatGroups.find((candidate) => (
          candidate.node_id === conflict.node_id && candidate.textbox_id === conflict.textbox_id
        ));
        if (!authoritativeGroup) {
          selectNodeChatDestination(group.node_id);
          return;
        }
        group = authoritativeGroup;
      }
    }
    const nextCollaboration = collaborations.find((item) => item.node_id === group.node_id);
    if (!nextCollaboration) {
      onError("This chat grouping's Node is no longer available.");
      return;
    }
    const destinationKey = emailThreadChatGroupKey(group);
    pendingNewNodeIDRef.current = "";
    setNewNodeDestinationSelected(false);
    setSelectionDestinationError("");
    acceptCollaboration(nextCollaboration, false);
    setSelectedChatNodeID(group.node_id);
    rememberSelectedChatGroup(destinationKey);
    const exactTextboxLink = emailTextboxLinkForMessage(threadTextboxLinks, targetEmailMessageID, group.node_id);
    selectionInternalEmailMessageIDRef.current = selection && exactTextboxLink?.textbox_id === group.textbox_id
      ? exactTextboxLink.email_message_id
      : "";
    setActiveTextBlockID(group.textbox_id);
    flashChatDestination(group.node_id, destinationKey);
    setReplyTargetID("");
    setActiveMessageID("");
    setComposerFocusRequestID((current) => current + 1);
  }, [acceptCollaboration, collaborations, flashChatDestination, onError, rememberSelectedChatGroup, selectNodeChatDestination, selection, targetEmailMessageID, threadChatGroups, threadTextboxLinks]);

  const cancelChatGroupDestination = React.useCallback(() => {
    pendingNewNodeIDRef.current = "";
    rememberSelectedChatGroup("");
    setSelectedChatNodeID("");
    setNewNodeDestinationSelected(false);
    setSelectionDestinationError("");
    selectionInternalEmailMessageIDRef.current = "";
    setActiveTextBlockID("");
    setReplyTargetID("");
    setActiveMessageID("");
    if (collaborations.length > 1) acceptCollaboration(null, false);
  }, [acceptCollaboration, collaborations.length, rememberSelectedChatGroup]);

  const startNewFloatingNodeChat = React.useCallback(() => {
    pendingNewNodeIDRef.current = generateStableInformationID();
    acceptCollaboration(null);
    rememberSelectedChatGroup("");
    setSelectedChatNodeID("");
    setNewNodeDestinationSelected(true);
    setSelectionDestinationError("");
    selectionInternalEmailMessageIDRef.current = "";
    setActiveTextBlockID("");
    setReplyTargetID("");
    setActiveMessageID("");
  }, [acceptCollaboration, rememberSelectedChatGroup]);

  React.useEffect(() => {
    if (!selection) {
      selectionChoiceKeyRef.current = "";
      setNewNodeDestinationSelected(false);
      setSelectionDestinationError("");
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
    rememberSelectedChatGroup("");
    setSelectedChatNodeID("");
    setNewNodeDestinationSelected(false);
    setSelectionDestinationError("");
    selectionInternalEmailMessageIDRef.current = "";
    setActiveTextBlockID("");
    setReplyTargetID("");
    setActiveMessageID("");
    const exactTextboxLinks = threadTextboxLinks.filter((link) => (
      link.provider_message_id.trim() === targetEmailMessageID
    ));
    if (exactTextboxLinks.length === 1) {
      selectNodeChatDestination(exactTextboxLinks[0].node_id);
      return;
    }
    if (exactTextboxLinks.length > 1) {
      acceptCollaboration(null, false);
      return;
    }
    if (collaborations.length === 1) {
      selectNodeChatDestination(collaborations[0].node_id);
      return;
    }
    if (collaborations.length > 1) {
      acceptCollaboration(null, false);
      return;
    }
    startNewFloatingNodeChat();
  }, [acceptCollaboration, collaborations, loading, rememberSelectedChatGroup, selection, selectNodeChatDestination, startNewFloatingNodeChat, targetEmailMessageID, threadTextboxLinks]);

  const selectedChatGroup = selectedChatGroupKey
    ? threadChatGroups.find((group) => emailThreadChatGroupKey(group) === selectedChatGroupKey)
    : undefined;
  const selectedNodeSectionID = selectedChatGroup?.node_id ?? selectedChatNodeID;
  const selectedNodeExactLink = selectedNodeSectionID
    ? emailTextboxLinkForMessage(threadTextboxLinks, targetEmailMessageID, selectedNodeSectionID)
    : undefined;
  const composerDestination = !selection
    ? undefined
    : newNodeDestinationSelected
      ? { kind: "new_node_new_textbox" as const }
      : selectedChatGroup
        ? {
          kind: "existing_node_existing_textbox" as const,
          nodeID: selectedChatGroup.node_id,
          nodeName: sectionNodeLabelsByNodeID[selectedChatGroup.node_id] ?? "Selected Node",
        }
        : selectedNodeSectionID
          ? {
            kind: selectedNodeExactLink ? "existing_node_existing_textbox" as const : "existing_node_new_textbox" as const,
            nodeID: selectedNodeSectionID,
            nodeName: sectionNodeLabelsByNodeID[selectedNodeSectionID] ?? "Selected Node",
          }
          : undefined;

  React.useEffect(() => {
    if (!active || !selection || !composerDestination) return undefined;
    const clearDestinationOutsideSelection = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-chat-node-selectable="true"], [data-chat-section-selectable="true"], [data-chat-composer-shell="true"], [data-chat-new-node-destination="true"]')) return;
      cancelChatGroupDestination();
    };
    document.addEventListener("pointerdown", clearDestinationOutsideSelection);
    return () => document.removeEventListener("pointerdown", clearDestinationOutsideSelection);
  }, [active, cancelChatGroupDestination, composerDestination, selection]);

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
              {selection && newNodeDestinationSelected
                ? "New Node · New Text Box"
                : selection && !selectedChatGroup && !selectedNodeSectionID
                  ? "Choose a chat grouping"
                : collaboration
                  ? collaborationNodeLabel(collaboration)
                : collaborations.length > 1 ? "Choose a chat grouping" : message.subject?.trim() || "New email Node"}
            </span>
          </span>
        )}
        headerTrailing={selection && !replyTargetID ? (
          <button
            type="button"
            data-chat-new-node-destination="true"
            aria-label="Choose New Node and New Text Box"
            title="New Node · New Text Box"
            aria-pressed={newNodeDestinationSelected}
            onClick={startNewFloatingNodeChat}
            style={{ position: "relative", width: 29, height: 27, flex: "0 0 auto", display: "grid", placeItems: "center", border: newNodeDestinationSelected ? "1px solid rgba(100,116,139,0.36)" : "1px solid rgba(148,163,184,0.26)", borderRadius: 8, background: "rgba(255,255,255,0.78)", color: "#475569", cursor: "pointer", padding: 0, boxShadow: newNodeDestinationSelected ? "0 4px 10px rgba(100,116,139,0.16)" : "1px 1px 4px rgba(15,23,42,0.06)" }}
          >
            <ExplorerRowIcon kind="node" />
            <strong aria-hidden="true" style={{ position: "absolute", right: 2, bottom: 1, width: 11, height: 11, display: "grid", placeItems: "center", borderRadius: 999, background: "#ffffff", color: "#475569", fontSize: 10, lineHeight: 1 }}>+</strong>
          </button>
        ) : undefined}
        sectionLabelsByBlockID={sectionLabelsByBlockID}
        sectionNodeIDsByBlockID={sectionNodeIDsByBlockID}
        sectionNodeLabelsByNodeID={sectionNodeLabelsByNodeID}
        sectionNodeOrder={sectionNodeOrder}
        sectionKeysByMessageID={sectionKeysByChatID}
        sectionActionLabel="New chat"
        selectSectionOnClick={Boolean(selection && !replyTargetID)}
        selectedSectionKey={selectedChatGroupKey}
        selectedNodeSectionID={selectedNodeSectionID}
        flashedSectionKey={destinationFlash.sectionKey}
        flashedNodeSectionID={destinationFlash.nodeID}
        composerDestination={replyTargetID ? undefined : composerDestination}
        composerDestinationError={replyTargetID ? undefined : selectionDestinationError}
        reserveScrollbarGutter
        selectionAnchor={replyTargetID ? undefined : selectionAnchor}
        draft={draft}
        companyUsers={principals}
        draftAttachments={draftAttachments}
        replyTargetID={replyTargetID}
        heightStorageKey={"mangorts.email-collaboration-chat-height:" + companyID}
        fillHeight
        active={active}
        currentUserID={currentUserID}
        activeMessageID={activeMessageID}
        composerFocusRequestID={composerFocusRequestID}
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
        onSectionAction={selectExistingChatGroup}
        onNodeSectionAction={selectNodeChatDestination}
        onClearComposerDestination={cancelChatGroupDestination}
        onReply={(messageID) => {
          const replyMessage = messages.find((item) => item.id === messageID);
          const replyNodeID = nodeIDByChatID[messageID]?.trim() ?? "";
          const replySectionKey = sectionKeysByChatID[messageID] ?? "";
          const replyCollaboration = collaborations.find((item) => item.node_id === replyNodeID);
          if (replyCollaboration && replyCollaboration.collaboration_id !== collaboration?.collaboration_id) {
            acceptCollaboration(replyCollaboration, false);
          }
          if (replySectionKey) rememberSelectedChatGroup(replySectionKey);
          selectionInternalEmailMessageIDRef.current = replyMessage?.selectionMessageID?.trim() ?? "";
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

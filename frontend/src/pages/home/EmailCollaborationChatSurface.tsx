import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON, isAbortError } from "../../modules/api/requestJSON";
import {
  convertTriageMessagesToExplorerTarget,
  ensureEmailCollaboration,
  getEmailCollaboration,
  listEmailCollaborations,
  type CommunicationsEmailCollaboration,
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
  editorEmailMessageAccent,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorTextBlockChats,
  parseEditorTextBlockContent,
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
} from "../../modules/nodes/nodeRecordStore";
import type { NodeRecord } from "../../modules/nodes/types";
import { assignNodeToLogicGateStatus } from "../../modules/kanban/kanbanApi";
import { upsertProjectRelationship } from "../../modules/project-management/projectManagementApi";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import {
  emailNodeImportRequired,
  formatEmailCollaborationChatError,
  resolveEmailCollaborationChatPlacement,
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
  threadMessages?: EmailMessage[];
  targetMessage?: EmailMessage;
  sharedInboxID?: string;
  accountEmail?: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  nodes: NodeRecord[];
  actionRequest: EmailCollaborationActionRequest;
  selection: EmailCollaborationSelection | null;
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
  onNodeAttachmentChange?: (attachment: EmailNodeAttachmentChange) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  onActionSuccess: (message: string, delayedCollaboration?: CommunicationsEmailCollaboration) => void;
  onActionRequestHandled: () => void;
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
  threadMessages = [],
  targetMessage,
  sharedInboxID,
  accountEmail,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  nodes,
  actionRequest,
  selection,
  onClearSelection,
  onNavigateToEmailSelection,
  onCollaborationChange,
  onNodeAttachmentChange,
  onError,
  onSuccess,
  onActionSuccess,
  onActionRequestHandled,
}: EmailCollaborationChatSurfaceProps) {
  const apiBase = readAuthConfig().apiBase;
  const requestJSON = React.useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [collaboration, setCollaboration] = React.useState<CommunicationsEmailCollaboration | null>(null);
  const [collaborations, setCollaborations] = React.useState<CommunicationsEmailCollaboration[]>([]);
  const [messages, setMessages] = React.useState<EditorTextBlockChatMessage[]>([]);
  const [nodeIDByChatID, setNodeIDByChatID] = React.useState<Record<string, string>>({});
  const [activeTextBlockID, setActiveTextBlockID] = React.useState("");
  const [sectionLabelsByBlockID, setSectionLabelsByBlockID] = React.useState<Record<string, string>>({});
  const [sectionLabelsByEmailMessageID, setSectionLabelsByEmailMessageID] = React.useState<Record<string, string>>({});
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
  const selectionInternalEmailMessageIDRef = React.useRef("");
  const sourceLoadKeyRef = React.useRef("");
  const requestedCollaborationIDRef = React.useRef("");
  const handledDestinationRequestRef = React.useRef<NonNullable<EmailCollaborationActionRequest> | null>(null);
  const pendingNewNodeIDRef = React.useRef("");
  const selectionChoiceKeyRef = React.useRef("");
  const messageCollaborationID = message.collaboration_id?.trim() ?? "";
  const messageCollaborationIDRef = React.useRef(messageCollaborationID);
  messageCollaborationIDRef.current = messageCollaborationID;
  const projectionContextRef = React.useRef({ message, threadMessages, nodes });
  projectionContextRef.current = { message, threadMessages, nodes };
  const enabled = active || Boolean(actionRequest);
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
  const collaborationID = collaboration?.collaboration_id?.trim() ?? "";
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

  const loadProjection = React.useCallback(async (
    nextCollaboration: CommunicationsEmailCollaboration | null,
    expectedLoadSequence?: number,
  ) => {
    const nextNodeID = nextCollaboration?.node_id?.trim() ?? "";
    if (!nextNodeID) {
      setMessages([]);
      setNodeIDByChatID({});
      setSectionLabelsByBlockID({});
      setSectionLabelsByEmailMessageID({});
      setActiveTextBlockID("");
      return;
    }
    invalidateNodeRecordStoreCaches(apiBase, companyID, nextNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nextNodeID);
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return;
    const internalEmailMessageID = collaborationTargetMessage.email_message_id?.trim()
      || (message.id.trim() === targetEmailMessageID ? message.email_message_id?.trim() : "")
      || (nextCollaboration?.message?.id?.trim() === targetEmailMessageID ? nextCollaboration.root_message_id?.trim() : "")
      || "";
    if (internalEmailMessageID) selectionInternalEmailMessageIDRef.current = internalEmailMessageID;
    const placement = resolveEmailCollaborationChatPlacement(
      projections,
      internalEmailMessageID || targetEmailMessageID,
      nextCollaboration?.attached_email_information_id,
    );
    setActiveTextBlockID(placement.blockID);
    const conversationMessages = [message, ...threadMessages].filter((candidate, index, items) => (
      items.findIndex((item) => item.id === candidate.id) === index
    ));
    const messageByInternalID = new Map(conversationMessages.flatMap((candidate) => {
      const internalID = candidate.email_message_id?.trim() ?? "";
      return internalID ? [[internalID, candidate] as const] : [];
    }));
    const chats = parseEditorTextBlockChats(projections);
    const linkedBlocks = listEditorTextBlockProjections(projections).filter((projection) => {
      const content = parseEditorTextBlockContent(projection.information);
      const internalIDs = content.emailMessageIDs?.length ? content.emailMessageIDs : content.emailMessageID ? [content.emailMessageID] : [];
      return internalIDs.some((internalID) => messageByInternalID.has(internalID.trim()));
    });
    if (linkedBlocks.length === 0) {
      setMessages(placement.messages);
      setSectionLabelsByBlockID({});
      setSectionLabelsByEmailMessageID({});
      return;
    }
    const blockLabels: Record<string, string> = {};
    const messageLabels: Record<string, string> = {};
    const conversationChats = linkedBlocks.flatMap((projection) => {
      const content = parseEditorTextBlockContent(projection.information);
      const internalIDs = content.emailMessageIDs?.length ? content.emailMessageIDs : content.emailMessageID ? [content.emailMessageID] : [];
      const candidates = internalIDs.map((internalID) => messageByInternalID.get(internalID.trim())).filter((candidate): candidate is EmailMessage => Boolean(candidate));
      const candidate = candidates[0];
      const sender = candidate?.from?.map((address) => address.name?.trim() || address.email?.trim()).filter(Boolean).join(", ") || "Email message";
      const date = candidate?.date ? new Date(candidate.date * 1000).toLocaleString() : "";
      blockLabels[projection.information_id] = candidates.length > 1
        ? `${candidates.length} messages in this email thread`
        : date ? `${sender} · ${date}` : sender;
      for (const internalID of internalIDs) {
        const exact = messageByInternalID.get(internalID.trim());
        if (!exact) continue;
        const exactSender = exact.from?.map((address) => address.name?.trim() || address.email?.trim()).filter(Boolean).join(", ") || "Email message";
        const exactDate = exact.date ? new Date(exact.date * 1000).toLocaleString() : "";
        messageLabels[internalID.trim()] = exactDate ? `${exactSender} · ${exactDate}` : exactSender;
      }
      return chats.filter((chat) => chat.blockID === projection.information_id);
    });
    setMessages(conversationChats);
    setNodeIDByChatID(Object.fromEntries(conversationChats.map((chat) => [chat.id, nextNodeID])));
    setSectionLabelsByBlockID(blockLabels);
    setSectionLabelsByEmailMessageID(messageLabels);
  }, [apiBase, companyID, message, targetEmailMessageID, threadMessages]);

  const loadThreadProjections = React.useCallback(async (
    items: CommunicationsEmailCollaboration[],
    activeDestination: CommunicationsEmailCollaboration | null,
    expectedLoadSequence?: number,
  ) => {
    if (items.length === 0) {
      setMessages([]);
      setNodeIDByChatID({});
      setSectionLabelsByBlockID({});
      setSectionLabelsByEmailMessageID({});
      setActiveTextBlockID("");
      return;
    }
    const loaded = await Promise.all(items.map(async (item) => {
      invalidateNodeRecordStoreCaches(apiBase, companyID, item.node_id);
      return { item, projections: await getNodeInformationProjectionSingleFlight(apiBase, companyID, item.node_id) };
    }));
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return;
    const projectionContext = projectionContextRef.current;
    const conversationMessages = [projectionContext.message, ...projectionContext.threadMessages].filter((candidate, index, all) => (
      all.findIndex((other) => other.id === candidate.id) === index
    ));
    const messageByInternalID = new Map(conversationMessages.flatMap((candidate) => {
      const internalID = candidate.email_message_id?.trim() ?? "";
      return internalID ? [[internalID, candidate] as const] : [];
    }));
    const blockLabels: Record<string, string> = {};
    const chatNodes: Record<string, string> = {};
    const allChats: EditorTextBlockChatMessage[] = [];
    let activeBlockID = "";
    for (const { item, projections } of loaded) {
      const internalEmailMessageID = collaborationTargetMessage.email_message_id?.trim()
        || (item.message?.id?.trim() === targetEmailMessageID ? item.message.email_message_id?.trim() : "")
        || "";
      if (internalEmailMessageID) selectionInternalEmailMessageIDRef.current = internalEmailMessageID;
      const placement = resolveEmailCollaborationChatPlacement(
        projections,
        internalEmailMessageID || targetEmailMessageID,
        item.attached_email_information_id,
      );
      if (activeDestination?.collaboration_id === item.collaboration_id) activeBlockID = placement.blockID;
      const chats = parseEditorTextBlockChats(projections);
      const linkedBlocks = listEditorTextBlockProjections(projections).filter((projection) => {
        const content = parseEditorTextBlockContent(projection.information);
        const internalIDs = content.emailMessageIDs?.length ? content.emailMessageIDs : content.emailMessageID ? [content.emailMessageID] : [];
        return internalIDs.some((internalID) => messageByInternalID.has(internalID.trim()));
      });
      const nodeTitle = projectionContext.nodes.find((candidate) => candidate.node_id === item.node_id)?.name?.trim()
        || "Node " + item.node_id.slice(0, 8);
      const linkedBlockIDs = new Set(linkedBlocks.map((projection) => projection.information_id));
      if (placement.blockID) linkedBlockIDs.add(placement.blockID);
      for (const linkedBlockID of linkedBlockIDs) blockLabels[linkedBlockID] = nodeTitle;
      const placementChats = [
        ...placement.messages,
        ...chats.filter((candidate) => linkedBlockIDs.has(candidate.blockID)),
      ];
      for (const chat of placementChats) {
        blockLabels[chat.blockID] = nodeTitle;
        if (!chatNodes[chat.id]) {
          chatNodes[chat.id] = item.node_id;
          allChats.push(chat);
        }
      }
    }
    setMessages(allChats);
    setNodeIDByChatID(chatNodes);
    setSectionLabelsByBlockID(blockLabels);
    setSectionLabelsByEmailMessageID({});
    setActiveTextBlockID(activeBlockID);
  }, [apiBase, collaborationTargetMessage.email_message_id, companyID, targetEmailMessageID]);

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

  const refreshCollaborationByID = React.useCallback(async (
    collaborationID: string,
    expectedLoadSequence?: number,
  ) => {
    const cleanCollaborationID = collaborationID.trim();
    if (!cleanCollaborationID) return null;
    const refreshed = await getEmailCollaboration(companyID, cleanCollaborationID);
    if (!refreshed) return null;
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return null;
    acceptCollaboration(refreshed);
    const nextItems = collaborationsRef.current.some((item) => item.collaboration_id === refreshed.collaboration_id)
      ? collaborationsRef.current.map((item) => item.collaboration_id === refreshed.collaboration_id ? refreshed : item)
      : [...collaborationsRef.current, refreshed];
    collaborationsRef.current = nextItems;
    await loadThreadProjections(nextItems, collaborationRef.current, expectedLoadSequence);
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return null;
    onSuccess();
    return refreshed;
  }, [acceptCollaboration, companyID, loadThreadProjections, onSuccess]);
  const refreshCollaborationByIDRef = React.useRef(refreshCollaborationByID);
  refreshCollaborationByIDRef.current = refreshCollaborationByID;
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
      requestedCollaborationIDRef.current = "";
      pendingNewNodeIDRef.current = "";
      selectionChoiceKeyRef.current = "";
      setCollaboration(null);
      collaborationsRef.current = [];
      setCollaborations([]);
      setMessages([]);
      setNodeIDByChatID({});
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
    void listEmailCollaborations({
      companyID,
      messageID: message.id,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
    })
      .then(async (items) => {
        if (loadSequenceRef.current !== requestSequence) return;
        collaborationsRef.current = items;
        setCollaborations(items);
        const activeCollaborationID = collaborationRef.current?.collaboration_id?.trim() || messageCollaborationIDRef.current;
        const nextCollaboration = items.find((item) => item.collaboration_id === activeCollaborationID)
          ?? (items.length === 1 ? items[0] : null);
        acceptCollaboration(nextCollaboration);
        await loadThreadProjections(items, nextCollaboration, requestSequence);
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
  }, [acceptCollaboration, accountEmail, companyID, enabled, loadThreadProjections, message.id, message.thread_id, onClearSelection, onError, onSuccess, sharedInboxID, sourceKey]);

  React.useEffect(() => {
    if (!enabled || !messageCollaborationID) return undefined;
    if (collaborationRef.current?.collaboration_id?.trim() === messageCollaborationID) return undefined;
    if (requestedCollaborationIDRef.current === messageCollaborationID) return undefined;
    requestedCollaborationIDRef.current = messageCollaborationID;
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    setLoading(true);
    void getEmailCollaboration(companyID, messageCollaborationID)
      .then(async (resolved) => {
        if (loadSequenceRef.current !== requestSequence || !resolved) return;
        acceptCollaboration(resolved);
        const nextItems = collaborationsRef.current.some((item) => item.collaboration_id === resolved.collaboration_id)
          ? collaborationsRef.current
          : [...collaborationsRef.current, resolved];
        collaborationsRef.current = nextItems;
        await loadThreadProjections(nextItems, resolved, requestSequence);
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
  }, [acceptCollaboration, companyID, enabled, loadThreadProjections, messageCollaborationID, onError, onSuccess, sourceKey]);

  React.useEffect(() => {
    if (!active || !companyID || !collaborationID || !nodeID) return undefined;
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const refreshSequence = loadSequenceRef.current;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCollaborationByIDRef.current(collaborationID, refreshSequence).catch((cause) => {
          if (loadSequenceRef.current !== refreshSequence || isAbortError(cause)) return;
          realtimeErrorRef.current(formatEmailCollaborationChatError(cause, "Failed to refresh email chat."));
        });
      }, 80);
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, "chat:node:" + nodeID, {
      onAccepted: refresh,
      onChatMessageCreated(event) {
        if (event.company_id === companyID && event.node_id === nodeID) refresh();
      },
      onChatMessageUpdated(event) {
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
  }, [active, apiBase, collaborationID, companyID, nodeID]);

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

  const importIntoExistingNode = React.useCallback(async (targetNodeID: string, includeChat: boolean) => {
    const cleanNodeID = targetNodeID.trim();
    if (!cleanNodeID || submitting) return;
    const cleanDraft = draft.trim();
    setSubmitting(true);
    try {
      const providerMessageID = selection?.messageID?.trim() || message.id.trim();
      let emailMessageID = (collaborationTargetMessage.id.trim() === providerMessageID
        ? collaborationTargetMessage.email_message_id?.trim()
        : "")
        || (message.id.trim() === providerMessageID ? message.email_message_id?.trim() : "")
        || (collaboration?.message?.id?.trim() === providerMessageID ? collaboration.root_message_id?.trim() : "")
        || "";
      const currentNodeCollaboration = collaborations.find((item) => item.node_id === cleanNodeID);
      const shouldAttachEmail = emailNodeImportRequired(cleanNodeID, currentNodeCollaboration?.node_id ?? "", emailMessageID);
      const createdTimestamp = new Date().toISOString();
      const subject = message.subject?.trim() || "Email";
      const targetProjections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, cleanNodeID).catch(() => []);
      let attachedEmailInformationID = collaboration?.attached_email_information_id?.trim() ?? "";
      const existingTextBlockProjections = listEditorTextBlockProjections(targetProjections);
      const existingLinkedProjection = emailMessageID
        ? existingTextBlockProjections.find((projection) => {
          const content = parseEditorTextBlockContent(projection.information);
          return content.emailMessageID?.trim() === emailMessageID
            || content.emailMessageIDs?.some((messageID) => messageID.trim() === emailMessageID);
        })
        : undefined;
      const textBlockID = existingLinkedProjection?.information_id ?? generateStableInformationID();
      const existingEmailContents = existingTextBlockProjections.map((projection) => parseEditorTextBlockContent(projection.information));
      const existingMessageAccent = existingEmailContents
        .find((content) => content.emailMessageID?.trim() === emailMessageID
          || content.emailMessageIDs?.some((messageID) => messageID.trim() === emailMessageID))?.emailAccent?.trim() ?? "";
      const existingEmailAccents = existingEmailContents
        .filter((content) => content.emailMessageID?.trim() !== emailMessageID
          && !content.emailMessageIDs?.some((messageID) => messageID.trim() === emailMessageID))
        .map((content) => content.emailAccent?.trim() ?? "").filter(Boolean);
      const textBlockWrite = !includeChat || existingLinkedProjection ? undefined : {
        type: EDITOR_TEXT_BLOCK_TYPE,
        informationID: textBlockID,
        information: buildEditorTextBlockProjectionPayload({
          title: "Email: " + subject,
          document: "",
          attachments: [],
          emailMessageID,
          emailAccent: existingMessageAccent || editorEmailMessageAccent(emailMessageID, existingEmailAccents),
        }),
      };
      let initialChatWrite: { type: string; informationID: string; information: string } | undefined;
      if (includeChat && (cleanDraft || draftAttachments.length > 0)) {
        const informationID = generateStableInformationID();
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
        initialChatWrite = {
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          informationID,
          information: buildEditorTextBlockChatPayload({
            blockID: textBlockID,
            selectionSource: "email",
            selectionMessageID: emailMessageID,
            selectionQuote: selection?.quote,
            selectionStart: selection?.startOffset,
            selectionEnd: selection?.endOffset,
            authorID: author.userID,
            authorName: author.name,
            message: cleanDraft,
            createdTimestamp,
            attachments: draftAttachments,
            mentionedUserIDs: mentions.mentionedUserIDs,
            mentionedGroupIDs: mentions.mentionedGroupIDs,
          }),
        };
      }
      if (shouldAttachEmail || textBlockWrite || initialChatWrite) {
        const conversionResult = await convertTriageMessagesToExplorerTarget({
          companyID,
          sharedInboxID,
          accountEmail: sharedInboxID?.trim() ? undefined : accountEmail,
          target: { mode: "existing_node", nodeID: cleanNodeID },
          messageIDs: [providerMessageID],
          linkedTextBlock: textBlockWrite,
          initialChat: initialChatWrite,
        });
        attachedEmailInformationID = conversionResult.attached_email_information_ids?.find((informationID) => informationID.trim())?.trim()
          || attachedEmailInformationID;
        emailMessageID = conversionResult.email_message_ids?.find((messageID) => messageID.trim())?.trim()
          || emailMessageID;
      }
      if (!emailMessageID) throw new Error("email_message_id_missing");
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      onNodeAttachmentChange?.({
        nodeID: cleanNodeID,
        messageID: providerMessageID,
        threadID: message.thread_id,
        informationID: attachedEmailInformationID,
        logicGateIDs: nodes.find((node) => node.node_id === cleanNodeID)?.logic_gate_ids,
      });
      const importedCollaborations = await listEmailCollaborations({
        companyID,
        messageID: providerMessageID,
        threadID: message.thread_id,
        sharedInboxID,
        accountEmail,
      }).catch(() => []);
      setCollaborations(importedCollaborations);
      const importedCollaboration = importedCollaborations.find((item) => item.node_id === cleanNodeID) ?? null;
      if (importedCollaboration) acceptCollaboration(importedCollaboration);
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setReplyTargetID("");
      onClearSelection();
      onSuccess();
      onActionSuccess("Email was added to node.");
      onActionRequestHandled();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, includeChat ? "Failed to import this email chat into the node." : "Failed to import this email into the node."));
      onActionRequestHandled();
    } finally {
      setSubmitting(false);
    }
  }, [acceptCollaboration, accountEmail, apiBase, author.name, author.userID, collaboration?.attached_email_information_id, collaborations, companyID, draft, draftAttachments, message.id, message.subject, message.thread_id, nodes, onActionRequestHandled, onActionSuccess, onClearSelection, onError, onNodeAttachmentChange, onSuccess, principals, requestJSON, selectedMentionPrincipals, selection, sharedInboxID, submitting]);

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
    if (!emailMessageID) throw new Error("email_message_id_missing");
    invalidateNodeRecordStoreCaches(apiBase, companyID, activeNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, activeNodeID);
    const placement = resolveEmailCollaborationChatPlacement(
      projections,
      emailMessageID,
      activeCollaboration.attached_email_information_id,
    );
    if (placement.blockID && emailMessageID) {
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      setActiveTextBlockID(placement.blockID);
      return placement.blockID;
    }

    const textBlockID = generateStableInformationID();
    const existingEmailContents = listEditorTextBlockProjections(projections)
      .map((projection) => parseEditorTextBlockContent(projection.information));
    const unavailableAccents = existingEmailContents
      .map((content) => content.emailAccent?.trim() ?? "")
      .filter(Boolean);
    const linkedTextBlock = {
      type: EDITOR_TEXT_BLOCK_TYPE,
      informationID: textBlockID,
      information: buildEditorTextBlockProjectionPayload({
        title: "Email: " + (message.subject?.trim() || "Email"),
        document: "",
        attachments: [],
        emailMessageID,
        emailAccent: editorEmailMessageAccent(emailMessageID, unavailableAccents),
      }),
    };
    const conversionResult = await convertTriageMessagesToExplorerTarget({
      companyID,
      sharedInboxID,
      accountEmail: sharedInboxID?.trim() ? undefined : accountEmail,
      target: { mode: "existing_node", nodeID: activeNodeID },
      messageIDs: [providerMessageID],
      linkedTextBlock,
    });
    emailMessageID = conversionResult.email_message_ids?.find((candidate) => candidate.trim())?.trim() || emailMessageID;
    if (!emailMessageID) throw new Error("email_message_id_missing");
    selectionInternalEmailMessageIDRef.current = emailMessageID;
    invalidateNodeRecordStoreCaches(apiBase, companyID, activeNodeID);
    setActiveTextBlockID(textBlockID);
    return textBlockID;
  }, [accountEmail, apiBase, collaborationTargetMessage, companyID, message, selection?.messageID, sharedInboxID]);
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
    if (collaborations.length > 1 && !collaboration) {
      onError("Choose the destination Node before sending this chat.");
      return;
    }
    if (collaboration) {
      await importIntoExistingNode(collaboration.node_id, true);
      return;
    }
    setSubmitting(true);
    try {
      const textBlockID = generateStableInformationID();
      const chatID = generateStableInformationID();
      const placeholderMessageID = generateStableInformationID();
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
      const created = await ensureEmailCollaboration({
        companyID,
        message: collaborationTargetMessage,
        messageID: targetEmailMessageID,
        threadID: message.thread_id,
        sharedInboxID,
        accountEmail,
        newNodeID: pendingNewNodeIDRef.current || generateStableInformationID(),
        linkedTextBlock: {
          type: EDITOR_TEXT_BLOCK_TYPE,
          informationID: textBlockID,
          information: buildEditorTextBlockProjectionPayload({
            title: "Email: " + (message.subject?.trim() || "Email"),
            document: "",
            attachments: [],
            emailMessageID: placeholderMessageID,
            emailAccent: editorEmailMessageAccent(placeholderMessageID, []),
          }),
        },
        initialChat: {
          type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
          informationID: chatID,
          information: buildEditorTextBlockChatPayload({
            blockID: textBlockID,
            selectionSource: "email",
            selectionMessageID: placeholderMessageID,
            selectionQuote: selection?.quote,
            selectionStart: selection?.startOffset,
            selectionEnd: selection?.endOffset,
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
      pendingNewNodeIDRef.current = "";
      acceptCollaboration(created);
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setReplyTargetID("");
      onClearSelection();
      await loadProjection(created, loadSequenceRef.current);
      onSuccess();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is still here."));
    } finally {
      setSubmitting(false);
    }
  }, [acceptCollaboration, accountEmail, author.name, author.userID, collaboration, collaborationTargetMessage, collaborations.length, companyID, draft, draftAttachments, importIntoExistingNode, loadProjection, message.subject, message.thread_id, onClearSelection, onError, onSuccess, principals, selectedMentionPrincipals, selection, sharedInboxID, submitting, targetEmailMessageID]);
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
      void loadProjection(collaboration, rollbackSequence).catch((refreshCause) => {
        if (loadSequenceRef.current !== rollbackSequence || isAbortError(refreshCause)) return;
        onError(formatEmailCollaborationChatError(refreshCause, "Delete failed, and email chat could not refresh."));
      });
    }
  }, [collaboration, companyID, currentUserID, loadProjection, messages, nodeID, nodeIDByChatID, onError, onSuccess, requestJSON]);

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

  const selectCollaborationTarget = React.useCallback(async (nextCollaboration: CommunicationsEmailCollaboration) => {
    pendingNewNodeIDRef.current = "";
    acceptCollaboration(nextCollaboration);
    setReplyTargetID("");
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    setLoading(true);
    try {
      await loadThreadProjections(collaborationsRef.current, nextCollaboration, requestSequence);
      if (loadSequenceRef.current === requestSequence) onSuccess();
    } catch (cause) {
      if (loadSequenceRef.current === requestSequence && !isAbortError(cause)) {
        onError(formatEmailCollaborationChatError(cause, "Failed to load this Node chat."));
      }
    } finally {
      if (loadSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [acceptCollaboration, loadThreadProjections, onError, onSuccess]);

  const startNewFloatingNodeChat = React.useCallback(() => {
    pendingNewNodeIDRef.current = generateStableInformationID();
    acceptCollaboration(null);
    setMessages([]);
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
        height: "100%",
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
        headerLeading={collaborations.length > 1 && !collaboration ? (
          <select
            aria-label="Chat destination Node"
            value=""
            onChange={(event) => {
              const selected = collaborations.find((item) => item.collaboration_id === event.target.value);
              if (selected) void selectCollaborationTarget(selected);
            }}
            style={{ minWidth: 0, maxWidth: 220 }}
          >
            <option value="">Choose destination Node</option>
            {collaborations.map((item) => <option key={item.collaboration_id} value={item.collaboration_id}>{collaborationNodeLabel(item)}</option>)}
          </select>
        ) : (
          <span data-email-chat-node-header="true" style={{ minWidth: 0, display: "inline-flex", alignItems: "center", gap: 7 }}>
            <ExplorerRowIcon kind="node" />
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {collaboration ? collaborationNodeLabel(collaboration) : message.subject?.trim() || "New email Node"}
            </span>
          </span>
        )}
        sectionLabelsByBlockID={sectionLabelsByBlockID}
        sectionLabelsByEmailMessageID={sectionLabelsByEmailMessageID}
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
        onReply={(messageID) => {
          const replyMessage = messages.find((item) => item.id === messageID);
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

import React from "react";
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
  parseEditorTextBlockContent,
  type EditorChatAttachment,
  type EditorTextBlockChatMessage,
} from "../../modules/editor/editorProjection";
import { ChatPane } from "../../modules/editor/NodeWorkspaceSurfaceParts";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
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
import { EmailCollaborationParticipantRoster } from "./EmailCollaborationParticipantRoster";
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
  onClose: () => void;
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
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
  onNodeAttachmentChange?: (attachment: EmailNodeAttachmentChange) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
  onActionSuccess: (message: string) => void;
  onActionRequestHandled: () => void;
};

const GROUP_MENTION_PREFIX = "group:";
const EMAIL_ACTION_TEXT = "#334155";
const EMAIL_ACTION_ACCENT = "#4f46e5";
const emailActionSurfaceStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  border: "1px solid transparent",
  borderRadius: 14,
  background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
  color: EMAIL_ACTION_TEXT,
  padding: 10,
  boxShadow: EDITOR_NEU_PANEL_SHADOW,
};
const emailActionOptionStyle: React.CSSProperties = {
  minHeight: 31,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
  borderRadius: 9,
  background: EDITOR_NEU_SURFACE,
  color: EMAIL_ACTION_TEXT,
  padding: "5px 9px",
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 850,
  boxShadow: EDITOR_NEU_SHADOW,
};

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
  onClose,
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
  const [activeTextBlockID, setActiveTextBlockID] = React.useState("");
  const [draft, setDraft] = React.useState("");
  const [draftAttachments, setDraftAttachments] = React.useState<EditorChatAttachment[]>([]);
  const [selectedMentionPrincipals, setSelectedMentionPrincipals] = React.useState<MentionableCompanyUser[]>([]);
  const [replyTargetID, setReplyTargetID] = React.useState("");
  const [activeMessageID, setActiveMessageID] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [chatTargetMenuOpen, setChatTargetMenuOpen] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const loadSequenceRef = React.useRef(0);
  const collaborationRef = React.useRef<CommunicationsEmailCollaboration | null>(null);
  const selectionInternalEmailMessageIDRef = React.useRef("");
  const sourceLoadKeyRef = React.useRef("");
  const requestedCollaborationIDRef = React.useRef("");
  const handledDestinationRequestRef = React.useRef<NonNullable<EmailCollaborationActionRequest> | null>(null);
  const pendingNewNodeIDRef = React.useRef("");
  const selectionChoiceKeyRef = React.useRef("");
  const messageCollaborationID = message.collaboration_id?.trim() ?? "";
  const messageCollaborationIDRef = React.useRef(messageCollaborationID);
  messageCollaborationIDRef.current = messageCollaborationID;
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
      setActiveTextBlockID("");
      return;
    }
    invalidateNodeRecordStoreCaches(apiBase, companyID, nextNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nextNodeID);
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return;
    const internalEmailMessageID = nextCollaboration?.root_message_id?.trim()
      || collaborationTargetMessage.email_message_id?.trim()
      || message.email_message_id?.trim()
      || "";
    if (internalEmailMessageID) selectionInternalEmailMessageIDRef.current = internalEmailMessageID;
    const placement = resolveEmailCollaborationChatPlacement(
      projections,
      internalEmailMessageID || targetEmailMessageID,
      nextCollaboration?.attached_email_information_id,
    );
    setActiveTextBlockID(placement.blockID);
    setMessages(placement.messages);
  }, [apiBase, companyID, targetEmailMessageID]);

  const acceptCollaboration = React.useCallback((nextCollaboration: CommunicationsEmailCollaboration | null) => {
    collaborationRef.current = nextCollaboration;
    setCollaboration(nextCollaboration);
    if (nextCollaboration) {
      setCollaborations((current) => current.some((item) => item.collaboration_id === nextCollaboration.collaboration_id)
        ? current.map((item) => item.collaboration_id === nextCollaboration.collaboration_id ? nextCollaboration : item)
        : [...current, nextCollaboration]);
    }
    if (nextCollaboration) onCollaborationChange?.(nextCollaboration);
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
    await loadProjection(refreshed, expectedLoadSequence);
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return null;
    onSuccess();
    return refreshed;
  }, [acceptCollaboration, companyID, loadProjection, onSuccess]);

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
      setCollaborations([]);
      setMessages([]);
      setReplyTargetID("");
      setActiveTextBlockID("");
      setActiveMessageID("");
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setChatTargetMenuOpen(false);
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
        setCollaborations(items);
        const activeCollaborationID = collaborationRef.current?.collaboration_id?.trim() || messageCollaborationIDRef.current;
        const nextCollaboration = items.find((item) => item.collaboration_id === activeCollaborationID) ?? items[0] ?? null;
        acceptCollaboration(nextCollaboration);
        if (nextCollaboration) await loadProjection(nextCollaboration, requestSequence);
        else {
          setMessages([]);
          setActiveTextBlockID("");
        }
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
  }, [acceptCollaboration, accountEmail, companyID, enabled, loadProjection, message.id, message.thread_id, onClearSelection, onError, onSuccess, sharedInboxID, sourceKey]);

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
        await loadProjection(resolved, requestSequence);
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
  }, [acceptCollaboration, companyID, enabled, loadProjection, messageCollaborationID, onError, onSuccess, sourceKey]);

  React.useEffect(() => {
    if (!active || !companyID || !collaborationID || !nodeID) return undefined;
    let refreshTimer: number | null = null;
    const refresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      const refreshSequence = loadSequenceRef.current;
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        void refreshCollaborationByID(collaborationID, refreshSequence).catch((cause) => {
          if (loadSequenceRef.current !== refreshSequence || isAbortError(cause)) return;
          onError(formatEmailCollaborationChatError(cause, "Failed to refresh email chat."));
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
  }, [active, apiBase, collaborationID, companyID, nodeID, onError, refreshCollaborationByID]);

  const ensureCollaboration = React.useCallback(async (priority?: number, createNew = false): Promise<CommunicationsEmailCollaboration> => {
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
    acceptCollaboration(created);
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
        ? existingTextBlockProjections.find((projection) => (
          parseEditorTextBlockContent(projection.information).emailMessageID?.trim() === emailMessageID
        ))
        : undefined;
      const textBlockID = existingLinkedProjection?.information_id ?? generateStableInformationID();
      const existingEmailContents = existingTextBlockProjections.map((projection) => parseEditorTextBlockContent(projection.information));
      const existingMessageAccent = existingEmailContents
        .find((content) => content.emailMessageID?.trim() === emailMessageID)?.emailAccent?.trim() ?? "";
      const existingEmailAccents = existingEmailContents
        .filter((content) => content.emailMessageID?.trim() !== emailMessageID)
        .map((content) => content.emailAccent?.trim() ?? "").filter(Boolean);
      const textBlockWrite = existingLinkedProjection ? undefined : {
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
      if (shouldAttachEmail) {
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
      } else {
        if (textBlockWrite) {
          await requestJSON("/v1/nodes/" + encodeURIComponent(cleanNodeID) + "/information", {
            method: "POST",
            json: {
              company_id: companyID,
              type: textBlockWrite.type,
              information_id: textBlockWrite.informationID,
              information: textBlockWrite.information,
            },
          });
        }
        if (initialChatWrite) {
          await requestJSON("/v1/nodes/" + encodeURIComponent(cleanNodeID) + "/information", {
            method: "POST",
            json: {
              company_id: companyID,
              type: initialChatWrite.type,
              information_id: initialChatWrite.informationID,
              information: initialChatWrite.information,
            },
          });
        }
      }
      if (!emailMessageID) throw new Error("email_message_id_missing");
      selectionInternalEmailMessageIDRef.current = emailMessageID;
      onNodeAttachmentChange?.({
        nodeID: cleanNodeID,
        messageID: providerMessageID,
        threadID: message.thread_id,
        informationID: attachedEmailInformationID,
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
  }, [acceptCollaboration, accountEmail, apiBase, author.name, author.userID, collaboration?.attached_email_information_id, collaborations, companyID, draft, draftAttachments, message.id, message.subject, message.thread_id, onActionRequestHandled, onActionSuccess, onClearSelection, onError, onNodeAttachmentChange, onSuccess, principals, requestJSON, selectedMentionPrincipals, selection, sharedInboxID, submitting]);

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
  const saveCurrentDraftToCollaboration = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration, ensuredTextBlockID = ""): Promise<string> => {
    const cleanDraft = draft.trim();
    if (!cleanDraft && draftAttachments.length === 0) return "";
    const activeNodeID = activeCollaboration.node_id.trim();
    const activeBlockID = ensuredTextBlockID.trim() || await ensureLinkedEmailTextBlock(activeCollaboration);
    if (!activeNodeID || !activeBlockID) throw new Error("email_collaboration_node_missing");
    const selectionEmailMessageID = selectionInternalEmailMessageIDRef.current.trim();
    if (!replyTargetID && !selectionEmailMessageID) throw new Error("email_message_id_missing");
    const informationID = generateStableInformationID();
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
      selectionSource: !replyTargetID ? "email" : undefined,
      selectionMessageID: !replyTargetID ? selectionEmailMessageID : undefined,
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
    await requestJSON("/v1/nodes/" + encodeURIComponent(activeNodeID) + "/information", {
      method: "POST",
      json: {
        company_id: companyID,
        type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
        information_id: informationID,
        information: buildEditorTextBlockChatPayload({
          blockID: activeBlockID,
          parentID: replyTargetID,
          selectionSource: !replyTargetID ? "email" : undefined,
          selectionMessageID: !replyTargetID ? selectionEmailMessageID : undefined,
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
    setMessages((current) => current.some((item) => item.id === informationID) ? current : [...current, nextMessage]);
    setDraft("");
    setDraftAttachments([]);
    setSelectedMentionPrincipals([]);
    setReplyTargetID("");
    onClearSelection();
    const refreshSequence = loadSequenceRef.current;
    void refreshCollaborationByID(activeCollaboration.collaboration_id, refreshSequence).catch((cause) => {
      if (loadSequenceRef.current !== refreshSequence || isAbortError(cause)) return;
      onError(formatEmailCollaborationChatError(cause, "Message saved, but chat refresh failed."));
    });
    return activeBlockID;
  }, [author.name, author.userID, companyID, draft, draftAttachments, ensureLinkedEmailTextBlock, message.id, onClearSelection, onError, principals, refreshCollaborationByID, replyTargetID, requestJSON, selectedMentionPrincipals, selection]);

  const createEmailNode = React.useCallback(async (priority?: number, logicGateID = "", projectID = "", createNew = false) => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const cleanLogicGateID = logicGateID.trim();
      const cleanProjectID = projectID.trim();
      if (cleanProjectID && !cleanLogicGateID) throw new Error("A Project email Node must belong to a Logic Gate.");
      if (cleanLogicGateID && !priority) throw new Error("A Logic Gate email Node requires a priority.");
      const created = await ensureCollaboration(priority, createNew);
      const linkedTextBlockID = await ensureLinkedEmailTextBlock(created);
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
      }
      if (cleanProjectID) {
        await upsertProjectRelationship({
          companyID,
          projectID: cleanProjectID,
          resourceType: "node",
          resourceID: created.node_id,
        });
      }
      await saveCurrentDraftToCollaboration(created, linkedTextBlockID);
      onSuccess();
      onActionSuccess(cleanProjectID
        ? "Email Node was sent to project."
        : cleanLogicGateID ? "Email Node was sent to Logic Gate." : "Floating node was created.");
      onActionRequestHandled();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to create a node for this email."));
      onActionRequestHandled();
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, companyID, ensureCollaboration, ensureLinkedEmailTextBlock, message.subject, onActionRequestHandled, onActionSuccess, onError, onSuccess, saveCurrentDraftToCollaboration, submitting]);

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
      void createEmailNode(destination.priority, destination.logicGateID);
      return;
    }
    if (destination.kind === "project") {
      void createEmailNode(destination.priority, destination.logicGateID, destination.projectID);
      return;
    }
    void createEmailNode(undefined, "", "", true);
  }, [actionRequest, createEmailNode, importIntoExistingNode, loading, submitting]);

  const submit = React.useCallback(async () => {
    const cleanDraft = draft.trim();
    if ((!cleanDraft && draftAttachments.length === 0) || submitting) return;
    setSubmitting(true);
    try {
      const activeCollaboration = await ensureCollaboration();
      await saveCurrentDraftToCollaboration(activeCollaboration);
      onSuccess();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is still here."));
    } finally {
      setSubmitting(false);
    }
  }, [draft, draftAttachments, ensureCollaboration, onError, onSuccess, saveCurrentDraftToCollaboration, submitting]);
  const attachFiles = React.useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    try {
      const activeCollaboration = await ensureCollaboration();
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
  }, [companyID, ensureCollaboration, ensureLinkedEmailTextBlock, onError, onSuccess, requestJSON]);

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
      onSuccess();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_delete_email_chat");
      const rollbackSequence = loadSequenceRef.current;
      void loadProjection(collaboration, rollbackSequence).catch((refreshCause) => {
        if (loadSequenceRef.current !== rollbackSequence || isAbortError(refreshCause)) return;
        onError(formatEmailCollaborationChatError(refreshCause, "Delete failed, and email chat could not refresh."));
      });
    }
  }, [collaboration, companyID, currentUserID, loadProjection, messages, nodeID, onError, onSuccess, requestJSON]);

  const editMessage = React.useCallback(async (messageID: string, nextText: string) => {
    const existing = messages.find((item) => item.id === messageID);
    if (!existing || !nodeID || !canEditEditorTextBlockChatMessage(existing, currentUserID)) {
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
      await requestJSON("/v1/nodes/" + encodeURIComponent(nodeID) + "/projection/" + encodeURIComponent(messageID), {
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
  }, [companyID, currentUserID, messages, nodeID, onError, onSuccess, principals, requestJSON]);

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
    setChatTargetMenuOpen(false);
    pendingNewNodeIDRef.current = "";
    acceptCollaboration(nextCollaboration);
    setReplyTargetID("");
    const requestSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = requestSequence;
    setLoading(true);
    try {
      await loadProjection(nextCollaboration, requestSequence);
      if (loadSequenceRef.current === requestSequence) onSuccess();
    } catch (cause) {
      if (loadSequenceRef.current === requestSequence && !isAbortError(cause)) {
        onError(formatEmailCollaborationChatError(cause, "Failed to load this Node chat."));
      }
    } finally {
      if (loadSequenceRef.current === requestSequence) setLoading(false);
    }
  }, [acceptCollaboration, loadProjection, onError, onSuccess]);

  const startNewFloatingNodeChat = React.useCallback(() => {
    setChatTargetMenuOpen(false);
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
      setChatTargetMenuOpen(false);
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
    if (collaborations.length > 1) {
      setChatTargetMenuOpen(true);
      return;
    }
    setChatTargetMenuOpen(false);
    if (collaborations.length === 1) {
      if (collaboration?.collaboration_id !== collaborations[0].collaboration_id) {
        void selectCollaborationTarget(collaborations[0]);
      }
      return;
    }
    startNewFloatingNodeChat();
  }, [collaboration?.collaboration_id, collaborations, loading, selection, selectCollaborationTarget, startNewFloatingNodeChat]);

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
        display: active ? "grid" : "none",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 6,
        padding: "8px 8px 8px 0",
        overflow: "hidden",
        background: EDITOR_NEU_SURFACE,
      }}
    >
      <div style={{ display: "grid", gap: 6 }}>
        {(loading || submitting) && (
          <div role="status" style={{ color: "rgba(100,116,139,0.78)", fontSize: 10.5, fontWeight: 800, padding: "2px 8px" }}>
            {loading ? "Loading chat" : "Saving comment"}
          </div>
        )}
        {collaborations.length > 0 && (
          <div aria-label="Connected email Node chats" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, padding: "0 4px" }}>
            <strong style={{ color: "#64748b", fontSize: 10 }}>Node chats</strong>
            {collaborations.map((item) => {
              const selected = collaboration?.collaboration_id === item.collaboration_id;
              return (
                <button
                  data-email-connected-chat-box="true"
                  data-active={selected ? "true" : "false"}
                  key={item.collaboration_id}
                  type="button"
                  disabled={loading}
                  onClick={() => { void selectCollaborationTarget(item); }}
                  style={{
                    ...emailActionOptionStyle,
                    minHeight: 27,
                    padding: "3px 8px",
                    border: selected ? "1px solid transparent" : emailActionOptionStyle.border,
                    background: selected
                      ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`
                      : emailActionOptionStyle.background,
                    color: selected ? EMAIL_ACTION_ACCENT : EMAIL_ACTION_TEXT,
                    cursor: loading ? "wait" : "pointer",
                  }}
                >
                  {collaborationNodeLabel(item)}
                </button>
              );
            })}
            {!collaboration && (
              <span style={{ color: EMAIL_ACTION_ACCENT, fontSize: 10.5, fontWeight: 850 }}>
                New floating Node
              </span>
            )}
          </div>
        )}
        {chatTargetMenuOpen && (
          <div
            data-email-comment-target-picker="true"
            role="dialog"
            aria-label="Choose Node for email comment"
            style={{ ...emailActionSurfaceStyle, margin: "0 4px" }}
          >
            <strong style={{ color: EMAIL_ACTION_ACCENT, fontSize: 11 }}>Choose where this comment belongs</strong>
            {collaborations.map((item) => (
              <button
                data-email-comment-target-option="node"
                key={item.collaboration_id}
                type="button"
                onClick={() => { void selectCollaborationTarget(item); }}
                style={{ ...emailActionOptionStyle, cursor: "pointer" }}
              >
                {collaborationNodeLabel(item)}
              </button>
            ))}
            <button
              data-email-comment-target-option="floating"
              type="button"
              onClick={startNewFloatingNodeChat}
              style={{ ...emailActionOptionStyle, cursor: "pointer" }}
            >
              Create floating node (a node without a Logic Gate)
            </button>
          </div>
        )}
      </div>
      <ChatPane
        blockID={blockID || "email-collaboration"}
        editable
        apiBase={apiBase}
        companyID={companyID}
        messages={messages}
        headerTrailing={(
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <EmailCollaborationParticipantRoster collaboration={collaboration} companyUsers={companyUsers} companyUserGroups={companyUserGroups} currentUserID={currentUserID} />
            <button
              type="button"
              aria-label="Close email comments"
              onClick={() => {
                selectionChoiceKeyRef.current = "";
                setChatTargetMenuOpen(false);
                onClose();
              }}
              style={{ border: 0, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 10.5, fontWeight: 800 }}
            >
              Close
            </button>
          </span>
        )}
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

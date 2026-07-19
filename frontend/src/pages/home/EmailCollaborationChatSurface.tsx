import React from "react";
import { readAuthConfig } from "../../auth/cognitoAuth";
import { createRequestJSON, isAbortError } from "../../modules/api/requestJSON";
import {
  convertTriageMessagesToExplorerTarget,
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
  buildEditorTextBlockProjectionPayload,
  canDeleteEditorTextBlockChatMessage,
  editorEmailMessageAccent,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
  parseEditorTextBlockContent,
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
import type { NodeRecord } from "../../modules/node-map/shared";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import { EmailCollaborationParticipantRoster } from "./EmailCollaborationParticipantRoster";
import {
  formatEmailCollaborationChatError,
} from "./emailCollaborationChat";
import { INBOX_PRIORITIES } from "./homeConstants";

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
  sharedInboxID?: string;
  accountEmail?: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  nodes: NodeRecord[];
  onOpenImportedNode?: (nodeID: string, informationID: string, emailMessageID: string) => void;
  selection: EmailCollaborationSelection | null;
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
  onError: (message: string) => void;
  onSuccess: () => void;
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
  active,
  id,
  companyID,
  currentUserID,
  message,
  sharedInboxID,
  accountEmail,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  nodes,
  onOpenImportedNode,
  selection,
  onClearSelection,
  onNavigateToEmailSelection,
  onCollaborationChange,
  onError,
  onSuccess,
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
  const [priorityMenuOpen, setPriorityMenuOpen] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<"chat" | "create" | "import">("chat");
  const [nodeSearch, setNodeSearch] = React.useState("");
  const [detectedNodeID, setDetectedNodeID] = React.useState("");
  const [resolvingNode, setResolvingNode] = React.useState(false);
  const [selectedPriority, setSelectedPriority] = React.useState<number | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const loadSequenceRef = React.useRef(0);
  const collaborationRef = React.useRef<CommunicationsEmailCollaboration | null>(null);
  const sourceLoadKeyRef = React.useRef("");
  const requestedCollaborationIDRef = React.useRef("");
  const messageCollaborationID = message.collaboration_id?.trim() ?? "";
  const messageCollaborationIDRef = React.useRef(messageCollaborationID);
  messageCollaborationIDRef.current = messageCollaborationID;
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

  const loadProjection = React.useCallback(async (
    nextCollaboration: CommunicationsEmailCollaboration | null,
    expectedLoadSequence?: number,
  ) => {
    const nextNodeID = nextCollaboration?.node_id?.trim() ?? "";
    if (!nextNodeID) {
      setMessages([]);
      return;
    }
    invalidateNodeRecordStoreCaches(apiBase, companyID, nextNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, nextNodeID);
    if (expectedLoadSequence !== undefined && loadSequenceRef.current !== expectedLoadSequence) return;
    const nextBlockID = nextCollaboration?.attached_email_information_id?.trim() ?? "";
    setMessages(parseEditorTextBlockChats(projections).filter((item) => !nextBlockID || item.blockID === nextBlockID));
  }, [apiBase, companyID]);

  const acceptCollaboration = React.useCallback((nextCollaboration: CommunicationsEmailCollaboration | null) => {
    collaborationRef.current = nextCollaboration;
    setCollaboration(nextCollaboration);
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
      requestedCollaborationIDRef.current = "";
      setCollaboration(null);
      setMessages([]);
      setReplyTargetID("");
      setActiveMessageID("");
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setPriorityMenuOpen(false);
      setSelectedPriority(null);
      setPendingAction("chat");
      setNodeSearch("");
      setDetectedNodeID("");
      setResolvingNode(false);
      setSubmitting(false);
      if (previousSourceKey) onClearSelection();
    }
    if (!active) {
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    const knownCollaborationID = collaborationRef.current?.collaboration_id?.trim()
      || messageCollaborationIDRef.current;
    requestedCollaborationIDRef.current = knownCollaborationID;
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
        acceptCollaboration(resolved);
        if (resolved) await loadProjection(resolved, requestSequence);
        else setMessages([]);
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
  }, [acceptCollaboration, accountEmail, active, companyID, loadProjection, message.id, message.thread_id, onClearSelection, onError, onSuccess, sharedInboxID, sourceKey]);

  React.useEffect(() => {
    if (!active || loading || collaboration || !message.id.trim() || nodes.length === 0) {
      if (collaboration) setDetectedNodeID("");
      return undefined;
    }
    let cancelled = false;
    setResolvingNode(true);
    const resolve = async () => {
      const cleanThreadID = message.thread_id?.trim() ?? "";
      const cleanMessageID = message.id.trim();
      const cleanSharedInboxID = sharedInboxID?.trim() ?? "";
      const cleanAccountEmail = cleanSharedInboxID ? "" : accountEmail?.trim().toLowerCase() ?? "";
      for (let offset = 0; offset < nodes.length && !cancelled; offset += 8) {
        const batch = nodes.slice(offset, offset + 8);
        const results = await Promise.all(batch.map(async (node) => {
          try {
            const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, node.node_id);
            const attached = parseEditorAttachedEmails(projections).some((email) => {
              const scopeMatches = cleanSharedInboxID
                ? email.sharedInboxID?.trim() === cleanSharedInboxID
                : (email.accountEmail?.trim().toLowerCase() ?? "") === cleanAccountEmail;
              const messageMatches = email.messageID === cleanMessageID
                || Boolean(cleanThreadID && email.threadID?.trim() === cleanThreadID);
              return scopeMatches && messageMatches;
            });
            return attached ? node.node_id : "";
          } catch {
            return "";
          }
        }));
        const match = results.find(Boolean);
        if (match) return match;
      }
      return "";
    };
    void resolve().then((nodeID) => {
      if (!cancelled) setDetectedNodeID(nodeID);
    }).finally(() => {
      if (!cancelled) setResolvingNode(false);
    });
    return () => {
      cancelled = true;
    };
  }, [accountEmail, active, apiBase, collaboration, companyID, loading, message.id, message.thread_id, nodes, sharedInboxID]);

  React.useEffect(() => {
    if (!active || !messageCollaborationID) return undefined;
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
  }, [acceptCollaboration, active, companyID, loadProjection, messageCollaborationID, onError, onSuccess, sourceKey]);

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
      onChatMessageDeleted(event) {
        if (event.company_id === companyID && event.node_id === nodeID) refresh();
      },
    });
    return () => {
      unsubscribe();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [active, apiBase, collaborationID, companyID, nodeID, onError, refreshCollaborationByID]);

  const ensureCollaboration = React.useCallback(async (priorityOverride?: number): Promise<CommunicationsEmailCollaboration> => {
    if (collaboration) return collaboration;
    const priority = priorityOverride ?? selectedPriority;
    if (!priority || priority < 1 || priority > 5) throw new Error("email_node_priority_required");
    const created = await ensureEmailCollaboration({
      companyID,
      message,
      messageID: message.id,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
      priority,
    });
    acceptCollaboration(created);
    setSelectedPriority(priority);
    return created;
  }, [acceptCollaboration, accountEmail, collaboration, companyID, message, selectedPriority, sharedInboxID]);

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
    setPriorityMenuOpen(false);
    setSubmitting(true);
    try {
      if (cleanNodeID !== detectedNodeID) {
        await convertTriageMessagesToExplorerTarget({
          companyID,
          sharedInboxID,
          accountEmail: sharedInboxID?.trim() ? undefined : accountEmail,
          target: { mode: "existing_node", nodeID: cleanNodeID },
          messageIDs: [message.id],
        });
      }
      const textBlockID = generateStableInformationID();
      const emailMessageID = selection?.messageID?.trim() || message.id.trim();
      const createdTimestamp = new Date().toISOString();
      const subject = message.subject?.trim() || "Email";
      const targetProjections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, cleanNodeID).catch(() => []);
      const existingEmailContents = listEditorTextBlockProjections(targetProjections)
        .map((projection) => parseEditorTextBlockContent(projection.information));
      const existingMessageAccent = existingEmailContents
        .find((content) => content.emailMessageID?.trim() === emailMessageID)?.emailAccent?.trim() ?? "";
      const existingEmailAccents = existingEmailContents
        .filter((content) => content.emailMessageID?.trim() !== emailMessageID)
        .map((content) => content.emailAccent?.trim() ?? "").filter(Boolean);
      await requestJSON("/v1/nodes/" + encodeURIComponent(cleanNodeID) + "/information", {
        method: "POST",
        json: {
          company_id: companyID,
          type: EDITOR_TEXT_BLOCK_TYPE,
          information_id: textBlockID,
          information: buildEditorTextBlockProjectionPayload({
            title: "Email: " + subject,
            document: "",
            attachments: [],
            emailMessageID,
            emailAccent: existingMessageAccent || editorEmailMessageAccent(emailMessageID, existingEmailAccents),
          }),
        },
      });
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
        await requestJSON("/v1/nodes/" + encodeURIComponent(cleanNodeID) + "/information", {
          method: "POST",
          json: {
            company_id: companyID,
            type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
            information_id: informationID,
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
          },
        });
      }
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setReplyTargetID("");
      setDetectedNodeID(cleanNodeID);
      onClearSelection();
      onSuccess();
      onOpenImportedNode?.(cleanNodeID, textBlockID, emailMessageID);
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, includeChat ? "Failed to import this email chat into the node." : "Failed to import this email into the node."));
    } finally {
      setSubmitting(false);
    }
  }, [accountEmail, apiBase, author.name, author.userID, companyID, detectedNodeID, draft, draftAttachments, message.id, message.subject, onClearSelection, onError, onOpenImportedNode, onSuccess, principals, requestJSON, selectedMentionPrincipals, selection, sharedInboxID, submitting]);

  const createEmailNode = React.useCallback(async (priorityOverride: number) => {
    if (submitting) return;
    setPriorityMenuOpen(false);
    setSubmitting(true);
    try {
      const created = await ensureCollaboration(priorityOverride);
      onSuccess();
      onOpenImportedNode?.(created.node_id, created.attached_email_information_id, message.id);
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to create a node for this email."));
    } finally {
      setSubmitting(false);
    }
  }, [ensureCollaboration, message.id, onError, onOpenImportedNode, onSuccess, submitting]);

  const submit = React.useCallback(async (priorityOverride?: number) => {
    const cleanDraft = draft.trim();
    if ((!cleanDraft && draftAttachments.length === 0) || submitting) return;
    const priority = priorityOverride ?? selectedPriority;
    if (!collaboration && detectedNodeID) {
      await importIntoExistingNode(detectedNodeID, true);
      return;
    }
    if (!collaboration && (!priority || priority < 1 || priority > 5)) {
      setPendingAction("chat");
      setPriorityMenuOpen(true);
      return;
    }
    setPriorityMenuOpen(false);
    setSubmitting(true);
    try {
      const activeCollaboration = await ensureCollaboration(priority ?? undefined);
      const activeNodeID = activeCollaboration.node_id.trim();
      const activeBlockID = activeCollaboration.attached_email_information_id.trim();
      if (!activeNodeID || !activeBlockID) throw new Error("email_collaboration_node_missing");
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
        selectionMessageID: !replyTargetID ? (selection?.messageID ?? message.id) : undefined,
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
            selectionMessageID: !replyTargetID ? (selection?.messageID ?? message.id) : undefined,
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
      onSuccess();
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
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is still here."));
    } finally {
      setSubmitting(false);
    }
  }, [author.name, author.userID, collaboration, companyID, detectedNodeID, draft, draftAttachments, ensureCollaboration, importIntoExistingNode, onClearSelection, onError, onSuccess, principals, refreshCollaborationByID, replyTargetID, requestJSON, selectedMentionPrincipals, selectedPriority, selection, submitting]);
  const attachFiles = React.useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    if (!collaboration && !selectedPriority) {
      setPriorityMenuOpen(true);
      onError("Choose the email node priority, then attach the files again.");
      return;
    }
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
      onSuccess();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "failed_to_upload_chat_attachment");
    }
  }, [collaboration, companyID, ensureCollaboration, onError, onSuccess, requestJSON, selectedPriority]);

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

  const snapshot = collaboration ? collaborationMessageSnapshot(collaboration) : null;
  const cleanNodeSearch = nodeSearch.trim().toLowerCase();
  const filteredNodes = nodes.filter((node) => (
    !cleanNodeSearch
    || node.name.toLowerCase().includes(cleanNodeSearch)
    || node.node_id.toLowerCase().includes(cleanNodeSearch)
  )).slice(0, 12);
  const detectedNode = nodes.find((node) => node.node_id === detectedNodeID);

  return (
    <aside
      id={id}
      hidden={!active}
      aria-hidden={!active}
      aria-label="Email collaboration chat"
      style={{ minWidth: 0, minHeight: 0, display: active ? "grid" : "none", alignContent: "start", gap: 6, padding: "8px 8px 8px 0", overflowY: "auto", background: EDITOR_NEU_SURFACE }}
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
      {!collaboration && (
        <div style={{ margin: "0 8px", display: "grid", gap: 5 }}>
          {resolvingNode && <div role="status" style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>Checking whether this thread is already in a node</div>}
          {detectedNode && (
            <button type="button" onClick={() => onOpenImportedNode?.(detectedNode.node_id, "", message.id)} style={{ minHeight: 30, border: "1px solid rgba(20,184,166,0.36)", borderRadius: 9, background: "rgba(240,253,250,0.94)", color: "#0f766e", cursor: "pointer", padding: "5px 8px", textAlign: "left", fontSize: 10.5, fontWeight: 900 }}>
              This email thread is already in {detectedNode.name || "this node"}
            </button>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            <button type="button" disabled={submitting} onClick={() => {
              setPendingAction("create");
              setPriorityMenuOpen(true);
            }} style={{ minHeight: 30, border: "1px solid rgba(249,115,22,0.34)", borderRadius: 9, background: "#ffffff", color: "#9a3412", cursor: submitting ? "wait" : "pointer", padding: "5px 8px", fontSize: 10.5, fontWeight: 900 }}>
              Create node for this email
            </button>
            <button type="button" disabled={submitting} onClick={() => {
              setPendingAction("import");
              setPriorityMenuOpen(true);
            }} style={{ minHeight: 30, border: "1px solid rgba(14,165,233,0.34)", borderRadius: 9, background: "#ffffff", color: "#0369a1", cursor: submitting ? "wait" : "pointer", padding: "5px 8px", fontSize: 10.5, fontWeight: 900 }}>
              Import into existing node
            </button>
          </div>
        </div>
      )}
      {priorityMenuOpen && !collaboration && (
        <div role="dialog" aria-label="Place email in a node" style={{ margin: "0 8px", display: "grid", gap: 6, border: "1px solid rgba(249,115,22,0.36)", borderRadius: 10, background: "rgba(255,247,237,0.96)", padding: 8, boxShadow: "0 8px 20px rgba(15,23,42,0.10)" }}>
          {pendingAction !== "create" && (
            <>
              <strong style={{ color: "#0369a1", fontSize: 11 }}>{pendingAction === "chat" ? "Import this email and chat into an existing node" : "Import this email into an existing node"}</strong>
              <input value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="Search nodes" aria-label="Search existing nodes" style={{ minHeight: 30, border: "1px solid rgba(14,165,233,0.3)", borderRadius: 8, background: "#ffffff", padding: "4px 8px", fontSize: 11 }} />
              <div style={{ maxHeight: 180, overflowY: "auto", display: "grid", gap: 4 }}>
                {filteredNodes.map((node) => (
                  <button key={node.node_id} type="button" disabled={submitting} onClick={() => { void importIntoExistingNode(node.node_id, pendingAction === "chat"); }} style={{ minHeight: 28, border: "1px solid rgba(14,165,233,0.24)", borderRadius: 8, background: node.node_id === detectedNodeID ? "rgba(240,253,250,0.94)" : "#ffffff", color: "#0f172a", cursor: submitting ? "wait" : "pointer", padding: "4px 8px", textAlign: "left", fontSize: 10.5, fontWeight: 850 }}>
                    {node.name || node.node_id}{node.node_id === detectedNodeID ? " - thread already attached" : ""}
                  </button>
                ))}
                {filteredNodes.length === 0 && <div style={{ color: "#64748b", fontSize: 10.5 }}>No matching nodes</div>}
              </div>
            </>
          )}
          {pendingAction !== "import" && (
            <>
              <strong style={{ color: "#9a3412", fontSize: 11 }}>{pendingAction === "create" ? "Choose a priority to create this email node" : "Or choose a priority for a new email node"}</strong>
              {INBOX_PRIORITIES.map((priority) => (
                <button
                  key={priority.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setSelectedPriority(priority.value);
                    if (pendingAction === "create") void createEmailNode(priority.value);
                    else void submit(priority.value);
                  }}
                  style={{ minHeight: 28, border: "1px solid rgba(249,115,22,0.28)", borderRadius: 8, background: "#ffffff", color: "#7c2d12", cursor: submitting ? "wait" : "pointer", padding: "4px 8px", textAlign: "left", fontSize: 10.5, fontWeight: 850 }}
                >
                  {priority.label}
                </button>
              ))}
            </>
          )}
          <button type="button" onClick={() => setPriorityMenuOpen(false)} style={{ minHeight: 26, border: 0, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 10.5, fontWeight: 800 }}>Cancel</button>
        </div>
      )}
      {submitting && <div role="status" style={{ color: "rgba(100,116,139,0.82)", fontSize: 10.5, fontWeight: 800, padding: "0 8px" }}>Saving comment and email node</div>}
      <ChatPane
        blockID={blockID || "email-collaboration"}
        editable
        apiBase={apiBase}
        companyID={companyID}
        messages={messages}
        headerTrailing={<EmailCollaborationParticipantRoster collaboration={collaboration} companyUsers={companyUsers} companyUserGroups={companyUserGroups} currentUserID={currentUserID} />}
        selectionAnchor={selectionAnchor}
        draft={draft}
        companyUsers={principals}
        draftAttachments={draftAttachments}
        replyTargetID={replyTargetID}
        heightStorageKey={"mangorts.email-collaboration-chat-height:" + companyID}
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

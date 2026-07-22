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
  canEditEditorTextBlockChatMessage,
  editorEmailMessageAccent,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
  listEditorTextBlockProjections,
  parseEditorAttachedEmails,
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
} from "../../modules/node-map/NodeRecordStore";
import type { NodeRecord } from "../../modules/node-map/shared";
import type { LogicGateRecord } from "../../modules/logic-gate-map/shared";
import { assignNodeToLogicGateStatus } from "../../modules/kanban/kanbanApi";
import { subscribeRealtimeScope } from "../../modules/realtime/realtimeWebSocket";
import { EmailCollaborationParticipantRoster } from "./EmailCollaborationParticipantRoster";
import {
  formatEmailCollaborationChatError,
  resolveEmailCollaborationChatPlacement,
  type EmailCollaborationActionRequest,
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
  targetMessage?: EmailMessage;
  sharedInboxID?: string;
  accountEmail?: string;
  companyUsers: CompanyUser[];
  companyUserGroups: CompanyUserGroup[];
  companyUserGroupMembers: CompanyUserGroupMember[];
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  actionRequest: EmailCollaborationActionRequest;
  selection: EmailCollaborationSelection | null;
  onClearSelection: () => void;
  onNavigateToEmailSelection: (selection: EmailCollaborationSelection) => void;
  onCollaborationChange?: (collaboration: CommunicationsEmailCollaboration) => void;
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
const emailActionSearchStyle: React.CSSProperties = {
  minHeight: 33,
  border: "1px solid rgba(148,163,184,0.24)",
  borderRadius: 9,
  background: "rgba(248,250,252,0.88)",
  color: EMAIL_ACTION_TEXT,
  padding: "4px 9px",
  fontSize: 11,
  boxShadow: "inset 3px 3px 8px rgba(174,174,192,0.16), inset -3px -3px 8px rgba(255,255,255,0.9)",
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
  logicGates,
  actionRequest,
  selection,
  onClearSelection,
  onNavigateToEmailSelection,
  onCollaborationChange,
  onError,
  onSuccess,
  onActionSuccess,
  onActionRequestHandled,
}: EmailCollaborationChatSurfaceProps) {
  const apiBase = readAuthConfig().apiBase;
  const requestJSON = React.useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [collaboration, setCollaboration] = React.useState<CommunicationsEmailCollaboration | null>(null);
  const [messages, setMessages] = React.useState<EditorTextBlockChatMessage[]>([]);
  const [activeTextBlockID, setActiveTextBlockID] = React.useState("");
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
  const [createStep, setCreateStep] = React.useState<"priority" | "logic_gate">("priority");
  const [logicGateSearch, setLogicGateSearch] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const loadSequenceRef = React.useRef(0);
  const collaborationRef = React.useRef<CommunicationsEmailCollaboration | null>(null);
  const sourceLoadKeyRef = React.useRef("");
  const requestedCollaborationIDRef = React.useRef("");
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
  React.useEffect(() => {
    if (!actionRequest) return;
    setPendingAction(actionRequest.action);
    setPriorityMenuOpen(actionRequest.action !== "chat");
    setCreateStep("priority");
    setSelectedPriority(null);
    setLogicGateSearch("");
    if (actionRequest.action === "import") setNodeSearch("");
    if (actionRequest.action === "chat") onActionRequestHandled();
  }, [actionRequest?.requestID, onActionRequestHandled]);
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
    const placement = resolveEmailCollaborationChatPlacement(
      projections,
      targetEmailMessageID,
      nextCollaboration?.attached_email_information_id,
    );
    setActiveTextBlockID(placement.blockID);
    setMessages(placement.messages);
  }, [apiBase, companyID, targetEmailMessageID]);

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
      setActiveTextBlockID("");
      setActiveMessageID("");
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      if (!actionRequest) {
        setPriorityMenuOpen(false);
        setSelectedPriority(null);
        setCreateStep("priority");
        setLogicGateSearch("");
        setPendingAction("chat");
        setNodeSearch("");
      }
      setDetectedNodeID("");
      setResolvingNode(false);
      setSubmitting(false);
      if (previousSourceKey) onClearSelection();
    }
    if (!enabled) {
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
  }, [acceptCollaboration, accountEmail, companyID, enabled, loadProjection, message.id, message.thread_id, onClearSelection, onError, onSuccess, sharedInboxID, sourceKey]);

  React.useEffect(() => {
    if (!enabled || loading || collaboration || !message.id.trim() || nodes.length === 0) {
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
  }, [accountEmail, apiBase, collaboration, companyID, enabled, loading, message.id, message.thread_id, nodes, sharedInboxID]);

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

  const ensureCollaboration = React.useCallback(async (priorityOverride?: number): Promise<CommunicationsEmailCollaboration> => {
    if (collaboration) return collaboration;
    const priority = priorityOverride ?? selectedPriority;
    if (!priority || priority < 1 || priority > 5) throw new Error("email_node_priority_required");
    const created = await ensureEmailCollaboration({
      companyID,
      message: collaborationTargetMessage,
      messageID: targetEmailMessageID,
      threadID: message.thread_id,
      sharedInboxID,
      accountEmail,
      priority,
    });
    acceptCollaboration(created);
    setSelectedPriority(priority);
    return created;
  }, [acceptCollaboration, accountEmail, collaboration, collaborationTargetMessage, companyID, message.thread_id, selectedPriority, sharedInboxID, targetEmailMessageID]);

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
      const shouldAttachEmail = cleanNodeID !== detectedNodeID;
      const emailMessageID = selection?.messageID?.trim() || message.id.trim();
      const createdTimestamp = new Date().toISOString();
      const subject = message.subject?.trim() || "Email";
      const targetProjections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, cleanNodeID).catch(() => []);
      const existingTextBlockProjections = listEditorTextBlockProjections(targetProjections);
      const existingLinkedProjection = existingTextBlockProjections.find((projection) => (
        parseEditorTextBlockContent(projection.information).emailMessageID?.trim() === emailMessageID
      ));
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
        await convertTriageMessagesToExplorerTarget({
          companyID,
          sharedInboxID,
          accountEmail: sharedInboxID?.trim() ? undefined : accountEmail,
          target: { mode: "existing_node", nodeID: cleanNodeID },
          messageIDs: [message.id],
          linkedTextBlock: textBlockWrite,
          initialChat: initialChatWrite,
        });
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
      invalidateNodeRecordStoreCaches(apiBase, companyID, cleanNodeID);
      setDraft("");
      setDraftAttachments([]);
      setSelectedMentionPrincipals([]);
      setReplyTargetID("");
      setDetectedNodeID(cleanNodeID);
      setPriorityMenuOpen(false);
      onClearSelection();
      onSuccess();
      onActionSuccess("Email was added to node.");
      onActionRequestHandled();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, includeChat ? "Failed to import this email chat into the node." : "Failed to import this email into the node."));
    } finally {
      setSubmitting(false);
    }
  }, [accountEmail, apiBase, author.name, author.userID, companyID, detectedNodeID, draft, draftAttachments, message.id, message.subject, onActionRequestHandled, onActionSuccess, onClearSelection, onError, onSuccess, principals, requestJSON, selectedMentionPrincipals, selection, sharedInboxID, submitting]);

  const ensureLinkedEmailTextBlock = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration): Promise<string> => {
    const activeNodeID = activeCollaboration.node_id.trim();
    const emailMessageID = selection?.messageID?.trim() || message.id.trim();
    if (!activeNodeID || !emailMessageID) throw new Error("email_collaboration_node_missing");
    invalidateNodeRecordStoreCaches(apiBase, companyID, activeNodeID);
    const projections = await getNodeInformationProjectionSingleFlight(apiBase, companyID, activeNodeID);
    const placement = resolveEmailCollaborationChatPlacement(
      projections,
      emailMessageID,
      activeCollaboration.attached_email_information_id,
    );
    if (placement.blockID) {
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
    await convertTriageMessagesToExplorerTarget({
      companyID,
      sharedInboxID,
      accountEmail: sharedInboxID?.trim() ? undefined : accountEmail,
      target: { mode: "existing_node", nodeID: activeNodeID },
      messageIDs: [emailMessageID],
      linkedTextBlock,
    });
    invalidateNodeRecordStoreCaches(apiBase, companyID, activeNodeID);
    setActiveTextBlockID(textBlockID);
    return textBlockID;
  }, [accountEmail, apiBase, companyID, message.id, message.subject, selection?.messageID, sharedInboxID]);

  const saveCurrentDraftToCollaboration = React.useCallback(async (activeCollaboration: CommunicationsEmailCollaboration, ensuredTextBlockID = ""): Promise<string> => {
    const cleanDraft = draft.trim();
    if (!cleanDraft && draftAttachments.length === 0) return "";
    const activeNodeID = activeCollaboration.node_id.trim();
    const activeBlockID = ensuredTextBlockID.trim() || await ensureLinkedEmailTextBlock(activeCollaboration);
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

  const createEmailNode = React.useCallback(async (priorityOverride?: number, logicGateID = "") => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const created = await ensureCollaboration(priorityOverride);
      const linkedTextBlockID = await ensureLinkedEmailTextBlock(created);
      const cleanLogicGateID = logicGateID.trim();
      if (cleanLogicGateID) {
        await assignNodeToLogicGateStatus({
          apiBase,
          companyID,
          logicGateID: cleanLogicGateID,
          nodeID: created.node_id,
          status: "requested",
          priority: priorityOverride ?? selectedPriority,
          nodeTitle: message.subject?.trim() || undefined,
        });
      }
      await saveCurrentDraftToCollaboration(created, linkedTextBlockID);
      setPriorityMenuOpen(false);
      onSuccess();
      onActionSuccess("Node was created.");
      onActionRequestHandled();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to create a node for this email."));
    } finally {
      setSubmitting(false);
    }
  }, [apiBase, companyID, ensureCollaboration, ensureLinkedEmailTextBlock, message.subject, onActionRequestHandled, onActionSuccess, onError, onSuccess, saveCurrentDraftToCollaboration, selectedPriority, submitting]);

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
      setCreateStep("priority");
      return;
    }
    setPriorityMenuOpen(false);
    setSubmitting(true);
    try {
      const activeCollaboration = await ensureCollaboration(priority ?? undefined);
      await saveCurrentDraftToCollaboration(activeCollaboration);
      onSuccess();
    } catch (cause) {
      onError(formatEmailCollaborationChatError(cause, "Failed to save email chat. Your message is still here."));
    } finally {
      setSubmitting(false);
    }
  }, [collaboration, detectedNodeID, draft, draftAttachments, ensureCollaboration, importIntoExistingNode, onError, onSuccess, saveCurrentDraftToCollaboration, selectedPriority, submitting]);
  const attachFiles = React.useCallback(async (files: FileList | File[]) => {
    const candidates = Array.from(files);
    if (candidates.length === 0) return;
    if (!collaboration && !selectedPriority) {
      setPriorityMenuOpen(true);
      setPendingAction("chat");
      setCreateStep("priority");
      onError("Choose the email node priority, then attach the files again.");
      return;
    }
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
  }, [collaboration, companyID, ensureCollaboration, ensureLinkedEmailTextBlock, onError, onSuccess, requestJSON, selectedPriority]);

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

  const cleanNodeSearch = nodeSearch.trim().toLowerCase();
  const filteredNodes = nodes.filter((node) => (
    !cleanNodeSearch
    || node.name.toLowerCase().includes(cleanNodeSearch)
    || node.node_id.toLowerCase().includes(cleanNodeSearch)
  )).slice(0, 12);
  const cleanLogicGateSearch = logicGateSearch.trim().toLowerCase();
  const filteredLogicGates = logicGates.filter((logicGate) => (
    !cleanLogicGateSearch
    || logicGate.header.toLowerCase().includes(cleanLogicGateSearch)
    || logicGate.logic_gate_id.toLowerCase().includes(cleanLogicGateSearch)
  )).slice(0, 12);
  const closeActionMenu = () => {
    setPriorityMenuOpen(false);
    setCreateStep("priority");
    setSelectedPriority(null);
    onActionRequestHandled();
  };
  const actionMenuVisible = priorityMenuOpen && !loading;

  return (
    <>
      {actionMenuVisible && (
        <div data-email-action-popover="true" style={{ position: "absolute", zIndex: 50, top: 84, right: 10, maxWidth: "calc(100% - 20px)", display: "flex", alignItems: "flex-start", justifyContent: "flex-end", gap: 8, animation: "mango-pane-enter 160ms ease-out" }}>
          {pendingAction === "import" ? (
            <div data-email-action-surface="neomorphic" role="dialog" aria-label="Add email to node" style={{ ...emailActionSurfaceStyle, width: 290, maxWidth: "min(290px, calc(100vw - 32px))" }}>
              <strong style={{ color: EMAIL_ACTION_ACCENT, fontSize: 11 }}>Add email to a node</strong>
              <input autoFocus value={nodeSearch} onChange={(event) => setNodeSearch(event.target.value)} placeholder="Search nodes" aria-label="Search existing nodes" style={emailActionSearchStyle} />
              <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 4 }}>
                {filteredNodes.map((node) => (
                  <button data-email-action-option="true" key={node.node_id} type="button" disabled={submitting} onClick={() => { void importIntoExistingNode(node.node_id, false); }} style={{ ...emailActionOptionStyle, border: node.node_id === detectedNodeID ? "1px solid transparent" : emailActionOptionStyle.border, background: node.node_id === detectedNodeID ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : emailActionOptionStyle.background, color: node.node_id === detectedNodeID ? EMAIL_ACTION_ACCENT : EMAIL_ACTION_TEXT, cursor: submitting ? "wait" : "pointer" }}>
                    {node.name || node.node_id}{node.node_id === detectedNodeID ? " - thread already attached" : ""}
                  </button>
                ))}
                {filteredNodes.length === 0 && <div style={{ color: "#64748b", fontSize: 10.5, padding: 6 }}>No matching nodes</div>}
              </div>
              {resolvingNode && <div role="status" style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>Checking existing email attachments</div>}
              {submitting && <div role="status" style={{ color: "#64748b", fontSize: 10.5, fontWeight: 800 }}>Attaching the email thread and linked text box</div>}
              <button type="button" onClick={closeActionMenu} style={{ minHeight: 26, border: 0, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 10.5, fontWeight: 800 }}>Cancel</button>
            </div>
          ) : (
            <>
              <div data-email-action-surface="neomorphic" role="dialog" aria-label="Choose email node priority" style={{ ...emailActionSurfaceStyle, width: 250, maxWidth: "min(250px, calc(100vw - 32px))", gap: 5 }}>
                <strong style={{ color: EMAIL_ACTION_ACCENT, fontSize: 11 }}>{pendingAction === "chat" ? "Choose a priority to send this chat" : "Choose a priority"}</strong>
                {INBOX_PRIORITIES.map((priority) => (
                  <button data-email-action-option="true" key={priority.value} type="button" disabled={submitting} onClick={() => { setSelectedPriority(priority.value); setCreateStep("logic_gate"); }} style={{ ...emailActionOptionStyle, border: selectedPriority === priority.value ? "1px solid transparent" : emailActionOptionStyle.border, background: selectedPriority === priority.value ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : emailActionOptionStyle.background, color: selectedPriority === priority.value ? EMAIL_ACTION_ACCENT : EMAIL_ACTION_TEXT, cursor: submitting ? "wait" : "pointer" }}>
                    {priority.label}
                  </button>
                ))}
                <button type="button" onClick={closeActionMenu} style={{ minHeight: 26, border: 0, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 10.5, fontWeight: 800 }}>Cancel</button>
              </div>
              {createStep === "logic_gate" && selectedPriority && (
                <div data-email-action-surface="neomorphic" data-email-logic-gate-picker="true" role="dialog" aria-label="Choose Logic Gate for email node" style={{ ...emailActionSurfaceStyle, width: 310, maxWidth: "min(310px, calc(100vw - 32px))", animation: "mango-pane-enter 160ms ease-out" }}>
                  <strong style={{ color: EMAIL_ACTION_ACCENT, fontSize: 11 }}>Place the node in a Logic Gate</strong>
                  <input autoFocus value={logicGateSearch} onChange={(event) => setLogicGateSearch(event.target.value)} placeholder="Search Logic Gates" aria-label="Search Logic Gates" style={emailActionSearchStyle} />
                  <div style={{ maxHeight: 220, overflowY: "auto", display: "grid", gap: 4 }}>
                    {filteredLogicGates.map((logicGate) => (
                      <button data-email-action-option="true" key={logicGate.logic_gate_id} type="button" disabled={submitting} onClick={() => { void createEmailNode(selectedPriority, logicGate.logic_gate_id); }} style={{ ...emailActionOptionStyle, cursor: submitting ? "wait" : "pointer" }}>
                        {logicGate.header || logicGate.logic_gate_id}
                      </button>
                    ))}
                    {filteredLogicGates.length === 0 && <div style={{ color: "#64748b", fontSize: 10.5, padding: 6 }}>No matching Logic Gates</div>}
                  </div>
                  <button data-email-action-option="true" type="button" disabled={submitting} onClick={() => { void createEmailNode(selectedPriority); }} style={{ ...emailActionOptionStyle, cursor: submitting ? "wait" : "pointer" }}>
                    Create without a Logic Gate
                  </button>
                  {submitting && <div role="status" style={{ color: "#64748b", fontSize: 10.5, fontWeight: 800 }}>Creating node and attaching the email thread</div>}
                </div>
              )}
            </>
          )}
        </div>
      )}
      <aside
        id={id}
        hidden={!active}
        aria-hidden={!active}
        aria-label="Email collaboration chat"
        className={active ? "mango-pane-enter" : undefined}
        style={{ minWidth: 0, minHeight: 0, height: "100%", display: active ? "grid" : "none", gridTemplateRows: loading || submitting ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", gap: 6, padding: "8px 8px 8px 0", overflow: "hidden", background: EDITOR_NEU_SURFACE }}
      >
        {(loading || submitting) && <div role="status" style={{ color: "rgba(100,116,139,0.78)", fontSize: 10.5, fontWeight: 800, padding: "2px 8px" }}>{loading ? "Loading chat" : pendingAction === "chat" ? "Saving chat" : "Saving"}</div>}
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
    </>
  );
}

import type {
  CommunicationsEmailCollaboration,
  CompanyUser,
  CompanyUserGroup,
} from "../../modules/communications/communicationsApi.js";
import {
  listEditorTextBlockProjections,
  parseEditorTextBlockChats,
  parseEditorTextBlockContent,
  type EditorProjectionItem,
  type EditorTextBlockChatMessage,
} from "../../modules/editor/editorProjection.js";


export type EmailCollaborationRosterPrincipal = {
  kind: "user" | "group";
  id: string;
  label: string;
  detail: string;
  participantUserIDs: string[];
  prospective: boolean;
};

export type EmailCollaborationChatSession = {
  key: string;
  visible: boolean;
} | null;

export type EmailCollaborationPanelAction = "create" | "import";

export type EmailNodeDestination =
  | { kind: "node"; nodeID: string }
  | { kind: "logic_gate"; logicGateID: string; priority: number }
  | { kind: "project"; projectID: string; logicGateID: string; priority: number }
  | { kind: "standalone" };

export type EmailCollaborationActionRequest = {
  action: EmailCollaborationPanelAction;
  requestID: number;
  destination?: EmailNodeDestination;
} | null;


export function nextEmailNodeDestinationRequest(
  current: EmailCollaborationActionRequest,
  destination: EmailNodeDestination,
): NonNullable<EmailCollaborationActionRequest> {
  return {
    action: destination.kind === "node" ? "import" : "create",
    destination,
    requestID: (current?.requestID ?? 0) + 1,
  };
}

export function emailNodeImportRequired(
  targetNodeID: string,
  detectedNodeID: string,
  emailMessageID: string,
): boolean {
  return targetNodeID.trim() !== detectedNodeID.trim() || !emailMessageID.trim();
}



export function reconcileEmailCollaborationChatSession(
  current: EmailCollaborationChatSession,
  key: string,
): EmailCollaborationChatSession {
  return key && current?.key === key ? current : null;
}

export function emailCollaborationChatSessionMounted(current: EmailCollaborationChatSession, key: string): boolean {
  return !!key && current?.key === key;
}

export function emailCollaborationChatSessionVisible(current: EmailCollaborationChatSession, key: string): boolean {
  return emailCollaborationChatSessionMounted(current, key) && current?.visible === true;
}

export type EmailCollaborationChatPlacement = {
  blockID: string;
  messages: EditorTextBlockChatMessage[];
};

/**
 * Resolves one email message to its real text-box chat. The Attached email
 * projection is only a legacy read fallback; it is never returned as the
 * destination for a new chat.
 */
export function resolveEmailCollaborationChatPlacement(
  projections: EditorProjectionItem[],
  emailMessageID: string,
  legacyAttachedEmailInformationID = "",
): EmailCollaborationChatPlacement {
  const cleanMessageID = emailMessageID.trim();
  const chats = parseEditorTextBlockChats(projections);
  const linkedTextBlocks = listEditorTextBlockProjections(projections).filter((projection) => (
    parseEditorTextBlockContent(projection.information).emailMessageID?.trim() === cleanMessageID
  ));
  const textBlockWithChat = linkedTextBlocks.find((projection) => (
    chats.some((chat) => chat.blockID === projection.information_id)
  ));
  const linkedTextBlock = textBlockWithChat ?? linkedTextBlocks[0];
  if (linkedTextBlock) {
    const directMessages = chats.filter((chat) => chat.blockID === linkedTextBlock.information_id);
    if (directMessages.length > 0) {
      return { blockID: linkedTextBlock.information_id, messages: directMessages };
    }
  }

  const legacyBlockID = legacyAttachedEmailInformationID.trim();
  const legacyMessages = legacyBlockID
    ? chats.filter((chat) => chat.blockID === legacyBlockID)
    : [];
  return {
    blockID: linkedTextBlock?.information_id ?? "",
    messages: legacyMessages,
  };
}
function cleanID(value: string | undefined): string {
  return value?.trim() ?? "";
}

function shortID(value: string): string {
  const cleanValue = cleanID(value);
  if (!cleanValue) return "unknown";
  return cleanValue.length > 8 ? cleanValue.slice(0, 8) : cleanValue;
}

function userLabel(userID: string, usersByID: Map<string, CompanyUser>): { label: string; detail: string } {
  const user = usersByID.get(userID);
  const email = user?.email?.trim() ?? "";
  const label = user?.display_name?.trim() || email || `Unknown user (${shortID(userID)})`;
  return { label, detail: email && email !== label ? email : "Email collaboration participant" };
}

/**
 * Builds the compact collaboration roster from durable participant rows only.
 * Group directory records are label metadata; live group membership is
 * deliberately absent so later group changes cannot rewrite the snapshot.
 */
export function buildEmailCollaborationParticipantRoster(
  collaboration: CommunicationsEmailCollaboration | null,
  companyUsers: CompanyUser[],
  companyUserGroups: CompanyUserGroup[],
  currentUserID: string,
): EmailCollaborationRosterPrincipal[] {
  const usersByID = new Map(companyUsers.map((user) => [cleanID(user.user_id), user]));
  if (!collaboration) {
    const prospectiveUserID = cleanID(currentUserID);
    if (!prospectiveUserID) return [];
    const user = userLabel(prospectiveUserID, usersByID);
    return [{
      kind: "user",
      id: prospectiveUserID,
      label: user.label,
      detail: "You - the collaboration will be created when the first chat is sent",
      participantUserIDs: [prospectiveUserID],
      prospective: true,
    }];
  }

  const groupsByID = new Map(companyUserGroups.map((group) => [cleanID(group.group_id), group]));
  const seenUserIDs = new Set<string>();
  const roster: EmailCollaborationRosterPrincipal[] = [];
  const groupRosterByID = new Map<string, EmailCollaborationRosterPrincipal>();

  for (const participant of collaboration.participants ?? []) {
    const userID = cleanID(participant.user_id);
    if (!userID || seenUserIDs.has(userID)) continue;
    seenUserIDs.add(userID);

    const addedViaType = participant.added_via_type?.trim().toLowerCase() ?? "";
    const addedViaID = cleanID(participant.added_via_id);
    if (addedViaType === "group") {
      // A malformed legacy row without a group ID must not combine unrelated
      // participants into one apparent dynamic group.
      const rosterGroupID = addedViaID || `missing-group:${userID}`;
      let groupRoster = groupRosterByID.get(rosterGroupID);
      if (!groupRoster) {
        const group = addedViaID ? groupsByID.get(addedViaID) : undefined;
        groupRoster = {
          kind: "group",
          id: rosterGroupID,
          label: group?.name?.trim() || `Former user group (${shortID(addedViaID)})`,
          detail: "1 snapshotted participant",
          participantUserIDs: [],
          prospective: false,
        };
        groupRosterByID.set(rosterGroupID, groupRoster);
        roster.push(groupRoster);
      }
      groupRoster.participantUserIDs.push(userID);
      const count = groupRoster.participantUserIDs.length;
      groupRoster.detail = `${count} snapshotted participant${count === 1 ? "" : "s"}`;
      continue;
    }

    const user = userLabel(userID, usersByID);
    roster.push({
      kind: "user",
      id: userID,
      label: user.label,
      detail: user.detail,
      participantUserIDs: [userID],
      prospective: false,
    });
  }

  return roster;
}

export function formatEmailCollaborationChatError(cause: unknown, fallback: string): string {
  const raw = cause instanceof Error
    ? cause.message.trim()
    : typeof cause === "string"
      ? cause.trim()
      : "";
  const normalized = raw.toLowerCase();
  if (normalized.includes("email_collaboration_storage_not_ready")) {
    return "Email chat's database setup is not ready. Ask an administrator to verify the email collaboration migration and database permissions, restart the backend if needed, and try again. Your message is still here.";
  }
  if (normalized.includes("failed_to_create_email_collaboration")) {
    return "Mango could not start this email chat. Your message is still here; please try again.";
  }
  return raw || fallback;
}

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommunicationsEmailCollaboration } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  buildEditorTextBlockChatPayload,
  buildEditorTextBlockProjectionPayload,
  EDITOR_TEXT_BLOCK_CHAT_TYPE,
  EDITOR_TEXT_BLOCK_TYPE,
} from "../../../../frontend/src/modules/editor/editorProjection.js";
import {
  buildEmailCollaborationParticipantRoster,
  emailNodeImportRequired,
  emailCollaborationChatSessionMounted,
  emailCollaborationChatSessionVisible,
  formatEmailCollaborationChatError,
  nextEmailNodeDestinationRequest,
  reconcileEmailCollaborationChatSession,
  resolveEmailCollaborationChatPlacement,
  type EmailCollaborationChatSession,
} from "../../../../frontend/src/pages/home/emailCollaborationChat.js";

test("provider-only email rows import before requiring an internal email message ID", () => {
  assert.equal(emailNodeImportRequired("node-1", "", ""), true, "first import into an existing Node");
  assert.equal(emailNodeImportRequired("node-1", "node-1", ""), true, "a later provider reply still needs exact-message import");
  assert.equal(emailNodeImportRequired("node-2", "node-1", "email-message-1"), true, "an imported message still needs a relationship to another Node");
  assert.equal(emailNodeImportRequired("node-1", "node-1", "email-message-1"), false, "the exact imported message relationship is reusable");
});

const users = [
  { company_id: "company-1", user_id: "creator-1", display_name: "Creator Person", email: "creator@example.test" },
  { company_id: "company-1", user_id: "direct-1", display_name: "Direct Person", email: "direct@example.test" },
  { company_id: "company-1", user_id: "group-user-1", display_name: "Group One" },
  { company_id: "company-1", user_id: "group-user-2", display_name: "Group Two" },
];

function collaboration(participants: CommunicationsEmailCollaboration["participants"]): CommunicationsEmailCollaboration {
  return {
    company_id: "company-1",
    collaboration_id: "collaboration-1",
    node_id: "node-1",
    attached_email_information_id: "information-1",
    participants,
  };
}

test("email chat roster uses durable participant provenance and aggregates snapshotted groups", () => {
  const roster = buildEmailCollaborationParticipantRoster(collaboration([
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "creator-1", added_via_type: "creator" },
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "direct-1", added_via_type: "user", added_via_id: "direct-1" },
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "group-user-1", added_via_type: "group", added_via_id: "group-1" },
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "group-user-2", added_via_type: "group", added_via_id: "group-1" },
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "group-user-2", added_via_type: "group", added_via_id: "group-1" },
  ]), users, [{ company_id: "company-1", group_id: "group-1", name: "Review Team", position: 0 }], "creator-1");

  assert.deepEqual(roster.map((item) => [item.kind, item.id, item.label]), [
    ["user", "creator-1", "Creator Person"],
    ["user", "direct-1", "Direct Person"],
    ["group", "group-1", "Review Team"],
  ]);
  assert.deepEqual(roster[2]?.participantUserIDs, ["group-user-1", "group-user-2"]);
  assert.equal(roster[2]?.detail, "2 snapshotted participants");
});

test("email chat roster never needs live group membership and keeps safe directory fallbacks", () => {
  const roster = buildEmailCollaborationParticipantRoster(collaboration([
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "departed-user", added_via_type: "group", added_via_id: "deleted-group" },
    { company_id: "company-1", collaboration_id: "collaboration-1", user_id: "unknown-user", added_via_type: "user", added_via_id: "unknown-user" },
  ]), [], [], "creator-1");

  assert.equal(roster[0]?.kind, "group");
  assert.match(roster[0]?.label ?? "", /^Former user group/);
  assert.deepEqual(roster[0]?.participantUserIDs, ["departed-user"]);
  assert.equal(roster[1]?.label, "Unknown user (unknown-)");
});

test("an opened pre-collaboration chat shows only the prospective current user", () => {
  assert.deepEqual(
    buildEmailCollaborationParticipantRoster(null, users, [], "creator-1"),
    [{
      kind: "user",
      id: "creator-1",
      label: "Creator Person",
      detail: "You - the collaboration will be created when the first chat is sent",
      participantUserIDs: ["creator-1"],
      prospective: true,
    }],
  );
});

test("email collaboration setup failures are actionable and promise composer preservation", () => {
  assert.equal(
    formatEmailCollaborationChatError(new Error("failed_to_create_email_collaboration"), "fallback"),
    "Mango could not start this email chat. Your message is still here; please try again.",
  );
  assert.match(
    formatEmailCollaborationChatError(new Error("email_collaboration_storage_not_ready"), "fallback"),
    /database setup is not ready[\s\S]*migration and database permissions[\s\S]*Your message is still here/,
  );
  assert.equal(formatEmailCollaborationChatError(new Error("specific failure"), "fallback"), "specific failure");
  assert.equal(formatEmailCollaborationChatError(null, "fallback"), "fallback");
});

test("email chat session opens directly for a selection and resets across scope changes", () => {
  let session: EmailCollaborationChatSession = null;
  assert.equal(emailCollaborationChatSessionMounted(session, "scope-a"), false);
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), false);

  session = { key: "scope-a", visible: true };
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), true);
  assert.strictEqual(reconcileEmailCollaborationChatSession(session, "scope-a"), session);

  session = { key: "scope-a", visible: false };
  assert.equal(emailCollaborationChatSessionMounted(session, "scope-a"), true);
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), false);
  assert.equal(reconcileEmailCollaborationChatSession(session, "scope-b"), null);
});

test("email destination requests preserve typed Node creation intent", () => {
  const request = nextEmailNodeDestinationRequest(null, {
    kind: "project",
    projectID: "project-1",
    logicGateID: "gate-1",
  });
  assert.deepEqual(request, {
    action: "create",
    destination: { kind: "project", projectID: "project-1", logicGateID: "gate-1" },
    requestID: 1,
  });
});
test("email collaboration chat resolves to a real linked text box and only reads legacy attached-email chat as fallback", () => {
  const linkedTextBox = {
    information_id: "text-box-1",
    type: EDITOR_TEXT_BLOCK_TYPE,
    information: buildEditorTextBlockProjectionPayload({
      title: "Email notes",
      document: "",
      emailMessageID: "message-1",
      emailMessageIDs: ["message-1", "message-2"],
      emailAccent: "#0ea5e9",
    }),
    created_timestamp: "2026-07-20T10:00:00.000Z",
  };
  const directChat = {
    information_id: "direct-chat-1",
    type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
    information: buildEditorTextBlockChatPayload({
      blockID: linkedTextBox.information_id,
      selectionSource: "email",
      selectionMessageID: "message-1",
      authorName: "Direct author",
      message: "Direct text-box chat",
      createdTimestamp: "2026-07-20T10:01:00.000Z",
    }),
  };
  const legacyChat = {
    information_id: "legacy-chat-1",
    type: EDITOR_TEXT_BLOCK_CHAT_TYPE,
    information: buildEditorTextBlockChatPayload({
      blockID: "attached-email-1",
      selectionSource: "email",
      selectionMessageID: "message-1",
      authorName: "Legacy author",
      message: "Legacy attached-email chat",
      createdTimestamp: "2026-07-20T09:59:00.000Z",
    }),
  };

  const directPlacement = resolveEmailCollaborationChatPlacement(
    [linkedTextBox, directChat, legacyChat],
    "message-1",
    "attached-email-1",
  );
  assert.equal(directPlacement.blockID, "text-box-1");
  assert.deepEqual(directPlacement.messages.map((message) => message.id), ["direct-chat-1"]);

  const threadPlacement = resolveEmailCollaborationChatPlacement(
    [linkedTextBox],
    "message-2",
  );
  assert.equal(threadPlacement.blockID, "text-box-1");

  const legacyPlacement = resolveEmailCollaborationChatPlacement(
    [linkedTextBox, legacyChat],
    "message-1",
    "attached-email-1",
  );
  assert.equal(legacyPlacement.blockID, "text-box-1");
  assert.deepEqual(legacyPlacement.messages.map((message) => message.id), ["legacy-chat-1"]);

  const emailOnlyPlacement = resolveEmailCollaborationChatPlacement(
    [legacyChat],
    "message-1",
    "attached-email-1",
  );
  assert.equal(emailOnlyPlacement.blockID, "");
  assert.deepEqual(emailOnlyPlacement.messages.map((message) => message.id), ["legacy-chat-1"]);
});

test("My and Shared Triage use one thread chat rail backed by Node text boxes", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const surface = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailCollaborationChatSurface.tsx"), "utf8");
  const destinationSearch = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailNodeDestinationSearch.tsx"), "utf8");
  const sharedChat = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(workspace, /const commentOnEmailSelection = React\.useCallback[\s\S]*setEmailSelection\(selection\);[\s\S]*setEmailChatSession\(\{ key: emailChatKey, visible: true \}\)/);
  assert.match(workspace, /const toggleEmailChat = React\.useCallback[\s\S]*visible: !current\.visible/);
  assert.doesNotMatch(workspace, /selectedMessage\?\.collaboration_node_id\?\.trim\(\)[\s\S]*setEmailChatSession\(\{ key: emailChatKey, visible: true \}\)/);
  assert.match(workspace, /onEmailSelection=\{commentOnEmailSelection\}/);
  assert.match(workspace, /<EmailCollaborationChatSurface[\s\S]*active=\{emailChatVisible\}[\s\S]*threadMessages=\{selectedThreadMessages\}/);
  assert.match(detail, /data-email-thread-chat-toggle="true"[\s\S]*onClick=\{onToggleEmailChat\}/);
  assert.doesNotMatch(detail, /title="Chat about this email message"|data-email-message-actions="true"/);
  assert.match(detail, /data-email-selection-chat-action="true"[\s\S]*onTextSelection\(\{ quote, startOffset, endOffset \}\)/);

  assert.match(surface, /listEmailCollaborations\(\{[\s\S]*setCollaborations\(items\)/);
  assert.match(surface, /const placementChats = \[[\s\S]{0,160}\.\.\.placement\.messages/);
  assert.match(surface, /headerLeading=\{collaborations\.length > 1[\s\S]*data-email-chat-node-header="true"[\s\S]*<ExplorerRowIcon kind="node"/);
  assert.match(surface, /sectionLabelsByBlockID=\{sectionLabelsByBlockID\}/);
  assert.doesNotMatch(surface, /EmailCollaborationParticipantRoster|setChatTargetMenuOpen|onClose/);
  assert.match(surface, /const startNewFloatingNodeChat[\s\S]*pendingNewNodeIDRef\.current = generateStableInformationID\(\)[\s\S]*acceptCollaboration\(null\)/);
  assert.match(surface, /const ensureLinkedEmailTextBlock[\s\S]*convertTriageMessagesToExplorerTarget\([\s\S]*linkedTextBlock/);
  assert.match(surface, /const submit = React\.useCallback\(async \(\) =>[\s\S]*collaborations\.length > 1 && !collaboration[\s\S]*ensureEmailCollaboration\(\{[\s\S]*linkedTextBlock:[\s\S]*initialChat:/);
  assert.doesNotMatch(surface, /Choose email node priority|setPriorityMenuOpen|data-email-action-popover|aria-label="Close email comments"/);
  assert.match(surface, /const importedCollaborations = await listEmailCollaborations/);
  assert.doesNotMatch(surface, /parseEditorAttachedEmails|resolveEmailCollaboration\(/);

  assert.match(destinationSearch, /<UniversalEntityPicker[\s\S]*sourceLabel="Email"[\s\S]*initialMode="link"/);
  assert.match(destinationSearch, /data-email-floating-node-button="true"[\s\S]*aria-label="Create floating node from email"/);
  assert.match(destinationSearch, /const createFloatingNode[\s\S]*onSubmit\(\{ kind: "standalone" \}\)/);
  assert.match(destinationSearch, /mode === "reference"[\s\S]*onOpenEntity\(entity\)/);
  assert.match(destinationSearch, /entity\.entityType === "node"[\s\S]*onSubmit\(\{ kind: "node", nodeID: entity\.entityID \}\)/);
  assert.match(destinationSearch, /entity\.entityType === "logic_gate"[\s\S]*onSubmit\(\{ kind: "logic_gate", logicGateID: entity\.entityID \}\)/);
  assert.match(destinationSearch, /pendingLink\.entityType === "project"[\s\S]*kind: "project"/);
  assert.doesNotMatch(destinationSearch, /Choose priority|priority:/);
  assert.doesNotMatch(destinationSearch, /buildEmailNodeDestinationSearchOptions|listProjects/);
  assert.match(destinationSearch, /data-email-action-success="true"[\s\S]*right: "calc\(100% \+ 9px\)"/);
  assert.match(workspace, /EMAIL_NODE_INDICATOR_AFTER_NOTICE_MS[\s\S]*setEmailActionNotice[\s\S]*onEmailCollaborationChange\(delayedCollaboration\)/);
  assert.match(surface, /const delayFloatingNodeIndicator = createNew;[\s\S]*ensureCollaboration\(priority, createNew, !delayFloatingNodeIndicator\)[\s\S]*delayFloatingNodeIndicator \? created : undefined/);
  assert.match(surface, /const refreshCollaborationByIDRef = React\.useRef\(refreshCollaborationByID\)/);
  assert.match(surface, /refreshCollaborationByIDRef\.current\(collaborationID, refreshSequence\)/);
  assert.match(surface, /\}, \[active, apiBase, collaborationID, companyID, nodeID\]\);/);
  const emailBodyDocument = detail.slice(
    detail.indexOf("function useEmailBodyDocument"),
    detail.indexOf("function EmailConversationMessage"),
  );
  const hydrationKeyLine = emailBodyDocument.split("\n").find((line) => line.includes("const hydrationKey =")) ?? "";
  assert.doesNotMatch(hydrationKeyLine, /collaborationID/);
  assert.match(emailBodyDocument, /const collaborationIDRef = React\.useRef\(collaborationID\)/);
  assert.match(emailBodyDocument, /collaborationID: collaborationIDRef\.current/);
  assert.match(sharedChat, /headerLeading\?: React\.ReactNode/);
  assert.match(sharedChat, /sectionLabelsByBlockID\?: Record<string, string>/);
  assert.match(surface, /<ChatPane[\s\S]*fillHeight/);
});
test("email-created nodes reuse canonical chat data with one node email column", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const nodeParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const projection = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorProjection.ts"), "utf8");

  assert.match(workspace, /message\.collaboration_node_id\?\.trim\(\)[\s\S]*onOpenCollaborationNode\(message\)/);
  assert.match(workspace, /<EmailEntityIconButton[\s\S]*kind="node"/);
  assert.doesNotMatch(workspace, /function EmailNodeIndicatorIcon/);
  assert.match(detail, /associatedNodeMessage[\s\S]*onOpenCollaborationNode\(associatedNodeMessage\)/);
  assert.match(detail, /function EmailEntityIconButton[\s\S]*<ExplorerRowIcon kind=\{kind\} \/>/);
  assert.doesNotMatch(detail, /<MailIcon color="#7c3aed" \/>/);
  const mailNodeOpenStart = homePage.indexOf("const openEmailCollaborationNode");
  const mailNodeOpen = homePage.slice(mailNodeOpenStart, homePage.indexOf("useEffect", mailNodeOpenStart));
  assert.match(mailNodeOpen, /openNodeEditorOverlay\(node\);/);
  assert.doesNotMatch(mailNodeOpen, /collaboration_information_id|focusRequestID|message\.id/);
  assert.match(nodeSurface, /emailOriginChatBlockID = emailOriginAttachedEmail\?\.id\.trim\(\)/);
  assert.match(nodeSurface, /data-node-email-column="true"/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"/);
  assert.match(nodeSurface, /const chatBlockID = block\.id/);
  assert.match(nodeSurface, /suppressAutomaticCreation: nodeAttachedEmails\.length > 0/);
  assert.doesNotMatch(nodeSurface, /aria-label="Toggle email column"/);
  assert.doesNotMatch(nodeSurface, /data-node-text-box-columns="email-editor-chat"/);
  assert.match(nodeSurface, /blockID=\{block\.id\}[\s\S]*blockID=\{chatBlockID\}/);
  assert.match(nodeSurface, /emailOriginPrimaryRow && emailChatParticipantRoster/);
  assert.match(nodeSurface, /tabbed=\{false\}/);
  assert.match(nodeParts, /role="tablist" aria-label="Attached email threads"/);
  assert.match(nodeParts, /height: replyComposerOpen \? "clamp\(420px, calc\(100vh - 300px\), 760px\)" : "auto"/);
  assert.match(nodeParts, /minHeight: replyComposerOpen \? undefined : 0/);
  assert.match(nodeParts, /className="editor-document-scroll mango-pane-enter"/);
  assert.match(nodeSurface, /data-node-email-column="true"[\s\S]{0,420}position: "sticky"[\s\S]{0,80}top: 38/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"[\s\S]{0,420}transition: "grid-template-columns 180ms/);
  assert.match(nodeParts, /initialFocusMessageID[\s\S]*scrollIntoView/);
  assert.match(projection, /selection_block_id: input\.selectionBlockID/);
  assert.match(projection, /created_from_email: input\.createdFromEmail === true/);
});

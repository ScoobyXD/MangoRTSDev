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
  buildEmailNodeDestinationSearchOptions,
  emailNodeImportRequired,
  emailCollaborationChatSessionMounted,
  emailCollaborationChatSessionVisible,
  formatEmailCollaborationChatError,
  nextEmailCollaborationActionRequest,
  nextEmailNodeDestinationRequest,
  reconcileEmailCollaborationChatSession,
  resolveEmailCollaborationChatPlacement,
  toggleEmailCollaborationChatSession,
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

test("email chat session is default-closed, preserves same-email state, and resets across scope changes", () => {
  let session: EmailCollaborationChatSession = null;
  assert.equal(emailCollaborationChatSessionMounted(session, "scope-a"), false);
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), false);

  session = toggleEmailCollaborationChatSession(session, "scope-a");
  assert.deepEqual(session, { key: "scope-a", visible: true });
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), true);

  session = toggleEmailCollaborationChatSession(session, "scope-a");
  assert.deepEqual(session, { key: "scope-a", visible: false });
  assert.equal(emailCollaborationChatSessionMounted(session, "scope-a"), true);
  assert.equal(emailCollaborationChatSessionVisible(session, "scope-a"), false);
  assert.strictEqual(reconcileEmailCollaborationChatSession(session, "scope-a"), session);
  assert.equal(reconcileEmailCollaborationChatSession(session, "scope-b"), null);
  assert.equal(toggleEmailCollaborationChatSession(session, ""), null);
});

test("email toolbar action requests are monotonic and preserve the selected operation", () => {
  let request = nextEmailCollaborationActionRequest(null, "create");
  assert.deepEqual(request, { action: "create", requestID: 1 });

  request = nextEmailCollaborationActionRequest(request, "import");
  assert.deepEqual(request, { action: "import", requestID: 2 });

  request = nextEmailCollaborationActionRequest(request, "chat");
  assert.deepEqual(request, { action: "chat", requestID: 3 });
});

test("email hashtag search finds every destination kind and preserves current-node opening", () => {
  const nodes = [
    { company_id: "company-1", node_id: "node-current", name: "Current launch", created_timestamp: "2026-07-20T10:00:00.000Z" },
    { company_id: "company-1", node_id: "node-next", name: "Launch checklist", created_timestamp: "2026-07-20T10:00:00.000Z" },
  ];
  const logicGates = [
    { company_id: "company-1", logic_gate_id: "gate-1", header: "Launch approval", created_timestamp: "2026-07-20T10:00:00.000Z" },
  ];
  const projects = [
    { company_id: "company-1", project_id: "project-1", name: "Launch program", status: "Active", created_timestamp: "2026-07-20T10:00:00.000Z", updated_timestamp: "2026-07-20T10:00:00.000Z" },
  ];

  const matches = buildEmailNodeDestinationSearchOptions({
    query: "# launch",
    nodes,
    logicGates,
    projects,
    currentNodeID: "node-current",
  });
  assert.deepEqual(matches.map((option) => option.kind), ["current", "node", "logic_gate", "project"]);
  assert.equal(matches[0]?.detail, "Open the Node already linked to this email");

  const unlinked = buildEmailNodeDestinationSearchOptions({ query: "#", nodes, logicGates, projects });
  assert.ok(unlinked.some((option) => option.kind === "standalone"));
  assert.equal(unlinked.some((option) => option.kind === "current"), false);

  const request = nextEmailNodeDestinationRequest(null, {
    kind: "project",
    projectID: "project-1",
    logicGateID: "gate-1",
    priority: 2,
  });
  assert.deepEqual(request, {
    action: "create",
    destination: { kind: "project", projectID: "project-1", logicGateID: "gate-1", priority: 2 },
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

test("My and Shared Triage keep email chat opt-in while reusing the shared ChatPane", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const surface = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailCollaborationChatSurface.tsx"), "utf8");
  const destinationSearch = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailNodeDestinationSearch.tsx"), "utf8");
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const sharedChat = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(workspace, /emailChatKey[\s\S]*JSON\.stringify\(\[activeViewID, mailbox, selectedMessageRowKey\]\)/);
  assert.match(workspace, /emailChatMounted = emailCollaborationChatSessionMounted\(emailChatSession, emailChatKey\)/);
  assert.match(workspace, /gridTemplateColumns: showDetailResizeHandle && emailChatVisible/);
  assert.match(workspace, /gridTemplateRows: !showDetailResizeHandle && emailChatVisible/);
  assert.match(workspace, /chatAvailable=\{emailChatAvailable\}[\s\S]*chatOpen=\{emailChatVisible\}[\s\S]*onToggleChat=\{toggleEmailChat\}/);
  assert.match(workspace, /\{\(emailChatMounted \|\| emailActionRequest\) && \([\s\S]*<EmailCollaborationChatSurface[\s\S]*active=\{emailChatVisible\}/);
  assert.match(detail, /data-email-node-actions="true"[\s\S]*emailNodeDestinationSearch[\s\S]*aria-controls="email-collaboration-chat"/);
  assert.doesNotMatch(detail, /Create Node From Email|Add Email to Node/);
  assert.match(workspace, /<EmailNodeDestinationSearch[\s\S]*onSubmit=\{sendEmailToNodeDestination\}[\s\S]*onOpenCurrentNode=/);
  assert.match(detail, /aria-controls="email-collaboration-chat"[\s\S]*aria-expanded=\{chatOpen\}[\s\S]*aria-pressed=\{chatOpen\}/);
  assert.match(workspace, /nextEmailNodeDestinationRequest\(current, destination\)/);
  assert.match(workspace, /nextEmailCollaborationActionRequest\(current, "chat"\)/);
  assert.match(surface, /setPriorityMenuOpen\(!actionRequest\.destination && actionRequest\.action !== "chat"\)/);
  assert.match(surface, /handledDestinationRequestRef[\s\S]*destination\.kind === "node"[\s\S]*importIntoExistingNode\(destination\.nodeID, false\)/);
  assert.match(sharedChat, /headerTrailing\?: React\.ReactNode/);
  assert.match(sharedChat, /\{headerTrailing && \(/);
  assert.match(surface, /hidden=\{!active\}/);
  assert.match(surface, /headerTrailing=\{<EmailCollaborationParticipantRoster/);
  assert.match(surface, /active=\{active\}/);
  assert.match(workspace, /useState<EmailCollaborationChatSession>\(null\)/);
  assert.match(surface, /const previousSourceKey = sourceLoadKeyRef\.current;[\s\S]*if \(previousSourceKey\) onClearSelection\(\);/);
  assert.match(surface, /expectedLoadSequence !== undefined && loadSequenceRef\.current !== expectedLoadSequence/);
  assert.match(surface, /if \(isAbortError\(cause\)\) return;/);
  assert.match(surface, /refreshCollaborationByID\(collaborationID, refreshSequence\)[\s\S]*loadSequenceRef\.current !== refreshSequence/);
  assert.match(surface, /loadProjection\(collaboration, rollbackSequence\)\.catch/);
  assert.match(workspace, /visibleError = emailCollaborationError \|\| error/);
  assert.match(surface, /if \(!active \|\| !companyID \|\| !collaborationID \|\| !nodeID\) return undefined;/);
  assert.match(surface, /if \(!collaboration && \(!priority \|\| priority < 1 \|\| priority > 5\)\) \{[\s\S]*setPriorityMenuOpen\(true\)/);
  assert.match(surface, /priority,[\s\S]*await requestJSON\([\s\S]*setMessages\([\s\S]*setDraft\(""\)/);
  assert.doesNotMatch(surface, /optimisticInformationID/);
  assert.doesNotMatch(surface, /Create node for this email/);
  assert.doesNotMatch(surface, /Import into existing node/);
  assert.match(surface, /data-email-action-popover="true"/);
  assert.match(surface, /const emailActionSurfaceStyle: React\.CSSProperties = \{[\s\S]*EDITOR_NEU_SURFACE[\s\S]*EDITOR_NEU_EDGE_FRAME[\s\S]*EDITOR_NEU_PANEL_SHADOW/);
  assert.match(surface, /const emailActionOptionStyle: React\.CSSProperties = \{[\s\S]*EDITOR_NEU_SHADOW/);
  assert.equal((surface.match(/data-email-action-surface="neomorphic"/g) ?? []).length, 3, "priority, Logic Gate, and Node search should share the standard elevated surface");
  const actionPopoverSource = surface.slice(surface.indexOf('data-email-action-popover="true"'), surface.indexOf("<aside", surface.indexOf('data-email-action-popover="true"')));
  assert.match(actionPopoverSource, /data-email-action-option="true"/);
  assert.doesNotMatch(actionPopoverSource, /rgba\(249,115,22|rgba\(20,184,166|#9a3412|#7c2d12|#0f766e/);
  assert.match(destinationSearch, /data-email-node-hashtag-input="true"[\s\S]*# Search Nodes, Logic Gates, projects/);
  assert.match(destinationSearch, /event\.key !== "#"[\s\S]*inputRef\.current\?\.focus\(\)/);
  assert.match(destinationSearch, /event\.key === "ArrowDown"[\s\S]*event\.key === "ArrowUp"[\s\S]*event\.key === "Enter"[\s\S]*event\.key === "Escape"/);
  assert.match(destinationSearch, /aria-label="Send email to selected destination"/);
  assert.match(destinationSearch, /data-email-node-priority-choices="pre-open"[\s\S]*data-email-node-priority-option/);
  assert.match(destinationSearch, /data-email-project-logic-gate-choices="pre-open"[\s\S]*data-email-project-logic-gate-option/);
  assert.match(destinationSearch, /function destinationChoiceStyle\(selected: boolean\)[\s\S]*EDITOR_NEU_ACTIVE_SURFACE[\s\S]*EDITOR_NEU_SHADOW/);
  assert.doesNotMatch(destinationSearch, /<select[^>]*aria-label="Email Node priority"/);
  assert.doesNotMatch(destinationSearch, /<select[^>]*aria-label="Project Logic Gate"/);
  assert.match(destinationSearch, /onClick=\{\(\) => \{[\s\S]{0,180}option\.kind === "current" \|\| option\.kind === "node"\) runOption\(option\)/);
  assert.doesNotMatch(destinationSearch, /onDoubleClick/);
  assert.match(destinationSearch, /data-email-node-priority-option[\s\S]*runOption\(selectedOption, \{ priority: nextPriority \}\)[\s\S]*data-email-project-logic-gate-option[\s\S]*runOption\(selectedOption, \{ projectLogicGateID: nextLogicGateID \}\)/);
  assert.match(workspace, /data-email-node-indicator="mailbox-card"/);
  assert.match(detail, /data-email-node-indicator="message-header"/);
  assert.match(workspace, /onNodeAttachmentChange=\{onEmailNodeAttachmentChange\}/);
  assert.match(homePage, /applyEmailNodeAttachmentChange[\s\S]*emailMessageMatchesNodeAttachment[\s\S]*mergeEmailMessageWithNodeAttachment/);
  assert.match(surface, /const conversionResult = await convertTriageMessagesToExplorerTarget[\s\S]*onNodeAttachmentChange\?\.\(\{[\s\S]*resolveEmailCollaboration/);
  assert.match(surface, /assignNodeToLogicGateStatus\(\{[\s\S]{0,360}status: "requested"/);
  assert.match(surface, /upsertProjectRelationship\(\{[\s\S]{0,220}resourceType: "node"/);
  assert.match(surface, /"Node was created\."/);
  assert.match(surface, /onActionSuccess\("Email was added to node\."\)/);
  assert.match(workspace, /actionNotice=\{emailActionNotice\?\.message \?\? ""\}/);
  assert.match(detail, /data-email-action-success="true"/);
  assert.match(detail, /data-email-action-success="true"[\s\S]{0,220}position: "absolute"/);
  assert.match(detail, /title="Chat about this email message"[\s\S]*onCommentOnMessage\(message\)/);
  assert.match(detail, /data-email-node-actions="true"[\s\S]{0,260}flexWrap: "nowrap"/);
  assert.match(destinationSearch, /role="combobox"[\s\S]*role="listbox"/);
  assert.match(surface, /targetEmailMessageID = selection\?\.messageID\?\.trim\(\) \|\| message\.id\.trim\(\)/);
  assert.match(surface, /message: collaborationTargetMessage,[\s\S]{0,100}messageID: targetEmailMessageID/);
  assert.match(surface, /convertTriageMessagesToExplorerTarget/);
  assert.match(surface, /const importedCollaboration = await resolveEmailCollaboration\([\s\S]{0,260}acceptCollaboration\(importedCollaboration\)/);
  assert.match(surface, /existingLinkedProjection[\s\S]{0,420}textBlockID = existingLinkedProjection\?\.information_id \?\? generateStableInformationID\(\)/);
  assert.match(surface, /const textBlockWrite = existingLinkedProjection \? undefined/);
  assert.match(surface, /parseEditorAttachedEmails/);
  assert.match(surface, /const ensureLinkedEmailTextBlock = React\.useCallback/);
  assert.match(surface, /emailMessageID,[\s\S]{0,180}editorEmailMessageAccent\(emailMessageID/);
  assert.doesNotMatch(surface, /emailMessageID: emailMessageID \|\| providerMessageID/);
  assert.match(surface, /const activeBlockID = await ensureLinkedEmailTextBlock\(activeCollaboration\)/);
  assert.match(surface, /blockID: activeBlockID,[\s\S]{0,500}selectionMessageID: !replyTargetID \? selectionEmailMessageID/);
  assert.match(surface, /const linkedTextBlockID = await ensureLinkedEmailTextBlock\(created\);[\s\S]*saveCurrentDraftToCollaboration\(created, linkedTextBlockID\)/);
  assert.match(surface, /informationID: activeBlockID,[\s\S]{0,120}editorSurface: "email_collaboration_chat"/);
  assert.match(surface, /<ChatPane[\s\S]{0,800}fillHeight/);
  assert.match(sharedChat, /fillHeight\?: boolean/);
});

test("email-created nodes reuse canonical chat data with one node email column", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const nodeParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const projection = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorProjection.ts"), "utf8");

  assert.match(workspace, /message\.collaboration_node_id\?\.trim\(\)[\s\S]*onOpenCollaborationNode\(message\)/);
  assert.match(workspace, /<ExplorerRowIcon kind="node" \/>/);
  assert.doesNotMatch(workspace, /function EmailNodeIndicatorIcon/);
  assert.match(detail, /Open existing email node[\s\S]*onOpenCollaborationNode\(message\)/);
  assert.match(detail, /Open existing email node[\s\S]*<ExplorerRowIcon kind="node" \/>/);
  assert.doesNotMatch(detail, /<MailIcon color="#7c3aed" \/>/);
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
  assert.match(nodeSurface, /data-node-email-column="true"[\s\S]{0,180}className="mango-pane-layout-transition"/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"[\s\S]{0,420}transition: "grid-template-columns 180ms/);
  assert.match(nodeParts, /initialFocusMessageID[\s\S]*scrollIntoView/);
  assert.match(projection, /selection_block_id: input\.selectionBlockID/);
  assert.match(projection, /created_from_email: input\.createdFromEmail === true/);
});

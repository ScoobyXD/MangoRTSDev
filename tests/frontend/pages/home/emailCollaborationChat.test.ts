import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  CommunicationsEmailCollaboration,
  CommunicationsEmailThreadChatGroup,
} from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  appendAcknowledgedEmailCollaborationChat,
  buildEmailCollaborationParticipantRoster,
  conflictingEmailTextboxLink,
  emailNodeImportRequired,
  emailTextboxLinkForMessage,
  emailCollaborationChatSessionMounted,
  emailCollaborationChatSessionVisible,
  formatEmailCollaborationChatError,
  nextEmailNodeDestinationRequest,
  orderEmailCollaborationChatMessages,
  orderEmailThreadChatGroups,
  reconcileEmailCollaborationChatSession,
  type EmailCollaborationChatSession,
} from "../../../../frontend/src/pages/home/emailCollaborationChat.js";

function chatGroup(
  nodeID: string,
  textboxID: string,
  linkedProviderMessageIDs: string[],
): CommunicationsEmailThreadChatGroup {
  return {
    node_id: nodeID,
    node_name: `Node ${nodeID}`,
    textbox_id: textboxID,
    textbox_title: `Text box ${textboxID}`,
    textbox_display_order: 0,
    email_thread_id: "email-thread-1",
    linked_messages: linkedProviderMessageIDs.map((providerMessageID, index) => ({
      email_message_id: `email-message-${nodeID}-${textboxID}-${index}`,
      provider_message_id: providerMessageID,
      message_timestamp: `2026-08-11T09:0${index}:00.000Z`,
    })),
    chats: [],
  };
}

test("an acknowledged triage chat appears immediately and is not duplicated by realtime", () => {
  const existing = {
    id: "chat-1",
    blockID: "text-box-1",
    authorID: "user-1",
    authorName: "Test User",
    message: "first",
    createdTimestamp: "2026-08-10T08:00:00.000Z",
    attachments: [],
  };
  const acknowledged = {
    ...existing,
    id: "chat-2",
    message: "second",
    createdTimestamp: "2026-08-10T08:01:00.000Z",
  };

  const appended = appendAcknowledgedEmailCollaborationChat([existing], acknowledged);
  assert.deepEqual(appended.map((message) => message.id), ["chat-1", "chat-2"]);
  assert.strictEqual(appendAcknowledgedEmailCollaborationChat(appended, acknowledged), appended);
});

test("email chat groups stay in stable Node and text-box display order regardless of response order", () => {
  const newest = chatGroup("node-b", "textbox-b", ["provider-b"]);
  const tiedSecond = chatGroup("node-b", "textbox-a", ["provider-c"]);
  const tiedFirst = chatGroup("node-a", "textbox-z", ["provider-a"]);
  newest.textbox_display_order = 1;
  tiedSecond.textbox_display_order = 0;
  assert.deepEqual(
    orderEmailThreadChatGroups([newest, tiedSecond, tiedFirst]).map((group) => [group.node_id, group.textbox_id]),
    [["node-a", "textbox-z"], ["node-b", "textbox-a"], ["node-b", "textbox-b"]],
  );
});

test("authoritative exact-message links choose existing textboxes and reject same-Node conflicts", () => {
  const selected = chatGroup("node-a", "textbox-a", ["provider-a"]);
  const links = [
    { node_id: "node-a", textbox_id: "textbox-hidden", email_message_id: "email-hidden", provider_message_id: "provider-hidden" },
    { node_id: "node-b", textbox_id: "textbox-b", email_message_id: "email-other-node", provider_message_id: "provider-active" },
  ];
  assert.equal(emailTextboxLinkForMessage(links, "provider-hidden", "node-a")?.textbox_id, "textbox-hidden", "chat-free text boxes remain routing authority");
  assert.equal(conflictingEmailTextboxLink(links, selected, "provider-hidden")?.textbox_id, "textbox-hidden");
  assert.equal(conflictingEmailTextboxLink(links, selected, "provider-active"), undefined, "another Node is not a conflict");
});

test("email grouping chats are chronological even when replies arrive after later roots", () => {
  const rootOne = {
    id: "chat-1", blockID: "textbox-a", authorID: "user-1", authorName: "One", message: "root one",
    createdTimestamp: "2026-08-11T10:00:00.000Z", attachments: [],
  };
  const rootTwo = { ...rootOne, id: "chat-2", message: "root two", createdTimestamp: "2026-08-11T10:01:00.000Z" };
  const lateReply = { ...rootOne, id: "chat-3", parentID: "chat-1", message: "late reply", createdTimestamp: "2026-08-11T10:02:00.000Z" };
  assert.deepEqual(orderEmailCollaborationChatMessages([lateReply, rootTwo, rootOne]).map((message) => message.id), ["chat-1", "chat-2", "chat-3"]);
});

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
test("My and Shared Triage use one thread chat rail backed by Node text boxes", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const surface = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailCollaborationChatSurface.tsx"), "utf8");
  const destinationSearch = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailNodeDestinationSearch.tsx"), "utf8");
  const sharedChat = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const styles = readFileSync(resolve(process.cwd(), "frontend/src/index.css"), "utf8");

  assert.match(workspace, /const commentOnEmailSelection = React\.useCallback[\s\S]*setEmailSelection\(selection\);[\s\S]*setEmailChatSession\(\{ key: emailChatKey, visible: true \}\)/);
  assert.match(workspace, /const toggleEmailChat = React\.useCallback[\s\S]*visible: !current\.visible/);
  assert.match(workspace, /const handleExistingEmailChatsChange = React\.useCallback[\s\S]*if \(!hasChats \|\| !emailChatKey\) return;[\s\S]*\{ key: emailChatKey, visible: true \}/);
  assert.match(workspace, /onEmailSelection=\{commentOnEmailSelection\}/);
  assert.match(workspace, /\{emailChatAvailable && \([\s\S]*<EmailCollaborationChatSurface[\s\S]*active=\{emailChatVisible\}/);
  assert.doesNotMatch(workspace, /threadMessages=\{selectedThreadMessages\}/);
  assert.match(workspace, /onExistingChatsChange=\{handleExistingEmailChatsChange\}/);
  assert.match(workspace, /onEmailChatHighlightsChange=\{setEmailChatHighlights\}/);
  assert.match(workspace, /emailChatHighlights=\{emailChatHighlights\}/);
  assert.match(workspace, /activeEmailSelection=\{emailSelection\}/);
  assert.match(workspace, /onOpenNode=\{openEmailChatNode\}/);
  assert.match(workspace, /data-email-chat-column-resizer="true"[\s\S]*onPointerDown=\{startEmailChatColumnResize\}[\s\S]*background: "transparent"/);
  assert.match(workspace, /resizeEmailChatColumnAtPointer\(bounds\.left, bounds\.width, clientX\)/);
  assert.match(workspace, /minmax\(0, 1fr\) 0px clamp\(\$\{EMAIL_CHAT_COLUMN_MIN_WIDTH\}px/);
  assert.match(detail, /data-email-thread-chat-toggle="true"[\s\S]*onClick=\{onToggleEmailChat\}/);
  assert.doesNotMatch(detail, /title="Chat about this email message"|data-email-message-actions="true"/);
  assert.match(detail, /data-email-selection-chat-action="true"[\s\S]*onTextSelection\(\{ quote, startOffset, endOffset \}\)/);
  assert.match(detail, /applyEmailBodyHighlights\(frameRef\.current\?\.contentDocument, highlights, selectionNavigation \?\? activeSelection\)/);

  assert.match(surface, /listEmailThreadChatGroups\(\{[\s\S]*messageID: message\.id,[\s\S]*threadID: message\.thread_id/);
  assert.doesNotMatch(surface, /listEmailCollaborations|getEmailCollaboration|ListNodeProjections|threadMessages/);
  assert.match(surface, /const orderedGroups = orderEmailThreadChatGroups\(groups\)[\s\S]*for \(const group of orderedGroups\)[\s\S]*parseEditorTextBlockChats\(group\.chats\)/);
  assert.match(surface, /headerLeading=\{\([\s\S]*data-email-chat-node-header="true"[\s\S]*<ExplorerRowIcon kind="node"/);
  assert.doesNotMatch(surface, /aria-label="Chat destination Node"|Choose destination Node/);
  assert.match(surface, /sectionLabelsByBlockID=\{sectionLabelsByBlockID\}/);
  assert.match(surface, /sectionNodeIDsByBlockID=\{sectionNodeIDsByBlockID\}/);
  assert.match(surface, /sectionNodeLabelsByNodeID=\{sectionNodeLabelsByNodeID\}/);
  assert.match(surface, /sectionNodeOrder=\{sectionNodeOrder\}/);
  assert.match(surface, /sectionKeysByMessageID=\{sectionKeysByChatID\}/);
  assert.match(surface, /onOpenSectionNode=\{onOpenNode\}/);
  assert.match(surface, /sectionActionLabel="New chat"/);
  assert.match(surface, /selectSectionOnClick=\{Boolean\(selection && !replyTargetID\)\}/);
  assert.match(surface, /selectedSectionKey=\{selectedChatGroupKey\}/);
  assert.match(surface, /composerDestination=\{replyTargetID \? undefined : composerDestination\}/);
  assert.match(surface, /composerDestinationError=\{replyTargetID \? undefined : selectionDestinationError\}/);
  assert.match(surface, /selectionAnchor=\{replyTargetID \? undefined : selectionAnchor\}/);
  assert.match(surface, /reserveScrollbarGutter/);
  assert.match(surface, /onSectionAction=\{selectExistingChatGroup\}/);
  assert.match(surface, /onNodeSectionAction=\{selectNodeChatDestination\}/);
  assert.match(surface, /onClearComposerDestination=\{cancelChatGroupDestination\}/);
  assert.match(surface, /data-chat-new-node-destination="true"[\s\S]*startNewFloatingNodeChat/);
  assert.match(surface, /if \(selection && !newNodeDestinationSelected && !selectedChatGroupKey && !selectedChatNodeID\)[\s\S]*Please select a destination\./);
  assert.match(surface, /const exactTextboxLinks = threadTextboxLinks\.filter[\s\S]*exactTextboxLinks\.length === 1[\s\S]*selectNodeChatDestination\(exactTextboxLinks\[0\]\.node_id\)/);
  assert.match(surface, /collaborations\.length === 1[\s\S]*selectNodeChatDestination\(collaborations\[0\]\.node_id\)/);
  assert.match(surface, /const clearDestinationOutsideSelection[\s\S]*cancelChatGroupDestination\(\)[\s\S]*document\.addEventListener\("pointerdown", clearDestinationOutsideSelection\)/);
  assert.doesNotMatch(surface, /chronologicalMessages/);
  assert.match(sharedChat, /const threads = useMemo\(\(\) => buildChatThreads\(messages\), \[messages\]\)/);
  assert.match(surface, /if \(!selection\) \{\s*await submitExistingTextBoxChat\(selectedCollaboration, selectedGroup\.textbox_id\);\s*return;\s*\}/);
  assert.match(surface, /const hasEmailSelection = Boolean\(emailMessageID\.trim\(\)\)[\s\S]*selectionSource: hasEmailSelection \? "email" : undefined/);
  assert.match(surface, /if \(selection\) \{[\s\S]*conflictingEmailTextboxLink\(threadTextboxLinks, group, targetEmailMessageID\)/);
  assert.match(surface, /emailTextboxLinkForMessage\(threadTextboxLinks, targetEmailMessageID, selectedGroup\.node_id\)[\s\S]*submitExistingTextBoxChat\(selectedCollaboration, selectedGroup\.textbox_id, exactTextboxLink\.email_message_id\)[\s\S]*importIntoExistingNode\(selectedGroup\.node_id, true, selectedGroup\)/);
  assert.match(surface, /if \(!replyCollaboration\) \{[\s\S]*submitExistingTextBoxChat\(replyCollaboration, replyGroup\.textbox_id, replyEmailMessageID\)/);
  assert.match(surface, /result\.textbox_links/);
  assert.doesNotMatch(surface, /group\.provider_message_id|group\.email_message_id/);
  assert.doesNotMatch(surface, /EmailCollaborationParticipantRoster|setChatTargetMenuOpen|onClose/);
  assert.match(surface, /const startNewFloatingNodeChat[\s\S]*pendingNewNodeIDRef\.current = generateStableInformationID\(\)[\s\S]*acceptCollaboration\(null\)/);
  const newChatStart = surface.indexOf("const startNewFloatingNodeChat");
  const newChatEnd = surface.indexOf("React.useEffect", newChatStart);
  assert.doesNotMatch(surface.slice(newChatStart, newChatEnd), /setMessages\(\[\]\)/);
  assert.match(surface, /const ensureLinkedEmailTextBlock[\s\S]*ensureEmailCollaboration\(\{[\s\S]*targetNodeID: activeNodeID,[\s\S]*linkedTextBlock/);
  assert.doesNotMatch(surface, /convertTriageMessagesToExplorerTarget/);
  assert.match(surface, /const submitExistingTextBoxChat = React\.useCallback[\s\S]*showPendingChat\(pending\.chat[\s\S]*await requestJSON<unknown>\(`\/v1\/nodes\/\$\{encodeURIComponent\(targetNodeID\)\}\/information`/);
  assert.match(surface, /if \(collaboration\) \{\s*if \(activeTextBlockID\) \{[\s\S]*const activeSelectionMessageID = selection[\s\S]*await submitExistingTextBoxChat\(collaboration, activeTextBlockID, activeSelectionMessageID\)/);
  assert.match(surface, /showPendingChat\([\s\S]{0,260}setSubmitting\(true\);\s*try \{\s*const created = await ensureEmailCollaboration/);
  assert.match(surface, /linkedTextBlock:[\s\S]*initialChat: pending\.write/);
  const newNodeChatSend = surface.slice(
    surface.indexOf("const originalDraft = draft;", surface.indexOf("const submit = React.useCallback")),
    surface.indexOf("const attachFiles = React.useCallback"),
  );
  assert.match(newNodeChatSend, /acceptCollaboration\(created\)[\s\S]*await loadThreadChats\(created, loadSequenceRef\.current\)/);
  assert.match(newNodeChatSend, /let refreshFailed = false;[\s\S]*catch \{\s*refreshFailed = true;\s*\}[\s\S]*onClearSelection\(\);\s*onSuccess\(\);\s*if \(refreshFailed\)/);
  assert.match(newNodeChatSend, /Chat was saved, but its destination could not refresh\./);
  assert.doesNotMatch(surface, /Choose email node priority|setPriorityMenuOpen|data-email-action-popover|aria-label="Close email comments"/);
  assert.match(surface, /const ensured = await ensureEmailCollaboration\(\{[\s\S]*acceptCollaboration\(ensured\)/);
  assert.doesNotMatch(surface, /const importedCollaborations = await listEmailCollaborations/);
  assert.match(surface, /rollBackPendingChat\(pending\.chat\.id\);[\s\S]{0,260}setDraft\(originalDraft\)/);
  assert.match(surface, /locallySubmittedChatIDsRef\.current\.delete\(event\.message_id\)/);
  assert.match(surface, /const unsubscribes = threadChatNodeIDs\.map[\s\S]*"chat:node:" \+ visibleNodeID/);
  assert.match(workspace, /onContentTopChange=\{setEmailChatTopOffset\}/);
  assert.match(workspace, /topOffset=\{showDetailResizeHandle \? emailChatTopOffset : 0\}/);
  assert.match(detail, /content\.getBoundingClientRect\(\)\.top - root\.getBoundingClientRect\(\)\.top \+ paddingTop/);
  assert.match(surface, /height: topOffset > 0 \? `calc\(100% - \$\{topOffset\}px\)` : "100%"[\s\S]*marginTop: topOffset/);
  assert.doesNotMatch(surface, /parseEditorAttachedEmails|resolveEmailCollaborationChatPlacement/);

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
  assert.match(sharedChat, /sectionNodeIDsByBlockID\?: Record<string, string>/);
  assert.match(sharedChat, /sectionNodeLabelsByNodeID\?: Record<string, string>/);
  assert.match(sharedChat, /sectionNodeOrder\?: string\[\]/);
  assert.match(sharedChat, /sectionKeysByMessageID\?: Record<string, string>/);
  assert.match(sharedChat, /sectionActionLabel\?: string/);
  assert.match(sharedChat, /selectSectionOnClick\?: boolean/);
  assert.match(sharedChat, /data-chat-section-selectable=\{selectSectionOnClick \? "true" : undefined\}/);
  assert.match(sharedChat, /composerDestination\?: ChatComposerDestination/);
  assert.match(sharedChat, /composerDestinationError\?: string/);
  assert.match(sharedChat, /data-chat-section-action="true"/);
  assert.match(sharedChat, /data-chat-section-selected=\{sectionSelected \? "true" : undefined\}/);
  assert.match(sharedChat, /data-chat-composer-highlight="true"[\s\S]*Highlighted text[\s\S]*data-chat-composer-destination="true"[\s\S]*Destination/);
  assert.match(sharedChat, /New Node · New Text Box[\s\S]*Existing Node · New Text Box[\s\S]*Existing Node · Existing Text Box/);
  assert.match(sharedChat, /data-chat-destination-node-entity="true"[\s\S]*<ExplorerEntityIcon kind="node" \/>[\s\S]*composerDestination\.nodeName/);
  assert.match(sharedChat, /composerDestinationError \|\| "Select a Node or text-box grouping"/);
  assert.match(sharedChat, /aria-label="Cancel chat destination"/);
  assert.match(sharedChat, /reserveScrollbarGutter\?: boolean/);
  assert.match(sharedChat, /scrollbarGutter: reserveScrollbarGutter \? "stable" : undefined[\s\S]*padding: reserveScrollbarGutter \? "9px 16px 9px 8px" : "9px 8px"/);
  assert.match(sharedChat, /data-email-chat-node-section=\{showNodeSurface \? "true" : undefined\}[\s\S]*data-email-chat-message-section=\{section\.sectionLabel \? "true" : undefined\}/);
  assert.match(sharedChat, /aria-label=\{selectSectionOnClick \? `Choose Node \$\{nodeGroup\.nodeLabel\}` : `Open Node \$\{nodeGroup\.nodeLabel\}`\}/);
  assert.match(sharedChat, /data-chat-destination-flash=\{nodeFlashed \? "true" : undefined\}[\s\S]*data-chat-destination-flash=\{sectionFlashed \? "true" : undefined\}/);
  assert.match(styles, /\.email-chat-node-section:hover[\s\S]*\.email-chat-textbox-group:hover[\s\S]*@keyframes email-chat-destination-flash/);
  const nodeHoverStyle = styles.match(/\.email-chat-node-section:hover,\s*\n\.email-chat-node-section:focus-within \{([\s\S]*?)\}/)?.[1] ?? "";
  const textboxHoverStyle = styles.match(/\.email-chat-textbox-group:hover,\s*\n\.email-chat-textbox-group:focus-within \{([\s\S]*?)\}/)?.[1] ?? "";
  const nodeWorkspaceHoverStyle = styles.match(/\[data-node-email-chat-parent-destination="true"\]:hover,[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
  for (const hoverStyle of [nodeHoverStyle, textboxHoverStyle, nodeWorkspaceHoverStyle]) {
    assert.match(hoverStyle, /transform: translateY\(-2px\)/);
    assert.match(hoverStyle, /box-shadow:/);
    assert.doesNotMatch(hoverStyle, /background|92,238,255|128,216,255|183,124,255/);
  }
  const nodeSelectedStyle = styles.match(/\.email-chat-node-section\[data-chat-node-selected="true"\] \{([\s\S]*?)\}/)?.[1] ?? "";
  const textboxSelectedStyle = styles.match(/\.email-chat-textbox-group\[data-chat-section-selected="true"\] \{([\s\S]*?)\}/)?.[1] ?? "";
  for (const selectedStyle of [nodeSelectedStyle, textboxSelectedStyle]) {
    assert.match(selectedStyle, /border-color: rgba\(100,116,139/);
    assert.doesNotMatch(selectedStyle, /linear-gradient|92,238,255|128,216,255|183,124,255/);
  }
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
  assert.doesNotMatch(nodeSurface, /emailOriginChatBlockID|resolveLegacyEmailChatHostBlockID/);
  assert.match(nodeSurface, /data-node-email-column="true"/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"/);
  assert.match(nodeSurface, /const chatBlockID = block\.id/);
  assert.match(nodeSurface, /suppressAutomaticCreation: nodeAttachedEmails\.length > 0/);
  assert.doesNotMatch(nodeSurface, /aria-label="Toggle email column"/);
  assert.doesNotMatch(nodeSurface, /data-node-text-box-columns="email-editor-chat"/);
  assert.match(nodeSurface, /blockID=\{block\.id\}[\s\S]*blockID=\{chatBlockID\}/);
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

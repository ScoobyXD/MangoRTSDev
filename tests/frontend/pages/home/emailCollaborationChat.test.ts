import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommunicationsEmailCollaboration } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import {
  buildEmailCollaborationParticipantRoster,
  emailCollaborationChatSessionMounted,
  emailCollaborationChatSessionVisible,
  formatEmailCollaborationChatError,
  reconcileEmailCollaborationChatSession,
  toggleEmailCollaborationChatSession,
  type EmailCollaborationChatSession,
} from "../../../../frontend/src/pages/home/emailCollaborationChat.js";

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

test("My and Shared Triage keep email chat opt-in while reusing the shared ChatPane", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const surface = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/EmailCollaborationChatSurface.tsx"), "utf8");
  const sharedChat = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");

  assert.match(workspace, /emailChatKey[\s\S]*JSON\.stringify\(\[activeViewID, mailbox, selectedMessageRowKey\]\)/);
  assert.match(workspace, /emailChatMounted = emailCollaborationChatSessionMounted\(emailChatSession, emailChatKey\)/);
  assert.match(workspace, /gridTemplateColumns: showDetailResizeHandle && emailChatVisible/);
  assert.match(workspace, /gridTemplateRows: !showDetailResizeHandle && emailChatVisible/);
  assert.match(workspace, /chatAvailable=\{emailChatAvailable\}[\s\S]*chatOpen=\{emailChatVisible\}[\s\S]*onToggleChat=\{toggleEmailChat\}/);
  assert.match(workspace, /\{emailChatMounted && \([\s\S]*<EmailCollaborationChatSurface[\s\S]*active=\{emailChatVisible\}/);
  assert.match(detail, /aria-controls="email-collaboration-chat"[\s\S]*aria-expanded=\{chatOpen\}[\s\S]*aria-pressed=\{chatOpen\}/);
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
});

test("email-node UI reuses the canonical chat, exact reply marker, three-column origin layout, and source tabs", () => {
  const workspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");
  const detail = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");
  const nodeSurface = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurface.tsx"), "utf8");
  const nodeParts = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"), "utf8");
  const projection = readFileSync(resolve(process.cwd(), "frontend/src/modules/editor/editorProjection.ts"), "utf8");

  assert.match(workspace, /message\.collaboration_node_id\?\.trim\(\)[\s\S]*onOpenCollaborationNode\(message\)/);
  assert.match(detail, /Open existing email node[\s\S]*onOpenCollaborationNode\(message\)/);
  assert.match(nodeSurface, /emailOriginChatBlockID = emailOriginAttachedEmail\?\.id\.trim\(\)/);
  assert.match(nodeSurface, /emailOriginPrimaryRow[\s\S]*minmax\(280px, 0\.9fr\) minmax\(320px, 1\.15fr\) minmax\(280px, 0\.9fr\)/);
  assert.match(nodeSurface, /blockID=\{chatBlockID\}[\s\S]*headerTrailing=\{emailOriginPrimaryRow/);
  assert.match(nodeSurface, /tabbed=\{emailOriginPrimaryRow\}/);
  assert.match(nodeParts, /role="tablist" aria-label="Attached email threads"/);
  assert.match(nodeParts, /initialFocusMessageID[\s\S]*scrollIntoView/);
  assert.match(projection, /selection_block_id: input\.selectionBlockID/);
  assert.match(projection, /created_from_email: input\.createdFromEmail === true/);
});

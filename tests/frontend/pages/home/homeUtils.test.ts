import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommunicationsSharedInbox, EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { CompanyExplorerFolder, CompanyExplorerFolderItem } from "../../../../frontend/src/modules/folders/companyExplorerFolders.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gate-map/shared.js";
import type { NodeRecord } from "../../../../frontend/src/modules/node-map/shared.js";
import {
  buildMyLogicGateGroups,
  buildMyNodeGroups,
  buildGVICRoleInboxGroupsByCell,
  buildSharedInboxRows,
  condenseEmailThreadMessages,
  emailAttachmentIsReferencedInline,
  emailAttachmentIsInlineContent,
  emailMessageHasMultipleThreadMessages,
  emailMessageRowAriaLabel,
  emailMessageRowKey,
  emailMailboxMessageKey,
  emailMailboxScopeKey,
  emailThreadMessageCount,
  emailThreadKey,
  fitHomeColumnWidthsToAvailableWidth,
  getHomeColumnMinimumTrackWidth,
  getHomeGridTemplateColumns,
  getHomeViewLabel,
  inboxLogicGateLabel,
  isMailRowActivationKey,
  isWorkspacePanelHomeViewID,
  logicGateTitle,
  messageDocument,
  missingLogicGateRecordIDs,
  getInboxMatrixGridTemplateColumns,
  getInboxMatrixGridTemplateColumnsWithoutSidebar,
  mailboxCountsFromFolders,
  mailboxForHomeView,
  missingEmailThreadMessageIDs,
  nodeDragItemsFromExplorerRows,
  nodeIDsFromExplorerPayload,
  rewriteEmailDocumentCIDSources,
  GVICRoleCellKey,
  resizeHomeColumns,
  resizeHomeInboxMatrixColumnsWithoutSidebar,
  setNodeDragData,
  sharedInboxCanLoadMail,
  sortEmailConversationMessagesNewestFirst,
  unreadEmailThreadMessagesForSelection,
  visibleEmailAttachmentsForBody,
} from "../../../../frontend/src/pages/home/homeUtils.js";
import {
  messageUnreadDotStyle,
  triageMessageMetaStyle,
  triageMessageRowStyle,
  triageMessageStarButtonStyle,
  triageMessageTimestampStyle,
  triageSnippetStyle,
  triageSubjectStyle,
} from "../../../../frontend/src/pages/home/homeStyles.js";
import { EXPLORER_DRAG_MIME } from "../../../../frontend/src/modules/company-explorer/companyExplorerDragDrop.js";
import { EXPLORER_ENTITY_DRAG_MIME } from "../../../../frontend/src/modules/kanban/shared.js";
import { GVIC_INBOX_SECTIONS } from "../../../../frontend/src/pages/home/homeConstants.js";

function sharedInbox(id: string, name: string, position: number, parentID?: string): CommunicationsSharedInbox {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentID,
    folder_kind: "communications",
    name,
    position,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

test("triage email bodies render before cancellable inline-image hydration completes", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  assert.match(homeParts, /useEmailBodyDocument\(message\.id, body, allAttachments, companyID, sharedInboxID, collaborationID, expanded && bodyLoaded\)/);
  assert.match(homeParts, /if \(!enabled \|\| !body\.trim\(\) \|\| inlineAttachments\.length === 0\) return undefined/);
  assert.match(homeParts, /downloadEmailAttachment\(messageID, providerAttachmentID, companyID, sharedInboxID, \{ signal: controller\.signal, collaborationID \}\)/);
  assert.match(homeParts, /const item = await loadInlineAttachment\(attachment\);[\s\S]{0,300}setDownloadedSourceByContentID/);
  assert.match(homeParts, /controller\.abort\(\)/);
  assert.doesNotMatch(homeParts, /bodyDocument\.loading/);
  assert.match(homeParts, /const loadConversationMessageBody = React\.useCallback/);
  assert.match(homeParts, /if \(emailMessageBodyIsLoaded\(conversationMessage\)\) return Promise\.resolve\(conversationMessage\)/);
  assert.match(homeParts, /const body = bodyLoaded \? \(message\.body \?\? ""\) : ""/);
  assert.match(homeParts, /Message body unavailable/);
  assert.doesNotMatch(homeParts, /const body = [^\n]+message\.snippet/);
  assert.match(homeParts, /for \(const conversationMessage of conversationMessages\) void loadConversationMessageBody\(conversationMessage\)/);
});

function node(id: string, title: string, overrides: Partial<NodeRecord> = {}): NodeRecord {
  return {
    company_id: "company-1",
    node_id: id,
    name: title,
    created_timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function logicGate(id: string, roles: LogicGateRecord["gvic_assignments"]): LogicGateRecord {
  return {
    company_id: "company-1",
    logic_gate_id: id,
    header: id,
    gvic_assignments: roles,
    created_timestamp: "2026-01-01T00:00:00Z",
  };
}

function explorerFolder(id: string, name: string, parentFolderID?: string): CompanyExplorerFolder {
  return {
    company_id: "company-1",
    folder_id: id,
    parent_folder_id: parentFolderID,
    folder_kind: "logic_gate",
    name,
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

function explorerFolderItem(folderID: string, itemID: string, itemType: "node" | "logic_gate"): CompanyExplorerFolderItem {
  return {
    company_id: "company-1",
    folder_id: folderID,
    item_type: itemType,
    item_id: itemID,
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
}

function emailMessage(id: string, threadID: string, date: number, overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id,
    thread_id: threadID,
    subject: "Subject",
    snippet: "Preview",
    unread: false,
    starred: false,
    date,
    ...overrides,
  };
}

test("Home view helpers map labels and mailboxes without changing backend mailbox names", () => {
  const shared = [sharedInbox("shared-a", "Team Triage", 1000)];

  assert.equal(getHomeViewLabel("my-triage", shared), "My Triage");
  assert.equal(getHomeViewLabel("shared:shared-a", shared), "Team Triage");
  assert.equal(getHomeViewLabel("shared:missing", shared), "Shared Triage");
  assert.equal(getHomeViewLabel("a-inbox", shared), "Verified Nodes");
  assert.equal(getHomeViewLabel("r-inbox", shared), "Generated Nodes");
  assert.equal(getHomeViewLabel("a-inbox", shared), "Verified Nodes");
  assert.equal(getHomeViewLabel("c-inbox", shared), "Consulted Nodes");
  assert.equal(getHomeViewLabel("i-inbox", shared), "Informed Nodes");
  assert.equal(getHomeViewLabel("o-inbox", shared), "Other Nodes");
  assert.equal(mailboxForHomeView("a-inbox"), "all");
  assert.equal(mailboxForHomeView("o-inbox"), "all");
  assert.equal(mailboxForHomeView("my-triage"), "primary");
  assert.equal(isWorkspacePanelHomeViewID("my-triage"), true);
  assert.equal(isWorkspacePanelHomeViewID("shared-root"), true);
  assert.equal(isWorkspacePanelHomeViewID("shared:shared-a"), true);
  assert.equal(isWorkspacePanelHomeViewID("a-inbox"), true);
  assert.equal(isWorkspacePanelHomeViewID("o-inbox"), true);
});


test("email body inline cid attachments are treated as body images", () => {
  const body = '<p>Here is a screenshot:</p><img src="cid:image-1@local" alt="image.png"><p>done</p>';
  const inlineImage = {
    id: "provider-inline-1",
    filename: "image.png",
    content_type: "image/png",
    content_id: "<image-1@local>",
    is_inline: true,
    size: 86,
  };
  const dashboard = {
    id: "provider-file-1",
    filename: "dashboard.png",
    content_type: "image/png",
    is_inline: false,
    size: 197,
  };

  assert.equal(emailAttachmentIsReferencedInline(body, inlineImage), true);
  assert.equal(emailAttachmentIsReferencedInline(body, dashboard), false);
  assert.equal(emailAttachmentIsInlineContent(inlineImage), true);
  assert.equal(emailAttachmentIsInlineContent(dashboard), false);
  assert.deepEqual(visibleEmailAttachmentsForBody(body, [inlineImage, dashboard]).map((attachment) => attachment.filename), ["dashboard.png"]);
});

test("email cid image sources are rewritten to resolved sources", () => {
  const documentHTML = messageDocument('<div><img src="cid:image-1%40local" alt="image.png"></div>');
  const rewritten = rewriteEmailDocumentCIDSources(documentHTML, { "image-1@local": "blob:http://localhost/image-1" });

  assert.match(rewritten, /src="blob:http:\/\/localhost\/image-1"/);
  assert.doesNotMatch(rewritten, /src="cid:/);

  const unquoted = rewriteEmailDocumentCIDSources(`<img src=cid:image-1%40local>`, { "image-1@local": "blob:http://localhost/image-1" });
  assert.equal(unquoted, `<img src="blob:http://localhost/image-1">`);
});


test("unread dot and frame stay distinct from the full-card selected surface", () => {
  const unreadDot = messageUnreadDotStyle(true);
  assert.equal(unreadDot.visibility, "visible");
  assert.notEqual(unreadDot.background, "transparent");
  assert.notEqual(unreadDot.boxShadow, "none");

  const readDot = messageUnreadDotStyle(false);
  assert.equal(readDot.visibility, "hidden");
  assert.equal(readDot.background, "transparent");
  assert.equal(readDot.boxShadow, "none");

  const unreadRow = triageMessageRowStyle(false, true, true);
  assert.equal(unreadRow.border, "2px solid transparent");
  assert.match(String(unreadRow.background), /border-box/);
  assert.match(String(unreadRow.background), /#38bdf8/);

  const selectedReadRow = triageMessageRowStyle(true, false, true);
  assert.equal(selectedReadRow.border, "1px solid transparent");
  assert.match(String(selectedReadRow.background), /rgba\(25, 168, 255, 0\.12\)/);
  assert.notEqual(selectedReadRow.background, unreadRow.background);

  const selectedUnreadRow = triageMessageRowStyle(true, true, true);
  assert.equal(selectedUnreadRow.border, "2px solid transparent");
  assert.match(String(selectedUnreadRow.background), /rgba\(25, 168, 255, 0\.12\)/);
  assert.match(String(selectedUnreadRow.background), /#38bdf8/);
});

test("triage mail rows reserve only top-right metadata space and let snippets use the card width", () => {
  const row = triageMessageRowStyle(false, false, true);
  assert.equal(row.gridTemplateColumns, "20px minmax(0, 1fr) auto");
  assert.equal(row.gridTemplateRows, "auto auto minmax(0, 1fr) auto");
  assert.equal(row.columnGap, 4);
  assert.equal(row.rowGap, 2);
  assert.equal(row.padding, "7px 5px 6px");

  assert.equal(triageMessageMetaStyle.display, "contents");
  assert.equal(triageMessageTimestampStyle.gridColumn, 3);
  assert.equal(triageMessageTimestampStyle.gridRow, 1);
  assert.equal(triageSubjectStyle.gridColumn, "2 / -1");
  assert.equal(triageSubjectStyle.paddingRight, 34);
  assert.equal(triageMessageStarButtonStyle.width, 22);
  assert.equal(triageMessageStarButtonStyle.height, 22);
  assert.equal(triageSnippetStyle.gridColumn, "2 / -1");
  assert.equal(triageSnippetStyle.gridRow, 3);
});

test("browser tab uses the Mango orange hexagon mark", () => {
  const indexHTML = readFileSync(resolve(process.cwd(), "frontend/index.html"), "utf8");
  const faviconSVG = readFileSync(resolve(process.cwd(), "frontend/public/favicon.svg"), "utf8");

  assert.match(indexHTML, /<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg" \/>/);
  assert.match(indexHTML, /<title>MangoRTS<\/title>/);
  assert.match(faviconSVG, /#ff8820/);
  assert.match(faviconSVG, /points="32,5\.5 55,18\.75 55,45\.25 32,58\.5 9,45\.25 9,18\.75"/);
});

test("collaboration shared drafts are immediate-only and stay out of the browser scheduler", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  assert.match(homePage, /return !draft\.sharedDraft && Number\.isFinite\(scheduledAtMs\)/);
  assert.match(homeParts, /!compose\.sharedDraft && \(\s*<input\s+type="datetime-local"\s+aria-label="Schedule send"/s);
});

test("mail row thread indicators and accessible activation use explicit message counts", () => {
  assert.equal(emailThreadMessageCount({}), 0);
  assert.equal(emailThreadMessageCount({ thread_message_count: Number.NaN }), 0);
  assert.equal(emailThreadMessageCount({ thread_message_count: 2.9 }), 2);
  assert.equal(emailMessageHasMultipleThreadMessages({ thread_message_count: 1 }), false);
  assert.equal(emailMessageHasMultipleThreadMessages({ thread_message_count: 2 }), true);

  assert.equal(
    emailMessageRowAriaLabel({ subject: "Quarterly plan", unread: true, thread_message_count: 3 }, "Alex Example"),
    "Unread email, Alex Example, Quarterly plan, 3 message thread",
  );
  assert.equal(
    emailMessageRowAriaLabel({ subject: "", unread: false, thread_message_count: 1 }, ""),
    "Read email, Unknown sender, (no subject)",
  );

  assert.equal(isMailRowActivationKey("Enter"), true);
  assert.equal(isMailRowActivationKey(" "), true);
  assert.equal(isMailRowActivationKey("Spacebar"), false);
  assert.equal(isMailRowActivationKey("Escape"), false);
});

test("local read mutation keys isolate identical provider ids by user and mailbox scope", () => {
  const personalA = emailMailboxScopeKey("company-1", "user-a", "A@Example.com", "");
  const personalB = emailMailboxScopeKey("company-1", "user-b", "a@example.com", "");
  const personalOtherAccount = emailMailboxScopeKey("company-1", "user-a", "other@example.com", "");
  const sharedA = emailMailboxScopeKey("company-1", "user-a", "shared@example.com", "shared-a");
  const sharedB = emailMailboxScopeKey("company-1", "user-a", "shared@example.com", "shared-b");

  assert.equal(
    emailMailboxMessageKey(personalA, "provider-message-1"),
    emailMailboxMessageKey(emailMailboxScopeKey(" company-1 ", " user-a ", "a@example.com", ""), " provider-message-1 "),
  );
  assert.notEqual(emailMailboxMessageKey(personalA, "provider-message-1"), emailMailboxMessageKey(personalB, "provider-message-1"));
  assert.notEqual(emailMailboxMessageKey(personalA, "provider-message-1"), emailMailboxMessageKey(personalOtherAccount, "provider-message-1"));
  assert.notEqual(emailMailboxMessageKey(personalA, "provider-message-1"), emailMailboxMessageKey(sharedA, "provider-message-1"));
  assert.notEqual(emailMailboxMessageKey(sharedA, "provider-message-1"), emailMailboxMessageKey(sharedB, "provider-message-1"));
});

test("triage email list condenses messages from the same Nylas thread into one visible row", () => {
  const messages = [
    emailMessage("latest-thread-message", "thread-1", 300, { unread: false }),
    emailMessage("solo-message", "", 200, { unread: false }),
    emailMessage("older-thread-message", "thread-1", 100, { unread: true, starred: true }),
  ];

  const condensed = condenseEmailThreadMessages(messages);

  assert.deepEqual(condensed.map((message) => message.id), ["latest-thread-message", "solo-message"]);
  assert.equal(condensed[0].thread_message_count, 2);
  assert.equal(condensed[0].thread_unread_count, 1);
  assert.equal(condensed[0].unread, true);
  assert.equal(condensed[0].starred, true);
  assert.equal(condensed[1].thread_message_count, 1);

  const afterReply = condenseEmailThreadMessages([
    emailMessage("new-reply", "thread-1", 400, { unread: false }),
    ...messages,
  ]);
  assert.deepEqual(afterReply.map((message) => message.id), ["new-reply", "solo-message"]);
  assert.equal(afterReply[0].thread_message_count, 3);
  assert.equal(afterReply[0].unread, true);
  assert.equal(afterReply[0].starred, true);

  const partiallyLoadedAuthoritativeThread = condenseEmailThreadMessages([
    emailMessage("latest-only", "thread-authoritative", 500, { thread_message_count: 4 }),
  ]);
  assert.equal(partiallyLoadedAuthoritativeThread[0]?.thread_message_count, 4);
  assert.equal(emailMessageHasMultipleThreadMessages(partiallyLoadedAuthoritativeThread[0] ?? {}), true);
});

test("triage row and thread identity isolate identical provider ids across mailbox sources", () => {
  const personal = emailMessage("same-message", "same-thread", 300, {
    unread: true,
    client_source_scope_key: "personal-source",
  });
  const shared = emailMessage("same-message", "same-thread", 200, {
    unread: true,
    client_source_scope_key: "shared-source",
  });
  const olderPersonal = emailMessage("older-personal", "same-thread", 100, {
    unread: true,
    client_source_scope_key: "personal-source",
  });

  assert.notEqual(emailMessageRowKey(personal), emailMessageRowKey(shared));
  assert.notEqual(emailThreadKey(personal), emailThreadKey(shared));
  assert.equal(condenseEmailThreadMessages([personal, shared, olderPersonal]).length, 2);
  assert.deepEqual(
    unreadEmailThreadMessagesForSelection([personal, shared, olderPersonal], personal).map((message) => message.id),
    ["same-message", "older-personal"],
  );
});

test("selecting an aggregated unread thread targets every loaded unread member and leaves unrelated threads alone", () => {
  const rawMessages = [
    emailMessage("latest-read", "thread-1", 300, { unread: false }),
    emailMessage("older-unread", "thread-1", 200, { unread: true }),
    emailMessage("oldest-unread", "thread-1", 100, { unread: true }),
    emailMessage("other-unread", "thread-2", 250, { unread: true }),
  ];
  const selectedCard = condenseEmailThreadMessages(rawMessages)[0];
  assert.equal(selectedCard?.id, "latest-read");
  assert.equal(selectedCard?.unread, true);
  assert.deepEqual(
    unreadEmailThreadMessagesForSelection(rawMessages, selectedCard ?? emailMessage("", "", 0)).map((message) => message.id),
    ["older-unread", "oldest-unread"],
  );
});

test("external inbound, user sent reply, and next inbound stay one thread without absorbing forwards", () => {
  const condensed = condenseEmailThreadMessages([
    emailMessage("external-latest", "provider-thread-1", 300, { unread: true, from: [{ email: "external@example.test" }] }),
    emailMessage("user-sent", "provider-thread-1", 200, { folders: ["sent"], from: [{ email: "me@example.test" }] }),
    emailMessage("external-original", "provider-thread-1", 100, { from: [{ email: "external@example.test" }] }),
    emailMessage("forwarded-one-off", "", 250, { subject: "Fwd: unrelated" }),
    emailMessage("different-thread", "provider-thread-2", 150),
  ]);

  assert.deepEqual(condensed.map((message) => message.id), [
    "external-latest",
    "forwarded-one-off",
    "different-thread",
  ]);
  assert.equal(condensed[0]?.thread_message_count, 3);
  assert.equal(condensed[0]?.thread_unread_count, 1);
  assert.equal(condensed[1]?.thread_message_count, 1);
  assert.equal(condensed[2]?.thread_message_count, 1);
});

test("authoritative thread hydration plans exact missing sent and received messages without subject-based merging", () => {
  const loadedExternalConversation = [
    emailMessage("external-latest", "provider-thread-1", 300),
    emailMessage("external-original", "provider-thread-1", 100),
    emailMessage("forwarded-unrelated", "", 250, { subject: "Fwd: Subject" }),
  ];
  assert.deepEqual(
    missingEmailThreadMessageIDs(
      ["external-original", "user-sent", "external-latest"],
      "external-latest",
      loadedExternalConversation,
    ),
    ["user-sent"],
  );
  assert.deepEqual(
    missingEmailThreadMessageIDs(
      ["user-original", "external-reply", "user-second", "external-latest", "external-reply"],
      "external-latest",
      [emailMessage("external-latest", "provider-thread-2", 400), emailMessage("user-original", "provider-thread-2", 100)],
    ),
    ["external-reply", "user-second"],
  );
  assert.deepEqual(
    missingEmailThreadMessageIDs([], "one-off", [emailMessage("forwarded-unrelated", "", 250)]),
    [],
  );
});

test("conversation messages are newest first with a deterministic id tie-breaker", () => {
  const ordered = sortEmailConversationMessagesNewestFirst([
    emailMessage("older", "thread-1", 100),
    emailMessage("same-date-a", "thread-1", 300),
    emailMessage("same-date-b", "thread-1", 300),
    emailMessage("newest", "thread-1", 400),
  ]);

  assert.deepEqual(ordered.map((message) => message.id), ["newest", "same-date-b", "same-date-a", "older"]);
});

test("message documents preserve Mango-authored email body structure", () => {
  const documentHTML = messageDocument('<div data-mango-email-body="true">hello<br>  structure</div>');

  assert.match(documentHTML, /data-mango-email-body="true"/);
  assert.match(documentHTML, /white-space:pre-wrap!important/);
  assert.match(documentHTML, /hello<br>  structure/);
});



test("mailbox count helper keeps visible Inbox and Starred counts", () => {
  const counts = mailboxCountsFromFolders([
    { id: "CATEGORY_PERSONAL", name: "CATEGORY_PERSONAL", total_count: 12 },
    { id: "INBOX", name: "Inbox", attributes: ["\\Inbox"], total_count: 30 },
    { id: "STARRED", name: "STARRED", total_count: 4 },
    { id: "archive-folder", name: "Archive", attributes: ["\\Archive"], total_count: 9 },
  ]);

  assert.deepEqual(counts, { primary: 30, starred: 4 });
});


test("shared inbox rows are stable, sorted, and nested by parent", () => {
  const rows = buildSharedInboxRows([
    sharedInbox("child-b", "Child B", 2000, "root"),
    sharedInbox("root", "Root", 1000),
    sharedInbox("child-a", "Child A", 1000, "root"),
  ]);

  assert.deepEqual(rows.map((row) => [row.folder.folder_id, row.depth]), [
    ["root", 0],
    ["child-a", 1],
    ["child-b", 1],
  ]);
});

test("shared inbox mail loading only targets mailbox-capable entries with an account email", () => {
  assert.equal(sharedInboxCanLoadMail(undefined), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "folder", account_email: "support@example.com" }), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "shared_inbox", account_email: "" }), false);
  assert.equal(sharedInboxCanLoadMail({ entry_type: "shared_inbox", account_email: " support@example.com " }), true);
});

test("GVIC inbox group builder classifies work by role, status, and priority", () => {
  const currentUserID = "user-1";
  const gates = new Map([
    ["gate-a", logicGate("gate-a", [{ company_id: "company-1", logic_gate_id: "gate-a", role: "verified", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-r", logicGate("gate-r", [{ company_id: "company-1", logic_gate_id: "gate-r", role: "generated", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-all", logicGate("gate-all", [
      { company_id: "company-1", logic_gate_id: "gate-all", role: "generated", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "verified", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "consulted", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "informed", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
    ])],
    ["gate-no-r", logicGate("gate-no-r", [])],
    ["gate-other-user", logicGate("gate-other-user", [{ company_id: "company-1", logic_gate_id: "gate-other-user", role: "consulted", user_id: "user-2", created_timestamp: "2026-01-01T00:00:00Z" }])],
  ]);
  const nodes = [
    node("node-a", "Verified node", { logic_gate_ids: ["gate-a"], status: "pending", priority: 1 }),
    node("node-r", "Generated node", { logic_gate_ids: ["gate-r"], status: "in_progress", priority: 2 }),
    node("node-review", "Review node", { logic_gate_ids: ["gate-r"], status: "review", priority: 2 }),
    node("node-all", "All roles node", { logic_gate_ids: ["gate-all"], status: "pending", priority: 1 }),
    node("node-r-unassigned", "Generated no priority node", { logic_gate_ids: ["gate-r"], status: "pending" }),
    node("node-assigned-without-r", "No generated role node", { logic_gate_ids: ["gate-no-r"], status: "in_progress", priority: 2 }),
    node("node-assigned-other-GVIC", "Other GVIC node", { logic_gate_ids: ["gate-other-user"], status: "pending", priority: 3 }),
    node("node-other-no-gate", "Without Logic Gate", { status: "pending", priority: 4 }),
    node("node-other-user", "Other user node", { logic_gate_ids: ["gate-other-user"], priority: 3 }),
    node("node-done", "Done node", { logic_gate_ids: ["gate-r"], status: "Done", priority: 1 }),
  ];
  const nodeByID = new Map(nodes.map((item) => [item.node_id, item]));

  assert.deepEqual(GVIC_INBOX_SECTIONS.map((section) => [section.viewID, section.role]), [
    ["r-inbox", "generated"],
    ["a-inbox", "verified"],
    ["c-inbox", "consulted"],
    ["i-inbox", "informed"],
    ["o-inbox", "other"],
  ]);
  const generatedStatusGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "generated");
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "in_progress", 2))?.[0]?.nodeIDs, ["node-r"]);
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "review", 2))?.[0]?.nodeIDs, ["node-review"]);
  assert.deepEqual((generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs), ["node-all"]);
  assert.deepEqual(generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 0))?.[0]?.nodeIDs, ["node-r-unassigned"]);
  assert.equal(generatedStatusGroups.get(GVICRoleCellKey("generated", "pending", 1))?.some((group) => group.nodeIDs.includes("node-a")), false);
  assert.equal(generatedStatusGroups.get(GVICRoleCellKey("generated", "in_progress", 2))?.some((group) => group.nodeIDs.includes("node-assigned-without-r")), false);
  assert.equal(generatedStatusGroups.has(GVICRoleCellKey("generated", "done", 1)), false);
  const verifiedStatusGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "verified");
  assert.deepEqual((verifiedStatusGroups.get(GVICRoleCellKey("verified", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs).sort(), ["node-a", "node-all"]);
  assert.equal(verifiedStatusGroups.has(GVICRoleCellKey("verified", "in_progress", 2)), false);
  const otherGroups = buildGVICRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "other");
  assert.deepEqual(otherGroups.get(GVICRoleCellKey("other", "pending", 3))?.[0]?.nodeIDs, ["node-assigned-other-GVIC"]);
  assert.deepEqual(otherGroups.get(GVICRoleCellKey("other", "pending", 4))?.[0], {
    logicGateID: "__mango_inbox_no_logic_gate__",
    label: "No Logic Gate",
    nodeIDs: ["node-other-no-gate"],
  });
  const opaqueID = "019e3de8-c507-7a03-a7ab-fbea8f4e1d22";
  assert.equal(inboxLogicGateLabel(opaqueID, new Map()), "Logic Gate");
  assert.equal(logicGateTitle({ logic_gate_id: opaqueID, header: opaqueID }), "Logic Gate");
  assert.deepEqual(missingLogicGateRecordIDs([
    node("node-missing-a", "Missing A", { logic_gate_ids: [opaqueID, "gate-r"] }),
    node("node-missing-b", "Missing B", { logic_gate_ids: [opaqueID, "gate-new"] }),
  ], gates), [opaqueID, "gate-new"]);
});

test("my node groups follow logic gate folders and node drag payloads resolve folder drops", () => {
  const folders = [
    explorerFolder("folder-product", "Product"),
    explorerFolder("folder-growth", "Growth", "folder-product"),
  ];
  const logicGateFolderItems = [
    explorerFolderItem("folder-growth", "gate-growth", "logic_gate"),
  ];
  const nodes = [
    node("node-unfiled", "Unfiled", { priority: 1 }),
    node("node-growth", "Growth Node", { logic_gate_ids: ["gate-growth"], priority: 2 }),
  ];

  const groups = buildMyNodeGroups({ nodes, logicGateFolders: folders, logicGateFolderItems });

  assert.deepEqual(groups.map((group) => [group.label, group.nodes.map((item) => item.node_id)]), [
    ["Product / Growth", ["node-growth"]],
    ["Unfiled Nodes", ["node-unfiled"]],
  ]);
  assert.deepEqual(nodeIDsFromExplorerPayload(
    { kind: "folder", folderID: "folder-product", folderKind: "node" },
    [
      { ...folders[0], folder_kind: "node" },
      { ...folders[1], folder_kind: "node" },
    ],
    [
      explorerFolderItem("folder-product", "node-root", "node"),
      explorerFolderItem("folder-growth", "node-child", "node"),
      explorerFolderItem("folder-growth", "gate-growth", "logic_gate"),
    ],
  ), ["node-root", "node-child"]);
});

test("home node drags include the Logic Gate Arena node payload", () => {
  const nodeByID = new Map([
    ["node-a", node("node-a", "Alpha")],
    ["node-b", node("node-b", "Beta")],
  ]);
  const data = new Map<string, string>();
  const transfer = {
    effectAllowed: "",
    setData(type: string, value: string) {
      data.set(type, value);
    },
  } as unknown as DataTransfer;

  setNodeDragData(transfer, ["node-a", "node-b"], nodeByID);

  assert.equal(JSON.parse(data.get(EXPLORER_DRAG_MIME) ?? "{}").kind, "batch");
  assert.deepEqual(JSON.parse(data.get(EXPLORER_ENTITY_DRAG_MIME) ?? "{}"), {
    itemType: "node_batch",
    nodes: [
      { nodeID: "node-a", label: "Alpha" },
      { nodeID: "node-b", label: "Beta" },
    ],
  });
});

test("home explorer rows expose selected nodes as Logic Gate Arena drag items", () => {
  const nodeByID = new Map([
    ["node-a", node("node-a", "Alpha")],
    ["node-b", node("node-b", "Beta")],
  ]);
  const rows = [
    { id: "folder-root", label: "Root", depth: 0, kind: "folder" as const, folderID: "folder-root", folderKind: "node" as const, scopeLevel: 0, position: 1000, createdTimestamp: "" },
    { id: "node-node-a", label: "Alpha", depth: 1, kind: "node" as const, nodeID: "node-a", folderID: "folder-root", folderKind: "node" as const, scopeLevel: 1, position: 1000, createdTimestamp: "" },
    { id: "node-node-b", label: "Beta", depth: 1, kind: "node" as const, nodeID: "node-b", folderID: "folder-root", folderKind: "node" as const, scopeLevel: 1, position: 2000, createdTimestamp: "" },
  ];

  assert.deepEqual(nodeDragItemsFromExplorerRows({ kind: "folder", folderID: "folder-root", folderKind: "node" }, rows, nodeByID), [
    { nodeID: "node-a", label: "Alpha" },
    { nodeID: "node-b", label: "Beta" },
  ]);
});

test("my logic gate groups merge shortcuts with GVIC-assigned gates", () => {
  const folders = [
    explorerFolder("folder-product", "Product"),
    explorerFolder("folder-growth", "Growth", "folder-product"),
  ];
  const folderItems = [
    explorerFolderItem("folder-growth", "gate-shortcut", "logic_gate"),
    explorerFolderItem("folder-growth", "gate-assigned", "logic_gate"),
  ];
  const shortcut = {
    user_id: "user-1",
    company_id: "company-1",
    logic_gate_id: "gate-shortcut",
    position: 1000,
    created_timestamp: "2026-01-01T00:00:00Z",
    updated_timestamp: "2026-01-01T00:00:00Z",
  };
  const shortcutGate = logicGate("gate-shortcut", []);
  const assignedGate = logicGate("gate-assigned", [{ company_id: "company-1", logic_gate_id: "gate-assigned", role: "consulted", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
  const duplicateAssignedGate = logicGate("gate-shortcut", [{ company_id: "company-1", logic_gate_id: "gate-shortcut", role: "generated", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
  const logicGateByID = new Map([
    [shortcutGate.logic_gate_id, shortcutGate],
    [assignedGate.logic_gate_id, assignedGate],
  ]);

  const groups = buildMyLogicGateGroups({
    shortcuts: [shortcut],
    assignedLogicGates: [assignedGate, duplicateAssignedGate],
    logicGateByID,
    folders,
    folderItems,
  });

  assert.deepEqual(groups.map((group) => [group.label, group.logicGates.map((item) => item.logic_gate_id)]), [
    ["Product / Growth", ["gate-shortcut", "gate-assigned"]],
  ]);
});

test("home column sizing keeps generated grid tracks stable", () => {
  const widths = resizeHomeColumns([200, 320, 360, 380], 1, 80, 1400);

  assert.deepEqual(widths, [200, 400, 390, 380]);
  assert.equal(getHomeGridTemplateColumns(widths), "200px 10px 400px 10px minmax(390px, 1fr) 10px 380px");
  assert.equal(getInboxMatrixGridTemplateColumns(widths), "200px minmax(320px, 1fr) 380px");
  assert.equal(getInboxMatrixGridTemplateColumnsWithoutSidebar(widths), "minmax(320px, 1fr) 10px 380px");
  assert.deepEqual(resizeHomeInboxMatrixColumnsWithoutSidebar(widths, 2, -160, 780), [200, 400, 320, 450]);
});

test("home column sizing fits first-load widths into the available My Triage workspace", () => {
  const fitted = fitHomeColumnWidthsToAvailableWidth([220, 350, 360, 340], 1120, true);

  assert.deepEqual(fitted, [220, 310, 220, 340]);
  assert.equal(fitted.reduce((sum, width) => sum + width, 0) + 30, 1120);
  assert.equal(getHomeColumnMinimumTrackWidth(true), 980);
  assert.equal(getHomeColumnMinimumTrackWidth(false), 800);
});

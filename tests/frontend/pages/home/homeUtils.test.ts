import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CommunicationsSharedInbox, EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import type { LogicGateRecord } from "../../../../frontend/src/modules/logic-gates/types.js";
import type { NodeRecord } from "../../../../frontend/src/modules/nodes/types.js";
import {
  buildMyLogicGateGroups,
  buildMyNodeGroups,
  buildRACIRoleInboxGroupsByCell,
  buildSharedInboxRows,
  condenseEmailThreadMessages,
  emailConversationLogicGateIDs,
  emailAttachmentIsReferencedInline,
  emailAttachmentHasResolvableContent,
  emailAttachmentIsInlineContent,
  emailMessageHasMultipleThreadMessages,
  emailMessageLogicGateIDs,
  emailMessageRowAriaLabel,
  emailMessageRowKey,
  emailMailboxMessageKey,
  emailMailboxScopeKey,
  emailMessagesForOrderedPage,
  emailThreadMessageCount,
  emailThreadKey,
  fitHomeColumnWidthsToAvailableWidth,
  getHomeColumnMinimumTrackWidth,
  getHomeGridTemplateColumns,
  getHomeViewLabel,
  inboxCountPresentation,
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
  mergeEmailMessageIntoScopedMessageList,
  nextEmailMessageAfterRemoval,
  nodeDragItemsFromExplorerRows,
  nodeIDsFromExplorerPayload,
  orderEmailConversationMessages,
  rewriteEmailDocumentCIDSources,
  RACIRoleCellKey,
  resizeEmailChatColumnAtPointer,
  resizeHomeColumns,
  resizeHomeInboxMatrixColumnsWithoutSidebar,
  readTriageMessageDrag,
  setNodeDragData,
  sharedInboxCanLoadMail,
  sortEmailConversationMessagesNewestFirst,
  shouldAutoMarkEmailSelectionRead,
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
import { RACI_INBOX_SECTIONS, TRIAGE_MESSAGE_DRAG_MIME } from "../../../../frontend/src/pages/home/homeConstants.js";

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

function triageDataTransfer(payload: unknown): DataTransfer {
  return {
    getData: (type: string) => type === TRIAGE_MESSAGE_DRAG_MIME ? JSON.stringify(payload) : "",
  } as DataTransfer;
}

test("triage drag parsing preserves one exact normalized personal account", () => {
  assert.deepEqual(readTriageMessageDrag(triageDataTransfer({
    kind: "triage_messages",
    company_id: " company-1 ",
    message_ids: [" message-1 ", "message-1", "message-2"],
    account_email: " SECOND@Example.TEST ",
  })), {
    companyID: "company-1",
    messageIDs: ["message-1", "message-2"],
    sharedInboxID: undefined,
    accountEmail: "second@example.test",
  });
});

test("triage drag parsing makes a shared inbox authoritative over personal account identity", () => {
  assert.deepEqual(readTriageMessageDrag(triageDataTransfer({
    kind: "triage_messages",
    message_ids: ["message-1"],
    shared_inbox_id: " shared-1 ",
    account_email: "ignored@example.test",
  })), {
    messageIDs: ["message-1"],
    sharedInboxID: "shared-1",
    accountEmail: undefined,
    companyID: undefined,
  });
});

test("triage email bodies render before cancellable inline-image hydration completes", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  assert.match(homeParts, /<EmailQuotedHistory body=\{body\}>/);
  assert.match(homeParts, /useEmailBodyDocument\(message\.id, body, attachments, companyID, sharedInboxID, accountEmail, collaborationID, true\)/);
  assert.match(homeParts, /const inlineSourceByAttachmentRef = React\.useRef\(new Map<string, string>\(\)\)/);
  assert.match(homeParts, /if \(cachedSourceURL\) return \{ keys, sourceURL: cachedSourceURL \}/);
  assert.match(homeParts, /inlineSourceByAttachmentRef\.current\.set\(attachmentKey, sourceURL\)/);
  assert.match(homeParts, /inlineObjectURLsRef\.current\.forEach\(\(objectURL\) => URL\.revokeObjectURL\(objectURL\)\)/);
  assert.match(homeParts, /if \(!enabled \|\| !body\.trim\(\) \|\| inlineAttachments\.length === 0\) return undefined/);
  assert.match(homeParts, /downloadEmailAttachment\(messageID, providerAttachmentID, companyID, sharedInboxID, \{ signal: controller\.signal, accountEmail, collaborationID \}\)/);
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
  assert.equal(getHomeViewLabel("a-inbox", shared), "Accountable Nodes");
  assert.equal(getHomeViewLabel("r-inbox", shared), "Responsible Nodes");
  assert.equal(getHomeViewLabel("a-inbox", shared), "Accountable Nodes");
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
  const providerFileWithContentID = {
    id: "provider-file-2",
    filename: "contract.pdf",
    content_type: "application/pdf",
    content_id: "<provider-file-2@local>",
    content_disposition: "attachment",
    is_inline: false,
    size: 2048,
  };

  assert.equal(emailAttachmentIsReferencedInline(body, inlineImage), true);
  assert.equal(emailAttachmentIsReferencedInline(body, dashboard), false);
  assert.equal(emailAttachmentIsReferencedInline(body, providerFileWithContentID), false);
  assert.equal(emailAttachmentIsInlineContent(inlineImage), true);
  assert.equal(emailAttachmentIsInlineContent(dashboard), false);
  assert.equal(emailAttachmentHasResolvableContent({
    attachment_id: "mango-inline-1",
    id: "",
    content: "",
  }), true);
  assert.equal(emailAttachmentHasResolvableContent({
    attachment_id: "", id: "", content: "",
  }), false);

  assert.deepEqual(
    visibleEmailAttachmentsForBody(body, [inlineImage, dashboard, providerFileWithContentID]).map((attachment) => attachment.filename),
    ["dashboard.png", "contract.pdf"],
  );
});

test("email cid image sources are rewritten to resolved sources", () => {
  const documentHTML = messageDocument('<div><img src="cid:image-1%40local" alt="image.png"></div>');
  const rewritten = rewriteEmailDocumentCIDSources(documentHTML, { "image-1@local": "blob:http://localhost/image-1" });

  assert.match(rewritten, /src="blob:http:\/\/localhost\/image-1"/);
  assert.doesNotMatch(rewritten, /src="cid:/);

  const unquoted = rewriteEmailDocumentCIDSources(`<img src=cid:image-1%40local>`, { "image-1@local": "blob:http://localhost/image-1" });
  assert.equal(unquoted, `<img src="blob:http://localhost/image-1">`);
});


test("unread dot remains visible without restoring the blue unread card frame", () => {
  const unreadDot = messageUnreadDotStyle(true);
  assert.equal(unreadDot.visibility, "visible");
  assert.notEqual(unreadDot.background, "transparent");
  assert.notEqual(unreadDot.boxShadow, "none");

  const readDot = messageUnreadDotStyle(false);
  assert.equal(readDot.visibility, "hidden");
  assert.equal(readDot.background, "transparent");
  assert.equal(readDot.boxShadow, "none");

  const unreadRow = triageMessageRowStyle(false, true, true);
  const readRow = triageMessageRowStyle(false, false, true);
  assert.equal(unreadRow.border, readRow.border);
  assert.equal(unreadRow.background, readRow.background);
  assert.doesNotMatch(String(unreadRow.background), /#38bdf8/);

  const selectedReadRow = triageMessageRowStyle(true, false, true);
  assert.equal(selectedReadRow.border, "1px solid transparent");
  assert.match(String(selectedReadRow.background), /rgba\(25, 168, 255, 0\.12\)/);
  assert.notEqual(selectedReadRow.background, unreadRow.background);

  const selectedUnreadRow = triageMessageRowStyle(true, true, true);
  assert.equal(selectedUnreadRow.border, selectedReadRow.border);
  assert.equal(selectedUnreadRow.background, selectedReadRow.background);
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

test("personal and shared-inbox owner drafts retain the browser scheduler", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  assert.match(homePage, /return Number\.isFinite\(scheduledAtMs\)/);
  assert.match(homePage, /await loadHomeMailDraft\(companyID, currentUserID, draft\)[\s\S]{0,700}await sendHomeMailComposeCommand/);
  assert.doesNotMatch(homePage, /draft\.sharedDraft/);
  assert.match(homeParts, /<input\s+type="datetime-local"\s+aria-label="Schedule send"/s);
});

test("mailbox archive advance, user-driven pagination, and provider-wide oldest ordering stay wired", () => {
  const homePage = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  const homeWorkspace = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeMailWorkspace.tsx"), "utf8");

  assert.match(homePage, /nextEmailMessageAfterRemoval\(visibleMessages, selectedMessageRowKey\)/);
  assert.match(homePage, /archiveMessages\(\[selectedMessage\.id\], \[selectedMessage\], nextMessage\)/);
  assert.doesNotMatch(homePage, /messageListContentScrollHeight\(list\) <= list\.clientHeight \+ 1\)[\s\S]{0,120}loadMoreMessages\(\)/);
  assert.match(homePage, /if \(queuedMessageReloadTimerRef\.current !== null\) return/);
  assert.match(homePage, /if \(messageRequestKeyRef\.current === requestKey\) \{\s*if \(options\.refresh === true\) \{\s*pendingMessageReloadRef\.current = true;/s);
  assert.doesNotMatch(homePage, /pendingMessageRefreshRef/);
  assert.match(homePage, /if \(currentMessageFilterKey\(\) !== queuedRequestKey\) return;\s*void loadMessagesRef\.current\?\.\(\{ refresh: true \}\)/s);
  assert.match(homePage, /messageRequestKeyRef\.current = requestKey;\s*clearPrefetchedMessagePage\(\)/s);
  assert.match(homeWorkspace, /aria-busy=\{loadingMessages \|\| loadingMoreMessages\}/);
  assert.match(homeWorkspace, /role="status" style=\{emptyStateStyle\}>Loading messages<\/div>/);
  assert.match(homeWorkspace, /!triageAdvanceEnabled && hasNextMessagePage[\s\S]{0,300}disabled=\{loadingMessages \|\| loadingMoreMessages\}[\s\S]{0,180}\{loadingMoreMessages \? "Loading\.\.\." : "Load more"\}/);
  assert.match(homeWorkspace, /if \(remaining < 160\) onLoadMoreMessages\(\)/);
  assert.match(homePage, /order: messageListOrder === "oldest" \? "oldest" : undefined/);
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

test("email entity indicators inherit Logic Gates from their attached Node across the thread", () => {
  const nodeByID = new Map<string, Pick<NodeRecord, "logic_gate_ids">>([
    ["node-1", { logic_gate_ids: ["gate-from-node", "gate-shared"] }],
  ]);
  const first = emailMessage("message-1", "thread-1", 200, {
    collaboration_node_id: "node-1",
    logic_gate_ids: ["gate-direct", "gate-shared"],
  });
  const second = emailMessage("message-2", "thread-1", 100, { logic_gate_ids: ["gate-second"] });

  assert.deepEqual(emailMessageLogicGateIDs(first, nodeByID), ["gate-direct", "gate-shared", "gate-from-node"]);
  assert.deepEqual(
    emailConversationLogicGateIDs([first, second], nodeByID),
    ["gate-direct", "gate-shared", "gate-from-node", "gate-second"],
  );
});

test("archive advance selects the visible row below and falls back to the previous row at the end", () => {
  const first = emailMessage("first", "thread-1", 300);
  const second = emailMessage("second", "thread-2", 200);
  const third = emailMessage("third", "thread-3", 100);
  const messages = [first, second, third];

  assert.equal(nextEmailMessageAfterRemoval(messages, emailMessageRowKey(first))?.id, "second");
  assert.equal(nextEmailMessageAfterRemoval(messages, emailMessageRowKey(second))?.id, "third");
  assert.equal(nextEmailMessageAfterRemoval(messages, emailMessageRowKey(third))?.id, "second");
  assert.equal(nextEmailMessageAfterRemoval(messages, "missing"), null);
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

test("scoped star updates replace the unscoped row loaded by the triage list", () => {
  const visible = emailMessage("same-message", "thread-1", 100, { starred: false });
  const updated = emailMessage("same-message", "thread-1", 100, {
    client_source_scope_key: "personal:owner@example.test",
    starred: true,
  });

  const merged = mergeEmailMessageIntoScopedMessageList([visible], updated, { mailbox: "primary", limit: 25 });

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.starred, true);
  assert.equal(merged[0]?.client_source_scope_key, "personal:owner@example.test");
});

test("scoped star updates preserve an explicit same-id row from another mailbox source", () => {
  const target = emailMessage("same-message", "thread-1", 100, {
    client_source_scope_key: "personal:owner@example.test",
    starred: false,
  });
  const protectedMessage = emailMessage("same-message", "thread-2", 90, {
    client_source_scope_key: "shared:team-inbox",
    starred: false,
  });
  const updated = emailMessage("same-message", "thread-1", 100, {
    client_source_scope_key: "personal:owner@example.test",
    starred: true,
  });

  const merged = mergeEmailMessageIntoScopedMessageList([target, protectedMessage], updated, { mailbox: "primary", limit: 25 });
  const targetRow = merged.find((message) => emailMessageRowKey(message) === emailMessageRowKey(target));
  const protectedRow = merged.find((message) => emailMessageRowKey(message) === emailMessageRowKey(protectedMessage));

  assert.equal(merged.length, 2);
  assert.equal(targetRow?.starred, true);
  assert.equal(protectedRow?.starred, false);
  assert.equal(protectedRow?.thread_id, "thread-2");
});

test("unread-only email cards stay visible when selected", () => {
  assert.equal(shouldAutoMarkEmailSelectionRead(true), false);
  assert.equal(shouldAutoMarkEmailSelectionRead(false), true);
  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  assert.match(source, /!shouldAutoMarkEmailSelectionRead\(unreadOnlyRef\.current\)/);
});

test("archive jobs close response and reconnect races with one canonical status read", () => {
  const source = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomePage.tsx"), "utf8");
  assert.match(source, /activeArchiveJobsRef\.current\.set\(result\.archiveJob\.job_id,[\s\S]{0,260}requestArchiveJobRevalidation\(result\.archiveJob\.job_id\)/);
  assert.match(source, /onAccepted: \(\) => \{[\s\S]{0,180}archiveCoordinator\.accepted\(\)/);
  assert.match(source, /job = await getCommunicationsArchiveJob\(jobID, \{ refresh: true \}\)/);
  assert.match(source, /markCommunicationsArchiveJobsStaleForMailboxChange/);
  assert.doesNotMatch(source, /refreshActiveArchiveJobs|refreshArchiveJobsRef/);
  assert.doesNotMatch(source, /setInterval\([^)]*getCommunicationsArchiveJob|archiveJobPoll/);
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

test("conversation messages are newest first with a deterministic id tie-breaker", () => {
  const ordered = sortEmailConversationMessagesNewestFirst([
    emailMessage("older", "thread-1", 100),
    emailMessage("same-date-a", "thread-1", 300),
    emailMessage("same-date-b", "thread-1", 300),
    emailMessage("newest", "thread-1", 400),
  ]);

  assert.deepEqual(ordered.map((message) => message.id), ["newest", "same-date-b", "same-date-a", "older"]);
});

test("conversation ordering can be switched to oldest first without changing the newest-first default", () => {
  const messages = [
    emailMessage("middle", "thread-1", 200),
    emailMessage("newest", "thread-1", 300),
    emailMessage("oldest", "thread-1", 100),
  ];

  assert.deepEqual(orderEmailConversationMessages(messages, "newest").map((message) => message.id), ["newest", "middle", "oldest"]);
  assert.deepEqual(orderEmailConversationMessages(messages, "oldest").map((message) => message.id), ["oldest", "middle", "newest"]);
});

test("mailbox ordering selects page membership from the complete filtered tab", () => {
  const snapshot = Array.from({ length: 20 }, (_, index) => (
    emailMessage(`message-${index + 1}`, `thread-${index + 1}`, index + 1)
  ));

  assert.deepEqual(
    emailMessagesForOrderedPage(snapshot, "newest", 3).map((message) => message.id),
    ["message-20", "message-19", "message-18"],
  );
  assert.deepEqual(
    emailMessagesForOrderedPage(snapshot, "oldest", 3).map((message) => message.id),
    ["message-1", "message-2", "message-3"],
  );
});

test("mailbox ordering composes with search and unread filtering without mutating the complete filtered tab", () => {
  const page = [
    emailMessage("old-match", "thread-1", 100, { unread: true, subject: "Quarterly plan" }),
    emailMessage("read-match", "thread-2", 200, { unread: false, subject: "Quarterly plan" }),
    emailMessage("new-match", "thread-3", 400, { unread: true, subject: "Quarterly review" }),
    emailMessage("other", "thread-4", 300, { unread: true, subject: "Status report" }),
  ];
  const filtered = page.filter((message) => message.unread && message.subject.toLowerCase().includes("quarterly"));
  const filteredIDs = filtered.map((message) => message.id);

  assert.deepEqual(orderEmailConversationMessages(filtered, "newest").map((message) => message.id), ["new-match", "old-match"]);
  assert.deepEqual(orderEmailConversationMessages(filtered, "oldest").map((message) => message.id), ["old-match", "new-match"]);
  assert.deepEqual(filtered.map((message) => message.id), filteredIDs);
});

test("message documents preserve Mango-authored email body structure", () => {
  const documentHTML = messageDocument('<div data-mango-email-body="true">hello<br>  structure</div>');

  assert.match(documentHTML, /data-mango-email-body="true"/);
  assert.match(documentHTML, /white-space:pre-wrap!important/);
  assert.match(documentHTML, /hello<br>  structure/);
});



test("mailbox count helper keeps provider totals for counter and mutation baselines", () => {
  const counts = mailboxCountsFromFolders([
    { id: "CATEGORY_PERSONAL", name: "CATEGORY_PERSONAL", total_count: 12 },
    { id: "INBOX", name: "Inbox", attributes: ["\\Inbox"], total_count: 30 },
    { id: "STARRED", name: "STARRED", total_count: 4 },
    { id: "archive-folder", name: "Archive", attributes: ["\\Archive"], total_count: 9 },
  ]);

  assert.deepEqual(counts, { primary: 30, starred: 4 });
});

test("Inbox count presentation prefers an exact total and otherwise labels a loaded minimum", () => {
  assert.deepEqual(inboxCountPresentation(30, 12, true), { count: 30, isMinimum: false });
  assert.deepEqual(inboxCountPresentation(undefined, 12, true), { count: 12, isMinimum: true });
  assert.deepEqual(inboxCountPresentation(undefined, 0, false), { count: 0, isMinimum: false });
  assert.deepEqual(inboxCountPresentation(undefined, undefined, false), { count: undefined, isMinimum: false });
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

test("RACI inbox group builder classifies work by role, status, and priority", () => {
  const currentUserID = "user-1";
  const gates = new Map([
    ["gate-a", logicGate("gate-a", [{ company_id: "company-1", logic_gate_id: "gate-a", role: "accountable", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-r", logicGate("gate-r", [{ company_id: "company-1", logic_gate_id: "gate-r", role: "responsible", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" }])],
    ["gate-all", logicGate("gate-all", [
      { company_id: "company-1", logic_gate_id: "gate-all", role: "responsible", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "accountable", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "consulted", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
      { company_id: "company-1", logic_gate_id: "gate-all", role: "informed", user_id: currentUserID, created_timestamp: "2026-01-01T00:00:00Z" },
    ])],
    ["gate-no-r", logicGate("gate-no-r", [])],
    ["gate-other-user", logicGate("gate-other-user", [{ company_id: "company-1", logic_gate_id: "gate-other-user", role: "consulted", user_id: "user-2", created_timestamp: "2026-01-01T00:00:00Z" }])],
  ]);
  const nodes = [
    node("node-a", "Accountable node", { logic_gate_ids: ["gate-a"], status: "pending", priority: 1 }),
    node("node-r", "Responsible node", { logic_gate_ids: ["gate-r"], status: "in_progress", priority: 2 }),
    node("node-review", "Review node", { logic_gate_ids: ["gate-r"], status: "review", priority: 2 }),
    node("node-all", "All roles node", { logic_gate_ids: ["gate-all"], status: "pending", priority: 1 }),
    node("node-r-unassigned", "Responsible no priority node", { logic_gate_ids: ["gate-r"], status: "pending" }),
    node("node-assigned-without-r", "No responsible role node", { logic_gate_ids: ["gate-no-r"], status: "in_progress", priority: 2 }),
    node("node-assigned-other-RACI", "Other RACI node", { logic_gate_ids: ["gate-other-user"], status: "pending", priority: 3 }),
    node("node-other-no-gate", "Without Logic Gate", { status: "pending", priority: 4 }),
    node("node-other-user", "Other user node", { logic_gate_ids: ["gate-other-user"], priority: 3 }),
    node("node-done", "Done node", { logic_gate_ids: ["gate-r"], status: "Done", priority: 1 }),
  ];
  const nodeByID = new Map(nodes.map((item) => [item.node_id, item]));

  assert.deepEqual(RACI_INBOX_SECTIONS.map((section) => [section.viewID, section.role]), [
    ["r-inbox", "responsible"],
    ["a-inbox", "accountable"],
    ["c-inbox", "consulted"],
    ["i-inbox", "informed"],
    ["o-inbox", "other"],
  ]);
  const responsibleStatusGroups = buildRACIRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "responsible");
  assert.deepEqual(responsibleStatusGroups.get(RACIRoleCellKey("responsible", "in_progress", 2))?.[0]?.nodeIDs, ["node-r"]);
  assert.deepEqual(responsibleStatusGroups.get(RACIRoleCellKey("responsible", "review", 2))?.[0]?.nodeIDs, ["node-review"]);
  assert.deepEqual((responsibleStatusGroups.get(RACIRoleCellKey("responsible", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs), ["node-all"]);
  assert.deepEqual(responsibleStatusGroups.get(RACIRoleCellKey("responsible", "pending", 0))?.[0]?.nodeIDs, ["node-r-unassigned"]);
  assert.equal(responsibleStatusGroups.get(RACIRoleCellKey("responsible", "pending", 1))?.some((group) => group.nodeIDs.includes("node-a")), false);
  assert.equal(responsibleStatusGroups.get(RACIRoleCellKey("responsible", "in_progress", 2))?.some((group) => group.nodeIDs.includes("node-assigned-without-r")), false);
  assert.equal(responsibleStatusGroups.has(RACIRoleCellKey("responsible", "done", 1)), false);
  const accountableStatusGroups = buildRACIRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "accountable");
  assert.deepEqual((accountableStatusGroups.get(RACIRoleCellKey("accountable", "pending", 1)) ?? []).flatMap((group) => group.nodeIDs).sort(), ["node-a", "node-all"]);
  assert.equal(accountableStatusGroups.has(RACIRoleCellKey("accountable", "in_progress", 2)), false);
  const otherGroups = buildRACIRoleInboxGroupsByCell(nodes, nodeByID, gates, currentUserID, "other");
  assert.deepEqual(otherGroups.get(RACIRoleCellKey("other", "pending", 3))?.[0]?.nodeIDs, ["node-assigned-other-RACI"]);
  assert.deepEqual(otherGroups.get(RACIRoleCellKey("other", "pending", 4))?.[0], {
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

test("my node groups stay independent of Company Explorer folder preloads", () => {
  const nodes = [
    node("node-unfiled", "Unfiled", { priority: 1 }),
    node("node-growth", "Growth Node", { logic_gate_ids: ["gate-growth"], priority: 2 }),
  ];

  const groups = buildMyNodeGroups({ nodes });

  assert.deepEqual(groups.map((group) => [group.label, group.nodes.map((item) => item.node_id)]), [
    ["My Nodes", ["node-unfiled", "node-growth"]],
  ]);
  assert.deepEqual(nodeIDsFromExplorerPayload(
    { kind: "batch", itemType: "node", items: [
      { itemID: "node-root", itemType: "node" },
      { itemID: "node-child", itemType: "node" },
    ] },
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

test("my logic gate groups merge shortcuts with RACI-assigned gates without Explorer folders", () => {
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
  const duplicateAssignedGate = logicGate("gate-shortcut", [{ company_id: "company-1", logic_gate_id: "gate-shortcut", role: "responsible", user_id: "user-1", created_timestamp: "2026-01-01T00:00:00Z" }]);
  const logicGateByID = new Map([
    [shortcutGate.logic_gate_id, shortcutGate],
    [assignedGate.logic_gate_id, assignedGate],
  ]);

  const groups = buildMyLogicGateGroups({
    shortcuts: [shortcut],
    assignedLogicGates: [assignedGate, duplicateAssignedGate],
    logicGateByID,
  });

  assert.deepEqual(groups.map((group) => [group.label, group.logicGates.map((item) => item.logic_gate_id)]), [
    ["My Logic Gates", ["gate-shortcut", "gate-assigned"]],
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

test("email chat left-edge resizing anchors the right edge and protects both columns", () => {
  assert.equal(resizeEmailChatColumnAtPointer(100, 1000, 650), 450);
  assert.equal(resizeEmailChatColumnAtPointer(100, 1000, 900), 320, "chat width keeps its minimum");
  assert.equal(resizeEmailChatColumnAtPointer(100, 1000, 200), 680, "email detail keeps its minimum");
});

test("home column sizing fits first-load widths into the available My Triage workspace", () => {
  const fitted = fitHomeColumnWidthsToAvailableWidth([220, 350, 360, 340], 1120, true);

  assert.deepEqual(fitted, [220, 310, 220, 340]);
  assert.equal(fitted.reduce((sum, width) => sum + width, 0) + 30, 1120);
  assert.equal(getHomeColumnMinimumTrackWidth(true), 980);
  assert.equal(getHomeColumnMinimumTrackWidth(false), 800);
});

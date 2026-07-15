import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveEditorEmailMailboxScope } from "../../../../frontend/src/modules/editor/editorEmailMailboxScope.js";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("node email mailbox scopes normalize personal accounts and suppress them for shared inboxes", () => {
  assert.deepEqual(resolveEditorEmailMailboxScope(undefined, " Owner@Example.Test "), { accountEmail: "owner@example.test" });
  assert.deepEqual(resolveEditorEmailMailboxScope(" shared-1 ", "ignored@example.test"), { sharedInboxID: "shared-1" });
  assert.deepEqual(resolveEditorEmailMailboxScope("", ""), {});
});

test("node-attached email viewer discloses per-message recipients while retaining thread, attachment, and image behavior", () => {
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");

  assert.match(nodeParts, /Expand all threads/);
  assert.match(nodeParts, /replyAllAddressDrafts/);
  assert.match(nodeParts, /Reply all/);
  assert.match(nodeParts, /setCcDraft/);
  assert.match(nodeParts, /setBccDraft/);
  assert.match(nodeParts, /<strong>Cc:<\/strong> \{formatAddressList\(threadMessage\.cc\)\}/);
  assert.match(nodeParts, /<strong>Bcc:<\/strong> \{formatAddressList\(threadMessage\.bcc\)\}/);
  assert.match(nodeParts, /aria-expanded=\{isExpanded\}/);
  assert.match(nodeParts, /\{isExpanded && \(useRichThreadBody/);
  assert.match(nodeParts, /\{isExpanded && \(\s*<EmailMessageAttachments/);
  assert.match(nodeParts, /<EmailBodyFrame/);
  assert.match(nodeParts, /splitEmailQuotedHistory\(fullThreadBody\)/);
  assert.match(nodeParts, /body=\{displayThreadBody\}/);
  assert.match(nodeParts, /data-email-timeline-item="true"/);
  assert.match(nodeParts, /normalizeEmailThreadMessages\(candidates, "oldest"\)/);
  assert.match(nodeParts, /data-email-message-id=\{threadMessage\.id\}/);
  assert.match(nodeParts, /data-email-message-sources=\{emailThreadMessageSourceLabel\(threadMessage\)\}/);
  assert.match(nodeParts, /Show quoted history/);
  assert.match(nodeParts, /Hide quoted history/);
  assert.match(nodeParts, /onSelectionChange=\{canUseEmailSelection/);
  assert.match(nodeParts, /rewriteEmailCIDImages/);
  assert.match(nodeParts, /Download image/);
  assert.match(nodeParts, /setPreviewImage/);
  assert.match(nodeParts, /<EmailMessageAttachments/);
  assert.match(nodeParts, /visibleEmailAttachmentsForBody\(message\.body \|\| message\.snippet \|\| "", allAttachments\)/);
  assert.doesNotMatch(nodeParts, /filter\(\(attachment\) => !attachment\.is_inline && !attachment\.content_id\?\.trim\(\)\)/);
  assert.match(nodeParts, /\{contentType\} · \{sizeLabel\}/);
  assert.match(nodeParts, /respondToCalendarInvite/);
  assert.match(nodeParts, /sharedInboxID=\{email\.sharedInboxID\}/);
  assert.match(nodeParts, /accountEmail=\{email\.accountEmail\}/);
  assert.match(nodeParts, /respondToCalendarInvite\(\{ messageID: message\.id, status, companyID, sharedInboxID, accountEmail \}\)/);
  assert.match(nodeParts, /downloadEmailAttachment\(message\.id, providerAttachmentID, companyID, sharedInboxID, \{ accountEmail, collaborationID \}\)/);
  assert.match(nodeParts, /getEmailMessage\(email\.messageID, companyID, mailboxScope\.sharedInboxID, \{ accountEmail: mailboxScope\.accountEmail \}\)/);
  assert.match(nodeParts, /getEmailThread\(threadID, companyID, mailboxScope\.sharedInboxID, mailboxScope\.accountEmail\)/);
  assert.match(nodeParts, /listEmailMessages\(\{ companyID, \.\.\.mailboxScope, mailbox: "all"/);
  assert.match(nodeParts, /account_email: mailboxScope\.accountEmail/);
  assert.match(nodeParts, /status\.connected && status\.status === "connected"/);
  assert.match(nodeParts, /if \(!accountScopeResolved \|\| !accountEmail\) return/);
  assert.ok((nodeParts.match(/listEmailMessages\(\{\s*accountEmail,/g) ?? []).length >= 3);
  assert.match(nodeParts, /Calendar invitation/);
  assert.match(nodeParts, /window\.setTimeout\(\(\) => replyEditorControllerRef\.current\?\.focus\(\), 0\)/);
});

test("both node email attachment entry paths retain exact provider mailbox identity", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const editorProjection = source("frontend/src/modules/editor/editorProjection.ts");

  assert.match(nodeSurface, /const attachEmail = useCallback/);
  assert.match(nodeSurface, /sharedInboxID: email\.sharedInboxID/);
  assert.match(nodeSurface, /accountEmail: email\.accountEmail/);
  assert.match(nodeSurface, /information: buildEditorAttachedEmailPayload\(\{ \.\.\.email, blockID: cleanBlockID \}\)/);
  assert.match(nodeSurface, /parseDraggedEmail\(event\.dataTransfer\)/);
  assert.match(nodeSurface, /messageAttachmentPayload\(message, scope\.sharedInboxID, scope\.accountEmail\)/);
  assert.match(editorProjection, /shared_inbox_id: input\.sharedInboxID\?\.trim\(\) \?\? ""/);
  assert.match(editorProjection, /account_email: input\.accountEmail\?\.trim\(\) \?\? ""/);
  assert.doesNotMatch(editorProjection, /attachments: input\.attachments/);
});

test("triage thread controls and reply resize pointer lifecycle are explicit", () => {
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");
  const homePage = source("frontend/src/pages/home/HomePage.tsx");

  assert.match(homeParts, /Expand all threads/);
  assert.match(homeParts, /handle\.setPointerCapture\(pointerID\)/);
  assert.match(homeParts, /lostpointercapture/);
  assert.match(homeParts, /window\.addEventListener\("blur", finishResize/);
  assert.match(homeParts, /image\.addEventListener\("dblclick", previewSelectedImage\)/);
  assert.match(homeParts, /Download image/);
  assert.match(homeParts, /function CalendarInviteActions/);
  assert.match(homeParts, /compose\.focusRequestID/);
  assert.match(homeParts, /Accept/);
  assert.match(homeParts, /Tentative/);
  assert.match(homeParts, /Decline/);
  assert.match(homePage, /requiredReplyAllRecipients/);
  assert.match(homePage, /mergeEmailAddressDrafts\(\[existingDraft\.cc, requiredReplyAllRecipients\.cc\], \[to\]\)/);
});
test("sent triage preserves the three-button header and new-message compose fills the available detail height", () => {
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");

  assert.match(homeWorkspace, /const triageAdvanceVisible = triageAdvanceEnabled \|\| \(isArchivableListView && mailbox === "sent"\)/);
  assert.match(homeWorkspace, /style=\{triageAdvanceVisible \? mailComposeSentTriageActionsStyle : mailComposeSentActionsStyle\}/);
  assert.match(homeWorkspace, /\{triageAdvanceVisible && \(/);
  assert.match(homeWorkspace, /disabled=\{!triageAdvanceEnabled \|\| advanceDisabled\}/);

  assert.match(homeParts, /height: "100%"/);
  assert.match(homeParts, /gridTemplateRows: replyMode \? "auto minmax\(0, 1fr\) auto" : "auto minmax\(0, 1fr\)"/);
  assert.match(homeParts, /const composeNewMessageDockStyle/);
  assert.match(homeParts, /minmax\(180px, 1fr\)/);
  assert.match(homeParts, /isReplyMode \? composeReplyDockStyle : composeNewMessageDockStyle/);
  assert.doesNotMatch(homeParts, /height: "min\(280px, 34vh\)"/);
  assert.match(homeParts, /emailAttachmentHasResolvableContent\(attachment\)/);
});


test("triage email selection, history, and archive prefetch preserve the foreground detail path", () => {
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");
  const homePage = source("frontend/src/pages/home/HomePage.tsx");

  assert.match(homePage, /PRIMARY_TRIAGE_PAGE_FILL_MAX_REQUESTS = 4/);
  assert.match(homePage, /additionalPageRequests < PRIMARY_TRIAGE_PAGE_FILL_MAX_REQUESTS/);
  assert.match(homePage, /consumePrefetchedMessagePage\(filterKey, pageToken\)/);
  assert.match(homePage, /await matchingPrefetch;[\s\S]{0,200}consumePrefetchedMessagePage\(filterKey, pageToken\)/);
  assert.match(homePage, /EMAIL_DETAIL_FOREGROUND_GRACE_MS/);
  assert.match(homePage, /useEffect\(\(\) => \{ void loadMessages\(\); \}, \[loadMessages\]\)/);
  assert.match(homePage, /preserveCurrentThread[\s\S]{0,300}: \[visiblePrimaryMessage\]/);
  assert.match(homePage, /loadSelectedThreadMessageBody/);
  assert.match(homePage, /await getEmailMessage\(selectedMessageID[\s\S]{0,2200}await getEmailThread\(threadID/);
  assert.match(homePage, /authoritativeMessageIDs = cleanIDList\(thread\.message_ids \?\? \[\]\)/);
  assert.match(homePage, /const missingMessageIDs = missingEmailThreadMessageIDs\(/);
  assert.match(homePage, /for \(let index = 0; index < missingMessageIDs\.length; index \+= 4\)/);
  assert.match(homePage, /EMAIL_THREAD_PREVIEW_MAX_PAGES = 8/);
  assert.match(homePage, /Some messages in this email thread could not be loaded/);
  assert.doesNotMatch(homePage, /Promise\.all\(detailIDs/);
  assert.match(homeParts, /onLoadMessageBody/);
});

test("personal and shared mail rows expose unread, selected, thread, and keyboard semantics", () => {
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");

  assert.match(homeWorkspace, /aria-pressed=\{active\}/);
  assert.match(homeWorkspace, /aria-label=\{emailMessageRowAriaLabel\(message, rowAddressLabel\)\}/);
  assert.match(homeWorkspace, /if \(!isMailRowActivationKey\(event\.key\)\) return;[\s\S]{0,140}onSelectMessage\(message, event\)/);
  assert.match(homeWorkspace, /<MessageLeadingIndicators message=\{message\} active=\{active\} \/>/);
  assert.match(homeParts, /emailMessageHasMultipleThreadMessages\(message\)/);
  assert.match(homeParts, /role="img" aria-label=\{label\} title=\{label\}/);
  assert.match(homeParts, /messageUnreadDotStyle\(message\.unread\)/);
  assert.doesNotMatch(homeParts, /messageSelectDotStyle/);
});

test("read-on-open rollback and draft scope stay wired through shared Home paths", () => {
  const homePage = source("frontend/src/pages/home/HomePage.tsx");
  const drafts = source("frontend/src/pages/home/homeMailDrafts.ts");

  assert.ok(homePage.includes("locallyReadMessageKeysRef.current.add(messageKey)"));
  assert.ok(homePage.includes("unreadEmailThreadMessagesForSelection(messagesRef.current, message)"));
  const markReadStart = homePage.indexOf("const markMessageReadFromListSelection");
  const markReadEnd = homePage.indexOf("const selectMessageRow", markReadStart);
  assert.ok(markReadStart >= 0 && markReadEnd > markReadStart);
  const markReadSource = homePage.slice(markReadStart, markReadEnd);
  assert.match(markReadSource, /const requestViewID = activeViewIDRef\.current/);
  assert.match(markReadSource, /requestMailbox === "drafts"/);
  assert.match(markReadSource, /const requestFilterKey = messageListFilterKey/);
  assert.match(markReadSource, /const requestEmailMailboxScopeKey = activeEmailMailboxScopeKeyRef\.current/);
  assert.match(markReadSource, /const requestUserID = currentUserID/);
  assert.match(markReadSource, /if \(currentUserIDRef\.current !== requestUserID\)/);
  assert.match(markReadSource, /const requestSelectionGeneration = messageSelectionGenerationRef\.current/);
  assert.match(markReadSource, /requestStillOwnsVisibleList/);
  assert.match(markReadSource, /selectedThreadStillActive/);
  assert.match(markReadSource, /if \(!requestStillOwnsVisibleList\(\)\) return;/);
  assert.match(markReadSource, /: current\)\);/);
  assert.doesNotMatch(markReadSource, /mailboxRef\.current !== "primary"\) return;/);
  assert.ok(homePage.includes("applyLocalReadOverlays(messages: EmailMessage[], locallyReadMessageKeys: Set<string>, mailboxScopeKey: string)"));
  assert.ok(homePage.includes("markReadMutationTokenByMessageKeyRef.current.get(messageKey) !== mutationToken"));
  assert.ok(homePage.includes("selectedMessageRef.current = visiblePrimaryMessage"));
  assert.ok(homePage.includes("activeViewIDRef.current = viewID"));
  assert.match(homePage, /useLayoutEffect\(\(\) => \{\s*messagesRef\.current = messages;/);
  assert.ok(homePage.includes("const rollback = { ...messageToMark, unread: true }"));
  assert.ok(homePage.includes('setError(formatError(markError, "Failed to mark message read"))'));

  assert.ok(homePage.includes("const activeMailDrafts = useMemo"));
  assert.ok(homePage.includes("const activeMailDraftScopeAuthorized"));
  assert.ok(homePage.includes("draft.userID === currentUserID"));
  assert.ok(homePage.includes("homeMailDraftMatchesScope("));
  assert.ok(homePage.includes("activeSharedInboxFolderID,"));
  assert.ok(homePage.includes("activeMailAccountEmail,"));
  assert.ok(homePage.includes("draftCount={activeMailDrafts.length}"));
  assert.ok(drafts.includes("draft.pendingRemoteSync === true"));
  assert.ok(drafts.includes("draft.accountEmail.trim().toLowerCase()"));
});

test("node list context menus unlink attachments and remove attached emails", () => {
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const attachmentAPI = source("frontend/src/modules/attachments/attachmentApi.ts");

  assert.match(nodeParts, /aria-label="Attached email actions"/);
  assert.match(nodeParts, /aria-label="Attachment actions"/);
  assert.ok((nodeParts.match(/Remove from node/g) ?? []).length >= 3);
  assert.match(nodeSurface, /unlinkMangoResourceAttachment/);
  assert.match(attachmentAPI, /method: "DELETE"/);
});

test("permissions, node chat links, drafts, and shared image selection use explicit shared contracts", () => {
  const permissions = source("frontend/src/modules/permissions/EntityPermissionsDialog.tsx");
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const nodeChatLinks = source("frontend/src/modules/editor/nodeChatLinks.ts");
  const editorImages = source("frontend/src/modules/editor/editorImages.ts");
  const drafts = source("frontend/src/pages/home/homeMailDrafts.ts");

  assert.doesNotMatch(permissions, /!dialogMode && <button[^>]+permissionPrimaryButtonStyle/);
  assert.match(permissions, /permissionPrimaryButtonStyle[^\n]+Saving[^\n]+Save/);
  assert.match(nodeChatLinks, /export function splitChatTextLinks/);
  assert.match(nodeParts, /rel="noopener noreferrer"/);
  assert.match(nodeParts, /textDecoration: "underline"/);
  assert.match(editorImages, /range\.setStartBefore\(frame\)/);
  assert.match(drafts, /return replyMessageID \? `reply:/);
  assert.match(drafts, /supersededHomeMailDraftIDs/);
});

test("My and Shared Triage share compact search, unread, and accessible list-order controls", () => {
  const homePage = source("frontend/src/pages/home/HomePage.tsx");
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homeStyles = source("frontend/src/pages/home/homeStyles.ts");
  const controlStart = homeWorkspace.indexOf("<form style={searchRowStyle}");
  const controlEnd = homeWorkspace.indexOf("{!isArchivableListView && (", controlStart);
  assert.ok(controlStart >= 0 && controlEnd > controlStart);
  const controls = homeWorkspace.slice(controlStart, controlEnd);

  assert.match(controls, /mailSearchControlsStyle[\s\S]*aria-label="Search mail"[\s\S]*type="submit"/);
  assert.match(controls, /mailControlStatusStyle[\s\S]*unreadMessageCount[\s\S]*Unread only[\s\S]*mailOrderButtonStyle/);
  assert.match(controls, /aria-pressed=\{messageListOrder === "oldest"\}/);
  assert.ok(controls.includes("aria-label={\`Email order:"));
  assert.ok(controls.includes("title={\`Currently"));
  assert.match(controls, /data-mail-list-order=\{messageListOrder\}/);
  assert.match(controls, /MailOrderIcon order=\{messageListOrder\}/);
  assert.match(homeStyles, /mailSearchControlsStyle[\s\S]*maxWidth: 250/);
  assert.match(homeStyles, /searchRowStyle[\s\S]*flexWrap: "wrap"/);
  assert.match(homeStyles, /mailControlStatusStyle[\s\S]*justifyContent: "flex-end"[\s\S]*flexWrap: "wrap"/);

  assert.match(homePage, /useState<EmailConversationOrder>\("newest"\)/);
  assert.match(homePage, /return orderEmailConversationMessages\(listMessages, messageListOrder\)/);
  assert.match(homePage, /messageListOrder=\{messageListOrder\}/);
  assert.match(homePage, /onToggleMessageListOrder=\{\(\) => setMessageListOrder/);
  const filterKeyStart = homePage.indexOf("const activeMessageListKey = messageListFilterKey(");
  const visibleListStart = homePage.indexOf("const visibleMessages = useMemo", filterKeyStart);
  assert.ok(filterKeyStart >= 0 && visibleListStart > filterKeyStart);
  assert.doesNotMatch(homePage.slice(filterKeyStart, visibleListStart), /messageListOrder/);
  assert.equal((homePage.match(/<HomeMailWorkspace/g) ?? []).length, 1);
  assert.match(homePage, /activeViewID=\{activeViewID\}/);
});

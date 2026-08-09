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
  const universalPickerEmailPane = source("frontend/src/modules/editor/UniversalPickerEmailPane.tsx");
  const calendarInviteCard = source("frontend/src/modules/communications/CalendarInviteCard.tsx");

  assert.match(nodeParts, /Expand all threads/);
  assert.match(nodeParts, /Collapse all threads/);
  assert.match(nodeParts, /NodeEmailConversationTimeline/);
  assert.match(nodeParts, /gridTemplateColumns: "20px minmax\(0, 1fr\)"/);
  assert.match(nodeParts, /linear-gradient\(180deg, rgba\(14,165,233,0\.34\), rgba\(124,58,237,0\.3\)\)/);
  assert.match(nodeParts, /width: 13,[\s\S]{0,120}border: "3px solid rgba\(248, 250, 252, 0\.96\)"/);
  assert.match(nodeParts, /onMessageActivate\?\.\(threadMessageID\)/);
  assert.match(nodeParts, /focusMessageRequestID/);
  assert.match(nodeParts, /aria-expanded=\{!collapsed\}/);
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
  assert.match(nodeParts, /data-email-timeline-item=\{singleMessageOnly \? undefined : "true"\}/);
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
  assert.match(nodeParts, /<CalendarInviteCard/);
  assert.match(nodeParts, /sharedInboxID=\{email\.sharedInboxID\}/);
  assert.match(nodeParts, /accountEmail=\{email\.accountEmail\}/);
  assert.match(calendarInviteCard, /respondToCalendarInvite\(\{ messageID, status, companyID, sharedInboxID, accountEmail \}\)/);
  assert.match(nodeParts, /downloadEmailAttachment\(message\.id, providerAttachmentID, companyID, sharedInboxID, \{ accountEmail, collaborationID \}\)/);
  assert.match(nodeParts, /getEmailMessage\(email\.messageID, companyID, mailboxScope\.sharedInboxID, \{ accountEmail: mailboxScope\.accountEmail \}\)/);
  assert.match(nodeParts, /getEmailThread\(threadID, companyID, mailboxScope\.sharedInboxID, mailboxScope\.accountEmail\)/);
  assert.match(nodeParts, /listEmailMessages\(\{ companyID, \.\.\.mailboxScope, mailbox: "all"/);
  assert.match(nodeParts, /account_email: mailboxScope\.accountEmail/);
  assert.match(universalPickerEmailPane, /status\.connected && status\.status === "connected"/);
  assert.match(universalPickerEmailPane, /if \(!active \|\| !accountResolved \|\| !accountEmail\) return undefined/);
  assert.equal((universalPickerEmailPane.match(/listEmailMessages\(\{/g) ?? []).length, 1);
  assert.match(universalPickerEmailPane, /requestJSON<MessagePage>\(storedPath, \{ signal: controller\.signal \}\)/);
  assert.match(universalPickerEmailPane, /requestJSON<MessagePage>\(providerPath, \{ signal: controller\.signal \}\)/);
  assert.match(universalPickerEmailPane, /controller\.abort\(\)/);
  assert.match(universalPickerEmailPane, /const page = await listEmailMessages\(\{/);
  assert.match(calendarInviteCard, /Calendar invitation/);
  assert.match(nodeParts, /window\.setTimeout\(\(\) => replyEditorControllerRef\.current\?\.focus\(\), 0\)/);
});

test("node email and linked text boxes expose animated two-way navigation and collision-free colors", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const emailBodyHighlights = source("frontend/src/modules/editor/emailBodyHighlights.ts");
  const triageChat = source("frontend/src/pages/home/EmailCollaborationChatSurface.tsx");
  const indexCSS = source("frontend/src/index.css");

  assert.match(nodeSurface, /const revealEmailTextBlock = useCallback/);
  assert.match(nodeSurface, /const revealNodeEmailMessage = useCallback/);
  assert.match(nodeSurface, /revealNodeEmailMessage\(linkedEmailMessageID\)/);
  assert.match(nodeSurface, /const linkedEmailMessageID = block.emailMessageID/);
  assert.match(nodeSurface, /const existingBlock = blocks\.find\(\(block\) => block\.emailMessageID\?\.trim\(\) === cleanMessageID\)/);
  assert.match(nodeSurface, /if \(existingBlock\) \{[\s\S]{0,520}return existingBlock\.id/);
  assert.match(nodeSurface, /messageID=\{linkedEmailMessageID\}/);
  assert.match(nodeSurface, /emails=\{nodeAttachedEmails\}/);
  assert.doesNotMatch(nodeSurface, /Show linked email in email column/);
  assert.match(nodeSurface, /data-node-text-box-row/);
  assert.match(nodeSurface, /scrollIntoView\(\{ behavior: "smooth", block: "center", inline: "nearest" \}\)/);
  assert.match(nodeSurface, /onEmailMessageActivate=\{revealEmailTextBlock\}/);
  assert.match(nodeSurface, /editorEmailMessageAccent\(messageID, usedAccents\)/);
  assert.match(nodeSurface, /aria-label=\{linkedEmailExpanded \? "Hide linked email" : "Show linked email"\}/);
  assert.match(nodeSurface, /data-node-email-column="true"/);
  assert.match(nodeSurface, /data-node-email-workspace-mode=\{nodeEmailWorkspaceMode\}/);
  assert.match(nodeSurface, /Math\.max\([\s\S]*TEXT_BLOCK_ROW_HEIGHT,[\s\S]*Math\.floor\(height - TEXT_BLOCK_HEADER_CHROME_HEIGHT - NODE_EMAIL_COLUMN_BOTTOM_GUTTER_PX\)/);
  assert.doesNotMatch(nodeSurface, /min\(720px, calc\(100vh - 170px\)\)/);
  assert.match(nodeSurface, /const nodeEmailWorkspaceGridTemplateColumns = nodeEmailColumnVisible/);
  assert.match(nodeSurface, /"minmax\(0, 1fr\) 0px 0px"[\s\S]*"0px 0px minmax\(0, 1fr\)"/);
  assert.match(nodeSurface, /data-node-email-column-state=\{nodeEmailColumnVisible \? "open" : "closed"\}/);
  assert.match(nodeSurface, /opacity: nodeEmailColumnVisible \? 1 : 0[\s\S]*translateX\(-10px\)/);
  assert.match(nodeSurface, /pointerEvents: nodeEmailColumnVisible \? "auto" : "none"/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"/);
  assert.match(nodeSurface, /data-node-visible-panes=\{visiblePaneMode\}/);
  assert.match(nodeSurface, /editorPaneIsVisible && chatPaneIsVisible[\s\S]{0,32}\? "editor-chat"/);
  assert.match(nodeSurface, /chatPaneIsVisible[\s\S]{0,32}\? "chat-only"[\s\S]{0,32}: "none"/);
  assert.match(nodeSurface, /const TEXT_CHAT_PANE_DEFAULT_WIDTH_PX = 340/);
  assert.match(nodeSurface, /"chat",\s*TEXT_CHAT_PANE_DEFAULT_WIDTH_PX,/);
  assert.doesNotMatch(nodeSurface, /Math\.round\(nodeTextCommunicationContentWidth \/ 2\)/);
  assert.match(nodeSurface, /data-node-email-focus-mode=\{nodeEmailFocusActive \? "expanded" : "normal"\}/);
  assert.match(nodeSurface, /grid-template-columns 180ms/);
  assert.match(nodeSurface, /data-node-email-column="true"[\s\S]{0,180}className="mango-pane-layout-transition"/);
  assert.match(nodeSurface, /data-node-text-box-columns="editor-chat"[\s\S]{0,420}transition: "grid-template-columns 180ms/);
  assert.match(nodeSurface, /const contentPaneIsVisible = editorPaneIsVisible \|\| linkedEmailExpanded/);
  assert.match(nodeSurface, /data-node-linked-email-layout=\{linkedEmailExpanded \? "content-column" : "closed"\}/);
  assert.match(nodeSurface, /data-node-text-box-content-column="true"/);
  assert.match(nodeSurface, /data-node-linked-email-content="true"/);
  assert.match(nodeSurface, /const chatPaneHeight = TEXT_BLOCK_MIN_HEIGHT/);
  assert.match(nodeSurface, /fixedHeight=\{chatPaneHeight\}/);
  assert.doesNotMatch(nodeSurface, /fixedHeight=\{communicationPaneHeight\}/);
  assert.match(nodeParts, /height: replyComposerOpen \? "clamp\(420px, calc\(100vh - 300px\), 760px\)" : "auto"/);
  assert.match(nodeParts, /minHeight: replyComposerOpen \? undefined : 0/);
  assert.match(nodeParts, /fillHeight\?: boolean/);
  assert.match(indexCSS, /@keyframes mango-pane-enter/);
  assert.match(indexCSS, /prefers-reduced-motion: reduce/);
  assert.match(nodeSurface, /data-node-email-timeline-rail=\{nodeEmailFocusActive \? "true" : undefined\}/);
  assert.match(nodeSurface, /onRequestEmailFocusToggle=/);
  assert.match(nodeParts, /"Expand email column"/);
  assert.match(nodeParts, /"Restore email layout"/);
  assert.doesNotMatch(nodeParts, /Collapse email column/);
  assert.doesNotMatch(nodeParts, /onRequestCollapse/);
  assert.match(nodeSurface, /const chatBlockID = block\.id/);
  assert.match(nodeSurface, /suppressAutomaticCreation: nodeAttachedEmails\.length > 0/);
  assert.doesNotMatch(nodeSurface, /aria-label="Toggle email column"/);
  assert.match(nodeSurface, /defaultOpenTextBlockChatIDs/);
  assert.match(nodeSurface, /if \(!emailOriginNode\) return chatMessagesByBlock;[\s\S]*displayed\.set\(emailOriginChatHostBlockID, \[\.\.\.legacyMessages, \.\.\.directMessages\]/);
  assert.match(nodeSurface, /<LinkedEmailPreviewPane/);
  assert.match(nodeSurface, /data-node-pane-header="editor"/);
  assert.match(nodeSurface, /data-node-pane-header="chat"/);
  assert.match(nodeSurface, /<ChatPane[\s\S]{0,420}hideHeader/);
  assert.match(nodeParts, /data-node-linked-email-preview="true"/);
  assert.match(nodeParts, /resolveLinkedEmailPreview/);
  assert.match(nodeParts, /loadAttachedEmailThreadPreview/);
  assert.match(nodeParts, /setThreadDownloadStatus\(preview\.downloadStatus\)/);
  assert.match(nodeParts, /threadDownloadStatus !== "downloading"/);
  assert.match(nodeParts, /data-email-thread-download-status={threadDownloadStatus}/);
  assert.match(nodeParts, /Downloading the rest of this email thread/);
  assert.match(nodeParts, /storedThreadDownloadStatus !== "downloading"/);
  assert.match(nodeParts, /subscribeRealtimeScope\(apiBase, companyID, scope/);
  assert.match(nodeParts, /refreshStoredThreadRef\.current\(\)/);
  assert.doesNotMatch(nodeParts, /setStoredThreadPollVersion|storedThreadPollTimer|setInterval/);
  assert.match(nodeParts, /initialFocusMessageID=\{resolvedPreview.focusMessageID\}/);
  assert.match(nodeParts, /singleMessageOnly/);
  assert.match(nodeParts, /data-email-single-message=\{singleMessageOnly \? "true" : undefined\}/);
  assert.match(nodeParts, /data-linked-email-message-metadata="true"/);
  assert.match(nodeParts, /setThreadMessages\(singleMessageOnly \? \[payload\]/);
  assert.match(nodeParts, /applyEmailBodyHighlights\(frameDocument, highlights, activeSelection\)/);
  assert.match(emailBodyHighlights, /data-mango-email-body-highlight/);
  assert.match(emailBodyHighlights, /unwrapExistingHighlights/);
  assert.match(emailBodyHighlights, /text\.indexOf\(quote\)/);
  assert.match(nodeParts, /data-node-email-thread-list="true"/);
  assert.doesNotMatch(nodeParts, />Attached emails</);
  assert.match(triageChat, /listEditorTextBlockProjections\(targetProjections\)/);
  assert.match(triageChat, /existingMessageAccent \|\| editorEmailMessageAccent\(emailMessageID, existingEmailAccents\)/);
});

test("node drag and Universal-picker email attachment retain exact provider mailbox identity", () => {
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const editorProjection = source("frontend/src/modules/editor/editorProjection.ts");

  assert.match(nodeSurface, /const attachEmail = useCallback/);
  assert.match(nodeSurface, /sharedInboxID: email\.sharedInboxID/);
  assert.match(nodeSurface, /accountEmail: email\.accountEmail/);
  assert.match(nodeSurface, /information: buildEditorAttachedEmailPayload\(email\)/);
  assert.match(nodeSurface, /parseDraggedEmail\(event\.dataTransfer\)/);
  assert.match(nodeSurface, /messageAttachmentPayload\(entity\.emailMessage, entity\.emailSharedInboxID, entity\.emailAccountEmail\)/);
  assert.match(nodeSurface, /initialCategory="email_message"/);
  assert.match(editorProjection, /shared_inbox_id: input\.sharedInboxID\?\.trim\(\) \?\? ""/);
  assert.match(editorProjection, /account_email: input\.accountEmail\?\.trim\(\) \?\? ""/);
  assert.doesNotMatch(editorProjection, /attachments: input\.attachments/);
});

test("triage thread controls and reply resize pointer lifecycle are explicit", () => {
  const calendarInviteCard = source("frontend/src/modules/communications/CalendarInviteCard.tsx");
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");
  const homePage = source("frontend/src/pages/home/HomePage.tsx");

  assert.match(homeParts, /Expand all threads/);
  assert.match(homeParts, /handle\.setPointerCapture\(pointerID\)/);
  assert.match(homeParts, /lostpointercapture/);
  assert.match(homeParts, /window\.addEventListener\("blur", finishResize/);
  assert.match(homeParts, /image\.addEventListener\("dblclick", previewSelectedImage\)/);
  assert.match(homeParts, /Download image/);
  assert.match(homeParts, /<CalendarInviteCard/);
  assert.match(calendarInviteCard, /getCalendarInviteEvent/);
  assert.match(homeParts, /compose\.focusRequestID/);
  assert.match(calendarInviteCard, /Accept/);
  assert.match(calendarInviteCard, /Tentative/);
  assert.match(calendarInviteCard, /Decline/);
  assert.match(homePage, /requiredReplyAllRecipients/);
  assert.match(homePage, /mergeEmailAddressDrafts\(\[existingDraft\.cc, requiredReplyAllRecipients\.cc\], \[to\]\)/);
});
test("mail workspace preserves the fixed three-button lower row and new-message compose fills the available detail height", () => {
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");

  assert.match(homeWorkspace, /const triageAdvanceEnabled = isArchivableListView && mailbox === "primary"/);
  assert.match(homeWorkspace, /<div style=\{mailComposeSentTriageActionsStyle\}>/);
  assert.match(homeWorkspace, /className="mango-elevated-action mango-mail-vibrant-action mango-mail-vibrant-advance"/);
  assert.match(homeWorkspace, /disabled=\{!triageAdvanceEnabled \|\| advanceDisabled\}/);

  assert.match(homeParts, /height: "100%"/);
  assert.match(homeParts, /gridTemplateRows: replyMode \? "auto minmax\(0, 1fr\) auto" : "auto minmax\(0, 1fr\)"/);
  assert.match(homeParts, /const composeNewMessageDockStyle/);
  assert.match(homeParts, /minmax\(180px, 1fr\)/);
  assert.match(homeParts, /isReplyMode \? composeReplyDockStyle : composeNewMessageDockStyle/);
  assert.doesNotMatch(homeParts, /height: "min\(280px, 34vh\)"/);
  assert.match(homeParts, /emailAttachmentHasResolvableContent\(attachment\)/);
});

test("mail list actions keep fixed positions, light inactive surfaces, clear selected states, and visible All-menu hover", () => {
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homePage = source("frontend/src/pages/home/HomePage.tsx");
  const homeStyles = source("frontend/src/pages/home/homeStyles.ts");
  const indexCSS = source("frontend/src/index.css");
  const topStart = homeWorkspace.indexOf("<div style={mailArchiveActionsStyle}>");
  const lowerStart = homeWorkspace.indexOf("<div style={mailComposeSentTriageActionsStyle}>");
  const lowerEnd = homeWorkspace.indexOf("{!isArchivableListView && (", lowerStart);
  const topActions = homeWorkspace.slice(topStart, lowerStart);
  const lowerActions = homeWorkspace.slice(lowerStart, lowerEnd);
  const starredAction = topActions.indexOf('title="Starred"');

  assert.ok(topStart >= 0 && lowerStart > topStart && lowerEnd > lowerStart);
  assert.ok(topActions.indexOf('label="Inbox"') < starredAction);
  assert.ok(starredAction < topActions.indexOf('mailbox === "sent"'));
  assert.ok(topActions.indexOf('mailbox === "sent"') < topActions.indexOf("allDropdownActive"));
  assert.match(topActions, /onOpenSentMailbox/);
  assert.match(topActions, /label="Inbox" count=\{mailboxCounts\.primary\} countIsMinimum=\{inboxCountIsMinimum\}/);
  assert.match(homeWorkspace, /return isMinimum \? `\$\{formattedCount\}\+` : formattedCount/);
  assert.match(homePage, /const inboxCountFallback = currentLoadedInboxFallback \?\? storedInboxCountFallback/);
  assert.match(topActions, /<span style=\{mailArchiveActionLabelStyle\}>Starred<\/span>/);
  assert.doesNotMatch(topActions, /count=\{mailboxCounts\.starred\}/);
  assert.doesNotMatch(topActions, /onOpenDraftsMailbox/);
  assert.match(lowerActions, /mango-mail-vibrant-compose/);
  assert.match(lowerActions, /aria-pressed=\{compose\.open\}/);
  assert.match(lowerActions, /mango-mail-vibrant-drafts/);
  assert.match(lowerActions, /aria-pressed=\{!compose\.open && mailbox === "drafts"\}/);
  assert.match(lowerActions, /onOpenDraftsMailbox/);
  assert.doesNotMatch(lowerActions, /onOpenSentMailbox/);
  assert.match(lowerActions, /mango-mail-vibrant-advance/);
  assert.match(lowerActions, /Archive & next →/);
  assert.match(lowerActions, /disabled=\{!triageAdvanceEnabled \|\| advanceDisabled\}/);
  assert.doesNotMatch(homeWorkspace, /triageAdvanceVisible/);
  assert.match(homeStyles, /mailComposeSentTriageActionsStyle[\s\S]{0,180}gridTemplateColumns: "repeat\(3, minmax\(0, 1fr\)\)"/);
  assert.match(homeWorkspace, /className="mango-mailbox-dropdown-item"/);
  assert.match(indexCSS, /\.mango-mailbox-dropdown-item:hover/);
  assert.match(indexCSS, /mango-mail-vibrant-compose \{[\s\S]{0,260}rgba\(219, 234, 254/);
  assert.match(indexCSS, /mango-mail-vibrant-drafts \{[\s\S]{0,260}rgba\(237, 233, 254/);
  assert.match(indexCSS, /mango-mail-vibrant-advance \{[\s\S]{0,260}rgba\(207, 250, 254/);
  assert.match(indexCSS, /mango-mail-vibrant-compose\[aria-pressed="true"\][\s\S]{0,320}#2563eb[\s\S]{0,120}#7c3aed/);
  assert.match(indexCSS, /mango-mail-vibrant-drafts\[aria-pressed="true"\][\s\S]{0,320}#7c3aed[\s\S]{0,120}#ec4899/);
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

test("mailbox realtime and non-primary tabs keep bounded request budgets", () => {
  const homePage = source("frontend/src/pages/home/HomePage.tsx");
  const realtime = source("frontend/src/pages/home/homeMailboxRealtime.ts");

  assert.doesNotMatch(homePage, /EVENT_NOTIFICATIONS_UPDATED/);
  assert.doesNotMatch(homePage, /SELF_SEND_DELIVERY_REFRESH_DELAY_MS/);
  assert.doesNotMatch(homePage, /plan\.messageList/);
  assert.doesNotMatch(homePage, /messageListContentScrollHeight\(list\) <= list\.clientHeight \+ 120/);
  assert.match(homePage, /isLocalMutationEcho: \(signal\) => consumeHomeMailboxLocalMutationEcho/);
  assert.match(realtime, /accepted\(\) \{[\s\S]{0,100}options\.invalidate\(\);[\s\S]{0,100}\}/);
});

test("personal and shared mail rows expose unread, selected, thread, and keyboard semantics", () => {
  const homeWorkspace = source("frontend/src/pages/home/HomeMailWorkspace.tsx");
  const homeParts = source("frontend/src/pages/home/HomeParts.tsx");
  const homeStyles = source("frontend/src/pages/home/homeStyles.ts");

  assert.match(homeWorkspace, /aria-pressed=\{active\}/);
  assert.match(homeWorkspace, /aria-label=\{emailMessageRowAriaLabel\(message, rowAddressLabel\)\}/);
  assert.match(homeWorkspace, /if \(!isMailRowActivationKey\(event\.key\)\) return;[\s\S]{0,140}onSelectMessage\(message, event\)/);
  assert.match(homeWorkspace, /<MessageLeadingIndicators message=\{message\} active=\{active\} \/>/);
  assert.match(homeParts, /emailMessageHasMultipleThreadMessages\(message\)/);
  assert.match(homeParts, /role="img" aria-label=\{label\} title=\{label\}/);
  assert.match(homeParts, /messageUnreadDotStyle\(message\.unread\)/);
  assert.doesNotMatch(homeParts, /MessagePlacementIcon/);
  assert.match(homeStyles, /messageThreadIconStyle[\s\S]{0,220}color: "#0284c7"/);
  assert.match(homeWorkspace, /messageThreadCountStyle/);
  assert.doesNotMatch(homeWorkspace, /MessageAttachmentCount/);
  assert.match(homeWorkspace, /kind="node"[\s\S]{0,180}placement="mailbox-card"/);
  assert.match(homeWorkspace, /kind="logic_gate"[\s\S]{0,180}placement="mailbox-card"/);
  assert.match(homeParts, /data-email-node-actions="true"[\s\S]{0,900}placement="thread-header"[\s\S]{0,900}\{emailNodeDestinationSearch\}/);
  assert.doesNotMatch(homeParts, /data-email-node-indicator="message-header"/);
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

test("node list context menus permanently delete files and only unlink attached emails", () => {
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");
  const nodeSurface = source("frontend/src/modules/editor/NodeWorkspaceSurface.tsx");
  const attachmentAPI = source("frontend/src/modules/attachments/attachmentApi.ts");

  assert.match(nodeParts, /aria-label="Attached email actions"/);
  assert.match(nodeParts, /aria-label="Attachment actions"/);
  assert.ok((nodeParts.match(/Remove from node/g) ?? []).length >= 2);
  assert.match(nodeParts, /Delete permanently/);
  assert.match(nodeSurface, /deleteMangoAttachmentPermanently/);
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
  assert.match(drafts, /return replyMessageID \? `\$\{draft\.kind\}:/);
  assert.match(drafts, /supersededHomeMailDraftIDs/);
});

test("My and Shared Triage share compact controls and full-tab list ordering", () => {
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
  assert.match(homePage.slice(filterKeyStart, visibleListStart), /messageListOrder/);
  assert.match(homePage, /order: messageListOrder === "oldest" \? "oldest" : undefined/);
  assert.equal((homePage.match(/<HomeMailWorkspace/g) ?? []).length, 1);
  assert.match(homePage, /activeViewID=\{activeViewID\}/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("node-attached email viewer retains triage thread, recipient, attachment, and image behavior", () => {
  const nodeParts = source("frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx");

  assert.match(nodeParts, /Expand all threads/);
  assert.match(nodeParts, /replyAllAddressDrafts/);
  assert.match(nodeParts, /Reply all/);
  assert.match(nodeParts, /setCcDraft/);
  assert.match(nodeParts, /setBccDraft/);
  assert.match(nodeParts, /cc \{formatAddressList\(threadMessage\.cc\)\}/);
  assert.match(nodeParts, /bcc \{formatAddressList\(threadMessage\.bcc\)\}/);
  assert.match(nodeParts, /<EmailBodyFrame/);
  assert.match(nodeParts, /onSelectionChange=\{canUseEmailSelection/);
  assert.match(nodeParts, /rewriteEmailCIDImages/);
  assert.match(nodeParts, /Download image/);
  assert.match(nodeParts, /setPreviewImage/);
  assert.match(nodeParts, /<EmailMessageAttachments/);
  assert.match(nodeParts, /respondToCalendarInvite/);
  assert.match(nodeParts, /sharedInboxID=\{email\.sharedInboxID\}/);
  assert.match(nodeParts, /accountEmail=\{email\.accountEmail\}/);
  assert.match(nodeParts, /respondToCalendarInvite\(\{ messageID: message\.id, status, companyID, sharedInboxID \}\)/);
  assert.match(nodeParts, /Calendar invitation/);
  assert.match(nodeParts, /window\.setTimeout\(\(\) => replyEditorControllerRef\.current\?\.focus\(\), 0\)/);
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

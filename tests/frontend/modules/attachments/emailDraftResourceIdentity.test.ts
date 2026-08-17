import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mangoEmailDraftResourceID } from "../../../../frontend/src/modules/attachments/attachmentApi.js";

test("draft attachments use the exact stable V3 draft ID", () => {
  assert.equal(mangoEmailDraftResourceID({ draftID: " draft/shared:1 " }), "draft/shared:1");
});

test("draft attachment identity rejects a missing stable draft ID", () => {
  assert.equal(mangoEmailDraftResourceID({ draftID: "   " }), "");
});

test("draft file and inline-image uploads use the same stable draft resource", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  const start = homeParts.indexOf("const composeAttachmentResourceID");
  const end = homeParts.indexOf("const composeEditorImageAttachmentContext", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const identity = homeParts.slice(start, end);

  assert.match(identity, /draftID: compose\.draftID/);
  assert.doesNotMatch(identity, /collaborationID|sharedInboxID|accountEmail|userID/);
  assert.match(homeParts, /resourceType: "email_draft"[\s\S]*resourceID: composeAttachmentResourceID/);

});

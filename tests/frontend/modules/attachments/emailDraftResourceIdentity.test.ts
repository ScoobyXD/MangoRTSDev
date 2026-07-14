import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mangoEmailDraftResourceID } from "../../../../frontend/src/modules/attachments/attachmentApi.js";

test("shared draft attachment identity is collaboration-first and URL-safe", () => {
  assert.equal(
    mangoEmailDraftResourceID({
      draftID: " draft/shared:1 ",
      collaborationID: " collaboration/shared:1 ",
      sharedInboxID: "ignored-shared-inbox",
      userID: "ignored-user",
      accountEmail: "ignored@example.test",
    }),
    "collaboration:collaboration%2Fshared%3A1:draft%2Fshared%3A1",
  );
});

test("collaboration attachment identity rejects an incomplete draft key", () => {
  assert.equal(mangoEmailDraftResourceID({
    draftID: "   ",
    collaborationID: "collaboration-1",
  }), "");
});

test("shared-draft file and inline-image uploads use the same collaboration resource", () => {
  const homeParts = readFileSync(resolve(process.cwd(), "frontend/src/pages/home/HomeParts.tsx"), "utf8");

  assert.match(homeParts, /const cleanCollaborationID = compose\.sharedDraft \? compose\.collaborationID\.trim\(\) : ""/);
  assert.match(homeParts, /collaborationID: cleanCollaborationID/);
  assert.match(homeParts, /compose\.sharedDraft\s*\? "email-collaboration-shared-draft"/);
});

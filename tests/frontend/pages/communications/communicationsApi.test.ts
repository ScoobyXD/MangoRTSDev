import test from "node:test";
import assert from "node:assert/strict";
import { buildSmartFilterSearchQuery, createMessageQuery, parseEmailAddressList, smartFilterUnread } from "../../../../frontend/src/pages/communications/communicationsApi.js";

test("communications message query omits empty values and encodes filters", () => {
  assert.equal(
    createMessageQuery({ limit: 25, folderID: "inbox", q: " invoice #42 ", unread: true, pageToken: "next/token" }),
    "?limit=25&page_token=next%2Ftoken&folder_id=inbox&q=invoice+%2342&unread=true",
  );
  assert.equal(createMessageQuery({ q: "   " }), "");
});

test("email address parser supports comma and semicolon lists with display names", () => {
  assert.deepEqual(parseEmailAddressList('Jane Doe <Jane@Example.com>, bad-value; ops@example.com; jane@example.com'), [
    { name: "Jane Doe", email: "jane@example.com" },
    { email: "ops@example.com" },
  ]);
});

test("smart filters compose Gmail-style search without forcing all mail", () => {
  assert.equal(
    buildSmartFilterSearchQuery("important", " invoice "),
    "is:important -category:promotions -category:social -in:spam -in:trash invoice",
  );
  assert.equal(buildSmartFilterSearchQuery("all", "from:ops@example.com"), "from:ops@example.com");
  assert.equal(smartFilterUnread("unread"), true);
  assert.equal(smartFilterUnread("important"), undefined);
});

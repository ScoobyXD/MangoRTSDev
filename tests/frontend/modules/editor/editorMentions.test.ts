import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMentionOptions,
  readActiveMentionDraft,
  splitTextByMentions,
  type MentionableCompanyUser,
} from "../../../../frontend/src/modules/editor/editorMentions.js";

const users: MentionableCompanyUser[] = [
  { user_id: "user-jane", display_name: "Jane Doe", email: "jane@example.com" },
  { user_id: "user-lee", display_name: "Lee Quinn", email: "lee@example.com" },
];

test("active mention draft keeps the @ start and query before the caret", () => {
  assert.deepEqual(readActiveMentionDraft("Please check @Jane", 18), {
    start: 13,
    end: 18,
    query: "Jane",
  });
});

test("active mention draft closes after a trailing separator space", () => {
  assert.equal(readActiveMentionDraft("Please check @Jane Doe ", "Please check @Jane Doe ".length), null);
});

test("active mention draft can resume after the next typed name character", () => {
  assert.deepEqual(readActiveMentionDraft("Please check @Jane D", "Please check @Jane D".length), {
    start: 13,
    end: 20,
    query: "Jane D",
  });
});

test("mention options match compact names and email aliases", () => {
  assert.equal(buildMentionOptions(users, "janed")[0]?.user_id, "user-jane");
  assert.equal(buildMentionOptions(users, "lee@")[0]?.user_id, "user-lee");
});

test("mention text splitting highlights the full @name token", () => {
  assert.deepEqual(splitTextByMentions("Hi @Jane Doe and @lee", users).map((segment) => ({
    text: segment.text,
    mention: segment.mention,
    userID: segment.user?.user_id ?? "",
  })), [
    { text: "Hi ", mention: false, userID: "" },
    { text: "@Jane Doe", mention: true, userID: "user-jane" },
    { text: " and ", mention: false, userID: "" },
    { text: "@lee", mention: true, userID: "user-lee" },
  ]);
});

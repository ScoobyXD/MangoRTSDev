import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMentionOptions,
  mentionUserProfileColor,
  readActiveMentionDraft,
  splitTextByMentions,
  type MentionableCompanyUser,
} from "../../../../frontend/src/modules/editor/editorMentions.js";

const users: MentionableCompanyUser[] = [
  { user_id: "user-jane", display_name: "Jane Doe", email: "jane@example.com" },
  { user_id: "user-lee", display_name: "Lee Quinn", email: "lee@example.com" },
];

function relativeLuminance(hexColor: string): number {
  assert.match(hexColor, /^#[0-9A-F]{6}$/i);
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hexColor.slice(offset, offset + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

test("active mention draft keeps the @ start and query before the caret", () => {
  assert.deepEqual(readActiveMentionDraft("Please check @Jane", 18), {
    start: 13,
    end: 18,
    query: "Jane",
    trigger: "@",
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
    trigger: "@",
  });
});

test("active urgent mention draft uses the ! trigger", () => {
  assert.deepEqual(readActiveMentionDraft("Please check !Jane", "Please check !Jane".length), {
    start: 13,
    end: 18,
    query: "Jane",
    trigger: "!",
  });
});

test("mention options match compact names and email aliases", () => {
  assert.equal(buildMentionOptions(users, "janed")[0]?.user_id, "user-jane");
  assert.equal(buildMentionOptions(users, "lee@")[0]?.user_id, "user-lee");
});

test("mention profile colors are stable by user ID when profile labels change", () => {
  const expected = { background: "#6D28D9", foreground: "#FFFFFF", border: "#4C1D95" };
  assert.deepEqual(mentionUserProfileColor(users[0]!), expected);
  assert.deepEqual(mentionUserProfileColor({
    user_id: " USER-JANE ",
    display_name: "Renamed Person",
    email: "renamed@example.com",
  }), expected);
  assert.notDeepEqual(mentionUserProfileColor(users[1]!), expected);
});

test("mention profile colors fall back to normalized email and then display name", () => {
  assert.deepEqual(
    mentionUserProfileColor({ user_id: "", email: " JANE@EXAMPLE.COM ", display_name: "Old Name" }),
    mentionUserProfileColor({ user_id: " ", email: "jane@example.com", display_name: "New Name" }),
  );
  assert.deepEqual(
    mentionUserProfileColor({ user_id: "", email: "", display_name: " Jane   Doe " }),
    mentionUserProfileColor({ user_id: " ", display_name: "jane doe" }),
  );
});

test("mention profile palette keeps initials and avatar boundaries high contrast", () => {
  const palette = new Map<string, ReturnType<typeof mentionUserProfileColor>>();
  for (let index = 0; index < 512; index += 1) {
    const color = mentionUserProfileColor({ user_id: `profile-${index}` });
    palette.set(color.background, color);
  }

  assert.equal(palette.size, 12);
  for (const color of palette.values()) {
    assert.ok(contrastRatio(color.foreground, color.background) >= 4.5, `${color.foreground} on ${color.background}`);
    assert.ok(contrastRatio(color.border, "#FFFFFF") >= 4.5, `${color.border} against white`);
  }
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

test("mention text splitting highlights urgent !name tokens", () => {
  assert.deepEqual(splitTextByMentions("Now !Jane Doe and @lee", users).map((segment) => ({
    text: segment.text,
    mention: segment.mention,
    userID: segment.user?.user_id ?? "",
  })), [
    { text: "Now ", mention: false, userID: "" },
    { text: "!Jane Doe", mention: true, userID: "user-jane" },
    { text: " and ", mention: false, userID: "" },
    { text: "@lee", mention: true, userID: "user-lee" },
  ]);
});

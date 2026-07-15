import test from "node:test";
import assert from "node:assert/strict";
import { splitEmailQuotedHistory } from "../../../../frontend/src/modules/communications/emailQuotedContent.js";

test("plain Outlook history is removed after the authored reply and signature", () => {
  const body = [
    "You got it!",
    "",
    "We will keep you posted.",
    "",
    "Best,",
    "Damar",
    "",
    "From: Katherine <katherine@example.com>",
    "Sent: Tuesday, July 14, 2026 10:37 AM",
    "To: Damar <damar@example.com>",
    "Cc: Betty <betty@example.com>",
    "Subject: Temp request",
    "",
    "Hello Damar,",
  ].join("\n");

  const split = splitEmailQuotedHistory(body);

  assert.equal(split.hasQuotedHistory, true);
  assert.equal(split.authoredBody, "You got it!\n\nWe will keep you posted.\n\nBest,\nDamar");
});

test("plain On-wrote and angle-prefixed history is removed", () => {
  const body = "Confirmed for tomorrow.\n\nOn Tue, Jul 14, 2026, Katherine wrote:\n> Can you confirm?\n> Thank you.";
  const split = splitEmailQuotedHistory(body);
  assert.equal(split.hasQuotedHistory, true);
  assert.equal(split.authoredBody, "Confirmed for tomorrow.");
});

test("angle-prefixed Outlook headers identify a trailing quoted run", () => {
  const body = "Confirmed for tomorrow.\n\n> From: Katherine <katherine@example.com>\n> Sent: Tuesday\n> To: Damar\n> Subject: Request\n>\n> Can you confirm?";
  assert.deepEqual(splitEmailQuotedHistory(body), { authoredBody: "Confirmed for tomorrow.", hasQuotedHistory: true });
});

test("quoted-only messages and ordinary authored quotations are preserved conservatively", () => {
  const quotedOnly = "From: Katherine <katherine@example.com>\nSent: Tuesday\nTo: Damar\nSubject: Temp request\n\nOriginal body";
  const authoredProse = "From: the warehouse, walk north.\nTo: reach shipping, turn left.\nThis is authored guidance.";
  const authoredPlainQuote = "I am responding to this exact wording:\n\n> Keep this first authored quotation.\n> Keep this second authored quotation.";

  assert.deepEqual(splitEmailQuotedHistory(quotedOnly), { authoredBody: quotedOnly, hasQuotedHistory: false });
  assert.deepEqual(splitEmailQuotedHistory(authoredProse), { authoredBody: authoredProse, hasQuotedHistory: false });
  assert.deepEqual(splitEmailQuotedHistory(authoredPlainQuote), { authoredBody: authoredPlainQuote, hasQuotedHistory: false });
});

test("common HTML quote containers are removed without changing the original input", () => {
  const gmail = '<div>New answer</div><div class="gmail_quote"><div>On Tuesday...</div><blockquote>Old answer</blockquote></div>';
  const outlook = '<p>New answer</p><div id="divRplyFwdMsg"><b>From:</b> Katherine<br><b>Sent:</b> Tuesday<br><b>To:</b> Damar<br><b>Subject:</b> Request</div><p>Old answer</p>';
  const apple = '<div>New answer</div><blockquote type="cite"><div>Old answer</div></blockquote>';

  for (const [body, removedText] of [[gmail, "Old answer"], [outlook, "Old answer"], [apple, "Old answer"]] as const) {
    const split = splitEmailQuotedHistory(body);
    assert.equal(split.hasQuotedHistory, true);
    assert.match(split.authoredBody, /New answer/);
    assert.doesNotMatch(split.authoredBody, new RegExp(removedText));
    assert.match(body, new RegExp(removedText));
  }
});

test("an ordinary authored blockquote is not removed", () => {
  const body = "<p>Here is the passage I am discussing:</p><blockquote>Keep this authored quotation.</blockquote><p>My analysis follows.</p>";
  assert.deepEqual(splitEmailQuotedHistory(body), { authoredBody: body, hasQuotedHistory: false });
});

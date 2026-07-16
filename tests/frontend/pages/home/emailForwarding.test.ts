import assert from "node:assert/strict";
import test from "node:test";
import type { EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.js";
import { EDITOR_RICH_TEXT_PREFIX } from "../../../../frontend/src/modules/editor/richTextEditing.js";
import {
  buildForwardedComposeBody,
  buildForwardedEmailHTML,
  forwardedAttachmentsForCopy,
  withForwardedAttachmentCopy,
} from "../../../../frontend/src/pages/home/emailForwarding.js";

function forwardedMessage(): EmailMessage {
  return {
    id: "message-forward-source",
    thread_id: "thread-1",
    subject: "Designed announcement",
    date: 1784080800,
    unread: false,
    starred: false,
    from: [{ name: "Design Team", email: "design@example.test" }],
    to: [{ name: "Owner", email: "owner@example.test" }],
    body: `<html><head><style>@import "https://bad.test/style.css"; .hero { color:#123456; font-size:22px; }</style></head><body><div class="hero" onclick="steal()">Designed content</div><a href="javascript:steal()">bad link</a><img src="cid:hero-logo"><img width="1" height="1" src="https://tracker.test/open"><script>steal()</script></body></html>`,
    attachments: [
      { id: "provider-logo", filename: "logo.png", content_type: "image/png", content_id: "hero-logo", is_inline: true, size: 300 },
      { id: "provider-file", filename: "brief.pdf", content_type: "application/pdf", size: 1200 },
      { id: "provider-unused", filename: "unused.png", content_type: "image/png", content_id: "unused-image", is_inline: true, size: 200 },
    ],
  };
}

test("forwarded email HTML preserves layout while removing unsafe and tracking content", () => {
  const source = withForwardedAttachmentCopy(
    forwardedMessage(),
    "provider-logo",
    "11111111-1111-4111-8111-111111111111",
  );
  const html = buildForwardedEmailHTML(source);

  assert.match(html, /data-mango-forwarded-message="true"/);
  assert.match(html, /<style[^>]*>[^<]*\.hero\s*\{/);
  assert.match(html, /class="hero"/);
  assert.match(html, /Designed content/);
  assert.match(html, /mango-attachment:11111111-1111-4111-8111-111111111111/);
  assert.doesNotMatch(html, /@import/i);
  assert.doesNotMatch(html, /onclick=/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /tracker\.test/i);
});

test("forward send body keeps authored content separate from the locked original", () => {
  const body = buildForwardedComposeBody(
    `${EDITOR_RICH_TEXT_PREFIX}<div>Here is the original.</div><div data-mango-email-signature="true">Mango Team</div>`,
    forwardedMessage(),
  );

  assert.match(body, /Here is the original/);
  assert.match(body, /data-mango-email-signature="true"/);
  assert.match(body, /Forwarded message/);
  assert.match(body, /Designed content/);
});

test("forward attachment selection copies files and referenced inline assets only", () => {
  const source = forwardedMessage();
  assert.deepEqual(
    forwardedAttachmentsForCopy(source).map((attachment) => attachment.id),
    ["provider-logo", "provider-file"],
  );

  const copied = withForwardedAttachmentCopy(source, "provider-logo", "11111111-1111-4111-8111-111111111111");
  assert.equal(copied.attachments?.[0]?.id, "provider-logo");
  assert.equal(copied.attachments?.[0]?.attachment_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(source.attachments?.[0]?.attachment_id, undefined);
});

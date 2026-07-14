import test from "node:test";
import assert from "node:assert/strict";
import {
  applyEmailSignatureOnceForSession,
  applyEmailSignature,
  beginEmailSignatureApplicationSession,
  loadedEmailSignatureForScope,
  type ScopedEmailSignatureState,
} from "../../../../frontend/src/modules/editor/emailSignatureBody.js";
import { EDITOR_RICH_TEXT_PREFIX } from "../../../../frontend/src/modules/editor/richTextEditing.js";

test("scoped signature state never exposes a previous mailbox body", () => {
  const accountA: ScopedEmailSignatureState = {
    scopeKey: "company\u0000\u0000a@example.test",
    loaded: true,
    body: "Account A signature",
  };
  assert.equal(loadedEmailSignatureForScope(accountA, accountA.scopeKey), "Account A signature");
  assert.equal(loadedEmailSignatureForScope(accountA, "company\u0000\u0000b@example.test"), null);
  assert.equal(loadedEmailSignatureForScope({ ...accountA, loaded: false }, accountA.scopeKey), null);
});

test("one reply session waits for hydration and never reinserts after deliberate edits or mode switches", () => {
  const scopeKey = "company\u0000shared-inbox\u0000";
  const pending = beginEmailSignatureApplicationSession(null, scopeKey);
  assert.equal(pending.applied, false);

  const hydrated = applyEmailSignatureOnceForSession("Typed before hydration", "Saved signature", pending, scopeKey);
  assert.equal(hydrated.session.applied, true);
  assert.match(hydrated.body, /Typed before hydration/);
  assert.match(hydrated.body, /Saved signature/);

  const deliberatelyEdited = "<!-- mango-editor-html-v1 --><div>Typed before hydration</div><div>Custom closing</div>";
  const replyAllMode = beginEmailSignatureApplicationSession(hydrated.session, scopeKey);
  const unchanged = applyEmailSignatureOnceForSession(deliberatelyEdited, "Saved signature", replyAllMode, scopeKey);
  assert.equal(unchanged.body, deliberatelyEdited);

  const nextReplySession = applyEmailSignatureOnceForSession("New reply", "Saved signature", null, scopeKey);
  assert.notEqual(nextReplySession.body, "New reply");
  assert.match(nextReplySession.body, /Saved signature/);
});

test("signature insertion preserves durable image references for eager compose hydration", () => {
  const signature = `${EDITOR_RICH_TEXT_PREFIX}<div>Best,</div><span data-mango-editor-image="true" data-mango-editor-attachment-id="signature-logo"><img src="mango-attachment:signature-logo" alt="Company logo"></span>`;
  const body = applyEmailSignature("", signature);

  assert.match(body, /data-mango-editor-attachment-id="signature-logo"/);
  assert.match(body, /src="mango-attachment:signature-logo"/);
  assert.doesNotMatch(body, /data:image|javascript:/);
});

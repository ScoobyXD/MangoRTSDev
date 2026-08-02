import assert from "node:assert/strict";
import test from "node:test";

import {
  assertV3NodeTextboxBackfillSafety,
  legacyNodeTextboxHTML,
  mangoAttachmentIDs,
  parseV3NodeTextboxBackfillArguments,
  v3NodeTextboxBody,
} from "./v3-node-textbox-backfill-core.js";
import { convertMangoLegacyHTML } from "./mango-html-to-json-core.js";

const companyID = "11111111-1111-1111-1111-111111111111";

test("V3 Node textbox dry-run arguments cannot authorize writes", () => {
  const args = parseV3NodeTextboxBackfillArguments([
    "--mode", "dry-run", "--company", companyID, "--expected-count", "32",
  ]);
  assert.equal(args.mode, "dry-run");
  assert.equal(args.expectedCount, 32);
  assert.doesNotThrow(() => assertV3NodeTextboxBackfillSafety(args));

  const unsafe = parseV3NodeTextboxBackfillArguments([
    "--mode", "dry-run", "--company", companyID, "--allow-write",
  ]);
  assert.throws(() => assertV3NodeTextboxBackfillSafety(unsafe), /does not accept --allow-write/);
});

test("V3 Node textbox backfill requires exact count, backup, flag, and confirmation", () => {
  const confirmation = `BACKFILL V3 NODE TEXTBOXES ${companyID} 32`;
  const valid = parseV3NodeTextboxBackfillArguments([
    "--mode", "backfill",
    "--company", companyID,
    "--expected-count", "32",
    "--allow-write",
    "--backup-reference", "restore-tested-backup-2026-08-02",
    "--confirm", confirmation,
  ]);
  assert.doesNotThrow(() => assertV3NodeTextboxBackfillSafety(valid));

  for (const argv of [
    ["--mode", "backfill", "--company", companyID, "--expected-count", "32"],
    ["--mode", "backfill", "--company", companyID, "--expected-count", "32", "--allow-write", "--confirm", confirmation],
    ["--mode", "backfill", "--company", companyID, "--expected-count", "32", "--allow-write", "--backup-reference", "backup", "--confirm", "BACKFILL"],
  ]) {
    const args = parseV3NodeTextboxBackfillArguments(argv);
    assert.throws(() => assertV3NodeTextboxBackfillSafety(args));
  }
});

test("V3 Node textbox source must be the exact legacy envelope", () => {
  const html = '<!-- mango-editor-html-v1 --><p>Preserved</p>';
  assert.equal(legacyNodeTextboxHTML(`<!-- mango-node-text-block-v1 -->${JSON.stringify({ title: "retired", document: html })}`), html);
  assert.throws(() => legacyNodeTextboxHTML(html), /not_a_mango_envelope/);
  assert.throws(() => legacyNodeTextboxHTML("<!-- mango-node-text-block-v1 -->{"), /invalid_json/);
  assert.throws(
    () => legacyNodeTextboxHTML(`<!-- mango-node-text-block-v1 -->${JSON.stringify({ title: "only" })}`),
    /has_no_document/,
  );
});

test("V3 Node textbox body drops the retired title and adds empty annotations", () => {
  const converted = convertMangoLegacyHTML("<!-- mango-editor-html-v1 --><p>Body</p>");
  const body = v3NodeTextboxBody(converted.document);
  assert.equal(body.format, "mango-tiptap-json");
  assert.deepEqual(body.annotations, []);
  assert.equal(Object.hasOwn(body, "title"), false);
});

test("V3 Node textbox attachment scan returns only valid permanent identities", () => {
  const converted = convertMangoLegacyHTML(
    '<!-- mango-editor-html-v1 --><span data-mango-editor-image="true" data-mango-editor-attachment-id="22222222-2222-4222-8222-222222222222" data-mango-editor-filename="image.png" data-mango-editor-mime-type="image/png"><img src="mango-attachment:22222222-2222-4222-8222-222222222222"></span>',
  );
  assert.deepEqual(mangoAttachmentIDs(converted.document), ["22222222-2222-4222-8222-222222222222"]);
});

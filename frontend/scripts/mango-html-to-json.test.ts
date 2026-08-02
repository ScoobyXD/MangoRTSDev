import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import "./mango-editor-history-cutover.test.js";
import type { JSONContent } from "@tiptap/core";
import { convertMangoLegacyHTML, mapMangoQuoteAnnotations } from "./mango-html-to-json-core.js";

const fixture = `<!-- mango-editor-html-v1 -->
<p>07/20/26</p>
<p><strong>HR / EA</strong>, <em>Sammie Lee</em> <u>update</u> <s>old</s> <span style="color:rgb(15, 23, 42)">colored<br>line</span></p>
<ul data-mango-editor-list="bullet">
  <li data-mango-editor-list-item="true"><p>Highlights with <span data-mango-editor-highlight="#fef08a" style="background-color:#fef08a">yellow text</span>.</p>
    <ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="true"><p>Nested detail</p></li></ul>
  </li>
</ul>
<ul data-mango-editor-list="checklist"><li data-mango-editor-checklist-checked="true"><p>Completed item</p></li></ul>
<p><a href="https://example.com">Safe link</a> and <span data-mango-mention="true" data-mango-mention-user-id="11111111-1111-1111-1111-111111111111">@Sam</span></p>
<table data-mango-editor-table="true"><tbody><tr><td style="text-align:center"><p>Cell</p></td></tr></tbody></table>
<span data-mango-editor-image="true" data-mango-editor-attachment-id="22222222-2222-2222-2222-222222222222" data-mango-editor-filename="huddle.png" data-mango-editor-mime-type="image/png" style="width:320px;height:180px;float:left"><img src="mango-attachment:22222222-2222-2222-2222-222222222222" alt="Huddle screenshot"></span>`;

function nodesOfType(root: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const visit = (node: JSONContent): void => {
    if (node.type === type) found.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  return found;
}

function marksOfType(root: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const visit = (node: JSONContent): void => {
    if ((node.marks ?? []).some((mark) => mark.type === type)) found.push(node);
    for (const child of node.content ?? []) visit(child);
  };
  visit(root);
  return found;
}

test("official Tiptap conversion preserves Mango rich-text structures deterministically", () => {
  const first = convertMangoLegacyHTML(fixture);
  const second = convertMangoLegacyHTML(fixture);
  assert.deepEqual(first.document, second.document);
  assert.equal(first.sourceCounts.attachmentImages, 1);
  assert.equal(first.jsonCounts.attachmentImages, 1);
  assert.equal(first.jsonCounts.taskLists, 1);
  assert.equal(first.jsonCounts.bulletLists, 2);
  assert.equal(first.jsonCounts.tables, 1);
  assert.ok(first.jsonCounts.highlights >= 1);
  assert.ok(first.jsonCounts.bold >= 1);
  assert.ok(first.jsonCounts.italic >= 1);
  assert.ok(first.jsonCounts.underline >= 1);
  assert.ok(first.jsonCounts.strike >= 1);
  assert.ok(first.jsonCounts.links >= 1);
  const colored = nodesOfType(first.document.document, "text").find((node) => node.text === "colored");
  assert.equal(colored?.marks?.find((mark) => mark.type === "textStyle")?.attrs?.color, "#0f172a");

  const mentions = nodesOfType(first.document.document, "mention");
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].attrs?.userId, "11111111-1111-1111-1111-111111111111");
  assert.equal(mentions[0].attrs?.label, "Sam");
  assert.equal(mentions[0].attrs?.kind, "normal");
  const images = nodesOfType(first.document.document, "mangoAttachmentImage");
  assert.equal(images[0].attrs?.attachmentId, "22222222-2222-2222-2222-222222222222");
  assert.equal(images[0].attrs?.filename, "huddle.png");
  assert.ok(nodesOfType(first.document.document, "paragraph").every((node) => typeof node.attrs?.blockId === "string"));
  assert.ok(marksOfType(first.document.document, "highlight").length >= 1);
  const mapped = mapMangoQuoteAnnotations(first.document, [{ id: "chat-1", quote: "yellow text" }]);
  assert.deepEqual(mapped.unmappedIDs, []);
  assert.equal(mapped.annotations.length, 1);
  assert.ok(mapped.annotations[0].to > mapped.annotations[0].from);
});


test("conversion preserves visible root newlines before a formatted heading", () => {
  const converted = convertMangoLegacyHTML(`<!-- mango-editor-html-v1 -->07/20/26\n\n<span style="font-size:14px"><strong>HR / EA, Sammie Lee</strong></span>`);
  assert.match(converted.normalizedHTML, /07\/20\/26<br><br>/);
  const firstParagraph = converted.document.document.content?.[0];
  assert.equal(firstParagraph?.type, "paragraph");
  assert.deepEqual(
    firstParagraph?.content?.map((node) => node.type),
    ["text", "hardBreak", "hardBreak", "text"],
  );
  assert.equal(firstParagraph?.content?.[0].text, "07/20/26");
  assert.equal(firstParagraph?.content?.[3].text, "HR / EA, Sammie Lee");
  assert.ok(firstParagraph?.content?.[3].marks?.some((mark) => mark.type === "bold"));
});

test("conversion refuses images that do not have permanent attachment IDs", () => {
  assert.throws(
    () => convertMangoLegacyHTML('<!-- mango-editor-html-v1 --><p>Unsafe</p><img src="data:image/png;base64,AA==">'),
    /without Mango attachment wrappers/,
  );
});

test("conversion repairs escaped legacy attribute quotes without changing visible escaped text", () => {
  const escaped = String.raw`<!-- mango-editor-html-v1 -->
<p><a href=\"https://example.com/path\">Escaped link</a> and visible \"quoted\" text.</p>
<ol><li><p>Numbered item</p></li></ol>
<ul data-mango-editor-list=\"bullet\"><li data-mango-editor-list-item=\"true\"><p>Outer bullet</p><ul data-mango-editor-list=\"bullet\"><li><p>Nested bullet</p></li></ul></li></ul>
<span data-mango-editor-image=\"true\" data-mango-editor-attachment-id=\"33333333-3333-4333-8333-333333333333\" data-mango-editor-filename=\"escaped.png\" data-mango-editor-mime-type=\"image/png\"><img src=\"mango-attachment:33333333-3333-4333-8333-333333333333\" alt=\"Escaped image\"></span>`;
  const converted = convertMangoLegacyHTML(escaped);
  assert.equal(converted.jsonCounts.links, 1);
  assert.equal(converted.jsonCounts.orderedLists, 1);
  assert.equal(converted.jsonCounts.bulletLists, 2);
  assert.equal(converted.jsonCounts.attachmentImages, 1);
  assert.match(converted.normalizedText, /visible \\"quoted\\" text/);
  assert.equal(nodesOfType(converted.document.document, "orderedList")[0].attrs?.type, null);
  assert.equal(nodesOfType(converted.document.document, "mangoAttachmentImage")[0].attrs?.attachmentId, "33333333-3333-4333-8333-333333333333");
});

test("conversion resolves escaped legacy image metadata and embedded bytes from permanent attachments", () => {
  const bytes = Buffer.from("embedded-image", "utf8");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const source = String.raw`<!-- mango-editor-html-v1 --><span data-mango-editor-image=\"true\" data-mango-editor-image-wrap=\"none\"><img src=\"data:image/png;base64,${bytes.toString("base64")}\"></span>`;
  const converted = convertMangoLegacyHTML(source, { attachments: [
    { attachmentId: "22222222-2222-4222-8222-222222222222", filename: "second.png", mimeType: "image/png", byteSize: bytes.length, sha256: sha, relationshipKind: "chat_attachment" },
    { attachmentId: "11111111-1111-4111-8111-111111111111", filename: "first.png", mimeType: "image/png", byteSize: bytes.length, sha256: sha, relationshipKind: "chat_attachment" },
  ] });
  const image = nodesOfType(converted.document.document, "mangoAttachmentImage")[0];
  assert.equal(image.attrs?.attachmentId, "11111111-1111-4111-8111-111111111111");
  assert.equal(image.attrs?.filename, "first.png");
  assert.equal(image.attrs?.mimeType, "image/png");
  assert.doesNotMatch(JSON.stringify(converted.document), /data:image/);

  const metadataOnly = convertMangoLegacyHTML(String.raw`<!-- mango-editor-html-v1 --><span data-mango-editor-image=\"true\" data-mango-editor-attachment-id=\"11111111-1111-4111-8111-111111111111\"><img src=\"\"></span>`, {
    attachments: [{ attachmentId: "11111111-1111-4111-8111-111111111111", filename: "first.png", mimeType: "image/png", byteSize: bytes.length, sha256: sha }],
  });
  assert.equal(nodesOfType(metadataOnly.document.document, "mangoAttachmentImage")[0].attrs?.mimeType, "image/png");
});

test("conversion preserves root formatting around a nested block list", () => {
  const source = String.raw`<!-- mango-editor-html-v1 --><b>Before<ul data-mango-editor-list=\"bullet\"><li data-mango-editor-list-item=\"true\"><p>List item</p></li></ul>After</b><span data-mango-editor-highlight=\"#fef08a\" style=\"background-color:#fef08a\">Highlighted</span>`;
  const converted = convertMangoLegacyHTML(source);
  assert.equal(converted.jsonCounts.bulletLists, 1);
  assert.ok(converted.jsonCounts.bold >= 1);
  assert.equal(converted.jsonCounts.highlights, 1);
  assert.equal(converted.normalizedText, "Before List item AfterHighlighted");
});

test("conversion creates a valid empty document for an empty legacy textbox body", () => {
  const converted = convertMangoLegacyHTML("");
  assert.equal(converted.normalizedText, "");
  assert.equal(converted.document.document.type, "doc");
  assert.equal(converted.document.document.content?.[0]?.type, "paragraph");
});

test("conversion keeps block images inside list items without splitting lists and preserves image links", () => {
  const source = `<!-- mango-editor-html-v1 --><ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet"><a href="https://example.com/image" target="_blank" rel="noopener"><span data-mango-editor-image="true" data-mango-editor-attachment-id="44444444-4444-4444-8444-444444444444" data-mango-editor-filename="linked.png" data-mango-editor-mime-type="image/png"><img src="mango-attachment:44444444-4444-4444-8444-444444444444"></span></a></li></ul>`;
  const converted = convertMangoLegacyHTML(source);
  assert.equal(converted.sourceCounts.bulletLists, 1);
  assert.equal(converted.jsonCounts.bulletLists, 1);
  assert.equal(converted.sourceCounts.links, 1);
  assert.equal(converted.jsonCounts.links, 1);
  const image = nodesOfType(converted.document.document, "mangoAttachmentImage")[0];
  assert.equal(image.attrs?.linkHref, "https://example.com/image");
  assert.equal(image.attrs?.linkTarget, "_blank");
});

test("entity links support server-side HTML round trips", () => {
  const source = `<!-- mango-editor-html-v1 --><span data-mango-entity-link="true" data-mango-entity-type="project" data-mango-entity-id="project-1" data-mango-entity-label="Roadmap">Roadmap</span>`;
  const converted = convertMangoLegacyHTML(source);
  assert.equal(converted.jsonCounts.entityLinks, 1);
  assert.match(converted.roundTripHTML, /data-mango-entity-id="project-1"/);
});

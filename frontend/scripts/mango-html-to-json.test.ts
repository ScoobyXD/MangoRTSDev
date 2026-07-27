import assert from "node:assert/strict";
import test from "node:test";
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

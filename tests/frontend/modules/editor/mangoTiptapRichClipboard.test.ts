import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";
import {
  createMangoTiptapAttachmentContent,
  prepareMangoTiptapRichClipboardHTML,
  readMangoTiptapInsertionAlignment,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapRichClipboard.js";
import { validateMangoTiptapDocument } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";

type Restore = () => void;

function installDOM(dom: JSDOM): Restore {
  const restores: Restore[] = [];
  for (const name of [
    "window", "document", "navigator", "Node", "Element", "HTMLElement", "HTMLAnchorElement",
    "HTMLBRElement", "HTMLImageElement", "HTMLSpanElement", "HTMLTemplateElement", "HTMLLIElement",
    "HTMLUListElement", "HTMLOListElement", "HTMLTableElement", "HTMLTableRowElement",
    "HTMLTableCellElement", "DocumentFragment", "DOMParser", "MutationObserver", "Range", "Selection",
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    const value = name === "window"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }
  return () => restores.reverse().forEach((restore) => restore());
}

test("Google Docs rich HTML keeps its text and imports its remote image as a durable left-aligned Tiptap node", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=editor></div></body></html>", { url: "https://mango.test/" });
  const restore = installDOM(dom);
  let editor: MangoTiptapEditorEngine | undefined;
  try {
    const source = "https://lh7-rt.googleusercontent.com/docsz/temporary-image-token?key=secret";
    const html = [
      '<p><strong>Tiptap</strong> Editor interface</p>',
      `<p><a href="https://docs.google.com"><img src="${source}" alt="Copied tree" width="546" height="427"></a></p>`,
      "<p>CURRENT: 7/28/26 6:15pm</p>",
    ].join("");
    const result = await prepareMangoTiptapRichClipboardHTML(dom.window.document, html, "left", async (request) => ({
      src: "mango-attachment:google-docs-image",
      attachmentID: "google-docs-image",
      filename: "copied-tree.png",
      mimeType: "image/png",
      byteSize: 12345,
      width: request.width ?? 546,
      height: request.height ?? 427,
      alt: request.alt,
    }));

    assert.equal(result.imageCount, 1);
    assert.equal(result.importedImageCount, 1);
    assert.equal(result.failedImageCount, 0);
    assert.doesNotMatch(result.html, /googleusercontent|temporary-image-token|data-mango-editor-image/);
    assert.match(result.html, /<mango-attachment-image[^>]*data-attachment-id="google-docs-image"/);
    assert.match(result.html, /data-alignment="left"/);

    editor = new MangoTiptapEditorEngine({
      element: dom.window.document.querySelector<HTMLElement>("#editor"),
      extensions: createMangoTiptapExtensions({ editable: true }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
      enableContentCheck: true,
    });
    assert.equal(editor.commands.insertContent(result.html), true);
    const document = editor.getJSON();
    assert.deepEqual(document.content?.map((node) => node.type), ["paragraph", "mangoAttachmentImage", "paragraph"]);
    assert.equal(editor.state.doc.textContent.includes("Tiptap Editor interface"), true);
    assert.equal(editor.state.doc.textContent.includes("CURRENT: 7/28/26 6:15pm"), true);
    const image = document.content?.find((node) => node.type === "mangoAttachmentImage");
    assert.equal(image?.attrs?.attachmentId, "google-docs-image");
    assert.equal(image?.attrs?.alignment, "left");
    assert.equal(image?.attrs?.displayWidth, 546);
    const validation = validateMangoTiptapDocument({ format: "mango-tiptap-json", schema_version: 1, document });
    assert.equal(validation.valid, true, validation.valid ? "" : validation.error);

    let imagePosition = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "mangoAttachmentImage") imagePosition = position;
    });
    assert.ok(imagePosition >= 0);
    editor.commands.setNodeSelection(imagePosition);
    assert.equal(readMangoTiptapInsertionAlignment(editor), "left");
  } finally {
    editor?.destroy();
    restore();
    dom.window.close();
  }
});

test("new attachment image content follows the active alignment instead of defaulting to center", () => {
  const content = createMangoTiptapAttachmentContent({
    company_id: "company-1",
    attachment_id: "attachment-1",
    original_filename: "black.png",
    mime_type: "image/png",
    byte_size: 100,
    sha256: "abc123",
    storage_key: "attachments/black.png",
    source_kind: "editor_paste",
    created_timestamp: "2026-07-29T16:00:00Z",
  }, "right");
  assert.equal(content.attrs?.alignment, "right");
});

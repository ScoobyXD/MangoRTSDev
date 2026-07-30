import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import {
  createMangoTiptapExtensions,
  MangoTiptapEditorEngine,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapExtensions.js";
import {
  createMangoTiptapAttachmentContent,
  parseMangoTiptapRichClipboardContent,
  prepareMangoTiptapRichClipboardHTML,
  readMangoTiptapClipboardPaste,
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

test("plain clipboard text and a file-backed image become one durable paste", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=editor></div></body></html>", { url: "https://mango.test/" });
  const restore = installDOM(dom);
  let editor: MangoTiptapEditorEngine | undefined;
  try {
    const image = { name: "tree.png", type: "image/png", size: 4 } as File;
    const paste = readMangoTiptapClipboardPaste(dom.window.document, {
      files: [image] as unknown as FileList,
      getData: (type) => type === "text/plain" ? "Text before\nText after" : "",
    });
    if (!paste) throw new Error("the text and image clipboard should be owned");
    assert.equal(paste.imageCount, 1);
    assert.equal(paste.matchingFiles[0], image);
    assert.match(paste.html, /Text before/);
    assert.match(paste.html, /Text after/);

    const result = await prepareMangoTiptapRichClipboardHTML(
      dom.window.document,
      paste.html,
      "left",
      async (request) => ({
        src: "mango-attachment:file-image",
        attachmentID: "file-image",
        filename: paste.matchingFiles[request.index]?.name ?? "missing.png",
        mimeType: "image/png",
        width: 640,
        height: 360,
      }),
    );
    assert.match(result.html, /Text before/);
    assert.match(result.html, /Text after/);
    assert.match(result.html, /data-attachment-id="file-image"/);

    editor = new MangoTiptapEditorEngine({
      element: dom.window.document.querySelector<HTMLElement>("#editor"),
      extensions: createMangoTiptapExtensions({ editable: true }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
      enableContentCheck: true,
    });
    const content = parseMangoTiptapRichClipboardContent(editor, dom.window.document, result.html);
    assert.equal(editor.commands.insertContent(content), true);
    assert.match(JSON.stringify(editor.getJSON()), /"attachmentId":"file-image"/);
  } finally {
    editor?.destroy();
    restore();
    dom.window.close();
  }
});

test("clipboard wrappers do not reject supported text and durable images", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=editor></div></body></html>", { url: "https://mango.test/" });
  const restore = installDOM(dom);
  let editor: MangoTiptapEditorEngine | undefined;
  try {
    const result = await prepareMangoTiptapRichClipboardHTML(
      dom.window.document,
      '<div style="text-align:left"><span>Text before</span><img src="https://images.example.test/tree"><span>Text after</span></div>',
      "left",
      async () => ({
        src: "mango-attachment:tree-image",
        attachmentID: "tree-image",
        filename: "tree.png",
        mimeType: "image/png",
        width: 640,
        height: 360,
      }),
    );

    editor = new MangoTiptapEditorEngine({
      element: dom.window.document.querySelector<HTMLElement>("#editor"),
      extensions: createMangoTiptapExtensions({ editable: true }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
      enableContentCheck: true,
    });
    const content = parseMangoTiptapRichClipboardContent(editor, dom.window.document, result.html);
    assert.ok(content.size > 0);
    assert.equal(editor.commands.insertContent(content), true);
    assert.equal(editor.state.doc.textContent.includes("Text before"), true);
    assert.equal(editor.state.doc.textContent.includes("Text after"), true);
    assert.match(JSON.stringify(editor.getJSON()), /"attachmentId":"tree-image"/);
  } finally {
    editor?.destroy();
    restore();
    dom.window.close();
  }
});

test("one file can back the same inline image twice without losing the surrounding text", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://mango.test/" });
  const restore = installDOM(dom);
  try {
    const image = { name: "tree.png", type: "image/png", size: 4 } as File;
    const html = '<p>First point</p><p><img src="blob:copied-tree"></p><p>Second point</p><p><img src="blob:copied-tree"></p>';
    const paste = readMangoTiptapClipboardPaste(dom.window.document, {
      files: [image] as unknown as FileList,
      getData: (type) => type === "text/html" ? html : "First point Second point",
    });
    if (!paste) throw new Error("the repeated inline image clipboard should be owned");
    assert.deepEqual(paste.matchingFiles, [image, image]);
    let uploads = 0;
    const result = await prepareMangoTiptapRichClipboardHTML(dom.window.document, paste.html, "left", async () => {
      uploads += 1;
      return {
        src: "mango-attachment:repeated-image",
        attachmentID: "repeated-image",
        filename: "tree.png",
        mimeType: "image/png",
        width: 640,
        height: 360,
      };
    });
    assert.equal(uploads, 1, "the repeated source uploads once");
    assert.equal((result.html.match(/data-attachment-id="repeated-image"/g) ?? []).length, 2);
    assert.match(result.html, /First point/);
    assert.match(result.html, /Second point/);
  } finally {
    restore();
    dom.window.close();
  }
});

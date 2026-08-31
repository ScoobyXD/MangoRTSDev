import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { sha256HexToBase64 } from "../../../../frontend/src/modules/attachments/attachmentHash.js";
import {
  durableEditorAttachmentInformationID,
} from "../../../../frontend/src/modules/editor/editorAttachmentPreparation.js";

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
  resolveMangoTiptapRichClipboardImage,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapRichClipboard.js";
import { handleMangoTiptapTableClipboardPaste } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapTable.js";
import { sanitizeEditorDocumentHTML } from "../../../../frontend/src/modules/editor/richTextEditing.js";
import {
  validateMangoTiptapDocument,
  type MangoTiptapDocument,
} from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapDocument.js";

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
    assert.equal(image?.attrs?.position, "break", "new pasted images remain break-text until the user moves them");
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
  assert.equal(content.attrs?.position, "break");
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

test("a file-backed short-wide screenshot keeps its ratio and uploads when optional measurement fails", async () => {
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Image");
  const xhrDescriptor = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  const createImageBitmapDescriptor = Object.getOwnPropertyDescriptor(globalThis, "createImageBitmap");
  const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const revoked: string[] = [];
  let bitmapDecodeShouldFail = false;
  let bitmapDecodeCount = 0;
  let closedBitmapCount = 0;
  try {
    class ShortWideImage {
      static fail = false;
      naturalWidth = 2400;
      naturalHeight = 40;
      private loadListener: (() => void) | undefined;
      private errorListener: (() => void) | undefined;
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        const invoke = () => typeof listener === "function"
          ? listener(new Event(type))
          : listener.handleEvent(new Event(type));
        if (type === "load") this.loadListener = invoke;
        if (type === "error") this.errorListener = invoke;
      }
      set src(_value: string) {
        queueMicrotask(() => ShortWideImage.fail ? this.errorListener?.() : this.loadListener?.());
      }
    }
    class SuccessfulUploadXHR {
      upload = { onprogress: null as ((event: ProgressEvent<EventTarget>) => void) | null };
      status = 0;
      withCredentials = true;
      timeout = 0;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ontimeout: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      getResponseHeader() { return null; }
      send(body: Document | XMLHttpRequestBodyInit | null) {
        this.upload.onprogress?.({ loaded: body instanceof Blob ? body.size : 0 } as ProgressEvent<EventTarget>);
        this.status = 200;
        queueMicrotask(() => this.onload?.());
      }
      abort() { this.onabort?.(); }
    }
    Object.defineProperty(globalThis, "Image", { configurable: true, writable: true, value: ShortWideImage });
    Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: SuccessfulUploadXHR });
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      writable: true,
      value: async () => {
        bitmapDecodeCount += 1;
        if (bitmapDecodeShouldFail) throw new Error("failed_to_decode_bitmap");
        return {
          width: 2400,
          height: 40,
          close: () => { closedBitmapCount += 1; },
        } as ImageBitmap;
      },
    });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: () => "blob:short-wide" });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: (value: string) => { revoked.push(value); } });

    const emptySHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    let completedUploads = 0;
    const requestJSON = async <T,>(path: string): Promise<T> => {
      if (path === "/v1/attachments/upload-policy") return {
        directUploadEnabled: true,
        maxFileBytes: 1024,
        singlePutMaxBytes: 1024,
        multipartPartBytes: 1024,
        maxConcurrentParts: 1,
        intentLifetimeSeconds: 60,
      } as T;
      if (path === "/v1/attachments/upload-intents") return {
        uploadIntentId: "intent-short-wide",
        attachmentId: "attachment-short-wide",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        upload: {
          strategy: "single",
          method: "PUT",
          url: "https://storage.mango.test/short-wide",
          requiredHeaders: {
            "content-type": "image/png",
            "x-amz-checksum-sha256": sha256HexToBase64(emptySHA256),
          },
        },
      } as T;
      if (path.endsWith("/complete")) {
        completedUploads += 1;
        return {
          attachment: {
            company_id: "company-1",
            attachment_id: "attachment-short-wide",
            original_filename: "short-wide.png",
            mime_type: "image/png",
            byte_size: 0,
            sha256: emptySHA256,
            source_kind: "editor_paste",
            created_timestamp: "2026-08-30T12:00:00Z",
          },
          resource_attachment: {
            resource_attachment_id: "link-short-wide",
            company_id: "company-1",
            resource_type: "node",
            resource_id: "node-1",
            attachment_id: "attachment-short-wide",
            relationship_kind: "inline_image",
            created_timestamp: "2026-08-30T12:00:00Z",
          },
        } as T;
      }
      throw new Error(`unexpected_request:${path}`);
    };
    const file = Object.assign(new Blob([], { type: "image/png" }), {
      name: "short-wide.png",
      lastModified: 42,
    }) as File;
    const result = await resolveMangoTiptapRichClipboardImage({
      index: 0,
      sourceKind: "blob",
      source: "blob:clipboard-short-wide",
      filename: file.name,
    }, file, {
      requestJSON,
      apiBase: "",
      companyID: "company-1",
      resourceType: "node",
      resourceID: "node-1",
    });

    assert.equal(completedUploads, 1);
    assert.deepEqual({ width: result.width, height: result.height }, { width: 840, height: 14 });
    const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://mango.test/" });
    const restoreDOM = installDOM(dom);
    try {
      const prepared = await prepareMangoTiptapRichClipboardHTML(
        dom.window.document,
        '<p><img src="blob:clipboard-short-wide" alt="short-wide.png"></p>',
        "left",
        async () => result,
      );
      assert.match(prepared.html, /data-width="840"/);
      assert.match(prepared.html, /data-height="14"/, "clipboard preparation must not clamp the measured ratio to a taller frame");

      ShortWideImage.fail = true;
      const paste = readMangoTiptapClipboardPaste(dom.window.document, {
        files: [file] as unknown as FileList,
        getData: () => "",
      });
      assert.ok(paste);
      const importedAfterMeasurementFailure = await prepareMangoTiptapRichClipboardHTML(
        dom.window.document,
        paste.html,
        "left",
        (request) => resolveMangoTiptapRichClipboardImage(request, paste.matchingFiles[request.index], {
          requestJSON,
          apiBase: "",
          companyID: "company-1",
          resourceType: "node",
          resourceID: "node-1",
        }),
      );
      assert.equal(importedAfterMeasurementFailure.importedImageCount, 1);
      assert.equal(importedAfterMeasurementFailure.failedImageCount, 0);
      assert.match(importedAfterMeasurementFailure.html, /data-attachment-id="attachment-short-wide"/);
      assert.match(importedAfterMeasurementFailure.html, /data-width="840"/);
      assert.match(importedAfterMeasurementFailure.html, /data-height="14"/);
    } finally {
      restoreDOM();
      dom.window.close();
    }
    assert.equal(bitmapDecodeCount, 1);
    assert.equal(closedBitmapCount, 1);

    bitmapDecodeShouldFail = true;
    const importedWhenAllMeasurementFails = await resolveMangoTiptapRichClipboardImage({
      index: 0,
      sourceKind: "blob",
      source: "blob:clipboard-short-wide",
      filename: file.name,
    }, file, {
      requestJSON,
      apiBase: "",
      companyID: "company-1",
      resourceType: "node",
      resourceID: "node-1",
    });
    assert.equal(importedWhenAllMeasurementFails.attachmentID, "attachment-short-wide");
    assert.equal(completedUploads, 3, "optional bitmap decoding must never prevent the durable upload");
    assert.equal(bitmapDecodeCount, 2);
    assert.deepEqual(revoked, ["blob:short-wide", "blob:short-wide", "blob:short-wide"]);
  } finally {
    if (imageDescriptor) Object.defineProperty(globalThis, "Image", imageDescriptor);
    else delete (globalThis as Record<string, unknown>).Image;
    if (xhrDescriptor) Object.defineProperty(globalThis, "XMLHttpRequest", xhrDescriptor);
    else delete (globalThis as Record<string, unknown>).XMLHttpRequest;
    if (createImageBitmapDescriptor) Object.defineProperty(globalThis, "createImageBitmap", createImageBitmapDescriptor);
    else delete (globalThis as Record<string, unknown>).createImageBitmap;
    if (createObjectURLDescriptor) Object.defineProperty(URL, "createObjectURL", createObjectURLDescriptor);
    else delete (URL as unknown as Record<string, unknown>).createObjectURL;
    if (revokeObjectURLDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeObjectURLDescriptor);
    else delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  }
});

test("Excel clipboard alternatives paste only the complete native table", () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=editor></div></body></html>", { url: "https://mango.test/" });
  const restore = installDOM(dom);
  let editor: MangoTiptapEditorEngine | undefined;
  try {
    const headers = ["Company", "Order", "Their PO", "Due", "Collection", "Past Due", "Age", "Invoiced", "Balance", "SHIP-TO"];
    const values = ["TJX TJ Maxx A/P", "2026-19230-00", "70005795", "8/8/2026", "10", "10", "70", "10513.80", "10513.80", "TJ Maxx DC #897"];
    const html = [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel"><head>',
      '<style><!--table {mso-displayed-decimal-separator:"\\.";mso-displayed-thousand-separator:"\\,";}td {font-family:Calibri;mso-number-format:General;}--></style>',
      "</head><body><!--StartFragment--><table><tbody>",
      `<tr>${headers.map((value) => `<th>${value}</th>`).join("")}</tr>`,
      `<tr>${values.map((value) => `<td>${value}</td>`).join("")}</tr>`,
      "</tbody></table><!--EndFragment--></body></html>",
    ].join("");
    const tsv = `${headers.join("\t")}\r\n${values.join("\t")}`;
    const preview = { name: "Microsoft Excel.png", type: "image/png", size: 4 } as File;
    const clipboardData = {
      files: [preview] as unknown as FileList,
      getData: (type: string) => type === "text/html"
        ? html
        : type === "text/tab-separated-values" || type === "text/plain"
          ? tsv
          : "",
    };

    assert.equal(
      readMangoTiptapClipboardPaste(dom.window.document, clipboardData),
      null,
      "an unreferenced Excel bitmap is an alternative preview, not editor content",
    );
    assert.equal(
      readMangoTiptapClipboardPaste(dom.window.document, {
        ...clipboardData,
        getData: (type: string) => type === "text/tab-separated-values" || type === "text/plain" ? tsv : "",
      }),
      null,
      "an explicit Excel TSV grid also wins when HTML is unavailable",
    );
    const sanitizedFallback = sanitizeEditorDocumentHTML(html);
    assert.doesNotMatch(sanitizedFallback, /mso-displayed|mso-number-format|Calibri|&lt;!--table/);
    assert.match(sanitizedFallback, /Company/);

    editor = new MangoTiptapEditorEngine({
      element: dom.window.document.querySelector<HTMLElement>("#editor"),
      extensions: createMangoTiptapExtensions({ editable: true }),
      content: { type: "doc", content: [{ type: "paragraph" }] },
      enableContentCheck: true,
      editorProps: { handlePaste: handleMangoTiptapTableClipboardPaste },
    });
    editor.commands.setTextSelection(1);
    const domGlobals = dom.window as unknown as typeof globalThis;
    const pasteEvent = new domGlobals.Event("paste") as ClipboardEvent;
    Object.defineProperty(pasteEvent, "clipboardData", { configurable: true, value: clipboardData });
    assert.equal(editor.view.pasteHTML(html, pasteEvent), true, "the native table parser owns the Excel HTML");

    const document = editor.getJSON() as MangoTiptapDocument["document"];
    const table = document.content?.find((node) => node.type === "table");
    assert.equal(table?.content?.length, 2);
    assert.deepEqual(table?.content?.map((row) => row.content?.length), [10, 10], "all Excel columns must survive");
    assert.deepEqual(table?.content?.[0]?.content?.map((cell) => cell.content?.[0]?.content?.[0]?.text), headers);
    assert.deepEqual(table?.content?.[1]?.content?.map((cell) => cell.content?.[0]?.content?.[0]?.text), values);
    assert.doesNotMatch(editor.state.doc.textContent, /mso-displayed|mso-number-format|Calibri|StartFragment/);
    assert.equal(JSON.stringify(document).includes("mangoAttachmentImage"), false, "the saved JSON contains only the table, not Excel's preview image");
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

test("Logic Gate overview image paste omits its non-UUID document alias from the attachment request", () => {
  assert.equal(durableEditorAttachmentInformationID("logic-gate-overview"), undefined);
  assert.equal(
    durableEditorAttachmentInformationID("019f6223-8848-7101-b388-7a330e4636c8"),
    "019f6223-8848-7101-b388-7a330e4636c8",
  );
});

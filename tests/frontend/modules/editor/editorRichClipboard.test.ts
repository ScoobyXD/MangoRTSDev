import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  countEditorRichClipboardImages,
  prepareEditorRichClipboardHTML,
  type EditorRichClipboardImageRequest,
} from "../../../../frontend/src/modules/editor/editorRichClipboard.js";
import {
  EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE,
  EDITOR_IMAGE_NODE_ATTRIBUTE,
  editorAttachmentImageSource,
} from "../../../../frontend/src/modules/editor/editorImages.js";

type Restore = () => void;

function installEditorClipboardDOM(dom: JSDOM): Restore {
  const restores: Restore[] = [];
  for (const name of [
    "document", "Node", "Element", "HTMLElement", "HTMLAnchorElement", "HTMLBRElement",
    "HTMLImageElement", "HTMLSpanElement", "HTMLTemplateElement", "HTMLLIElement",
    "HTMLUListElement", "HTMLOListElement", "HTMLTableElement", "HTMLTableRowElement",
    "HTMLTableCellElement", "DocumentFragment",
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name],
    });
    restores.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }
  return () => restores.reverse().forEach((restore) => restore());
}

function resolvedImage(request: EditorRichClipboardImageRequest, attachmentID: string) {
  return {
    src: editorAttachmentImageSource(attachmentID),
    attachmentID,
    filename: request.filename ?? "pasted-image.png",
    mimeType: "image/png",
    byteSize: 512,
    width: request.width ?? 640,
    height: request.height ?? 360,
    alt: request.alt,
  };
}

test("mixed rich clipboard import preserves document order and deduplicates repeated external images", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const restore = installEditorClipboardDOM(dom);
  try {
    const sourceURL = "https://assets.clickup.example/sop/step-one.png?temporary_secret=hidden";
    const html = [
      "<h2>Release procedure</h2>",
      '<p><strong>Step one</strong> keeps <em>rich text</em>.</p>',
      '<ol type="A" start="2"><li>Open the deployment page</li><li>Verify the checklist</li></ol>',
      `<p><img src="${sourceURL}" alt="Deployment screen" width="800" height="450"></p>`,
      "<blockquote style=\"margin-left: 40px\">Indented note</blockquote>",
      '<ul class="task-list"><li><input type="checkbox" checked>Confirm the owner</li><li><input type="checkbox">Notify the team</li></ul>',
      `<p><img src="${sourceURL}" alt="Deployment screen"></p>`,
      "<p>Finished</p>",
    ].join("");
    assert.equal(countEditorRichClipboardImages(dom.window.document, html), 2);

    const requests: EditorRichClipboardImageRequest[] = [];
    const result = await prepareEditorRichClipboardHTML(dom.window.document, html, async (request) => {
      requests.push(request);
      return resolvedImage(request, "attachment-one");
    });

    assert.equal(requests.length, 1, "the repeated source is imported once");
    assert.equal(requests[0].sourceKind, "remote");
    assert.equal(result.imageCount, 2);
    assert.equal(result.importedImageCount, 2);
    assert.equal(result.failedImageCount, 0);
    assert.doesNotMatch(result.html, /temporary_secret|https:\/\/assets\.clickup/i);
    assert.match(result.html, /font-size: 24px;?"><strong>Release procedure<\/strong>/);
    assert.match(result.html, /<strong>Step one<\/strong>/);
    assert.match(result.html, /<em>rich text<\/em>/);
    assert.match(result.html, /<ol[^>]*type="A"[^>]*start="2"/);
    assert.match(result.html, /margin-left: 40px/);
    assert.match(result.html, /data-mango-editor-list="checklist"/);
    assert.match(result.html, /data-mango-editor-checklist-checked="true"/);

    const container = dom.window.document.createElement("div");
    container.innerHTML = result.html;
    const frames = container.querySelectorAll(`span[${EDITOR_IMAGE_NODE_ATTRIBUTE}="true"]`);
    assert.equal(frames.length, 2);
    assert.deepEqual(
      Array.from(frames).map((frame) => frame.getAttribute(EDITOR_IMAGE_ATTACHMENT_ID_ATTRIBUTE)),
      ["attachment-one", "attachment-one"],
    );
    assert.ok((container.textContent ?? "").indexOf("Step one") < (container.textContent ?? "").indexOf("Finished"));
  } finally {
    restore();
  }
});

test("mixed rich clipboard import keeps text and successful images when one source cannot be imported", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const restore = installEditorClipboardDOM(dom);
  try {
    const html = [
      "<p>Before</p>",
      '<img src="data:image/png;base64,aGVsbG8=" alt="Clipboard image">',
      '<p>Between</p><img src="https://private.example.test/image.png" alt="Private image">',
      "<p>After</p>",
    ].join("");
    const result = await prepareEditorRichClipboardHTML(dom.window.document, html, async (request) => {
      if (request.sourceKind === "remote") throw new Error("remote_image_fetch_failed");
      return resolvedImage(request, "attachment-data");
    });

    assert.equal(result.imageCount, 2);
    assert.equal(result.importedImageCount, 1);
    assert.equal(result.failedImageCount, 1);
    assert.doesNotMatch(result.html, /data:image|private\.example\.test/);
    assert.match(result.html, /data-mango-editor-attachment-id="attachment-data"/);
    assert.match(result.html, /\[Image: Private image could not be imported\]/);
    assert.match(result.html, /Before[\s\S]*Between[\s\S]*After/);
  } finally {
    restore();
  }
});

test("mixed rich clipboard image resolution is bounded to three concurrent imports", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const restore = installEditorClipboardDOM(dom);
  try {
    const html = Array.from({ length: 7 }, (_, index) => (
      `<img src="https://assets.example.test/image-${index}.png" alt="Image ${index}">`
    )).join("");
    let active = 0;
    let maximumActive = 0;
    const releases: Array<() => void> = [];
    const resultPromise = prepareEditorRichClipboardHTML(dom.window.document, html, async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
      return resolvedImage(request, `attachment-${request.index}`);
    });
    await Promise.resolve();
    assert.equal(maximumActive, 3);
    while (releases.length > 0) {
      const release = releases.shift();
      release?.();
      await Promise.resolve();
    }
    const result = await resultPromise;
    assert.equal(result.importedImageCount, 7);
    assert.equal(maximumActive, 3);
  } finally {
    restore();
  }
});

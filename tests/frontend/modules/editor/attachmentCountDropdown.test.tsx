import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { MangoResourceAttachment } from "../../../../frontend/src/modules/attachments/attachmentApi.ts";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

test("attachment split control portals its menu and sends selected files through the plus zone", async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "Node", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLButtonElement", "HTMLInputElement", "Event", "EventTarget",
    "MouseEvent", "KeyboardEvent", "FocusEvent", "File", "Blob", "DOMParser",
  ] as const;
  for (const name of browserGlobals) {
    const value = name === "window" || name === "self"
      ? dom.window
      : name === "document"
        ? dom.window.document
        : (dom.window as unknown as Record<string, unknown>)[name];
    installGlobal(name, value, restores);
  }
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { AttachmentCountDropdown }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
    ]);
    const selectedFiles: File[][] = [];
    const resourceAttachment: MangoResourceAttachment = {
      resource_attachment_id: "resource-attachment-1",
      company_id: "company-1",
      resource_type: "node",
      resource_id: "node-1",
      attachment_id: "attachment-1",
      information_id: "text-box-1",
      editor_surface: "node_text_block",
      relationship_kind: "file_attachment",
      created_timestamp: "2026-07-23T20:16:00Z",
      attachment: {
        company_id: "company-1",
        attachment_id: "attachment-1",
        original_filename: "Screenshot 2026-07-05 201109.pdf",
        mime_type: "application/pdf",
        byte_size: 216 * 1024,
        sha256: "abc123",
        source_kind: "user_upload",
        created_timestamp: "2026-07-23T20:16:00Z",
      },
    };
    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(
      <div style={{ overflow: "hidden", width: 60, height: 30 }}>
        <AttachmentCountDropdown
          items={[{ resourceAttachment }]}
          apiBase="http://localhost"
          companyID="company-1"
          accent="#7c3aed"
          surfaceText="#111827"
          compact
          onAddFiles={(files) => { selectedFiles.push(files); }}
          onError={(message) => assert.fail(message)}
        />
      </div>,
    ));

    const splitControl = container.querySelector<HTMLElement>('[data-mango-attachment-control="split"]');
    const listZone = container.querySelector<HTMLButtonElement>('[data-mango-attachment-control-zone="list"]');
    const addZone = container.querySelector<HTMLButtonElement>('[data-mango-attachment-control-zone="add"]');
    assert.ok(splitControl);
    assert.ok(listZone);
    assert.ok(addZone);
    assert.equal(listZone.textContent?.trim(), "1");

    await act(async () => listZone.click());
    const menu = dom.window.document.querySelector<HTMLElement>('[role="menu"][aria-label="Attachments"]');
    assert.ok(menu, "the attachment list should open");
    assert.equal(menu.parentElement, dom.window.document.body, "the list must escape clipping text-box containers");
    assert.match(menu.textContent ?? "", /Screenshot 2026-07-05 201109/);
    assert.match(menu.textContent ?? "", /216 KB/);
    assert.doesNotMatch(menu.textContent ?? "", /Hello, I am a title/);

    await act(async () => menu.dispatchEvent(new dom.window.Event("pointerdown", { bubbles: true })));
    assert.ok(dom.window.document.querySelector('[role="menu"][aria-label="Attachments"]'), "interacting with the portaled list must not dismiss it");

    const input = splitControl.querySelector<HTMLInputElement>('input[type="file"]');
    assert.ok(input);
    const file = new dom.window.File(["payload"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { configurable: true, value: [file] });
    await act(async () => input.dispatchEvent(new dom.window.Event("change", { bubbles: true })));
    assert.equal(selectedFiles.length, 1);
    assert.deepEqual(selectedFiles[0]?.map((selected) => selected.name), ["notes.txt"]);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { EditorTextBlockChatMessage } from "../../../../frontend/src/modules/editor/editorProjection.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

function chat(
  id: string,
  blockID: string,
  createdTimestamp: string,
  parentID?: string,
): EditorTextBlockChatMessage {
  return {
    id,
    blockID,
    parentID,
    authorID: `author-${id}`,
    authorName: `Author ${id}`,
    message: `Message ${id}`,
    createdTimestamp,
    attachments: [],
  };
}

test("grouping New chat controls select, identify, send, and cancel the exact composer destination", { timeout: 8_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "localStorage", "Node", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "EventTarget",
    "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "DOMParser", "DOMException", "File", "Blob",
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

  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  installGlobal("ResizeObserver", TestResizeObserver, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { ChatPane }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
    ]);
    const submittedDestinations: string[] = [];
    const messages = [
      chat("chat-1", "textbox-a", "2026-08-11T10:00:00.000Z"),
      chat("chat-4", "textbox-b", "2026-08-11T11:00:00.000Z"),
      chat("chat-2", "textbox-a", "2026-08-11T10:01:00.000Z"),
      chat("chat-3", "textbox-a", "2026-08-11T10:02:00.000Z", "chat-1"),
    ];

    function Harness() {
      const [selectedSectionKey, setSelectedSectionKey] = React.useState("");
      const destinationLabel = selectedSectionKey === "node-a:textbox-a"
        ? "Alpha Node · First grouping"
        : selectedSectionKey === "node-b:textbox-b" ? "Beta Node · Second grouping" : undefined;
      return (
        <ChatPane
          blockID="email-chat"
          editable
          messages={messages}
          sectionLabelsByBlockID={{
            "node-a:textbox-a": "Alpha Node · First grouping",
            "node-b:textbox-b": "Beta Node · Second grouping",
          }}
          sectionNodeIDsByBlockID={{ "node-a:textbox-a": "node-a", "node-b:textbox-b": "node-b" }}
          sectionKeysByMessageID={{
            "chat-1": "node-a:textbox-a",
            "chat-2": "node-a:textbox-a",
            "chat-3": "node-a:textbox-a",
            "chat-4": "node-b:textbox-b",
          }}
          sectionActionLabel="New chat"
          selectedSectionKey={selectedSectionKey}
          composerDestinationLabel={destinationLabel}
          chronologicalMessages
          reserveScrollbarGutter
          draft="Ready to send"
          companyUsers={[]}
          draftAttachments={[]}
          replyTargetID=""
          heightStorageKey="email-chat-grouping-ui-test"
          fixedHeight={520}
          active
          currentUserID="user-1"
          activeMessageID=""
          accent="#475569"
          surfaceText="#111827"
          panelBackground="#ffffff"
          strokeColor="#cbd5e1"
          ruleColor="#e2e8f0"
          onFocus={() => undefined}
          onDraftChange={() => undefined}
          onActivateMessage={() => undefined}
          onNavigateToMessage={() => undefined}
          onReply={() => undefined}
          onEditMessage={async () => undefined}
          onDeleteMessage={() => undefined}
          onClearReply={() => undefined}
          onClearSelectionAnchor={() => undefined}
          onAttachFiles={() => undefined}
          onRemoveDraftAttachment={() => undefined}
          onSectionAction={setSelectedSectionKey}
          onClearComposerDestination={() => setSelectedSectionKey("")}
          onSubmit={() => submittedDestinations.push(selectedSectionKey)}
        />
      );
    }

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(<Harness />));

    const messageScroller = container.querySelector<HTMLElement>(".editor-document-scroll");
    assert.ok(messageScroller);
    assert.equal(messageScroller.style.scrollbarGutter, "stable");
    assert.equal(messageScroller.style.paddingRight, "16px");

    const articles = Array.from(container.querySelectorAll<HTMLElement>('[role="article"]'));
    assert.deepEqual(articles.map((article) => article.dataset.nodeChatMessageId), ["chat-1", "chat-2", "chat-3", "chat-4"]);
    assert.match(articles[2]?.textContent ?? "", /Reply to Author chat-1/);

    const firstNewChat = container.querySelector<HTMLButtonElement>('[aria-label="New chat in Alpha Node · First grouping"]');
    assert.ok(firstNewChat);
    await act(async () => firstNewChat.click());
    assert.equal(container.querySelector('[data-chat-section-selected="true"]')?.textContent?.includes("Alpha Node"), true);
    assert.equal(container.querySelector('[data-chat-composer-destination="true"]')?.textContent?.includes("New chat to Alpha Node · First grouping"), true);

    const composer = container.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(composer);
    await act(async () => composer.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    assert.deepEqual(submittedDestinations, ["node-a:textbox-a"]);

    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="Cancel chat destination"]');
    assert.ok(cancel);
    await act(async () => cancel.click());
    assert.equal(container.querySelector('[data-chat-section-selected="true"]'), null);
    assert.equal(container.querySelector('[data-chat-composer-destination="true"]'), null);
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

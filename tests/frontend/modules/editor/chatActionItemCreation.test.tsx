import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { JSDOM } from "jsdom";
import type { EditorChatEntityLink } from "../../../../frontend/src/modules/editor/chatEntityLinks.js";
import type { ActionItemSourceResourceType } from "../../../../frontend/src/modules/entities/entitiesApi.js";

test("highlighted chat text immediately creates undated items and safely stages exact-owner references", { timeout: 8_000 }, async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => original ? Object.defineProperty(globalThis, name, original) : delete (globalThis as Record<string, unknown>)[name]);
  };
  for (const name of ["window", "document", "navigator", "localStorage", "Node", "Element", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "MutationObserver", "DOMParser", "Event", "MouseEvent", "KeyboardEvent", "FocusEvent"]) {
    install(name, name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 20, right: 160, top: 40, bottom: 60, width: 140, height: 20 }) });
  let root: { unmount(): void } | undefined;
  try {
    const [{ createRoot }, { Simulate }, { ChatPane }] = await Promise.all([
      import("react-dom/client"), import("react-dom/test-utils"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
    ]);
    const requests: Array<Record<string, unknown>> = [];
    let sends = 0;
    let latestDraft = "";
    let latestLinks: EditorChatEntityLink[] = [];
    let latestReply = "";
    let deferRequest = false;
    let finishRequest: (() => void) | undefined;
    const selectedText = "Full original action text ".repeat(14);
    const originalDraft = `Before ${selectedText}after`;
    const commentText = "A colleague's entire posted comment must survive conversion.";
    const noop = () => undefined;
    const Harness: React.FC<{ resourceType: ActionItemSourceResourceType; editable?: boolean }> = ({ resourceType, editable = true }) => {
      const [draft, setDraft] = useState(originalDraft);
      const [links, setLinks] = useState<EditorChatEntityLink[]>([]);
      const [reply, setReply] = useState("");
      latestDraft = draft; latestLinks = links; latestReply = reply;
      return <ChatPane blockID="text-box" editable={editable} companyID="company" actionItemSource={{ resourceType, resourceID: `${resourceType}-id` }} entityRequestJSON={async <T,>(path: string, init?: { json?: unknown }): Promise<T> => {
        assert.equal(path, "/v1/action-items");
        const payload = init!.json as Record<string, unknown>;
        requests.push(payload);
        if (deferRequest) await new Promise<void>((resolve) => { finishRequest = resolve; });
        return { action_item: { entity_id: `action-${requests.length}`, name: payload.name, updated_timestamp: "2026-09-02T00:00:00Z" } } as T;
      }} messages={[{ id: "comment", blockID: "text-box", authorID: "colleague", authorName: "Colleague", message: commentText, createdTimestamp: "2026-09-02T00:00:00Z", attachments: [] }]} draft={draft} draftEntityLinks={links} companyUsers={[]} draftAttachments={[]} replyTargetID={reply} heightStorageKey="chat-action-item-test" fixedHeight={600} active currentUserID="viewer" activeMessageID="" accent="#0f766e" surfaceText="#0f172a" panelBackground="white" strokeColor="#ddd" ruleColor="#ddd" onFocus={noop} onDraftChange={setDraft} onDraftEntityLinksChange={setLinks} onActivateMessage={noop} onNavigateToMessage={noop} onReply={setReply} onEditMessage={async () => undefined} onDeleteMessage={noop} onClearReply={() => setReply("")} onClearSelectionAnchor={noop} onAttachFiles={noop} onRemoveDraftAttachment={noop} onSubmit={() => { sends++; }} />;
    };
    const container = dom.window.document.getElementById("root")!;
    const mounted = createRoot(container);
    root = mounted;
    const click = async (selector: string) => {
      const button = dom.window.document.querySelector<HTMLButtonElement>(selector);
      assert.ok(button, selector);
      await act(async () => { button.click(); });
    };
    const selectionToolbar = () => container.querySelector('[aria-label="Create an Action Item from highlighted chat text"]');
    const selectDraft = async (from: number, to: number) => {
      const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!;
      await act(async () => { textarea.focus(); textarea.setSelectionRange(from, to); Simulate.mouseUp(textarea); });
    };
    const selectComment = async (from = 0, to = commentText.length) => {
      const body = container.querySelector<HTMLElement>('[data-chat-message-text="comment"]')!;
      const text = body.firstElementChild!.firstChild!;
      const range = dom.window.document.createRange();
      range.setStart(text, from); range.setEnd(text, to);
      const selection = dom.window.document.getSelection()!;
      await act(async () => { selection.removeAllRanges(); selection.addRange(range); Simulate.mouseUp(body); });
    };
    await act(async () => { mounted.render(<Harness resourceType="node" editable={false} />); });
    await selectComment();
    assert.equal(selectionToolbar(), null, "read-only chats cannot create Action Items");
    await act(async () => { mounted.render(<Harness resourceType="node" />); });
    assert.equal(selectionToolbar(), null, "nonempty comments and drafts show no always-visible controls");
    assert.equal(container.querySelector('[aria-label="Create yellow Action Item from comment"]'), null);
    await selectDraft(7, 7 + selectedText.length);
    assert.ok(selectionToolbar());
    await act(async () => { dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(selectionToolbar(), null);
    assert.equal(requests.length, 0);
    assert.equal(latestDraft, originalDraft);
    assert.equal(latestLinks.length, 0);
    await selectDraft(7, 7 + selectedText.length);
    await click('[aria-label="Create red Action Item from highlighted chat text"]');
    assert.equal(requests[0].body_text, selectedText);
    assert.equal("analysis_due_date" in requests[0], false);
    assert.equal("completion_due_date" in requests[0], false);
    assert.equal(dom.window.document.querySelector('[role="dialog"]'), null);
    assert.equal(requests[0].color, "red");
    assert.deepEqual(requests[0].source, { resource_type: "node", resource_id: "node-id" });
    assert.ok(latestDraft.includes(selectedText), "long selected text is retained beside the reference");
    assert.equal(latestLinks[0].entityID, "action-1");
    assert.equal(sends, 0);
    for (const resourceType of ["project", "huddle_node"] as const) {
      await act(async () => { mounted.render(<Harness key={resourceType} resourceType={resourceType} />); });
      assert.equal(selectionToolbar(), null);
      await selectComment(2, 24);
      await click('[aria-label="Create yellow Action Item from highlighted chat text"]');
      const payload = requests.at(-1)!;
      assert.equal(payload.body_text, commentText.slice(2, 24), "only highlighted comment text is converted");
      assert.equal("analysis_due_date" in payload, false);
      assert.equal("completion_due_date" in payload, false);
      assert.equal(payload.color, "yellow");
      assert.deepEqual(payload.source, { resource_type: resourceType, resource_id: `${resourceType}-id` });
      assert.ok(container.querySelector('[data-node-chat-message-id="comment"]')!.textContent!.includes(commentText));
      assert.equal(latestReply, "comment");
      assert.ok(latestDraft.startsWith(originalDraft), "existing unsent text is preserved");
      assert.equal(latestLinks.length, 1);
      assert.equal(sends, 0, "creating does not send a chat");
    }
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="node" />); });
    await selectComment();
    assert.ok(selectionToolbar());
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="project" />); });
    assert.equal(selectionToolbar(), null, "owner changes discard previous selection controls");
    assert.equal(requests.length, 3);

    deferRequest = true;
    await selectComment();
    await click('[aria-label="Create yellow Action Item from highlighted chat text"]');
    assert.equal(requests.length, 4);
    await selectComment();
    assert.equal(selectionToolbar(), null, "an in-flight request cannot create a duplicate");
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="huddle_node" />); });
    await act(async () => { finishRequest!(); });
    assert.equal(selectionToolbar(), null);
    assert.equal(latestDraft, originalDraft);
    assert.equal(latestLinks.length, 0, "no reference leaks into the new owner");
    assert.equal(latestReply, "");
    assert.match(container.textContent!, /Action Item was created, but the chat changed/);

    await selectDraft(0, originalDraft.length);
    await click('[aria-label="Create red Action Item from highlighted chat text"]');
    const changedDraft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!;
    await act(async () => { changedDraft.value = "Changed while saving"; Simulate.change(changedDraft); });
    await act(async () => { finishRequest!(); });
    assert.equal(latestDraft, "Changed while saving", "response does not overwrite a newer draft");
    assert.equal(latestLinks.length, 0);
    assert.equal(dom.window.document.querySelector('form[role="dialog"]'), null);
    assert.equal(requests.length, 5);
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

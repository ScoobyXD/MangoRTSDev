import test from "node:test";
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import { JSDOM } from "jsdom";
import type { EditorChatEntityLink } from "../../../../frontend/src/modules/editor/chatEntityLinks.js";
import type { ActionItemSourceResourceType } from "../../../../frontend/src/modules/entities/entitiesApi.js";

test("chat conversion requires a date, preserves cancelled and long text, and stages exact-owner replies without sending", { timeout: 8_000 }, async () => {
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
    const submit = async () => {
      const form = dom.window.document.querySelector<HTMLFormElement>('form[role="dialog"]');
      assert.ok(form);
      await act(async () => { Simulate.submit(form); });
    };
    const setDate = async (label: string) => {
      const input = dom.window.document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      assert.ok(input);
      await act(async () => { input.value = "2026-09-15"; Simulate.change(input); });
    };
    await act(async () => { mounted.render(<Harness resourceType="node" editable={false} />); });
    assert.equal(container.querySelector('[aria-label="Create red Action Item from comment"]'), null);
    await act(async () => { mounted.render(<Harness resourceType="node" />); });
    const textarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!;
    textarea.setSelectionRange(7, 7 + selectedText.length);
    await click('[aria-label="Create red Action Item from chat draft"]');
    assert.ok(dom.window.document.querySelector('[role="dialog"]')!.textContent!.includes(selectedText));
    await submit();
    assert.equal(requests.length, 0);
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /analysis due date or completion due date/);
    await click('form[role="dialog"] button[type="button"]');
    assert.equal(latestDraft, originalDraft);
    assert.equal(latestLinks.length, 0);
    textarea.setSelectionRange(7, 7 + selectedText.length);
    await click('[aria-label="Create red Action Item from chat draft"]');
    await setDate("Analysis due date");
    await submit();
    assert.equal(requests[0].body_text, selectedText);
    assert.equal(requests[0].analysis_due_date, "2026-09-15");
    assert.equal(requests[0].color, "red");
    assert.deepEqual(requests[0].source, { resource_type: "node", resource_id: "node-id" });
    assert.ok(latestDraft.includes(selectedText), "long selected text is retained beside the reference");
    assert.equal(latestLinks[0].entityID, "action-1");
    assert.equal(sends, 0);
    for (const resourceType of ["project", "huddle_node"] as const) {
      await act(async () => { mounted.render(<Harness key={resourceType} resourceType={resourceType} />); });
      await click('[aria-label="Create yellow Action Item from comment"]');
      await setDate("Completion due date");
      await submit();
      const payload = requests.at(-1)!;
      assert.equal(payload.body_text, commentText);
      assert.equal(payload.completion_due_date, "2026-09-15");
      assert.equal(payload.color, "yellow");
      assert.deepEqual(payload.source, { resource_type: resourceType, resource_id: `${resourceType}-id` });
      assert.ok(container.querySelector('[data-node-chat-message-id="comment"]')!.textContent!.includes(commentText));
      assert.equal(latestReply, "comment");
      assert.ok(latestDraft.startsWith(originalDraft), "existing unsent text is preserved");
      assert.equal(latestLinks.length, 1);
      assert.equal(sends, 0, "creating does not send a chat");
    }
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="node" />); });
    await click('[aria-label="Create yellow Action Item from comment"]');
    await setDate("Completion due date");
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="project" />); });
    await submit();
    assert.equal(requests.length, 3, "owner switch before Save creates nothing");
    assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /chat changed/);
    await click('form[role="dialog"] button[type="button"]');

    deferRequest = true;
    await click('[aria-label="Create yellow Action Item from comment"]');
    await setDate("Completion due date");
    await submit();
    assert.equal(requests.length, 4);
    await act(async () => { mounted.render(<Harness key="owner-race" resourceType="huddle_node" />); });
    await act(async () => { finishRequest!(); });
    assert.equal(dom.window.document.querySelector('form[role="dialog"]'), null, "successful creation closes Save even when reference insertion is unsafe");
    assert.equal(latestDraft, originalDraft);
    assert.equal(latestLinks.length, 0, "no reference leaks into the new owner");
    assert.equal(latestReply, "");
    assert.match(container.textContent!, /Action Item was created, but the chat changed/);

    await click('[aria-label="Create red Action Item from chat draft"]');
    await setDate("Analysis due date");
    await submit();
    const changedDraft = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Chat message"]')!;
    await act(async () => { changedDraft.value = "Changed while saving"; Simulate.change(changedDraft); });
    await act(async () => { finishRequest!(); });
    assert.equal(latestDraft, "Changed while saving", "response does not overwrite a newer draft");
    assert.equal(latestLinks.length, 0);
    assert.equal(dom.window.document.querySelector('form[role="dialog"]'), null);
    assert.equal(requests.length, 5, "successful response has no retryable Save that creates duplicates");
  } finally {
    if (root) await act(async () => root!.unmount());
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

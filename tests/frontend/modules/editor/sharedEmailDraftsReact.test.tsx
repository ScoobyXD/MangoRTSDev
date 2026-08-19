import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { EmailConversationPane, EmailMessageHeaderActionStacks, summarizeEmailReplyDrafts } from "../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx";
import type { CommunicationsEmailDraft, EmailMessage } from "../../../../frontend/src/modules/communications/communicationsApi.ts";
import { HomeMailWorkspace } from "../../../../frontend/src/pages/home/HomeMailWorkspace.tsx";
import { homeSharedMailDraftMatchesSearch, homeSharedMailDraftToMessage } from "../../../../frontend/src/pages/home/homeSharedMailDrafts.ts";
import { emptyCompose } from "../../../../frontend/src/pages/home/homeTypes.ts";
import type { AttachmentRequestJSON } from "../../../../frontend/src/modules/attachments/attachmentApi.ts";
import { resolveMangoTiptapRichClipboardImage } from "../../../../frontend/src/modules/editor/tiptap/mangoTiptapRichClipboard.ts";

type Restore = () => void;

function draft(patch: Partial<CommunicationsEmailDraft>): CommunicationsEmailDraft {
  return {
    company_id: "company-1", draft_id: "draft-1", scope_type: "personal", kind: "reply",
    source_message_id: "source-1", source_thread_id: "stored-thread-1", to_recipients: "sender@example.test",
    cc_recipients: "", bcc_recipients: "", subject: "Re: Subject", body_editor_html: "<p>Saved</p>",
    created_timestamp: "2026-08-19T00:00:00Z", updated_timestamp: "2026-08-19T00:00:00Z", ...patch,
  };
}

test("message actions and thread summaries keep exact personal and resource-shared drafts separate", () => {
  const summaries = summarizeEmailReplyDrafts([
    draft({ draft_id: "wrong-mailbox", shared_inbox_id: "inbox-a" }),
    draft({ draft_id: "my-exact", shared_inbox_id: "inbox-b" }),
    draft({ draft_id: "node-shared", scope_type: "resource_shared", shared_node_id: "node-1" }),
    draft({ draft_id: "project-shared", scope_type: "resource_shared", shared_project_id: "project-1", source_message_id: "source-2", source_thread_id: "stored-thread-2" }),
  ], {
    "source-1": { sharedInboxID: "inbox-b" },
    "source-2": { accountEmail: "owner@example.test" },
  });
  assert.equal(summaries.personal["source-1"]?.draftID, "my-exact", "another Shared Inbox on the same provider connection must not win");
  assert.equal(summaries.shared["source-1"]?.draftID, "node-shared");
  assert.equal(summaries.shared["source-2"]?.draftID, "project-shared", "Node and Project use the same summary path");
  assert.deepEqual(summaries.personalCountByThread, { "stored-thread-1": 1 });
  assert.deepEqual(summaries.sharedCountByThread, { "stored-thread-1": 1, "stored-thread-2": 1 });

  const html = renderToStaticMarkup(<EmailMessageHeaderActionStacks
    accent="#7c3aed" createTextBox={() => undefined} openTextBox={() => undefined} replyEnabled
    personalDraft sharedDraft={false} onReply={() => undefined}
  />);
  assert.ok(html.indexOf("Create New") < html.indexOf("Go to text box"));
  assert.ok(html.indexOf("My Draft") < html.indexOf("Shared Draft"));
  assert.equal((html.match(/data-email-message-personal-draft-count/g) ?? []).length, 1);
  assert.equal((html.match(/data-email-message-shared-draft-count/g) ?? []).length, 0);
});

test("Home renders four equal mailbox actions and shared summaries never hydrate body or attachments", () => {
  const summary = draft({
    draft_id: "shared-summary", scope_type: "resource_shared", shared_node_id: "node-1",
    body_editor_html: "secret body", attachments: [{
      resource_attachment_id: "link-1", attachment_id: "attachment-1",
      attachment: { attachment_id: "attachment-1", original_filename: "secret.txt", mime_type: "text/plain", byte_size: 6 },
    }],
  });
  const message = homeSharedMailDraftToMessage(summary);
  assert.equal("body" in message, false);
  assert.equal("attachments" in message, false);
  assert.equal(homeSharedMailDraftMatchesSearch(summary, "secret body"), false);
  assert.equal(message.email_message_id, "source-1");

  const noop = () => undefined;
  const html = renderToStaticMarkup(<HomeMailWorkspace {...({
    activeViewID: "my-triage", apiBase: "", accountEmail: "owner@example.test", archiveAvailable: true, archiveLabel: "Archive", busy: "",
    companyID: "company-1", entityRequestJSON: async () => ({}), attachmentRequestJSON: async () => ({}), currentUserID: "user-1",
    compose: emptyCompose, draftCount: 2, draftListKind: "personal", sharedDraftCount: 3, emailSignature: "", emailSignatureID: "",
    emailSignatureAccountEmail: "", error: "", isArchivableListView: true, isArchiveMailbox: false, listViewLabel: "My Emails",
    loadingDetail: false, loadingMessages: false, loadingMoreMessages: false, mailFilterStatus: "", mailbox: "primary", mailboxCounts: {},
    inboxCountIsMinimum: false, messageListRef: { current: null }, messages: [], messageListOrder: "newest", companyUsers: [], companyUserGroups: [],
    companyUserGroupMembers: [], nodes: [], logicGates: [], notice: "", pendingStarredMessageIDs: new Set(), searchDraft: "", selectedMessage: null,
    selectedSharedDraft: null, selectedMessageRowKey: "", selectedMessageIDs: new Set(), selectedThreadMessages: [], showDetailResizeHandle: false,
    unreadOnly: false, unreadMessageCount: 0, canAdvanceTriagePage: false, hasNextMessagePage: false, onArchiveSelected: noop,
    onAdvanceTriagePage: noop, onCancelCompose: noop, onColumnResizeStart: noop, onComposeChange: noop, onDeleteSelected: noop,
    onLoadMessageBody: async () => null, onLoadMoreMessages: noop, onPrefetchMessages: noop, onOpenAllMailbox: noop, onOpenContextMenu: noop,
    onOpenNewCompose: noop, onOpenDraftsMailbox: noop, onOpenSharedDraftsMailbox: noop, onOpenPendingMailbox: noop, onOpenReply: noop,
    onOpenReplyAll: noop, onOpenSentMailbox: noop, onOpenSpamMailbox: noop, onOpenStarredMailbox: noop, onToggleMessageListOrder: noop,
    onOpenForward: noop, onSharedDraftComplete: noop, onEmailSignatureChange: noop, onSaveEmailSignature: noop, onSaveComposeDraft: noop,
    onEnsureComposeDraft: async () => emptyCompose, onDiscardEmptyComposeDraft: noop, onSearchDraftChange: noop, onSelectMessage: noop,
    onStartMessageDrag: noop, onSubmitCompose: noop, onSubmitSearch: noop, onToggleMessageStar: noop, onToggleRead: noop, onToggleStar: noop,
    onToggleUnreadOnly: noop, onEmailCollaborationChange: noop, onEmailNodeAttachmentChange: noop, onOpenPickerEntity: noop, onOpenCollaborationNode: noop,
  } as unknown as React.ComponentProps<typeof HomeMailWorkspace>)} />);
  const labels = ["Compose", "My Drafts", "Shared Drafts", "Archive &amp; next"];
  assert.ok(labels.every((label) => html.includes(label)));
  assert.ok(labels.every((label, index) => index === 0 || html.indexOf(labels[index - 1]!) < html.indexOf(label)));
  assert.equal((html.match(/mango-mail-vibrant-action/g) ?? []).length, 4);
});

test("a linked shared attachment publishes its revision before releasing the mutation queue", async () => {
  const events: string[] = [];
  let revision = 1;
  const requestJSON = (async <T,>(_path: string, init) => {
    assert.equal((init?.json as { expected_revision?: number }).expected_revision, 1);
    return { resource_attachment: {
      resource_attachment_id: "link-1", company_id: "company-1", resource_type: "email_draft", resource_id: "draft-1",
      attachment_id: "attachment-1", relationship_kind: "inline_image", created_timestamp: "2026-08-19T00:00:00Z", resource_revision: 2,
    } } as T;
  }) as AttachmentRequestJSON;
  await resolveMangoTiptapRichClipboardImage({
    index: 0, sourceKind: "attachment", source: "", attachmentData: { attachmentID: "attachment-1", filename: "image.png" },
  }, undefined, {
    requestJSON, apiBase: "", companyID: "company-1", resourceType: "email_draft", resourceID: "draft-1",
    expectedResourceRevision: () => revision,
    onResourceRevision: (next) => { revision = next; events.push(`revision:${next}`); },
    mutationLifecycle: { begin: () => { events.push("begin"); }, finish: (succeeded) => { events.push(`finish:${succeeded}:${revision}`); } },
  });
  assert.deepEqual(events, ["begin", "revision:2", "finish:true:2"]);
});

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => descriptor
    ? Object.defineProperty(globalThis, name, descriptor)
    : delete (globalThis as Record<string, unknown>)[name]);
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

function sourceMessage(): EmailMessage {
  return {
    id: "provider-message-1", thread_id: "provider-thread-1", email_message_id: "source-1", email_thread_id: "stored-thread-1",
    from: [{ email: "sender@example.test" }], to: [{ email: "owner@example.test" }], subject: "Subject", body: "<p>Source</p>",
    date: 1_777_000_000, unread: false, starred: false, detail_fetched: true,
  };
}

async function waitFor(check: () => boolean, label: string, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (check()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  assert.fail(`Timed out waiting for ${label}`);
}

async function withSharedReplyPane(
  put: (body: Record<string, unknown>, call: number) => Promise<Response> | Response,
  run: (context: { container: HTMLElement; root: { unmount(): void }; putBodies: Record<string, unknown>[] }) => Promise<void>,
  attachmentRequestJSON?: AttachmentRequestJSON,
) {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { pretendToBeVisual: true, url: "http://localhost/" });
  const restores: Restore[] = [];
  const globals = [
    "window", "document", "navigator", "self", "localStorage", "Node", "NodeFilter", "Element", "HTMLElement", "HTMLDivElement",
    "HTMLSpanElement", "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement", "HTMLUListElement", "HTMLOListElement", "HTMLAnchorElement",
    "HTMLBRElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLTableElement", "HTMLTableRowElement", "HTMLTableCellElement",
    "DocumentFragment", "DOMParser", "DOMException", "Event", "EventTarget", "InputEvent", "MouseEvent", "KeyboardEvent", "FocusEvent",
    "MutationObserver", "Range", "Selection", "File", "FileList",
  ] as const;
  for (const name of globals) installGlobal(name, name === "window" || name === "self" ? dom.window : name === "document" ? dom.window.document : (dom.window as unknown as Record<string, unknown>)[name], restores);
  installGlobal("getComputedStyle", dom.window.getComputedStyle.bind(dom.window), restores);
  installGlobal("IS_REACT_ACT_ENVIRONMENT", true, restores);
  const requestFrame = (callback: FrameRequestCallback) => setTimeout(() => callback(Date.now()), 0) as unknown as number;
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window), restores);
  class Observer { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  installGlobal("ResizeObserver", Observer, restores);
  installGlobal("IntersectionObserver", Observer, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: Observer });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: Observer });
  Object.defineProperty(dom.window.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", { configurable: true, value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => undefined });
  Object.defineProperty(dom.window.HTMLElement.prototype, "animate", { configurable: true, value: () => undefined });
  const legacy = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
  legacy.attachEvent ??= () => undefined;
  legacy.detachEvent ??= () => undefined;
  const putBodies: Record<string, unknown>[] = [];
  installGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input.toString();
    if (url.includes("/v1/nodes/node-1/email-threads/stored-thread-1")) return response({
      thread_id: "provider-thread-1", email_thread_id: "stored-thread-1", download_status: "complete", history_complete: true, messages: [sourceMessage()],
    });
    if (url.includes("/v1/communications/drafts/shared-draft-1") && (init?.method ?? "GET") === "GET") return response({
      draft: draft({
        draft_id: "shared-draft-1", scope_type: "resource_shared", shared_node_id: "node-1", revision: 1, can_send: false,
        attachments: attachmentRequestJSON ? ["one", "two"].map((name) => ({
          resource_attachment_id: `link-${name}`, attachment_id: `attachment-${name}`,
          attachment: { attachment_id: `attachment-${name}`, original_filename: `${name}.txt`, mime_type: "text/plain", byte_size: 3 },
        })) : undefined,
      }),
    });
    if (url.includes("/v1/communications/drafts/shared-draft-1") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      putBodies.push(body);
      return put(body, putBodies.length);
    }
    throw new Error(`Unexpected fetch ${init?.method ?? "GET"} ${url}`);
  }, restores);
  const container = dom.window.document.getElementById("root") as HTMLElement;
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EmailConversationPane
      messageID="provider-message-1" repliesEnabled emailMessageID="source-1" emailThreadID="stored-thread-1" nodeID="node-1"
      companyID="company-1" currentUserID="user-1" editable accent="#7c3aed" surfaceText="#172033" strokeColor="#cbd5e1" ruleColor="#e2e8f0"
      attachmentRequestJSON={attachmentRequestJSON}
      initialReplySourceMessageID="source-1" initialReplyMode="shared" initialReplyRequestID={1} singleMessageOnly
      sharedReplyDraftIndicatorBySourceMessageID={{ "source-1": { draftID: "shared-draft-1", sourceThreadID: "stored-thread-1" } }} onError={() => undefined}
    />));
    await waitFor(() => Boolean(container.querySelector('[aria-label="Reply body"]')), "shared reply editor");
    await run({ container, root, putBodies });
  } finally {
    try { await act(async () => root.unmount()); } catch { /* already unmounted */ }
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
}

test("a shared 409 shows one conflict and never starts an automatic retry loop", { timeout: 10_000 }, async () => {
  await withSharedReplyPane(() => response({ error: "email_draft_revision_conflict" }, 409), async ({ container, putBodies }) => {
    const editor = container.querySelector<HTMLElement>('[aria-label="Reply body"]');
    assert.ok(editor);
    await act(async () => { editor.innerHTML = "<p>conflicting edit</p>"; Simulate.input(editor); });
    await waitFor(() => putBodies.length === 1, "first autosave");
    await waitFor(() => container.textContent?.includes("Changed elsewhere — reopen to continue") === true, "conflict status");
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 800)); });
    assert.equal(putBodies.length, 1);
  });
});

test("pending shared save advances its live revision before unmount flush preserves the last typing", { timeout: 10_000 }, async () => {
  let releaseFirst!: (value: Response) => void;
  const first = new Promise<Response>((resolve) => { releaseFirst = resolve; });
  await withSharedReplyPane((body, call) => call === 1 ? first : response({
    draft: draft({ ...body, draft_id: "shared-draft-1", scope_type: "resource_shared", shared_node_id: "node-1", revision: 3, can_send: false }),
  }), async ({ container, root, putBodies }) => {
    const editor = container.querySelector<HTMLElement>('[aria-label="Reply body"]');
    assert.ok(editor);
    await act(async () => { editor.innerHTML = "<p>first edit</p>"; Simulate.input(editor); });
    await waitFor(() => putBodies.length === 1, "pending autosave");
    await act(async () => {
      editor.innerHTML = "<p>first edit plus final typing</p>";
      Simulate.input(editor);
      root.unmount();
    });
    releaseFirst(response({ draft: draft({ ...putBodies[0], draft_id: "shared-draft-1", scope_type: "resource_shared", shared_node_id: "node-1", revision: 2, can_send: false }) }));
    await waitFor(() => putBodies.length === 2, "final unmount save");
    assert.equal(putBodies[0]?.expected_revision, 1);
    assert.equal(putBodies[1]?.expected_revision, 2);
    assert.match(String(putBodies[1]?.body_editor_html), /final typing/);
  });
});

test("shared attachment deletes serialize revisions and unmount waits before saving final typing", { timeout: 10_000 }, async () => {
  let releaseFirstDelete!: (value: { status: string; resource_revision: number }) => void;
  const firstDelete = new Promise<{ status: string; resource_revision: number }>((resolve) => { releaseFirstDelete = resolve; });
  const deletePaths: string[] = [];
  const requestJSON = (async <T,>(path: string) => {
    deletePaths.push(path);
    return (deletePaths.length === 1 ? firstDelete : { status: "deleted", resource_revision: 3 }) as Promise<T> | T;
  }) as AttachmentRequestJSON;
  await withSharedReplyPane((body) => response({
    draft: draft({ ...body, draft_id: "shared-draft-1", scope_type: "resource_shared", shared_node_id: "node-1", revision: 4, can_send: false }),
  }), async ({ container, root, putBodies }) => {
    const removeButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Remove "]'));
    assert.equal(removeButtons.length, 2);
    await act(async () => {
      Simulate.click(removeButtons[0]!);
      Simulate.click(removeButtons[1]!);
    });
    await waitFor(() => deletePaths.length === 1, "first attachment delete");
    assert.match(deletePaths[0]!, /expected_revision=1/);
    const editor = container.querySelector<HTMLElement>('[aria-label="Reply body"]');
    assert.ok(editor);
    await act(async () => {
      editor.innerHTML = "<p>typing while attachment finishes</p>";
      Simulate.input(editor);
      root.unmount();
    });
    assert.equal(putBodies.length, 0, "unmount save must wait for the attachment revision");
    releaseFirstDelete({ status: "deleted", resource_revision: 2 });
    await waitFor(() => deletePaths.length === 2, "second serialized attachment delete");
    assert.match(deletePaths[1]!, /expected_revision=2/);
    await waitFor(() => putBodies.length === 1, "post-attachment unmount save");
    assert.equal(putBodies[0]?.expected_revision, 3);
    assert.match(String(putBodies[0]?.body_editor_html), /typing while attachment finishes/);
  }, requestJSON);
});

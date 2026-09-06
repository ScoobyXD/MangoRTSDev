import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";
import type { CurrentUserResponse } from "../../../../frontend/src/auth/cognitoAuth.js";

const companyID = "mailbox-policy-company";
const noop = () => undefined;

function currentUser(mailboxEnabled: boolean): CurrentUserResponse {
  return {
    user: { user_id: "mailbox-policy-user", cognito_subject: "mailbox-policy-subject", email: "person@example.com", display_name: "Person", mailbox_enabled: mailboxEnabled, created_timestamp: "2026-09-01", updated_timestamp: "2026-09-01" },
    memberships: [{ company_id: companyID, company_name: "Example", user_id: "mailbox-policy-user", role: "company_admin", created_timestamp: "2026-09-01", updated_timestamp: "2026-09-01" }],
    is_dev_admin: false,
  };
}

test("mailbox availability separates company work from legacy email surfaces", { timeout: 30_000 }, async (t) => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
  const restores: Array<() => void> = [];
  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete (globalThis as Record<string, unknown>)[name]);
  };
  for (const name of ["window", "document", "navigator", "localStorage", "sessionStorage", "Node", "NodeFilter", "Element", "HTMLElement", "HTMLInputElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLSelectElement", "DOMParser", "MutationObserver", "Event", "EventTarget", "CustomEvent", "MouseEvent", "KeyboardEvent", "DOMException", "DocumentFragment", "Range"]) {
    install(name, name === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[name]);
  }
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
  install("ResizeObserver", ResizeObserverStub);
  Object.defineProperty(dom.window, "ResizeObserver", { value: ResizeObserverStub, configurable: true });
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }), configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "scrollTo", { value: noop, configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "attachEvent", { value: noop, configurable: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "detachEvent", { value: noop, configurable: true });

  let me = currentUser(false);
  let mailboxConnected = false;
  const requests: string[] = [];
  install("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    requests.push(url.pathname);
    const payload = url.pathname === "/v1/me" ? me
      : url.pathname === "/v1/communications/status" ? { configured: true, connected: mailboxConnected, status: mailboxConnected ? "connected" : "disconnected", ...(mailboxConnected ? { connection: { account_email: "existing@example.com", provider: "google", scope: "personal", status: "connected" } } : {}) }
      : { users: [], groups: [], members: [], accounts: [], folders: [], pins: [], nodes: [], logic_gates: [], notifications: [], items: [], sections: [], saved_views: [], shared_inboxes: [], messages: [], drafts: [], entities: [], huddle_logic_gates: [], huddle_folders: [], type_counts: [], total_unread: 0 };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  dom.window.fetch = globalThis.fetch;
  sessionStorage.setItem("mangorts:active-company-id-v1", companyID);
  const container = document.getElementById("root")!;
  let root: Root | null = null;
  const { createRoot } = await import("react-dom/client");
  const { AppSidebar } = await import("../../../../frontend/src/app/AppSidebarChrome.js");
  const { HomePage } = await import("../../../../frontend/src/pages/home/HomePage.js");
  const { UniversalEntityPicker } = await import("../../../../frontend/src/modules/editor/UniversalEntityPicker.js");
  const { logout, resetTerminalAuthFailure, isAuthEnabled } = await import("../../../../frontend/src/auth/cognitoAuth.js");
  const { invalidateCommunicationsCache, EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED } = await import("../../../../frontend/src/modules/communications/communicationsApi.js");
  assert.equal(isAuthEnabled(), true, "the browser policy harness must exercise authenticated mode");
  const flush = async () => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); };
  const mount = async (element: React.ReactElement) => {
    root = createRoot(container);
    await act(async () => { root!.render(element); });
    await flush();
  };
  const unmount = async () => {
    if (root) await act(async () => { root!.unmount(); });
    root = null;
    localStorage.clear();
    logout();
    resetTerminalAuthFailure();
    invalidateCommunicationsCache();
    requests.length = 0;
  };
  const mailboxRequests = () => requests.filter((path) => /^\/v1\/communications\//.test(path));
  const sidebar = (mailboxEnabled: boolean) => <AppSidebar mailboxEnabled={mailboxEnabled} activePage="my-work" activeHomeView="updates" currentUserID={me.user.user_id} pinTree={{ folders: [], pins: [] }} pinDropActive={false} explorerSelectionTargetFrameIDs={[]} onHomeViewSelect={noop} onPageSelect={noop} onPinOpen={noop} onPinOpenInNewTab={noop} onPinRemove={noop} onPinCreateFolder={async () => null} onPinRenameFolder={async () => {}} onPinDeleteFolder={async () => {}} onPinMoveEntry={noop} onPinGroup={async () => null} onPinExternalDrop={noop} onPinDragEnter={noop} onPinDragLeave={noop} />;
  try {
    await t.test("disabled mailbox hides navigation and ignores shared-mail refresh", async () => {
      await mount(sidebar(false));
      assert.doesNotMatch(container.textContent ?? "", /My Emails|Shared Emails/);
      await act(async () => { window.dispatchEvent(new CustomEvent(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, { detail: { companyID } })); });
      await flush();
      assert.deepEqual(mailboxRequests(), []);
      await unmount();
    });
    await t.test("existing mailbox sidebar loads only an opened shared section", async () => {
      await mount(sidebar(true));
      assert.match(container.textContent ?? "", /My Emails/);
      assert.deepEqual(mailboxRequests(), []);
      const disclosure = container.querySelector<HTMLButtonElement>('button[aria-label="Expand Shared Emails folders"]');
      assert.ok(disclosure);
      await act(async () => { disclosure.click(); });
      await flush();
      assert.ok(requests.includes("/v1/communications/shared-inboxes"));
      assert.ok(!requests.includes("/v1/communications/status"), "opening the list does not need the personal account suggestion");
      const sharedLabel = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "Shared Emails");
      assert.ok(sharedLabel);
      await act(async () => { sharedLabel.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 })); });
      await flush();
      assert.ok(requests.includes("/v1/communications/status"), "the create/change-email context menu retains its on-demand lookup");
      await unmount();
    });
    await t.test("Updates and RACI render without mailbox configuration or calls", async () => {
      for (const enabled of [false, true]) {
        me = currentUser(enabled);
        for (const view of ["updates", "r-inbox"] as const) {
          await mount(<HomePage me={me} initialViewID={view} embedded ownsEmailReferencePreview={false} />);
          assert.doesNotMatch(container.textContent ?? "", /Loading email connection|Email is not configured|Connect your company email/);
          assert.deepEqual(mailboxRequests(), [], `${view} must not load mailbox data`);
          assert.ok(requests.some((path) => path.endsWith("/users")), "company users still load for ordinary work");
          await unmount();
        }
      }
    });
    await t.test("disabled direct email view stays in company work; old personal email still connects", async () => {
      me = currentUser(false);
      const draftKey = `mangorts.home.mailDrafts.v1:${companyID}:${me.user.user_id}`;
      const savedDraft = JSON.stringify([{ id: "retained-draft", kind: "new", userID: me.user.user_id, companyID, sharedInboxID: "", accountEmail: "existing@example.com", sourceMessageID: "", replyToMessageID: "", to: "recipient@example.com", cc: "", bcc: "", subject: "Keep this draft", body: "Unsynchronized content", attachments: [], scheduledAt: new Date(Date.now() - 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), pendingRemoteSync: true }]);
      localStorage.setItem(draftKey, savedDraft);
      await mount(<HomePage me={me} initialViewID="my-triage" embedded ownsEmailReferencePreview={false} />);
      assert.doesNotMatch(container.textContent ?? "", /Connect your company email|Loading email connection/);
      assert.deepEqual(mailboxRequests(), []);
      assert.equal(localStorage.getItem(draftKey), savedDraft, "disabled mailbox retains its local draft without loading, syncing, or sending it");
      await unmount();
      me = currentUser(true);
      await mount(<HomePage me={me} initialViewID="my-triage" embedded ownsEmailReferencePreview={false} />);
      assert.ok(requests.includes("/v1/communications/status"));
      assert.match(container.textContent ?? "", /Connect your company email/);
      await unmount();
    });
    await t.test("connected personal email still loads, and leaving it stops mailbox refresh", async () => {
      me = currentUser(true);
      mailboxConnected = true;
      await mount(<HomePage me={me} initialViewID="my-triage" embedded ownsEmailReferencePreview={false} />);
      assert.ok(requests.includes("/v1/communications/folders"));
      assert.ok(requests.includes("/v1/communications/messages"));
      await act(async () => { root!.render(<HomePage me={me} initialViewID="updates" embedded ownsEmailReferencePreview={false} />); });
      await flush();
      requests.length = 0;
      await act(async () => { window.dispatchEvent(new CustomEvent(EVENT_COMMUNICATIONS_SHARED_INBOXES_UPDATED, { detail: { companyID } })); });
      await flush();
      assert.deepEqual(mailboxRequests(), []);
      await unmount();
      mailboxConnected = false;
    });
    await t.test("picker checks account policy before exposing or loading Emails", async () => {
      for (const enabled of [false, true]) {
        me = currentUser(enabled);
        await mount(<UniversalEntityPicker companyID={companyID} requestJSON={async () => ({ folders: [], pins: [] }) as never} linkTargetTypes={["node", "logic_gate", "project", "email_message"]} initialCategory={enabled ? "all" : "email_message"} anchor={{ left: 10, top: 10 }} onCancel={noop} />);
        const emailOption = Array.from(container.ownerDocument.querySelectorAll("button")).find((button) => button.textContent === "Emails");
        assert.equal(Boolean(emailOption), enabled);
        assert.equal(requests.includes("/v1/communications/status"), enabled);
        if (!enabled) assert.deepEqual(mailboxRequests(), []);
        await unmount();
      }
    });
  } finally {
    await unmount();
    dom.window.close();
    for (const restore of restores.reverse()) restore();
  }
});

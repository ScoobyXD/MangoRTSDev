import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Window } from "happy-dom";
import { parseCtrlLoopEmailRoute, ctrlLoopEmailTargetFromLink } from "../../../../frontend/src/modules/ctrl-loop/ctrlLoopEmailRoute.js";
import { canUseAuthReturnPath, nextPathAfterAuthentication } from "../../../../frontend/src/auth/authRoutes.js";

const companyID = "11111111-1111-4111-8111-111111111111";
const emailThreadID = "22222222-2222-4222-8222-222222222222";
const emailMessageID = "33333333-3333-4333-8333-333333333333";
const path = `/ctrl-loop/email/${companyID}/${emailThreadID}/${emailMessageID}`;
const target = { companyID, emailThreadID, emailMessageID };

test("source routes preserve all identities through authentication and intercept only exact same-origin links", async () => {
  assert.deepEqual(parseCtrlLoopEmailRoute(path), target);
  assert.equal(nextPathAfterAuthentication("/login", path), path);
  for (const invalid of [path + "/extra", path + "?company_id=other", path.replace(emailMessageID, "provider-id"), path.replace(emailThreadID, "%2e%2e"), path.replace(companyID, "other-company")]) assert.equal(parseCtrlLoopEmailRoute(invalid), null);
  assert.deepEqual(ctrlLoopEmailTargetFromLink(`https://app.mango.test${path}`, "https://app.mango.test"), target);
  for (const url of [`https://evil.test${path}`, `https://app.mango.test.evil.test${path}`, `https://name@app.mango.test${path}`, `https://app.mango.test${path}?lookup=other`, `https://app.mango.test${path}#other`, "https://outlook.office.com/mail/id/provider-id"]) assert.equal(ctrlLoopEmailTargetFromLink(url, "https://app.mango.test"), null);
});

test("source preview loads one exact stored message, metadata and safe body without provider reconstruction or mutation controls", async () => {
  const browser = new Window({ url: `http://localhost:5173${path}` });
  browser.document.title = "Mango";
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "Node", "Element", "HTMLElement", "HTMLIFrameElement", "HTMLAnchorElement", "HTMLImageElement", "MutationObserver", "DOMParser", "XMLSerializer", "Event", "MouseEvent", "Range", "Selection"] as const) install(key, key === "window" ? browser : (browser as unknown as Record<string, unknown>)[key]);
  install("getComputedStyle", browser.getComputedStyle.bind(browser));
  install("requestAnimationFrame", browser.requestAnimationFrame.bind(browser));
  install("cancelAnimationFrame", browser.cancelAnimationFrame.bind(browser));
  install("IS_REACT_ACT_ENVIRONMENT", true);
  class ResizeObserver { observe() {} unobserve() {} disconnect() {} }
  install("ResizeObserver", ResizeObserver);
  const calls: { url: URL; method: string }[] = [];
  let responseStatus = 200;
  let wrongMessage = false;
  let delay = false;
  let pendingSignal: AbortSignal | null = null;
  install("fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input); calls.push({ url, method: init.method ?? "GET" });
    if (!url.pathname.startsWith("/v1/ctrl-loop/emails/")) throw new Error(`Unexpected reconstruction request: ${url.pathname}`);
    if (delay) {
      pendingSignal = init.signal ?? null;
      return new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }));
    }
    return new Response(JSON.stringify(responseStatus === 200 ? {
      account_email: "buyer@example.com",
      message: {
        id: "provider-selected", email_message_id: wrongMessage ? "other-message" : emailMessageID, email_thread_id: emailThreadID,
        subject: "PO 123 shipped", body: '<p>Only the selected shipment confirmation.</p><script>steal()</script><img src="cid:provider-only" onerror="steal()">',
        date: 1789335060, unread: true, starred: false,
        from: [{ name: "Factory Team", email: "factory@example.com" }], to: [{ email: "buyer@example.com" }], cc: [{ email: "shipping@example.com" }],
        local_replies: [{ id: "other-reply", subject: "Do not show other mail", body: "Other thread message", unread: false, starred: false }],
        attachments: [
          { id: "provider-only", filename: "provider-only.png", content_id: "provider-only", content_type: "image/png", is_inline: true },
          { id: "calendar-provider", attachment_id: "44444444-4444-4444-8444-444444444444", filename: "invite.ics", content_type: "text/calendar" },
        ],
      },
    } : { error: "source_unavailable" }), { status: responseStatus, headers: { "Content-Type": "application/json" } });
  });
  const { createRoot } = await import("react-dom/client");
  const { CtrlLoopEmailRoute, CtrlLoopEmailPreview } = await import("../../../../frontend/src/pages/ctrl-loop/CtrlLoopEmailPreview.js");
  const { CtrlLoopEmailLink } = await import("../../../../frontend/src/pages/ctrl-loop/CtrlLoopEmailLink.js");
  const container = document.createElement("div"); document.body.appendChild(container);
  const root = createRoot(container);
  let closed = false;
  try {
    assert.equal(canUseAuthReturnPath(path), true);
    assert.equal(canUseAuthReturnPath("/ctrl-loop/email/wrong/source/id"), false);
    browser.localStorage.setItem("mangorts:active-company-id", "different-company");
    await act(async () => { root.render(<CtrlLoopEmailRoute target={target} onClose={() => { closed = true; }} />); });
    assert.equal(document.title, "Source email · [CTRL] Loop");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, `/v1/ctrl-loop/emails/${emailThreadID}/${emailMessageID}`);
    assert.equal(calls[0].url.searchParams.get("company_id"), companyID, "source company is independent of active company");
    assert.equal(document.querySelectorAll("[data-email-message-id]").length, 1);
    assert.equal(document.querySelector("[data-email-message-id]")?.getAttribute("data-email-message-id"), "provider-selected");
    assert.equal(document.querySelector("[data-email-conversation-count]")?.getAttribute("data-email-conversation-count"), "1");
    assert.ok(document.body.textContent?.includes("Factory Team"));
    assert.ok(document.body.textContent?.includes("factory@example.com"));
    assert.ok(document.body.textContent?.includes("buyer@example.com"));
    assert.ok(document.body.textContent?.includes("shipping@example.com"));
    assert.match(document.body.textContent ?? "", /9\/13\/26|Sep 13/, "arrival timestamp is visible");
    assert.ok(!document.body.textContent?.includes("Other thread message"));
    assert.ok(!document.body.textContent?.includes("provider-only.png"));
    assert.ok(document.body.textContent?.includes("invite.ics"));
    for (const action of ["Reply", "Reply all", "Forward", "Archive", "Delete", "Accept", "Tentative", "Decline"]) assert.equal(Array.from(document.querySelectorAll("button")).find((button) => button.textContent === action), undefined);
    const frame = document.querySelector("iframe")!;
    assert.ok(frame.srcdoc.includes("Only the selected shipment confirmation."));
    assert.ok(!frame.srcdoc.includes("<script"));
    assert.ok(!frame.srcdoc.includes("onerror"));
    assert.ok(!frame.getAttribute("sandbox")?.includes("allow-scripts"));
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Close email preview"]')!.click(); });
    assert.equal(closed, true);

    for (const status of [403, 404]) {
      responseStatus = status;
      await act(async () => { root.render(<CtrlLoopEmailPreview key={status} target={target} onClose={() => undefined} />); });
      assert.ok(document.body.textContent?.includes("unavailable or you do not have access"));
      assert.equal(document.querySelector("[data-email-message-id]"), null);
    }
    responseStatus = 200; wrongMessage = true;
    await act(async () => { root.render(<CtrlLoopEmailPreview key="wrong" target={target} onClose={() => undefined} />); });
    assert.ok(document.body.textContent?.includes("This source email is unavailable."));
    assert.equal(document.querySelector("[data-email-message-id]"), null);

    let opened: unknown = null;
    await act(async () => { root.render(<div>
      <CtrlLoopEmailLink href={`http://localhost:5173${path}`} onOpenEmail={(next) => { opened = next; }}>Internal</CtrlLoopEmailLink>
      <CtrlLoopEmailLink href="https://outlook.office.com/mail/id/source" onOpenEmail={(next) => { opened = next; }}>Provider</CtrlLoopEmailLink>
    </div>); });
    const links = document.querySelectorAll("a");
    const click = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { links[0].dispatchEvent(click); });
    assert.equal(click.defaultPrevented, true);
    assert.deepEqual(opened, target);
    opened = null;
    const providerClick = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => { links[1].dispatchEvent(providerClick); });
    assert.equal(providerClick.defaultPrevented, false);
    assert.equal(opened, null);
    assert.equal(links[1].target, "_blank");
    const modifiedClick = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ctrlKey: true });
    await act(async () => { links[0].dispatchEvent(modifiedClick); });
    assert.equal(modifiedClick.defaultPrevented, false);
    assert.equal(opened, null);

    delay = true;
    browser.history.replaceState({}, "", "/ctrl-loop");
    await act(async () => { root.render(<CtrlLoopEmailPreview key="pending" target={target} onClose={() => undefined} />); });
    assert.equal(browser.location.pathname, path, "in-place popup preserves the exact source for refresh and sign-in");
    assert.ok(document.body.textContent?.includes("Loading source email"));
    await act(async () => { root.render(<div>Another company</div>); });
    assert.equal(browser.location.pathname, "/ctrl-loop", "closing the popup restores the table route");
    assert.ok((pendingSignal as unknown as AbortSignal).aborted);
    assert.ok(calls.every((call) => call.method === "GET"));
  } finally {
    await act(async () => { root.unmount(); });
    originals.forEach((descriptor, key) => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); });
    await browser.happyDOM.close();
  }
});

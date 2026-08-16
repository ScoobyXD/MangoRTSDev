import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { ComposeState } from "../../../../frontend/src/pages/home/homeTypes.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

test("compose sends and saves valid external recipients without requiring a Mango directory match", { timeout: 15_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "localStorage", "Node", "Element", "HTMLElement",
    "HTMLDivElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "Event", "EventTarget",
    "InputEvent", "MouseEvent", "KeyboardEvent", "FocusEvent", "MutationObserver", "DOMParser", "DOMException", "File", "Blob",
    "Range", "Selection",
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
  installGlobal("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window), restores);
  installGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window), restores);
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
    const [{ createRoot }, { Simulate }, { ComposePanel }] = await Promise.all([
      import("react-dom/client"),
      import("react-dom/test-utils"),
      import("../../../../frontend/src/pages/home/HomeParts.tsx"),
    ]);
    const initialCompose: ComposeState = {
      kind: "compose",
      open: true,
      draftID: "draft-external-recipient",
      sharedInboxID: "",
      accountEmail: "sender@mango.test",
      replyToMessageID: "",
      focusRequestID: 0,
      to: "",
      cc: "",
      bcc: "",
      subject: "External recipient",
      body: "",
      attachments: [],
      scheduledAt: "",
      collaborationID: "",
      sharedDraft: false,
      draftRevision: 0,
    };
    const submissions: ComposeState[] = [];
    const saves: ComposeState[] = [];
    let replaceCompose: React.Dispatch<React.SetStateAction<ComposeState>> | null = null;

    function Harness() {
      const [compose, setCompose] = React.useState(initialCompose);
      replaceCompose = setCompose;
      return (
        <ComposePanel
          key={compose.draftID}
          compose={compose}
          busy={false}
          emailSignature=""
          emailSignatureID=""
          emailSignatureAccountEmail=""
          companyID=""
          currentUserID="user-1"
          companyUsers={[{
            company_id: "company-1",
            user_id: "directory-decoy",
            email: "literal.external@example.com.invalid",
            display_name: "Directory Decoy",
          }]}
          onChange={setCompose}
          onCancel={() => undefined}
          onSubmit={(event, submitted) => {
            event.preventDefault();
            submissions.push(submitted);
          }}
          onEmailSignatureChange={() => undefined}
          onSaveEmailSignature={() => undefined}
          onSaveDraft={(saved) => saves.push(saved)}
          onEnsureDraft={async (draft) => draft}
          onDiscardEmptyDraft={() => undefined}
        />
      );
    }

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(<Harness />));
    const replaceInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")?.set;
      assert.ok(setter);
      setter.call(input, value);
      Simulate.change(input, { target: { value } });
    };

    const toInput = container.querySelector<HTMLInputElement>('[aria-label="To recipients"]');
    const sendButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Send");
    assert.ok(toInput);
    assert.ok(sendButton);

    await act(async () => replaceInputValue(toInput, "outside.person@example.net"));
    await act(async () => sendButton.click());
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0]?.to, "outside.person@example.net");

    const removeExternal = container.querySelector<HTMLButtonElement>('[aria-label="Remove outside.person@example.net"]');
    assert.ok(removeExternal);
    await act(async () => removeExternal.click());

    await act(async () => replaceInputValue(toInput, "literal.external@example.com"));
    await act(async () => Simulate.keyDown(toInput, { key: "Enter" }));
    const removeLiteralExternal = container.querySelector<HTMLButtonElement>('[aria-label="Remove literal.external@example.com"]');
    assert.ok(removeLiteralExternal, "a complete external address wins over a fuzzy Mango directory suggestion");
    assert.equal(container.querySelector('[aria-label="Remove Directory Decoy (literal.external@example.com.invalid)"]'), null);
    await act(async () => removeLiteralExternal.click());

    await act(async () => replaceInputValue(toInput, "not-an-email"));
    await act(async () => sendButton.click());
    assert.equal(submissions.length, 1, "malformed pending text blocks submission");
    assert.equal(toInput.validationMessage, "Enter a valid email address.");

    await act(async () => replaceInputValue(toInput, ""));
    const bccInput = container.querySelector<HTMLInputElement>('[aria-label="Bcc recipients"]');
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Save to My Drafts");
    assert.ok(bccInput);
    assert.ok(saveButton);
    await act(async () => replaceInputValue(bccInput, "private.external@example.org"));
    await act(async () => saveButton.click());
    assert.equal(saves.length, 1);
    assert.equal(saves[0]?.bcc, "private.external@example.org");

    await act(async () => replaceInputValue(toInput, "blurred.external@example.com"));
    await act(async () => Simulate.blur(toInput));
    const removeBlurredExternal = container.querySelector<HTMLButtonElement>('[aria-label="Remove blurred.external@example.com"]');
    assert.ok(removeBlurredExternal, "blur commits a valid external address before quiet navigation can save");
    await act(async () => removeBlurredExternal.click());

    await act(async () => replaceInputValue(toInput, "second.external@example.com, not-an-email"));
    await act(async () => sendButton.click());
    assert.equal(submissions.length, 1, "mixed valid and malformed pending text is never partially submitted");
    assert.equal(toInput.value, "second.external@example.com, not-an-email");
    await act(async () => replaceInputValue(toInput, ""));

    await act(async () => replaceInputValue(toInput, "stale.external@example.com"));
    assert.ok(replaceCompose);
    await act(async () => replaceCompose?.({ ...initialCompose, draftID: "draft-two", subject: "Second draft" }));
    const secondDraftSend = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "Send");
    assert.ok(secondDraftSend);
    await act(async () => secondDraftSend.click());
    assert.equal(submissions.length, 2);
    assert.equal(submissions.at(-1)?.to, "", "pending text from the first draft does not leak into the next draft");
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";
import { EDITOR_NATIVE_INPUT_IDLE_BATCH_MS } from "../../../../frontend/src/modules/editor/editorInputBatch.js";

type Restore = () => void;

function installGlobal(name: string, value: unknown, restores: Restore[]) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  restores.push(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  });
}

async function flushAsyncWork() {
  await act(async () => {
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
  });
}

test("shared toolbar preserves collapsed typing formats, atomic entities, and native list range deletion", { timeout: 8_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "localStorage",
    "Node", "NodeFilter", "Element", "HTMLElement", "HTMLDivElement", "HTMLSpanElement",
    "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement", "HTMLUListElement", "HTMLOListElement",
    "HTMLAnchorElement", "HTMLBRElement", "HTMLButtonElement", "HTMLInputElement",
    "HTMLTableElement", "HTMLTableRowElement", "HTMLTableCellElement", "DocumentFragment",
    "DOMParser", "DOMException", "Event", "EventTarget", "InputEvent", "MouseEvent",
    "KeyboardEvent", "FocusEvent", "MutationObserver", "Range", "CustomEvent",
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
  installGlobal("fetch", async (input: string | URL | Request) => {
    const url = String(input);
    const payload = url.includes("/v1/communications/status")
      ? { configured: true, connected: true, status: "connected", connection: { account_email: "owner@example.com" } }
      : url.includes("/v1/communications/folders")
        ? { folders: [{ id: "inbox", name: "Inbox", system_folder: "inbox", total_count: 560 }] }
        : { messages: [] };
    return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
  }, restores);
  const legacyInputPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
  if (!legacyInputPrototype.attachEvent) legacyInputPrototype.attachEvent = () => undefined;
  if (!legacyInputPrototype.detachEvent) legacyInputPrototype.detachEvent = () => undefined;

  let frameID = 0;
  const requestFrame = () => ++frameID;
  const cancelFrame = () => undefined;
  dom.window.requestAnimationFrame = requestFrame;
  dom.window.cancelAnimationFrame = cancelFrame;
  installGlobal("requestAnimationFrame", requestFrame, restores);
  installGlobal("cancelAnimationFrame", cancelFrame, restores);

  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class TestIntersectionObserver {
    readonly root = null;
    readonly rootMargin = "800px 0px";
    readonly thresholds = [0];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  installGlobal("ResizeObserver", TestResizeObserver, restores);
  installGlobal("IntersectionObserver", TestIntersectionObserver, restores);
  Object.defineProperty(dom.window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
  Object.defineProperty(dom.window, "IntersectionObserver", { configurable: true, value: TestIntersectionObserver });
  Object.defineProperty(dom.window.Range.prototype, "getClientRects", { configurable: true, value: () => [] });
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 }],
  });
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { UnifiedRichEditorSurface }, { EditorTabBar }, { AppModalPortal }, { UniversalEntityPicker, universalPickerAllowedTypes, universalPickerShortcutCategory }, { EntityReferencePreviewHost }, { openEditorEntityLink }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/UnifiedRichEditorSurface.tsx"),
      import("../../../../frontend/src/modules/editor/EditorTabBar.tsx"),
      import("../../../../frontend/src/app/AppModalPortal.tsx"),
      import("../../../../frontend/src/modules/editor/UniversalEntityPicker.tsx"),
      import("../../../../frontend/src/modules/editor/EntityReferencePreviewHost.tsx"),
      import("../../../../frontend/src/modules/editor/editorEntityLinks.ts"),
    ]);
    const controllerRef = { current: null as any };
    const savedDocuments: string[] = [];
    const highlightApplications: Array<`#${string}` | null> = [];
    const mailEditorEntitySearchPaths: string[] = [];
    let setToolbarHighlightContext: React.Dispatch<React.SetStateAction<`#${string}` | null>> = () => undefined;
    const noop = () => undefined;
    const ToolbarHarness = () => {
      const [toolbarHighlightColor, setToolbarHighlightColor] = React.useState<`#${string}` | null>(null);
      setToolbarHighlightContext = setToolbarHighlightColor;
      return <EditorTabBar
        activeTab="format"
        outlineStyle="automatic-outline-numbering"
        accent="#7c3aed"
        outlineMenuAccent="#06b6d4"
        strokeColor="#94a3b8"
        surfaceText="#111827"
        tabBackground="#ffffff"
        tabSelectedBackground="#ecfeff"
        onSelectTab={noop}
        onAdjustSelectionFontSize={(delta) => controllerRef.current?.adjustFontSize(delta)}
        documentFontSize={14}
        onSetSelectionFontSize={(fontSize) => controllerRef.current?.applyFontSizeValue(fontSize)}
        boldActive={false}
        underlineActive={false}
        italicActive={false}
        strikethroughActive={false}
        highlightColor={toolbarHighlightColor}
        textAlignment="left"
        onToggleBold={() => controllerRef.current?.toggleInlineFormat("bold")}
        onToggleUnderline={() => controllerRef.current?.toggleInlineFormat("underline")}
        onToggleItalic={() => controllerRef.current?.toggleInlineFormat("italic")}
        onToggleStrikethrough={() => controllerRef.current?.toggleInlineFormat("strikethrough")}
        onSetSelectionHighlightColor={(color) => {
          highlightApplications.push(color);
          controllerRef.current?.applyHighlightColor(color);
          setToolbarHighlightColor(color);
        }}
        onSetTextAlignment={(alignment) => controllerRef.current?.applyTextAlignment(alignment)}
        onOutlineStyleFocus={noop}
        onOutlineStyleChange={noop}
        reserveHeaderOffset={false}
        visibleTabIDs={["format"]}
      />;
    };
    const toolbar = <ToolbarHarness />;
    const editor = (
      <UnifiedRichEditorSurface
        value="<!-- mango-editor-html-v1 -->seed"
        editable
        outlineStyle="automatic-outline-numbering"
        surfaceID="shared-triage-compose"
        ariaLabel="Email body"
        surfaceText="#111827"
        accent="#7c3aed"
        indentGuideColor="#94a3b8"
        scrollbarTrack="#e2e8f0"
        mentionUsers={[{ user_id: "ada", display_name: "Ada Lovelace", email: "ada@example.test" }]}
        entityLinkContext={{
          companyID: "company-1",
          requestJSON: async <T,>(path: string): Promise<T> => {
            mailEditorEntitySearchPaths.push(path);
            return { results: [] } as T;
          },
        }}
        formattingControllerRef={controllerRef}
        onChange={(documentValue) => savedDocuments.push(documentValue)}
        onFlush={noop}
        onFocus={noop}
        onBlur={noop}
      />
    );

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(<>{toolbar}{editor}</>));
    await flushAsyncWork();
    const editorRoot = container.querySelector<HTMLElement>('[data-mango-unified-rich-editor="shared-triage-compose"]');
    assert.ok(editorRoot);

    const rememberSelection = async () => {
      await act(async () => {
        editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
        await new Promise<void>((resolve) => dom.window.setTimeout(resolve, 0));
      });
    };
    const setTextSelection = async (text: string, start: number, end = start) => {
      const walker = dom.window.document.createTreeWalker(editorRoot, dom.window.NodeFilter.SHOW_TEXT);
      let node: Text | null = null;
      while ((node = walker.nextNode() as Text | null)) {
        const index = node.data.indexOf(text);
        if (index < 0) continue;
        const range = dom.window.document.createRange();
        range.setStart(node, index + start);
        range.setEnd(node, index + end);
        const selection = dom.window.document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        await rememberSelection();
        return;
      }
      assert.fail(`text not found: ${text}`);
    };
    const pressToolbarButton = async (label: string) => {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      assert.ok(button, label);
      await act(async () => {
        button.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0 }));
        button.click();
      });
      return button;
    };
    const dispatchTextInput = async (text: string) => {
      await act(async () => {
        const beforeInput = new dom.window.InputEvent("beforeinput", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: text,
        });
        Simulate.beforeInput(editorRoot, {
          data: text,
          inputType: "insertText",
          nativeEvent: beforeInput,
        } as never);
        if (!beforeInput.defaultPrevented) {
          const selection = dom.window.document.getSelection();
          assert.ok(selection?.rangeCount);
          const range = selection!.getRangeAt(0);
          range.deleteContents();
          const node = dom.window.document.createTextNode(text);
          range.insertNode(node);
          range.setStartAfter(node);
          range.collapse(true);
          selection!.removeAllRanges();
          selection!.addRange(range);
        }
        const input = new dom.window.InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: text,
        });
        Simulate.input(editorRoot, {
          data: text,
          inputType: "insertText",
          nativeEvent: input,
        } as never);
      });
      await flushAsyncWork();
    };

    const waitForInputBatch = async () => {
      await act(async () => {
        await new Promise<void>((resolve) => dom.window.setTimeout(resolve, EDITOR_NATIVE_INPUT_IDLE_BATCH_MS + 20));
      });
      await flushAsyncWork();
    };
    const typeText = async (text: string) => {
      await dispatchTextInput(text);
      await waitForInputBatch();
    };

    const boldButton = container.querySelector<HTMLButtonElement>('button[aria-label="Bold"]');
    assert.ok(boldButton);
    assert.equal(boldButton.style.background, "transparent");
    await act(async () => Simulate.mouseEnter(boldButton));
    assert.match(boldButton.style.background, /linear-gradient\(105deg/);
    assert.match(boldButton.style.background, /244,\s*254,\s*255/);
    assert.doesNotMatch(boldButton.style.boxShadow, /168,\s*85,\s*247/);
    await act(async () => Simulate.mouseLeave(boldButton));
    assert.equal(boldButton.style.background, "transparent");
    const fontSizeInput = container.querySelector<HTMLInputElement>('input[aria-label="Font size value"]');
    assert.ok(fontSizeInput);
    assert.equal(fontSizeInput.style.fontSize, "9px", "the literal font-size number is slightly larger while staying compact");

    editorRoot.textContent = "@Ad";
    await act(async () => editorRoot.focus());
    await setTextSelection("@Ad", 3);
    await act(async () => editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "d", bubbles: true })));
    await flushAsyncWork();
    assert.ok(container.querySelector('[role="listbox"][aria-label="Mention users"]'), "typing a mention opens the people picker");
    const acceptMention = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(acceptMention));
    assert.equal(acceptMention.defaultPrevented, true);
    const mentionEntity = editorRoot.querySelector<HTMLElement>('[data-mango-mention-user-id="ada"]');
    assert.ok(mentionEntity, "Tab accepts the recommended user as an atomic mention entity");
    assert.equal(mentionEntity.textContent, "@Ada Lovelace");

    editorRoot.textContent = "#delivery";
    await act(async () => editorRoot.focus());
    await setTextSelection("#delivery", "#delivery".length);
    await flushAsyncWork();
    assert.equal(mailEditorEntitySearchPaths.length, 1);
    const mailEditorSearchURL = new URL(mailEditorEntitySearchPaths[0], "https://mango.test");
    assert.equal(mailEditorSearchURL.pathname, "/v1/company-explorer/search");
    assert.equal(mailEditorSearchURL.searchParams.get("resource_types"), "node,logic_gate,project", "mail compose keeps Entities out of its legacy # picker");
    assert.equal(mailEditorEntitySearchPaths.some((path) => path.startsWith("/v1/entities?")), false);

    editorRoot.textContent = "selected";
    await act(async () => editorRoot.focus());
    await setTextSelection("selected", 0, "selected".length);
    await pressToolbarButton("Increase font size");
    await pressToolbarButton("Increase font size");
    assert.match(editorRoot.innerHTML, /font-size:\s*17px/i, "repeated plus clicks keep formatting the same selected text");

    editorRoot.textContent = "seed";

    await act(async () => editorRoot.focus());
    await setTextSelection("seed", 4);
    const beforeBurstSaves = savedDocuments.length;
    await dispatchTextInput("a");
    await dispatchTextInput("b");
    await dispatchTextInput("c");
    assert.equal(savedDocuments.length, beforeBurstSaves);
    await waitForInputBatch();
    assert.equal(savedDocuments.length, beforeBurstSaves + 1);
    assert.ok(savedDocuments.at(-1)?.includes("seedabc"));
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    assert.equal(editorRoot.textContent, "seed");
    await setTextSelection("seed", 4);

    for (let index = 0; index < 6; index += 1) {
      const plus = await pressToolbarButton("Increase font size");
      if (index === 2) await act(async () => plus.focus());
    }
    await act(async () => editorRoot.focus());
    assert.equal(controllerRef.current?.readFormatState()?.fontSize, 21);
    await typeText("X");
    assert.match(editorRoot.innerHTML, /font-size:\s*21px/i);
    assert.ok(savedDocuments.at(-1)?.includes("21px"));

    await pressToolbarButton("Italic");
    await act(async () => editorRoot.focus());
    await typeText("Y");
    assert.ok(Array.from(editorRoot.querySelectorAll("em")).some((element) => element.textContent?.includes("Y")));

    await pressToolbarButton("Strikethrough");
    await act(async () => editorRoot.focus());
    await typeText("Z");
    assert.ok(Array.from(editorRoot.querySelectorAll("s")).some((element) => element.textContent?.includes("Z")));

    await setTextSelection("seed", 0, 4);
    await pressToolbarButton("Choose highlight color");
    assert.equal(highlightApplications.length, 0);
    assert.ok(container.querySelector('[aria-label="Text highlight colors"]'));
    await pressToolbarButton("Orange highlight");
    assert.deepEqual(highlightApplications, ["#fed7aa"]);
    assert.equal(container.querySelector('[aria-label="Text highlight colors"]'), null);

    await setTextSelection("X", 0, 1);
    await act(async () => setToolbarHighlightContext(null));
    const activeHighlightButton = await pressToolbarButton("Apply text highlight");
    assert.deepEqual(highlightApplications, ["#fed7aa", "#fed7aa"]);
    assert.equal(container.querySelector('[aria-label="Text highlight colors"]'), null);
    await act(async () => Simulate.mouseLeave(activeHighlightButton));
    assert.equal(activeHighlightButton.getAttribute("aria-pressed"), "true");
    assert.match(activeHighlightButton.style.background, /linear-gradient\(105deg/);
    assert.match(activeHighlightButton.style.background, /224,\s*253,\s*255/);
    assert.match(activeHighlightButton.style.boxShadow, /34,\s*211,\s*238/);
    assert.doesNotMatch(activeHighlightButton.style.boxShadow, /168,\s*85,\s*247/);
    assert.ok(
      Array.from(editorRoot.querySelectorAll('[data-mango-editor-highlight="#fed7aa"]')).some((element) => element.textContent?.includes("X")),
      editorRoot.innerHTML,
    );

    await setTextSelection("X", 0, 1);
    await pressToolbarButton("Apply text highlight");
    assert.deepEqual(highlightApplications, ["#fed7aa", "#fed7aa", null]);
    assert.equal(Array.from(editorRoot.querySelectorAll('[data-mango-editor-highlight="#fed7aa"]')).some((element) => element.textContent?.includes("X")), false);

    await act(async () => setToolbarHighlightContext("#fef08a"));
    await setTextSelection("X", 0, 1);
    await pressToolbarButton("Apply text highlight");
    assert.deepEqual(highlightApplications, ["#fed7aa", "#fed7aa", null, "#fed7aa"]);
    assert.ok(Array.from(editorRoot.querySelectorAll('[data-mango-editor-highlight="#fed7aa"]')).some((element) => element.textContent?.includes("X")));

    editorRoot.innerHTML = '<span data-mango-editor-image="true" contenteditable="false"><img src="data:image/png;base64,AA==" alt=""></span><span style="font-size: 11px;">tail</span>';
    const beforeImage = dom.window.document.createRange();
    beforeImage.setStart(editorRoot, 0);
    beforeImage.collapse(true);
    await act(async () => {
      dom.window.document.getSelection()?.removeAllRanges();
      dom.window.document.getSelection()?.addRange(beforeImage);
    });
    await rememberSelection();
    await act(async () => editorRoot.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
    await act(async () => controllerRef.current?.applyFontSizeValue(18));
    assert.equal(controllerRef.current?.readFormatState()?.fontSize, 18);
    const afterImage = dom.window.document.createRange();
    afterImage.setStart(editorRoot, 1);
    afterImage.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(afterImage);
    await act(async () => editorRoot.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true })));
    assert.notEqual(controllerRef.current?.readFormatState()?.fontSize, 18);

    const mention = (id: string, label: string) => `<span data-mango-mention="true" data-mango-mention-user-id="${id}" contenteditable="false">${label}</span>`;
    editorRoot.innerHTML = `${mention("ada", "Ada")}${mention("bob", "Bob")}`;
    const firstMention = editorRoot.querySelector<HTMLElement>('[data-mango-mention-user-id="ada"]');
    assert.ok(firstMention);
    firstMention.getBoundingClientRect = () => ({ left: 20, right: 100, top: 0, bottom: 20, width: 80, height: 20, x: 20, y: 0, toJSON: () => ({}) });
    await act(async () => {
      firstMention.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, clientX: 10 }));
    });
    assert.equal(dom.window.document.getSelection()?.getRangeAt(0).startOffset, 0);

    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    assert.equal(dom.window.document.getSelection()?.getRangeAt(0).startOffset, 1);
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    });
    assert.equal(dom.window.document.getSelection()?.getRangeAt(0).startOffset, 2);
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
    });
    assert.equal(dom.window.document.getSelection()?.getRangeAt(0).startOffset, 1);

    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    assert.equal(editorRoot.querySelector('[data-mango-mention-user-id="ada"]'), null);
    assert.ok(editorRoot.querySelector('[data-mango-mention-user-id="bob"]'));
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    });
    assert.ok(editorRoot.querySelector('[data-mango-mention-user-id="ada"]'));
    assert.ok(editorRoot.querySelector('[data-mango-mention-user-id="bob"]'));

    editorRoot.innerHTML = `previous\n${mention("ada", "Ada")}`;
    const restoredMention = editorRoot.querySelector<HTMLElement>('[data-mango-mention-user-id="ada"]');
    assert.ok(restoredMention);
    const beforeMention = dom.window.document.createRange();
    beforeMention.setStartBefore(restoredMention);
    beforeMention.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(beforeMention);
    await rememberSelection();
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    assert.equal(editorRoot.textContent, "previousAda");
    assert.ok(editorRoot.querySelector('[data-mango-mention-user-id="ada"]'));

    editorRoot.innerHTML = `<div>previous</div><div>before${mention("ada", "Ada")}</div>`;
    const midLineMention = editorRoot.querySelector<HTMLElement>('[data-mango-mention-user-id="ada"]');
    assert.ok(midLineMention);
    const midLineRange = dom.window.document.createRange();
    midLineRange.setStartBefore(midLineMention);
    midLineRange.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(midLineRange);
    await rememberSelection();
    const midLineBackspace = new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(midLineBackspace));
    assert.equal(midLineBackspace.defaultPrevented, false);
    assert.equal(editorRoot.querySelectorAll("div").length, 2);
    assert.equal(midLineMention.parentElement?.textContent, "beforeAda");

    editorRoot.innerHTML = `<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">${mention("ada", "Ada")}</li></ul>`;
    const listMention = editorRoot.querySelector<HTMLElement>('[data-mango-mention-user-id="ada"]');
    assert.ok(listMention);
    const listRange = dom.window.document.createRange();
    listRange.setStartBefore(listMention);
    listRange.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(listRange);
    await rememberSelection();
    await act(async () => {
      editorRoot.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });
    assert.equal(editorRoot.querySelectorAll("li").length, 2);
    assert.ok(editorRoot.querySelector('[data-mango-mention-user-id="ada"]'));

    editorRoot.innerHTML = `<ul data-mango-editor-list="bullet">${Array.from(
      { length: 5 },
      () => '<li data-mango-editor-list-item="bullet"><br></li>',
    ).join("")}</ul><div>after</div>`;
    const emptyListItems = Array.from(editorRoot.querySelectorAll<HTMLLIElement>('li[data-mango-editor-list-item="bullet"]'));
    assert.equal(emptyListItems.length, 5);
    const emptyListSelection = dom.window.document.createRange();
    emptyListSelection.setStart(emptyListItems[0], 0);
    emptyListSelection.setEnd(emptyListItems[emptyListItems.length - 1], emptyListItems[emptyListItems.length - 1].childNodes.length);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(emptyListSelection);
    await rememberSelection();
    assert.equal(dom.window.document.getSelection()?.getRangeAt(0).collapsed, false);
    const selectedEmptyListBackspace = new dom.window.KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    await act(async () => editorRoot.dispatchEvent(selectedEmptyListBackspace));
    assert.equal(selectedEmptyListBackspace.defaultPrevented, false);
    assert.equal(editorRoot.querySelectorAll('li[data-mango-editor-list-item="bullet"]').length, 5);

    editorRoot.innerHTML = '<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">original</li></ul>';
    const originalText = editorRoot.querySelector("li")?.firstChild;
    assert.ok(originalText);
    const pasteAtStart = dom.window.document.createRange();
    pasteAtStart.setStart(originalText, 0);
    pasteAtStart.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(pasteAtStart);
    await act(async () => {
      Simulate.paste(editorRoot, {
        clipboardData: {
          items: [],
          files: [],
          getData: (type: string) => type === "text/html"
            ? '<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">pasted </li></ul>'
            : "pasted ",
        },
      } as never);
    });
    assert.equal(editorRoot.querySelectorAll("li").length, 1, "a single copied list row stays in the current row");
    assert.equal(editorRoot.querySelector("li")?.textContent, "pasted original");

    editorRoot.innerHTML = '<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">parent<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">child</li></ul></li><li data-mango-editor-list-item="bullet">after</li></ul>';
    const parentText = editorRoot.querySelector<HTMLLIElement>('li[data-mango-editor-list-item="bullet"]')?.firstChild;
    assert.ok(parentText);
    const parentEnd = dom.window.document.createRange();
    parentEnd.setStart(parentText, parentText.textContent?.length ?? 0);
    parentEnd.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(parentEnd);
    const enterWithNestedChild = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(enterWithNestedChild));
    const alphanumericRoot = editorRoot.querySelector<HTMLUListElement>('ul[data-mango-editor-list="bullet"]');
    assert.ok(alphanumericRoot);
    assert.equal(Array.from(alphanumericRoot.children).length, 3);
    assert.equal(alphanumericRoot.firstElementChild?.querySelector("ul li")?.textContent, "child", "Enter preserves the parent's nested children");

    const newRow = alphanumericRoot.children[1] as HTMLLIElement;
    const tabNewRow = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(tabNewRow));
    assert.equal(tabNewRow.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, editorRoot, "Tab keeps browser focus in the editor");
    assert.equal(alphanumericRoot.children.length, 2, "the new row indents instead of escaping the editor");
    assert.equal(alphanumericRoot.lastElementChild?.textContent, "after");
    assert.ok(alphanumericRoot.firstElementChild?.querySelector("ul")?.contains(newRow));
    assert.ok(newRow.contains(dom.window.document.getSelection()?.anchorNode ?? null), "the caret remains in the indented row");

    editorRoot.innerHTML = '<ol data-mango-editor-ordered-list="true" type="1"><li>row A</li></ol>';
    const orderedRoot = editorRoot.querySelector<HTMLOListElement>('ol[data-mango-editor-ordered-list="true"]');
    const orderedFirstText = orderedRoot?.firstElementChild?.firstChild;
    assert.ok(orderedRoot);
    assert.ok(orderedFirstText);
    const orderedEnd = dom.window.document.createRange();
    orderedEnd.setStart(orderedFirstText, orderedFirstText.textContent?.length ?? 0);
    orderedEnd.collapse(true);
    editorRoot.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(orderedEnd);
    const orderedEnter = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(orderedEnter));
    assert.equal(orderedRoot.children.length, 2, "Enter creates the next pasted ordered-list row");
    const orderedNewRow = orderedRoot.children[1] as HTMLLIElement;
    assert.ok(orderedNewRow.contains(dom.window.document.getSelection()?.anchorNode ?? null), "Enter leaves the caret in the new ordered row");
    const orderedTab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(orderedTab));
    const nestedOrdered = orderedRoot.firstElementChild?.querySelector<HTMLOListElement>('ol[data-mango-editor-ordered-list="true"]');
    assert.equal(orderedRoot.children.length, 1, "Tab indents the new ordered row, not its original parent");
    assert.ok(nestedOrdered?.contains(orderedNewRow));
    assert.ok(orderedNewRow.contains(dom.window.document.getSelection()?.anchorNode ?? null), "ordered-list indentation preserves the new-row caret");

    editorRoot.innerHTML = '<ul data-mango-editor-list="bullet"><li data-mango-editor-list-item="bullet">first</li><li data-mango-editor-list-item="bullet">second</li><li data-mango-editor-list-item="bullet">third</li></ul>';
    const secondItem = editorRoot.querySelectorAll<HTMLLIElement>("li")[1];
    const secondText = secondItem.firstChild;
    assert.ok(secondText);
    const secondStart = dom.window.document.createRange();
    secondStart.setStart(secondText, 0);
    secondStart.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(secondStart);
    const tabAtStart = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(tabAtStart));
    assert.equal(tabAtStart.defaultPrevented, true);
    assert.equal(secondItem.textContent, "second");
    assert.equal(editorRoot.querySelectorAll<HTMLLIElement>("li")[2]?.textContent, "third", "Tab never consumes the following row");
    assert.equal(dom.window.document.getSelection()?.anchorOffset, 0, "Tab preserves a beginning-of-row caret");
    editorRoot.innerHTML = "plain";
    const plainText = editorRoot.firstChild;
    assert.ok(plainText);
    const plainStart = dom.window.document.createRange();
    plainStart.setStart(plainText, 0);
    plainStart.collapse(true);
    editorRoot.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(plainStart);
    const plainTab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(plainTab));
    assert.equal(plainTab.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, editorRoot, "plain-text Tab cannot navigate focus");
    assert.match(editorRoot.textContent ?? "", /^ {5}plain$/, "plain-text Tab inserts one editor indent");

    editorRoot.innerHTML = '<table data-mango-editor-table="true"><tbody><tr><td data-mango-editor-table-cell="true">first</td><td data-mango-editor-table-cell="true">second</td></tr></tbody></table>';
    const firstCell = editorRoot.querySelector<HTMLTableCellElement>("td");
    const secondCell = editorRoot.querySelectorAll<HTMLTableCellElement>("td")[1];
    const firstCellText = firstCell?.firstChild;
    assert.ok(firstCell);
    assert.ok(secondCell);
    assert.ok(firstCellText);
    const cellStart = dom.window.document.createRange();
    cellStart.setStart(firstCellText, 0);
    cellStart.collapse(true);
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(cellStart);
    const tableTab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => editorRoot.dispatchEvent(tableTab));
    assert.equal(tableTab.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, editorRoot, "table-cell Tab cannot navigate focus");
    assert.match(firstCell.textContent ?? "", /^ {5}first$/, "table-cell Tab indents the cell text");
    assert.equal(secondCell.textContent, "second");
    assert.ok(firstCell.contains(dom.window.document.getSelection()?.anchorNode ?? null), "the caret remains in the current table cell");

    await act(async () => root.render(
      <AppModalPortal ownerDocument={dom.window.document}>
        {editor}
        <button type="button" data-testid="trapped-chat-button">Chat</button>
      </AppModalPortal>,
    ));
    await flushAsyncWork();
    const trappedEditor = dom.window.document.querySelector<HTMLElement>('[data-mango-unified-rich-editor="shared-triage-compose"]');
    const trappedChatButton = dom.window.document.querySelector<HTMLButtonElement>('[data-testid="trapped-chat-button"]');
    assert.ok(trappedEditor);
    assert.ok(trappedChatButton);

    const tabText = "     ";
    const automaticValue = `1. root\n${tabText}a. alpha\n${tabText.repeat(2)}i. one\n${tabText.repeat(2)}ii. two`;
    const automaticText = dom.window.document.createTextNode(automaticValue);
    const inlineImage = dom.window.document.createElement("span");
    inlineImage.setAttribute("data-mango-editor-image", "true");
    inlineImage.innerHTML = '<img src="data:image/png;base64,preview">';
    trappedEditor.replaceChildren(automaticText, inlineImage);
    const automaticEnd = dom.window.document.createRange();
    automaticEnd.setStart(automaticText, automaticText.data.length);
    automaticEnd.collapse(true);
    trappedEditor.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(automaticEnd);
    const trappedTab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => trappedEditor.dispatchEvent(trappedTab));
    assert.equal(trappedTab.defaultPrevented, true);
    assert.equal(dom.window.document.activeElement, trappedEditor, "the modal focus trap must not steal an editor-owned Tab");
    assert.notEqual(dom.window.document.activeElement, trappedChatButton, "Tab cannot advance focus to Chat after indenting");
    assert.equal(
      trappedEditor.textContent,
      `1. root\n${tabText}a. alpha\n${tabText.repeat(2)}i. one\n${tabText.repeat(3)}1. two`,
      "automatic numbering still advances to the next marker family",
    );
    assert.ok(trappedEditor.contains(dom.window.document.getSelection()?.anchorNode ?? null), "the caret remains in the indented automatic item");
    assert.ok(trappedEditor.querySelector('[data-mango-editor-image="true"]'), "Tab preserves unrelated inline images");

    const dashText = dom.window.document.createTextNode("-");
    trappedEditor.replaceChildren(dashText, inlineImage);
    const dashEnd = dom.window.document.createRange();
    dashEnd.setStart(dashText, 1);
    dashEnd.collapse(true);
    trappedEditor.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(dashEnd);
    const dashSpace = new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    await act(async () => trappedEditor.dispatchEvent(dashSpace));
    assert.equal(dashSpace.defaultPrevented, true, "the real Space key is consumed by the dash shortcut");
    const bulletItem = trappedEditor.querySelector<HTMLLIElement>('ul[data-mango-editor-list="bullet"] > li[data-mango-editor-list-item="bullet"]');
    assert.ok(bulletItem, "dash-space creates a structural bullet item in automatic-numbering mode");
    assert.equal(bulletItem.textContent, "");
    assert.equal(dom.window.document.activeElement, trappedEditor);
    assert.ok(bulletItem.contains(dom.window.document.getSelection()?.anchorNode ?? null), "dash-space keeps the caret in the bullet item");
    assert.ok(trappedEditor.querySelector('[data-mango-editor-image="true"]'), "dash-space preserves unrelated inline images");

    trappedEditor.innerHTML = '<table data-mango-editor-table="true"><tbody><tr><td data-mango-editor-table-cell="true">-</td></tr></tbody></table>';
    const dashCell = trappedEditor.querySelector<HTMLTableCellElement>("td");
    const dashCellText = dashCell?.firstChild;
    assert.ok(dashCell);
    assert.ok(dashCellText);
    const dashCellEnd = dom.window.document.createRange();
    dashCellEnd.setStart(dashCellText, 1);
    dashCellEnd.collapse(true);
    trappedEditor.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(dashCellEnd);
    const tableDashSpace = new dom.window.KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true });
    await act(async () => trappedEditor.dispatchEvent(tableDashSpace));
    assert.equal(tableDashSpace.defaultPrevented, true, "table-cell dash shortcuts also use the real Space key path");
    assert.ok(dashCell.querySelector('ul[data-mango-editor-list="bullet"]'), "dash-space creates a structural bullet inside a table cell");
    assert.ok(dashCell.contains(dom.window.document.getSelection()?.anchorNode ?? null));

    let pickerCancelCount = 0;
    assert.deepEqual(
      universalPickerAllowedTypes("link", ["entity", "project"], "all"),
      ["project"],
      "Entity is never a legal ## link target even if a caller supplies it",
    );
    assert.equal(universalPickerShortcutCategory("r"), null, "Entities intentionally has no single-letter shortcut");

    await act(async () => root.render(
      <AppModalPortal ownerDocument={dom.window.document}>
        <UniversalEntityPicker
          companyID="company-1"
          requestJSON={async <T,>(path: string): Promise<T> => (
            path.startsWith("/v1/entities?")
              ? { entities: [{ entity_id: "entity-1", name: "Thailand delivery", entity_type_id: "type-1", position: 1000, revision: 1, company_id: "company-1", created_timestamp: "2026-08-27T00:00:00Z" }] }
              : { user_pin_folders: [], user_pins: [] }
          ) as T}
          sourceType="node"
          linkTargetTypes={["logic_gate", "project", "email_message"]}
          initialMode="link"
          anchor={{ left: 24, top: 24 }}
          onChoose={async () => undefined}
          onCancel={() => { pickerCancelCount += 1; }}
        />
      </AppModalPortal>,
    ));
    await flushAsyncWork();
    const modalPicker = dom.window.document.querySelector<HTMLElement>('[data-mango-universal-picker="true"]');
    const activeModalLayer = dom.window.document.querySelector<HTMLElement>('[data-mango-modal-layer="true"]');
    let modalPickerInput = modalPicker?.querySelector<HTMLInputElement>('input[aria-label="Search resources to link"]');
    assert.ok(modalPicker);
    assert.ok(activeModalLayer);
    assert.ok(modalPickerInput);
    assert.equal(modalPicker.dataset.mangoUniversalPickerMode, "link");
    assert.equal(modalPicker.style.width, "460px", "the normal universal picker stays compact while keeping all five categories on one row");
    const pickerCategories = modalPicker.querySelector<HTMLElement>('[data-mango-universal-picker-categories="true"]');
    assert.ok(pickerCategories);
    assert.equal(pickerCategories.style.display, "grid");
    assert.equal(pickerCategories.style.width, "calc(100% - 28px)");
    assert.equal(pickerCategories.style.maxWidth, "430px", "equal category columns remain compact even when Email mode widens the results pane");
    assert.equal(pickerCategories.style.overflowX, "", "category tabs do not use a horizontal scrollbar");
    assert.deepEqual(
      [...pickerCategories.querySelectorAll<HTMLButtonElement>("button")].map((button) => button.textContent?.trim()),
      ["Nodes", "Processes", "Projects", "Entities", "Emails"],
      "category tabs show only their icon and name",
    );
    assert.equal(pickerCategories.querySelector("kbd"), null, "category tabs do not show shortcut instructions");
    const emailCategoryIcon = [...pickerCategories.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Emails")
      ?.querySelector("svg");
    assert.equal(emailCategoryIcon?.getAttribute("viewBox"), "0 0 16 16", "Emails uses the My Triage mail icon");
    assert.equal(modalPicker.closest('[data-mango-modal-layer="true"]'), activeModalLayer, "a Node-modal picker must portal inside its active elevated layer");
    assert.equal(dom.window.document.activeElement, modalPickerInput, "the Node-modal picker keeps focus instead of losing it to the outer modal trap");

    await act(async () => {
      modalPickerInput?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
    modalPickerInput = modalPicker.querySelector<HTMLInputElement>('input[aria-label="Search resources to reference"]');
    assert.ok(modalPickerInput);
    assert.equal(modalPicker.dataset.mangoUniversalPickerMode, "reference", "Backspace on an empty ## picker returns to # reference mode");

    const entityCategory = [...pickerCategories.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Entities");
    assert.equal(entityCategory?.disabled, false, "Entities is available in # reference mode");
    await act(async () => entityCategory?.click());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });
    const entityRow = [...modalPicker.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((button) => button.textContent?.includes("Thailand delivery"));
    assert.equal(entityCategory?.getAttribute("aria-pressed"), "true");
    assert.ok(entityRow, "the blank Entities category lists a bounded company Entity result");
    assert.equal(entityRow.querySelector("svg")?.getAttribute("viewBox"), "0 0 16 16");

    await act(async () => {
      modalPickerInput?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "#", bubbles: true, cancelable: true }));
    });
    modalPickerInput = modalPicker.querySelector<HTMLInputElement>('input[aria-label="Search resources to link"]');
    assert.ok(modalPickerInput);
    assert.equal(modalPicker.dataset.mangoUniversalPickerMode, "link", "# on an empty reference picker enters ## link mode");
    await act(async () => { Simulate.change(modalPickerInput, { target: { value: "e" } }); });
    await flushAsyncWork();
    await act(async () => { Simulate.keyDown(modalPickerInput, { key: "Tab" }); });
    await flushAsyncWork();
    const emailCategory = [...modalPicker.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Emails"));
    assert.equal(emailCategory?.getAttribute("aria-pressed"), "true", "E then Tab selects the Emails category");
    assert.ok(modalPicker.querySelector('[data-mango-universal-picker-email-pane="true"]'));
    assert.equal(modalPicker.style.width, "720px", "the Emails category expands the picker for a mailbox list");
    assert.deepEqual(
      [...modalPicker.querySelectorAll<HTMLElement>('[role="tablist"][aria-label="Email folders"] [role="tab"]')].map((tab) => tab.textContent?.replace(/\s+/g, " ").trim()),
      ["Inbox560", "Starred", "Sent➤", "All⌄"],
    );
    const pickerDismissLayer = dom.window.document.querySelector<HTMLElement>('[data-mango-universal-picker-dismiss-layer="true"]');
    assert.ok(pickerDismissLayer, "the universal picker should render an explicit outside-click dismiss layer");
    await act(async () => {
      pickerDismissLayer.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    assert.equal(pickerCancelCount, 1, "clicking outside the picker should request dismissal exactly once");

    let draggedProcessID = "";
    const dragWrites = new Map<string, string>();
    await act(async () => root.render(
      <AppModalPortal ownerDocument={dom.window.document}>
        <UniversalEntityPicker
          companyID="company-1"
          requestJSON={async <T,>(): Promise<T> => ({
            pin_folders: [],
            user_pins: [{
              pin_id: "pin-process-1",
              company_id: "company-1",
              user_id: "user-1",
              resource_type: "logic_gate",
              resource_id: "process-1",
              name: "Order review",
              position: 1000,
              created_timestamp: "2026-08-25T00:00:00Z",
            }],
          }) as T}
          sourceLabel="Process Map"
          linkTargetTypes={["logic_gate"]}
          initialMode="link"
          initialCategory="logic_gate"
          lockMode
          anchor={{ left: 24, top: 24 }}
          onEntityDragStart={(event, entity) => {
            draggedProcessID = entity.entityID;
            event.dataTransfer.effectAllowed = "copy";
            event.dataTransfer.setData("application/x-mangorts-company-explorer-row", JSON.stringify({
              kind: "logic_gate",
              label: entity.label,
              itemID: entity.entityID,
              itemType: "logic_gate",
            }));
          }}
          onCancel={() => undefined}
        />
      </AppModalPortal>,
    ));
    await flushAsyncWork();
    const dragPicker = dom.window.document.querySelector<HTMLElement>('[data-mango-universal-picker="true"]');
    const dragPickerInput = dragPicker?.querySelector<HTMLInputElement>('input[aria-label="Search Processes to drag"]');
    const dragCategories = dragPicker?.querySelector<HTMLElement>('[data-mango-universal-picker-categories="true"]');
    const processRow = [...(dragPicker?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])]
      .find((button) => button.textContent?.includes("Order review"));
    assert.ok(dragPicker);
    assert.ok(dragPickerInput);
    assert.ok(dragCategories);
    assert.ok(processRow);
    assert.equal(processRow.draggable, true, "Process Map picker rows are draggable");
    assert.deepEqual(
      [...dragCategories.querySelectorAll<HTMLButtonElement>("button")].map((button) => ({ label: button.textContent?.trim(), disabled: button.disabled })),
      [
        { label: "Nodes", disabled: true },
        { label: "Processes", disabled: false },
        { label: "Projects", disabled: true },
        { label: "Entities", disabled: true },
        { label: "Emails", disabled: true },
      ],
      "only Processes are enabled in the locked Process Map picker",
    );
    const dragStart = new dom.window.Event("dragstart", { bubbles: true, cancelable: true });
    const dragDataTransfer = {
      effectAllowed: "",
      setData: (type: string, value: string) => dragWrites.set(type, value),
    };
    Object.defineProperty(dragStart, "dataTransfer", { value: dragDataTransfer });
    await act(async () => processRow.dispatchEvent(dragStart));
    assert.equal(draggedProcessID, "process-1");
    assert.equal(dragDataTransfer.effectAllowed, "copy");
    assert.deepEqual(JSON.parse(dragWrites.get("application/x-mangorts-company-explorer-row") ?? "{}"), {
      kind: "logic_gate",
      label: "Order review",
      itemID: "process-1",
      itemType: "logic_gate",
    });
    const dragDismissLayer = dom.window.document.querySelector<HTMLElement>('[data-mango-universal-picker-dismiss-layer="true"]');
    assert.equal(dragDismissLayer?.style.pointerEvents, "none", "the transparent dismiss layer lets an active drag reach the map");
    await act(async () => processRow.click());
    assert.ok(dom.window.document.querySelector('[data-mango-universal-picker="true"]'), "clicking a drag-only row does not choose or close it");
    const enter = new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    const tab = new dom.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      dragPickerInput.dispatchEvent(enter);
      dragPickerInput.dispatchEvent(tab);
    });
    assert.equal(enter.defaultPrevented, false, "Enter does not choose a drag-only row");
    assert.equal(dragPickerInput.disabled, false, "click, Enter, and Tab do not start a drag-only selection command");
    assert.ok(dom.window.document.querySelector('[data-mango-universal-picker="true"]'), "keyboard use does not close a drag-only picker");
    await act(async () => processRow.dispatchEvent(new dom.window.Event("dragend", { bubbles: true })));
    assert.equal(dragDismissLayer?.style.pointerEvents, "auto", "normal outside-click dismissal resumes when dragging ends");

    const previewRequests: Array<{ path: string; signal?: AbortSignal | null }> = [];
    let previewShouldFail = false;
    await act(async () => root.render(
      <EntityReferencePreviewHost
        companyID="company-1"
        requestJSON={async <T,>(path: string, init): Promise<T> => {
          previewRequests.push({ path, signal: init?.signal });
          if (previewShouldFail) throw new Error("This Entity is unavailable.");
          if (path.includes("/users")) {
            return { users: [
              { company_id: "company-1", user_id: "user-creator", display_name: "Ada Creator", email: "ada@example.test" },
              { company_id: "company-1", user_id: "user-owner", display_name: "Grace Owner", email: "grace@example.test" },
            ] } as T;
          }
          return {
            entity: {
              company_id: "company-1",
              entity_id: "entity exact/id",
              entity_type_id: "type-1",
              entity_type_name: "Action Item",
              entity_folder_id: null,
              name: "Current Thailand delivery",
              position: 1000,
              revision: 1,
              created_by_user_id: "user-creator",
              created_timestamp: "2026-08-27T00:00:00Z",
              body_json: {
                format: "mango-tiptap-json",
                schema_version: 1,
                document: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Contact logistics today." }] }] },
                annotations: [],
              },
              entity_fields: [
                { company_id: "company-1", entity_field_id: "field-2", entity_id: "entity exact/id", name: "Status", field_type: "choice", config: { options: [{ key: "in_progress", label: "In progress" }] }, value: "in_progress", position: 2000, created_timestamp: "", updated_timestamp: "" },
                { company_id: "company-1", entity_field_id: "field-1", entity_id: "entity exact/id", name: "Delivered", field_type: "boolean", config: {}, value: false, position: 1000, created_timestamp: "", updated_timestamp: "" },
                { company_id: "company-1", entity_field_id: "field-3", entity_id: "entity exact/id", name: "Analysis due date", field_type: "date", config: {}, value: "2026-08-31", position: 3000, created_timestamp: "", updated_timestamp: "" },
                { company_id: "company-1", entity_field_id: "field-4", entity_id: "entity exact/id", name: "Person in charge", field_type: "person", config: {}, value: "user-owner", position: 4000, created_timestamp: "", updated_timestamp: "" },
              ],
            },
          } as T;
        }}
      />,
    ));
    await act(async () => {
      openEditorEntityLink({ entityType: "entity", entityID: "entity exact/id", label: "Saved delivery label" });
    });
    await flushAsyncWork();
    const entityPreview = dom.window.document.querySelector<HTMLElement>('[data-mango-entity-reference-preview="true"]');
    assert.ok(entityPreview, "activating an Entity chip opens the shared detail preview");
    assert.equal(entityPreview.getAttribute("aria-label"), "Action Item details: Current Thailand delivery");
    assert.match(entityPreview.textContent ?? "", /Action Item/);
    assert.match(entityPreview.textContent ?? "", /Contact logistics today\./);
    assert.match(entityPreview.textContent ?? "", /Created byAda Creator/);
    assert.match(entityPreview.textContent ?? "", /Created date08\/27\/2026/);
    assert.match(entityPreview.textContent ?? "", /DeliveredNo/);
    assert.match(entityPreview.textContent ?? "", /StatusIn progress/);
    assert.match(entityPreview.textContent ?? "", /Analysis due date08\/31\/2026/);
    assert.match(entityPreview.textContent ?? "", /Person in chargeGrace Owner/);
    assert.doesNotMatch(entityPreview.textContent ?? "", /user-(?:creator|owner)/);
    assert.equal(previewRequests.length, 2);
    const previewURL = new URL(previewRequests[0].path, "https://mango.test");
    assert.equal(previewURL.pathname, "/v1/entities/entity%20exact%2Fid");
    assert.equal(previewURL.searchParams.get("company_id"), "company-1");
    assert.ok(previewRequests[0].signal, "the exact Entity detail read is cancellable");
    assert.equal(new URL(previewRequests[1].path, "https://mango.test").pathname, "/v1/companies/company-1/users");
    assert.ok(previewRequests[1].signal, "the company-user display-name read is cancellable");
    const closeEntityPreview = entityPreview.querySelector<HTMLButtonElement>('button[aria-label="Close Action Item details"]');
    assert.ok(closeEntityPreview);
    await act(async () => closeEntityPreview.click());
    assert.equal(dom.window.document.querySelector('[data-mango-entity-reference-preview="true"]'), null);
    previewShouldFail = true;
    await act(async () => {
      openEditorEntityLink({ entityType: "entity", entityID: "deleted-entity", label: "Saved deleted label" });
    });
    await flushAsyncWork();
    const deletedEntityPreview = dom.window.document.querySelector<HTMLElement>('[data-mango-entity-reference-preview="true"]');
    assert.equal(deletedEntityPreview?.getAttribute("aria-label"), "Entity details: Saved deleted label", "an unavailable Entity keeps the durable chip label");
    assert.match(deletedEntityPreview?.querySelector('[role="alert"]')?.textContent ?? "", /This Entity is unavailable/);

    const legacyEntitySearchPaths: string[] = [];
    await act(async () => root.render(
      <UnifiedRichEditorSurface
        value="<!-- mango-editor-html-v1 -->"
        editable
        outlineStyle="automatic-outline-numbering"
        surfaceID="node-text-block"
        ariaLabel="Node body"
        surfaceText="#111827"
        accent="#0d9488"
        indentGuideColor="#94a3b8"
        entityLinkContext={{
          companyID: "company-1",
          requestJSON: async <T,>(path: string): Promise<T> => {
            legacyEntitySearchPaths.push(path);
            return (path.startsWith("/v1/entities?")
              ? { entities: [{ entity_id: "entity-legacy", name: "Thailand delivery" }] }
              : { results: [] }) as T;
          },
        }}
        onChange={noop}
      />,
    ));
    await flushAsyncWork();
    const legacyEntityEditor = dom.window.document.querySelector<HTMLElement>('[data-mango-unified-rich-editor="node-text-block"]');
    assert.ok(legacyEntityEditor);
    legacyEntityEditor.textContent = "#thai";
    const legacyEntityText = legacyEntityEditor.firstChild;
    assert.ok(legacyEntityText);
    const legacyEntityRange = dom.window.document.createRange();
    legacyEntityRange.setStart(legacyEntityText, "#thai".length);
    legacyEntityRange.collapse(true);
    legacyEntityEditor.focus();
    dom.window.document.getSelection()?.removeAllRanges();
    dom.window.document.getSelection()?.addRange(legacyEntityRange);
    await act(async () => legacyEntityEditor.dispatchEvent(new dom.window.KeyboardEvent("keyup", { key: "i", bubbles: true })));
    await flushAsyncWork();
    const legacyEntityOption = [...dom.window.document.querySelectorAll<HTMLButtonElement>('[role="listbox"][aria-label="Reference a resource"] [role="option"]')]
      .find((option) => option.textContent?.includes("Thailand delivery"));
    assert.ok(legacyEntityOption, "the legacy HTML editor searches Entities alongside its existing resource types");
    assert.equal(legacyEntitySearchPaths.some((path) => path.startsWith("/v1/entities?")), true);
    await act(async () => legacyEntityOption.click());
    const legacyEntityChip = legacyEntityEditor.querySelector<HTMLElement>('[data-mango-entity-type="entity"]');
    assert.ok(legacyEntityChip);
    assert.equal(legacyEntityChip.dataset.mangoEntityId, "entity-legacy");
    assert.equal(legacyEntityChip.dataset.mangoEntityLabel, "Thailand delivery");
    assert.equal(legacyEntityChip.textContent, "Thailand delivery");

    const emailSavedDocuments: string[] = [];
    const entityReferenceHTML = '<span data-mango-entity-link="true" data-mango-entity-type="entity" data-mango-entity-id="entity exact/id" data-mango-entity-label="Saved Entity label">Untrusted Entity text</span>';
    const projectReferenceHTML = '<span data-mango-entity-link="true" data-mango-entity-type="project" data-mango-entity-id="project-1" data-mango-entity-label="Saved Project label">Untrusted Project text</span>';
    await act(async () => root.render(
      <UnifiedRichEditorSurface
        value={`<!-- mango-editor-html-v1 -->Before ${entityReferenceHTML} ${projectReferenceHTML}`}
        editable
        outlineStyle="automatic-outline-numbering"
        surfaceID="shared-triage-compose"
        ariaLabel="Email body"
        surfaceText="#111827"
        accent="#0d9488"
        indentGuideColor="#94a3b8"
        onChange={(documentValue) => emailSavedDocuments.push(documentValue)}
      />,
    ));
    await flushAsyncWork();
    const emailEditor = dom.window.document.querySelector<HTMLElement>('[data-mango-unified-rich-editor="shared-triage-compose"]');
    assert.ok(emailEditor);
    assert.equal(emailEditor.querySelector('[data-mango-entity-type="entity"]'), null, "preloaded Entity references are plain saved-label text in email editors");
    assert.match(emailEditor.textContent ?? "", /Saved Entity label/);
    assert.equal(emailEditor.querySelector('[data-mango-entity-type="project"]')?.getAttribute("data-mango-entity-id"), "project-1", "email cleanup preserves existing non-Entity resource references");

    const moveEmailCaretToEnd = () => {
      const range = dom.window.document.createRange();
      range.selectNodeContents(emailEditor);
      range.collapse(false);
      dom.window.document.getSelection()?.removeAllRanges();
      dom.window.document.getSelection()?.addRange(range);
    };
    moveEmailCaretToEnd();
    await act(async () => {
      Simulate.paste(emailEditor, {
        clipboardData: {
          items: [],
          files: [],
          getData: (type: string) => type === "text/html" ? entityReferenceHTML + projectReferenceHTML : "Saved Entity label Saved Project label",
        },
      } as never);
    });
    assert.equal(emailEditor.querySelector('[data-mango-entity-type="entity"]'), null, "pasted Entity references are immediately downgraded");
    assert.equal(emailEditor.querySelectorAll('[data-mango-entity-type="project"]').length, 2);
    assert.doesNotMatch(emailSavedDocuments.at(-1) ?? "", /data-mango-entity-type="entity"/);
    assert.match(emailSavedDocuments.at(-1) ?? "", /data-mango-entity-type="project"/);

    moveEmailCaretToEnd();
    await act(async () => {
      Simulate.drop(emailEditor, {
        dataTransfer: {
          items: [],
          files: [],
          getData: (type: string) => type === "text/html" ? entityReferenceHTML + projectReferenceHTML : "Saved Entity label Saved Project label",
        },
      } as never);
    });
    assert.equal(emailEditor.querySelector('[data-mango-entity-type="entity"]'), null, "dropped Entity references are immediately downgraded");
    assert.equal(emailEditor.querySelectorAll('[data-mango-entity-type="project"]').length, 3);
    assert.doesNotMatch(emailSavedDocuments.at(-1) ?? "", /data-mango-entity-type="entity"/);

  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

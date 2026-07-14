import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { Simulate } from "react-dom/test-utils";
import { JSDOM } from "jsdom";

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

test("shared toolbar preserves collapsed typing formats and entities behave atomically", { timeout: 8_000 }, async () => {
  const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Restore[] = [];
  const browserGlobals = [
    "window", "document", "navigator", "self", "localStorage",
    "Node", "NodeFilter", "Element", "HTMLElement", "HTMLDivElement", "HTMLSpanElement",
    "HTMLImageElement", "HTMLTemplateElement", "HTMLLIElement", "HTMLUListElement",
    "HTMLAnchorElement", "HTMLBRElement", "HTMLButtonElement", "HTMLInputElement",
    "HTMLTableElement", "HTMLTableRowElement", "HTMLTableCellElement", "DocumentFragment",
    "DOMParser", "DOMException", "Event", "EventTarget", "InputEvent", "MouseEvent",
    "KeyboardEvent", "FocusEvent", "MutationObserver", "Range",
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
  Object.defineProperty(dom.window.Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }),
  });

  let mountedRoot: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { NodeTextBlockEditor }, { EditorTabBar }] = await Promise.all([
      import("react-dom/client"),
      import("../../../../frontend/src/modules/editor/NodeWorkspaceSurfaceParts.tsx"),
      import("../../../../frontend/src/modules/editor/EditorTabBar.tsx"),
    ]);
    const controllerRef = { current: null as any };
    const savedDocuments: string[] = [];
    const highlightApplications: Array<`#${string}` | null> = [];
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
      <NodeTextBlockEditor
        blockID="format-test"
        editable
        nodeID="node-1"
        apiBase=""
        companyID="company-1"
        currentUserID="user-1"
        companyUsers={[]}
        documentValue="<!-- mango-editor-html-v1 -->seed"
        contentChanges={[]}
        chatMessages={[]}
        activeChatAnchorMessageID=""
        chatNavigationRequest={null}
        surfaceText="#111827"
        accent="#7c3aed"
        outlineStyle="automatic-outline-numbering"
        indentGuideColor="#94a3b8"
        scrollbarTrack="#e2e8f0"
        onFocus={noop}
        onBlur={noop}
        onDocumentChange={(documentValue) => savedDocuments.push(documentValue)}
        onDocumentFlush={noop}
        onChangeSeen={noop}
        onSelectionChatRequest={noop}
        onImageChatRequest={noop}
        onImageNodeRequest={noop}
        formattingControllerRef={controllerRef}
      />
    );

    const container = dom.window.document.getElementById("root");
    assert.ok(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => root.render(<>{toolbar}{editor}</>));
    await flushAsyncWork();
    const editorRoot = container.querySelector<HTMLElement>('[data-node-text-block-id="format-test"]');
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
    const typeText = async (text: string) => {
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

    await act(async () => editorRoot.focus());
    await setTextSelection("seed", 4);
    for (let index = 0; index < 6; index += 1) {
      const plus = await pressToolbarButton("Increase font size");
      if (index === 2) await act(async () => plus.focus());
    }
    await act(async () => editorRoot.focus());
    assert.equal(controllerRef.current?.readFormatState()?.fontSize, 20);
    await typeText("X");
    assert.match(editorRoot.innerHTML, /font-size:\s*20px/i);
    assert.ok(savedDocuments.at(-1)?.includes("20px"));

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
    await pressToolbarButton("Apply text highlight");
    assert.deepEqual(highlightApplications, ["#fed7aa", "#fed7aa"]);
    assert.equal(container.querySelector('[aria-label="Text highlight colors"]'), null);
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
  } finally {
    if (mountedRoot) await act(async () => mountedRoot?.unmount());
    for (const restore of restores.reverse()) restore();
    dom.window.close();
  }
});

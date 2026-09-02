import test from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";

test("a modeless node inside a Process popup shares focus and closes before its parent", async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    pretendToBeVisual: true,
    url: "http://localhost/",
  });
  const restores: Array<() => void> = [];
  for (const [name, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Element: dom.window.Element,
    HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    restores.push(() => {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{ left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30 }],
  });
  const inputPrototype = dom.window.HTMLElement.prototype as unknown as { attachEvent?: () => void; detachEvent?: () => void };
  inputPrototype.attachEvent = () => undefined;
  inputPrototype.detachEvent = () => undefined;
  let frameID = 0;
  const frames = new Map<number, FrameRequestCallback>();
  dom.window.requestAnimationFrame = (callback) => {
    frames.set(++frameID, callback);
    return frameID;
  };
  dom.window.cancelAnimationFrame = (id) => { frames.delete(id); };
  const flushFrames = async () => {
    await act(async () => {
      const pending = Array.from(frames.values());
      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  };
  let root: { unmount(): void } | null = null;
  try {
    const [{ createRoot }, { AppModalPortal, appOverlayCanHandleEscape }] = await Promise.all([
      import("react-dom/client"),
      import("../../../frontend/src/app/AppModalPortal.tsx"),
    ]);
    const closed: string[] = [];
    function Harness() {
      const [processOpen, setProcessOpen] = React.useState(false);
      const [nodeOpen, setNodeOpen] = React.useState(false);
      const [childOpen, setChildOpen] = React.useState(false);
      const [backgroundOpen, setBackgroundOpen] = React.useState(false);
      return <>
        <button data-test="launcher" onClick={() => {
          setProcessOpen(true);
          setBackgroundOpen(true);
        }}>Open Process</button>
        {processOpen && <AppModalPortal onRequestClose={() => {
          closed.push("process");
          setProcessOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-label="Process" data-test="process">
            <button data-test="open-node" onClick={() => setNodeOpen(true)}>Open node</button>
            <input data-test="process-title" aria-label="Process title" />
            {nodeOpen && <AppModalPortal trapFocus={false} onRequestClose={() => {
              closed.push("node");
              setNodeOpen(false);
            }}>
              <div data-mango-editor-overlay-backdrop="modeless" style={{ pointerEvents: "none" }}>
                <section role="dialog" aria-modal="false" aria-label="Node" data-test="node" style={{ pointerEvents: "auto" }}>
                  <input data-test="node-title" aria-label="Node title" />
                  <button data-test="open-child" onClick={() => setChildOpen(true)}>Open node permissions</button>
                  {childOpen && <AppModalPortal onRequestClose={() => {
                    closed.push("child");
                    setChildOpen(false);
                  }}>
                    <section role="dialog" aria-modal="true" aria-label="Node permissions" data-test="child">
                      <button data-test="child-first">Choose permission group</button>
                      <button data-test="child-last">Save permissions</button>
                    </section>
                  </AppModalPortal>}
                </section>
              </div>
            </AppModalPortal>}
          </section>
        </AppModalPortal>}
        {backgroundOpen && <AppModalPortal trapFocus={false} onRequestClose={() => {
          closed.push("background");
          setBackgroundOpen(false);
        }}>
          <section role="dialog" aria-modal="false" aria-label="Unrelated node" data-test="background">
            <input data-test="background-title" aria-label="Unrelated node title" />
          </section>
        </AppModalPortal>}
      </>;
    }
    const document = dom.window.document;
    const get = (name: string) => {
      const element = document.querySelector<HTMLElement>(`[data-test="${name}"]`);
      assert.ok(element, `${name} is mounted`);
      return element;
    };
    const layerOf = (element: HTMLElement) => {
      const layer = element.closest<HTMLElement>('[data-mango-modal-layer="true"]');
      assert.ok(layer);
      return layer;
    };
    const click = async (element: HTMLElement) => {
      await act(async () => {
        element.focus();
        element.click();
      });
      await flushFrames();
    };
    const press = async (key: string, shiftKey = false) => {
      const event = new dom.window.KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
      await act(async () => { document.activeElement!.dispatchEvent(event); });
      await flushFrames();
      assert.equal(event.defaultPrevented, true, `${key} is handled by the active overlay`);
    };
    const mountedRoot = createRoot(document.getElementById("root")!);
    root = mountedRoot;
    await act(async () => mountedRoot.render(<Harness />));
    await click(get("launcher"));
    assert.equal(document.activeElement, get("open-node"), "the Process popup receives initial focus");
    await click(get("open-node"));

    const processLayer = layerOf(get("process"));
    const nodeLayer = layerOf(get("node"));
    const backgroundLayer = layerOf(get("background"));
    assert.equal(processLayer.parentElement, document.body);
    assert.equal(nodeLayer.parentElement, processLayer, "the node portal is physically inside the Process focus boundary");
    assert.equal(nodeLayer.dataset.mangoModalFocusTrap, "false", "opening a node keeps it modeless");
    assert.equal(backgroundLayer.parentElement, document.body);
    assert.equal(processLayer.contains(backgroundLayer), false);
    assert.equal(document.querySelectorAll('[data-mango-modal-layer="true"]')[2], backgroundLayer,
      "an unrelated modeless layer later in the DOM must not become active over the Process popup");

    await act(async () => get("node-title").focus());
    assert.equal(document.activeElement, get("node-title"), "the Process trap permits focus in its modeless node");
    await press("Tab", true);
    assert.equal(document.activeElement, get("process-title"), "the Process and its modeless node share one tab sequence");
    await press("Tab");
    assert.equal(document.activeElement, get("node-title"), "Tab can enter the nested node");
    await act(async () => get("background-title").focus());
    assert.equal(document.activeElement, get("open-node"), "the unrelated root modeless window is outside the active focus boundary");
    assert.equal(appOverlayCanHandleEscape(get("node")), true);
    assert.equal(appOverlayCanHandleEscape(get("process")), false);
    assert.equal(appOverlayCanHandleEscape(get("background")), false);

    await click(get("open-child"));
    const childLayer = layerOf(get("child"));
    assert.equal(childLayer.parentElement, nodeLayer, "a blocking node child remains nested in the node portal");
    assert.equal(document.activeElement?.getAttribute("data-test"), "child-first", "the blocking child receives initial focus");
    await act(async () => get("node-title").focus());
    assert.equal(document.activeElement, get("child-first"), "the child owns focus while it is open");
    await press("Tab", true);
    assert.equal(document.activeElement, get("child-last"), "Shift+Tab wraps inside the blocking child");
    await press("Tab");
    assert.equal(document.activeElement, get("child-first"), "Tab wraps inside the blocking child");
    assert.equal(appOverlayCanHandleEscape(get("child")), true);
    assert.equal(appOverlayCanHandleEscape(get("node")), false);

    await press("Escape");
    assert.deepEqual(closed, ["child"], "one Escape closes only the blocking child");
    assert.equal(childLayer.isConnected, false);
    assert.equal(nodeLayer.isConnected, true);
    assert.equal(document.activeElement, get("open-child"), "closing the child restores its node trigger");
    await press("Escape");
    assert.deepEqual(closed, ["child", "node"], "the next Escape closes the modeless node before Process");
    assert.equal(nodeLayer.isConnected, false);
    assert.equal(processLayer.isConnected, true);
    assert.equal(backgroundLayer.isConnected, true);
    await press("Escape");
    assert.deepEqual(closed, ["child", "node", "process"]);
    assert.equal(processLayer.isConnected, false);
    assert.equal(document.activeElement, get("launcher"), "closing Process restores its original trigger");
    assert.equal(backgroundLayer.isConnected, true, "the unrelated modeless window has not consumed an earlier Escape");
    await press("Escape");
    assert.deepEqual(closed, ["child", "node", "process", "background"]);

    function MixedSiblings({ insideProcess }: { insideProcess: boolean }) {
      const [frontOpen, setFrontOpen] = React.useState(true);
      const [backChildOpen, setBackChildOpen] = React.useState(true);
      const siblings = <>
        {frontOpen && <AppModalPortal onRequestClose={() => {
          closed.push("front");
          setFrontOpen(false);
        }}>
          <section role="dialog" aria-modal="true" aria-label="Front dialog" data-test="front">
            <button data-test="front-first">First control</button>
            <button data-test="front-last">Last control</button>
          </section>
        </AppModalPortal>}
        <AppModalPortal trapFocus={false} onRequestClose={() => closed.push("back")}>
          <section role="dialog" aria-modal="false" aria-label="Background node" data-test="back">
            <button data-test="back-trigger">Node control</button>
            {backChildOpen && <AppModalPortal onRequestClose={() => {
              closed.push("back-child");
              setBackChildOpen(false);
            }}>
              <section role="dialog" aria-modal="true" aria-label="Background node permissions" data-test="back-child">
                <button data-test="back-child-first">Permission control</button>
              </section>
            </AppModalPortal>}
          </section>
        </AppModalPortal>
      </>;
      return insideProcess ? <AppModalPortal onRequestClose={() => closed.push("outer-process")}>
        <section role="dialog" aria-modal="true" aria-label="Outer Process" data-test="outer-process">
          <button>Process control</button>
          {siblings}
        </section>
      </AppModalPortal> : siblings;
    }
    for (const insideProcess of [false, true]) {
      closed.length = 0;
      await act(async () => mountedRoot.render(<MixedSiblings key={String(insideProcess)} insideProcess={insideProcess} />));
      await flushFrames();
      const scope = insideProcess ? "inside Process" : "at the document root";
      const frontLayer = layerOf(get("front"));
      const backLayer = layerOf(get("back"));
      const backChildLayer = layerOf(get("back-child"));
      assert.equal(frontLayer.parentElement, backLayer.parentElement, `the competing windows are siblings ${scope}`);
      assert.equal(backChildLayer.parentElement, backLayer);
      assert.equal(document.querySelectorAll('[data-mango-modal-layer="true"]')[insideProcess ? 3 : 2], backChildLayer,
        "the background node's blocking child appears last in DOM order");
      assert.equal(document.activeElement?.getAttribute("data-test"), "front-first",
        `the blocking sibling owns initial focus despite the background node's deeper dialog ${scope}`);
      await act(async () => get("back-child-first").focus());
      assert.equal(document.activeElement?.getAttribute("data-test"), "front-first", `background descendants cannot steal focus ${scope}`);
      await press("Tab");
      assert.equal(document.activeElement?.getAttribute("data-test"), "front-last");
      await press("Tab");
      assert.equal(document.activeElement?.getAttribute("data-test"), "front-first");
      assert.equal(appOverlayCanHandleEscape(get("front")), true);
      assert.equal(appOverlayCanHandleEscape(get("back-child")), false);
      await press("Escape");
      assert.deepEqual(closed, ["front"], `Escape closes the visible blocking sibling ${scope}`);
      assert.equal(frontLayer.isConnected, false);
      assert.equal(backChildLayer.isConnected, true);
      assert.equal(appOverlayCanHandleEscape(get("back-child")), true, "the remaining node dialog becomes active after the front sibling closes");
      await press("Escape");
      assert.deepEqual(closed, ["front", "back-child"]);
    }
  } finally {
    if (root) await act(async () => root?.unmount());
    restores.reverse().forEach((restore) => restore());
    dom.window.close();
  }
});

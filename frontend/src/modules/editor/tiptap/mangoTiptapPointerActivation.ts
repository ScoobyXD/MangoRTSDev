export type MangoTiptapPointerBookmark = {
  blockID: string;
  textOffset: number;
};

export function preserveMangoTiptapCaretScroll(root: HTMLElement): void {
  const ownerWindow = root.ownerDocument.defaultView;
  if (!ownerWindow) return;
  const scrollTop = root.scrollTop;
  const scrollLeft = root.scrollLeft;
  ownerWindow.requestAnimationFrame(() => {
    if (!root.isConnected) return;
    root.scrollTop = scrollTop;
    root.scrollLeft = scrollLeft;
  });
}

type BrowserCaretPosition = {
  offsetNode: Node;
  offset: number;
};

function browserCaretPosition(ownerDocument: Document, left: number, top: number): BrowserCaretPosition | null {
  const documentWithCaret = ownerDocument as Document & {
    caretPositionFromPoint?: (x: number, y: number) => BrowserCaretPosition | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const caret = documentWithCaret.caretPositionFromPoint?.(left, top);
  if (caret) return caret;
  const range = documentWithCaret.caretRangeFromPoint?.(left, top);
  return range ? { offsetNode: range.startContainer, offset: range.startOffset } : null;
}

function closestMangoBlock(node: Node | null): HTMLElement | null {
  const ElementConstructor = node?.ownerDocument?.defaultView?.Element;
  const element = ElementConstructor && node instanceof ElementConstructor ? node as Element : node?.parentElement;
  return element?.closest<HTMLElement>("[data-mango-block-id]") ?? null;
}

export function captureMangoTiptapPointerBookmark(
  root: HTMLElement,
  eventTarget: EventTarget | null,
  coordinates: { left: number; top: number },
): MangoTiptapPointerBookmark | null {
  const caret = browserCaretPosition(root.ownerDocument, coordinates.left, coordinates.top);
  const NodeConstructor = root.ownerDocument.defaultView?.Node;
  const targetNode = NodeConstructor && eventTarget instanceof NodeConstructor ? eventTarget as Node : null;
  const block = closestMangoBlock(caret?.offsetNode ?? targetNode);
  const blockID = block?.dataset.mangoBlockId?.trim() ?? "";
  if (!block || !blockID || !root.contains(block) || !caret || !block.contains(caret.offsetNode)) return null;
  try {
    const range = root.ownerDocument.createRange();
    range.selectNodeContents(block);
    range.setEnd(caret.offsetNode, caret.offset);
    return { blockID, textOffset: range.toString().length };
  } catch {
    return null;
  }
}

export function resolveMangoTiptapPointerBookmark(
  liveEditorRoot: HTMLElement,
  bookmark: MangoTiptapPointerBookmark,
): { node: Node; offset: number } | null {
  const block = Array.from(liveEditorRoot.querySelectorAll<HTMLElement>("[data-mango-block-id]"))
    .find((candidate) => candidate.dataset.mangoBlockId?.trim() === bookmark.blockID);
  if (!block) return null;
  const showText = liveEditorRoot.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = liveEditorRoot.ownerDocument.createTreeWalker(block, showText);
  let remaining = Math.max(0, bookmark.textOffset);
  let lastText: Text | null = null;
  while (walker.nextNode()) {
    const text = walker.currentNode as Text;
    lastText = text;
    if (remaining <= text.data.length) return { node: text, offset: remaining };
    remaining -= text.data.length;
  }
  if (lastText) return { node: lastText, offset: lastText.data.length };
  return { node: block, offset: 0 };
}

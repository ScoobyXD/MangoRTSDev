import { useMemo } from "react";
import type React from "react";
import type { EditorDocumentSurfaceProps } from "./EditorDocumentSurface";
import type { EditorScrollMemory } from "./editorScroll";
import {
  EDITOR_TAB_TEXT,
  deleteEditorBackspaceText,
  insertAutomaticOutlineFirstText,
  insertEditorEnterText,
  insertEditorTabText,
  type EditorOutlineStyleID,
} from "./plainTextEditing";
import {
  getEditorLinkHrefForText,
  linkifyEditorPlainTextToHTML,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
} from "./richTextEditing";
import {
  EDITOR_DOCUMENT_MAX_FONT_SIZE_PX,
  EDITOR_DOCUMENT_MIN_FONT_SIZE_PX,
} from "./useEditorPreferences";

export type EditorDocumentSurfaceHandlers = Pick<
  EditorDocumentSurfaceProps,
  | "onBeforeInput"
  | "onPaste"
  | "onDrop"
  | "onInput"
  | "onSelect"
  | "onClick"
  | "onKeyUp"
  | "onBlur"
  | "onScroll"
  | "onWheel"
  | "onKeyDown"
>;

type UseEditorDocumentSurfaceHandlersOptions = {
  restoringScrollRef: React.MutableRefObject<boolean>;
  currentDocumentTargetKeyRef: React.MutableRefObject<string>;
  scrollMemoryRef: React.MutableRefObject<EditorScrollMemory>;
  pendingEditorFontSizeRef: React.MutableRefObject<number | null>;
  outlineStyle: EditorOutlineStyleID;
  setDocumentScrollTop: React.Dispatch<React.SetStateAction<number>>;
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
  scheduleIndentGuideUpdate: (text: string) => void;
  rememberCurrentDocumentScroll: () => void;
  flushPendingDocumentSave: (fallbackText?: string) => void;
  onSelectionFontSizeChange: (fontSize: number) => void;
};

function clampEditorFontSize(value: number): number {
  return Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, Math.round(value)));
}

const PENDING_FONT_SIZE_CANCEL_KEYS = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Backspace", "Delete", "End", "Home", "PageDown", "PageUp"]);

function rootContainsRange(root: HTMLElement, range: Range): boolean {
  const container = range.commonAncestorContainer;
  return container === root || root.contains(container);
}

function getEditorSelectionRange(root: HTMLElement): Range | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return rootContainsRange(root, range) ? range : null;
}

function getEditorSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const range = getEditorSelectionRange(root);
  if (!range) return null;
  const startRange = range.cloneRange();
  startRange.selectNodeContents(root);
  startRange.setEnd(range.startContainer, range.startOffset);
  const endRange = range.cloneRange();
  endRange.selectNodeContents(root);
  endRange.setEnd(range.endContainer, range.endOffset);
  return {
    start: startRange.toString().length,
    end: endRange.toString().length,
  };
}

function setEditorSelectionByOffsets(root: HTMLElement, start: number, end = start) {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let startNode: Text | null = null;
  let endNode: Text | null = null;
  let startNodeOffset = 0;
  let endNodeOffset = 0;

  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const nextOffset = currentOffset + node.data.length;
    if (!startNode && start <= nextOffset) {
      startNode = node;
      startNodeOffset = Math.max(0, Math.min(node.data.length, start - currentOffset));
    }
    if (!endNode && end <= nextOffset) {
      endNode = node;
      endNodeOffset = Math.max(0, Math.min(node.data.length, end - currentOffset));
      break;
    }
    currentOffset = nextOffset;
  }

  if (!startNode) {
    const textNode = doc.createTextNode("");
    root.appendChild(textNode);
    startNode = textNode;
    startNodeOffset = 0;
  }
  if (!endNode) {
    endNode = startNode;
    endNodeOffset = startNodeOffset;
  }

  const range = doc.createRange();
  range.setStart(startNode, startNodeOffset);
  range.setEnd(endNode, endNodeOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function replaceSelectionWithText(root: HTMLElement, text: string): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const node = root.ownerDocument.createTextNode(text);
  range.deleteContents();
  range.insertNode(node);
  range.setStart(node, node.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function setCollapsedSelectionInTextNode(root: HTMLElement, textNode: Text, offset: number) {
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, Math.max(0, Math.min(textNode.data.length, offset)));
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function readInlineFontSize(element: HTMLElement): number | null {
  const parsed = Number.parseFloat(element.style.fontSize.trim());
  return Number.isFinite(parsed) ? clampEditorFontSize(parsed) : null;
}

function findMatchingFontSizeSpan(root: HTMLElement, node: Node, fontSize: number): HTMLSpanElement | null {
  let current: Node | null = node.nodeType === Node.ELEMENT_NODE ? node : node.parentNode;
  const targetFontSize = clampEditorFontSize(fontSize);
  while (current && current !== root) {
    if (current instanceof HTMLSpanElement && root.contains(current) && readInlineFontSize(current) === targetFontSize) return current;
    current = current.parentNode;
  }
  return null;
}

function replaceSelectionWithHTML(root: HTMLElement, html: string): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const template = root.ownerDocument.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const lastChild = fragment.lastChild;
  range.deleteContents();
  range.insertNode(fragment);
  const lastAnchor = lastChild instanceof HTMLAnchorElement
    ? lastChild
    : (lastChild instanceof HTMLElement ? lastChild.querySelector("a[href]:last-of-type") as HTMLAnchorElement | null : null);
  if (lastAnchor?.lastChild) {
    range.setStart(lastAnchor.lastChild, lastAnchor.lastChild.textContent?.length ?? 0);
  } else if (lastChild) {
    range.setStartAfter(lastChild);
  }
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function replaceSelectionWithStyledText(root: HTMLElement, text: string, fontSize: number): boolean {
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  const nextFontSize = clampEditorFontSize(fontSize);
  if (range.collapsed && range.startContainer.nodeType === Node.TEXT_NODE) {
    const textNode = range.startContainer as Text;
    if (findMatchingFontSizeSpan(root, textNode, nextFontSize)) {
      textNode.insertData(range.startOffset, text);
      setCollapsedSelectionInTextNode(root, textNode, range.startOffset + text.length);
      return true;
    }
  }
  const span = root.ownerDocument.createElement("span");
  span.style.fontSize = `${nextFontSize}px`;
  const textNode = root.ownerDocument.createTextNode(text);
  span.appendChild(textNode);
  range.deleteContents();
  range.insertNode(span);
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function replaceDocumentWithPlainText(root: HTMLElement, text: string, selectionStart: number, selectionEnd = selectionStart) {
  root.innerHTML = linkifyEditorPlainTextToHTML(text);
  setEditorSelectionByOffsets(root, selectionStart, selectionEnd);
}

function deleteTextByOffsets(root: HTMLElement, start: number, end: number): boolean {
  if (start < 0 || end < start) return false;
  setEditorSelectionByOffsets(root, start, end);
  const range = getEditorSelectionRange(root);
  if (!range) return false;
  range.deleteContents();
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function getPreviousEditableSiblingAnchor(root: HTMLElement, node: Node): HTMLAnchorElement | null {
  let current: Node | null = node.previousSibling;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && (current.textContent ?? "").length === 0) {
      current = current.previousSibling;
      continue;
    }
    if (current instanceof HTMLAnchorElement && root.contains(current)) return current;
    return null;
  }
  return null;
}

function getCollapsedAnchorAtSelectionEnd(root: HTMLElement): HTMLAnchorElement | null {
  const range = getEditorSelectionRange(root);
  if (!range || !range.collapsed) return null;
  const container = range.startContainer.nodeType === Node.ELEMENT_NODE
    ? range.startContainer as Element
    : range.startContainer.parentElement;
  const anchor = container?.closest("a[href]") as HTMLAnchorElement | null;
  if (anchor && root.contains(anchor)) {
    const afterRange = root.ownerDocument.createRange();
    afterRange.selectNodeContents(anchor);
    try {
      afterRange.setStart(range.startContainer, range.startOffset);
    } catch {
      return null;
    }
    return afterRange.toString().length === 0 ? anchor : null;
  }

  if (range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const element = range.startContainer as Element;
    const previousChild = range.startOffset > 0 ? element.childNodes.item(range.startOffset - 1) : null;
    if (previousChild instanceof HTMLAnchorElement && root.contains(previousChild)) return previousChild;
    if (previousChild?.nodeType === Node.TEXT_NODE && (previousChild.textContent ?? "").length === 0) {
      return getPreviousEditableSiblingAnchor(root, previousChild);
    }
    if (previousChild) return null;
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset === 0) {
    return getPreviousEditableSiblingAnchor(root, range.startContainer);
  }

  return null;
}

function insertPlainTextAfterAnchor(root: HTMLElement, anchor: HTMLAnchorElement, text: string): boolean {
  const textNode = root.ownerDocument.createTextNode(text);
  anchor.after(textNode);
  const range = root.ownerDocument.createRange();
  range.setStart(textNode, textNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function appendTextToAnchorEnd(root: HTMLElement, anchor: HTMLAnchorElement, text: string): boolean {
  const currentHref = getEditorLinkHrefForText(anchor.textContent ?? "");
  const shouldSyncHrefToText = currentHref !== null && anchor.href === currentHref;
  const walker = root.ownerDocument.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
  let lastTextNode: Text | null = null;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    lastTextNode = node;
  }
  if (!lastTextNode) {
    lastTextNode = root.ownerDocument.createTextNode("");
    anchor.appendChild(lastTextNode);
  }
  lastTextNode.data += text;
  const nextHref = shouldSyncHrefToText ? getEditorLinkHrefForText(anchor.textContent ?? "") : null;
  if (nextHref) anchor.href = nextHref;

  const range = root.ownerDocument.createRange();
  range.setStart(lastTextNode, lastTextNode.data.length);
  range.collapse(true);
  const selection = root.ownerDocument.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function isHyperlinkDividerText(text: string): boolean {
  return /[ \t\r\n]/.test(text);
}

function scrollEditorToLineStart(root: HTMLElement) {
  root.scrollLeft = 0;
  window.requestAnimationFrame(() => {
    root.scrollLeft = 0;
  });
}

function commitEditorDocument(root: HTMLElement, scheduleDocumentSave: (nextText: string, immediate?: boolean) => void, scheduleIndentGuideUpdate: (text: string) => void, immediate = false) {
  const plainText = readEditorDocumentText(root);
  scheduleDocumentSave(serializeEditorDocumentHTML(root), immediate);
  scheduleIndentGuideUpdate(plainText);
}

function getFontSizeElementForNode(root: HTMLElement, node: Node | null): Element {
  if (!node) return root;
  if (node.nodeType === Node.TEXT_NODE) return node.parentElement ?? root;
  return node instanceof Element ? node : root;
}

function getRangeFontSizeElement(root: HTMLElement, range: Range): Element {
  if (range.startContainer.nodeType !== Node.ELEMENT_NODE) return getFontSizeElementForNode(root, range.startContainer);
  const element = range.startContainer as Element;
  const nextChild = element.childNodes.item(range.startOffset);
  const previousChild = range.startOffset > 0 ? element.childNodes.item(range.startOffset - 1) : null;
  return getFontSizeElementForNode(root, nextChild ?? previousChild ?? element);
}

function syncSelectionFontSize(root: HTMLElement, onSelectionFontSizeChange: (fontSize: number) => void) {
  const range = getEditorSelectionRange(root);
  if (!range) return;
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  const element = getRangeFontSizeElement(root, range);
  const parsed = Number.parseFloat(view.getComputedStyle(element).fontSize);
  if (Number.isFinite(parsed)) onSelectionFontSizeChange(clampEditorFontSize(parsed));
}

export function useEditorDocumentSurfaceHandlers({
  restoringScrollRef,
  currentDocumentTargetKeyRef,
  scrollMemoryRef,
  pendingEditorFontSizeRef,
  outlineStyle,
  setDocumentScrollTop,
  scheduleDocumentSave,
  scheduleIndentGuideUpdate,
  rememberCurrentDocumentScroll,
  flushPendingDocumentSave,
  onSelectionFontSizeChange,
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlers {
  return useMemo(() => ({
    onBeforeInput(event) {
      const inputEvent = event.nativeEvent as InputEvent;
      const pendingFontSize = pendingEditorFontSizeRef.current;
      if (
        inputEvent.inputType === "insertText" &&
        typeof inputEvent.data === "string" &&
        inputEvent.data.length > 0
      ) {
        if (pendingFontSize !== null) {
          event.preventDefault();
          if (replaceSelectionWithStyledText(event.currentTarget, inputEvent.data, pendingFontSize)) {
            onSelectionFontSizeChange(pendingFontSize);
            commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }

        if (outlineStyle === "automatic-outline-numbering") {
          const offsets = getEditorSelectionOffsets(event.currentTarget);
          const currentText = offsets ? readEditorDocumentText(event.currentTarget) : "";
          const edit = offsets
            ? insertAutomaticOutlineFirstText(currentText, offsets.start, offsets.end, inputEvent.data)
            : null;
          if (edit) {
            event.preventDefault();
            pendingEditorFontSizeRef.current = null;
            replaceDocumentWithPlainText(event.currentTarget, edit.value, edit.selectionStart, edit.selectionEnd);
            commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
            return;
          }
        }

        const anchor = getCollapsedAnchorAtSelectionEnd(event.currentTarget);
        if (anchor) {
          event.preventDefault();
          pendingEditorFontSizeRef.current = null;
          const inserted = isHyperlinkDividerText(inputEvent.data)
            ? insertPlainTextAfterAnchor(event.currentTarget, anchor, inputEvent.data)
            : appendTextToAnchorEnd(event.currentTarget, anchor, inputEvent.data);
          if (inserted) {
            commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
          }
          return;
        }
      }
    },
    onPaste(event) {
      const text = event.clipboardData.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
      if (replaceSelectionWithHTML(event.currentTarget, linkifyEditorPlainTextToHTML(text))) {
        commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
      }
    },
    onDrop(event) {
      const text = event.dataTransfer.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
      event.currentTarget.focus({ preventScroll: true });
      if (replaceSelectionWithHTML(event.currentTarget, linkifyEditorPlainTextToHTML(text))) {
        commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
      }
    },
    onInput(event) {
      commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
    },
    onSelect(event) {
      const range = getEditorSelectionRange(event.currentTarget);
      if (range && !range.collapsed) {
        pendingEditorFontSizeRef.current = null;
        syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
        return;
      }
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
    },
    onClick(event) {
      pendingEditorFontSizeRef.current = null;
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) window.open(anchor.href, "_blank", "noopener,noreferrer");
    },
    onKeyUp(event) {
      if (pendingEditorFontSizeRef.current !== null) {
        onSelectionFontSizeChange(pendingEditorFontSizeRef.current);
        return;
      }
      syncSelectionFontSize(event.currentTarget, onSelectionFontSizeChange);
    },
    onBlur(event) {
      pendingEditorFontSizeRef.current = null;
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(serializeEditorDocumentHTML(event.currentTarget));
    },
    onScroll(event) {
      if (restoringScrollRef.current) return;
      const targetKey = currentDocumentTargetKeyRef.current;
      if (targetKey) scrollMemoryRef.current.remember(targetKey, event.currentTarget.scrollTop);
      setDocumentScrollTop(event.currentTarget.scrollTop);
    },
    onWheel(event) {
      event.stopPropagation();
    },
    onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        event.currentTarget.blur();
        return;
      }

      if (PENDING_FONT_SIZE_CANCEL_KEYS.has(event.key)) pendingEditorFontSizeRef.current = null;

      if (event.key === "Enter") {
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        const offsets = getEditorSelectionOffsets(event.currentTarget);
        if (!offsets) return;
        const currentText = readEditorDocumentText(event.currentTarget);
        const edit = insertEditorEnterText(currentText, offsets.start, offsets.end, outlineStyle);
        const insertedText = edit.value.slice(offsets.start, edit.selectionStart);
        const anchor = getCollapsedAnchorAtSelectionEnd(event.currentTarget);
        const inserted = anchor
          ? insertPlainTextAfterAnchor(event.currentTarget, anchor, insertedText)
          : replaceSelectionWithText(event.currentTarget, insertedText);
        if (inserted) {
          scrollEditorToLineStart(event.currentTarget);
          commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
        }
        return;
      }

      if (event.key === "Backspace") {
        const offsets = getEditorSelectionOffsets(event.currentTarget);
        if (!offsets) return;
        const currentText = readEditorDocumentText(event.currentTarget);
        const edit = deleteEditorBackspaceText(currentText, offsets.start, offsets.end);
        if (!edit) return;
        event.preventDefault();
        pendingEditorFontSizeRef.current = null;
        if (deleteTextByOffsets(event.currentTarget, edit.selectionStart, offsets.start)) {
          commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
        }
        return;
      }

      if (event.key !== "Tab") return;
      event.preventDefault();
      pendingEditorFontSizeRef.current = null;
      const offsets = getEditorSelectionOffsets(event.currentTarget);
      if (!offsets) return;
      const anchor = !event.shiftKey ? getCollapsedAnchorAtSelectionEnd(event.currentTarget) : null;
      if (anchor) {
        insertPlainTextAfterAnchor(event.currentTarget, anchor, EDITOR_TAB_TEXT);
        commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
        return;
      }
      const currentText = readEditorDocumentText(event.currentTarget);
      const edit = event.shiftKey
        ? insertEditorTabText(currentText, offsets.start, offsets.end, outlineStyle, "outdent")
        : insertEditorTabText(currentText, offsets.start, offsets.end, outlineStyle, "indent");
      const simpleInsertedText = edit.value.slice(offsets.start, edit.selectionStart);
      const simpleReplacement = `${currentText.slice(0, offsets.start)}${simpleInsertedText}${currentText.slice(offsets.end)}`;
      if (!event.shiftKey && simpleReplacement === edit.value) {
        replaceSelectionWithText(event.currentTarget, simpleInsertedText || EDITOR_TAB_TEXT);
      } else {
        replaceDocumentWithPlainText(event.currentTarget, edit.value, edit.selectionStart, edit.selectionEnd);
      }
      commitEditorDocument(event.currentTarget, scheduleDocumentSave, scheduleIndentGuideUpdate);
    },
  }), [
    currentDocumentTargetKeyRef,
    flushPendingDocumentSave,
    onSelectionFontSizeChange,
    outlineStyle,
    pendingEditorFontSizeRef,
    rememberCurrentDocumentScroll,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
  ]);
}

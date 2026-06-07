import type React from "react";
import {
  classifyEditorInputType,
  createEditorUndoHistory,
  recordEditorUndoChange,
  redoEditorText,
  resetEditorUndoHistory,
  snapshotEditorText,
  undoEditorText,
  type EditorTextChangeKind,
  type EditorTextSnapshot,
  type EditorUndoHistory,
} from "../editor/editorUndoHistory";

export type ContentEditableTitlePendingSnapshotRef = React.MutableRefObject<EditorTextSnapshot | null>;

export function createContentEditableTitleUndoHistory(): EditorUndoHistory {
  return createEditorUndoHistory({ maxGroups: 80, maxStoredChars: 50_000 });
}

export function resetContentEditableTitleUndoHistory(history: EditorUndoHistory, pendingSnapshotRef: ContentEditableTitlePendingSnapshotRef) {
  resetEditorUndoHistory(history);
  pendingSnapshotRef.current = null;
}

export function snapshotContentEditableTitle(element: HTMLElement): EditorTextSnapshot {
  const value = readContentEditableTitleText(element);
  const offsets = readContentEditableTitleSelectionOffsets(element);
  const fallbackOffset = value.length;
  return snapshotEditorText(value, offsets?.start ?? fallbackOffset, offsets?.end ?? fallbackOffset);
}

export function handleContentEditableTitleBeforeInput(
  event: React.FormEvent<HTMLDivElement>,
  history: EditorUndoHistory,
  pendingSnapshotRef: ContentEditableTitlePendingSnapshotRef,
  draftRef: React.MutableRefObject<string>,
): boolean {
  const inputEvent = event.nativeEvent as InputEvent;
  if (inputEvent.inputType === "historyUndo" || inputEvent.inputType === "historyRedo") {
    event.preventDefault();
    pendingSnapshotRef.current = null;
    applyContentEditableTitleUndoCommand(
      event.currentTarget,
      history,
      inputEvent.inputType === "historyUndo" ? "undo" : "redo",
      draftRef,
    );
    return true;
  }

  if (inputEvent.inputType === "insertParagraph" || inputEvent.inputType === "insertLineBreak") {
    event.preventDefault();
    return true;
  }

  if (inputEvent.inputType && inputEvent.inputType !== "insertCompositionText") {
    pendingSnapshotRef.current = snapshotContentEditableTitle(event.currentTarget);
  }
  return false;
}

export function recordContentEditableTitleInput(
  history: EditorUndoHistory,
  element: HTMLElement,
  pendingSnapshotRef: ContentEditableTitlePendingSnapshotRef,
  draftRef: React.MutableRefObject<string>,
  inputType?: string,
) {
  const before = pendingSnapshotRef.current;
  pendingSnapshotRef.current = null;
  draftRef.current = readContentEditableTitleText(element);
  recordContentEditableTitleChange(history, element, before, classifyEditorInputType(inputType));
}

export function handleContentEditableTitlePaste(
  event: React.ClipboardEvent<HTMLDivElement>,
  history: EditorUndoHistory,
  pendingSnapshotRef: ContentEditableTitlePendingSnapshotRef,
  draftRef: React.MutableRefObject<string>,
): boolean {
  const text = normalizeTitleText(event.clipboardData.getData("text/plain"));
  if (!text) return false;

  event.preventDefault();
  const root = event.currentTarget;
  const before = snapshotContentEditableTitle(root);
  const current = readContentEditableTitleText(root);
  const offsets = readContentEditableTitleSelectionOffsets(root) ?? { start: current.length, end: current.length };
  const nextValue = `${current.slice(0, offsets.start)}${text}${current.slice(offsets.end)}`;
  const nextOffset = offsets.start + text.length;
  writeContentEditableTitleSnapshot(root, snapshotEditorText(nextValue, nextOffset, nextOffset), draftRef);
  recordContentEditableTitleChange(history, root, before, "paste");
  pendingSnapshotRef.current = null;
  return true;
}

export function handleContentEditableTitleUndoRedoKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  history: EditorUndoHistory,
  pendingSnapshotRef: ContentEditableTitlePendingSnapshotRef,
  draftRef: React.MutableRefObject<string>,
): boolean {
  const direction = getUndoRedoDirection(event);
  if (!direction) return false;

  event.preventDefault();
  pendingSnapshotRef.current = null;
  applyContentEditableTitleUndoCommand(event.currentTarget, history, direction, draftRef);
  return true;
}

export function writeContentEditableTitleSnapshot(
  element: HTMLElement,
  snapshot: EditorTextSnapshot,
  draftRef: React.MutableRefObject<string>,
) {
  element.textContent = snapshot.value;
  draftRef.current = snapshot.value;
  setContentEditableTitleSelectionByOffsets(element, snapshot.selectionStart, snapshot.selectionEnd);
}

function applyContentEditableTitleUndoCommand(
  element: HTMLElement,
  history: EditorUndoHistory,
  direction: "undo" | "redo",
  draftRef: React.MutableRefObject<string>,
): boolean {
  const currentValue = readContentEditableTitleText(element);
  const snapshot = direction === "undo"
    ? undoEditorText(history, currentValue)
    : redoEditorText(history, currentValue);
  if (!snapshot) return false;
  writeContentEditableTitleSnapshot(element, snapshot, draftRef);
  return true;
}

function recordContentEditableTitleChange(
  history: EditorUndoHistory,
  element: HTMLElement,
  before: EditorTextSnapshot | null,
  kind: EditorTextChangeKind,
) {
  if (!before) return;
  recordEditorUndoChange(history, before, snapshotContentEditableTitle(element), kind);
}

function readContentEditableTitleText(element: HTMLElement): string {
  return normalizeTitleText(element.textContent ?? "");
}

function normalizeTitleText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n+/g, " ");
}

function readContentEditableTitleSelectionOffsets(root: HTMLElement): { start: number; end: number } | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  if (container !== root && !root.contains(container)) return null;

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

function setContentEditableTitleSelectionByOffsets(root: HTMLElement, start: number, end = start) {
  const doc = root.ownerDocument;
  const selection = doc.getSelection();
  if (!selection) return;

  let textNode = findFirstTextNode(root);
  if (!textNode) {
    textNode = doc.createTextNode("");
    root.appendChild(textNode);
  }

  const textLength = textNode.data.length;
  const safeStart = Math.max(0, Math.min(start, textLength));
  const safeEnd = Math.max(safeStart, Math.min(end, textLength));
  const range = doc.createRange();
  range.setStart(textNode, safeStart);
  range.setEnd(textNode, safeEnd);
  selection.removeAllRanges();
  selection.addRange(range);
}

function findFirstTextNode(root: HTMLElement): Text | null {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

function getUndoRedoDirection(event: React.KeyboardEvent<HTMLDivElement>): "undo" | "redo" | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === "z") return event.shiftKey ? "redo" : "undo";
  if (key === "y" && !event.shiftKey) return "redo";
  return null;
}

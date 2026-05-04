import { useMemo } from "react";
import type React from "react";
import type { EditorDocumentSurfaceProps } from "./EditorDocumentSurface";
import type { EditorScrollMemory } from "./editorScroll";
import {
  classifyEditorInputType,
  redoEditorText,
  undoEditorText,
  type EditorTextChangeKind,
  type EditorTextSnapshot,
  type EditorUndoHistory,
} from "./editorUndoHistory";
import {
  deleteEditorBackspaceText,
  insertEditorEnterText,
  insertEditorTabText,
  type EditorInlineFormatCommand,
  type EditorOutlineStyleID,
  type PlainTextEdit,
} from "./plainTextEditing";

export type EditorDocumentSurfaceHandlers = Pick<
  EditorDocumentSurfaceProps,
  | "onBeforeInput"
  | "onPaste"
  | "onDrop"
  | "onChange"
  | "onSelect"
  | "onClick"
  | "onKeyUp"
  | "onBlur"
  | "onScroll"
  | "onWheel"
  | "onKeyDown"
>;

type UseEditorDocumentSurfaceHandlersOptions = {
  pendingEditorInputKindRef: React.MutableRefObject<EditorTextChangeKind>;
  restoringScrollRef: React.MutableRefObject<boolean>;
  currentDocumentTargetKeyRef: React.MutableRefObject<string>;
  scrollMemoryRef: React.MutableRefObject<EditorScrollMemory>;
  editorUndoHistoryRef: React.MutableRefObject<EditorUndoHistory>;
  outlineStyle: EditorOutlineStyleID;
  setDocumentScrollTop: React.Dispatch<React.SetStateAction<number>>;
  recordEditorTextChange: (element: HTMLTextAreaElement, kindOverride?: EditorTextChangeKind) => EditorTextSnapshot;
  scheduleDocumentSave: (nextText: string, immediate?: boolean) => void;
  scheduleIndentGuideUpdate: (text: string) => void;
  syncEditorTextSelectionSnapshot: (element: HTMLTextAreaElement) => void;
  rememberCurrentDocumentScroll: () => void;
  flushPendingDocumentSave: (fallbackText?: string) => void;
  applyEditorUndoSnapshot: (element: HTMLTextAreaElement, snapshot: EditorTextSnapshot) => void;
  applyInlineFormatCommand: (command: EditorInlineFormatCommand) => void;
  commitEditorPlainTextEdit: (element: HTMLTextAreaElement, edit: PlainTextEdit, kind: EditorTextChangeKind) => void;
};

export function useEditorDocumentSurfaceHandlers({
  pendingEditorInputKindRef,
  restoringScrollRef,
  currentDocumentTargetKeyRef,
  scrollMemoryRef,
  editorUndoHistoryRef,
  outlineStyle,
  setDocumentScrollTop,
  recordEditorTextChange,
  scheduleDocumentSave,
  scheduleIndentGuideUpdate,
  syncEditorTextSelectionSnapshot,
  rememberCurrentDocumentScroll,
  flushPendingDocumentSave,
  applyEditorUndoSnapshot,
  applyInlineFormatCommand,
  commitEditorPlainTextEdit,
}: UseEditorDocumentSurfaceHandlersOptions): EditorDocumentSurfaceHandlers {
  return useMemo(() => ({
    onBeforeInput(event) {
      pendingEditorInputKindRef.current = classifyEditorInputType((event.nativeEvent as InputEvent).inputType);
    },
    onPaste() {
      pendingEditorInputKindRef.current = "paste";
    },
    onDrop() {
      pendingEditorInputKindRef.current = "paste";
    },
    onChange(event) {
      const snapshot = recordEditorTextChange(event.currentTarget);
      scheduleDocumentSave(snapshot.value);
      scheduleIndentGuideUpdate(snapshot.value);
    },
    onSelect(event) {
      syncEditorTextSelectionSnapshot(event.currentTarget);
    },
    onClick(event) {
      syncEditorTextSelectionSnapshot(event.currentTarget);
    },
    onKeyUp(event) {
      syncEditorTextSelectionSnapshot(event.currentTarget);
    },
    onBlur(event) {
      syncEditorTextSelectionSnapshot(event.currentTarget);
      rememberCurrentDocumentScroll();
      flushPendingDocumentSave(event.currentTarget.value);
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
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && (key === "z" || key === "y")) {
        const shouldRedo = key === "y" || event.shiftKey;
        event.preventDefault();
        const snapshot = shouldRedo
          ? redoEditorText(editorUndoHistoryRef.current, event.currentTarget.value)
          : undoEditorText(editorUndoHistoryRef.current, event.currentTarget.value);
        if (snapshot) applyEditorUndoSnapshot(event.currentTarget, snapshot);
        return;
      }
      if (mod && !event.altKey && (key === "b" || key === "u")) {
        event.preventDefault();
        applyInlineFormatCommand(key === "b" ? "bold" : "underline");
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.currentTarget.blur();
        return;
      }
      if (event.key === "Backspace") {
        const edit = deleteEditorBackspaceText(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
        if (edit) {
          event.preventDefault();
          commitEditorPlainTextEdit(event.currentTarget, edit, "delete");
          return;
        }
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const edit = insertEditorEnterText(event.currentTarget.value, event.currentTarget.selectionStart, event.currentTarget.selectionEnd, outlineStyle);
        commitEditorPlainTextEdit(event.currentTarget, edit, "lineBreak");
        return;
      }
      if (event.key !== "Tab") return;

      event.preventDefault();
      const edit = insertEditorTabText(
        event.currentTarget.value,
        event.currentTarget.selectionStart,
        event.currentTarget.selectionEnd,
        outlineStyle,
        event.shiftKey ? "outdent" : "indent",
      );
      commitEditorPlainTextEdit(event.currentTarget, edit, "tab");
    },
  }), [
    applyEditorUndoSnapshot,
    applyInlineFormatCommand,
    commitEditorPlainTextEdit,
    currentDocumentTargetKeyRef,
    editorUndoHistoryRef,
    flushPendingDocumentSave,
    outlineStyle,
    pendingEditorInputKindRef,
    recordEditorTextChange,
    rememberCurrentDocumentScroll,
    restoringScrollRef,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    scrollMemoryRef,
    setDocumentScrollTop,
    syncEditorTextSelectionSnapshot,
  ]);
}

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildEditorIndentGuideSegments, editorIndentGuideLeftForDepth, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { createEditorScrollMemory } from "./editorScroll";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { EDITOR_TAB_TEXT, type EditorOutlineStyleID } from "./plainTextEditing";
import {
  deserializeEditorDocumentHTML,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
  type EditorListKind,
} from "./richTextEditing";
import {
  applyEditorInlineFormatToRoot,
  applyEditorLinkToRoot,
  applyEditorSelectionFontSizeToRoot,
  insertEditorListKindToRoot,
  readEditorSelectionFormatState,
  useEditorDocumentSurfaceHandlers,
  type EditorDocumentFormattingController,
  type EditorSelectionInlineFormatState,
} from "./useEditorDocumentSurfaceHandlers";
import { EDITOR_DOCUMENT_FONT_SIZE_PX, EDITOR_DOCUMENT_LINE_HEIGHT, getEditorDocumentFontFamily } from "./useEditorPreferences";
import { UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, type UnifiedRichEditorSurfaceID } from "./unifiedRichEditorContract";

export type UnifiedRichEditorFormattingController = EditorDocumentFormattingController & {
  focus: () => void;
  flush: () => void;
  insertLink: (href: string) => boolean;
  insertList: (kind: EditorListKind) => boolean;
};

type UnifiedRichEditorSurfaceProps = {
  value: string;
  editable?: boolean;
  outlineStyle: EditorOutlineStyleID;
  surfaceID: UnifiedRichEditorSurfaceID;
  ariaLabel: string;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  surfaceText: string;
  accent: string;
  indentGuideColor: string;
  scrollbarTrack?: string;
  formattingControllerRef?: React.MutableRefObject<UnifiedRichEditorFormattingController | null>;
  onChange: (nextValue: string) => void;
  onFlush?: (nextValue: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionFontSizeChange?: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
};

function editorHasFocus(element: HTMLElement): boolean {
  const activeElement = element.ownerDocument.activeElement;
  return activeElement === element || Boolean(activeElement && element.contains(activeElement));
}

export const UnifiedRichEditorSurface: React.FC<UnifiedRichEditorSurfaceProps> = ({
  value,
  editable = true,
  outlineStyle,
  surfaceID,
  ariaLabel,
  placeholder,
  className,
  style,
  surfaceText,
  accent,
  indentGuideColor,
  scrollbarTrack = "transparent",
  formattingControllerRef,
  onChange,
  onFlush,
  onFocus,
  onBlur,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const restoringScrollRef = useRef(false);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const pendingFontSizeRef = useRef<number | null>(null);
  const indentGuideFrameRef = useRef<number | null>(null);
  const targetKeyRef = useRef(`unified-rich-editor:${surfaceID}`);
  const lastAppliedValueRef = useRef("");
  const userEditedRef = useRef(false);
  const selectionFontSizeRef = useRef(EDITOR_DOCUMENT_FONT_SIZE_PX);
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const documentLineHeightPx = EDITOR_DOCUMENT_FONT_SIZE_PX * EDITOR_DOCUMENT_LINE_HEIGHT;
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;

  useEffect(() => {
    targetKeyRef.current = `unified-rich-editor:${surfaceID}`;
  }, [surfaceID]);

  const scheduleIndentGuideUpdate = useCallback((text: string) => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
    if (outlineStyle !== "indent-guides") {
      setIndentGuideSegments((current) => current.length > 0 ? [] : current);
      return;
    }
    indentGuideFrameRef.current = window.requestAnimationFrame(() => {
      indentGuideFrameRef.current = null;
      setIndentGuideSegments(buildEditorIndentGuideSegments(text, EDITOR_TAB_TEXT.length));
    });
  }, [outlineStyle]);

  useEffect(() => () => {
    if (indentGuideFrameRef.current !== null) {
      window.cancelAnimationFrame(indentGuideFrameRef.current);
      indentGuideFrameRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lastAppliedValueRef.current === value) return;
    if (editorHasFocus(editor)) return;
    editor.innerHTML = deserializeEditorDocumentHTML(value);
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    lastAppliedValueRef.current = value;
    userEditedRef.current = false;
    scheduleIndentGuideUpdate(readEditorDocumentText(editor));
  }, [scheduleIndentGuideUpdate, value]);

  useEffect(() => {
    const editor = editorRef.current;
    scheduleIndentGuideUpdate(editor ? readEditorDocumentText(editor) : value);
  }, [outlineStyle, scheduleIndentGuideUpdate, value]);

  const scheduleDocumentSave = useCallback((nextValue: string) => {
    if (!editable) return;
    userEditedRef.current = true;
    lastAppliedValueRef.current = nextValue;
    onChange(nextValue);
  }, [editable, onChange]);

  const flushDocumentSave = useCallback((fallbackValue?: string) => {
    if (!editable) return;
    const nextValue = fallbackValue ?? (editorRef.current ? serializeEditorDocumentHTML(editorRef.current) : lastAppliedValueRef.current);
    lastAppliedValueRef.current = nextValue;
    if (userEditedRef.current) onChange(nextValue);
    onFlush?.(nextValue);
    userEditedRef.current = false;
  }, [editable, onChange, onFlush]);

  const handleSelectionFontSizeChange = useCallback((fontSize: number) => {
    selectionFontSizeRef.current = fontSize;
    onSelectionFontSizeChange?.(fontSize);
  }, [onSelectionFontSizeChange]);

  const handlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef: targetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll: () => undefined,
    flushPendingDocumentSave: flushDocumentSave,
    onSelectionFontSizeChange: handleSelectionFontSizeChange,
    onSelectionInlineFormatChange,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: indentGuideColor,
    mentionMenuPosition: "absolute",
  });
  const { mentionMenu, insertTable, ...documentSurfaceHandlers } = handlers;

  const formattingController = useMemo<UnifiedRichEditorFormattingController>(() => ({
    focus: () => {
      editorRef.current?.focus({ preventScroll: true });
    },
    flush: () => {
      flushDocumentSave();
    },
    applyFontSizeValue: (fontSize: number) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorSelectionFontSizeToRoot(editor, fontSize, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef: pendingFontSizeRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionFontSizeChange: handleSelectionFontSizeChange,
      });
    },
    adjustFontSize: (delta: number) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      const currentState = readEditorSelectionFormatState(editor, selectionFontSizeRef.current);
      const currentFontSize = pendingFontSizeRef.current ?? currentState?.fontSize ?? selectionFontSizeRef.current;
      return applyEditorSelectionFontSizeToRoot(editor, currentFontSize + delta, {
        documentUndoHistory: documentUndoHistoryRef.current,
        pendingEditorFontSizeRef: pendingFontSizeRef,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionFontSizeChange: handleSelectionFontSizeChange,
      });
    },
    toggleInlineFormat: (command) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorInlineFormatToRoot(editor, command, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
        onSelectionInlineFormatChange,
      });
    },
    insertTable: () => {
      if (!editable) return false;
      return insertTable(editorRef.current);
    },
    insertLink: (href: string) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return applyEditorLinkToRoot(editor, href, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      });
    },
    insertList: (kind: EditorListKind) => {
      const editor = editorRef.current;
      if (!editable || !editor) return false;
      return insertEditorListKindToRoot(editor, kind, {
        documentUndoHistory: documentUndoHistoryRef.current,
        scheduleDocumentSave,
        scheduleIndentGuideUpdate,
      });
    },
    readFormatState: () => {
      const editor = editorRef.current;
      return editor ? readEditorSelectionFormatState(editor, selectionFontSizeRef.current) : null;
    },
  }), [
    editable,
    flushDocumentSave,
    handleSelectionFontSizeChange,
    insertTable,
    onSelectionInlineFormatChange,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
  ]);

  useEffect(() => {
    if (!formattingControllerRef) return undefined;
    formattingControllerRef.current = formattingController;
    return () => {
      if (formattingControllerRef.current === formattingController) formattingControllerRef.current = null;
    };
  }, [formattingController, formattingControllerRef]);

  const documentIsEditable = editable;
  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      {showIndentGuides && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            boxSizing: "border-box",
            overflow: "hidden",
            padding: style?.padding,
            fontSize: style?.fontSize ?? EDITOR_DOCUMENT_FONT_SIZE_PX,
            lineHeight: style?.lineHeight ?? EDITOR_DOCUMENT_LINE_HEIGHT,
            fontFamily: documentFontFamily,
            letterSpacing: 0,
            tabSize: EDITOR_TAB_TEXT.length,
          }}
        >
          <div style={{ position: "relative", transform: `translateY(-${documentScrollTop}px)` }}>
            {indentGuideSegments.map((segment) => (
              <div
                key={`${segment.depth}-${segment.lineStart}-${segment.lineEnd}`}
                style={{
                  position: "absolute",
                  top: segment.lineStart * documentLineHeightPx,
                  left: editorIndentGuideLeftForDepth(segment.depth, EDITOR_TAB_TEXT.length),
                  height: Math.max(documentLineHeightPx, (segment.lineEnd - segment.lineStart + 1) * documentLineHeightPx),
                  borderLeft: `1px solid ${indentGuideColor}`,
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
        </div>
      )}
      <div
        ref={editorRef}
        className={className ? `editor-document-scroll mango-editor-hover-highlight ${className}` : "editor-document-scroll mango-editor-hover-highlight"}
        data-mango-unified-rich-editor={surfaceID}
        data-mango-rich-editor-behavior-source={UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE}
        data-placeholder={placeholder}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-readonly={!documentIsEditable || undefined}
        tabIndex={documentIsEditable ? undefined : -1}
        contentEditable={documentIsEditable}
        suppressContentEditableWarning
        spellCheck
        onFocus={() => {
          if (!documentIsEditable) return;
          formattingControllerRef && (formattingControllerRef.current = formattingController);
          onFocus?.();
        }}
        onBeforeInput={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onBeforeInput(event);
        }}
        onPaste={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onPaste(event);
        }}
        onCopy={documentSurfaceHandlers.onCopy}
        onDrop={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onDrop(event);
        }}
        onInput={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onInput(event);
        }}
        onSelect={documentSurfaceHandlers.onSelect}
        onClick={documentSurfaceHandlers.onClick}
        onDoubleClick={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onDoubleClick(event);
        }}
        onContextMenu={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onContextMenu(event);
        }}
        onPointerDown={(event) => {
          if (!documentIsEditable) {
            editorRef.current?.blur();
            return;
          }
          documentSurfaceHandlers.onPointerDown(event);
        }}
        onPointerMove={documentSurfaceHandlers.onPointerMove}
        onKeyUp={documentSurfaceHandlers.onKeyUp}
        onBlur={(event) => {
          documentSurfaceHandlers.onBlur(event);
          onBlur?.();
        }}
        onScroll={documentSurfaceHandlers.onScroll}
        onWheel={documentSurfaceHandlers.onWheel}
        onKeyDown={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          documentSurfaceHandlers.onKeyDown(event);
        }}
        style={{
          position: "relative",
          zIndex: 1,
          display: "block",
          width: "100%",
          minWidth: 0,
          minHeight: 120,
          border: 0,
          outline: "none",
          color: surfaceText,
          background: "transparent",
          fontSize: EDITOR_DOCUMENT_FONT_SIZE_PX,
          lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
          fontFamily: documentFontFamily,
          tabSize: EDITOR_TAB_TEXT.length,
          letterSpacing: 0,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          caretColor: documentIsEditable ? surfaceText : "transparent",
          cursor: documentIsEditable ? "text" : "default",
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarGutter: "stable",
          ["--editor-document-scroll-accent" as string]: accent,
          ["--editor-document-scroll-track" as string]: scrollbarTrack,
          ...style,
        }}
      />
      {mentionMenu}
    </div>
  );
};

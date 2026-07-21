import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { buildEditorIndentGuideSegments, resolveEditorIndentGuideLineHeightPx, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { createEditorScrollMemory } from "./editorScroll";
import { createEditorDocumentUndoHistory, resetEditorDocumentUndoHistory } from "./editorUndoHistory";
import { EDITOR_TAB_TEXT, type EditorOutlineStyleID } from "./plainTextEditing";
import {
  deserializeEditorDocumentHTML,
  editorBodyHasEmailContent,
  readEditorDocumentText,
  serializeEditorDocumentHTML,
  type EditorHighlightColor,
} from "./richTextEditing";
import {
  useEditorDocumentFormattingController,
  useEditorDocumentSurfaceHandlers,
  getEditorSelectionOffsets,
  setEditorSelectionByOffsets,
  type EditorDocumentFormattingController,
  type EditorImageAttachmentContext,
  type EditorSelectionInlineFormatState,
  type EditorTextAlignment,
  type EditorTypingCaretBookmark,
} from "./useEditorDocumentSurfaceHandlers";
import { hydrateEditorAttachmentImageFrames } from "./editorImages";
import { loadMangoAttachmentObjectURL } from "../attachments/attachmentApi";
import { EDITOR_DOCUMENT_FONT_SIZE_PX, EDITOR_DOCUMENT_LINE_HEIGHT, getEditorDocumentFontFamily } from "./useEditorPreferences";
import { UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, type UnifiedRichEditorSurfaceID } from "./unifiedRichEditorContract";
import { EditorDocumentSurface } from "./EditorDocumentSurface";
import type { MentionableCompanyUser } from "./editorMentions";
import type { EditorEntityLinkContext } from "./editorEntityLinks.js";

export type UnifiedRichEditorFormattingController = EditorDocumentFormattingController & {
  focus: () => void;
  flush: () => string;
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
  mentionUsers?: MentionableCompanyUser[];
  formattingControllerRef?: React.MutableRefObject<UnifiedRichEditorFormattingController | null>;
  entityLinkContext?: EditorEntityLinkContext;
  editorImageAttachmentContext?: EditorImageAttachmentContext;
  eagerEditorImageHydration?: boolean;
  onEditorImageAttachmentError?: (message: string) => void;
  onChange: (nextValue: string) => void;
  onFlush?: (nextValue: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onSelectionFontSizeChange?: (fontSize: number) => void;
  onSelectionInlineFormatChange?: (format: EditorSelectionInlineFormatState) => void;
  onSelectionHighlightColorChange?: (color: EditorHighlightColor | null) => void;
  onSelectionTextAlignmentChange?: (alignment: EditorTextAlignment) => void;
};

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
  mentionUsers = [],
  formattingControllerRef,
  entityLinkContext,
  editorImageAttachmentContext,
  eagerEditorImageHydration = false,
  onEditorImageAttachmentError,
  onChange,
  onFlush,
  onFocus,
  onBlur,
  onSelectionFontSizeChange,
  onSelectionInlineFormatChange,
  onSelectionHighlightColorChange,
  onSelectionTextAlignmentChange,
}) => {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const attachmentHydrationCleanupRef = useRef<(() => void) | null>(null);
  const attachmentHydrationContextKeyRef = useRef("");
  const editorImageAttachmentErrorRef = useRef(onEditorImageAttachmentError);
  const restoringScrollRef = useRef(false);
  const scrollMemoryRef = useRef(createEditorScrollMemory());
  const documentUndoHistoryRef = useRef(createEditorDocumentUndoHistory());
  const pendingFontSizeRef = useRef<number | null>(null);
  const pendingHighlightColorRef = useRef<EditorHighlightColor | null | undefined>(undefined);
  const pendingInlineFormatRef = useRef<EditorSelectionInlineFormatState | null>(null);
  const pendingTypingCaretRef = useRef<EditorTypingCaretBookmark | null>(null);
  const restoreSelectionForHydrationRef = useRef<((root: HTMLElement) => boolean) | null>(null);
  const indentGuideFrameRef = useRef<number | null>(null);
  const targetKeyRef = useRef(`unified-rich-editor:${surfaceID}`);
  const lastAppliedValueRef = useRef("");
  const userEditedRef = useRef(false);
  editorImageAttachmentErrorRef.current = onEditorImageAttachmentError;
  const [documentScrollTop, setDocumentScrollTop] = useState(0);
  const [indentGuideSegments, setIndentGuideSegments] = useState<EditorIndentGuideSegment[]>([]);
  const documentFontFamily = getEditorDocumentFontFamily(outlineStyle);
  const documentLineHeightPx = resolveEditorIndentGuideLineHeightPx(
    style?.fontSize,
    style?.lineHeight,
    EDITOR_DOCUMENT_FONT_SIZE_PX,
    EDITOR_DOCUMENT_LINE_HEIGHT,
  );
  const documentIsEmpty = !editorBodyHasEmailContent(value);
  const showIndentGuides = outlineStyle === "indent-guides" && indentGuideSegments.length > 0;
  const attachmentHydrationContextKey = editorImageAttachmentContext
    ? [editorImageAttachmentContext.apiBase.trim(), editorImageAttachmentContext.companyID.trim(), editorImageAttachmentContext.resourceType, editorImageAttachmentContext.resourceID.trim(), eagerEditorImageHydration ? "eager" : "viewport"].join("\u0000")
    : "";

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
    if (lastAppliedValueRef.current === value
      && attachmentHydrationContextKeyRef.current === attachmentHydrationContextKey
      && (!editorImageAttachmentContext || attachmentHydrationCleanupRef.current)) return;
    restoreSelectionForHydrationRef.current?.(editor);
    const selectionOffsets = getEditorSelectionOffsets(editor);
    attachmentHydrationCleanupRef.current?.();
    attachmentHydrationCleanupRef.current = null;
    editor.innerHTML = deserializeEditorDocumentHTML(value);
    if (editorImageAttachmentContext) {
      attachmentHydrationCleanupRef.current = hydrateEditorAttachmentImageFrames(editor, (attachmentID, variant, options) => (
        loadMangoAttachmentObjectURL(
          editorImageAttachmentContext.apiBase,
          editorImageAttachmentContext.companyID,
          attachmentID,
          variant,
          options,
        )
      ), {
        eager: eagerEditorImageHydration,
        onError: () => editorImageAttachmentErrorRef.current?.(
          "An embedded image preview could not be loaded. The saved image reference was preserved.",
        ),
      });
    }
    attachmentHydrationContextKeyRef.current = attachmentHydrationContextKey;
    resetEditorDocumentUndoHistory(documentUndoHistoryRef.current);
    pendingFontSizeRef.current = null;
    pendingHighlightColorRef.current = undefined;
    pendingInlineFormatRef.current = null;
    pendingTypingCaretRef.current = null;
    lastAppliedValueRef.current = value;
    userEditedRef.current = false;
    if (outlineStyle === "indent-guides") scheduleIndentGuideUpdate(readEditorDocumentText(editor));
    if (selectionOffsets) setEditorSelectionByOffsets(editor, selectionOffsets.start, selectionOffsets.end);
  }, [attachmentHydrationContextKey, eagerEditorImageHydration, scheduleIndentGuideUpdate, value]);

  useLayoutEffect(() => () => {
    attachmentHydrationCleanupRef.current?.();
    attachmentHydrationCleanupRef.current = null;
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (outlineStyle !== "indent-guides") {
      scheduleIndentGuideUpdate("");
      return;
    }
    scheduleIndentGuideUpdate(editor ? readEditorDocumentText(editor) : value);
  }, [outlineStyle, scheduleIndentGuideUpdate, value]);

  const scheduleDocumentSave = useCallback((nextValue: string) => {
    if (!editable) return;
    userEditedRef.current = true;
    lastAppliedValueRef.current = nextValue;
    onChange(nextValue);
  }, [editable, onChange]);

  const flushDocumentSave = useCallback((fallbackValue?: string) => {
    const nextValue = fallbackValue ?? (editorRef.current ? serializeEditorDocumentHTML(editorRef.current) : lastAppliedValueRef.current);
    if (!editable) return nextValue;
    lastAppliedValueRef.current = nextValue;
    if (userEditedRef.current) onChange(nextValue);
    onFlush?.(nextValue);
    userEditedRef.current = false;
    return nextValue;
  }, [editable, onChange, onFlush]);

  const handleSelectionFontSizeChange = useCallback((fontSize: number) => {
    onSelectionFontSizeChange?.(fontSize);
  }, [onSelectionFontSizeChange]);

  const handlers = useEditorDocumentSurfaceHandlers({
    restoringScrollRef,
    currentDocumentTargetKeyRef: targetKeyRef,
    scrollMemoryRef,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    pendingEditorHighlightColorRef: pendingHighlightColorRef,
    pendingEditorInlineFormatRef: pendingInlineFormatRef,
    pendingEditorTypingCaretRef: pendingTypingCaretRef,
    outlineStyle,
    setDocumentScrollTop,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    rememberCurrentDocumentScroll: () => undefined,
    flushPendingDocumentSave: flushDocumentSave,
    onSelectionFontSizeChange: handleSelectionFontSizeChange,
    onSelectionInlineFormatChange,
    onSelectionHighlightColorChange,
    onSelectionTextAlignmentChange,
    mentionUsers,
    mentionAccent: accent,
    mentionSurfaceText: surfaceText,
    mentionStrokeColor: indentGuideColor,
    mentionMenuPosition: "absolute",
    entityLinkContext,
    editorImageAttachmentContext,
    onEditorImageAttachmentError,
  });
  const { mentionMenu, insertTable, restoreSelection, flushPendingInput, ...documentSurfaceHandlers } = handlers;
  restoreSelectionForHydrationRef.current = restoreSelection;

  const restoreFormattingSelection = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return null;
    flushPendingInput(editor);
    restoreSelection(editor);
    editor.focus({ preventScroll: true });
    return editor;
  }, [flushPendingInput, restoreSelection]);

  const sharedFormattingController = useEditorDocumentFormattingController({
    editorRef,
    editable,
    outlineStyle,
    documentUndoHistoryRef,
    pendingEditorFontSizeRef: pendingFontSizeRef,
    pendingEditorHighlightColorRef: pendingHighlightColorRef,
    pendingEditorInlineFormatRef: pendingInlineFormatRef,
    pendingEditorTypingCaretRef: pendingTypingCaretRef,
    restoreSelection,
    insertTable,
    scheduleDocumentSave,
    scheduleIndentGuideUpdate,
    onSelectionFontSizeChange: handleSelectionFontSizeChange,
    onSelectionInlineFormatChange,
    onSelectionHighlightColorChange,
    onSelectionTextAlignmentChange,
  });

  const formattingController = useMemo<UnifiedRichEditorFormattingController>(() => ({
    ...sharedFormattingController,
    focus: () => {
      restoreFormattingSelection();
    },
    flush: () => flushDocumentSave(),
  }), [
    flushDocumentSave,
    restoreFormattingSelection,
    sharedFormattingController,
  ]);

  useEffect(() => {
    if (!formattingControllerRef) return undefined;
    formattingControllerRef.current = formattingController;
    return () => {
      if (formattingControllerRef.current === formattingController) formattingControllerRef.current = null;
    };
  }, [formattingController, formattingControllerRef]);

  return (
    <div style={{ position: "relative", minWidth: 0, minHeight: 0, height: style?.height }}>
      <EditorDocumentSurface
        documentRef={editorRef}
        editable={editable}
        surfaceID={surfaceID}
        ariaLabel={ariaLabel}
        placeholder={placeholder}
        documentIsEmpty={documentIsEmpty}
        dataAttributes={{ "data-mango-rich-editor-behavior-source": UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE }}
        className={className}
        layout="flow"
        documentFontSize={style?.fontSize ?? EDITOR_DOCUMENT_FONT_SIZE_PX}
        documentLineHeightPx={documentLineHeightPx}
        documentLineHeight={style?.lineHeight ?? EDITOR_DOCUMENT_LINE_HEIGHT}
        documentFontFamily={documentFontFamily}
        documentPadding={style?.padding ?? 0}
        documentScrollTop={documentScrollTop}
        showIndentGuides={showIndentGuides}
        indentGuideSegments={indentGuideSegments}
        indentGuideColor={indentGuideColor}
        surfaceText={surfaceText}
        caretColor={surfaceText}
        scrollbarAccent={accent}
        scrollbarTrack={scrollbarTrack}
        {...documentSurfaceHandlers}
        onFocus={() => {
          formattingControllerRef && (formattingControllerRef.current = formattingController);
          onFocus?.();
        }}
        onBlur={(event) => {
          documentSurfaceHandlers.onBlur(event);
          onBlur?.();
        }}
        style={{
          minHeight: 120,
          background: "transparent",
          ...style,
        }}
      />
      {mentionMenu}
    </div>
  );
};

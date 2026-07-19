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
import { useMangoEditorDataFormat } from "./editorDataFormat";

const MangoTiptapEditor = React.lazy(async () => {
  const module = await import("./tiptap/MangoTiptapEditor.js");
  return { default: module.MangoTiptapEditor };
});

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
  editorImageAttachmentContext?: EditorImageAttachmentContext;
  editorDataFormatContext?: {
    apiBase: string;
    companyID: string;
    requestJSON: EditorImageAttachmentContext["requestJSON"];
  };
  jsonResourceType?: "email_draft" | "email_signature";
  jsonResourceID?: string;
  jsonDocumentID?: string;
  prepareJSONIdentity?: () => Promise<unknown>;
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

const LegacyUnifiedRichEditorSurface: React.FC<UnifiedRichEditorSurfaceProps> = ({
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

const PreparingMangoJSONIdentity: React.FC<{
  prepare: () => Promise<unknown>;
  minHeight: React.CSSProperties["minHeight"];
}> = ({ prepare, minHeight }) => {
  const [error, setError] = useState("");
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return undefined;
    startedRef.current = true;
    let active = true;
    void prepare().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Unable to prepare the JSON editor identity");
    });
    return () => { active = false; };
  }, [prepare]);
  return error
    ? <div role="alert" style={{ minHeight, color: "#b91c1c", padding: 8 }}>{error}</div>
    : <div aria-label="Preparing JSON editor identity" style={{ minHeight }} />;
};

export const UnifiedRichEditorSurface: React.FC<UnifiedRichEditorSurfaceProps> = (props) => {
  const formatContext = props.editorDataFormatContext ?? props.editorImageAttachmentContext;
  const format = useMangoEditorDataFormat(
    formatContext?.apiBase ?? "",
    formatContext?.companyID ?? "",
    formatContext?.requestJSON,
  );
  if (format.loading) {
    return <div aria-label="Preparing editor data format" style={{ minHeight: props.style?.minHeight ?? 120 }} />;
  }
  if (format.error || !format.gate || !formatContext) {
    return <div role="alert" style={{ minHeight: props.style?.minHeight ?? 120, color: "#b91c1c", padding: 8 }}>Unable to verify this workspace's editor format.</div>;
  }
  if (format.gate.editor_format === "legacy_html") {
    return <LegacyUnifiedRichEditorSurface {...props} />;
  }
  const resourceID = props.jsonResourceID?.trim() || props.editorImageAttachmentContext?.resourceID.trim() || "";
  if (!resourceID || !props.jsonResourceType || !props.jsonDocumentID?.trim()) {
    if (!resourceID && props.prepareJSONIdentity) {
      return <PreparingMangoJSONIdentity prepare={props.prepareJSONIdentity} minHeight={props.style?.minHeight ?? 120} />;
    }
    return <div role="alert" style={{ minHeight: props.style?.minHeight ?? 120, color: "#b91c1c", padding: 8 }}>The JSON editor identity is not ready.</div>;
  }
  return (
    <React.Suspense fallback={<div aria-label="Loading JSON editor" style={{ minHeight: props.style?.minHeight ?? 120 }} />}>
      <MangoTiptapEditor
      key={`${format.gate.company_id}:${props.jsonResourceType}:${resourceID}:${props.jsonDocumentID}`}
      value={props.value}
      editable={props.editable}
      ariaLabel={props.ariaLabel}
      placeholder={props.placeholder}
      className={props.className}
      style={props.style}
      companyID={format.gate.company_id}
      resourceType={props.jsonResourceType}
      resourceID={resourceID}
      documentID={props.jsonDocumentID}
      requestJSON={formatContext.requestJSON}
      attachmentContext={props.editorImageAttachmentContext}
      mentionUsers={props.mentionUsers}
      formattingControllerRef={props.formattingControllerRef}
      onChange={props.onChange}
      onFlush={props.onFlush}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onError={props.onEditorImageAttachmentError}
      onSelectionFontSizeChange={props.onSelectionFontSizeChange}
      onSelectionInlineFormatChange={props.onSelectionInlineFormatChange}
      onSelectionHighlightColorChange={props.onSelectionHighlightColorChange}
      onSelectionTextAlignmentChange={props.onSelectionTextAlignmentChange}
      />
    </React.Suspense>
  );
};

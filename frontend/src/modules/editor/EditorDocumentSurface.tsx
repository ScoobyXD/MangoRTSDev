import type React from "react";
import type { EditorDocumentIsolationState } from "./editorTabs";
import { editorIndentGuideLeftForDepth, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE, type UnifiedRichEditorSurfaceID } from "./unifiedRichEditorContract";
import { EDITOR_DOCUMENT_LINE_HEIGHT } from "./useEditorPreferences";

type EditorDocumentDataAttributes = Record<string, string | undefined>;

export type EditorDocumentSurfaceProps = {
  documentRef: React.RefObject<HTMLDivElement>;
  documentIsolation?: EditorDocumentIsolationState;
  editable: boolean;
  surfaceID?: UnifiedRichEditorSurfaceID;
  ariaLabel?: string;
  placeholder?: string;
  documentIsEmpty?: boolean;
  dataAttributes?: EditorDocumentDataAttributes;
  className?: string;
  layout?: "absolute" | "flow";
  documentTopPx?: number;
  documentFontSize: React.CSSProperties["fontSize"];
  documentLineHeightPx: number;
  documentLineHeight?: React.CSSProperties["lineHeight"];
  documentFontFamily: string;
  documentBottomBufferPx?: number;
  documentPadding?: React.CSSProperties["padding"];
  documentScrollTop: number;
  showIndentGuides: boolean;
  indentGuideSegments: EditorIndentGuideSegment[];
  indentGuideColor: string;
  indentGuideStyle?: React.CSSProperties;
  surfaceText: string;
  caretColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  style?: React.CSSProperties;
  onFocus?: React.FocusEventHandler<HTMLDivElement>;
  onBeforeInput: React.FormEventHandler<HTMLDivElement>;
  onPaste: React.ClipboardEventHandler<HTMLDivElement>;
  onCopy: React.ClipboardEventHandler<HTMLDivElement>;
  onCut: React.ClipboardEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  onInput: React.FormEventHandler<HTMLDivElement>;
  onCompositionStart: React.CompositionEventHandler<HTMLDivElement>;
  onCompositionEnd: React.CompositionEventHandler<HTMLDivElement>;
  onSelect: React.ReactEventHandler<HTMLDivElement>;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onDoubleClick: React.MouseEventHandler<HTMLDivElement>;
  onContextMenu: React.MouseEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLDivElement>;
  onBlur: React.FocusEventHandler<HTMLDivElement>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
};

const VISIBLE_DOCUMENT_ISOLATION: EditorDocumentIsolationState = {
  ariaHidden: false,
  pointerEvents: "auto",
  tabIndex: 0,
  visibility: "visible",
};

export const EditorDocumentSurface: React.FC<EditorDocumentSurfaceProps> = ({
  documentRef,
  documentIsolation = VISIBLE_DOCUMENT_ISOLATION,
  editable,
  surfaceID = "logic-gate-editor",
  ariaLabel = "Linked document editor",
  placeholder,
  documentIsEmpty = false,
  dataAttributes,
  className,
  layout = "absolute",
  documentTopPx = 0,
  documentFontSize,
  documentLineHeightPx,
  documentLineHeight = EDITOR_DOCUMENT_LINE_HEIGHT,
  documentFontFamily,
  documentBottomBufferPx = 0,
  documentPadding,
  documentScrollTop,
  showIndentGuides,
  indentGuideSegments,
  indentGuideColor,
  indentGuideStyle,
  surfaceText,
  caretColor,
  scrollbarAccent,
  scrollbarTrack,
  style,
  onFocus,
  onBeforeInput,
  onPaste,
  onCopy,
  onCut,
  onDrop,
  onInput,
  onCompositionStart,
  onCompositionEnd,
  onSelect,
  onClick,
  onDoubleClick,
  onContextMenu,
  onPointerDown,
  onPointerMove,
  onKeyUp,
  onBlur,
  onScroll,
  onWheel,
  onKeyDown,
}) => {
  const documentIsEditable = editable && documentIsolation.pointerEvents === "auto";
  const resolvedPadding = documentPadding ?? ("0 18px " + documentBottomBufferPx + "px 24px");
  const positioningStyle: React.CSSProperties = layout === "absolute"
    ? { position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0 }
    : { position: "relative", width: "100%", minWidth: 0 };
  const guidePositioningStyle: React.CSSProperties = layout === "absolute"
    ? { position: "absolute", top: documentTopPx, right: 0, bottom: 0, left: 0 }
    : { position: "absolute", inset: 0 };

  return (
    <>
      {showIndentGuides && (
        <div
          aria-hidden="true"
          style={{
            ...guidePositioningStyle,
            zIndex: 0,
            visibility: documentIsolation.visibility,
            pointerEvents: "none",
            boxSizing: "border-box",
            overflow: "hidden",
            padding: resolvedPadding,
            fontSize: documentFontSize,
            lineHeight: documentLineHeight,
            fontFamily: documentFontFamily,
            letterSpacing: 0,
            tabSize: EDITOR_TAB_TEXT.length,
            ...indentGuideStyle,
          }}
        >
          <div style={{ position: "relative", transform: "translateY(-" + documentScrollTop + "px)" }}>
            {indentGuideSegments.map((segment) => (
              <div
                key={segment.depth + "-" + segment.lineStart + "-" + segment.lineEnd}
                style={{
                  position: "absolute",
                  top: segment.lineStart * documentLineHeightPx,
                  left: editorIndentGuideLeftForDepth(segment.depth, EDITOR_TAB_TEXT.length),
                  height: Math.max(documentLineHeightPx, (segment.lineEnd - segment.lineStart + 1) * documentLineHeightPx),
                  borderLeft: "1px solid " + indentGuideColor,
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div
        {...dataAttributes}
        ref={documentRef}
        className={className ? "editor-document-scroll mango-editor-hover-highlight " + className : "editor-document-scroll mango-editor-hover-highlight"}
        data-mango-unified-rich-editor={surfaceID}
        data-mango-rich-editor-behavior-source={UNIFIED_RICH_EDITOR_BEHAVIOR_SOURCE}
        data-mango-editor-empty={documentIsEmpty ? "true" : undefined}
        data-placeholder={placeholder}
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline="true"
        aria-hidden={documentIsolation.ariaHidden}
        aria-readonly={!documentIsEditable || undefined}
        tabIndex={documentIsEditable ? documentIsolation.tabIndex : -1}
        contentEditable={documentIsEditable}
        suppressContentEditableWarning
        spellCheck
        onFocus={(event) => {
          if (!documentIsEditable) return;
          onFocus?.(event);
        }}
        onBeforeInput={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onBeforeInput(event);
        }}
        onPaste={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onPaste(event);
        }}
        onCopy={onCopy}
        onCut={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onCut(event);
        }}
        onDrop={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onDrop(event);
        }}
        onInput={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onInput(event);
        }}
        onCompositionStart={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onCompositionStart(event);
        }}
        onCompositionEnd={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onCompositionEnd(event);
        }}
        onSelect={onSelect}
        onClick={onClick}
        onDoubleClick={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onDoubleClick(event);
        }}
        onContextMenu={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onContextMenu(event);
        }}
        onPointerDown={(event) => {
          if (!documentIsEditable) {
            documentRef.current?.blur();
            return;
          }
          onPointerDown(event);
        }}
        onPointerMove={onPointerMove}
        onKeyUp={onKeyUp}
        onBlur={onBlur}
        onScroll={onScroll}
        onWheel={onWheel}
        onKeyDown={(event) => {
          if (!documentIsEditable) {
            event.preventDefault();
            return;
          }
          onKeyDown(event);
        }}
        style={{
          ...positioningStyle,
          zIndex: 1,
          border: 0,
          backgroundColor: "transparent",
          color: surfaceText,
          display: "block",
          visibility: documentIsolation.visibility,
          pointerEvents: documentIsolation.pointerEvents,
          boxSizing: "border-box",
          padding: resolvedPadding,
          outline: "none",
          fontSize: documentFontSize,
          lineHeight: documentLineHeight,
          fontFamily: documentFontFamily,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          tabSize: EDITOR_TAB_TEXT.length,
          letterSpacing: 0,
          fontVariantLigatures: "common-ligatures",
          fontFeatureSettings: '"liga" 1, "calt" 1',
          caretColor: documentIsEditable ? caretColor : "transparent",
          cursor: documentIsEditable ? "text" : "default",
          overflowY: "auto",
          overflowX: "hidden",
          scrollbarGutter: "stable",
          ["--editor-document-scroll-accent" as string]: scrollbarAccent,
          ["--editor-document-scroll-track" as string]: scrollbarTrack,
          ...style,
        }}
      />
    </>
  );
};

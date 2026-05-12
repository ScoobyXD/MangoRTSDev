import type React from "react";
import type { EditorDocumentIsolationState } from "./editorTabs";
import type { EditorIndentGuideSegment } from "./editorIndentGuides";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { EDITOR_DOCUMENT_LINE_HEIGHT } from "./useEditorPreferences";

export type EditorDocumentSurfaceProps = {
  documentRef: React.RefObject<HTMLDivElement>;
  documentIsolation: EditorDocumentIsolationState;
  documentTopPx: number;
  documentFontSize: number;
  documentLineHeightPx: number;
  documentFontFamily: string;
  documentBottomBufferPx: number;
  documentScrollTop: number;
  showIndentGuides: boolean;
  indentGuideSegments: EditorIndentGuideSegment[];
  indentGuideColor: string;
  surfaceText: string;
  caretColor: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  onBeforeInput: React.FormEventHandler<HTMLDivElement>;
  onPaste: React.ClipboardEventHandler<HTMLDivElement>;
  onCopy: React.ClipboardEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  onInput: React.FormEventHandler<HTMLDivElement>;
  onSelect: React.ReactEventHandler<HTMLDivElement>;
  onClick: React.MouseEventHandler<HTMLDivElement>;
  onPointerDown: React.PointerEventHandler<HTMLDivElement>;
  onPointerMove: React.PointerEventHandler<HTMLDivElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLDivElement>;
  onBlur: React.FocusEventHandler<HTMLDivElement>;
  onScroll: React.UIEventHandler<HTMLDivElement>;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
};

export const EditorDocumentSurface: React.FC<EditorDocumentSurfaceProps> = ({
  documentRef,
  documentIsolation,
  documentTopPx,
  documentFontSize,
  documentLineHeightPx,
  documentFontFamily,
  documentBottomBufferPx,
  documentScrollTop,
  showIndentGuides,
  indentGuideSegments,
  indentGuideColor,
  surfaceText,
  caretColor,
  scrollbarAccent,
  scrollbarTrack,
  onBeforeInput,
  onPaste,
  onCopy,
  onDrop,
  onInput,
  onSelect,
  onClick,
  onPointerDown,
  onPointerMove,
  onKeyUp,
  onBlur,
  onScroll,
  onWheel,
  onKeyDown,
}) => (
  <>
    {showIndentGuides && (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: documentTopPx,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 0,
          visibility: documentIsolation.visibility,
          pointerEvents: "none",
          boxSizing: "border-box",
          overflow: "hidden",
          padding: `0 18px ${documentBottomBufferPx}px 24px`,
          fontSize: documentFontSize,
          lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
          fontFamily: documentFontFamily,
          letterSpacing: 0,
        }}
      >
        <div style={{ position: "relative", transform: `translateY(-${documentScrollTop}px)` }}>
          {indentGuideSegments.map((segment) => (
            <div
              key={`${segment.depth}-${segment.lineStart}-${segment.lineEnd}`}
              style={{
                position: "absolute",
                top: segment.lineStart * documentLineHeightPx,
                left: `${(segment.depth - 1) * EDITOR_TAB_TEXT.length}ch`,
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
      ref={documentRef}
      className="editor-document-scroll"
      role="textbox"
      aria-label="Linked document editor"
      aria-multiline="true"
      aria-hidden={documentIsolation.ariaHidden}
      tabIndex={documentIsolation.tabIndex}
      contentEditable={documentIsolation.pointerEvents === "auto"}
      suppressContentEditableWarning
      spellCheck
      onBeforeInput={onBeforeInput}
      onPaste={onPaste}
      onCopy={onCopy}
      onDrop={onDrop}
      onInput={onInput}
      onSelect={onSelect}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyUp={onKeyUp}
      onBlur={onBlur}
      onScroll={onScroll}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      style={{
        position: "absolute",
        top: documentTopPx,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1,
        border: 0,
        backgroundColor: "transparent",
        color: surfaceText,
        display: "block",
        visibility: documentIsolation.visibility,
        pointerEvents: documentIsolation.pointerEvents,
        boxSizing: "border-box",
        padding: `0 18px ${documentBottomBufferPx}px 24px`,
        outline: "none",
        fontSize: documentFontSize,
        lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
        fontFamily: documentFontFamily,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-word",
        tabSize: EDITOR_TAB_TEXT.length,
        letterSpacing: 0,
        fontVariantLigatures: "none",
        caretColor,
        cursor: "text",
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        ["--editor-document-scroll-accent" as string]: scrollbarAccent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    />
  </>
);

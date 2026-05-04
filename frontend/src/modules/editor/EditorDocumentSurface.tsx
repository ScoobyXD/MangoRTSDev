import type React from "react";
import type { EditorDocumentIsolationState } from "./editorTabs";
import type { EditorIndentGuideSegment } from "./editorIndentGuides";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { EDITOR_DOCUMENT_LINE_HEIGHT } from "./useEditorPreferences";

export type EditorDocumentSurfaceProps = {
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
  documentIsolation: EditorDocumentIsolationState;
  documentTopPx: number;
  documentFontSize: number;
  documentLineHeightPx: number;
  documentFontFamily: string;
  documentScrollTop: number;
  showIndentGuides: boolean;
  indentGuideSegments: EditorIndentGuideSegment[];
  indentGuideColor: string;
  surfaceText: string;
  accent: string;
  scrollbarAccent: string;
  scrollbarTrack: string;
  onBeforeInput: React.FormEventHandler<HTMLTextAreaElement>;
  onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
  onDrop: React.DragEventHandler<HTMLTextAreaElement>;
  onChange: React.ChangeEventHandler<HTMLTextAreaElement>;
  onSelect: React.ReactEventHandler<HTMLTextAreaElement>;
  onClick: React.MouseEventHandler<HTMLTextAreaElement>;
  onKeyUp: React.KeyboardEventHandler<HTMLTextAreaElement>;
  onBlur: React.FocusEventHandler<HTMLTextAreaElement>;
  onScroll: React.UIEventHandler<HTMLTextAreaElement>;
  onWheel: React.WheelEventHandler<HTMLTextAreaElement>;
  onKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement>;
};

export const EditorDocumentSurface: React.FC<EditorDocumentSurfaceProps> = ({
  textAreaRef,
  documentIsolation,
  documentTopPx,
  documentFontSize,
  documentLineHeightPx,
  documentFontFamily,
  documentScrollTop,
  showIndentGuides,
  indentGuideSegments,
  indentGuideColor,
  surfaceText,
  accent,
  scrollbarAccent,
  scrollbarTrack,
  onBeforeInput,
  onPaste,
  onDrop,
  onChange,
  onSelect,
  onClick,
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
          padding: "0 18px 24px 24px",
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

    <textarea
      ref={textAreaRef}
      className="editor-document-scroll"
      aria-label="Linked document editor"
      aria-hidden={documentIsolation.ariaHidden}
      tabIndex={documentIsolation.tabIndex}
      spellCheck
      onBeforeInput={onBeforeInput}
      onPaste={onPaste}
      onDrop={onDrop}
      onChange={onChange}
      onSelect={onSelect}
      onClick={onClick}
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
        resize: "none",
        padding: "0 18px 24px 24px",
        outline: "none",
        fontSize: documentFontSize,
        lineHeight: EDITOR_DOCUMENT_LINE_HEIGHT,
        fontFamily: documentFontFamily,
        whiteSpace: "pre-wrap",
        tabSize: 2,
        letterSpacing: 0,
        fontVariantLigatures: "none",
        caretColor: accent,
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

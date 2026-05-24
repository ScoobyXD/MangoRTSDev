import type React from "react";
import type { EditorDocumentIsolationState } from "./editorTabs";
import { editorIndentGuideLeftForDepth, type EditorIndentGuideSegment } from "./editorIndentGuides";
import { EDITOR_TAB_TEXT } from "./plainTextEditing";
import { EDITOR_DOCUMENT_LINE_HEIGHT } from "./useEditorPreferences";

export type EditorDocumentSurfaceProps = {
  documentRef: React.RefObject<HTMLDivElement>;
  documentIsolation: EditorDocumentIsolationState;
  editable: boolean;
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
  editable,
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
}) => {
  const documentIsEditable = editable && documentIsolation.pointerEvents === "auto";
  return (
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
      ref={documentRef}
      className="editor-document-scroll"
      role="textbox"
      aria-label="Linked document editor"
      aria-multiline="true"
      aria-hidden={documentIsolation.ariaHidden}
      aria-readonly={!documentIsEditable || undefined}
      tabIndex={documentIsEditable ? documentIsolation.tabIndex : -1}
      contentEditable={documentIsEditable}
      suppressContentEditableWarning
      spellCheck
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
      onSelect={onSelect}
      onClick={onClick}
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
        caretColor: documentIsEditable ? caretColor : "transparent",
        cursor: documentIsEditable ? "text" : "default",
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarGutter: "stable",
        ["--editor-document-scroll-accent" as string]: scrollbarAccent,
        ["--editor-document-scroll-track" as string]: scrollbarTrack,
      }}
    />
  </>
  );
};

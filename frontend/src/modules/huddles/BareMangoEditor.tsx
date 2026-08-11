import React, { useRef, useState } from "react";
import { EditorTabBar } from "../editor/EditorTabBar";
import { MangoTiptapEditor, type MangoTiptapFormattingController } from "../editor/tiptap/MangoTiptapEditor";
import type { MangoTiptapResourceType } from "../editor/tiptap/mangoTiptapSync";
import type { EditorHighlightColor, EditorTextAlignment } from "../editor/richTextEditing";
import type { EditorOutlineStyleID } from "../editor/plainTextEditing";

type Props = {
  companyID: string;
  resourceType: MangoTiptapResourceType;
  resourceID: string;
  currentUserID?: string;
  requestJSON: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T>;
  ariaLabel: string;
};

export const BareMangoEditor: React.FC<Props> = ({ companyID, resourceType, resourceID, currentUserID, requestJSON, ariaLabel }) => {
  const controllerRef = useRef<MangoTiptapFormattingController | null>(null);
  const [outlineStyle, setOutlineStyle] = useState<EditorOutlineStyleID>("bullet-list");
  const [fontSize, setFontSize] = useState(15);
  const [inline, setInline] = useState({ bold: false, underline: false, italic: false, strikethrough: false });
  const [highlight, setHighlight] = useState<EditorHighlightColor | null>(null);
  const [alignment, setAlignment] = useState<EditorTextAlignment>("left");
  const applyInline = (command: "bold" | "underline" | "italic" | "strikethrough") => controllerRef.current?.toggleInlineFormat(command);
  return (
    <div style={{ minHeight: 0, height: "100%", display: "grid", gridTemplateRows: "42px minmax(0, 1fr)", overflow: "hidden" }}>
      <EditorTabBar
        activeTab="editor"
        outlineStyle={outlineStyle}
        accent="#0f766e"
        outlineMenuAccent="#14b8a6"
        strokeColor="rgba(15,23,42,.18)"
        surfaceText="#0f172a"
        tabBackground="#f8fafc"
        tabSelectedBackground="#ffffff"
        visibleTabIDs={["editor", "format", "outline-styles"]}
        onSelectTab={() => undefined}
        onAdjustSelectionFontSize={(delta) => { controllerRef.current?.adjustFontSize(delta); setFontSize((value) => Math.max(8, Math.min(96, value + delta))); }}
        documentFontSize={fontSize}
        onSetSelectionFontSize={(value) => { controllerRef.current?.applyFontSizeValue(value); setFontSize(value); }}
        boldActive={inline.bold}
        underlineActive={inline.underline}
        italicActive={inline.italic}
        strikethroughActive={inline.strikethrough}
        highlightColor={highlight}
        textAlignment={alignment}
        onToggleBold={() => applyInline("bold")}
        onToggleUnderline={() => applyInline("underline")}
        onToggleItalic={() => applyInline("italic")}
        onToggleStrikethrough={() => applyInline("strikethrough")}
        onSetSelectionHighlightColor={(color) => { controllerRef.current?.applyHighlightColor(color); setHighlight(color); }}
        onSetTextAlignment={(value) => { controllerRef.current?.applyTextAlignment(value); setAlignment(value); }}
        onOutlineStyleFocus={() => undefined}
        onOutlineStyleChange={setOutlineStyle}
        onInsertTable={() => controllerRef.current?.insertTable()}
        singleLine
      />
      <MangoTiptapEditor
        companyID={companyID}
        resourceType={resourceType}
        resourceID={resourceID}
        documentID={resourceID}
        currentUserID={currentUserID}
        requestJSON={requestJSON}
        ariaLabel={ariaLabel}
        placeholder="Start writing…"
        formattingControllerRef={controllerRef}
        onSelectionFontSizeChange={setFontSize}
        onSelectionInlineFormatChange={setInline}
        onSelectionHighlightColorChange={setHighlight}
        onSelectionTextAlignmentChange={setAlignment}
        style={{ height: "100%", minHeight: 0, overflowY: "auto", padding: "18px 22px", fontSize }}
      />
    </div>
  );
};

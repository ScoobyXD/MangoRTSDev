import React, { useRef, useState } from "react";
import { EditorTabBar } from "../editor/EditorTabBar";
import type { EditorTabID } from "../editor/editorTabs";
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

export type BareMangoEditorControls = {
  controllerRef: React.MutableRefObject<MangoTiptapFormattingController | null>;
  outlineStyle: EditorOutlineStyleID;
  setOutlineStyle: React.Dispatch<React.SetStateAction<EditorOutlineStyleID>>;
  fontSize: number;
  setFontSize: React.Dispatch<React.SetStateAction<number>>;
  inline: { bold: boolean; underline: boolean; italic: boolean; strikethrough: boolean };
  setInline: React.Dispatch<React.SetStateAction<{ bold: boolean; underline: boolean; italic: boolean; strikethrough: boolean }>>;
  highlight: EditorHighlightColor | null;
  setHighlight: React.Dispatch<React.SetStateAction<EditorHighlightColor | null>>;
  alignment: EditorTextAlignment;
  setAlignment: React.Dispatch<React.SetStateAction<EditorTextAlignment>>;
};

export function useBareMangoEditorControls(): BareMangoEditorControls {
  const controllerRef = useRef<MangoTiptapFormattingController | null>(null);
  const [outlineStyle, setOutlineStyle] = useState<EditorOutlineStyleID>("bullet-list");
  const [fontSize, setFontSize] = useState(15);
  const [inline, setInline] = useState({ bold: false, underline: false, italic: false, strikethrough: false });
  const [highlight, setHighlight] = useState<EditorHighlightColor | null>(null);
  const [alignment, setAlignment] = useState<EditorTextAlignment>("left");
  return { controllerRef, outlineStyle, setOutlineStyle, fontSize, setFontSize, inline, setInline, highlight, setHighlight, alignment, setAlignment };
}

export const BareMangoEditorToolbar: React.FC<{
  controls: BareMangoEditorControls;
  activeTab?: EditorTabID;
  visibleTabIDs?: readonly EditorTabID[];
  onSelectTab?: (tab: EditorTabID) => void;
  formattingDisabled?: boolean;
  reserveHeaderOffset?: boolean;
}> = ({ controls, activeTab = "editor", visibleTabIDs = ["editor", "format", "outline-styles"], onSelectTab = () => undefined, formattingDisabled = false, reserveHeaderOffset = false }) => {
  const applyInline = (command: "bold" | "underline" | "italic" | "strikethrough") => controls.controllerRef.current?.toggleInlineFormat(command);
  return (
    <EditorTabBar
      activeTab={activeTab}
      outlineStyle={controls.outlineStyle}
      accent="#334155"
      outlineMenuAccent="#14b8a6"
      strokeColor="rgba(15,23,42,.18)"
      surfaceText="#0f172a"
      tabBackground="rgba(248,250,252,.82)"
      tabSelectedBackground="#ffffff"
      visibleTabIDs={visibleTabIDs}
      onSelectTab={onSelectTab}
      onAdjustSelectionFontSize={(delta) => {
        controls.controllerRef.current?.adjustFontSize(delta);
        controls.setFontSize((value) => Math.max(8, Math.min(96, value + delta)));
      }}
      documentFontSize={controls.fontSize}
      onSetSelectionFontSize={(value) => {
        controls.controllerRef.current?.applyFontSizeValue(value);
        controls.setFontSize(value);
      }}
      boldActive={controls.inline.bold}
      underlineActive={controls.inline.underline}
      italicActive={controls.inline.italic}
      strikethroughActive={controls.inline.strikethrough}
      highlightColor={controls.highlight}
      textAlignment={controls.alignment}
      onToggleBold={() => applyInline("bold")}
      onToggleUnderline={() => applyInline("underline")}
      onToggleItalic={() => applyInline("italic")}
      onToggleStrikethrough={() => applyInline("strikethrough")}
      onSetSelectionHighlightColor={(color) => {
        controls.controllerRef.current?.applyHighlightColor(color);
        controls.setHighlight(color);
      }}
      onSetTextAlignment={(value) => {
        controls.controllerRef.current?.applyTextAlignment(value);
        controls.setAlignment(value);
      }}
      onOutlineStyleFocus={() => undefined}
      onOutlineStyleChange={controls.setOutlineStyle}
      onInsertTable={() => controls.controllerRef.current?.insertTable()}
      formattingDisabled={formattingDisabled}
      reserveHeaderOffset={reserveHeaderOffset}
      singleLine
    />
  );
};

export const BareMangoEditorDocument: React.FC<Props & { controls: BareMangoEditorControls; style?: React.CSSProperties }> = ({ companyID, resourceType, resourceID, currentUserID, requestJSON, ariaLabel, controls, style }) => (
  <MangoTiptapEditor
    companyID={companyID}
    resourceType={resourceType}
    resourceID={resourceID}
    documentID={resourceID}
    currentUserID={currentUserID}
    requestJSON={requestJSON}
    ariaLabel={ariaLabel}
    placeholder="Start writing…"
    formattingControllerRef={controls.controllerRef}
    onSelectionFontSizeChange={controls.setFontSize}
    onSelectionInlineFormatChange={controls.setInline}
    onSelectionHighlightColorChange={controls.setHighlight}
    onSelectionTextAlignmentChange={controls.setAlignment}
    style={{ height: "100%", minHeight: 0, overflowY: "auto", padding: "18px 22px", fontSize: controls.fontSize, ...style }}
  />
);

export const BareMangoEditor: React.FC<Props> = (props) => {
  const controls = useBareMangoEditorControls();
  return (
    <div style={{ minHeight: 0, height: "100%", display: "grid", gridTemplateRows: "42px minmax(0, 1fr)", overflow: "hidden" }}>
      <BareMangoEditorToolbar controls={controls} reserveHeaderOffset={false} />
      <BareMangoEditorDocument {...props} controls={controls} />
    </div>
  );
};

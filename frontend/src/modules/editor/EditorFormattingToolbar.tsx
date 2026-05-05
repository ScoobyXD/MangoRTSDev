import React, { useEffect, useState } from "react";
import type { EditorInlineFormatCommand } from "./plainTextEditing";
import { EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, EDITOR_DOCUMENT_MIN_FONT_SIZE_PX } from "./useEditorPreferences";

type EditorFormattingToolbarProps = {
  strokeColor: string;
  ruleColor: string;
  panelBackground: string;
  surfaceText: string;
  documentFontSize: number;
  onInlineFormatCommand: (command: EditorInlineFormatCommand) => void;
  onAdjustDocumentFontSize: (delta: number) => void;
  onSetDocumentFontSize: (fontSize: number) => void;
};

export const EditorFormattingToolbar: React.FC<EditorFormattingToolbarProps> = ({
  strokeColor,
  ruleColor,
  panelBackground,
  surfaceText,
  documentFontSize,
  onInlineFormatCommand,
  onAdjustDocumentFontSize,
  onSetDocumentFontSize,
}) => {
  const [fontSizeDraft, setFontSizeDraft] = useState(String(documentFontSize));

  useEffect(() => {
    setFontSizeDraft(String(documentFontSize));
  }, [documentFontSize]);

  const commitFontSizeDraft = () => {
    const parsed = Number.parseInt(fontSizeDraft, 10);
    if (!Number.isFinite(parsed)) {
      setFontSizeDraft(String(documentFontSize));
      return;
    }
    onSetDocumentFontSize(Math.max(EDITOR_DOCUMENT_MIN_FONT_SIZE_PX, Math.min(EDITOR_DOCUMENT_MAX_FONT_SIZE_PX, parsed)));
  };

  return (
  <section aria-label="Editor formatting" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", maxWidth: 720, pointerEvents: "auto" }}>
    {([
      { command: "bold" as const, label: "B", title: "Bold (Ctrl+B)", style: { fontWeight: 900 } },
      { command: "underline" as const, label: "U", title: "Underline (Ctrl+U)", style: { textDecoration: "underline" } },
      { command: "hyperlink" as const, label: "Link", title: "Hyperlink" },
    ]).map((item) => (
      <button
        key={item.command}
        type="button"
        title={item.title}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInlineFormatCommand(item.command)}
        style={{
          minWidth: item.command === "hyperlink" ? 46 : 28,
          height: 26,
          border: `1px solid ${strokeColor}`,
          background: panelBackground,
          color: surfaceText,
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 800,
          ...item.style,
        }}
      >
        {item.label}
      </button>
    ))}
    <div aria-label="Font size" style={{ display: "inline-flex", alignItems: "center", height: 26, border: `1px solid ${strokeColor}`, background: panelBackground, borderRadius: 4, overflow: "hidden" }}>
      <button type="button" title="Decrease font size" onMouseDown={(event) => event.preventDefault()} onClick={() => onAdjustDocumentFontSize(-1)} style={{ width: 28, height: "100%", border: 0, borderRight: `1px solid ${ruleColor}`, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 16, lineHeight: 1 }}>-</button>
      <input
        aria-label="Font size value"
        value={fontSizeDraft}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.currentTarget.select()}
        onChange={(event) => setFontSizeDraft(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
        onBlur={commitFontSizeDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setFontSizeDraft(String(documentFontSize));
            event.currentTarget.blur();
          }
        }}
        style={{ width: 38, height: "100%", border: 0, background: "transparent", color: surfaceText, textAlign: "center", fontSize: 12, fontWeight: 800, outline: "none", fontFamily: "inherit", padding: 0 }}
      />
      <button type="button" title="Increase font size" onMouseDown={(event) => event.preventDefault()} onClick={() => onAdjustDocumentFontSize(1)} style={{ width: 28, height: "100%", border: 0, borderLeft: `1px solid ${ruleColor}`, background: "transparent", color: surfaceText, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>+</button>
    </div>
  </section>
  );
};

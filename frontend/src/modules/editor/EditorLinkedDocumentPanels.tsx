import type React from "react";
import type { EditorTabID } from "./editorTabs";

type EditorLinkedDocumentPanelsProps = {
  activeTab: EditorTabID;
  linkedEntityKind: "" | "node" | "logic_gate";
  linkedNodeTitle: string;
  linkedNodeInfoPreview: string[];
  linkedNodeMetadataRows: Array<{ label: string; value: string }>;
  linkedNodeHistoryRows: string[];
  isEditingTitle: boolean;
  editingTitleRef: React.RefObject<HTMLSpanElement>;
  editingTitleDraftRef: React.MutableRefObject<string>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  onSetIsEditingTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateTitle: (nextTitle: string) => Promise<void>;
};

export const EditorLinkedDocumentPanels: React.FC<EditorLinkedDocumentPanelsProps> = ({
  activeTab,
  linkedEntityKind,
  linkedNodeTitle,
  linkedNodeInfoPreview,
  linkedNodeMetadataRows,
  linkedNodeHistoryRows,
  isEditingTitle,
  editingTitleRef,
  editingTitleDraftRef,
  accent,
  panelBackground,
  ruleColor,
  onSetIsEditingTitle,
  onUpdateTitle,
}) => (
  <>
    {activeTab === "editor" && (
      <div style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "0.12em", color: accent, cursor: "text" }}>
          <span style={{ textTransform: "uppercase" }}>{linkedEntityKind === "logic_gate" ? "Logic Gate:" : "Node:"}</span>&nbsp;
          <span
            ref={editingTitleRef}
            contentEditable={isEditingTitle}
            suppressContentEditableWarning
            onClick={(event) => {
              event.stopPropagation();
              if (!isEditingTitle) {
                editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
                onSetIsEditingTitle(true);
              }
            }}
            onInput={(event) => {
              editingTitleDraftRef.current = event.currentTarget.textContent ?? "";
            }}
            onBlur={() => {
              if (!isEditingTitle) return;
              const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
              void onUpdateTitle(latestTitle);
              onSetIsEditingTitle(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
                void onUpdateTitle(latestTitle);
                onSetIsEditingTitle(false);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                if (editingTitleRef.current) editingTitleRef.current.textContent = linkedNodeTitle;
                onSetIsEditingTitle(false);
              }
            }}
            style={{ outline: "none", cursor: "text" }}
          >
            {linkedNodeTitle || "\u00A0"}
          </span>
        </div>
        {linkedNodeInfoPreview.length > 0 && <div style={{ fontSize: 10, opacity: 0.7 }}>{linkedNodeInfoPreview.join(" - ")}</div>}
      </div>
    )}

    {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
      <section style={{ display: "grid", gap: 6, maxWidth: 520, pointerEvents: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>Metadata</div>
        <div style={{ display: "grid", gap: 4 }}>
          {linkedNodeMetadataRows.map((row) => (
            <div key={row.label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "4px 6px" }}>
              <span style={{ opacity: 0.75 }}>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      </section>
    )}

    {activeTab === "history" && linkedNodeHistoryRows.length > 0 && (
      <section style={{ display: "grid", gap: 6, maxWidth: 640, pointerEvents: "auto" }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>History</div>
        <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "6px 8px 6px 22px" }}>
          {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
        </ul>
      </section>
    )}
  </>
);

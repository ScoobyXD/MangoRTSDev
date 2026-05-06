import type React from "react";
import type { EditorTabID } from "./editorTabs";

type EditorLinkedDocumentPanelsProps = {
  activeTab: EditorTabID;
  linkedEntityKind: "" | "node" | "logic_gate";
  linkedNodeTitle: string;
  linkedNodeInfoPreview: string[];
  linkedNodeMetadataRows: Array<{ label: string; value: string }>;
  linkedNodeHistoryRows: string[];
  nodePresetFields: {
    status: string;
    priorityDraft: string;
    personInCharge: string;
    dueDateDraft: string;
  } | null;
  isEditingTitle: boolean;
  editingTitleRef: React.RefObject<HTMLSpanElement>;
  editingTitleDraftRef: React.MutableRefObject<string>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  onSetIsEditingTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateTitle: (nextTitle: string) => Promise<void>;
  onSetNodePriorityDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodePriorityDraft: (draft: string) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
};

export const EditorLinkedDocumentPanels: React.FC<EditorLinkedDocumentPanelsProps> = ({
  activeTab,
  linkedEntityKind,
  linkedNodeTitle,
  linkedNodeInfoPreview,
  linkedNodeMetadataRows,
  linkedNodeHistoryRows,
  nodePresetFields,
  isEditingTitle,
  editingTitleRef,
  editingTitleDraftRef,
  accent,
  panelBackground,
  ruleColor,
  onSetIsEditingTitle,
  onUpdateTitle,
  onSetNodePriorityDraft,
  onCommitNodePriorityDraft,
  onSetNodeDueDateDraft,
  onCommitNodeDueDateDraft,
}) => (
  <>
    {(activeTab === "editor" || activeTab === "outline-styles") && (
      <div style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 0, color: accent, cursor: "text" }}>
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
        {nodePresetFields && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 220px) minmax(0, 310px)",
              columnGap: 56,
              rowGap: 4,
              maxWidth: "min(640px, 100%)",
              padding: "2px 0 8px",
              borderBottom: `1px dashed ${ruleColor}`,
              fontFamily: "'IBM Plex Mono', 'Consolas', monospace",
              fontSize: 14,
              lineHeight: 1.45,
              color: "inherit",
              pointerEvents: "auto",
            }}
          >
            <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6 }}>
              <strong>Status:</strong>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodePresetFields.status || "None"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6 }}>
              <strong>Person In Charge:</strong>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nodePresetFields.personInCharge}</span>
            </div>
            <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
              <strong>Priority:</strong>
              <input
                value={nodePresetFields.priorityDraft}
                onChange={(event) => onSetNodePriorityDraft(event.target.value.replace(/[^\d]/g, "").slice(0, 1))}
                onBlur={(event) => onCommitNodePriorityDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                inputMode="numeric"
                aria-label="Priority"
                style={{ width: 42, border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none" }}
              />
            </label>
            <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
              <strong>Due Date:</strong>
              <input
                value={nodePresetFields.dueDateDraft}
                onChange={(event) => onSetNodeDueDateDraft(event.target.value)}
                onBlur={(event) => onCommitNodeDueDateDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                placeholder="mm/dd/yyyy"
                aria-label="Due date"
                style={{ width: 120, border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none" }}
              />
            </label>
          </div>
        )}
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

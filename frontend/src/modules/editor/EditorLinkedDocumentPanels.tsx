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
    assigneeUserID: string;
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
  onSetNodeAssigneeDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeAssigneeDraft: (draft: string) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
};

const NODE_PRIORITY_OPTIONS = [
  { value: "0", label: "0 Unassigned" },
  { value: "1", label: "1 Low Priority" },
  { value: "2", label: "2 Medium-Low Priority" },
  { value: "3", label: "3 Medium Priority" },
  { value: "4", label: "4 High Priority" },
  { value: "5", label: "5 URGENT" },
] as const;

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
  onSetNodeAssigneeDraft,
  onCommitNodeAssigneeDraft,
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
            <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
              <strong>Person In Charge:</strong>
              <input
                value={nodePresetFields.assigneeUserID}
                onChange={(event) => onSetNodeAssigneeDraft(event.target.value)}
                onBlur={(event) => onCommitNodeAssigneeDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
                placeholder="Unassigned"
                aria-label="Person in charge"
                style={{ width: "100%", minWidth: 0, border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none" }}
              />
            </label>
            <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
              <strong>Priority:</strong>
              <span style={{ position: "relative", display: "inline-block", width: "min(100%, 220px)" }}>
                <select
                  value={nodePresetFields.priorityDraft || "0"}
                  onChange={(event) => {
                    onSetNodePriorityDraft(event.target.value);
                    onCommitNodePriorityDraft(event.target.value);
                  }}
                  onBlur={(event) => onCommitNodePriorityDraft(event.currentTarget.value)}
                  aria-label="Priority"
                  style={{ width: "100%", appearance: "none", WebkitAppearance: "none", border: "1px solid transparent", background: "transparent", color: "inherit", font: "inherit", padding: "0 18px 0 0", outline: "none" }}
                >
                  {NODE_PRIORITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
                <svg aria-hidden="true" width="10" height="7" viewBox="0 0 10 7" style={{ position: "absolute", right: 2, top: "50%", transform: "translateY(-45%)", pointerEvents: "none", color: "currentColor" }}>
                  <path d="M1 1.25 5 5.25 9 1.25" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
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

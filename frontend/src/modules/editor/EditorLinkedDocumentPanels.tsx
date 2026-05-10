import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EditorTabID } from "./editorTabs";
import { normalizeNodeDueDateDraft } from "./editorDates";

type EditorLinkedDocumentPanelsProps = {
  activeTab: EditorTabID;
  linkedEntityKind: "" | "node" | "logic_gate";
  linkedNodeTitle: string;
  linkedNodeInfoPreview: string[];
  linkedNodeMetadataRows: Array<{ label: string; value: string }>;
  linkedNodeHistoryRows: string[];
  nodePresetFields: {
    status: string;
    statusColor: string;
    priorityDraft: string;
    assigneeDraft: string;
    dueDateDraft: string;
  } | null;
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
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
  { value: "0", label: "0 Unassigned", color: "#64748b" },
  { value: "1", label: "1 Low Priority", color: "#fbb152" },
  { value: "2", label: "2 Medium-Low Priority", color: "#fea94e" },
  { value: "3", label: "3 Medium Priority", color: "#fe9b46" },
  { value: "4", label: "4 High Priority", color: "#ff8820" },
  { value: "5", label: "5 URGENT", color: "#b91c1c" },
] as const;

function companyUserOptionLabel(user: { user_id: string; email?: string; display_name?: string }): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

function validHexColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "";
}

function hexWithAlpha(hex: string, alpha: string): string {
  const clean = validHexColor(hex);
  return clean ? `${clean}${alpha}` : "rgba(100,116,139,0.12)";
}

function dateInputValueFromDraft(draft: string): string {
  return normalizeNodeDueDateDraft(draft) ?? "";
}

function editorDateFromDateInput(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return value;
  return `${Number(match[2])}/${Number(match[3])}/${match[1]}`;
}

const PriorityCheckIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" style={{ display: "block" }}>
    <path d="m3.1 6.55 2.05 2.05 4.75-4.75" fill="none" stroke={color} strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CalendarIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <path d="M3 2.75h10v10.5H3zM3 5.5h10M5.25 1.5v2.4M10.75 1.5v2.4" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" />
  </svg>
);

const PersonIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" style={{ display: "block" }}>
    <circle cx="8" cy="5.1" r="2.35" fill="none" stroke={color} strokeWidth="1.35" />
    <path d="M3.3 13.1c.55-2.25 2.25-3.55 4.7-3.55s4.15 1.3 4.7 3.55" fill="none" stroke={color} strokeWidth="1.35" strokeLinecap="round" />
  </svg>
);

export const EditorLinkedDocumentPanels: React.FC<EditorLinkedDocumentPanelsProps> = ({
  activeTab,
  linkedEntityKind,
  linkedNodeTitle,
  linkedNodeInfoPreview,
  linkedNodeMetadataRows,
  linkedNodeHistoryRows,
  nodePresetFields,
  companyUsers,
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
}) => {
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const assigneeListID = useId();
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const assigneeMenuRef = useRef<HTMLSpanElement | null>(null);
  const priorityMenuRef = useRef<HTMLSpanElement | null>(null);
  const dueDatePickerRef = useRef<HTMLInputElement | null>(null);
  const selectedPriority = NODE_PRIORITY_OPTIONS.find((option) => option.value === (nodePresetFields?.priorityDraft || "0")) ?? NODE_PRIORITY_OPTIONS[0];
  const statusColor = validHexColor(nodePresetFields?.statusColor ?? "");
  const assigneeMatches = useMemo(() => {
    const query = (nodePresetFields?.assigneeDraft ?? "").trim().toLowerCase();
    const matches = query
      ? companyUsers.filter((user) => companyUserOptionLabel(user).toLowerCase().includes(query) || (user.email ?? "").toLowerCase().includes(query) || (user.display_name ?? "").toLowerCase().includes(query))
      : companyUsers;
    return matches.slice(0, 8);
  }, [companyUsers, nodePresetFields?.assigneeDraft]);

  useEffect(() => {
    if (!priorityMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (priorityMenuRef.current?.contains(event.target as Node)) return;
      setPriorityMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPriorityMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [priorityMenuOpen]);

  useEffect(() => {
    if (!assigneeMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (assigneeMenuRef.current?.contains(event.target as Node)) return;
      setAssigneeMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssigneeMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [assigneeMenuOpen]);

  return (
    <>
      {(activeTab === "editor" || activeTab === "outline-styles") && (
        <div style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
          <div style={{ minWidth: 0, fontSize: 18, fontWeight: 500, letterSpacing: 0, color: accent, cursor: "text", overflowWrap: "anywhere", wordBreak: "break-word" }}>
            <span>{linkedEntityKind === "logic_gate" ? "Logic Gate:" : "Node:"}</span>&nbsp;
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
              style={{ outline: "none", cursor: "text", overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {linkedNodeTitle || "\u00A0"}
            </span>
          </div>
          {nodePresetFields && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 230px), 1fr))",
                columnGap: 24,
                rowGap: 6,
                maxWidth: "min(720px, 100%)",
                padding: "2px 0 8px",
                borderBottom: `1px dashed ${ruleColor}`,
                fontFamily: "var(--mango-font-family)",
                fontSize: 13,
                lineHeight: 1.35,
                color: "inherit",
                pointerEvents: "auto",
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Status:</strong>
                <span
                  title={nodePresetFields.status || "None"}
                  style={{
                    minWidth: 0,
                    justifySelf: "start",
                    maxWidth: "100%",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    border: `1px solid ${statusColor || ruleColor}`,
                    borderRadius: 6,
                    padding: "1px 7px",
                    color: statusColor || "inherit",
                    background: statusColor ? hexWithAlpha(statusColor, "1f") : "transparent",
                    fontWeight: 600,
                  }}
                >
                  {nodePresetFields.status || "None"}
                </span>
              </div>
              <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Person In Charge:</strong>
                <span ref={assigneeMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 290px)" }}>
                  <input
                    id={assigneeListID}
                    value={nodePresetFields.assigneeDraft}
                    onFocus={() => setAssigneeMenuOpen(true)}
                    onChange={(event) => {
                      const next = event.target.value;
                      onSetNodeAssigneeDraft(next);
                      setAssigneeMenuOpen(true);
                      if (companyUsers.some((user) => companyUserOptionLabel(user) === next)) {
                        onCommitNodeAssigneeDraft(next);
                        setAssigneeMenuOpen(false);
                      }
                    }}
                    onBlur={(event) => onCommitNodeAssigneeDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        if (assigneeMatches[0]) {
                          const label = companyUserOptionLabel(assigneeMatches[0]);
                          onSetNodeAssigneeDraft(label);
                          onCommitNodeAssigneeDraft(label);
                          setAssigneeMenuOpen(false);
                        }
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="Unassigned"
                    aria-label="Person in charge"
                    aria-haspopup="listbox"
                    aria-expanded={assigneeMenuOpen}
                    aria-controls={`${assigneeListID}-options`}
                    style={{ width: "100%", minWidth: 0, minHeight: 25, boxSizing: "border-box", border: `1px solid ${assigneeMenuOpen ? accent : ruleColor}`, borderRadius: 6, background: "rgba(255,255,255,0.92)", color: "#111827", font: "inherit", fontSize: 11.5, fontWeight: 500, padding: "3px 27px 3px 8px", outline: "none" }}
                  />
                  <span aria-hidden="true" style={{ position: "absolute", right: 7, top: 5, color: accent, pointerEvents: "none" }}>
                    <PersonIcon color={accent} />
                  </span>
                  {assigneeMenuOpen && (
                    <div
                      id={`${assigneeListID}-options`}
                      role="listbox"
                      aria-label="People"
                      style={{ position: "absolute", zIndex: 30, top: "calc(100% + 5px)", left: 0, width: "min(330px, 86vw)", maxHeight: 250, overflowY: "auto", padding: "4px 0", border: `1px solid ${ruleColor}`, borderRadius: 8, background: "#ffffff", boxShadow: "0 14px 30px rgba(15,23,42,0.18)", color: "#111827" }}
                    >
                      {assigneeMatches.length === 0 ? (
                        <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>No matches</div>
                      ) : assigneeMatches.map((user) => {
                        const label = companyUserOptionLabel(user);
                        const name = (user.display_name ?? "").trim() || label;
                        const email = (user.email ?? "").trim();
                        return (
                          <button
                            key={user.user_id}
                            type="button"
                            role="option"
                            aria-selected={label === nodePresetFields.assigneeDraft}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onSetNodeAssigneeDraft(label);
                              onCommitNodeAssigneeDraft(label);
                              setAssigneeMenuOpen(false);
                            }}
                            style={{ width: "100%", minHeight: 32, display: "grid", gridTemplateColumns: "22px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "none", background: label === nodePresetFields.assigneeDraft ? "rgba(255, 136, 32, 0.18)" : "transparent", color: "#111827", cursor: "pointer", padding: "5px 10px", textAlign: "left", font: "inherit" }}
                          >
                            <span style={{ width: 22, height: 22, borderRadius: 6, display: "grid", placeItems: "center", background: "rgba(255, 136, 32, 0.13)", color: accent }}>
                              <PersonIcon color={accent} />
                            </span>
                            <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 500 }}>{name}</span>
                              {email && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{email}</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
              </label>
              <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Priority:</strong>
                <span ref={priorityMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 250px)" }}>
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={priorityMenuOpen}
                    onClick={() => setPriorityMenuOpen((open) => !open)}
                    style={{
                      width: "100%",
                      minHeight: 26,
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 18px",
                      alignItems: "center",
                      gap: 7,
                      border: `1px solid ${selectedPriority.color}66`,
                      borderRadius: 6,
                      background: hexWithAlpha(selectedPriority.color, "14"),
                      color: selectedPriority.color,
                      font: "inherit",
                      fontSize: 11.5,
                      fontWeight: 600,
                      padding: "3px 8px",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPriority.label}</span>
                    <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: "currentColor" }}>
                      {selectedPriority.value !== "0" ? <PriorityCheckIcon color={selectedPriority.color} /> : null}
                    </span>
                  </button>
                  {priorityMenuOpen && (
                    <div
                      role="listbox"
                      aria-label="Priority"
                      style={{
                        position: "absolute",
                        zIndex: 30,
                        top: "calc(100% + 5px)",
                        left: 0,
                        width: "min(270px, 86vw)",
                        padding: 5,
                        border: `1px solid ${ruleColor}`,
                        borderRadius: 8,
                        background: "#ffffff",
                        boxShadow: "0 14px 30px rgba(15,23,42,0.18)",
                        color: "#111827",
                      }}
                    >
                      {NODE_PRIORITY_OPTIONS.map((option) => {
                        const selected = option.value === selectedPriority.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onClick={() => {
                              onSetNodePriorityDraft(option.value);
                              onCommitNodePriorityDraft(option.value);
                              setPriorityMenuOpen(false);
                            }}
                            style={{
                              width: "100%",
                              display: "grid",
                              gridTemplateColumns: "minmax(0, 1fr) 18px",
                              alignItems: "center",
                              gap: 8,
                              border: "none",
                              borderRadius: 6,
                              background: selected ? hexWithAlpha(option.color, "18") : "transparent",
                              color: selected ? option.color : "#1f2937",
                              font: "inherit",
                              fontSize: 11.5,
                              fontWeight: 500,
                              padding: "7px 8px",
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                          >
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                            <span aria-hidden="true" style={{ display: "grid", placeItems: "center" }}>
                              {selected ? <PriorityCheckIcon color={option.color} /> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
              </label>
              <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Due Date:</strong>
                <span style={{ position: "relative", display: "inline-grid", gridTemplateColumns: "minmax(0, 1fr) 24px", alignItems: "center", width: 148 }}>
                  <input
                    value={nodePresetFields.dueDateDraft}
                    onChange={(event) => onSetNodeDueDateDraft(event.target.value)}
                    onBlur={(event) => onCommitNodeDueDateDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    placeholder="mm/dd/yyyy"
                    aria-label="Due date"
                    style={{ width: "100%", minWidth: 0, border: "1px solid transparent", borderRight: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none" }}
                  />
                  <button
                    type="button"
                    title="Choose due date"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      const picker = dueDatePickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
                      if (!picker) return;
                      if (picker.showPicker) picker.showPicker();
                      else picker.click();
                    }}
                    style={{ width: 24, height: 24, border: `1px solid ${ruleColor}`, borderRadius: 5, background: panelBackground, color: accent, display: "grid", placeItems: "center", cursor: "pointer", padding: 0 }}
                  >
                    <CalendarIcon color={accent} />
                  </button>
                  <input
                    ref={dueDatePickerRef}
                    type="date"
                    tabIndex={-1}
                    value={dateInputValueFromDraft(nodePresetFields.dueDateDraft)}
                    onChange={(event) => {
                      const next = editorDateFromDateInput(event.currentTarget.value);
                      onSetNodeDueDateDraft(next);
                      onCommitNodeDueDateDraft(next);
                    }}
                    aria-hidden="true"
                    style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  />
                </span>
              </label>
            </div>
          )}
          {linkedNodeInfoPreview.length > 0 && <div style={{ minWidth: 0, fontSize: 10, opacity: 0.7, overflowWrap: "anywhere", wordBreak: "break-word" }}>{linkedNodeInfoPreview.join(" - ")}</div>}
        </div>
      )}

      {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
        <section style={{ display: "grid", gap: 6, maxWidth: 520, pointerEvents: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0, color: accent }}>Metadata</div>
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
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0, color: accent }}>History</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "6px 8px 6px 22px" }}>
            {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
          </ul>
        </section>
      )}
    </>
  );
};

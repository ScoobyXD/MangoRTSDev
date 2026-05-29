import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EditorTabID } from "./editorTabs";
import { normalizeNodeDueDateDraft } from "./editorDates";
import type { LogicGateRaciAssignment, LogicGateRaciRole } from "../logic-gate-map/shared";
import {
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_VERIFY_COLOR,
} from "../kanban/shared";
import {
  avatarBackgroundForName,
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_BACKGROUND,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
  initialsForName,
  userAccentForName,
} from "./NodeWorkspaceSurfaceShared";

type EditorLinkedDocumentPanelsProps = {
  activeTab: EditorTabID;
  linkedEntityKind: "" | "node" | "logic_gate";
  linkedNodeTitle: string;
  linkedNodeInfoPreview: string[];
  linkedNodeMetadataRows: Array<{ label: string; value: string }>;
  linkedNodeHistoryRows: string[];
  canEdit: boolean;
  canEditRaci?: boolean;
  nodePresetFields: {
    status: string;
    statusColor: string;
    priorityDraft: string;
    priorityRequirementError?: string;
    assigneeDraft: string;
    dueDateDraft: string;
  } | null;
  logicGateRaciFields: {
    assignments: LogicGateRaciAssignment[];
  } | null;
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  isEditingTitle: boolean;
  editingTitleRef: React.RefObject<HTMLSpanElement>;
  editingTitleDraftRef: React.MutableRefObject<string>;
  accent: string;
  titleTextColor: string;
  panelBackground: string;
  ruleColor: string;
  onSetIsEditingTitle: React.Dispatch<React.SetStateAction<boolean>>;
  onUpdateTitle: (nextTitle: string) => Promise<void>;
  onCommitNodeStatus: (statusKey: string, statusLabel: string, statusColor: string) => void;
  onSetNodePriorityDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodePriorityDraft: (draft: string) => void;
  onSetNodeAssigneeDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeAssigneeDraft: (draft: string) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
  onAddLogicGateRaciUser: (role: LogicGateRaciRole, userID: string) => void;
  onRemoveLogicGateRaciUser: (role: LogicGateRaciRole, userID: string) => void;
};

const NODE_PRIORITY_OPTIONS = [
  { value: "1", label: "1\u00A0\u00A0URGENT(<1hr)", color: "#334155" },
  { value: "2", label: "2\u00A0\u00A0By end of day", color: "#475569" },
  { value: "3", label: "3\u00A0\u00A0Tomorrow", color: "#334155" },
  { value: "4", label: "4\u00A0\u00A0Sprint (1 week)", color: "#64748b" },
  { value: "5", label: "5\u00A0\u00A0Later (low priority)", color: "#64748b" },
  { value: "0", label: "Unassigned to a Logic Gate", color: "#64748b" },
] as const;

type NodeStatusValue = "pending" | "in_progress" | "verify" | "done";

const NODE_STATUS_OPTIONS: ReadonlyArray<{ value: NodeStatusValue; label: string; storageStatus: string; color: string }> = [
  { value: "pending", label: "pending", storageStatus: "Pending", color: KANBAN_LOGIC_GATE_PENDING_COLOR },
  { value: "in_progress", label: "in progress", storageStatus: "In Progress", color: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR },
  { value: "verify", label: "verify", storageStatus: "Verify", color: KANBAN_LOGIC_GATE_VERIFY_COLOR },
  { value: "done", label: "done", storageStatus: "Done", color: KANBAN_LOGIC_GATE_DONE_COLOR },
];

const LOGIC_GATE_RACI_ROLES: ReadonlyArray<{ role: LogicGateRaciRole; label: string }> = [
  { role: "responsible", label: "Responsible" },
  { role: "accountable", label: "Accountable" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
];

const RACI_ROLE_ACCENTS: Record<LogicGateRaciRole, string> = {
  responsible: "#0891b2",
  accountable: "#db2777",
  consulted: "#7c3aed",
  informed: "#059669",
};

function companyUserOptionLabel(user: { user_id: string; email?: string; display_name?: string }): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

function raciAssignmentLabel(assignment: LogicGateRaciAssignment): string {
  const name = (assignment.user_display_name ?? "").trim();
  const email = (assignment.user_email ?? "").trim();
  return name || email || assignment.user_id;
}

function findCompanyUserByDraft(users: Array<{ user_id: string; email?: string; display_name?: string }>, draft: string) {
  const value = draft.trim().toLowerCase();
  if (!value) return null;
  return users.find((user) => {
    const labels = [
      companyUserOptionLabel(user),
      user.display_name ?? "",
      user.email ?? "",
      user.user_id,
    ];
    return labels.some((label) => label.trim().toLowerCase() === value);
  }) ?? null;
}

function validHexColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "";
}

function normalizeNodeStatusValue(value: string): NodeStatusValue | "" {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "pending" || normalized === "p") return "pending";
  if (normalized === "in_progress" || normalized === "ip") return "in_progress";
  if (normalized === "verify" || normalized === "verification" || normalized === "v") return "verify";
  if (normalized === "done" || normalized === "d") return "done";
  return "";
}

function hexWithAlpha(hex: string, alpha: string): string {
  const clean = validHexColor(hex);
  return clean ? `${clean}${alpha}` : "rgba(100,116,139,0.12)";
}

function focusEditableTitleAtEnd(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
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
  canEdit,
  canEditRaci = canEdit,
  nodePresetFields,
  logicGateRaciFields,
  companyUsers,
  isEditingTitle,
  editingTitleRef,
  editingTitleDraftRef,
  accent,
  titleTextColor,
  panelBackground,
  ruleColor,
  onSetIsEditingTitle,
  onUpdateTitle,
  onCommitNodeStatus,
  onSetNodePriorityDraft,
  onCommitNodePriorityDraft,
  onSetNodeAssigneeDraft,
  onCommitNodeAssigneeDraft,
  onSetNodeDueDateDraft,
  onCommitNodeDueDateDraft,
  onAddLogicGateRaciUser,
  onRemoveLogicGateRaciUser,
}) => {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [hoveredStatusValue, setHoveredStatusValue] = useState<NodeStatusValue | "">("");
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const statusMenuRef = useRef<HTMLSpanElement | null>(null);
  const assigneeListID = useId();
  const [assigneeMenuOpen, setAssigneeMenuOpen] = useState(false);
  const assigneeMenuRef = useRef<HTMLSpanElement | null>(null);
  const priorityMenuRef = useRef<HTMLSpanElement | null>(null);
  const dueDatePickerRef = useRef<HTMLInputElement | null>(null);
  const selectedPriority = NODE_PRIORITY_OPTIONS.find((option) => option.value === (nodePresetFields?.priorityDraft || "0")) ?? NODE_PRIORITY_OPTIONS[0];
  const priorityRequirementError = nodePresetFields?.priorityRequirementError ?? "";
  const priorityHasRequirementError = Boolean(priorityRequirementError);
  const statusColor = validHexColor(nodePresetFields?.statusColor ?? "");
  const selectedStatus = NODE_STATUS_OPTIONS.find((option) => option.value === normalizeNodeStatusValue(nodePresetFields?.status ?? ""));
  const displayStatusColor = selectedStatus?.color ?? statusColor;
  const displayStatusLabel = selectedStatus?.label ?? (nodePresetFields?.status || "none");
  const assigneeMatches = useMemo(() => {
    const query = (nodePresetFields?.assigneeDraft ?? "").trim().toLowerCase();
    const matches = query
      ? companyUsers.filter((user) => companyUserOptionLabel(user).toLowerCase().includes(query) || (user.email ?? "").toLowerCase().includes(query) || (user.display_name ?? "").toLowerCase().includes(query))
      : companyUsers;
    return matches.slice(0, 8);
  }, [companyUsers, nodePresetFields?.assigneeDraft]);

  useEffect(() => {
    if (canEdit) return;
    setStatusMenuOpen(false);
    setPriorityMenuOpen(false);
    setAssigneeMenuOpen(false);
    onSetIsEditingTitle(false);
  }, [canEdit, onSetIsEditingTitle]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (statusMenuRef.current?.contains(event.target as Node)) return;
      setStatusMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setStatusMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [statusMenuOpen]);

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

  const beginTitleEditAtEnd = () => {
    if (!canEdit) return;
    if (!isEditingTitle) {
      editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
      onSetIsEditingTitle(true);
    }
    window.requestAnimationFrame(() => focusEditableTitleAtEnd(editingTitleRef.current));
  };

  return (
    <>
      {(activeTab === "editor" || activeTab === "outline-styles") && (
        <div className="mango-editor-hover-highlight" style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
          <div
            onMouseDown={(event) => {
              if (!canEdit) return;
              event.preventDefault();
              event.stopPropagation();
              beginTitleEditAtEnd();
            }}
            style={{
              minWidth: 0,
              maxWidth: "min(780px, 100%)",
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              border: isEditingTitle ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
              borderRadius: 12,
              background: isEditingTitle ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_SURFACE,
              boxShadow: isEditingTitle ? "8px 8px 20px rgba(174,174,192,0.22), -7px -7px 16px rgba(255,255,255,0.90), 0 0 18px rgba(183,124,255,0.14), inset 1px 1px 0 rgba(255,255,255,0.88)" : EDITOR_NEU_SHADOW,
              padding: "7px 10px",
              fontSize: 18,
              fontWeight: 500,
              letterSpacing: 0,
              color: titleTextColor,
              cursor: canEdit ? "text" : "default",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
            }}
          >
            <span style={{ flex: "0 0 auto" }}>{linkedEntityKind === "logic_gate" ? "Logic Gate:" : "Node:"}</span>
            <span
              ref={editingTitleRef}
              contentEditable={canEdit && isEditingTitle}
              suppressContentEditableWarning
              onClick={(event) => {
                event.stopPropagation();
                beginTitleEditAtEnd();
              }}
              onInput={(event) => {
                if (!canEdit) return;
                editingTitleDraftRef.current = event.currentTarget.textContent ?? "";
              }}
              onBlur={() => {
                if (!canEdit || !isEditingTitle) return;
                const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
                void onUpdateTitle(latestTitle);
                onSetIsEditingTitle(false);
              }}
              onKeyDown={(event) => {
                if (!canEdit) {
                  event.preventDefault();
                  return;
                }
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
              style={{ minWidth: 0, flex: "1 1 auto", outline: "none", cursor: canEdit ? "text" : "default", caretColor: canEdit ? titleTextColor : "transparent", overflowWrap: "anywhere", wordBreak: "break-word" }}
            >
              {linkedNodeTitle || "\u00A0"}
            </span>
          </div>
          {nodePresetFields && (
            <div
              className="mango-editor-hover-highlight"
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
                <span ref={statusMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 170px)" }}>
                  <button
                    type="button"
                    title={displayStatusLabel}
                    aria-haspopup="listbox"
                    aria-expanded={canEdit && statusMenuOpen}
                    disabled={!canEdit}
                    onClick={() => {
                      if (!canEdit) return;
                      setStatusMenuOpen((open) => !open);
                    }}
                    style={{
                      width: "100%",
                      minHeight: 27,
                      display: "grid",
                      gridTemplateColumns: "minmax(0, 1fr) 14px",
                      alignItems: "center",
                      gap: 7,
                      border: `1px solid ${displayStatusColor || ruleColor}`,
                      borderRadius: 9,
                      background: displayStatusColor ? `linear-gradient(135deg, ${hexWithAlpha(displayStatusColor, "24")}, rgba(255,255,255,0.84))` : EDITOR_NEU_ACTIVE_SURFACE,
                      color: displayStatusColor || "inherit",
                      font: "inherit",
                      fontSize: 11.5,
                      fontWeight: 800,
                      padding: "3px 8px",
                      cursor: canEdit ? "pointer" : "default",
                      opacity: canEdit ? 1 : 0.66,
                      textAlign: "left",
                      boxShadow: "3px 3px 8px rgba(174,174,192,0.16), -3px -3px 8px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.82)",
                    }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayStatusLabel}</span>
                    <span aria-hidden="true" style={{ width: 0, height: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "5px solid currentColor", justifySelf: "center", opacity: 0.8 }} />
                  </button>
                  {canEdit && statusMenuOpen && (
                    <div
                      role="listbox"
                      aria-label="Status"
                      onMouseLeave={() => setHoveredStatusValue("")}
                      style={{
                        position: "absolute",
                        zIndex: 32,
                        top: "calc(100% + 6px)",
                        left: 0,
                        width: "min(210px, 86vw)",
                        padding: 6,
                        border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                        borderRadius: 13,
                        background: EDITOR_NEU_PANEL_BACKGROUND,
                        boxShadow: EDITOR_NEU_PANEL_SHADOW,
                        color: "#111827",
                      }}
                    >
                      {NODE_STATUS_OPTIONS.map((option) => {
                        const selected = option.value === selectedStatus?.value;
                        const highlighted = hoveredStatusValue === option.value || selected;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseEnter={() => setHoveredStatusValue(option.value)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onCommitNodeStatus(option.value, option.storageStatus, option.color);
                              setStatusMenuOpen(false);
                              setHoveredStatusValue("");
                            }}
                            style={{
                              width: "100%",
                              minHeight: 32,
                              display: "grid",
                              gridTemplateColumns: "10px minmax(0, 1fr)",
                              alignItems: "center",
                              gap: 8,
                              border: highlighted ? "1px solid transparent" : "1px solid transparent",
                              borderRadius: 10,
                              background: highlighted ? `linear-gradient(135deg, ${hexWithAlpha(option.color, "2e")}, rgba(255,255,255,0.88)) padding-box, linear-gradient(135deg, ${hexWithAlpha(option.color, "cc")}, rgba(255,255,255,0.88)) border-box` : "transparent",
                              color: highlighted ? option.color : "#1f2937",
                              cursor: "pointer",
                              padding: "6px 8px",
                              textAlign: "left",
                              font: "inherit",
                              fontSize: 11.5,
                              fontWeight: highlighted ? 850 : 650,
                              boxShadow: highlighted ? `0 9px 20px ${hexWithAlpha(option.color, "1f")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : undefined,
                            }}
                          >
                            <span aria-hidden="true" style={{ width: 9, height: 9, borderRadius: 999, background: option.color, boxShadow: `0 0 10px ${hexWithAlpha(option.color, "66")}` }} />
                            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{option.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </span>
              </div>
              <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Person In Charge:</strong>
                <span ref={assigneeMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 290px)" }}>
                  <input
                    id={assigneeListID}
                    value={nodePresetFields.assigneeDraft}
                    disabled={!canEdit}
                    readOnly={!canEdit}
                    onFocus={() => { if (canEdit) setAssigneeMenuOpen(true); }}
                    onChange={(event) => {
                      if (!canEdit) return;
                      const next = event.target.value;
                      onSetNodeAssigneeDraft(next);
                      setAssigneeMenuOpen(true);
                      if (companyUsers.some((user) => companyUserOptionLabel(user) === next)) {
                        onCommitNodeAssigneeDraft(next);
                        setAssigneeMenuOpen(false);
                      }
                    }}
                    onBlur={(event) => { if (canEdit) onCommitNodeAssigneeDraft(event.currentTarget.value); }}
                    onKeyDown={(event) => {
                      if (!canEdit) {
                        event.preventDefault();
                        return;
                      }
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
                    aria-expanded={canEdit && assigneeMenuOpen}
                    aria-controls={`${assigneeListID}-options`}
                    style={{ width: "100%", minWidth: 0, minHeight: 25, boxSizing: "border-box", border: assigneeMenuOpen ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 9, background: assigneeMenuOpen ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : EDITOR_NEU_ACTIVE_SURFACE, color: nodePresetFields.assigneeDraft ? userAccentForName(nodePresetFields.assigneeDraft) : "#111827", font: "inherit", fontSize: 11.5, fontWeight: 750, padding: "3px 27px 3px 8px", outline: "none", caretColor: canEdit ? "#111827" : "transparent", cursor: canEdit ? "text" : "default", boxShadow: "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.82)" }}
                  />
                  <span aria-hidden="true" style={{ position: "absolute", right: 7, top: 5, color: accent, pointerEvents: "none" }}>
                    <PersonIcon color={accent} />
                  </span>
                  {canEdit && assigneeMenuOpen && (
                    <div
                      id={`${assigneeListID}-options`}
                      role="listbox"
                      aria-label="People"
                      style={{ position: "absolute", zIndex: 30, top: "calc(100% + 5px)", left: 0, width: "min(330px, 86vw)", maxHeight: 250, overflowY: "auto", padding: 5, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 12, background: EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
                    >
                      {assigneeMatches.length === 0 ? (
                        <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>No matches</div>
                      ) : assigneeMatches.map((user) => {
                        const label = companyUserOptionLabel(user);
                        const name = (user.display_name ?? "").trim() || label;
                        const email = (user.email ?? "").trim();
                        const selected = label === nodePresetFields.assigneeDraft;
                        const userAccent = userAccentForName(name || user.user_id);
                        return (
                          <button
                            key={user.user_id}
                            type="button"
                            role="option"
                            aria-selected={selected}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              onSetNodeAssigneeDraft(label);
                              onCommitNodeAssigneeDraft(label);
                              setAssigneeMenuOpen(false);
                            }}
                            style={{ width: "100%", minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "1px solid transparent", borderRadius: 10, background: selected ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box` : "transparent", color: "#111827", cursor: "pointer", padding: "5px 8px", textAlign: "left", font: "inherit", boxShadow: selected ? "0 8px 20px rgba(15,23,42,0.10), 0 0 12px rgba(183,124,255,0.16), inset 1px 1px 0 rgba(255,255,255,0.86)" : undefined }}
                          >
                            <span style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: avatarBackgroundForName(name || user.user_id), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.76)" }}>
                              {initialsForName(name || user.user_id)}
                            </span>
                            <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: userAccent }}>{name}</span>
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
                <strong>Due Date:</strong>
                <span style={{ position: "relative", display: "inline-grid", gridTemplateColumns: "minmax(0, 1fr) 24px", alignItems: "center", width: 148 }}>
                  <input
                    value={nodePresetFields.dueDateDraft}
                    disabled={!canEdit}
                    readOnly={!canEdit}
                    onChange={(event) => { if (canEdit) onSetNodeDueDateDraft(event.target.value); }}
                    onBlur={(event) => { if (canEdit) onCommitNodeDueDateDraft(event.currentTarget.value); }}
                    onKeyDown={(event) => {
                      if (!canEdit) {
                        event.preventDefault();
                        return;
                      }
                      if (event.key === "Enter") event.currentTarget.blur();
                    }}
                    placeholder="mm/dd/yyyy"
                    aria-label="Due date"
                    style={{ width: "100%", minWidth: 0, border: "1px solid transparent", borderRight: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0, outline: "none", caretColor: canEdit ? "auto" : "transparent", cursor: canEdit ? "text" : "default" }}
                  />
                  <button
                    type="button"
                    title="Choose due date"
                    disabled={!canEdit}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!canEdit) return;
                      const picker = dueDatePickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
                      if (!picker) return;
                      if (picker.showPicker) picker.showPicker();
                      else picker.click();
                    }}
                    style={{ width: 24, height: 24, border: `1px solid ${ruleColor}`, borderRadius: 5, background: panelBackground, color: accent, display: "grid", placeItems: "center", cursor: canEdit ? "pointer" : "default", opacity: canEdit ? 1 : 0.46, padding: 0 }}
                  >
                    <CalendarIcon color={accent} />
                  </button>
                  <input
                    ref={dueDatePickerRef}
                    type="date"
                    tabIndex={-1}
                    disabled={!canEdit}
                    value={dateInputValueFromDraft(nodePresetFields.dueDateDraft)}
                    onChange={(event) => {
                      if (!canEdit) return;
                      const next = editorDateFromDateInput(event.currentTarget.value);
                      onSetNodeDueDateDraft(next);
                      onCommitNodeDueDateDraft(next);
                    }}
                    aria-hidden="true"
                    style={{ position: "absolute", right: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                  />
                </span>
              </label>
              <label style={{ display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
                <strong style={{ paddingTop: 3 }}>Priority:</strong>
                <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <span ref={priorityMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 250px)" }}>
                    <button
                      type="button"
                      aria-haspopup="listbox"
                      aria-expanded={canEdit && priorityMenuOpen}
                      aria-invalid={priorityHasRequirementError}
                      disabled={!canEdit}
                      onClick={() => {
                        if (!canEdit) return;
                        setPriorityMenuOpen((open) => !open);
                      }}
                      style={{
                        width: "100%",
                        minHeight: 26,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 18px",
                        alignItems: "center",
                        gap: 7,
                        border: `1px solid ${priorityHasRequirementError ? "#334155" : `${selectedPriority.color}66`}`,
                        borderRadius: 6,
                        background: priorityHasRequirementError ? "rgba(100,116,139,0.08)" : hexWithAlpha(selectedPriority.color, "14"),
                        color: priorityHasRequirementError ? "#334155" : selectedPriority.color,
                        font: "inherit",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "3px 8px",
                        cursor: canEdit ? "pointer" : "default",
                        opacity: canEdit ? 1 : 0.62,
                        textAlign: "left",
                        boxShadow: priorityHasRequirementError ? "0 0 0 2px rgba(100,116,139,0.18)" : "none",
                      }}
                    >
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPriority.label}</span>
                      <span aria-hidden="true" style={{ display: "grid", placeItems: "center", color: "currentColor" }}>
                        {selectedPriority.value !== "0" ? <PriorityCheckIcon color={priorityHasRequirementError ? "#334155" : selectedPriority.color} /> : null}
                      </span>
                    </button>
                    {canEdit && priorityMenuOpen && (
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
                  {priorityRequirementError && <span style={{ color: "#b00020", fontSize: 11, fontWeight: 800, lineHeight: 1.2 }}>{priorityRequirementError}</span>}
                </span>
              </label>
            </div>
          )}
          {logicGateRaciFields && (
            <div
              className="mango-editor-hover-highlight"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 176px), 1fr))",
                columnGap: 10,
                rowGap: 10,
                maxWidth: "min(840px, 100%)",
                padding: "2px 0 8px",
                borderBottom: `1px dashed ${ruleColor}`,
                fontFamily: "var(--mango-font-family)",
                fontSize: 12,
                lineHeight: 1.3,
                color: "inherit",
                pointerEvents: "auto",
              }}
            >
              {LOGIC_GATE_RACI_ROLES.map((column) => (
                <LogicGateRaciRoleEditor
                  key={column.role}
                  role={column.role}
                  label={column.label}
                  assignments={logicGateRaciFields.assignments.filter((assignment) => assignment.role === column.role)}
                  companyUsers={companyUsers}
                  accent={accent}
                  panelBackground={panelBackground}
                  ruleColor={ruleColor}
                  canEdit={canEditRaci}
                  onAddUser={onAddLogicGateRaciUser}
                  onRemoveUser={onRemoveLogicGateRaciUser}
                />
              ))}
            </div>
          )}
          {linkedNodeInfoPreview.length > 0 && <div style={{ minWidth: 0, fontSize: 10, opacity: 0.7, overflowWrap: "anywhere", wordBreak: "break-word" }}>{linkedNodeInfoPreview.join(" - ")}</div>}
        </div>
      )}

      {activeTab === "metadata" && linkedNodeMetadataRows.length > 0 && (
        <section className="mango-editor-hover-highlight" style={{ display: "grid", gap: 6, maxWidth: 520, pointerEvents: "auto" }}>
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
        <section className="mango-editor-hover-highlight" style={{ display: "grid", gap: 6, maxWidth: 640, pointerEvents: "auto" }}>
          <div style={{ fontSize: 10, fontWeight: 500, letterSpacing: 0, color: accent }}>History</div>
          <ul style={{ margin: 0, paddingLeft: 16, display: "grid", gap: 3, fontSize: 11, background: panelBackground, border: `1px solid ${ruleColor}`, borderRadius: 6, padding: "6px 8px 6px 22px" }}>
            {linkedNodeHistoryRows.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}
          </ul>
        </section>
      )}
    </>
  );
};

function LogicGateRaciRoleEditor({
  role,
  label,
  assignments,
  companyUsers,
  accent,
  panelBackground,
  ruleColor,
  canEdit,
  onAddUser,
  onRemoveUser,
}: {
  role: LogicGateRaciRole;
  label: string;
  assignments: LogicGateRaciAssignment[];
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  canEdit: boolean;
  onAddUser: (role: LogicGateRaciRole, userID: string) => void;
  onRemoveUser: (role: LogicGateRaciRole, userID: string) => void;
}) {
  const inputID = useId();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const assignedIDs = useMemo(() => new Set(assignments.map((assignment) => assignment.user_id)), [assignments]);
  const roleAccent = RACI_ROLE_ACCENTS[role];
  const matches = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const candidates = companyUsers.filter((user) => !assignedIDs.has(user.user_id));
    const filtered = query
      ? candidates.filter((user) => companyUserOptionLabel(user).toLowerCase().includes(query) || (user.email ?? "").toLowerCase().includes(query) || (user.display_name ?? "").toLowerCase().includes(query))
      : candidates;
    return filtered.slice(0, 8);
  }, [assignedIDs, companyUsers, draft]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (canEdit) return;
    setOpen(false);
    setDraft("");
  }, [canEdit]);

  const addUser = (userID: string) => {
    if (!canEdit) return;
    onAddUser(role, userID);
    setDraft("");
    setOpen(false);
  };

  const commitDraft = () => {
    if (!canEdit) return;
    const selected = findCompanyUserByDraft(companyUsers, draft) ?? matches[0] ?? null;
    if (!selected || assignedIDs.has(selected.user_id)) return;
    addUser(selected.user_id);
  };

  return (
    <div
      style={{
        minWidth: 0,
        display: "grid",
        gap: 8,
        alignContent: "start",
        border: "1px solid transparent",
        borderRadius: 14,
        background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(roleAccent, "12")}) padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "aa")}, rgba(255,255,255,0.84)) border-box`,
        boxShadow: "7px 7px 18px rgba(174,174,192,0.22), -7px -7px 18px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.86)",
        padding: 9,
      }}
    >
      <strong style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
        <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: roleAccent, boxShadow: `0 0 12px ${hexWithAlpha(roleAccent, "66")}` }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </strong>
      <div style={{ minHeight: 34, display: "flex", flexWrap: "wrap", gap: 5, alignContent: "start" }}>
        {assignments.length === 0 ? (
          <span style={{ color: "rgba(15,23,42,0.52)", fontSize: 11, fontWeight: 650 }}>No people</span>
        ) : assignments.map((assignment) => {
          const assignmentLabel = raciAssignmentLabel(assignment);
          const assignmentAccent = userAccentForName(assignmentLabel || assignment.user_id);
          return (
            <span
              key={`${assignment.role}:${assignment.user_id}`}
              title={assignment.user_email || assignment.user_id}
              style={{ minWidth: 0, maxWidth: "100%", display: "inline-grid", gridTemplateColumns: canEdit ? "18px minmax(0, 1fr) 16px" : "18px minmax(0, 1fr)", alignItems: "center", gap: 5, border: `1px solid ${hexWithAlpha(roleAccent, "30")}`, borderRadius: 999, background: EDITOR_NEU_SURFACE, padding: canEdit ? "2px 3px 2px 4px" : "2px 7px 2px 4px", color: "inherit", boxShadow: "2px 2px 7px rgba(174,174,192,0.16), -2px -2px 7px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.82)" }}
            >
              <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 999, display: "grid", placeItems: "center", background: avatarBackgroundForName(assignmentLabel || assignment.user_id), color: "#ffffff", fontSize: 7.5, fontWeight: 900 }}>
                {initialsForName(assignmentLabel || assignment.user_id)}
              </span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800, color: assignmentAccent }}>{assignmentLabel}</span>
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${assignmentLabel} from ${label}`}
                  onClick={() => onRemoveUser(role, assignment.user_id)}
                  style={{ width: 16, height: 16, display: "grid", placeItems: "center", border: "none", borderRadius: 5, background: hexWithAlpha(roleAccent, "16"), color: roleAccent || accent, cursor: "pointer", padding: 0, font: "inherit", fontSize: 11, fontWeight: 800 }}
                >
                  x
                </button>
              )}
            </span>
          );
        })}
      </div>
      <div ref={menuRef} style={{ position: "relative", minWidth: 0 }}>
        <input
          id={inputID}
          value={draft}
          disabled={!canEdit}
          readOnly={!canEdit}
          onFocus={() => { if (canEdit) setOpen(true); }}
          onChange={(event) => {
            if (!canEdit) return;
            const next = event.currentTarget.value;
            setDraft(next);
            setOpen(true);
            const exact = findCompanyUserByDraft(companyUsers, next);
            if (exact && !assignedIDs.has(exact.user_id) && companyUserOptionLabel(exact) === next) addUser(exact.user_id);
          }}
          onKeyDown={(event) => {
            if (!canEdit) {
              event.preventDefault();
              return;
            }
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
          }}
          placeholder="Add person"
          aria-label={`Add ${label} person`}
          aria-haspopup="listbox"
          aria-expanded={canEdit && open}
          aria-controls={`${inputID}-options`}
          style={{ width: "100%", minWidth: 0, minHeight: 32, boxSizing: "border-box", border: open ? "1px solid transparent" : `1px solid ${hexWithAlpha(roleAccent, "46")}`, borderRadius: 11, background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "cc")}, rgba(255,255,255,0.86)) border-box` : EDITOR_NEU_SURFACE, color: "#111827", font: "inherit", fontSize: 11.5, fontWeight: 750, padding: "5px 9px", outline: "none", caretColor: canEdit ? "#111827" : "transparent", cursor: canEdit ? "text" : "default", boxShadow: open ? `0 10px 22px ${hexWithAlpha(roleAccent, "1f")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "4px 4px 12px rgba(174,174,192,0.20), -4px -4px 12px rgba(255,255,255,0.84), inset 1px 1px 0 rgba(255,255,255,0.86)" }}
        />
        {canEdit && open && (
          <div
            id={`${inputID}-options`}
            role="listbox"
            aria-label={`${label} people`}
            style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, width: "min(330px, 86vw)", maxHeight: 250, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {matches.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>{companyUsers.length === assignedIDs.size ? "All people added" : "No matches"}</div>
            ) : matches.map((user) => {
              const optionLabel = companyUserOptionLabel(user);
              const name = (user.display_name ?? "").trim() || optionLabel;
              const email = (user.email ?? "").trim();
              const optionAccent = userAccentForName(name || user.user_id);
              return (
                <button
                  key={user.user_id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addUser(user.user_id)}
                  style={{ width: "100%", minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "1px solid transparent", borderRadius: 10, background: "transparent", color: "#111827", cursor: "pointer", padding: "5px 8px", textAlign: "left", font: "inherit", boxShadow: `inset 0 0 0 1px ${ruleColor || "transparent"}` }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: avatarBackgroundForName(name || user.user_id), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.76)" }}>
                    {initialsForName(name || user.user_id)}
                  </span>
                  <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: optionAccent }}>{name}</span>
                    {email && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{email}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

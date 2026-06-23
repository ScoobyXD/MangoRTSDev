import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EditorTabID } from "./editorTabs";
import { normalizeNodeDueDateDraft } from "./editorDates";
import { AccountFilterControl } from "../accounts/AccountFilterControl";
import type { Account } from "../accounts/accountsApi";
import type { LogicGateGVICAssignment, LogicGateGVICRole, LogicGateGVICPrincipalType } from "../logic-gate-map/shared";
import {
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_NODE_PRIORITY_STYLE_OPTIONS,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
  KANBAN_LOGIC_GATE_REVIEW_COLOR,
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
  canEditGVIC?: boolean;
  nodePresetFields: {
    status: string;
    priorityDraft: string;
    priorityRequirementError?: string;
    accounts: Account[];
    accountOptions: Account[];
    dueDateDraft: string;
  } | null;
  gvicFields: {
    assignments: LogicGateGVICAssignment[];
    inherited?: boolean;
    readOnlyReason?: string;
  } | null;
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  companyUserGroups: Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>;
  companyUserGroupMembers: Array<{ group_id: string; user_id: string }>;
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
  onCommitNodeAccountIDs: (accountIDs: string[]) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
  onAddGVICPrincipal: (role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => void;
  onRemoveGVICPrincipal: (role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => void;
};

const NODE_PRIORITY_OPTIONS = KANBAN_NODE_PRIORITY_STYLE_OPTIONS;

type NodeStatusValue = "requested" | "backlog" | "pending" | "in_progress" | "review" | "done";

const NODE_STATUS_OPTIONS: ReadonlyArray<{ value: NodeStatusValue; label: string; storageStatus: string; color: string }> = [
  { value: "requested", label: "Requested", storageStatus: "Requested", color: KANBAN_LOGIC_GATE_REQUESTED_COLOR },
  { value: "backlog", label: "Backlog", storageStatus: "Backlog", color: KANBAN_LOGIC_GATE_BACKLOG_COLOR },
  { value: "pending", label: "Pending", storageStatus: "Pending", color: KANBAN_LOGIC_GATE_PENDING_COLOR },
  { value: "in_progress", label: "In Progress", storageStatus: "In Progress", color: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR },
  { value: "review", label: "Review", storageStatus: "Review", color: KANBAN_LOGIC_GATE_REVIEW_COLOR },
  { value: "done", label: "Done", storageStatus: "Done", color: KANBAN_LOGIC_GATE_DONE_COLOR },
];

const GVIC_ROLES: ReadonlyArray<{ role: LogicGateGVICRole; label: string }> = [
  { role: "generated", label: "Generated" },
  { role: "verified", label: "Verified" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
];

const GVIC_ROLE_ACCENTS: Record<LogicGateGVICRole, string> = {
  generated: "#0891b2",
  verified: "#db2777",
  consulted: "#7c3aed",
  informed: "#059669",
};

type LogicGateGVICPrincipalPickerOption = {
  principalType: LogicGateGVICPrincipalType;
  principalID: string;
  label: string;
  meta: string;
  depth: number;
  rowType: "group" | "user";
  selectable: boolean;
  expandable: boolean;
  expanded: boolean;
};

function companyUserOptionLabel(user: { user_id: string; email?: string; display_name?: string }): string {
  const name = (user.display_name ?? "").trim();
  const email = (user.email ?? "").trim();
  if (name && email) return `${name} <${email}>`;
  return name || email || user.user_id;
}

function companyGroupLabel(group: { group_id: string; name?: string } | undefined, fallbackID: string): string {
  return group?.name?.trim() || fallbackID || "Group";
}

function logicGateGVICAssignmentPrincipalType(assignment: LogicGateGVICAssignment): LogicGateGVICPrincipalType {
  return (assignment.principal_type?.trim() || "user") as LogicGateGVICPrincipalType;
}

function logicGateGVICAssignmentPrincipalID(assignment: LogicGateGVICAssignment): string {
  const principalType = logicGateGVICAssignmentPrincipalType(assignment);
  const principalID = assignment.principal_id?.trim() || "";
  if (principalType === "user") return principalID || assignment.user_id.trim();
  return principalID;
}

function logicGateGVICAssignmentSubjectKey(assignment: LogicGateGVICAssignment): string {
  return `${logicGateGVICAssignmentPrincipalType(assignment)}:${logicGateGVICAssignmentPrincipalID(assignment)}`;
}

function GVICAssignmentLabel(assignment: LogicGateGVICAssignment): string {
  if (logicGateGVICAssignmentPrincipalType(assignment) === "group") {
    return assignment.principal_name?.trim() || logicGateGVICAssignmentPrincipalID(assignment) || "Group";
  }
  const name = (assignment.user_display_name ?? "").trim();
  const email = (assignment.user_email ?? "").trim();
  return assignment.principal_name?.trim() || name || email || logicGateGVICAssignmentPrincipalID(assignment) || assignment.user_id;
}

function validHexColor(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim() : "";
}

function normalizeNodeStatusValue(value: string): NodeStatusValue | "" {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "requested" || normalized === "request" || normalized === "requests" || normalized === "r") return "requested";
  if (normalized === "backlog" || normalized === "backlogs" || normalized === "b") return "backlog";
  if (normalized === "pending" || normalized === "p") return "pending";
  if (normalized === "in_progress" || normalized === "ip") return "in_progress";
  if (normalized === "review") return "review";
  if (normalized === "done" || normalized === "d") return "done";
  return "";
}

function displayNodeStatusFallback(value: string): string {
  const clean = value.trim();
  if (!clean) return "None";
  return clean
    .replace(/[_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function selectEditableTitleContents(element: HTMLElement | null) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const selection = element.ownerDocument.getSelection();
  if (!selection) return;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
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

export const EditorLinkedDocumentPanels: React.FC<EditorLinkedDocumentPanelsProps> = ({
  activeTab,
  linkedEntityKind,
  linkedNodeTitle,
  linkedNodeInfoPreview,
  linkedNodeMetadataRows,
  linkedNodeHistoryRows,
  canEdit,
  canEditGVIC = canEdit,
  nodePresetFields,
  gvicFields,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
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
  onCommitNodeAccountIDs,
  onSetNodeDueDateDraft,
  onCommitNodeDueDateDraft,
  onAddGVICPrincipal,
  onRemoveGVICPrincipal,
}) => {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [hoveredStatusValue, setHoveredStatusValue] = useState<NodeStatusValue | "">("");
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [hoveredPriorityValue, setHoveredPriorityValue] = useState("");
  const statusMenuRef = useRef<HTMLSpanElement | null>(null);
  const priorityMenuRef = useRef<HTMLSpanElement | null>(null);
  const dueDatePickerRef = useRef<HTMLInputElement | null>(null);
  const selectedPriority = NODE_PRIORITY_OPTIONS.find((option) => option.value === (nodePresetFields?.priorityDraft || "0")) ?? NODE_PRIORITY_OPTIONS[0];
  const priorityRequirementError = nodePresetFields?.priorityRequirementError ?? "";
  const priorityHasRequirementError = Boolean(priorityRequirementError);
  const selectedStatus = NODE_STATUS_OPTIONS.find((option) => option.value === normalizeNodeStatusValue(nodePresetFields?.status ?? ""));
  const displayStatusColor = selectedStatus?.color ?? "#64748b";
  const displayStatusLabel = selectedStatus?.label ?? displayNodeStatusFallback(nodePresetFields?.status ?? "");

  useEffect(() => {
    if (canEdit) return;
    setStatusMenuOpen(false);
    setHoveredStatusValue("");
    setPriorityMenuOpen(false);
    setHoveredPriorityValue("");
    onSetIsEditingTitle(false);
  }, [canEdit, onSetIsEditingTitle]);

  useEffect(() => {
    if (!statusMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (statusMenuRef.current?.contains(event.target as Node)) return;
      setStatusMenuOpen(false);
      setHoveredStatusValue("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setStatusMenuOpen(false);
        setHoveredStatusValue("");
      }
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
      setHoveredPriorityValue("");
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPriorityMenuOpen(false);
        setHoveredPriorityValue("");
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [priorityMenuOpen]);

  const beginTitleEditAtEnd = () => {
    if (!canEdit) return;
    if (!isEditingTitle) {
      editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
      onSetIsEditingTitle(true);
    }
    window.requestAnimationFrame(() => focusEditableTitleAtEnd(editingTitleRef.current));
  };
  const beginTitleEditPreservingSelection = () => {
    if (!canEdit || isEditingTitle) return;
    editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
    onSetIsEditingTitle(true);
  };
  const beginTitleEditSelectingAll = () => {
    if (!canEdit) return;
    if (!isEditingTitle) {
      editingTitleDraftRef.current = linkedNodeTitle || (linkedEntityKind === "logic_gate" ? "new logic gate" : "new node");
      onSetIsEditingTitle(true);
    }
    window.requestAnimationFrame(() => selectEditableTitleContents(editingTitleRef.current));
  };

  return (
    <>
      {(activeTab === "editor" || activeTab === "outline-styles") && (
        <div className="mango-editor-hover-highlight" style={{ display: "grid", gap: 8, pointerEvents: "auto" }}>
          <div
            onMouseDown={(event) => {
              if (!canEdit) return;
              if (editingTitleRef.current?.contains(event.target as Node)) return;
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
              data-floating-selection-actions="disabled"
              contentEditable={canEdit}
              suppressContentEditableWarning
              onFocus={() => beginTitleEditPreservingSelection()}
              onMouseDown={(event) => {
                event.stopPropagation();
                beginTitleEditPreservingSelection();
              }}
              onDoubleClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                beginTitleEditSelectingAll();
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
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  if (editingTitleRef.current) editingTitleRef.current.textContent = linkedNodeTitle;
                  onSetIsEditingTitle(false);
                  event.currentTarget.blur();
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
                gridTemplateColumns: "164px 250px minmax(260px, 340px) 160px",
                justifyContent: "start",
                columnGap: 8,
                rowGap: 6,
                maxWidth: "100%",
                overflow: "visible",
                padding: "1px 0 6px",
                borderBottom: `1px dashed ${ruleColor}`,
                fontFamily: "var(--mango-font-family)",
                fontSize: 12,
                lineHeight: 1.35,
                color: "inherit",
                pointerEvents: "auto",
              }}
            >
              <div style={{ gridColumn: 1, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
                      setStatusMenuOpen((open) => {
                        if (open) setHoveredStatusValue("");
                        return !open;
                      });
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
              <div style={{ gridColumn: 3, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
                <strong style={{ paddingTop: 7 }}>Accounts:</strong>
                <AccountFilterControl
                  accounts={nodePresetFields.accountOptions}
                  selectedAccountIDs={nodePresetFields.accounts.map((account) => account.account_id)}
                  onChange={onCommitNodeAccountIDs}
                  disabled={!canEdit}
                  compact
                  showLabel={false}
                  placeholder="Search accounts"
                  style={{ minWidth: 0, width: "100%" }}
                />
              </div>
              <label style={{ gridColumn: 4, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
              <label style={{ gridColumn: 2, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
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
                        setPriorityMenuOpen((open) => {
                          if (open) setHoveredPriorityValue("");
                          return !open;
                        });
                      }}
                      style={{
                        width: "100%",
                        minHeight: 26,
                        display: "grid",
                        gridTemplateColumns: "minmax(0, 1fr) 18px",
                        alignItems: "center",
                        gap: 7,
                        border: `1px solid ${priorityHasRequirementError ? "#334155" : selectedPriority.borderColor}`,
                        borderRadius: 6,
                        background: priorityHasRequirementError ? "rgba(100,116,139,0.08)" : selectedPriority.surface,
                        color: priorityHasRequirementError ? "#334155" : selectedPriority.color,
                        font: "inherit",
                        fontSize: 11.5,
                        fontWeight: 600,
                        padding: "3px 8px",
                        cursor: canEdit ? "pointer" : "default",
                        opacity: canEdit ? 1 : 0.62,
                        textAlign: "left",
                        boxShadow: priorityHasRequirementError ? "0 0 0 2px rgba(100,116,139,0.18)" : `0 8px 18px ${selectedPriority.glow}, inset 1px 1px 0 rgba(255,255,255,0.86)`,
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
                        onMouseLeave={() => setHoveredPriorityValue("")}
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
                          const highlighted = hoveredPriorityValue === option.value || selected;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onMouseEnter={() => setHoveredPriorityValue(option.value)}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                onSetNodePriorityDraft(option.value);
                                onCommitNodePriorityDraft(option.value);
                                setPriorityMenuOpen(false);
                                setHoveredPriorityValue("");
                              }}
                              style={{
                                width: "100%",
                                display: "grid",
                                gridTemplateColumns: "minmax(0, 1fr) 18px",
                                alignItems: "center",
                                gap: 8,
                                border: `1px solid ${highlighted ? option.borderColor : "transparent"}`,
                                borderRadius: 6,
                                background: highlighted ? option.surface : "transparent",
                                color: option.color,
                                font: "inherit",
                                fontSize: 11.5,
                                fontWeight: highlighted ? 850 : 700,
                                padding: "7px 8px",
                                cursor: "pointer",
                                textAlign: "left",
                                boxShadow: highlighted ? `0 8px 18px ${option.glow}, inset 1px 1px 0 rgba(255,255,255,0.86)` : undefined,
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
          {gvicFields && (
            <div
              className="mango-editor-hover-highlight"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                columnGap: 8,
                rowGap: 8,
                maxWidth: "100%",
                padding: "2px 0 8px",
                borderBottom: `1px dashed ${ruleColor}`,
                fontFamily: "var(--mango-font-family)",
                fontSize: 12,
                lineHeight: 1.3,
                color: "inherit",
                pointerEvents: "auto",
              }}
            >
              {GVIC_ROLES.map((column) => (
                <GVICRoleEditor
                  key={column.role}
                  role={column.role}
                  label={column.label}
                  linkedEntityKind={linkedEntityKind}
                  assignments={gvicFields.assignments.filter((assignment) => assignment.role === column.role)}
                  companyUsers={companyUsers}
                  companyUserGroups={companyUserGroups}
                  companyUserGroupMembers={companyUserGroupMembers}
                  accent={accent}
                  panelBackground={panelBackground}
                  ruleColor={ruleColor}
                  canEdit={canEditGVIC}
                  disabledReason={gvicFields.readOnlyReason}
                  onAddPrincipal={onAddGVICPrincipal}
                  onRemovePrincipal={onRemoveGVICPrincipal}
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

function GVICRoleEditor({
  role,
  label,
  linkedEntityKind,
  assignments,
  companyUsers,
  companyUserGroups,
  companyUserGroupMembers,
  accent,
  panelBackground,
  ruleColor,
  canEdit,
  disabledReason,
  onAddPrincipal,
  onRemovePrincipal,
}: {
  role: LogicGateGVICRole;
  label: string;
  linkedEntityKind: "" | "node" | "logic_gate";
  assignments: LogicGateGVICAssignment[];
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  companyUserGroups: Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>;
  companyUserGroupMembers: Array<{ group_id: string; user_id: string }>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  canEdit: boolean;
  disabledReason?: string;
  onAddPrincipal: (role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => void;
  onRemovePrincipal: (role: LogicGateGVICRole, principalType: LogicGateGVICPrincipalType, principalID: string) => void;
}) {
  const inputID = useId();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [assignedOpen, setAssignedOpen] = useState(false);
  const [disabledTooltipPosition, setDisabledTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const assignedPrincipalKeys = useMemo(() => new Set(assignments.map(logicGateGVICAssignmentSubjectKey)), [assignments]);
  const roleAccent = GVIC_ROLE_ACCENTS[role];
  const singleUserOnly = (linkedEntityKind === "node" || linkedEntityKind === "logic_gate") && (role === "generated" || role === "verified");
  const inheritedReadOnly = Boolean(disabledReason) && !canEdit;
  const inputPlaceholder = disabledReason ? "Inherited" : singleUserOnly ? "Add user" : "Add user or team";
  const pickerAriaLabel = singleUserOnly ? `${label} users` : `${label} users and teams`;
  const assignedSummary = singleUserOnly
    ? (assignments.length === 0 ? "" : assignments.length === 1 ? GVICAssignmentLabel(assignments[0]) : `${GVICAssignmentLabel(assignments[0])} +${assignments.length - 1}`)
    : `People (${assignments.length})`;
  const showAssignedButton = !singleUserOnly || assignments.length > 0;
  const showDisabledTooltip = inheritedReadOnly && Boolean(disabledReason && disabledTooltipPosition);
  const toggleGroupExpanded = (groupID: string) => {
    const cleanGroupID = groupID.trim();
    if (!cleanGroupID) return;
    setExpandedGroupIDs((current) => {
      const next = new Set(current);
      if (next.has(cleanGroupID)) next.delete(cleanGroupID);
      else next.add(cleanGroupID);
      return next;
    });
  };
  const { pickerRows, selectableOptions } = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const childrenByParent = new Map<string, Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>>();
    for (const group of companyUserGroups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      const bucket = childrenByParent.get(parentID) ?? [];
      bucket.push(group);
      childrenByParent.set(parentID, bucket);
    }
    for (const bucket of childrenByParent.values()) {
      bucket.sort((left, right) => (left.position - right.position) || companyGroupLabel(left, left.group_id).localeCompare(companyGroupLabel(right, right.group_id), undefined, { numeric: true, sensitivity: "base" }) || left.group_id.localeCompare(right.group_id));
    }

    const userByID = new Map(companyUsers.map((user) => [user.user_id.trim(), user]));
    const groupedUserIDs = new Set<string>();
    const membersByGroup = new Map<string, string[]>();
    for (const member of companyUserGroupMembers) {
      const groupID = member.group_id.trim();
      const userID = member.user_id.trim();
      if (!groupID || !userID) continue;
      groupedUserIDs.add(userID);
      const bucket = membersByGroup.get(groupID) ?? [];
      if (!bucket.includes(userID)) bucket.push(userID);
      membersByGroup.set(groupID, bucket);
    }

    const userMatches = (user: { user_id: string; email?: string; display_name?: string }) => {
      if (!query) return true;
      const userLabel = companyUserOptionLabel(user);
      const name = (user.display_name ?? "").trim();
      const email = (user.email ?? "").trim();
      const fields = [userLabel, name, email, user.user_id].map((field) => field.trim().toLowerCase());
      return fields.some((field) => field.includes(query));
    };
    const groupMatches = (group: { group_id: string; name: string }) => {
      if (!query) return true;
      const groupLabel = companyGroupLabel(group, group.group_id);
      const fields = [groupLabel, group.group_id].map((field) => field.trim().toLowerCase());
      return fields.some((field) => field.includes(query));
    };
    const userRowsForGroup = (groupID: string, depth: number): LogicGateGVICPrincipalPickerOption[] => {
      const seen = new Set<string>();
      const users = (membersByGroup.get(groupID) ?? [])
        .map((userID) => userByID.get(userID) ?? { user_id: userID })
        .filter((user) => {
          const userID = user.user_id.trim();
          if (!userID || seen.has(userID)) return false;
          seen.add(userID);
          return userMatches(user);
        })
        .sort((left, right) => companyUserOptionLabel(left).localeCompare(companyUserOptionLabel(right), undefined, { numeric: true, sensitivity: "base" }));
      return users.map((user) => {
        const userID = user.user_id.trim();
        const userLabel = companyUserOptionLabel(user);
        const name = (user.display_name ?? "").trim();
        const email = (user.email ?? "").trim();
        return {
          principalType: "user",
          principalID: userID,
          label: name || userLabel,
          meta: assignedPrincipalKeys.has(`user:${userID}`) ? "Added" : email,
          depth,
          rowType: "user",
          selectable: !assignedPrincipalKeys.has(`user:${userID}`),
          expandable: false,
          expanded: false,
        };
      });
    };
    const buildGroupRows = (group: { group_id: string; parent_group_id?: string; name: string; position: number }, depth: number, seenGroups: Set<string>): { rows: LogicGateGVICPrincipalPickerOption[]; matched: boolean } => {
      const groupID = group.group_id.trim();
      if (!groupID || seenGroups.has(groupID)) return { rows: [], matched: false };
      const nextSeen = new Set(seenGroups);
      nextSeen.add(groupID);
      const childGroups = childrenByParent.get(groupID) ?? [];
      const childResults = childGroups.map((child) => buildGroupRows(child, depth + 1, nextSeen));
      const memberRows = userRowsForGroup(groupID, depth + 1);
      const childRows = childResults.flatMap((result) => result.rows);
      const descendantMatched = childResults.some((result) => result.matched) || memberRows.length > 0;
      const ownMatched = groupMatches(group);
      const matched = ownMatched || descendantMatched;
      if (query && !matched) return { rows: [], matched: false };

      const expanded = query ? true : expandedGroupIDs.has(groupID);
      const hasChildren = childGroups.length > 0 || (membersByGroup.get(groupID) ?? []).length > 0;
      const assigned = assignedPrincipalKeys.has(`group:${groupID}`);
      const rows: LogicGateGVICPrincipalPickerOption[] = [{
        principalType: "group",
        principalID: groupID,
        label: companyGroupLabel(group, groupID),
        meta: singleUserOnly ? "Group" : assigned ? "Team added" : "Team",
        depth,
        rowType: "group",
        selectable: !singleUserOnly && !assigned,
        expandable: hasChildren,
        expanded,
      }];
      if (expanded) rows.push(...childRows, ...memberRows);
      return { rows, matched: true };
    };

    const rows: LogicGateGVICPrincipalPickerOption[] = [];
    for (const group of childrenByParent.get("") ?? []) {
      rows.push(...buildGroupRows(group, 0, new Set()).rows);
    }
    const ungroupedUsers = companyUsers
      .filter((user) => {
        const userID = user.user_id.trim();
        return userID && !groupedUserIDs.has(userID) && userMatches(user);
      })
      .sort((left, right) => companyUserOptionLabel(left).localeCompare(companyUserOptionLabel(right), undefined, { numeric: true, sensitivity: "base" }));
    for (const user of ungroupedUsers) {
      const userID = user.user_id.trim();
      const userLabel = companyUserOptionLabel(user);
      const name = (user.display_name ?? "").trim();
      const email = (user.email ?? "").trim();
      rows.push({
        principalType: "user",
        principalID: userID,
        label: name || userLabel,
        meta: assignedPrincipalKeys.has(`user:${userID}`) ? "Added" : email,
        depth: 0,
        rowType: "user",
        selectable: !assignedPrincipalKeys.has(`user:${userID}`),
        expandable: false,
        expanded: false,
      });
    }
    return {
      pickerRows: rows,
      selectableOptions: rows.filter((row) => row.selectable),
    };
  }, [assignedPrincipalKeys, companyUserGroupMembers, companyUserGroups, companyUsers, draft, expandedGroupIDs, singleUserOnly]);

  useEffect(() => {
    if (!singleUserOnly) return;
    setAssignedOpen(false);
  }, [singleUserOnly]);

  useEffect(() => {
    if (!open && !assignedOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setAssignedOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setAssignedOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [assignedOpen, open]);

  useEffect(() => {
    if (canEdit) return;
    setOpen(false);
    setAssignedOpen(false);
    setDraft("");
  }, [canEdit]);

  const addPrincipalOption = (option: LogicGateGVICPrincipalPickerOption) => {
    if (!canEdit || !option.selectable || assignedPrincipalKeys.has(`${option.principalType}:${option.principalID}`)) return;
    if (singleUserOnly && option.principalType !== "user") return;
    onAddPrincipal(role, option.principalType, option.principalID);
    setDraft("");
    setOpen(false);
    setAssignedOpen(false);
  };

  const commitDraft = () => {
    if (!canEdit) return;
    const value = draft.trim().toLowerCase();
    const selected = selectableOptions.find((option) => (
      option.label.trim().toLowerCase() === value
      || option.meta.trim().toLowerCase() === value
      || option.principalID.trim().toLowerCase() === value
    )) ?? selectableOptions[0] ?? null;
    if (!selected) return;
    addPrincipalOption(selected);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        minWidth: 0,
        display: "grid",
        gap: 5,
        alignContent: "start",
        border: "1px solid transparent",
        borderRadius: 9,
        background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(roleAccent, "12")}) padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "aa")}, rgba(255,255,255,0.84)) border-box`,
        boxShadow: "4px 4px 12px rgba(174,174,192,0.16), -4px -4px 12px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.84)",
        padding: 6,
        opacity: inheritedReadOnly ? 0.74 : 1,
      }}
    >
      <strong style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: roleAccent, boxShadow: `0 0 10px ${hexWithAlpha(roleAccent, "66")}` }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </strong>
      <div style={{ position: "relative", minHeight: 25, minWidth: 0 }}>
        {showAssignedButton && (
          <button
            type="button"
            aria-label={singleUserOnly && assignments[0] ? `Remove ${GVICAssignmentLabel(assignments[0])} from ${label}` : `${label} people`}
            aria-haspopup={singleUserOnly ? undefined : "listbox"}
            aria-expanded={singleUserOnly ? undefined : assignedOpen}
            aria-controls={singleUserOnly ? undefined : `${inputID}-assigned-users`}
            disabled={singleUserOnly && !canEdit}
            onClick={() => {
              if (singleUserOnly) {
                const assignment = assignments[0];
                if (!canEdit || !assignment) return;
                onRemovePrincipal(role, logicGateGVICAssignmentPrincipalType(assignment), logicGateGVICAssignmentPrincipalID(assignment));
                setAssignedOpen(false);
                setOpen(false);
                return;
              }
              setAssignedOpen((current) => !current);
              setOpen(false);
            }}
            style={{ width: "fit-content", maxWidth: "100%", minHeight: 25, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${hexWithAlpha(roleAccent, assignedOpen ? "70" : "2f")}`, borderRadius: 999, background: assignedOpen ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, color: "#111827", cursor: singleUserOnly && !canEdit ? "default" : "pointer", padding: "2px 8px", font: "inherit", fontSize: 11, fontWeight: 800, opacity: singleUserOnly && !canEdit ? 0.66 : 1, boxShadow: assignedOpen ? `0 7px 15px ${hexWithAlpha(roleAccent, "1c")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "2px 2px 7px rgba(174,174,192,0.15), -2px -2px 7px rgba(255,255,255,0.74), inset 1px 1px 0 rgba(255,255,255,0.82)" }}
          >
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{assignedSummary}</span>
            <span aria-hidden="true" style={{ color: roleAccent || accent, fontSize: singleUserOnly ? 11 : 9, fontWeight: 900 }}>{singleUserOnly ? "x" : assignedOpen ? "^" : "v"}</span>
          </button>
        )}
        {assignedOpen && showAssignedButton && !singleUserOnly && (
          <div
            id={`${inputID}-assigned-users`}
            role="listbox"
            aria-label={singleUserOnly ? `${label} user` : `${label} people and groups`}
            style={{ position: "absolute", zIndex: 32, top: "calc(100% + 6px)", left: 0, width: "min(320px, 86vw)", maxHeight: 240, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {assignments.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 650 }}>{singleUserOnly ? "No user" : "No people"}</div>
            ) : assignments.map((assignment) => {
              const principalType = logicGateGVICAssignmentPrincipalType(assignment);
              const principalID = logicGateGVICAssignmentPrincipalID(assignment);
              const assignmentLabel = GVICAssignmentLabel(assignment);
              const assignmentAccent = principalType === "group" ? roleAccent : userAccentForName(assignmentLabel || principalID);
              return (
                <div
                  key={`${assignment.role}:${principalType}:${principalID}`}
                  role="option"
                  aria-selected="true"
                  title={principalType === "group" ? "User group" : assignment.user_email || principalID}
                  style={{ minWidth: 0, minHeight: 34, display: "grid", gridTemplateColumns: canEdit ? "24px minmax(0, 1fr) 22px" : "24px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "1px solid transparent", borderRadius: 10, background: "transparent", padding: "5px 7px", boxShadow: `inset 0 0 0 1px ${ruleColor || "transparent"}` }}
                >
                  <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: principalType === "group" ? hexWithAlpha(roleAccent, "bb") : avatarBackgroundForName(assignmentLabel || principalID), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.76)" }}>
                    {principalType === "group" ? "GR" : initialsForName(assignmentLabel || principalID)}
                  </span>
                  <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: assignmentAccent }}>{assignmentLabel}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{principalType === "group" ? "User group" : assignment.user_email}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${assignmentLabel} from ${label}`}
                      onClick={() => onRemovePrincipal(role, principalType, principalID)}
                      style={{ width: 22, height: 22, display: "grid", placeItems: "center", border: "none", borderRadius: 7, background: hexWithAlpha(roleAccent, "16"), color: roleAccent || accent, cursor: "pointer", padding: 0, font: "inherit", fontSize: 11, fontWeight: 900 }}
                    >
                      x
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div
        onMouseEnter={(event) => {
          if (!inheritedReadOnly || !disabledReason) return;
          setDisabledTooltipPosition({ x: event.clientX, y: event.clientY });
        }}
        onMouseMove={(event) => {
          if (!inheritedReadOnly || !disabledReason) return;
          setDisabledTooltipPosition({ x: event.clientX, y: event.clientY });
        }}
        onMouseLeave={() => setDisabledTooltipPosition(null)}
        style={{ position: "relative", minWidth: 0, width: "min(174px, 100%)", justifySelf: "start" }}
      >
        <input
          id={inputID}
          name={`${inputID}-GVIC-person`}
          value={draft}
          disabled={!canEdit}
          readOnly={!canEdit}
          autoComplete="new-password"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          onFocus={() => {
            if (canEdit) {
              setAssignedOpen(false);
              setOpen(true);
            }
          }}
          onChange={(event) => {
            if (!canEdit) return;
            const next = event.currentTarget.value;
            setDraft(next);
            setAssignedOpen(false);
            setOpen(true);
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
          placeholder={inputPlaceholder}
          aria-label={`Add ${label} ${singleUserOnly ? "user" : "user or team"}`}
          aria-haspopup="listbox"
          aria-expanded={canEdit && open}
          aria-controls={`${inputID}-options`}
          style={{ width: "100%", minWidth: 0, minHeight: 27, boxSizing: "border-box", border: open ? "1px solid transparent" : `1px solid ${hexWithAlpha(roleAccent, "3f")}`, borderRadius: 8, background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "bb")}, rgba(255,255,255,0.86)) border-box` : EDITOR_NEU_SURFACE, color: "#111827", font: "inherit", fontSize: 11, fontWeight: 750, padding: "3px 8px", outline: "none", caretColor: canEdit ? "#111827" : "transparent", cursor: canEdit ? "text" : "default", pointerEvents: canEdit ? "auto" : "none", boxShadow: open ? `0 8px 18px ${hexWithAlpha(roleAccent, "1c")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "2px 2px 8px rgba(174,174,192,0.18), -2px -2px 8px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.86)" }}
        />
        {showDisabledTooltip && disabledReason && disabledTooltipPosition && (
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: disabledTooltipPosition.x + 14,
              top: disabledTooltipPosition.y - 12,
              transform: "translateY(-100%)",
              zIndex: 90,
              maxWidth: 320,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#f8fafc",
              boxShadow: "5px 5px 12px rgba(148,163,184,0.32), -4px -4px 10px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.95)",
              color: "#334155",
              fontSize: 11,
              fontWeight: 750,
              lineHeight: 1.35,
              padding: "8px 10px",
              pointerEvents: "none",
              whiteSpace: "normal",
            }}
          >
            {disabledReason}
          </div>
        )}
        {canEdit && open && (
          <div
            id={`${inputID}-options`}
            role="listbox"
            aria-label={pickerAriaLabel}
            style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, width: "min(360px, 86vw)", maxHeight: 290, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {pickerRows.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>
                {draft.trim() ? "No matches" : singleUserOnly ? "No users available" : "No users or teams available"}
              </div>
            ) : pickerRows.map((option) => {
              const optionAccent = option.principalType === "group" ? roleAccent : userAccentForName(option.label || option.principalID);
              const canAct = option.selectable || (option.rowType === "group" && option.expandable);
              const rowIndent = 6 + option.depth * 18;
              return (
                <div
                  key={`${option.principalType}:${option.principalID}`}
                  role="option"
                  aria-selected={false}
                  aria-disabled={!option.selectable}
                  style={{ width: `calc(100% - ${rowIndent}px)`, marginLeft: rowIndent, minHeight: 32, display: "grid", gridTemplateColumns: "18px 24px minmax(0, 1fr)", alignItems: "center", gap: 7, border: "1px solid transparent", borderRadius: 8, background: "transparent", color: "#111827", padding: "4px 7px", boxShadow: `inset 0 0 0 1px ${ruleColor || "transparent"}`, opacity: canAct ? 1 : 0.58 }}
                >
                  <button
                    type="button"
                    aria-label={option.expandable ? `${option.expanded ? "Collapse" : "Expand"} ${option.label}` : undefined}
                    tabIndex={option.expandable ? 0 : -1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (option.expandable) toggleGroupExpanded(option.principalID);
                    }}
                    style={{ width: 18, height: 22, display: "grid", placeItems: "center", border: "none", borderRadius: 6, background: option.expandable ? hexWithAlpha(roleAccent, "12") : "transparent", color: roleAccent, cursor: option.expandable ? "pointer" : "default", padding: 0, font: "inherit", fontSize: 10, fontWeight: 900 }}
                  >
                    {option.expandable ? (option.expanded ? "^" : ">") : ""}
                  </button>
                  <span style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: option.principalType === "group" ? hexWithAlpha(roleAccent, "bb") : avatarBackgroundForName(option.label || option.principalID), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.16), -2px -2px 6px rgba(255,255,255,0.72)" }}>
                    {option.principalType === "group" ? "GR" : initialsForName(option.label || option.principalID)}
                  </span>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (option.selectable) {
                        addPrincipalOption(option);
                        return;
                      }
                      if (option.rowType === "group" && option.expandable) toggleGroupExpanded(option.principalID);
                    }}
                    style={{ minWidth: 0, display: "grid", gap: 1, border: "none", background: "transparent", color: "inherit", cursor: canAct ? "pointer" : "default", padding: 0, textAlign: "left", font: "inherit" }}
                  >
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: optionAccent }}>{option.label}</span>
                    {option.meta && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{option.meta}</span>}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

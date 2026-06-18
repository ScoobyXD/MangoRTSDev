import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { EditorTabID } from "./editorTabs";
import { normalizeNodeDueDateDraft } from "./editorDates";
import { AccountFilterControl } from "../accounts/AccountFilterControl";
import type { Account } from "../accounts/accountsApi";
import type { LogicGateRaciAssignment, LogicGateRaciRole, LogicGateRaciSubjectType } from "../logic-gate-map/shared";
import {
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_NODE_PRIORITY_STYLE_OPTIONS,
  KANBAN_LOGIC_GATE_PENDING_COLOR,
  KANBAN_LOGIC_GATE_REQUESTED_COLOR,
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
    accounts: Account[];
    accountOptions: Account[];
    dueDateDraft: string;
  } | null;
  logicGateRaciFields: {
    assignments: LogicGateRaciAssignment[];
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
  onSetNodeAssigneeDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeAssigneeDraft: (draft: string) => void;
  onCommitNodeAccountIDs: (accountIDs: string[]) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
  onAddLogicGateRaciSubject: (role: LogicGateRaciRole, subjectType: LogicGateRaciSubjectType, subjectID: string) => void;
  onRemoveLogicGateRaciSubject: (role: LogicGateRaciRole, subjectType: LogicGateRaciSubjectType, subjectID: string) => void;
};

const NODE_PRIORITY_OPTIONS = KANBAN_NODE_PRIORITY_STYLE_OPTIONS;

type NodeStatusValue = "requested" | "backlog" | "pending" | "in_progress" | "review" | "done";

const NODE_STATUS_OPTIONS: ReadonlyArray<{ value: NodeStatusValue; label: string; storageStatus: string; color: string }> = [
  { value: "requested", label: "Requested", storageStatus: "Requested", color: KANBAN_LOGIC_GATE_REQUESTED_COLOR },
  { value: "backlog", label: "Backlog", storageStatus: "Backlog", color: KANBAN_LOGIC_GATE_BACKLOG_COLOR },
  { value: "pending", label: "Pending", storageStatus: "Pending", color: KANBAN_LOGIC_GATE_PENDING_COLOR },
  { value: "in_progress", label: "In Progress", storageStatus: "In Progress", color: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR },
  { value: "review", label: "Review", storageStatus: "Review", color: KANBAN_LOGIC_GATE_VERIFY_COLOR },
  { value: "done", label: "Done", storageStatus: "Done", color: KANBAN_LOGIC_GATE_DONE_COLOR },
];

const LOGIC_GATE_RACI_ROLES: ReadonlyArray<{ role: LogicGateRaciRole; label: string }> = [
  { role: "generated", label: "Generated" },
  { role: "verified", label: "Verified" },
  { role: "consulted", label: "Consulted" },
  { role: "informed", label: "Informed" },
];

const RACI_ROLE_ACCENTS: Record<LogicGateRaciRole, string> = {
  generated: "#0891b2",
  verified: "#db2777",
  consulted: "#7c3aed",
  informed: "#059669",
};

type LogicGateRaciSubjectPickerOption = {
  subjectType: LogicGateRaciSubjectType;
  subjectID: string;
  label: string;
  meta: string;
  depth: number;
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

function companyUserGroupSubtreeIDs(groups: Array<{ group_id: string; parent_group_id?: string }>, rootGroupID: string): Set<string> {
  const cleanRootID = rootGroupID.trim();
  const ids = new Set<string>();
  if (!cleanRootID || !groups.some((group) => group.group_id === cleanRootID)) return ids;
  ids.add(cleanRootID);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of groups) {
      const parentID = group.parent_group_id?.trim() ?? "";
      if (parentID && ids.has(parentID) && !ids.has(group.group_id)) {
        ids.add(group.group_id);
        changed = true;
      }
    }
  }
  return ids;
}

function companyUserIDsForGroupSubtree(groups: Array<{ group_id: string; parent_group_id?: string }>, members: Array<{ group_id: string; user_id: string }>, rootGroupID: string): string[] {
  const groupIDs = companyUserGroupSubtreeIDs(groups, rootGroupID);
  if (groupIDs.size === 0) return [];
  const userIDs = new Set<string>();
  for (const member of members) {
    const groupID = member.group_id.trim();
    const userID = member.user_id.trim();
    if (groupIDs.has(groupID) && userID) userIDs.add(userID);
  }
  return Array.from(userIDs).sort((left, right) => left.localeCompare(right));
}

function logicGateRaciAssignmentSubjectType(assignment: LogicGateRaciAssignment): LogicGateRaciSubjectType {
  return (assignment.principal_type?.trim() || assignment.subject_type?.trim() || "user") as LogicGateRaciSubjectType;
}

function logicGateRaciAssignmentSubjectID(assignment: LogicGateRaciAssignment): string {
  const subjectType = logicGateRaciAssignmentSubjectType(assignment);
  const subjectID = assignment.principal_id?.trim() || assignment.subject_id?.trim() || "";
  if (subjectType === "user") return subjectID || assignment.user_id.trim();
  return subjectID;
}

function logicGateRaciAssignmentSubjectKey(assignment: LogicGateRaciAssignment): string {
  return `${logicGateRaciAssignmentSubjectType(assignment)}:${logicGateRaciAssignmentSubjectID(assignment)}`;
}

function raciAssignmentLabel(assignment: LogicGateRaciAssignment): string {
  if (logicGateRaciAssignmentSubjectType(assignment) === "group") {
    return assignment.subject_name?.trim() || logicGateRaciAssignmentSubjectID(assignment) || "Group";
  }
  const name = (assignment.user_display_name ?? "").trim();
  const email = (assignment.user_email ?? "").trim();
  return assignment.subject_name?.trim() || name || email || logicGateRaciAssignmentSubjectID(assignment) || assignment.user_id;
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
  onSetNodeAssigneeDraft,
  onCommitNodeAssigneeDraft,
  onCommitNodeAccountIDs,
  onSetNodeDueDateDraft,
  onCommitNodeDueDateDraft,
  onAddLogicGateRaciSubject,
  onRemoveLogicGateRaciSubject,
}) => {
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const [hoveredStatusValue, setHoveredStatusValue] = useState<NodeStatusValue | "">("");
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [hoveredPriorityValue, setHoveredPriorityValue] = useState("");
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
  const displayStatusLabel = selectedStatus?.label ?? displayNodeStatusFallback(nodePresetFields?.status ?? "");
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
    setHoveredStatusValue("");
    setPriorityMenuOpen(false);
    setHoveredPriorityValue("");
    setAssigneeMenuOpen(false);
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
                gridTemplateColumns: "164px 250px minmax(236px, 310px) minmax(260px, 340px) 160px",
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
              <label style={{ gridColumn: 3, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
              <div style={{ gridColumn: 4, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "start" }}>
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
              <label style={{ gridColumn: 5, gridRow: 1, minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
          {logicGateRaciFields && (
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
              {LOGIC_GATE_RACI_ROLES.map((column) => (
                <LogicGateRaciRoleEditor
                  key={column.role}
                  role={column.role}
                  label={column.label}
                  assignments={logicGateRaciFields.assignments.filter((assignment) => assignment.role === column.role)}
                  companyUsers={companyUsers}
                  companyUserGroups={companyUserGroups}
                  companyUserGroupMembers={companyUserGroupMembers}
                  accent={accent}
                  panelBackground={panelBackground}
                  ruleColor={ruleColor}
                  canEdit={canEditRaci}
                  onAddSubject={onAddLogicGateRaciSubject}
                  onRemoveSubject={onRemoveLogicGateRaciSubject}
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
  companyUserGroups,
  companyUserGroupMembers,
  accent,
  panelBackground,
  ruleColor,
  canEdit,
  onAddSubject,
  onRemoveSubject,
}: {
  role: LogicGateRaciRole;
  label: string;
  assignments: LogicGateRaciAssignment[];
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  companyUserGroups: Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>;
  companyUserGroupMembers: Array<{ group_id: string; user_id: string }>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  canEdit: boolean;
  onAddSubject: (role: LogicGateRaciRole, subjectType: LogicGateRaciSubjectType, subjectID: string) => void;
  onRemoveSubject: (role: LogicGateRaciRole, subjectType: LogicGateRaciSubjectType, subjectID: string) => void;
}) {
  const inputID = useId();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [assignedOpen, setAssignedOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const assignedSubjectKeys = useMemo(() => new Set(assignments.map(logicGateRaciAssignmentSubjectKey)), [assignments]);
  const roleAccent = RACI_ROLE_ACCENTS[role];
  const subjectMatches = useMemo(() => {
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
    const options: LogicGateRaciSubjectPickerOption[] = [];
    for (const user of companyUsers) {
      if (assignedSubjectKeys.has(`user:${user.user_id}`)) continue;
      const label = companyUserOptionLabel(user);
      const name = (user.display_name ?? "").trim();
      const email = (user.email ?? "").trim();
      const fields = [label, name, email, user.user_id].map((field) => field.trim().toLowerCase());
      if (!query || fields.some((field) => field.includes(query))) {
        options.push({
          subjectType: "user",
          subjectID: user.user_id,
          label: name || label,
          meta: email,
          depth: 0,
        });
      }
    }
    const visit = (parentID: string, depth: number) => {
      for (const group of childrenByParent.get(parentID) ?? []) {
        const memberUserIDs = companyUserIDsForGroupSubtree(companyUserGroups, companyUserGroupMembers, group.group_id);
        const hasUnassignedMember = memberUserIDs.some((userID) => !assignedSubjectKeys.has(`user:${userID}`));
        if (!assignedSubjectKeys.has(`group:${group.group_id}`) && hasUnassignedMember) {
          const groupLabel = companyGroupLabel(group, group.group_id);
          const fields = [groupLabel, group.group_id].map((field) => field.trim().toLowerCase());
          if (!query || fields.some((field) => field.includes(query))) {
            options.push({
              subjectType: "group",
              subjectID: group.group_id,
              label: groupLabel,
              meta: "User group",
              depth,
            });
          }
        }
        visit(group.group_id, depth + 1);
      }
    };
    visit("", 0);
    return options.slice(0, 10);
  }, [assignedSubjectKeys, companyUserGroupMembers, companyUserGroups, companyUsers, draft]);

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
    setDraft("");
  }, [canEdit]);

  const addSubjectOption = (option: LogicGateRaciSubjectPickerOption) => {
    if (!canEdit || assignedSubjectKeys.has(`${option.subjectType}:${option.subjectID}`)) return;
    onAddSubject(role, option.subjectType, option.subjectID);
    setDraft("");
    setOpen(false);
    setAssignedOpen(false);
  };

  const commitDraft = () => {
    if (!canEdit) return;
    const value = draft.trim().toLowerCase();
    const selected = subjectMatches.find((option) => (
      option.label.trim().toLowerCase() === value
      || option.meta.trim().toLowerCase() === value
      || option.subjectID.trim().toLowerCase() === value
    )) ?? subjectMatches[0] ?? null;
    if (!selected) return;
    addSubjectOption(selected);
  };

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        minWidth: 0,
        display: "grid",
        gap: 6,
        alignContent: "start",
        border: "1px solid transparent",
        borderRadius: 12,
        background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${hexWithAlpha(roleAccent, "12")}) padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "aa")}, rgba(255,255,255,0.84)) border-box`,
        boxShadow: "7px 7px 18px rgba(174,174,192,0.22), -7px -7px 18px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.86)",
        padding: 7,
      }}
    >
      <strong style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: 999, background: roleAccent, boxShadow: `0 0 12px ${hexWithAlpha(roleAccent, "66")}` }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </strong>
      <div style={{ position: "relative", minHeight: 28, minWidth: 0 }}>
        <button
          type="button"
          aria-label={`${label} assignees`}
          aria-haspopup="listbox"
          aria-expanded={assignedOpen}
          aria-controls={`${inputID}-assigned-users`}
          onClick={() => {
            setAssignedOpen((current) => !current);
            setOpen(false);
          }}
          style={{ width: "fit-content", maxWidth: "100%", minHeight: 27, display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${hexWithAlpha(roleAccent, assignedOpen ? "7a" : "34")}`, borderRadius: 999, background: assignedOpen ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, color: "#111827", cursor: "pointer", padding: "3px 8px", font: "inherit", fontSize: 11, fontWeight: 800, boxShadow: assignedOpen ? `0 8px 18px ${hexWithAlpha(roleAccent, "1f")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "3px 3px 9px rgba(174,174,192,0.17), -3px -3px 9px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.82)" }}
        >
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Assignees ({assignments.length})</span>
          <span aria-hidden="true" style={{ color: roleAccent || accent, fontSize: 9, fontWeight: 900 }}>{assignedOpen ? "^" : "v"}</span>
        </button>
        {assignedOpen && (
          <div
            id={`${inputID}-assigned-users`}
            role="listbox"
            aria-label={`${label} assigned users and groups`}
            style={{ position: "absolute", zIndex: 32, top: "calc(100% + 6px)", left: 0, width: "min(320px, 86vw)", maxHeight: 240, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {assignments.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 650 }}>No assignees</div>
            ) : assignments.map((assignment) => {
              const subjectType = logicGateRaciAssignmentSubjectType(assignment);
              const subjectID = logicGateRaciAssignmentSubjectID(assignment);
              const assignmentLabel = raciAssignmentLabel(assignment);
              const assignmentAccent = subjectType === "group" ? roleAccent : userAccentForName(assignmentLabel || subjectID);
              return (
                <div
                  key={`${assignment.role}:${subjectType}:${subjectID}`}
                  role="option"
                  aria-selected="true"
                  title={subjectType === "group" ? "User group" : assignment.user_email || subjectID}
                  style={{ minWidth: 0, minHeight: 34, display: "grid", gridTemplateColumns: canEdit ? "24px minmax(0, 1fr) 22px" : "24px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "1px solid transparent", borderRadius: 10, background: "transparent", padding: "5px 7px", boxShadow: `inset 0 0 0 1px ${ruleColor || "transparent"}` }}
                >
                  <span aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: subjectType === "group" ? hexWithAlpha(roleAccent, "bb") : avatarBackgroundForName(assignmentLabel || subjectID), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.76)" }}>
                    {subjectType === "group" ? "GR" : initialsForName(assignmentLabel || subjectID)}
                  </span>
                  <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: assignmentAccent }}>{assignmentLabel}</span>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{subjectType === "group" ? "User group" : assignment.user_email}</span>
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      aria-label={`Remove ${assignmentLabel} from ${label}`}
                      onClick={() => onRemoveSubject(role, subjectType, subjectID)}
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
      <div style={{ position: "relative", minWidth: 0, width: "min(156px, 100%)", justifySelf: "start" }}>
        <input
          id={inputID}
          name={`${inputID}-raci-person`}
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
          placeholder="Add"
          aria-label={`Add ${label} assignee`}
          aria-haspopup="listbox"
          aria-expanded={canEdit && open}
          aria-controls={`${inputID}-options`}
          style={{ width: "100%", minWidth: 0, minHeight: 29, boxSizing: "border-box", border: open ? "1px solid transparent" : `1px solid ${hexWithAlpha(roleAccent, "46")}`, borderRadius: 10, background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "cc")}, rgba(255,255,255,0.86)) border-box` : EDITOR_NEU_SURFACE, color: "#111827", font: "inherit", fontSize: 11, fontWeight: 750, padding: "4px 8px", outline: "none", caretColor: canEdit ? "#111827" : "transparent", cursor: canEdit ? "text" : "default", boxShadow: open ? `0 10px 22px ${hexWithAlpha(roleAccent, "1f")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "4px 4px 12px rgba(174,174,192,0.20), -4px -4px 12px rgba(255,255,255,0.84), inset 1px 1px 0 rgba(255,255,255,0.86)" }}
        />
        {canEdit && open && (
          <div
            id={`${inputID}-options`}
            role="listbox"
            aria-label={`${label} people and groups`}
            style={{ position: "absolute", zIndex: 30, top: "calc(100% + 6px)", left: 0, width: "min(330px, 86vw)", maxHeight: 250, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {subjectMatches.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>
                {companyUsers.every((user) => assignedSubjectKeys.has(`user:${user.user_id}`)) && companyUserGroups.every((group) => assignedSubjectKeys.has(`group:${group.group_id}`)) ? "All assignees added" : "No matches"}
              </div>
            ) : subjectMatches.map((option) => {
              const optionAccent = option.subjectType === "group" ? roleAccent : userAccentForName(option.label || option.subjectID);
              return (
                <button
                  key={`${option.subjectType}:${option.subjectID}`}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => addSubjectOption(option)}
                  style={{ width: "100%", minHeight: 34, display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", alignItems: "center", gap: 8, border: "1px solid transparent", borderRadius: 10, background: "transparent", color: "#111827", cursor: "pointer", padding: "5px 8px", textAlign: "left", font: "inherit", boxShadow: `inset 0 0 0 1px ${ruleColor || "transparent"}` }}
                >
                  <span style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", background: option.subjectType === "group" ? hexWithAlpha(roleAccent, "bb") : avatarBackgroundForName(option.label || option.subjectID), color: "#ffffff", fontSize: 9, fontWeight: 900, boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.76)" }}>
                    {option.subjectType === "group" ? "GR" : initialsForName(option.label || option.subjectID)}
                  </span>
                  <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, color: optionAccent, paddingLeft: option.subjectType === "group" ? option.depth * 8 : 0 }}>{option.label}</span>
                    {option.meta && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 500 }}>{option.meta}</span>}
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

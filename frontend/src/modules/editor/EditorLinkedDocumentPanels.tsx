import React, { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAppFloatingMenuDismissal, useAppOverlayPortalTarget } from "../../app/AppModalPortal";
import type { EditorTabID } from "./editorTabs";
import { normalizeNodeDueDateDraft } from "./editorDates";
import { AccountFilterControl } from "../accounts/AccountFilterControl";
import type { Account } from "../accounts/accountsApi";
import { createOneShotBlurSuppression } from "../realtime/committedEntityTitleUpdates";
import type { LogicGateRACIAssignment, LogicGateRACIRole, LogicGateRACIPrincipalType } from "../logic-gates/types";
import {
  LOGIC_GATE_RACI_ROLE_PRESENTATIONS,
  logicGateRACIRaisedSurfaceStyle,
  logicGateRACIRolePresentation,
} from "../logic-gates/raciPresentation.js";
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
  canEditRACI?: boolean;
  compactHeader?: boolean;
  nodePresetFields: {
    status: string;
    priorityDraft: string;
    priorityRequirementError?: string;
    accounts: Account[];
    accountOptions: Account[];
    dueDateDraft: string;
  } | null;
  gvicFields: {
    assignments: LogicGateRACIAssignment[];
    inherited?: boolean;
    readOnlyReason?: string;
    mode: "inherited" | "customized";
    overwrittenByAncestor?: { resource_type: string; resource_id: string; sequence: number } | null;
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
  onSetIsEditingTitle: (editing: boolean) => void;
  onUpdateTitle: (nextTitle: string) => Promise<void>;
  onCommitNodeStatus: (statusKey: string, statusLabel: string, statusColor: string) => void;
  onSetNodePriorityDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodePriorityDraft: (draft: string) => void;
  onCommitNodeAccountIDs: (accountIDs: string[]) => void;
  onSetNodeDueDateDraft: React.Dispatch<React.SetStateAction<string>>;
  onCommitNodeDueDateDraft: (draft: string) => void;
  onAddRACIPrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
  onRemoveRACIPrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
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

const RACI_ROLES = LOGIC_GATE_RACI_ROLE_PRESENTATIONS;

function RACIRoleDisplayLabel(role: LogicGateRACIRole): string {
  return logicGateRACIRolePresentation(role).label;
}

const RACI_FLOATING_LAYER_Z_INDEX = 10060;

type FloatingLayerPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

function useFloatingLayerPosition(
  anchorRef: React.RefObject<HTMLElement | null>,
  open: boolean,
  options: { width: number; maxHeight: number; gutter?: number },
): FloatingLayerPosition | null {
  const [position, setPosition] = useState<FloatingLayerPosition | null>(null);
  const gutter = options.gutter ?? 8;

  useLayoutEffect(() => {
    if (!open || typeof window === "undefined") {
      setPosition(null);
      return undefined;
    }

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportWidth = window.innerWidth || 1;
      const viewportHeight = window.innerHeight || 1;
      const width = Math.max(180, Math.min(options.width, viewportWidth - gutter * 2));
      const maxHeight = Math.max(120, Math.min(options.maxHeight, viewportHeight - gutter * 2));
      const belowSpace = viewportHeight - rect.bottom - gutter;
      const aboveSpace = rect.top - gutter;
      const openAbove = belowSpace < Math.min(170, maxHeight) && aboveSpace > belowSpace;
      const belowMaxHeight = Math.min(maxHeight, Math.max(120, belowSpace));
      const aboveMaxHeight = Math.min(maxHeight, Math.max(120, aboveSpace));
      const top = openAbove
        ? Math.max(gutter, rect.top - aboveMaxHeight - 6)
        : Math.max(gutter, Math.min(rect.bottom + 6, viewportHeight - gutter - belowMaxHeight));
      const availableHeight = openAbove ? Math.max(120, rect.top - top - 6) : Math.max(120, viewportHeight - top - gutter);
      const left = Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));

      setPosition({
        left,
        top,
        width,
        maxHeight: Math.min(maxHeight, availableHeight),
      });
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, gutter, open, options.maxHeight, options.width]);

  return position;
}

type LogicGateRACIPrincipalPickerOption = {
  principalType: LogicGateRACIPrincipalType;
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

function logicGateRACIAssignmentPrincipalType(assignment: LogicGateRACIAssignment): LogicGateRACIPrincipalType {
  return (assignment.principal_type?.trim() || "user") as LogicGateRACIPrincipalType;
}

function logicGateRACIAssignmentPrincipalID(assignment: LogicGateRACIAssignment): string {
  const principalType = logicGateRACIAssignmentPrincipalType(assignment);
  const principalID = assignment.principal_id?.trim() || "";
  if (principalType === "user") return principalID || assignment.user_id.trim();
  return principalID;
}

function logicGateRACIAssignmentSubjectKey(assignment: LogicGateRACIAssignment): string {
  return `${logicGateRACIAssignmentPrincipalType(assignment)}:${logicGateRACIAssignmentPrincipalID(assignment)}`;
}

function RACIAssignmentLabel(assignment: LogicGateRACIAssignment): string {
  if (logicGateRACIAssignmentPrincipalType(assignment) === "group") {
    return assignment.principal_name?.trim() || logicGateRACIAssignmentPrincipalID(assignment) || "Group";
  }
  const name = (assignment.user_display_name ?? "").trim();
  const email = (assignment.user_email ?? "").trim();
  return assignment.principal_name?.trim() || name || email || logicGateRACIAssignmentPrincipalID(assignment) || assignment.user_id;
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
  canEditRACI = canEdit,
  compactHeader = false,
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
  onAddRACIPrincipal,
  onRemoveRACIPrincipal,
}) => {
  const titleBlurSuppressionRef = useRef(createOneShotBlurSuppression());
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

  useAppFloatingMenuDismissal(statusMenuOpen, statusMenuRef, () => {
    setStatusMenuOpen(false);
    setHoveredStatusValue("");
  });
  useAppFloatingMenuDismissal(priorityMenuOpen, priorityMenuRef, () => {
    setPriorityMenuOpen(false);
    setHoveredPriorityValue("");
  });

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
  const gvicBoard = gvicFields ? (
    <RACIAssignmentBoard
      assignments={gvicFields.assignments}
      mode={gvicFields.mode}
      overwrittenByAncestor={gvicFields.overwrittenByAncestor}
      companyUsers={companyUsers}
      companyUserGroups={companyUserGroups}
      companyUserGroupMembers={companyUserGroupMembers}
      accent={accent}
      panelBackground={panelBackground}
      ruleColor={ruleColor}
      canEdit={canEditRACI}
      disabledReason={gvicFields.readOnlyReason}
      onAddPrincipal={onAddRACIPrincipal}
      onRemovePrincipal={onRemoveRACIPrincipal}
    />
  ) : null;
  const nodePresetGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: compactHeader
      ? "repeat(auto-fit, minmax(150px, 1fr))"
      : "minmax(132px, 150px) minmax(170px, 210px) minmax(190px, 230px) minmax(136px, 148px)",
    justifyContent: "start",
    columnGap: compactHeader ? 10 : 8,
    rowGap: compactHeader ? 7 : 4,
    width: compactHeader ? "min(840px, 100%)" : undefined,
    maxWidth: compactHeader ? "100%" : "min(760px, 100%)",
    overflow: "visible",
    padding: compactHeader ? "2px 0 6px" : "1px 0 4px",
    borderBottom: `1px dashed ${ruleColor}`,
    fontFamily: "var(--mango-font-family)",
    fontSize: 12,
    lineHeight: 1.35,
    color: "inherit",
    pointerEvents: "auto",
  };

  return (
    <>
      {(activeTab === "editor" || activeTab === "outline-styles") && (
        <div className="mango-editor-hover-highlight" style={{ display: "grid", gap: 8, width: "100%", pointerEvents: "auto" }}>
          <div
            style={{
              minWidth: 0,
              width: "100%",
              maxWidth: "100%",
              display: "grid",
              gap: 7,
              justifyItems: "start",
            }}
          >
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
              maxWidth: "min(720px, 100%)",
              width: "min(720px, 100%)",
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
                if (!titleBlurSuppressionRef.current.shouldHandleBlur()) return;
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
                  titleBlurSuppressionRef.current.suppress();
                  const latestTitle = (editingTitleRef.current?.textContent ?? editingTitleDraftRef.current).trim();
                  void onUpdateTitle(latestTitle);
                  onSetIsEditingTitle(false);
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  titleBlurSuppressionRef.current.suppress();
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
          {gvicBoard && (
            <div style={{ justifySelf: "start", alignSelf: "start", minWidth: 0, maxWidth: "min(780px, 100%)", width: "min(780px, 100%)" }}>
              {gvicBoard}
            </div>
          )}
          </div>
          {nodePresetFields && (
            <div
              className="mango-editor-hover-highlight"
              style={nodePresetGridStyle}
            >
              <div style={{ ...(compactHeader ? { order: 1 } : { gridColumn: 1, gridRow: 1 }), minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
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
              <div style={{ ...(compactHeader ? { order: 3 } : { gridColumn: 3, gridRow: 1 }), minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Accounts:</strong>
                <AccountFilterControl
                  accounts={nodePresetFields.accountOptions}
                  selectedAccountIDs={nodePresetFields.accounts.map((account) => account.account_id)}
                  onChange={onCommitNodeAccountIDs}
                  disabled={!canEdit}
                  compact
                  showLabel={false}
                  placeholder="Search accounts"
                  style={{ minWidth: 0, width: compactHeader ? "100%" : "min(220px, 100%)" }}
                />
              </div>
              <label style={{ ...(compactHeader ? { order: 4 } : { gridColumn: 4, gridRow: 1 }), minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Due Date:</strong>
                <span style={{ position: "relative", display: "inline-grid", gridTemplateColumns: "minmax(0, 1fr) 24px", alignItems: "center", width: compactHeader ? "min(148px, 100%)" : 138 }}>
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
              <label style={{ ...(compactHeader ? { order: 2 } : { gridColumn: 2, gridRow: 1 }), minWidth: 0, display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", gap: 6, alignItems: "center" }}>
                <strong>Priority:</strong>
                <span style={{ display: "grid", gap: 4, minWidth: 0 }}>
                  <span ref={priorityMenuRef} style={{ position: "relative", display: "inline-block", width: "min(100%, 200px)" }}>
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

function RACIAssignmentBoard({
  assignments,
  mode,
  overwrittenByAncestor,
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
  assignments: LogicGateRACIAssignment[];
  mode: "inherited" | "customized";
  overwrittenByAncestor?: { resource_type: string; resource_id: string; sequence: number } | null;
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  companyUserGroups: Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>;
  companyUserGroupMembers: Array<{ group_id: string; user_id: string }>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  canEdit: boolean;
  disabledReason?: string;
  onAddPrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
  onRemovePrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
}) {
  return (
    <div style={{ minWidth: 0, width: "100%", display: "grid", gap: 6, overflow: "hidden" }}>
      <div
        aria-label="GVIC policy mode"
        style={{ justifySelf: "start", padding: "3px 8px", borderRadius: 999, fontSize: 10, fontWeight: 800, color: mode === "inherited" ? "#475569" : "#1d4ed8", background: mode === "inherited" ? "rgba(226, 232, 240, 0.72)" : "rgba(219, 234, 254, 0.82)" }}
      >
        {mode === "inherited" ? "Inherited" : "Customized"}
      </div>
      {overwrittenByAncestor && (
        <div style={{ fontSize: 10, color: "#64748b" }}>This item currently follows the policy applied by an ancestor.</div>
      )}
      <div
        aria-label="RACI assignments"
        style={{
          minWidth: 0,
          width: "100%",
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(145px, 1fr))",
          gap: 6,
          alignItems: "stretch",
        }}
      >
        {RACI_ROLES.map((item) => (
          <RACIRoleEditor
            key={item.role}
            role={item.role}
            label={item.label}
            assignments={assignments.filter((assignment) => assignment.role === item.role)}
            allAssignments={assignments}
            companyUsers={companyUsers}
            companyUserGroups={companyUserGroups}
            companyUserGroupMembers={companyUserGroupMembers}
            accent={accent}
            panelBackground={panelBackground}
            ruleColor={ruleColor}
            canEdit={canEdit}
            disabledReason={disabledReason}
            onAddPrincipal={onAddPrincipal}
            onRemovePrincipal={onRemovePrincipal}
          />
        ))}
      </div>
    </div>
  );
}

function RACIRoleEditor({
  role,
  label,
  assignments,
  allAssignments,
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
  role: LogicGateRACIRole;
  label: string;
  assignments: LogicGateRACIAssignment[];
  allAssignments: LogicGateRACIAssignment[];
  companyUsers: Array<{ user_id: string; email?: string; display_name?: string }>;
  companyUserGroups: Array<{ group_id: string; parent_group_id?: string; name: string; position: number }>;
  companyUserGroupMembers: Array<{ group_id: string; user_id: string }>;
  accent: string;
  panelBackground: string;
  ruleColor: string;
  canEdit: boolean;
  disabledReason?: string;
  onAddPrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
  onRemovePrincipal: (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => void;
}) {
  const floatingPortalTarget = useAppOverlayPortalTarget();
  const inputID = useId();
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [assignedOpen, setAssignedOpen] = useState(false);
  const [assignedHoverOpen, setAssignedHoverOpen] = useState(false);
  const [disabledTooltipPosition, setDisabledTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [expandedGroupIDs, setExpandedGroupIDs] = useState<Set<string>>(() => new Set());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const assignedAnchorRef = useRef<HTMLDivElement | null>(null);
  const assignedListRef = useRef<HTMLDivElement | null>(null);
  const assignedHoverCloseTimerRef = useRef<number | null>(null);
  const inputAnchorRef = useRef<HTMLDivElement | null>(null);
  const pickerListRef = useRef<HTMLDivElement | null>(null);
  const occupiedRoleByPrincipalKey = useMemo(() => {
    const out = new Map<string, LogicGateRACIRole>();
    for (const assignment of allAssignments) {
      const key = logicGateRACIAssignmentSubjectKey(assignment);
      if (key !== "user:" && key !== "group:") out.set(key, assignment.role);
    }
    return out;
  }, [allAssignments]);
  const roleAccent = logicGateRACIRolePresentation(role).accent;
  const inheritedReadOnly = Boolean(disabledReason) && !canEdit;
  const inputPlaceholder = disabledReason ? "Inherited" : "Add user or team";
  const pickerAriaLabel = `${label} users and teams`;
  const assignedLabels = assignments.map(RACIAssignmentLabel).filter(Boolean);
  const assignedSummary = assignedLabels.length === 0
    ? "No assignments"
    : assignedLabels.join(", ");
  const assignedListVisible = assignedOpen || assignedHoverOpen;
  const showDisabledTooltip = inheritedReadOnly && Boolean(disabledReason && disabledTooltipPosition);
  const assignedListPosition = useFloatingLayerPosition(assignedAnchorRef, assignedListVisible, { width: 320, maxHeight: 240 });
  const pickerListPosition = useFloatingLayerPosition(inputAnchorRef, canEdit && open, { width: 360, maxHeight: 290 });
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
    const principalState = (principalType: LogicGateRACIPrincipalType, principalID: string, availableMeta: string, currentRoleMeta: string) => {
      const key = `${principalType}:${principalID}`;
      const occupiedRole = occupiedRoleByPrincipalKey.get(key);
      if (!occupiedRole) return { selectable: true, meta: availableMeta };
      if (occupiedRole === role) return { selectable: false, meta: currentRoleMeta };
      return { selectable: false, meta: `In ${RACIRoleDisplayLabel(occupiedRole)}` };
    };
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
    const userRowsForGroup = (groupID: string, depth: number): LogicGateRACIPrincipalPickerOption[] => {
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
        const state = principalState("user", userID, email, "Added");
        return {
          principalType: "user",
          principalID: userID,
          label: name || userLabel,
          meta: state.meta,
          depth,
          rowType: "user",
          selectable: state.selectable,
          expandable: false,
          expanded: false,
        };
      });
    };
    const buildGroupRows = (group: { group_id: string; parent_group_id?: string; name: string; position: number }, depth: number, seenGroups: Set<string>): { rows: LogicGateRACIPrincipalPickerOption[]; matched: boolean } => {
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
      const state = principalState("group", groupID, "Team", "Team added");
      const rows: LogicGateRACIPrincipalPickerOption[] = [{
        principalType: "group",
        principalID: groupID,
        label: companyGroupLabel(group, groupID),
        meta: state.meta,
        depth,
        rowType: "group",
        selectable: state.selectable,
        expandable: hasChildren,
        expanded,
      }];
      if (expanded) rows.push(...childRows, ...memberRows);
      return { rows, matched: true };
    };

    const rows: LogicGateRACIPrincipalPickerOption[] = [];
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
      const state = principalState("user", userID, email, "Added");
      rows.push({
        principalType: "user",
        principalID: userID,
        label: name || userLabel,
        meta: state.meta,
        depth: 0,
        rowType: "user",
        selectable: state.selectable,
        expandable: false,
        expanded: false,
      });
    }
    return {
      pickerRows: rows,
      selectableOptions: rows.filter((row) => row.selectable),
    };
  }, [companyUserGroupMembers, companyUserGroups, companyUsers, draft, expandedGroupIDs, occupiedRoleByPrincipalKey, role]);

  const showAssignedHoverPreview = () => {
    if (assignedHoverCloseTimerRef.current !== null) {
      window.clearTimeout(assignedHoverCloseTimerRef.current);
      assignedHoverCloseTimerRef.current = null;
    }
    setAssignedHoverOpen(true);
    setOpen(false);
  };

  const hideAssignedHoverPreview = () => {
    if (assignedHoverCloseTimerRef.current !== null) window.clearTimeout(assignedHoverCloseTimerRef.current);
    assignedHoverCloseTimerRef.current = window.setTimeout(() => {
      assignedHoverCloseTimerRef.current = null;
      setAssignedHoverOpen(false);
    }, 0);
  };

  useEffect(() => () => {
    if (assignedHoverCloseTimerRef.current !== null) window.clearTimeout(assignedHoverCloseTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open && !assignedListVisible) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (containerRef.current?.contains(target) || assignedListRef.current?.contains(target) || pickerListRef.current?.contains(target)) return;
      setOpen(false);
      setAssignedOpen(false);
      setAssignedHoverOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const trigger = open
          ? inputAnchorRef.current?.querySelector<HTMLButtonElement>(":scope > button")
          : assignedAnchorRef.current?.querySelector<HTMLButtonElement>(":scope > button");
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
        setAssignedOpen(false);
        setAssignedHoverOpen(false);
        window.requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
      }
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [assignedListVisible, open]);

  useEffect(() => {
    if (canEdit) return;
    setOpen(false);
    setAssignedOpen(false);
    setAssignedHoverOpen(false);
    setDraft("");
  }, [canEdit]);

  const addPrincipalOption = (option: LogicGateRACIPrincipalPickerOption) => {
    if (!canEdit || !option.selectable || occupiedRoleByPrincipalKey.has(`${option.principalType}:${option.principalID}`)) return;
    onAddPrincipal(role, option.principalType, option.principalID);
    setDraft("");
    setOpen(false);
    setAssignedOpen(false);
    setAssignedHoverOpen(false);
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
      data-raci-role-card={role}
      style={{
        ...logicGateRACIRaisedSurfaceStyle(role),
        position: "relative",
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        gap: 4,
        alignContent: "start",
        borderRadius: 9,
        padding: "5px 6px 6px",
      }}
    >
      <strong data-raci-role-heading={role} style={{ minWidth: 0, gridColumn: 1, gridRow: 1, alignSelf: "center", display: "flex", alignItems: "center", gap: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#111827" }}>
        <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: roleAccent, boxShadow: `0 0 10px ${hexWithAlpha(roleAccent, "66")}` }} />
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </strong>
      <div style={{ display: "contents" }}>
        <div ref={assignedAnchorRef} style={{ position: "relative", minHeight: 25, minWidth: 0, gridColumn: "1 / -1", gridRow: 2 }}>
            <button
              type="button"
              data-raci-assignment-summary={role}
              aria-label={`${label} people and groups`}
              aria-haspopup="listbox"
              aria-expanded={assignedListVisible}
              aria-controls={`${inputID}-assigned-users`}
              title={assignedSummary}
              onMouseEnter={showAssignedHoverPreview}
              onMouseLeave={hideAssignedHoverPreview}
              onClick={() => {
                setAssignedOpen((current) => !current);
                setOpen(false);
              }}
              style={{ width: "100%", minHeight: 25, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, border: `1px solid ${hexWithAlpha(roleAccent, assignedListVisible ? "70" : "2f")}`, borderRadius: 10, background: assignedListVisible ? EDITOR_NEU_ACTIVE_SURFACE : EDITOR_NEU_SURFACE, color: "#111827", cursor: "pointer", padding: "4px 8px", font: "inherit", fontSize: 11, fontWeight: 800, opacity: 1, boxShadow: assignedListVisible ? `0 7px 15px ${hexWithAlpha(roleAccent, "1c")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "2px 2px 7px rgba(174,174,192,0.15), -2px -2px 7px rgba(255,255,255,0.74), inset 1px 1px 0 rgba(255,255,255,0.82)" }}
            >
              <span data-raci-assignment-names={role} style={{ minWidth: 0, flex: "1 1 auto", display: "grid", gap: 2, textAlign: "left", lineHeight: 1.25 }}>
                {assignedLabels.length === 0 ? (
                  <span data-raci-assignment-empty={role} style={{ minWidth: 0, whiteSpace: "nowrap" }}>No assignments</span>
                ) : assignedLabels.map((assignmentLabel, index) => (
                  <span key={`${index}:${assignmentLabel}`} data-raci-assignment-name={role} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {assignmentLabel}
                  </span>
                ))}
              </span>
              <span aria-hidden="true" style={{ color: roleAccent || accent, fontSize: 9, fontWeight: 900 }}>{assignedListVisible ? "^" : "v"}</span>
            </button>
          {assignedListVisible && assignedListPosition && floatingPortalTarget && createPortal(
          <div
            ref={assignedListRef}
            onMouseEnter={showAssignedHoverPreview}
            onMouseLeave={hideAssignedHoverPreview}
            id={`${inputID}-assigned-users`}
            role="listbox"
            aria-label={`${label} people and groups`}
            style={{ position: "fixed", zIndex: RACI_FLOATING_LAYER_Z_INDEX + 1, top: assignedListPosition.top, left: assignedListPosition.left, width: assignedListPosition.width, maxHeight: assignedListPosition.maxHeight, overflowY: "auto", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            {assignments.length === 0 ? (
              <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 650 }}>No people or groups</div>
            ) : assignments.map((assignment) => {
              const principalType = logicGateRACIAssignmentPrincipalType(assignment);
              const principalID = logicGateRACIAssignmentPrincipalID(assignment);
              const assignmentLabel = RACIAssignmentLabel(assignment);
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
          </div>,
          floatingPortalTarget,
          )}
        </div>
        <div
          ref={inputAnchorRef}
          onMouseEnter={(event) => {
            if (!inheritedReadOnly || !disabledReason) return;
            setDisabledTooltipPosition({ x: event.clientX, y: event.clientY });
          }}
          onMouseMove={(event) => {
            if (!inheritedReadOnly || !disabledReason) return;
            setDisabledTooltipPosition({ x: event.clientX, y: event.clientY });
          }}
          onMouseLeave={() => setDisabledTooltipPosition(null)}
          style={{ position: "relative", minWidth: 0, gridColumn: 2, gridRow: 1, alignSelf: "start" }}
        >
        <button
          type="button"
          data-raci-add-principal={role}
          id={inputID}
          disabled={!canEdit}
          aria-label={`Add ${label} user or team`}
          aria-haspopup="listbox"
          aria-expanded={canEdit && open}
          aria-controls={`${inputID}-options`}
          onClick={() => {
            if (!canEdit) return;
            setAssignedOpen(false);
            setOpen((current) => !current);
          }}
          style={{ width: "fit-content", minWidth: 58, minHeight: 25, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 4, border: open ? "1px solid transparent" : `1px solid ${hexWithAlpha(roleAccent, "3f")}`, borderRadius: 8, background: open ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, linear-gradient(135deg, ${hexWithAlpha(roleAccent, "bb")}, rgba(255,255,255,0.86)) border-box` : EDITOR_NEU_SURFACE, color: canEdit ? roleAccent : "#64748b", font: "inherit", fontSize: 11, fontWeight: 850, padding: "2px 8px", outline: "none", cursor: canEdit ? "pointer" : "default", pointerEvents: canEdit ? "auto" : "none", opacity: canEdit ? 1 : 0.58, boxShadow: open ? `0 8px 18px ${hexWithAlpha(roleAccent, "1c")}, inset 1px 1px 0 rgba(255,255,255,0.86)` : "2px 2px 8px rgba(174,174,192,0.18), -2px -2px 8px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.86)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>+</span>
          <span>{disabledReason ? "Locked" : "Add"}</span>
        </button>
        {showDisabledTooltip && disabledReason && disabledTooltipPosition && (
          <div
            role="tooltip"
            style={{
              position: "fixed",
              left: disabledTooltipPosition.x + 14,
              top: disabledTooltipPosition.y - 12,
              transform: "translateY(-100%)",
              zIndex: 10000,
              maxWidth: 320,
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              background: "#ffffff",
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
        {canEdit && open && pickerListPosition && floatingPortalTarget && createPortal(
          <div
            ref={pickerListRef}
            id={`${inputID}-options`}
            role="dialog"
            aria-label={pickerAriaLabel}
            style={{ position: "fixed", zIndex: RACI_FLOATING_LAYER_Z_INDEX + 2, top: pickerListPosition.top, left: pickerListPosition.left, width: pickerListPosition.width, maxHeight: pickerListPosition.maxHeight, overflow: "hidden", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", padding: 6, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 10, background: panelBackground || EDITOR_NEU_PANEL_BACKGROUND, boxShadow: EDITOR_NEU_PANEL_SHADOW, color: "#111827" }}
          >
            <input
              value={draft}
              autoFocus
              autoComplete="new-password"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={inputPlaceholder}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitDraft();
                }
              }}
              style={{ minWidth: 0, minHeight: 30, boxSizing: "border-box", border: `1px solid ${hexWithAlpha(roleAccent, "45")}`, borderRadius: 8, background: "#ffffff", color: "#111827", font: "inherit", fontSize: 11.5, fontWeight: 750, padding: "5px 8px", outline: "none", boxShadow: "inset 1px 1px 0 rgba(255,255,255,0.86)" }}
            />
            <div role="listbox" aria-label={pickerAriaLabel} style={{ minHeight: 0, overflowY: "auto", display: "grid", alignContent: "start", gap: 3, paddingTop: 6 }}>
              {pickerRows.length === 0 ? (
                <div style={{ padding: "8px 10px", color: "#64748b", fontSize: 11, fontWeight: 500 }}>
                  {draft.trim() ? "No matches" : "No users or teams available"}
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
          </div>,
          floatingPortalTarget,
        )}
        </div>
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type ProjectFieldChoice = Readonly<{
  id: string;
  label: string;
}>;

export type ProjectFieldTone = "default" | "status" | "healthy" | "warning" | "danger";

export const PROJECT_STATUS_CHOICES: ReadonlyArray<ProjectFieldChoice> = [
  { id: "Active", label: "Active" },
  { id: "Planning", label: "Planning" },
  { id: "On Hold", label: "On Hold" },
  { id: "Completed", label: "Completed" },
  { id: "Archived", label: "Archived" },
];

export const PROJECT_HEALTH_CHOICES: ReadonlyArray<ProjectFieldChoice> = [
  { id: "On Track", label: "On Track" },
  { id: "AT RISK", label: "AT RISK" },
  { id: "Off Track", label: "Off Track" },
];

export function projectStatusChoices(currentStatus?: string | null): ProjectFieldChoice[] {
  const current = currentStatus?.trim() ?? "";
  if (!current || PROJECT_STATUS_CHOICES.some((choice) => choice.id === current)) return [...PROJECT_STATUS_CHOICES];
  return [{ id: current, label: current }, ...PROJECT_STATUS_CHOICES];
}

export function ProjectFieldControl({
  ariaLabel,
  values,
  choices,
  multiple = false,
  placeholder = "Unassigned",
  tone = "default",
  disabled = false,
  onChange,
}: {
  ariaLabel: string;
  values: string[];
  choices: ReadonlyArray<ProjectFieldChoice>;
  multiple?: boolean;
  placeholder?: string;
  tone?: ProjectFieldTone;
  disabled?: boolean;
  onChange: (nextValues: string[]) => void | Promise<void>;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [draftValues, setDraftValues] = useState<string[]>(values);
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, openUp: false });
  const cleanValues = uniqueIDs(values);
  const cleanChoices = uniqueChoices(choices);
  const cleanValueSignature = cleanValues.join("\u0000");
  const selectedLabels = cleanValues.map((id) => cleanChoices.find((choice) => choice.id === id)?.label ?? id);
  const displayLabel = selectedLabels.length === 0
    ? placeholder
    : selectedLabels.length <= 2
      ? selectedLabels.join(", ")
      : `${selectedLabels.slice(0, 2).join(", ")} +${selectedLabels.length - 2}`;
  const filteredChoices = cleanChoices.filter((choice) => choice.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const updatePosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect || typeof window === "undefined") return;
    const width = Math.min(280, Math.max(220, rect.width));
    const estimatedHeight = Math.min(360, 92 + cleanChoices.length * 36);
    const openUp = rect.bottom + estimatedHeight > window.innerHeight - 8 && rect.top > estimatedHeight;
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: openUp ? Math.max(8, rect.top - estimatedHeight - 6) : Math.min(window.innerHeight - 8, rect.bottom + 6),
      width,
      openUp,
    });
  };

  useEffect(() => {
    if (!open) return undefined;
    setDraftValues(cleanValues);
    setQuery("");
    updatePosition();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) return;
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const reposition = () => updatePosition();
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [cleanChoices.length, cleanValueSignature, open]);

  const commitSingle = (id: string) => {
    setOpen(false);
    void onChange([id]);
  };

  const toggleDraft = (id: string) => {
    setDraftValues((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };

  const popover = open && typeof document !== "undefined" ? createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`${ariaLabel} options`}
      style={popoverStyle(position)}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      {cleanChoices.length > 6 ? (
        <input
          autoFocus
          value={query}
          aria-label={`Search ${ariaLabel}`}
          placeholder={`Search ${ariaLabel.toLocaleLowerCase()}`}
          style={searchStyle}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      ) : null}
      <div style={choiceListStyle}>
        {multiple ? (
          <button type="button" style={clearChoiceStyle(draftValues.length === 0)} onClick={() => setDraftValues([])}>
            <span style={checkboxStyle(draftValues.length === 0)}>{draftValues.length === 0 ? "✓" : ""}</span>
            {placeholder}
          </button>
        ) : null}
        {filteredChoices.map((choice) => {
          const selected = (multiple ? draftValues : cleanValues).includes(choice.id);
          return (
            <button
              key={choice.id}
              type="button"
              role={multiple ? "checkbox" : "option"}
              aria-checked={multiple ? selected : undefined}
              aria-selected={multiple ? undefined : selected}
              style={choiceStyle(selected)}
              onClick={() => multiple ? toggleDraft(choice.id) : commitSingle(choice.id)}
            >
              <span style={checkboxStyle(selected)}>{selected ? "✓" : ""}</span>
              <span style={choiceLabelStyle}>{choice.label}</span>
            </button>
          );
        })}
        {filteredChoices.length === 0 ? <div style={emptyStyle}>No matches</div> : null}
      </div>
      {multiple ? (
        <div style={footerStyle}>
          <button type="button" style={cancelButtonStyle} onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" style={applyButtonStyle} onClick={() => { setOpen(false); void onChange(uniqueIDs(draftValues)); }}>Apply</button>
        </div>
      ) : null}
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup={multiple ? "dialog" : "listbox"}
        aria-expanded={open}
        disabled={disabled}
        title={displayLabel}
        style={triggerStyle(tone, disabled, selectedLabels.length === 0)}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (disabled) return;
          updatePosition();
          setOpen((value) => !value);
        }}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span style={triggerLabelStyle}>{disabled ? "Saving…" : displayLabel}</span>
        <span aria-hidden="true" style={chevronStyle}>⌄</span>
      </button>
      {popover}
    </>
  );
}

function uniqueIDs(values: ReadonlyArray<string>): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueChoices(choices: ReadonlyArray<ProjectFieldChoice>): ProjectFieldChoice[] {
  const byID = new Map<string, ProjectFieldChoice>();
  for (const choice of choices) {
    const id = choice.id.trim();
    if (!id || byID.has(id)) continue;
    byID.set(id, { id, label: choice.label.trim() || id });
  }
  return [...byID.values()];
}

function triggerStyle(tone: ProjectFieldTone, disabled: boolean, empty: boolean): React.CSSProperties {
  const colors = tone === "healthy"
    ? { background: "#ecfdf5", color: "#047857", border: "rgba(16,185,129,.28)" }
    : tone === "warning"
      ? { background: "#fff7ed", color: "#b45309", border: "rgba(245,158,11,.32)" }
      : tone === "danger"
        ? { background: "#fef2f2", color: "#b91c1c", border: "rgba(239,68,68,.28)" }
        : tone === "status"
          ? { background: "rgba(16,185,129,.11)", color: "#047857", border: "rgba(16,185,129,.24)" }
          : { background: "#ffffff", color: empty ? "#64748b" : "#334155", border: "rgba(148,163,184,.30)" };
  return {
    width: "100%",
    maxWidth: 260,
    minWidth: 0,
    minHeight: 28,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 7,
    border: `1px solid ${colors.border}`,
    borderRadius: tone === "default" ? 7 : 999,
    background: colors.background,
    color: colors.color,
    cursor: disabled ? "wait" : "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 900,
    padding: "0 8px 0 10px",
    opacity: disabled ? 0.7 : 1,
  };
}

const triggerLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const chevronStyle: React.CSSProperties = { color: "currentColor", fontSize: 12, lineHeight: 1, flexShrink: 0 };

function popoverStyle(position: { left: number; top: number; width: number; openUp: boolean }): React.CSSProperties {
  return {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 10050,
    width: position.width,
    maxHeight: "min(360px, calc(100vh - 16px))",
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    gap: 7,
    padding: 8,
    border: "1px solid rgba(100,116,139,.28)",
    borderRadius: 10,
    background: "#ffffff",
    boxShadow: "0 18px 44px rgba(15,23,42,.20)",
    boxSizing: "border-box",
  };
}

const searchStyle: React.CSSProperties = { width: "100%", minHeight: 32, border: "1px solid rgba(148,163,184,.32)", borderRadius: 7, padding: "0 9px", font: "inherit", fontSize: 12, boxSizing: "border-box", outline: "none" };
const choiceListStyle: React.CSSProperties = { minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 3 };
const choiceStyle = (selected: boolean): React.CSSProperties => ({ minHeight: 34, display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", alignItems: "center", gap: 7, border: 0, borderRadius: 7, background: selected ? "#eff6ff" : "transparent", color: "#334155", cursor: "pointer", padding: "0 8px", textAlign: "left", font: "inherit" });
const clearChoiceStyle = (selected: boolean): React.CSSProperties => ({ ...choiceStyle(selected), color: "#64748b", borderBottom: "1px solid rgba(226,232,240,.9)", borderRadius: 0, marginBottom: 3 });
const checkboxStyle = (selected: boolean): React.CSSProperties => ({ width: 16, height: 16, display: "inline-grid", placeItems: "center", border: `1px solid ${selected ? "#2563eb" : "rgba(100,116,139,.35)"}`, borderRadius: 4, background: selected ? "#2563eb" : "#fff", color: "#fff", fontSize: 11, fontWeight: 950, boxSizing: "border-box" });
const choiceLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 800 };
const emptyStyle: React.CSSProperties = { minHeight: 54, display: "grid", placeItems: "center", color: "#64748b", fontSize: 12, fontWeight: 800 };
const footerStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 7, paddingTop: 1 };
const cancelButtonStyle: React.CSSProperties = { minHeight: 30, border: "1px solid rgba(148,163,184,.3)", borderRadius: 7, background: "#fff", color: "#475569", padding: "0 10px", font: "inherit", fontSize: 12, fontWeight: 850, cursor: "pointer" };
const applyButtonStyle: React.CSSProperties = { ...cancelButtonStyle, borderColor: "#2563eb", background: "#2563eb", color: "#fff" };

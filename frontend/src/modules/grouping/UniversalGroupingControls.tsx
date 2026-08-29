import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAppOverlayPortalTarget,
  useAppViewportAnchorRect,
  type AppViewportAnchorRect,
} from "../../app/AppModalPortal.js";
import type { UniversalGroupingSetting } from "./universalGrouping.js";

export type UniversalGroupingFieldOption<Field extends string> = Readonly<{
  value: Field;
  label: string;
}>;

export type UniversalGroupingFieldVariant<Field extends string> = Readonly<{
  parentValue: Field;
  matches: (field: Field) => boolean;
  options: ReadonlyArray<UniversalGroupingFieldOption<Field>>;
  placeholder?: string;
  selectionLabel?: string;
}>;

export type UniversalGroupingControlsProps<Field extends string> = {
  groupings: ReadonlyArray<UniversalGroupingSetting<Field>>;
  fieldOptions: ReadonlyArray<UniversalGroupingFieldOption<Field>>;
  fieldVariant?: UniversalGroupingFieldVariant<Field>;
  onChange: (nextStack: Array<UniversalGroupingSetting<Field>>) => void;
  buttonLabel?: string;
  triggerIcon?: React.ReactNode;
  iconOnly?: boolean;
  popoverLabel?: string;
  emptyLabel?: string;
  accent?: string;
  disabled?: boolean;
  popoverAlign?: "start" | "end";
  triggerHidden?: boolean;
  openRequestEventName?: string;
  additionalContent?: React.ReactNode;
};

type GroupingDropTarget = {
  index: number;
  placement: "before" | "after";
};

export function UniversalGroupingControls<Field extends string>({
  groupings,
  fieldOptions,
  fieldVariant,
  onChange,
  buttonLabel = "Group",
  triggerIcon,
  iconOnly = false,
  popoverLabel = "Grouping settings",
  emptyLabel = "No grouping levels",
  accent = "#2563eb",
  disabled = false,
  popoverAlign = "end",
  triggerHidden = false,
  openRequestEventName,
  additionalContent,
}: UniversalGroupingControlsProps<Field>) {
  const [open, setOpen] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<GroupingDropTarget | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [externalPopoverPosition, setExternalPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const popoverID = useId();
  const triggerAnchor = useAppViewportAnchorRect(triggerRef, open && externalPopoverPosition === null);
  const overlayTarget = useAppOverlayPortalTarget(triggerRef.current?.ownerDocument);
  const uniqueFieldOptions = useMemo(() => dedupeFieldOptions(fieldOptions), [fieldOptions]);
  const uniqueVariantOptions = fieldVariant ? dedupeFieldOptions(fieldVariant.options) : [];
  const usedFields = new Set(groupings.map((grouping) => grouping.field));
  const variantPending = fieldVariant ? groupings.some((grouping) => grouping.field === fieldVariant.parentValue) : false;
  const isVariantField = (field: Field) => Boolean(fieldVariant && (
    field === fieldVariant.parentValue || fieldVariant.matches(field)
  ));
  const isPrimaryOptionAddable = (option: UniversalGroupingFieldOption<Field>) => {
    if (fieldVariant && option.value === fieldVariant.parentValue) {
      return !variantPending && uniqueVariantOptions.some((variant) => !usedFields.has(variant.value));
    }
    return !usedFields.has(option.value);
  };
  const addableFields = uniqueFieldOptions.filter(isPrimaryOptionAddable);
  const popoverWidth = fieldVariant ? 448 : 326;

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setDraggedIndex(null);
    setDropTarget(null);
  }, [disabled]);

  useEffect(() => {
    if (!openRequestEventName || typeof window === "undefined") return undefined;
    const handleOpenRequest = (event: Event) => {
      if (disabled) return;
      const detail = (event as CustomEvent<Partial<{ left: number; top: number; right: number; bottom: number }>>).detail;
      if (!detail || typeof detail.top !== "number") return;
      const width = popoverWidth;
      const estimatedHeight = 330;
      const requestedLeft = typeof detail.right === "number" ? detail.right + 8 : (detail.left ?? 8);
      setExternalPopoverPosition({
        left: Math.max(8, Math.min(requestedLeft, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(detail.top, window.innerHeight - estimatedHeight - 8)),
      });
      setOpen(true);
    };
    window.addEventListener(openRequestEventName, handleOpenRequest);
    return () => window.removeEventListener(openRequestEventName, handleOpenRequest);
  }, [disabled, openRequestEventName, popoverWidth]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && !rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current?.querySelector<HTMLElement>("select:not(:disabled), button:not(:disabled)")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const closePopover = (restoreFocus = false) => {
    setOpen(false);
    setDraggedIndex(null);
    setDropTarget(null);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const replaceGrouping = (index: number, nextGrouping: UniversalGroupingSetting<Field>) => {
    if (nextGrouping.field !== groupings[index]?.field && groupings.some((grouping) => grouping.field === nextGrouping.field)) return;
    onChange(groupings.map((grouping, itemIndex) => (
      itemIndex === index
        ? { field: nextGrouping.field, direction: nextGrouping.direction }
        : { field: grouping.field, direction: grouping.direction }
    )));
  };

  const removeGrouping = (index: number) => {
    onChange(groupings
      .filter((_, itemIndex) => itemIndex !== index)
      .map((grouping) => ({ field: grouping.field, direction: grouping.direction })));
  };

  const reorderGrouping = (sourceIndex: number, targetIndex: number, placement: GroupingDropTarget["placement"]) => {
    const next = moveGrouping(groupings, sourceIndex, targetIndex, placement);
    if (!next || groupingStacksEqual(groupings, next)) return;
    onChange(next);
  };
  const popoverPosition = externalPopoverPosition
    ?? (triggerAnchor ? groupingPopoverViewportPosition(triggerAnchor, popoverAlign, popoverWidth) : null);

  return (
    <div ref={rootRef} style={controlsRootStyle(triggerHidden)}>
      {!triggerHidden && (
        <button
          ref={triggerRef}
          type="button"
          aria-haspopup="dialog"
          aria-label={iconOnly ? buttonLabel : undefined}
          aria-expanded={open}
          aria-controls={open ? popoverID : undefined}
          title={iconOnly ? buttonLabel : undefined}
          disabled={disabled}
          style={groupButtonStyle(open, disabled, accent, iconOnly)}
          onClick={() => {
            setExternalPopoverPosition(null);
            setOpen((value) => !value);
          }}
        >
          {iconOnly ? triggerIcon : (
            <>
              {triggerIcon}
              <span>{buttonLabel}</span>
              <span aria-label={`${groupings.length} grouping levels`} style={groupCountStyle(open, accent)}>
                {groupings.length}
              </span>
            </>
          )}
        </button>
      )}

      {open && popoverPosition && overlayTarget && createPortal((
        <div
          ref={popoverRef}
          id={popoverID}
          role="dialog"
          aria-label={popoverLabel}
          style={groupPopoverStyle(popoverPosition, popoverWidth)}
        >
          <div style={popoverHeaderStyle}>
            <span style={popoverTitleStyle}>{popoverLabel}</span>
            <button
              type="button"
              aria-label={`Close ${popoverLabel}`}
              style={closeButtonStyle}
              onClick={() => closePopover(true)}
            >
              x
            </button>
          </div>

          <div style={groupingStackStyle}>
            {groupings.length === 0 && <div style={emptyStackStyle}>{emptyLabel}</div>}
            {groupings.map((grouping, index) => {
              const variantActive = isVariantField(grouping.field);
              const primaryField = variantActive && fieldVariant ? fieldVariant.parentValue : grouping.field;
              const currentFieldKnown = uniqueFieldOptions.some((option) => option.value === primaryField);
              const availableForRow = uniqueFieldOptions.filter((option) => (
                option.value === primaryField || isPrimaryOptionAddable(option)
              ));
              const currentVariantKnown = uniqueVariantOptions.some((option) => option.value === grouping.field);
              const availableVariantsForRow = uniqueVariantOptions.filter((option) => (
                option.value === grouping.field || !usedFields.has(option.value)
              ));
              const activeDropPlacement = dropTarget?.index === index ? dropTarget.placement : null;
              return (
                <div
                  key={String(index) + ":" + grouping.field}
                  style={groupingRowStyle(index, draggedIndex === index, activeDropPlacement, accent)}
                  onDragOver={(event) => {
                    if (draggedIndex === null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropTarget({ index, placement: dropPlacementForEvent(event) });
                  }}
                  onDragLeave={(event) => {
                    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
                    if (relatedTarget && event.currentTarget.contains(relatedTarget)) return;
                    setDropTarget((current) => current?.index === index ? null : current);
                  }}
                  onDrop={(event) => {
                    if (draggedIndex === null) return;
                    event.preventDefault();
                    reorderGrouping(draggedIndex, index, dropPlacementForEvent(event));
                    setDraggedIndex(null);
                    setDropTarget(null);
                  }}
                >
                  <button
                    type="button"
                    draggable={groupings.length > 1}
                    aria-label={`Reorder grouping level ${index + 1}. Drag, or use Arrow Up and Arrow Down.`}
                    title="Drag to reorder. Arrow Up and Arrow Down also move this level."
                    style={dragHandleStyle(groupings.length > 1)}
                    onDragStart={(event) => {
                      if (groupings.length < 2) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", String(index));
                      setDraggedIndex(index);
                      setDropTarget(null);
                    }}
                    onDragEnd={() => {
                      setDraggedIndex(null);
                      setDropTarget(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp" && index > 0) {
                        event.preventDefault();
                        reorderGrouping(index, index - 1, "before");
                      }
                      if (event.key === "ArrowDown" && index < groupings.length - 1) {
                        event.preventDefault();
                        reorderGrouping(index, index + 1, "after");
                      }
                    }}
                  >
                    <span aria-hidden="true">::</span>
                  </button>
                  <span aria-hidden="true" style={levelNumberStyle(accent)}>{index + 1}</span>
                  <div style={fieldSelectionStyle(variantActive)}>
                    <select
                      value={primaryField}
                      aria-label={`Grouping level ${index + 1} field`}
                      style={fieldSelectStyle}
                      onChange={(event) => replaceGrouping(index, {
                        field: event.currentTarget.value as Field,
                        direction: grouping.direction,
                      })}
                    >
                      {!currentFieldKnown && <option value={primaryField}>{primaryField}</option>}
                      {availableForRow.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    {variantActive && fieldVariant ? (
                      <select
                        value={grouping.field === fieldVariant.parentValue ? "" : grouping.field}
                        aria-label={`Grouping level ${index + 1} ${fieldVariant.selectionLabel ?? "selection"}`}
                        style={fieldSelectStyle}
                        onChange={(event) => replaceGrouping(index, {
                          field: event.currentTarget.value as Field,
                          direction: grouping.direction,
                        })}
                      >
                        <option value="" disabled>{fieldVariant.placeholder ?? "Choose option"}</option>
                        {!currentVariantKnown && grouping.field !== fieldVariant.parentValue ? <option value={grouping.field}>{grouping.field}</option> : null}
                        {availableVariantsForRow.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    aria-label={`Sort ${grouping.direction === "asc" ? "descending" : "ascending"} for grouping level ${index + 1}`}
                    style={directionButtonStyle}
                    onClick={() => replaceGrouping(index, {
                      field: grouping.field,
                      direction: grouping.direction === "asc" ? "desc" : "asc",
                    })}
                  >
                    {grouping.direction === "asc" ? "Asc" : "Desc"}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove grouping level ${index + 1}`}
                    title="Remove grouping"
                    style={removeButtonStyle}
                    onClick={() => removeGrouping(index)}
                  >
                    x
                  </button>
                </div>
              );
            })}
          </div>

          <div style={popoverFooterStyle}>
            <select
              value=""
              aria-label="Add grouping level"
              disabled={addableFields.length === 0}
              style={addGroupingSelectStyle(addableFields.length === 0)}
              onChange={(event) => {
                const field = event.currentTarget.value as Field;
                if (!field || usedFields.has(field)) return;
                onChange([
                  ...groupings.map((grouping) => ({ field: grouping.field, direction: grouping.direction })),
                  { field, direction: "asc" },
                ]);
              }}
            >
              <option value="" disabled>
                {addableFields.length > 0 ? "+ Add grouping" : "All fields added"}
              </option>
              {addableFields.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={groupings.length === 0}
              style={clearButtonStyle(groupings.length === 0)}
              onClick={() => onChange([])}
            >
              Clear all
            </button>
          </div>
          {additionalContent}
        </div>
      ), overlayTarget)}
    </div>
  );
}

function dedupeFieldOptions<Field extends string>(
  fieldOptions: ReadonlyArray<UniversalGroupingFieldOption<Field>>,
): Array<UniversalGroupingFieldOption<Field>> {
  const seen = new Set<Field>();
  const unique: Array<UniversalGroupingFieldOption<Field>> = [];
  for (const option of fieldOptions) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    unique.push(option);
  }
  return unique;
}

function moveGrouping<Field extends string>(
  groupings: ReadonlyArray<UniversalGroupingSetting<Field>>,
  sourceIndex: number,
  targetIndex: number,
  placement: GroupingDropTarget["placement"],
): Array<UniversalGroupingSetting<Field>> | null {
  if (sourceIndex < 0 || sourceIndex >= groupings.length || targetIndex < 0 || targetIndex >= groupings.length) return null;
  const next = groupings.map((grouping) => ({ field: grouping.field, direction: grouping.direction }));
  const [moving] = next.splice(sourceIndex, 1);
  let insertIndex = targetIndex + (placement === "after" ? 1 : 0);
  if (sourceIndex < insertIndex) insertIndex -= 1;
  next.splice(Math.max(0, Math.min(insertIndex, next.length)), 0, moving);
  return next;
}

function groupingStacksEqual<Field extends string>(
  left: ReadonlyArray<UniversalGroupingSetting<Field>>,
  right: ReadonlyArray<UniversalGroupingSetting<Field>>,
): boolean {
  return left.length === right.length && left.every((grouping, index) => (
    grouping.field === right[index]?.field && grouping.direction === right[index]?.direction
  ));
}

function dropPlacementForEvent(event: React.DragEvent<HTMLElement>): GroupingDropTarget["placement"] {
  const bounds = event.currentTarget.getBoundingClientRect();
  return event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
}

function controlsRootStyle(triggerHidden: boolean): React.CSSProperties {
  return {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    ...(triggerHidden ? { width: 0, height: 0 } : {}),
  };
}

function groupButtonStyle(open: boolean, disabled: boolean, accent: string, iconOnly: boolean): React.CSSProperties {
  return {
    minHeight: 30,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    border: `1px solid ${open ? accent : "rgba(100, 116, 139, 0.30)"}`,
    borderRadius: 7,
    background: open ? "#eff6ff" : "rgba(255, 255, 255, 0.96)",
    color: disabled ? "#94a3b8" : "#334155",
    font: "inherit",
    fontSize: 12,
    fontWeight: 850,
    cursor: disabled ? "default" : "pointer",
    width: iconOnly ? 30 : undefined,
    padding: iconOnly ? 0 : "0 9px",
    opacity: disabled ? 0.72 : 1,
    boxShadow: open ? `0 0 0 2px ${accent}22` : "0 4px 10px rgba(15, 23, 42, 0.06)",
  };
}

function groupCountStyle(open: boolean, accent: string): React.CSSProperties {
  return {
    minWidth: 18,
    height: 18,
    display: "inline-grid",
    placeItems: "center",
    borderRadius: 999,
    background: open ? accent : "#e2e8f0",
    color: open ? "#ffffff" : "#475569",
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1,
    padding: "0 4px",
    boxSizing: "border-box",
  };
}

export function groupingPopoverViewportPosition(
  anchor: AppViewportAnchorRect,
  align: "start" | "end",
  width: number,
  viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth,
  viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight,
): { left: number; top: number } {
  const gutter = 8;
  const estimatedHeight = 330;
  const desiredLeft = align === "start" ? anchor.left : anchor.left + anchor.width - width;
  return {
    left: Math.max(gutter, Math.min(desiredLeft, viewportWidth - width - gutter)),
    top: Math.max(gutter, Math.min(anchor.top + anchor.height + 6, viewportHeight - estimatedHeight - gutter)),
  };
}

function groupPopoverStyle(position: { left: number; top: number }, width: number): React.CSSProperties {
  return {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 10020,
    width,
    maxWidth: "min(" + width + "px, calc(100vw - 24px))",
    maxHeight: `calc(100vh - ${Math.round(position.top) + 8}px)`,
    overflowY: "auto",
    overscrollBehavior: "contain",
    display: "grid",
    gap: 10,
    border: "1px solid rgba(255, 255, 255, 0.88)",
    borderRadius: 14,
    background: "linear-gradient(145deg, rgba(255,255,255,0.99), rgba(241,245,249,0.96))",
    color: "#0f172a",
    padding: 11,
    boxSizing: "border-box",
    boxShadow: "14px 16px 38px rgba(71,85,105,0.20), -8px -8px 24px rgba(255,255,255,0.88), inset 1px 1px 0 rgba(255,255,255,0.96)",
  };
}

const popoverHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  paddingBottom: 2,
};

const popoverTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "#334155",
  fontSize: 13,
  fontWeight: 900,
};

const closeButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "1px solid rgba(148,163,184,0.24)",
  borderRadius: 8,
  background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
  color: "#64748b",
  font: "inherit",
  fontSize: 12,
  fontWeight: 900,
  cursor: "pointer",
  padding: 0,
  boxShadow: "2px 2px 6px rgba(148,163,184,0.14), -2px -2px 6px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255,255,255,0.94)",
};

const groupingStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 6,
};

const emptyStackStyle: React.CSSProperties = {
  minHeight: 42,
  display: "grid",
  placeItems: "center",
  border: "1px dashed rgba(148, 163, 184, 0.42)",
  borderRadius: 10,
  background: "linear-gradient(145deg,rgba(255,255,255,.90),rgba(241,245,249,.82))",
  color: "#64748b",
  fontSize: 11,
  fontWeight: 750,
};

function groupingRowStyle(
  index: number,
  dragging: boolean,
  dropPlacement: GroupingDropTarget["placement"] | null,
  accent: string,
): React.CSSProperties {
  const indent = Math.min(index * 9, 27);
  const dropIndicator = dropPlacement === "before"
    ? `inset 0 2px 0 ${accent}`
    : dropPlacement === "after"
      ? `inset 0 -2px 0 ${accent}`
      : "";
  return {
    width: `calc(100% - ${indent}px)`,
    minWidth: 0,
    minHeight: 38,
    display: "grid",
    gridTemplateColumns: "20px 22px minmax(92px, 1fr) 48px 26px",
    alignItems: "center",
    gap: 4,
    marginLeft: indent,
    border: `1px solid ${accent}2e`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: 10,
    background: dragging ? `linear-gradient(145deg,rgba(255,255,255,.90),${accent}24)` : `linear-gradient(145deg,rgba(255,255,255,.97),${accent}14)`,
    padding: "4px 5px",
    boxSizing: "border-box",
    opacity: dragging ? 0.66 : 1,
    boxShadow: dropIndicator || "4px 4px 12px rgba(148,163,184,0.13), -3px -3px 10px rgba(255,255,255,0.72), inset 1px 1px 0 rgba(255,255,255,0.82)",
  };
}

function dragHandleStyle(enabled: boolean): React.CSSProperties {
  return {
    width: 20,
    height: 24,
    display: "grid",
    placeItems: "center",
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: enabled ? "#64748b" : "#cbd5e1",
    font: "inherit",
    fontSize: 10,
    fontWeight: 900,
    letterSpacing: -1,
    cursor: enabled ? "grab" : "default",
    padding: 0,
  };
}

function levelNumberStyle(accent: string): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${accent}2e`,
    borderRadius: 7,
    background: `linear-gradient(145deg,#ffffff,${accent}14)`,
    color: accent,
    fontSize: 10,
    fontWeight: 900,
    boxShadow: "2px 2px 5px rgba(148,163,184,0.13), -2px -2px 5px rgba(255,255,255,0.80), inset 1px 1px 0 rgba(255,255,255,0.90)",
  };
}

function fieldSelectionStyle(compound: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: compound ? "minmax(86px, 0.72fr) minmax(110px, 1fr)" : "minmax(0, 1fr)",
    gap: 5,
  };
}

const fieldSelectStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 29,
  border: "1px solid rgba(148, 163, 184, 0.30)",
  borderRadius: 7,
  background: "rgba(255,255,255,.90)",
  color: "#1e293b",
  font: "inherit",
  fontSize: 11.5,
  fontWeight: 800,
  padding: "0 7px",
  boxShadow: "inset 2px 2px 6px rgba(148,163,184,0.13), inset -2px -2px 6px rgba(255,255,255,0.86)",
};

const directionButtonStyle: React.CSSProperties = {
  height: 28,
  border: "1px solid rgba(148,163,184,0.24)",
  borderRadius: 7,
  background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
  color: "#475569",
  font: "inherit",
  fontSize: 10,
  fontWeight: 850,
  cursor: "pointer",
  padding: 0,
  boxShadow: "2px 2px 5px rgba(148,163,184,0.14), -2px -2px 5px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255,255,255,0.94)",
};

const removeButtonStyle: React.CSSProperties = {
  width: 26,
  height: 28,
  border: "1px solid rgba(148,163,184,0.20)",
  borderRadius: 7,
  background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
  color: "#94a3b8",
  font: "inherit",
  fontSize: 11,
  fontWeight: 900,
  cursor: "pointer",
  padding: 0,
  boxShadow: "2px 2px 5px rgba(148,163,184,0.12), -2px -2px 5px rgba(255,255,255,0.84), inset 1px 1px 0 rgba(255,255,255,0.94)",
};

const popoverFooterStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 8,
};

function addGroupingSelectStyle(disabled: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: 32,
    border: "1px dashed rgba(37, 99, 235, 0.40)",
    borderRadius: 8,
    background: disabled ? "rgba(241,245,249,.72)" : "linear-gradient(145deg,#ffffff,#eff6ff)",
    color: disabled ? "#94a3b8" : "#1d4ed8",
    font: "inherit",
    fontSize: 11,
    fontWeight: 850,
    cursor: disabled ? "default" : "pointer",
    padding: "0 6px",
    opacity: disabled ? 0.72 : 1,
    boxShadow: disabled ? "inset 2px 2px 5px rgba(148,163,184,.10)" : "3px 3px 8px rgba(148,163,184,.14), -3px -3px 8px rgba(255,255,255,.88), inset 1px 1px 0 rgba(255,255,255,.95)",
  };
}

function clearButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    height: 32,
    border: "1px solid rgba(148,163,184,0.24)",
    borderRadius: 8,
    background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
    color: disabled ? "#cbd5e1" : "#64748b",
    font: "inherit",
    fontSize: 10.5,
    fontWeight: 800,
    cursor: disabled ? "default" : "pointer",
    padding: "0 8px",
    boxShadow: disabled ? "inset 2px 2px 5px rgba(148,163,184,.08)" : "2px 2px 6px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.86), inset 1px 1px 0 rgba(255,255,255,.94)",
  };
}

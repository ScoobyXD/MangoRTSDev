import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  useAppOverlayPortalTarget,
  useAppViewportAnchorRect,
  type AppViewportAnchorRect,
} from "../../app/AppModalPortal.js";
import { MANGO_ACCENT_HEX, MANGO_SURFACE, MANGO_TEXT } from "../../theme.js";

export type ActionItemInlineFieldDefinition<FieldID extends string = string> = Readonly<{
  id: FieldID;
  label: string;
}>;

export type ActionItemInlineFieldSettingsPopoverProps<FieldID extends string = string> = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  fields: ReadonlyArray<ActionItemInlineFieldDefinition<FieldID>>;
  mineFieldIDs: ReadonlyArray<FieldID>;
  delegatedFieldIDs: ReadonlyArray<FieldID>;
  onMineFieldIDsChange: (next: FieldID[]) => void;
  onDelegatedFieldIDsChange: (next: FieldID[]) => void;
  onRequestClose: () => void;
};

type ActionItemPerspective = "mine" | "delegated";
type FieldLocation = "tray" | "bank";
type DraggedField<FieldID extends string> = {
  perspective: ActionItemPerspective;
  fieldID: FieldID;
  source: FieldLocation;
};
type ActiveDropTarget =
  | { perspective: ActionItemPerspective; location: "tray"; index: number }
  | { perspective: ActionItemPerspective; location: "bank" };

const FIELD_DRAG_MIME = "application/x-mangorts-action-item-inline-field";
const RESERVED_FIELD_KEYS = new Set(["detail", "details", "name", "title"]);
const POPOVER_WIDTH = 392;
const POPOVER_ESTIMATED_HEIGHT = 430;

export function ActionItemInlineFieldSettingsPopover<FieldID extends string>({
  open,
  anchorRef,
  fields,
  mineFieldIDs,
  delegatedFieldIDs,
  onMineFieldIDsChange,
  onDelegatedFieldIDsChange,
  onRequestClose,
}: ActionItemInlineFieldSettingsPopoverProps<FieldID>) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleID = useId();
  const anchorRect = useAppViewportAnchorRect(anchorRef, open);
  const ownerDocument = anchorRef.current?.ownerDocument
    ?? (typeof document === "undefined" ? null : document);
  const overlayTarget = useAppOverlayPortalTarget(ownerDocument);
  const availableFields = useMemo(() => configurableFieldDefinitions(fields), [fields]);
  const availableFieldIDs = useMemo(() => new Set(availableFields.map((field) => field.id)), [availableFields]);
  const normalizedMineFieldIDs = useMemo(
    () => normalizeShownFieldIDs(mineFieldIDs, availableFieldIDs),
    [availableFieldIDs, mineFieldIDs],
  );
  const normalizedDelegatedFieldIDs = useMemo(
    () => normalizeShownFieldIDs(delegatedFieldIDs, availableFieldIDs),
    [availableFieldIDs, delegatedFieldIDs],
  );
  const [draggedField, setDraggedField] = useState<DraggedField<FieldID> | null>(null);
  const [activeDropTarget, setActiveDropTarget] = useState<ActiveDropTarget | null>(null);
  const close = (restoreFocus: boolean) => {
    setDraggedField(null);
    setActiveDropTarget(null);
    onRequestClose();
    if (!restoreFocus) return;
    ownerDocument?.defaultView?.requestAnimationFrame(() => anchorRef.current?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    if (!open || !ownerDocument) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && (popoverRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      close(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    ownerDocument.addEventListener("pointerdown", handlePointerDown, true);
    ownerDocument.addEventListener("keydown", handleKeyDown, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", handlePointerDown, true);
      ownerDocument.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [anchorRef, onRequestClose, open, ownerDocument]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = ownerDocument?.defaultView?.requestAnimationFrame(() => closeButtonRef.current?.focus({ preventScroll: true }));
    return () => {
      if (frame !== undefined) ownerDocument?.defaultView?.cancelAnimationFrame(frame);
    };
  }, [open, ownerDocument]);

  if (!open || !anchorRect || !overlayTarget) return null;
  const position = actionItemInlineFieldPopoverPosition(anchorRect, ownerDocument?.defaultView);

  const startDrag = (
    event: React.DragEvent<HTMLElement>,
    perspective: ActionItemPerspective,
    fieldID: FieldID,
    source: FieldLocation,
  ) => {
    const next: DraggedField<FieldID> = { perspective, fieldID, source };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(FIELD_DRAG_MIME, `${perspective}:${String(fieldID)}`);
    setDraggedField(next);
    setActiveDropTarget(null);
  };

  const finishDrag = () => {
    setDraggedField(null);
    setActiveDropTarget(null);
  };

  const dropIntoTray = (
    event: React.DragEvent<HTMLElement>,
    perspective: ActionItemPerspective,
    insertionIndex: number,
    shownFieldIDs: ReadonlyArray<FieldID>,
    onChange: (next: FieldID[]) => void,
  ) => {
    if (!draggedField || draggedField.perspective !== perspective) return;
    event.preventDefault();
    const next = insertShownField(shownFieldIDs, draggedField.fieldID, insertionIndex);
    if (!fieldIDSetsEqual(shownFieldIDs, next)) onChange(next);
    finishDrag();
  };

  const dropIntoBank = (
    event: React.DragEvent<HTMLElement>,
    perspective: ActionItemPerspective,
    shownFieldIDs: ReadonlyArray<FieldID>,
    onChange: (next: FieldID[]) => void,
  ) => {
    if (!draggedField || draggedField.perspective !== perspective || draggedField.source !== "tray") return;
    event.preventDefault();
    const next = shownFieldIDs.filter((fieldID) => fieldID !== draggedField.fieldID);
    if (!fieldIDSetsEqual(shownFieldIDs, next)) onChange(next);
    finishDrag();
  };

  const renderPerspective = (
    perspective: ActionItemPerspective,
    label: string,
    shownFieldIDs: ReadonlyArray<FieldID>,
    onChange: (next: FieldID[]) => void,
  ) => {
    const shownSet = new Set(shownFieldIDs);
    const shownFields = shownFieldIDs.flatMap((fieldID) => {
      const field = availableFields.find((candidate) => candidate.id === fieldID);
      return field ? [field] : [];
    });
    const bankFields = availableFields.filter((field) => !shownSet.has(field.id));
    const bankActive = activeDropTarget?.perspective === perspective && activeDropTarget.location === "bank";
    return (
      <section
        key={perspective}
        aria-labelledby={`${titleID}-${perspective}`}
        data-action-item-inline-field-section={perspective}
        style={perspectiveSectionStyle}
      >
        <h3 id={`${titleID}-${perspective}`} style={perspectiveTitleStyle}>{label}</h3>
        <div style={fieldAreaStyle}>
          <span style={fieldAreaLabelStyle}>Shown on row</span>
          <div
            role="list"
            aria-label={`${label} fields shown on row`}
            data-action-item-inline-field-tray={perspective}
            style={shownTrayStyle}
          >
            {shownFields.length === 0 ? (
              <div
                data-action-item-inline-field-insertion-index="0"
                data-action-item-inline-field-insertion-perspective={perspective}
                data-action-item-inline-field-insertion-active={
                  activeDropTarget?.perspective === perspective
                  && activeDropTarget.location === "tray"
                  && activeDropTarget.index === 0
                    ? "true"
                    : undefined
                }
                style={emptyTrayStyle(
                  activeDropTarget?.perspective === perspective
                  && activeDropTarget.location === "tray"
                  && activeDropTarget.index === 0,
                )}
                onDragEnter={(event) => {
                  if (!draggedField || draggedField.perspective !== perspective) return;
                  event.preventDefault();
                  setActiveDropTarget({ perspective, location: "tray", index: 0 });
                }}
                onDragOver={(event) => {
                  if (!draggedField || draggedField.perspective !== perspective) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                }}
                onDrop={(event) => dropIntoTray(event, perspective, 0, shownFieldIDs, onChange)}
              >
                No fields shown
              </div>
            ) : (
              <>
                {shownFields.map((field, index) => (
                  <React.Fragment key={field.id}>
                    <FieldInsertionTarget
                      perspective={perspective}
                      index={index}
                      active={activeDropTarget?.perspective === perspective
                        && activeDropTarget.location === "tray"
                        && activeDropTarget.index === index}
                      canDrop={draggedField?.perspective === perspective}
                      onActivate={() => setActiveDropTarget({ perspective, location: "tray", index })}
                      onDrop={(event) => dropIntoTray(event, perspective, index, shownFieldIDs, onChange)}
                    />
                    <FieldChip
                      perspective={perspective}
                      field={field}
                      location="tray"
                      dragging={draggedField?.perspective === perspective && draggedField.fieldID === field.id}
                      onDragStart={(event) => startDrag(event, perspective, field.id, "tray")}
                      onDragEnd={finishDrag}
                    />
                  </React.Fragment>
                ))}
                <FieldInsertionTarget
                  perspective={perspective}
                  index={shownFields.length}
                  active={activeDropTarget?.perspective === perspective
                    && activeDropTarget.location === "tray"
                    && activeDropTarget.index === shownFields.length}
                  canDrop={draggedField?.perspective === perspective}
                  onActivate={() => setActiveDropTarget({ perspective, location: "tray", index: shownFields.length })}
                  onDrop={(event) => dropIntoTray(event, perspective, shownFields.length, shownFieldIDs, onChange)}
                />
              </>
            )}
          </div>
        </div>
        <div style={fieldAreaStyle}>
          <span style={fieldAreaLabelStyle}>Field bank</span>
          <div
            role="list"
            aria-label={`${label} field bank`}
            data-action-item-inline-field-bank={perspective}
            data-action-item-inline-field-bank-active={bankActive ? "true" : undefined}
            style={fieldBankStyle(bankActive)}
            onDragEnter={(event) => {
              if (!draggedField || draggedField.perspective !== perspective || draggedField.source !== "tray") return;
              event.preventDefault();
              setActiveDropTarget({ perspective, location: "bank" });
            }}
            onDragOver={(event) => {
              if (!draggedField || draggedField.perspective !== perspective || draggedField.source !== "tray") return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => dropIntoBank(event, perspective, shownFieldIDs, onChange)}
          >
            {bankFields.length > 0
              ? bankFields.map((field) => (
                <FieldChip
                  key={field.id}
                  perspective={perspective}
                  field={field}
                  location="bank"
                  dragging={draggedField?.perspective === perspective && draggedField.fieldID === field.id}
                  onDragStart={(event) => startDrag(event, perspective, field.id, "bank")}
                  onDragEnd={finishDrag}
                />
              ))
              : <span style={emptyBankStyle}>All available fields are shown</span>}
          </div>
        </div>
      </section>
    );
  };

  return createPortal((
    <div
      ref={popoverRef}
      role="dialog"
      aria-labelledby={titleID}
      data-action-item-inline-field-settings="true"
      style={popoverStyle(position)}
    >
      <header style={popoverHeaderStyle}>
        <div style={{ minWidth: 0 }}>
          <h2 id={titleID} style={popoverTitleStyle}>Action Item row fields</h2>
          <p style={popoverDescriptionStyle}>Drag fields between each tray and its field bank.</p>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          aria-label="Close Action Item row fields"
          style={closeButtonStyle}
          onClick={() => close(true)}
        >
          ×
        </button>
      </header>
      <div style={perspectivesStyle}>
        {renderPerspective("mine", "Mine", normalizedMineFieldIDs, onMineFieldIDsChange)}
        {renderPerspective("delegated", "Delegated", normalizedDelegatedFieldIDs, onDelegatedFieldIDsChange)}
      </div>
    </div>
  ), overlayTarget);
}

type FieldChipProps<FieldID extends string> = {
  perspective: ActionItemPerspective;
  field: ActionItemInlineFieldDefinition<FieldID>;
  location: FieldLocation;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLSpanElement>) => void;
  onDragEnd: () => void;
};

function FieldChip<FieldID extends string>({
  perspective,
  field,
  location,
  dragging,
  onDragStart,
  onDragEnd,
}: FieldChipProps<FieldID>) {
  return (
    <span
      role="listitem"
      draggable
      aria-label={`${field.label}, ${location === "tray" ? "shown on row" : "hidden in field bank"}. Drag to move.`}
      data-action-item-inline-field-id={field.id}
      data-action-item-inline-field-perspective={perspective}
      data-action-item-inline-field-location={location}
      style={fieldChipStyle(location, dragging)}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <span aria-hidden="true" style={dragGripStyle}>⋮⋮</span>
      <span>{field.label}</span>
    </span>
  );
}

type FieldInsertionTargetProps = {
  perspective: ActionItemPerspective;
  index: number;
  active: boolean;
  canDrop: boolean;
  onActivate: () => void;
  onDrop: (event: React.DragEvent<HTMLSpanElement>) => void;
};

function FieldInsertionTarget({
  perspective,
  index,
  active,
  canDrop,
  onActivate,
  onDrop,
}: FieldInsertionTargetProps) {
  return (
    <span
      aria-hidden="true"
      data-action-item-inline-field-insertion-index={index}
      data-action-item-inline-field-insertion-perspective={perspective}
      data-action-item-inline-field-insertion-active={active ? "true" : undefined}
      style={fieldInsertionStyle(active)}
      onDragEnter={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        onActivate();
      }}
      onDragOver={(event) => {
        if (!canDrop) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={onDrop}
    />
  );
}

function configurableFieldDefinitions<FieldID extends string>(
  fields: ReadonlyArray<ActionItemInlineFieldDefinition<FieldID>>,
): Array<ActionItemInlineFieldDefinition<FieldID>> {
  const seen = new Set<FieldID>();
  const configurable: Array<ActionItemInlineFieldDefinition<FieldID>> = [];
  for (const field of fields) {
    if (seen.has(field.id) || fieldIsReserved(field.id) || fieldIsReserved(field.label)) continue;
    seen.add(field.id);
    configurable.push(field);
  }
  return configurable;
}

function fieldIsReserved(value: string): boolean {
  return RESERVED_FIELD_KEYS.has(value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
}

function normalizeShownFieldIDs<FieldID extends string>(
  fieldIDs: ReadonlyArray<FieldID>,
  availableFieldIDs: ReadonlySet<FieldID>,
): FieldID[] {
  const seen = new Set<FieldID>();
  return fieldIDs.filter((fieldID) => {
    if (!availableFieldIDs.has(fieldID) || seen.has(fieldID)) return false;
    seen.add(fieldID);
    return true;
  });
}

function insertShownField<FieldID extends string>(
  current: ReadonlyArray<FieldID>,
  fieldID: FieldID,
  insertionIndex: number,
): FieldID[] {
  const sourceIndex = current.indexOf(fieldID);
  const next = current.filter((candidate) => candidate !== fieldID);
  const adjustedIndex = sourceIndex >= 0 && sourceIndex < insertionIndex
    ? insertionIndex - 1
    : insertionIndex;
  next.splice(Math.max(0, Math.min(adjustedIndex, next.length)), 0, fieldID);
  return next;
}

function fieldIDSetsEqual<FieldID extends string>(left: ReadonlyArray<FieldID>, right: ReadonlyArray<FieldID>): boolean {
  return left.length === right.length && left.every((fieldID, index) => fieldID === right[index]);
}

export function actionItemInlineFieldPopoverPosition(
  anchor: AppViewportAnchorRect,
  view: Pick<Window, "innerWidth" | "innerHeight"> | null | undefined,
): { left: number; top: number } {
  const gutter = 8;
  const viewportWidth = view?.innerWidth ?? 1200;
  const viewportHeight = view?.innerHeight ?? 800;
  const desiredLeft = anchor.left + anchor.width - POPOVER_WIDTH;
  return {
    left: Math.max(gutter, Math.min(desiredLeft, viewportWidth - POPOVER_WIDTH - gutter)),
    top: Math.max(gutter, Math.min(anchor.top + anchor.height + 6, viewportHeight - POPOVER_ESTIMATED_HEIGHT - gutter)),
  };
}

const perspectivesStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 9,
};

const perspectiveSectionStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 7,
  border: "1px solid rgba(148,163,184,.22)",
  borderRadius: 11,
  background: "linear-gradient(145deg,rgba(255,255,255,.96),rgba(248,250,252,.84))",
  padding: 8,
  boxShadow: "3px 4px 10px rgba(100,116,139,.10), -2px -2px 7px rgba(255,255,255,.82), inset 1px 1px 0 rgba(255,255,255,.92)",
};

const perspectiveTitleStyle: React.CSSProperties = {
  margin: 0,
  color: MANGO_TEXT,
  fontSize: 12,
  fontWeight: 900,
};

const fieldAreaStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 4,
};

const fieldAreaLabelStyle: React.CSSProperties = {
  color: "#64748b",
  fontSize: 9.5,
  fontWeight: 850,
  letterSpacing: ".04em",
  textTransform: "uppercase",
};

const shownTrayStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: 38,
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  alignContent: "center",
  gap: 3,
  border: "1px solid rgba(100,116,139,.26)",
  borderRadius: 9,
  background: "rgba(255,255,255,.92)",
  padding: 5,
  boxSizing: "border-box",
  boxShadow: "inset 2px 2px 6px rgba(148,163,184,.11), inset -2px -2px 6px rgba(255,255,255,.88)",
};

function emptyTrayStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 26,
    display: "grid",
    placeItems: "center",
    border: `1px dashed ${active ? "rgba(71,85,105,.68)" : "rgba(148,163,184,.34)"}`,
    borderRadius: 7,
    background: active ? "rgba(226,232,240,.62)" : "rgba(248,250,252,.62)",
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 750,
  };
}

function fieldBankStyle(active: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 35,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    border: `1px dashed ${active ? "rgba(71,85,105,.72)" : "rgba(148,163,184,.34)"}`,
    borderRadius: 9,
    background: active ? "rgba(226,232,240,.64)" : "rgba(241,245,249,.62)",
    padding: 5,
    boxSizing: "border-box",
    transition: "background 120ms ease, border-color 120ms ease",
  };
}

function fieldChipStyle(location: FieldLocation, dragging: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: 26,
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: `1px solid ${location === "tray" ? "rgba(71,85,105,.30)" : "rgba(148,163,184,.28)"}`,
    borderRadius: 7,
    background: location === "tray"
      ? "linear-gradient(145deg,#ffffff,#e2e8f0)"
      : "linear-gradient(145deg,#ffffff,#f1f5f9)",
    color: "#334155",
    padding: "0 7px 0 5px",
    boxSizing: "border-box",
    fontSize: 10.5,
    fontWeight: 800,
    cursor: "grab",
    userSelect: "none",
    opacity: dragging ? 0.48 : 1,
    boxShadow: "2px 2px 5px rgba(100,116,139,.12), -1px -1px 4px rgba(255,255,255,.88), inset 1px 1px 0 rgba(255,255,255,.92)",
    transition: "opacity 100ms ease, transform 100ms ease",
  };
}

const dragGripStyle: React.CSSProperties = {
  color: "#94a3b8",
  fontSize: 8,
  fontWeight: 900,
  letterSpacing: -2,
};

function fieldInsertionStyle(active: boolean): React.CSSProperties {
  return {
    width: active ? 34 : 6,
    height: 26,
    flex: `0 0 ${active ? 34 : 6}px`,
    display: "block",
    borderRadius: 6,
    background: active ? "rgba(71,85,105,.18)" : "transparent",
    boxShadow: active ? `inset 2px 0 0 ${MANGO_ACCENT_HEX}, inset -2px 0 0 ${MANGO_ACCENT_HEX}` : "none",
    transition: "width 110ms ease, flex-basis 110ms ease, background 110ms ease",
  };
}

const emptyBankStyle: React.CSSProperties = {
  width: "100%",
  color: "#94a3b8",
  fontSize: 10,
  fontWeight: 750,
  textAlign: "center",
};

function popoverStyle(position: { left: number; top: number }): React.CSSProperties {
  return {
    position: "fixed",
    left: position.left,
    top: position.top,
    zIndex: 10020,
    width: POPOVER_WIDTH,
    maxWidth: "calc(100vw - 16px)",
    maxHeight: `calc(100vh - ${Math.round(position.top) + 8}px)`,
    overflowY: "auto",
    display: "grid",
    gap: 9,
    border: "1px solid rgba(255,255,255,.88)",
    borderRadius: 14,
    background: "linear-gradient(145deg,rgba(255,255,255,.99),rgba(241,245,249,.96))",
    color: MANGO_TEXT,
    padding: 10,
    boxSizing: "border-box",
    boxShadow: "14px 16px 38px rgba(71,85,105,.20), -8px -8px 24px rgba(255,255,255,.88), inset 1px 1px 0 rgba(255,255,255,.96)",
  };
}

const popoverHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 8,
};

const popoverTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#334155",
  fontSize: 13,
  fontWeight: 900,
};

const popoverDescriptionStyle: React.CSSProperties = {
  margin: "2px 0 0",
  color: "#64748b",
  fontSize: 9.5,
  fontWeight: 650,
};

const closeButtonStyle: React.CSSProperties = {
  width: 27,
  height: 27,
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(148,163,184,.24)",
  borderRadius: 8,
  background: MANGO_SURFACE,
  color: "#64748b",
  font: "inherit",
  fontSize: 16,
  fontWeight: 800,
  cursor: "pointer",
  padding: 0,
  boxShadow: "2px 2px 6px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.86), inset 1px 1px 0 rgba(255,255,255,.94)",
};

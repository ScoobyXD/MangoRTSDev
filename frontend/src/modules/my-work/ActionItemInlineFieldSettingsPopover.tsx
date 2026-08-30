import React, { useMemo, useState } from "react";
import { MANGO_TEXT } from "../../theme.js";

export type ActionItemInlineFieldDefinition<FieldID extends string = string> = Readonly<{
  id: FieldID;
  label: string;
}>;

export type ActionItemInlineFieldSettingsProps<FieldID extends string = string> = {
  fields: ReadonlyArray<ActionItemInlineFieldDefinition<FieldID>>;
  mineFieldIDs: ReadonlyArray<FieldID>;
  delegatedFieldIDs: ReadonlyArray<FieldID>;
  onMineFieldIDsChange: (next: FieldID[]) => void;
  onDelegatedFieldIDsChange: (next: FieldID[]) => void;
  accent?: string;
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

export function ActionItemInlineFieldSettings<FieldID extends string>({
  fields,
  mineFieldIDs,
  delegatedFieldIDs,
  onMineFieldIDsChange,
  onDelegatedFieldIDsChange,
  accent = "#EA84E5",
}: ActionItemInlineFieldSettingsProps<FieldID>) {
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
        aria-label={`${label} inline row fields`}
        data-action-item-inline-field-section={perspective}
        data-action-item-view-quadrant={perspective}
        style={perspectiveSectionStyle(perspective, accent)}
      >
        <h3 style={perspectiveTitleStyle}>{label} inline row fields</h3>
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
                  accent,
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
                      accent={accent}
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
                  accent={accent}
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
            style={fieldBankStyle(bankActive, accent)}
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

  return (
    <>
      {renderPerspective("mine", "Mine", normalizedMineFieldIDs, onMineFieldIDsChange)}
      {renderPerspective("delegated", "Delegated", normalizedDelegatedFieldIDs, onDelegatedFieldIDsChange)}
    </>
  );
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
  accent: string;
  active: boolean;
  canDrop: boolean;
  onActivate: () => void;
  onDrop: (event: React.DragEvent<HTMLSpanElement>) => void;
};

function FieldInsertionTarget({
  perspective,
  index,
  accent,
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
      style={fieldInsertionStyle(active, accent)}
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

function perspectiveSectionStyle(perspective: ActionItemPerspective, accent: string): React.CSSProperties {
  return {
    gridArea: perspective,
    minWidth: 0,
    display: "grid",
    alignContent: "start",
    gap: 7,
    border: `1px solid ${accent}38`,
    borderTop: `3px solid ${accent}`,
    borderRadius: 11,
    background: `linear-gradient(145deg,rgba(255,255,255,.98),${accent}0d)`,
    padding: 8,
    boxShadow: `3px 4px 10px ${accent}18, -2px -2px 7px rgba(255,255,255,.82), inset 1px 1px 0 rgba(255,255,255,.92)`,
  };
}

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

function emptyTrayStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 26,
    display: "grid",
    placeItems: "center",
    border: `1px dashed ${active ? accent : "rgba(148,163,184,.34)"}`,
    borderRadius: 7,
    background: active ? "rgba(226,232,240,.62)" : "rgba(248,250,252,.62)",
    color: "#94a3b8",
    fontSize: 10,
    fontWeight: 750,
  };
}

function fieldBankStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 35,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
    border: `1px dashed ${active ? accent : "rgba(148,163,184,.34)"}`,
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

function fieldInsertionStyle(active: boolean, accent: string): React.CSSProperties {
  return {
    width: active ? 34 : 6,
    height: 26,
    flex: `0 0 ${active ? 34 : 6}px`,
    display: "block",
    borderRadius: 6,
    background: active ? "rgba(71,85,105,.18)" : "transparent",
    boxShadow: active ? `inset 2px 0 0 ${accent}, inset -2px 0 0 ${accent}` : "none",
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

import React, { useState } from "react";

export type ActionItemOrdering<Field extends string = string> = Readonly<{
  field: Field;
  direction: "asc" | "desc";
}>;

export type ActionItemOrderingEditorProps<Field extends string = string> = {
  orderings: ReadonlyArray<ActionItemOrdering<Field>>;
  fieldOptions: ReadonlyArray<{ value: Field; label: string }>;
  onChange: (next: ActionItemOrdering<Field>[]) => void;
  accent?: string;
};

export function ActionItemOrderingEditor<Field extends string>({
  orderings,
  fieldOptions,
  onChange,
  accent = "#EA84E5",
}: ActionItemOrderingEditorProps<Field>) {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const usedFields = new Set(orderings.map((ordering) => ordering.field));
  const addableFields = fieldOptions.filter((option) => !usedFields.has(option.value));
  const replace = (index: number, next: ActionItemOrdering<Field>) => {
    if (next.field !== orderings[index]?.field && usedFields.has(next.field)) return;
    onChange(orderings.map((ordering, candidateIndex) => candidateIndex === index ? { ...next } : { ...ordering }));
  };
  const move = (sourceIndex: number, targetIndex: number) => {
    const next = moveActionItemOrdering(orderings, sourceIndex, targetIndex);
    if (next) onChange(next);
  };
  return (
    <section
      data-my-work-action-item-ordering="true"
      data-action-item-view-quadrant="order"
      style={sectionStyle(accent)}
    >
      <h3 style={titleStyle}>Order items by</h3>
      <div style={{ display: "grid", gap: 7 }}>
        {orderings.length === 0 && <div style={emptyStyle}>Use stable backend order</div>}
        {orderings.map((ordering, index) => (
          <div
            key={`${ordering.field}:${index}`}
            role="group"
            aria-label={`Item ordering ${index + 1}`}
            data-my-work-ordering-field={ordering.field}
            draggable={orderings.length > 1}
            tabIndex={orderings.length > 1 ? 0 : -1}
            style={rowStyle(draggedIndex === index, orderings.length > 1, accent)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
              setDraggedIndex(index);
            }}
            onDragEnd={() => setDraggedIndex(null)}
            onDragOver={(event) => {
              if (draggedIndex === null) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              if (draggedIndex === null) return;
              event.preventDefault();
              move(draggedIndex, index);
              setDraggedIndex(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowUp" && index > 0) {
                event.preventDefault();
                move(index, index - 1);
              }
              if (event.key === "ArrowDown" && index < orderings.length - 1) {
                event.preventDefault();
                move(index, index + 1);
              }
            }}
          >
            <span aria-hidden="true" style={gripStyle}>⋮⋮</span>
            <span aria-hidden="true" style={levelStyle(accent)}>{index + 1}</span>
            <select
              aria-label={`Item ordering ${index + 1} field`}
              value={ordering.field}
              style={selectStyle}
              onChange={(event) => replace(index, {
                field: event.currentTarget.value as Field,
                direction: ordering.direction,
              })}
            >
              {fieldOptions
                .filter((option) => option.value === ordering.field || !usedFields.has(option.value))
                .map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button
              type="button"
              aria-label={`Sort ${ordering.direction === "asc" ? "descending" : "ascending"} for item ordering ${index + 1}`}
              style={buttonStyle}
              onClick={() => replace(index, {
                field: ordering.field,
                direction: ordering.direction === "asc" ? "desc" : "asc",
              })}
            >
              {ordering.direction === "asc" ? "Asc" : "Desc"}
            </button>
            <button
              type="button"
              aria-label={`Remove item ordering ${index + 1}`}
              style={removeButtonStyle}
              onClick={() => onChange(orderings
                .filter((_, candidateIndex) => candidateIndex !== index)
                .map((candidate) => ({ ...candidate })))}
            >
              x
            </button>
          </div>
        ))}
      </div>
      <div style={footerStyle}>
        <select
          aria-label="Add item ordering"
          value=""
          disabled={addableFields.length === 0}
          style={{ ...selectStyle, flex: "1 1 auto", opacity: addableFields.length === 0 ? 0.52 : 1 }}
          onChange={(event) => {
            const field = event.currentTarget.value as Field;
            if (!field || usedFields.has(field)) return;
            onChange([...orderings.map((ordering) => ({ ...ordering })), { field, direction: "asc" }]);
          }}
        >
          <option value="" disabled>{addableFields.length > 0 ? "+ Add ordering" : "All fields used"}</option>
          {addableFields.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button
          type="button"
          disabled={orderings.length === 0}
          style={{ ...buttonStyle, opacity: orderings.length === 0 ? 0.52 : 1 }}
          onClick={() => onChange([])}
        >
          Clear all
        </button>
      </div>
    </section>
  );
}

export function moveActionItemOrdering<Field extends string>(
  orderings: ReadonlyArray<ActionItemOrdering<Field>>,
  sourceIndex: number,
  targetIndex: number,
): ActionItemOrdering<Field>[] | null {
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex >= orderings.length || targetIndex >= orderings.length) return null;
  if (sourceIndex === targetIndex) return null;
  const next = orderings.map((ordering) => ({ ...ordering }));
  const [moving] = next.splice(sourceIndex, 1);
  if (!moving) return null;
  next.splice(targetIndex, 0, moving);
  return next;
}

function sectionStyle(accent: string): React.CSSProperties {
  return {
    gridArea: "order",
    minWidth: 0,
    display: "grid",
    alignContent: "start",
    gap: 8,
    border: `1px solid ${accent}38`,
    borderTop: `3px solid ${accent}`,
    borderRadius: 11,
    background: `linear-gradient(145deg,rgba(255,255,255,.98),${accent}0d)`,
    padding: 8,
    boxSizing: "border-box",
    boxShadow: `3px 4px 10px ${accent}18, -2px -2px 7px rgba(255,255,255,.82), inset 1px 1px 0 rgba(255,255,255,.92)`,
  };
}

const titleStyle: React.CSSProperties = { margin: 0, color: "#334155", fontSize: 12, fontWeight: 900 };
const emptyStyle: React.CSSProperties = {
  border: "1px dashed rgba(148,163,184,.42)",
  borderRadius: 8,
  background: "rgba(248,250,252,.74)",
  color: "#64748b",
  fontSize: 10.5,
  fontWeight: 700,
  textAlign: "center",
  padding: "9px 7px",
};
const selectStyle: React.CSSProperties = {
  minWidth: 0,
  height: 28,
  border: "1px solid rgba(100,116,139,.30)",
  borderRadius: 7,
  background: "linear-gradient(145deg,#ffffff,#e2e8f0)",
  color: "#475569",
  font: "inherit",
  fontSize: 10.5,
  fontWeight: 800,
  padding: "0 6px",
};
const buttonStyle: React.CSSProperties = {
  height: 27,
  border: "1px solid rgba(100,116,139,.30)",
  borderRadius: 7,
  background: "linear-gradient(145deg,#ffffff,#e2e8f0)",
  color: "#475569",
  cursor: "pointer",
  font: "inherit",
  fontSize: 9.5,
  fontWeight: 900,
  padding: "0 7px",
};
const removeButtonStyle: React.CSSProperties = { ...buttonStyle, width: 25, padding: 0 };
const footerStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8 };
const gripStyle: React.CSSProperties = { color: "#94a3b8", fontSize: 8, fontWeight: 900, letterSpacing: -2 };
function levelStyle(accent: string): React.CSSProperties {
  return {
    width: 21,
    height: 21,
    display: "grid",
    placeItems: "center",
    borderRadius: 999,
    background: accent,
    color: "#fff",
    fontSize: 9.5,
    fontWeight: 900,
  };
}
function rowStyle(dragging: boolean, draggable: boolean, accent: string): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "14px 22px minmax(0,1fr) 48px 26px",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${accent}2e`,
    borderRadius: 9,
    background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
    cursor: draggable ? "grab" : "default",
    opacity: dragging ? 0.52 : 1,
    padding: 5,
  };
}

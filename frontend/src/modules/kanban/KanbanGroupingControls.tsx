import React, { useEffect, useState } from "react";
import type { SavedViewGrouping } from "../../pages/home/savedViewsApi";
import { KANBAN_GROUP_FIELDS } from "./shared";

type KanbanGroupingControlsProps = {
  controlsRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  groupings: SavedViewGrouping[];
  loading: boolean;
  saving: boolean;
  error: string;
  isDark: boolean;
  line: string;
  cardBackground: string;
  text: string;
  subtext: string;
  accent: string;
  dateAddedSortEnabled: boolean;
  dateAddedSortDirection: "asc" | "desc";
  onToggleOpen: () => void;
  onAddGrouping: (field: string) => void;
  onUpdateGrouping: (index: number, grouping: SavedViewGrouping) => void;
  onRemoveGrouping: (index: number) => void;
  onToggleDateAddedSortEnabled: () => void;
  onToggleDateAddedSortDirection: () => void;
};

export const KanbanGroupingControls: React.FC<KanbanGroupingControlsProps> = ({
  controlsRef,
  open,
  groupings,
  loading,
  saving,
  error,
  isDark,
  line,
  cardBackground,
  text,
  subtext,
  accent,
  dateAddedSortEnabled,
  dateAddedSortDirection,
  onToggleOpen,
  onAddGrouping,
  onUpdateGrouping,
  onRemoveGrouping,
  onToggleDateAddedSortEnabled,
  onToggleDateAddedSortDirection,
}) => {
  const [addGroupingOpen, setAddGroupingOpen] = useState(false);
  const [groupingFieldMenuIndex, setGroupingFieldMenuIndex] = useState<number | null>(null);
  const usedFields = new Set(groupings.map((grouping) => grouping.field));
  const addableFields = KANBAN_GROUP_FIELDS.filter((field) => !usedFields.has(field.value));
  const buttonSurface = isDark ? "rgba(15,23,42,0.86)" : "rgba(255,255,255,0.92)";

  useEffect(() => {
    if (!open) {
      setAddGroupingOpen(false);
      setGroupingFieldMenuIndex(null);
    }
  }, [open]);

  return (
    <div ref={controlsRef} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        title="Group"
        aria-expanded={open}
        onClick={onToggleOpen}
        style={{
          height: 32,
          border: `1px solid ${open ? accent : line}`,
          borderRadius: 8,
          background: buttonSurface,
          color: text,
          cursor: "pointer",
          padding: "0 12px",
          font: "inherit",
          fontSize: 12,
          fontWeight: 850,
          boxShadow: open ? `0 0 0 2px ${rgba(accent, 0.16)}` : "0 6px 14px rgba(15,23,42,0.10)",
        }}
      >
        Group
      </button>
      {open && (
        <div
          data-kanban-group-controls="true"
          style={{
            position: "absolute",
            left: 0,
            top: 38,
            width: 306,
            maxWidth: "min(306px, calc(100vw - 32px))",
            border: `1px solid ${line}`,
            borderRadius: 12,
            background: isDark
              ? cardBackground
              : "linear-gradient(145deg, rgba(248,252,255,0.98), rgba(240,247,250,0.92) 48%, rgba(236,253,245,0.84))",
            color: text,
            boxShadow: "12px 12px 28px rgba(148,163,184,0.22), -8px -8px 22px rgba(255,255,255,0.80), inset 1px 1px 0 rgba(255,255,255,0.86)",
            padding: 10,
            zIndex: 35,
          }}
        >
          <div style={groupingStackStyle}>
            {groupings.map((grouping, index) => {
              return (
              <div key={`${grouping.field}:${index}`} style={groupingRowStyle(index)}>
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => {
                    setAddGroupingOpen(false);
                    setGroupingFieldMenuIndex(groupingFieldMenuIndex === index ? null : index);
                  }}
                  style={groupingFieldButtonStyle(text)}
                >
                  {KANBAN_GROUP_FIELDS
                    .filter((field) => field.value === grouping.field || !groupings.some((item, itemIndex) => itemIndex !== index && item.field === field.value))
                    .find((field) => field.value === grouping.field)?.label ?? grouping.field}
                </button>
                {groupingFieldMenuIndex === index && (
                  <div style={groupingFieldMenuStyle(buttonSurface, line)}>
                    {KANBAN_GROUP_FIELDS
                      .filter((field) => field.value === grouping.field || !groupings.some((item, itemIndex) => itemIndex !== index && item.field === field.value))
                      .map((field) => (
                        <button
                          key={field.value}
                          type="button"
                          disabled={saving}
                          style={menuOptionStyle(text, field.value === grouping.field)}
                          onClick={() => {
                            onUpdateGrouping(index, { ...grouping, field: field.value });
                            setGroupingFieldMenuIndex(null);
                          }}
                        >
                          {field.label}
                        </button>
                      ))}
                  </div>
                )}
                <button
                  type="button"
                  disabled={loading || saving}
                  onClick={() => onUpdateGrouping(index, { ...grouping, direction: grouping.direction === "asc" ? "desc" : "asc" })}
                  style={groupingDirectionButtonStyle(text, line, buttonSurface)}
                >
                  {grouping.direction === "asc" ? "Asc" : "Desc"}
                </button>
                <button
                  type="button"
                  title="Remove grouping"
                  disabled={loading || saving}
                  onClick={() => onRemoveGrouping(index)}
                  style={groupingRemoveButtonStyle(subtext)}
                >
                  x
                </button>
              </div>
              );
            })}
            <div style={groupingFooterStyle}>
              <div style={{ position: "relative", minWidth: 0 }}>
                <button
                  type="button"
                  disabled={loading || saving || addableFields.length === 0}
                  style={addGroupingButtonStyle}
                  onClick={() => {
                    setGroupingFieldMenuIndex(null);
                    setAddGroupingOpen((value) => !value);
                  }}
                >
                  + Add Grouping
                </button>
                {addGroupingOpen && (
                  <div style={addGroupingMenuStyle(buttonSurface, line)}>
                    {addableFields.map((field) => (
                      <button
                        key={field.value}
                        type="button"
                        disabled={saving}
                        style={menuOptionStyle(text, false)}
                        onClick={() => {
                          onAddGrouping(field.value);
                          setAddGroupingOpen(false);
                        }}
                      >
                        {field.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div style={dateAddedSortControlStyle(text, line, buttonSurface, dateAddedSortEnabled)}>
                <label style={dateAddedSortToggleLabelStyle(text, loading || saving)}>
                  <input
                    type="checkbox"
                    checked={dateAddedSortEnabled}
                    disabled={loading || saving}
                    onChange={onToggleDateAddedSortEnabled}
                    style={dateAddedSortCheckboxStyle(accent)}
                  />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Date Added</span>
                </label>
                <button
                  type="button"
                  title="Sort cards by date added"
                  disabled={loading || saving || !dateAddedSortEnabled}
                  onClick={onToggleDateAddedSortDirection}
                  style={dateAddedSortDirectionButtonStyle(line, buttonSurface, dateAddedSortEnabled)}
                >
                  {dateAddedSortDirection === "asc" ? "Asc" : "Desc"}
                </button>
              </div>
            </div>
          </div>
          {(loading || saving || error) && (
            <div style={{ marginTop: 8, color: error ? "#b91c1c" : subtext, fontSize: 10.5, fontWeight: 760, lineHeight: 1.25 }}>
              {error || (saving ? "Saving" : "Loading")}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function groupingAccent(index: number): string {
  return ["#0891b2", "#d97706", "#7c3aed", "#059669", "#be123c"][index % 5] ?? "#475569";
}

const groupingStackStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 7,
};

function groupingRowStyle(index: number): React.CSSProperties {
  const rowAccent = groupingAccent(index);
  const indent = Math.min(index * 12, 30);
  return {
    position: "relative",
    width: `calc(100% - ${indent}px)`,
    minWidth: 0,
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 46px 22px",
    alignItems: "center",
    gap: 5,
    marginLeft: indent,
    border: `1px solid ${rgba(rowAccent, 0.18)}`,
    borderRadius: 7,
    background: `linear-gradient(145deg, rgba(255,255,255,0.92), ${rgba(rowAccent, 0.12)})`,
    boxShadow: "4px 4px 12px rgba(148,163,184,0.13), -3px -3px 10px rgba(255,255,255,0.72), inset 1px 1px 0 rgba(255,255,255,0.82)",
    padding: "0 4px 0 7px",
    boxSizing: "border-box",
  };
}

function groupingFieldButtonStyle(text: string): React.CSSProperties {
  return {
    minWidth: 0,
    height: 24,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    border: "none",
    borderRadius: 4,
    background: "transparent",
    color: text,
    font: "inherit",
    fontSize: 12,
    fontWeight: 800,
    textAlign: "left",
    cursor: "pointer",
    padding: "0 4px",
  };
}

function groupingDirectionButtonStyle(text: string, line: string, background: string): React.CSSProperties {
  return {
    height: 22,
    border: `1px solid ${line}`,
    borderRadius: 5,
    background,
    color: text,
    cursor: "pointer",
    font: "inherit",
    fontSize: 10,
    fontWeight: 820,
    padding: 0,
  };
}

function groupingRemoveButtonStyle(subtext: string): React.CSSProperties {
  return {
    height: 22,
    border: "none",
    background: "transparent",
    color: subtext,
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 900,
    padding: 0,
  };
}

const addGroupingButtonStyle: React.CSSProperties = {
  minHeight: 28,
  border: "1px dashed rgba(14,165,233,0.38)",
  borderRadius: 6,
  background: "linear-gradient(135deg, rgba(255,255,255,0.90), rgba(224,242,254,0.56))",
  color: "#0369a1",
  font: "inherit",
  fontSize: 11,
  fontWeight: 820,
  cursor: "pointer",
  padding: "0 8px",
};

const groupingFooterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minWidth: 0,
};

function dateAddedSortControlStyle(text: string, line: string, background: string, enabled: boolean): React.CSSProperties {
  return {
    minWidth: 146,
    maxWidth: 162,
    height: 28,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 38px",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${line}`,
    borderRadius: 6,
    background,
    color: enabled ? text : "rgba(100,116,139,0.92)",
    font: "inherit",
    fontSize: 11,
    fontWeight: 820,
    padding: "0 4px 0 6px",
    opacity: enabled ? 1 : 0.78,
  };
}

function dateAddedSortToggleLabelStyle(text: string, disabled: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    height: "100%",
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    color: text,
    cursor: disabled ? "default" : "pointer",
  };
}

function dateAddedSortCheckboxStyle(accent: string): React.CSSProperties {
  return {
    width: 13,
    height: 13,
    margin: 0,
    accentColor: accent,
    cursor: "pointer",
  };
}

function dateAddedSortDirectionButtonStyle(line: string, background: string, enabled: boolean): React.CSSProperties {
  return {
    height: 20,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${line}`,
    borderRadius: 5,
    background,
    color: enabled ? "#0f172a" : "#94a3b8",
    cursor: enabled ? "pointer" : "default",
    font: "inherit",
    fontSize: 10,
    fontWeight: 840,
    lineHeight: 1,
    padding: 0,
  };
}

function addGroupingMenuStyle(background: string, line: string): React.CSSProperties {
  return {
    position: "absolute",
    zIndex: 22,
    top: "calc(100% + 4px)",
    left: 0,
    width: 180,
    display: "grid",
    gap: 2,
    padding: 5,
    border: `1px solid ${line}`,
    borderRadius: 6,
    background,
    boxShadow: "0 12px 30px rgba(15,23,42,0.16)",
  };
}

function groupingFieldMenuStyle(background: string, line: string): React.CSSProperties {
  return {
    position: "absolute",
    zIndex: 24,
    top: "calc(100% + 4px)",
    left: 0,
    width: 190,
    display: "grid",
    gap: 2,
    padding: 5,
    border: `1px solid ${line}`,
    borderRadius: 6,
    background,
    boxShadow: "0 12px 30px rgba(15,23,42,0.16)",
  };
}

function menuOptionStyle(text: string, active: boolean): React.CSSProperties {
  return {
    minHeight: 27,
    border: "none",
    borderRadius: 5,
    background: active ? "rgba(71,85,105,0.12)" : "transparent",
    color: text,
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 800 : 700,
    textAlign: "left",
    cursor: "pointer",
    padding: "0 7px",
  };
}

function rgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(71,85,105,${alpha})`;
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

import type React from "react";
import type { SavedView, SavedViewGrouping } from "../../pages/home/savedViewsApi";
import { KANBAN_GROUP_FIELDS } from "./shared";

type KanbanGroupingControlsProps = {
  controlsRef: React.RefObject<HTMLDivElement>;
  open: boolean;
  savedViews: SavedView[];
  selectedSavedViewID: string;
  viewName: string;
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
  onToggleOpen: () => void;
  onSelectSavedView: (savedViewID: string) => void;
  onSetViewName: (name: string) => void;
  onNewSavedView: () => void;
  onSaveSavedView: () => void;
  onDeleteSavedView: () => void;
  onAddGrouping: () => void;
  onUpdateGrouping: (index: number, grouping: SavedViewGrouping) => void;
  onRemoveGrouping: (index: number) => void;
};

export const KanbanGroupingControls: React.FC<KanbanGroupingControlsProps> = ({
  controlsRef,
  open,
  savedViews,
  selectedSavedViewID,
  viewName,
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
  onToggleOpen,
  onSelectSavedView,
  onSetViewName,
  onNewSavedView,
  onSaveSavedView,
  onDeleteSavedView,
  onAddGrouping,
  onUpdateGrouping,
  onRemoveGrouping,
}) => {
  const usedFields = new Set(groupings.map((grouping) => grouping.field));
  const addDisabled = KANBAN_GROUP_FIELDS.every((field) => usedFields.has(field.value));
  const buttonSurface = isDark ? "rgba(15,23,42,0.86)" : "rgba(255,255,255,0.92)";

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
            width: 360,
            maxWidth: "min(360px, calc(100vw - 32px))",
            border: `1px solid ${line}`,
            borderRadius: 8,
            background: cardBackground,
            color: text,
            boxShadow: "0 18px 42px rgba(15,23,42,0.20)",
            padding: 10,
            zIndex: 35,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 7, alignItems: "center" }}>
            <select
              value={selectedSavedViewID}
              disabled={loading || saving}
              onChange={(event) => onSelectSavedView(event.currentTarget.value)}
              style={selectStyle(text, line, buttonSurface)}
            >
              <option value="">Unsaved view</option>
              {savedViews.map((view) => (
                <option key={view.saved_view_id} value={view.saved_view_id}>{view.name}</option>
              ))}
            </select>
            <button type="button" disabled={saving} style={smallButtonStyle(text, line, buttonSurface)} onClick={onNewSavedView}>New</button>
            <button type="button" disabled={saving || !selectedSavedViewID} style={smallButtonStyle(text, line, buttonSurface)} onClick={onDeleteSavedView}>Delete</button>
          </div>
          <input
            value={viewName}
            disabled={saving}
            onChange={(event) => onSetViewName(event.currentTarget.value)}
            style={{ ...selectStyle(text, line, buttonSurface), width: "100%", marginTop: 8 }}
          />
          <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
            {groupings.map((grouping, index) => (
              <div key={`${grouping.field}:${index}`} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 72px 28px", gap: 7, alignItems: "center" }}>
                <select
                  value={grouping.field}
                  disabled={saving}
                  onChange={(event) => onUpdateGrouping(index, { ...grouping, field: event.currentTarget.value })}
                  style={selectStyle(text, line, buttonSurface)}
                >
                  {KANBAN_GROUP_FIELDS
                    .filter((field) => field.value === grouping.field || !groupings.some((item, itemIndex) => itemIndex !== index && item.field === field.value))
                    .map((field) => (
                      <option key={field.value} value={field.value}>{field.label}</option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => onUpdateGrouping(index, { ...grouping, direction: grouping.direction === "asc" ? "desc" : "asc" })}
                  style={smallButtonStyle(text, line, buttonSurface)}
                >
                  {grouping.direction === "asc" ? "Asc" : "Desc"}
                </button>
                <button
                  type="button"
                  title="Remove grouping"
                  disabled={saving}
                  onClick={() => onRemoveGrouping(index)}
                  style={{ ...smallButtonStyle(text, line, buttonSurface), padding: 0, width: 28 }}
                >
                  x
                </button>
              </div>
            ))}
            {groupings.length === 0 && (
              <div style={{ color: subtext, fontSize: 11, fontWeight: 700, lineHeight: 1.35 }}>No subgrouping</div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 10 }}>
            <button type="button" disabled={saving || addDisabled} style={smallButtonStyle(text, line, buttonSurface)} onClick={onAddGrouping}>Add grouping</button>
            <button type="button" disabled={saving} style={{ ...smallButtonStyle(text, line, buttonSurface), borderColor: accent }} onClick={onSaveSavedView}>
              {saving ? "Saving" : "Save"}
            </button>
          </div>
          {(loading || error) && (
            <div style={{ marginTop: 8, color: error ? "#b91c1c" : subtext, fontSize: 10.5, fontWeight: 760, lineHeight: 1.25 }}>
              {error || "Loading"}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function selectStyle(text: string, line: string, background: string): React.CSSProperties {
  return {
    minWidth: 0,
    height: 30,
    border: `1px solid ${line}`,
    borderRadius: 7,
    background,
    color: text,
    font: "inherit",
    fontSize: 11,
    fontWeight: 760,
    padding: "0 8px",
    outline: "none",
  };
}

function smallButtonStyle(text: string, line: string, background: string): React.CSSProperties {
  return {
    height: 30,
    border: `1px solid ${line}`,
    borderRadius: 7,
    background,
    color: text,
    cursor: "pointer",
    padding: "0 9px",
    font: "inherit",
    fontSize: 11,
    fontWeight: 850,
  };
}

function rgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(71,85,105,${alpha})`;
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
}

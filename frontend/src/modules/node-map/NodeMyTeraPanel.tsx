import { useLayoutEffect, useRef } from "react";
import type React from "react";
import type { MyTeraCardState } from "./mapAppearancePersistence";

export type NodeMyTeraRole = {
  label: string;
  id: string;
  color: string;
};

type NodeMyTeraPanelProps = {
  entityLabel: string;
  relationshipCount: number;
  roles: NodeMyTeraRole[];
  value: MyTeraCardState;
  canEdit: boolean;
  accent: string;
  surface: string;
  textColor: string;
  mutedTextColor: string;
  onChange: (next: MyTeraCardState) => void;
  onContentHeightChange: (height: number) => void;
};

const sectionStyle: React.CSSProperties = {
  borderTop: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
  paddingTop: 9,
};

function textareaRows(value: string): number {
  return Math.max(2, value.split("\n").reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 34)), 0));
}

export const NodeMyTeraPanel: React.FC<NodeMyTeraPanelProps> = ({
  entityLabel,
  relationshipCount,
  roles,
  value,
  canEdit,
  accent,
  surface,
  textColor,
  mutedTextColor,
  onChange,
  onContentHeightChange,
}) => {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const reportHeight = () => onContentHeightChange(Math.ceil(element.scrollHeight));
    reportHeight();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onContentHeightChange, relationshipCount, roles, value]);

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    resize: "none",
    overflow: "hidden",
    borderRadius: 7,
    border: `1px solid color-mix(in srgb, ${accent} 30%, transparent)`,
    background: `color-mix(in srgb, ${surface} 72%, transparent)`,
    color: textColor,
    padding: "8px 9px",
    font: "inherit",
    fontSize: 10.5,
    lineHeight: 1.45,
    outlineColor: accent,
  };

  return (
    <div
      ref={contentRef}
      data-node-mytera-panel="true"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      style={{
        position: "relative",
        zIndex: 3,
        display: "grid",
        gap: 10,
        padding: "17px 24px 15px",
        color: textColor,
        background: `linear-gradient(145deg, color-mix(in srgb, ${surface} 68%, transparent), color-mix(in srgb, ${accent} 9%, transparent))`,
        borderRadius: 7,
        boxSizing: "border-box",
        userSelect: "text",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 850, letterSpacing: "0.11em", textTransform: "uppercase", color: mutedTextColor }}>
            {entityLabel}
          </div>
          <div style={{ marginTop: 2, fontSize: 18, fontWeight: 780, letterSpacing: "-0.02em" }}>MyTera</div>
        </div>
        <div
          aria-label={`${relationshipCount} associations`}
          style={{
            minWidth: 26,
            height: 24,
            padding: "0 8px",
            borderRadius: 999,
            border: `1px solid color-mix(in srgb, ${accent} 58%, transparent)`,
            background: `color-mix(in srgb, ${accent} 12%, transparent)`,
            display: "grid",
            placeItems: "center",
            color: textColor,
            fontSize: 11,
            fontWeight: 800,
          }}
        >
          {relationshipCount}
        </div>
      </div>

      <label style={{ ...sectionStyle, display: "grid", gap: 6, fontSize: 11, fontWeight: 800 }}>
        Rules
        <textarea
          data-mytera-field="rules"
          aria-label="MyTera rules"
          readOnly={!canEdit}
          rows={textareaRows(value.rules)}
          maxLength={8000}
          value={value.rules}
          onChange={(event) => onChange({ ...value, rules: event.target.value })}
          style={fieldStyle}
        />
      </label>

      <label style={{ ...sectionStyle, display: "grid", gap: 6, fontSize: 11, fontWeight: 800 }}>
        Exclusions
        <textarea
          data-mytera-field="exclusions"
          aria-label="MyTera exclusions"
          readOnly={!canEdit}
          rows={textareaRows(value.exclusions)}
          maxLength={8000}
          value={value.exclusions}
          onChange={(event) => onChange({ ...value, exclusions: event.target.value })}
          style={fieldStyle}
        />
      </label>

      <fieldset style={{ ...sectionStyle, margin: 0, paddingInline: 0, paddingBottom: 0, borderRight: 0, borderBottom: 0, borderLeft: 0 }}>
        <legend style={{ padding: 0, fontSize: 11, fontWeight: 800 }}>Related controls</legend>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 8 }}>
          {roles.map((role) => {
            const checked = value.relatedControls.includes(role.id);
            return (
              <label
                key={role.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  minHeight: 26,
                  padding: "3px 8px",
                  borderRadius: 999,
                  border: `1px solid color-mix(in srgb, ${role.color} 64%, transparent)`,
                  background: `color-mix(in srgb, ${role.color} ${checked ? 20 : 8}%, transparent)`,
                  fontSize: 10.5,
                  fontWeight: 750,
                  cursor: canEdit ? "pointer" : "default",
                }}
              >
                <input
                  data-mytera-related-control={role.id}
                  type="checkbox"
                  disabled={!canEdit}
                  checked={checked}
                  onChange={() => onChange({
                    ...value,
                    relatedControls: checked
                      ? value.relatedControls.filter((item) => item !== role.id)
                      : [...value.relatedControls, role.id],
                  })}
                  style={{ accentColor: role.color }}
                />
                {role.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
};

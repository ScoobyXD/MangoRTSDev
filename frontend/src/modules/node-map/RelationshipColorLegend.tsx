export type RelationshipColorLegendItem = {
  label: string;
  color: string;
};

export function RelationshipColorLegend({
  title,
  items,
  panelSurface,
  panelText,
  panelMutedText,
  accent,
  enabled = true,
}: {
  title: string;
  items: RelationshipColorLegendItem[];
  panelSurface: string;
  panelText: string;
  panelMutedText: string;
  accent: string;
  enabled?: boolean;
}) {
  return (
    <div
      aria-label={title}
      style={{
        position: "absolute",
        top: 10,
        left: 10,
        zIndex: 18,
        minWidth: 118,
        display: "grid",
        gap: 5,
        padding: "8px 9px",
        border: `1px solid ${accent}`,
        borderRadius: 8,
        background: panelSurface,
        color: panelText,
        boxShadow: "0 8px 22px rgba(0,0,0,0.14)",
        pointerEvents: "none",
        opacity: enabled ? 1 : 0.64,
      }}
    >
      <div style={{ fontSize: 10, fontWeight: 800, color: panelMutedText, lineHeight: 1 }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: "grid", gridTemplateColumns: "12px minmax(0, 1fr)", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 10,
                background: item.color,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.16)",
              }}
            />
            <span style={{ minWidth: 0, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

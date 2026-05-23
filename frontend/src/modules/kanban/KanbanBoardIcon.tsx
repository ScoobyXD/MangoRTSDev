import type React from "react";

export const KanbanBoardIcon: React.FC = () => (
  <span aria-hidden="true" style={{ width: 14, height: 14, border: "1px solid #050505", background: "#ffffff", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, padding: 2, boxSizing: "border-box", flexShrink: 0 }}>
    <span style={{ background: "#94a3b8" }} />
    <span style={{ background: "#cbd5e1" }} />
    <span style={{ background: "#64748b" }} />
  </span>
);

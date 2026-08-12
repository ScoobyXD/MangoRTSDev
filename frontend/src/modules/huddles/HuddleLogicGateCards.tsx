import React from "react";
import { ExplorerEntityIcon } from "../../icons/index.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "../editor/NodeWorkspaceSurfaceShared.js";

export type HuddleLogicGateCardItem = {
  company_id: string;
  logic_gate_id: string;
  header: string;
  kpis: HuddleLogicGateKPIItem[];
};

export type HuddleLogicGateKPIItem = { kpi_id: string; logic_gate_id: string; name: string };

export const HuddleLogicGateCards: React.FC<{
  items: HuddleLogicGateCardItem[];
  emptyLabel: string;
  onOpenLogicGate: (item: HuddleLogicGateCardItem) => void;
  onOpenKPI: (item: HuddleLogicGateCardItem, kpi: HuddleLogicGateKPIItem) => void;
  onRemove?: (item: HuddleLogicGateCardItem) => void;
}> = ({ items, emptyLabel, onOpenLogicGate, onOpenKPI, onRemove }) => (
  <div data-huddle-logic-gate-cards="true" style={listStyle}>
    {items.length === 0 && <div style={emptyStyle}>{emptyLabel}</div>}
    {items.map((item) => (
      <article key={item.logic_gate_id} data-huddle-logic-gate-card={item.logic_gate_id} style={cardStyle}>
        <div style={logicGateSectionStyle}>
          <button
            type="button"
            aria-label={`Open ${item.header} Logic Gate`}
            title="Open Logic Gate"
            onClick={() => onOpenLogicGate(item)}
            style={logicGateOpenButtonStyle}
          >
            <span style={iconFrameStyle}><ExplorerEntityIcon kind="logic_gate" /></span>
            <strong style={logicGateTitleStyle}>{item.header}</strong>
          </button>
          {onRemove && (
            <button
              type="button"
              aria-label={`Remove ${item.header} from Huddle Logic Gate`}
              title="Remove Logic Gate"
              onClick={() => onRemove(item)}
              style={removeButtonStyle}
            >
              ×
            </button>
          )}
        </div>
        <div aria-label={`${item.header} KPIs`} style={kpiSectionStyle}>
          {item.kpis.length === 0 && <span style={noKPIStyle}>No KPIs</span>}
          {item.kpis.map((kpi) => (
            <button
              key={kpi.kpi_id}
              type="button"
              data-huddle-kpi-card={kpi.kpi_id}
              aria-label={`Open ${kpi.name} KPI`}
              title="Open KPI"
              onClick={() => onOpenKPI(item, kpi)}
              style={kpiCardStyle}
            >
              <span aria-hidden="true" style={kpiDotStyle} />
              <span style={kpiNameStyle}>{kpi.name}</span>
            </button>
          ))}
        </div>
      </article>
    ))}
  </div>
);

const listStyle: React.CSSProperties = { minHeight: 0, display: "grid", alignContent: "start", gap: 10, overflowY: "auto", padding: "4px 3px 10px" };
const emptyStyle: React.CSSProperties = { padding: "16px 10px", color: "#64748b", fontSize: 12, fontWeight: 650 };
const cardStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 14, background: EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW, transition: "transform 160ms ease, box-shadow 160ms ease" };
const logicGateSectionStyle: React.CSSProperties = { minWidth: 0, minHeight: 48, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 8, padding: "8px 9px", background: "linear-gradient(145deg,rgba(239,250,255,.96),rgba(246,240,255,.94))", borderBottom: "1px solid rgba(148,163,184,.18)" };
const logicGateOpenButtonStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "34px minmax(0,1fr)", alignItems: "center", gap: 8, border: 0, background: "transparent", color: "inherit", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" };
const iconFrameStyle: React.CSSProperties = { width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 10, background: EDITOR_NEU_ACTIVE_SURFACE, boxShadow: "inset 2px 2px 5px rgba(148,163,184,.14), inset -2px -2px 5px rgba(255,255,255,.86)" };
const logicGateTitleStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#172033", fontSize: 13, fontWeight: 850 };
const removeButtonStyle: React.CSSProperties = { width: 26, height: 26, display: "grid", placeItems: "center", border: "1px solid rgba(244,63,94,.18)", borderRadius: 8, background: "rgba(255,255,255,.72)", color: "#be123c", cursor: "pointer", fontSize: 17, lineHeight: 1, boxShadow: "2px 2px 6px rgba(148,163,184,.16)" };
const kpiSectionStyle: React.CSSProperties = { display: "grid", gap: 6, padding: 8, background: "rgba(248,250,252,.64)" };
const noKPIStyle: React.CSSProperties = { padding: "5px 7px", color: "#94a3b8", fontSize: 11, fontWeight: 650 };
const kpiCardStyle: React.CSSProperties = { minWidth: 0, width: "100%", display: "grid", gridTemplateColumns: "8px minmax(0,1fr)", alignItems: "center", gap: 7, padding: "7px 9px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 9, background: EDITOR_NEU_ACTIVE_SURFACE, color: "inherit", textAlign: "left", cursor: "pointer", font: "inherit", boxShadow: "2px 3px 7px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.78)" };
const kpiDotStyle: React.CSSProperties = { width: 7, height: 7, borderRadius: 999, background: "linear-gradient(135deg,#22d3ee,#8b5cf6)", boxShadow: "0 0 6px rgba(139,92,246,.28)" };
const kpiNameStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#475569", fontSize: 11, fontWeight: 750 };

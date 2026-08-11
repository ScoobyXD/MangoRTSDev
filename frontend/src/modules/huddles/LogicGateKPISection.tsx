import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { BareMangoEditor } from "./BareMangoEditor";

type KPI = { company_id: string; kpi_id: string; logic_gate_id: string; name: string };
type Props = { companyID: string; logicGateID: string; canEdit: boolean; currentUserID?: string; requestJSON: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T> };

const documentPreview = (document: unknown): string => {
  const text: string[] = [];
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    const node = value as { text?: unknown; content?: unknown };
    if (typeof node.text === "string") text.push(node.text);
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(document);
  return text.join(" ").replace(/\s+/g, " ").trim().slice(0, 90);
};

export const LogicGateKPISection: React.FC<Props> = ({ companyID, logicGateID, canEdit, currentUserID, requestJSON }) => {
  const [items, setItems] = useState<KPI[]>([]);
  const [open, setOpen] = useState<KPI | null>(null);
  const [inlineName, setInlineName] = useState<{ kpiID: string; value: string } | null>(null);
  const inlineNameInputRef = useRef<HTMLInputElement | null>(null);
  const [context, setContext] = useState<{ item: KPI; x: number; y: number } | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const loadPreview = useCallback(async (item: KPI) => {
    try {
      const snapshot = await requestJSON<{ document?: unknown }>(`/v1/editor-json/kpi/${encodeURIComponent(item.kpi_id)}/documents/${encodeURIComponent(item.kpi_id)}?company_id=${encodeURIComponent(companyID)}`);
      setPreviews((current) => ({ ...current, [item.kpi_id]: documentPreview(snapshot.document) }));
    } catch {
      setPreviews((current) => ({ ...current, [item.kpi_id]: "" }));
    }
  }, [companyID, requestJSON]);
  const load = useCallback(async () => {
    if (!companyID || !logicGateID) return;
    const data = await requestJSON<{ kpis?: KPI[] }>(`/v1/kpis?company_id=${encodeURIComponent(companyID)}&logic_gate_id=${encodeURIComponent(logicGateID)}`);
    const next = data.kpis ?? [];
    setItems(next);
    await Promise.all(next.map(loadPreview));
  }, [companyID, loadPreview, logicGateID, requestJSON]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!inlineName?.kpiID) return;
    inlineNameInputRef.current?.focus();
    inlineNameInputRef.current?.select();
  }, [inlineName?.kpiID]);
  const create = async () => {
    const item = await requestJSON<KPI>("/v1/kpis", { method: "POST", json: { company_id: companyID, logic_gate_id: logicGateID, name: "New KPI" } });
    setItems((current) => [...current, item]);
    setInlineName({ kpiID: item.kpi_id, value: item.name });
  };
  const saveInlineName = async (item: KPI, value: string) => {
    const name = value.trim();
    setInlineName(null);
    if (!name || name === item.name) return;
    const saved = await requestJSON<KPI>(`/v1/kpis/${encodeURIComponent(item.kpi_id)}`, { method: "PUT", json: { company_id: companyID, name } });
    setItems((current) => current.map((value) => value.kpi_id === saved.kpi_id ? saved : value));
    setOpen((current) => current?.kpi_id === saved.kpi_id ? saved : current);
  };
  const remove = async (item: KPI) => { if (!window.confirm(`Delete ${item.name}?`)) return; await requestJSON(`/v1/kpis/${encodeURIComponent(item.kpi_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" }); setItems((current) => current.filter((value) => value.kpi_id !== item.kpi_id)); };
  const closePopup = () => { if (open) void loadPreview(open); setOpen(null); };
  return (
    <div style={{ pointerEvents: "auto", display: "grid", gap: 7, padding: "8px 10px", border: "1px solid rgba(15,23,42,.12)", borderRadius: 12, background: "rgba(255,255,255,.92)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, fontWeight: 800 }}><span>KPIs</span>{canEdit && <button type="button" aria-label="Create KPI" onClick={() => void create()} style={buttonStyle}>＋</button>}</div>
      <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>{items.map((item) => <div key={item.kpi_id} onContextMenu={(event) => { event.preventDefault(); if (canEdit) setContext({ item, x: event.clientX, y: event.clientY }); }} style={cardStyle}>{inlineName?.kpiID === item.kpi_id ? <input ref={inlineNameInputRef} aria-label="KPI name" value={inlineName.value} onChange={(event) => setInlineName({ kpiID: item.kpi_id, value: event.target.value })} onBlur={() => void saveInlineName(item, inlineName.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") setInlineName(null); }} style={inlineTitleStyle}/> : <button type="button" data-mango-kpi-card={item.kpi_id} aria-label={`${item.name} KPI`} onDoubleClick={() => setOpen(item)} style={cardButtonStyle}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong></button>}<span style={previewStyle}>{previews[item.kpi_id] || "No details yet"}</span></div>)}{items.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No KPIs</span>}</div>
      {context && <AppModalPortal><div role="menu" style={{ position: "fixed", left: context.x, top: context.y, zIndex: 12100, padding: 4, border: "1px solid rgba(15,23,42,.14)", borderRadius: 8, background: "#fff", boxShadow: "0 12px 30px rgba(15,23,42,.2)" }}><button type="button" role="menuitem" onClick={() => { const item = context.item; setContext(null); void remove(item); }} style={{ ...buttonStyle, color: "#b91c1c" }}>Delete KPI</button></div></AppModalPortal>}
      {open && <AppModalPortal><div role="presentation" onMouseDown={closePopup} style={backdropStyle}><section role="dialog" aria-modal="true" aria-label="KPI" onMouseDown={(event) => event.stopPropagation()} style={dialogStyle}><header style={headerStyle}><input value={open.name} disabled={!canEdit} onChange={(event) => setOpen({ ...open, name: event.target.value })} onBlur={() => { if (canEdit && open.name.trim()) void requestJSON<KPI>(`/v1/kpis/${encodeURIComponent(open.kpi_id)}`, { method: "PUT", json: { company_id: companyID, name: open.name.trim() } }).then((saved) => { setOpen(saved); setItems((current) => current.map((value) => value.kpi_id === saved.kpi_id ? saved : value)); }); }} style={titleStyle}/><button type="button" onClick={closePopup} style={buttonStyle}>Close</button></header><BareMangoEditor companyID={companyID} resourceType="kpi" resourceID={open.kpi_id} currentUserID={currentUserID} requestJSON={requestJSON} ariaLabel={`${open.name} KPI editor`}/></section></div></AppModalPortal>}
    </div>
  );
};

const buttonStyle: React.CSSProperties = { border: "1px solid rgba(15,23,42,.14)", borderRadius: 8, background: "#fff", padding: "4px 9px", fontWeight: 800, cursor: "pointer" };
const cardStyle: React.CSSProperties = { minWidth: 150, maxWidth: 220, textAlign: "left", border: "1px solid rgba(15,23,42,.14)", borderRadius: 10, background: "#f8fafc", padding: "9px 11px", cursor: "pointer", overflow: "hidden" };
const cardButtonStyle: React.CSSProperties = { display: "block", width: "100%", border: 0, padding: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" };
const inlineTitleStyle: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", border: "1px solid #38bdf8", borderRadius: 4, padding: "1px 3px", fontWeight: 800, outline: 0 };
const previewStyle: React.CSSProperties = { display: "block", marginTop: 4, color: "#64748b", fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const backdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 12000, display: "grid", placeItems: "center", background: "rgba(15,23,42,.38)", padding: 28 };
const dialogStyle: React.CSSProperties = { width: "min(900px, 92vw)", height: "min(700px, 86vh)", display: "grid", gridTemplateRows: "54px minmax(0,1fr)", overflow: "hidden", borderRadius: 16, background: "#fff", boxShadow: "0 28px 80px rgba(15,23,42,.28)" };
const headerStyle: React.CSSProperties = { display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", borderBottom: "1px solid rgba(15,23,42,.12)" };
const titleStyle: React.CSSProperties = { flex: 1, border: 0, outline: 0, fontSize: 18, fontWeight: 850, background: "transparent" };

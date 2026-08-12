import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { mangoTiptapPendingStorageKey } from "../editor/tiptap/mangoTiptapSync";
import {
  BareMangoEditorDocument,
  BareMangoEditorToolbar,
  useBareMangoEditorControls,
} from "./BareMangoEditor";

export type KPIEditorItem = { kpi_id: string; logic_gate_id: string; name: string };
type KPI = KPIEditorItem & { company_id: string };
type Props = { companyID: string; logicGateID: string; canEdit: boolean; currentUserID?: string; requestJSON: <T>(path: string, init?: RequestInit & { json?: unknown }) => Promise<T> };

export const KPIEditorPopup: React.FC<{
  companyID: string;
  item: KPIEditorItem;
  canEdit: boolean;
  currentUserID?: string;
  requestJSON: Props["requestJSON"];
  onSaved?: (item: KPIEditorItem) => void;
  onClose: () => void;
}> = ({ companyID, item, canEdit, currentUserID, requestJSON, onSaved, onClose }) => {
  const controls = useBareMangoEditorControls();
  const [name, setName] = useState(item.name);
  const [savedName, setSavedName] = useState(item.name);
  const saveStateStorageKey = mangoTiptapPendingStorageKey({
    companyID,
    resourceType: "kpi",
    resourceID: item.kpi_id,
    documentID: item.kpi_id,
  });
  useEffect(() => {
    setName(item.name);
    setSavedName(item.name);
  }, [item.kpi_id, item.name]);
  const saveName = async () => {
    const clean = name.trim();
    if (!canEdit || !clean || clean === savedName) {
      if (!clean) setName(savedName);
      return;
    }
    try {
      const saved = await requestJSON<KPIEditorItem>(`/v1/kpis/${encodeURIComponent(item.kpi_id)}`, {
        method: "PUT",
        json: { company_id: companyID, name: clean },
      });
      setName(saved.name);
      setSavedName(saved.name);
      onSaved?.(saved);
    } catch {
      setName(savedName);
    }
  };
  return (
    <AppModalPortal trapFocus onRequestClose={onClose}>
      <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }} style={backdropStyle}>
        <section
          role="dialog"
          aria-modal="true"
          aria-label="KPI"
          data-kpi-editor-popup="centered-large"
          onMouseDown={(event) => event.stopPropagation()}
          style={dialogStyle}
        >
          <header style={headerStyle}>
            <div style={titleRowStyle}>
              <input
                aria-label="KPI title"
                value={name}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void saveName()}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
                style={titleStyle}
              />
              <button type="button" aria-label="Close KPI" title="Close" onClick={onClose} style={closeButtonStyle}>X</button>
            </div>
            <div style={toolbarFrameStyle}>
              <BareMangoEditorToolbar
                controls={controls}
                formattingDisabled={!canEdit}
                reserveHeaderOffset={false}
                saveStateStorageKey={saveStateStorageKey}
              />
            </div>
          </header>
          <BareMangoEditorDocument
            companyID={companyID}
            resourceType="kpi"
            resourceID={item.kpi_id}
            currentUserID={currentUserID}
            requestJSON={requestJSON}
            ariaLabel={`${name} KPI editor`}
            editable={canEdit}
            controls={controls}
            style={{ padding: "24px 30px", background: "rgba(255,255,255,.78)" }}
          />
        </section>
      </div>
    </AppModalPortal>
  );
};

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
      <div style={{ display: "flex", gap: 8, overflowX: "auto" }}>{items.map((item) => <div key={item.kpi_id} onContextMenu={(event) => { event.preventDefault(); if (canEdit) setContext({ item, x: event.clientX, y: event.clientY }); }} style={cardStyle}>{inlineName?.kpiID === item.kpi_id ? <input ref={inlineNameInputRef} aria-label="KPI name" value={inlineName.value} onChange={(event) => setInlineName({ kpiID: item.kpi_id, value: event.target.value })} onBlur={() => void saveInlineName(item, inlineName.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") setInlineName(null); }} style={inlineTitleStyle}/> : <button type="button" data-mango-kpi-card={item.kpi_id} aria-label={`${item.name} KPI`} onClick={() => setOpen(item)} style={cardButtonStyle}><strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</strong></button>}<span style={previewStyle}>{previews[item.kpi_id] || "No details yet"}</span></div>)}{items.length === 0 && <span style={{ fontSize: 12, color: "#64748b" }}>No KPIs</span>}</div>
      {context && <AppModalPortal><div role="menu" style={{ position: "fixed", left: context.x, top: context.y, zIndex: 12100, padding: 4, border: "1px solid rgba(15,23,42,.14)", borderRadius: 8, background: "#fff", boxShadow: "0 12px 30px rgba(15,23,42,.2)" }}><button type="button" role="menuitem" onClick={() => { const item = context.item; setContext(null); void remove(item); }} style={{ ...buttonStyle, color: "#b91c1c" }}>Delete KPI</button></div></AppModalPortal>}
      {open && (
        <KPIEditorPopup
          companyID={companyID}
          item={open}
          canEdit={canEdit}
          currentUserID={currentUserID}
          requestJSON={requestJSON}
          onSaved={(saved) => {
            const next: KPI = { ...open, ...saved };
            setOpen(next);
            setItems((current) => current.map((value) => value.kpi_id === next.kpi_id ? next : value));
          }}
          onClose={closePopup}
        />
      )}
    </div>
  );
};

const buttonStyle: React.CSSProperties = { border: "1px solid rgba(15,23,42,.14)", borderRadius: 8, background: "#fff", padding: "4px 9px", fontWeight: 800, cursor: "pointer" };
const cardStyle: React.CSSProperties = { minWidth: 150, maxWidth: 220, textAlign: "left", border: "1px solid rgba(15,23,42,.14)", borderRadius: 10, background: "#f8fafc", padding: "9px 11px", cursor: "pointer", overflow: "hidden" };
const cardButtonStyle: React.CSSProperties = { display: "block", width: "100%", border: 0, padding: 0, background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer" };
const inlineTitleStyle: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", border: "1px solid #38bdf8", borderRadius: 4, padding: "1px 3px", fontWeight: 800, outline: 0 };
const previewStyle: React.CSSProperties = { display: "block", marginTop: 4, color: "#64748b", fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const backdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 12000, display: "grid", placeItems: "center", background: "rgba(15,23,42,.38)", padding: 24 };
const dialogStyle: React.CSSProperties = { width: "min(1120px, 95vw)", height: "min(820px, 91vh)", minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "96px minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(255,255,255,.84)", borderRadius: 18, background: "linear-gradient(145deg,#f8fafc,#eef2f7)", boxShadow: "0 28px 80px rgba(15,23,42,.32)" };
const headerStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateRows: "48px 48px", borderBottom: "1px solid rgba(15,23,42,.12)", background: "linear-gradient(180deg,rgba(255,255,255,.96),rgba(248,250,252,.88))" };
const titleRowStyle: React.CSSProperties = { minWidth: 0, display: "flex", gap: 12, alignItems: "center", padding: "7px 10px 3px 14px" };
const toolbarFrameStyle: React.CSSProperties = { minWidth: 0, overflowX: "auto", overflowY: "visible", padding: "2px 10px 5px" };
const titleStyle: React.CSSProperties = { flex: 1, border: 0, outline: 0, fontSize: 18, fontWeight: 850, background: "transparent" };
const closeButtonStyle: React.CSSProperties = { width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 8, background: "linear-gradient(135deg,#ff5a6b,#ef334e)", color: "#fff", padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 900, boxShadow: "0 8px 18px rgba(239,51,78,.26), inset 1px 1px 0 rgba(255,255,255,.38)" };

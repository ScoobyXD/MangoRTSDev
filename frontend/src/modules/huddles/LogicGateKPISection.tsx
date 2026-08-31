import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { mangoTiptapPendingStorageKey } from "../editor/tiptap/mangoTiptapSync";
import {
  BareMangoEditorDocument,
  BareMangoEditorToolbar,
  useBareMangoEditorControls,
} from "./BareMangoEditor";
import { UniversalEntityPicker, type UniversalEntityPickerAnchor } from "../editor/UniversalEntityPicker";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "../editor/NodeWorkspaceSurfaceShared";
import { HuddleResourceIcon } from "./HuddleResourceIcon";
import { KPIIcon } from "./KPIIcon";

export type KPIEditorItem = { kpi_id: string; logic_gate_id: string; name: string };
type KPI = KPIEditorItem & { company_id: string };
type HuddleLogicGate = { company_id: string; huddle_logic_gate_id: string; header: string };
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
  const [huddleLogicGates, setHuddleLogicGates] = useState<HuddleLogicGate[]>([]);
  const [huddlePickerAnchor, setHuddlePickerAnchor] = useState<UniversalEntityPickerAnchor | null>(null);
  const [huddleError, setHuddleError] = useState("");
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
  const loadHuddleLogicGates = useCallback(async () => {
    if (!companyID || !logicGateID) return;
    const data = await requestJSON<{ huddle_logic_gates?: HuddleLogicGate[] }>(`/v1/logic-gates/${encodeURIComponent(logicGateID)}/huddle-logic-gates?company_id=${encodeURIComponent(companyID)}`);
    setHuddleLogicGates(data.huddle_logic_gates ?? []);
  }, [companyID, logicGateID, requestJSON]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadHuddleLogicGates(); }, [loadHuddleLogicGates]);
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
  const openHuddlePicker = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setHuddleError("");
    setHuddlePickerAnchor({ left: rect.left, top: rect.bottom + 6 });
  };
  const addHuddleLogicGate = async (huddleLogicGateID: string) => {
    await requestJSON(`/v1/logic-gates/${encodeURIComponent(logicGateID)}/huddle-logic-gates/${encodeURIComponent(huddleLogicGateID)}`, {
      method: "PUT",
      json: { company_id: companyID },
    });
    setHuddlePickerAnchor(null);
    await loadHuddleLogicGates();
  };
  const removeHuddleLogicGate = async (item: HuddleLogicGate) => {
    setHuddleError("");
    try {
      await requestJSON(`/v1/logic-gates/${encodeURIComponent(logicGateID)}/huddle-logic-gates/${encodeURIComponent(item.huddle_logic_gate_id)}?company_id=${encodeURIComponent(companyID)}`, { method: "DELETE" });
      setHuddleLogicGates((current) => current.filter((candidate) => candidate.huddle_logic_gate_id !== item.huddle_logic_gate_id));
    } catch (cause) {
      setHuddleError(cause instanceof Error ? cause.message : "Could not remove Huddle Board");
    }
  };
  const openHuddleLogicGate = (item: HuddleLogicGate) => {
    window.dispatchEvent(new CustomEvent("mangorts:huddle-open", { detail: { resourceType: "huddle_logic_gate", resourceID: item.huddle_logic_gate_id, name: item.header } }));
  };
  const closePopup = () => { if (open) void loadPreview(open); setOpen(null); };
  return (
    <div data-logic-gate-relationship-tray="split" style={relationshipTrayStyle}>
      <section aria-label="Associated Huddle Boards" style={traySectionStyle}>
        <div style={sectionHeaderStyle}><span>Huddle Boards</span>{canEdit && <button type="button" aria-label="Add Huddle Board" onClick={openHuddlePicker} style={buttonStyle}>＋</button>}</div>
        <div style={cardRailStyle}>
          {huddleLogicGates.map((item) => (
            <article key={item.huddle_logic_gate_id} data-logic-gate-huddle-card={item.huddle_logic_gate_id} style={huddleCardStyle}>
              <button type="button" aria-label={`Open ${item.header} Huddle Board`} onClick={() => openHuddleLogicGate(item)} style={huddleCardButtonStyle}>
                <HuddleResourceIcon type="huddle_logic_gate" />
                <strong style={cardTitleStyle}>{item.header}</strong>
              </button>
              {canEdit && <button type="button" aria-label={`Remove ${item.header} Huddle Board`} onClick={() => void removeHuddleLogicGate(item)} style={removeButtonStyle}>×</button>}
            </article>
          ))}
          {huddleLogicGates.length === 0 && <span style={emptyLabelStyle}>No Huddle Boards</span>}
        </div>
        {huddleError && <span role="alert" style={errorStyle}>{huddleError}</span>}
      </section>
      <section aria-label="Process KPIs" style={{ ...traySectionStyle, borderLeft: `1px solid ${EDITOR_NEU_SOFT_BORDER}` }}>
        <div style={sectionHeaderStyle}><span>KPIs</span>{canEdit && <button type="button" aria-label="Create KPI" onClick={() => void create()} style={buttonStyle}>＋</button>}</div>
        <div style={cardRailStyle}>{items.map((item) => inlineName?.kpiID === item.kpi_id ? (
          <div key={item.kpi_id} style={inlineCardStyle} onContextMenu={(event) => { event.preventDefault(); if (canEdit) setContext({ item, x: event.clientX, y: event.clientY }); }}>
            <div style={kpiCardHeaderStyle}><KPIIcon /><input ref={inlineNameInputRef} aria-label="KPI name" value={inlineName.value} onChange={(event) => setInlineName({ kpiID: item.kpi_id, value: event.target.value })} onBlur={() => void saveInlineName(item, inlineName.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === "Escape") setInlineName(null); }} style={inlineTitleStyle}/></div>
            <span style={previewStyle}>{previews[item.kpi_id] || "No details yet"}</span>
          </div>
        ) : (
          <button key={item.kpi_id} type="button" data-mango-kpi-card={item.kpi_id} aria-label={`${item.name} KPI`} onClick={() => setOpen(item)} onContextMenu={(event) => { event.preventDefault(); if (canEdit) setContext({ item, x: event.clientX, y: event.clientY }); }} style={cardStyle}>
            <span style={kpiCardHeaderStyle}><KPIIcon /><strong style={cardTitleStyle}>{item.name}</strong></span>
            <span data-kpi-card-preview="true" style={previewStyle}>{previews[item.kpi_id] || "No details yet"}</span>
          </button>
        ))}{items.length === 0 && <span style={emptyLabelStyle}>No KPIs</span>}</div>
      </section>
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
      {huddlePickerAnchor && (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={requestJSON}
          sourceType="logic_gate"
          sourceLabel="Process"
          linkTargetTypes={["huddle_logic_gate"]}
          initialMode="link"
          initialCategory="huddle_logic_gate"
          lockMode
          anchor={huddlePickerAnchor}
          onChoose={async (entity, mode) => {
            if (mode !== "link" || entity.entityType !== "huddle_logic_gate") return;
            await addHuddleLogicGate(entity.entityID);
          }}
          onCancel={() => setHuddlePickerAnchor(null)}
        />
      )}
    </div>
  );
};

const relationshipTrayStyle: React.CSSProperties = { pointerEvents: "auto", minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", overflow: "visible", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 13, background: EDITOR_NEU_SURFACE, boxShadow: EDITOR_NEU_SHADOW };
const traySectionStyle: React.CSSProperties = { minWidth: 0, display: "grid", alignContent: "start", gap: 7, padding: "8px 10px" };
const sectionHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, fontWeight: 850 };
const cardRailStyle: React.CSSProperties = { minWidth: 0, display: "flex", alignItems: "stretch", gap: 8, overflowX: "auto", padding: "1px 1px 4px" };
const buttonStyle: React.CSSProperties = { width: 27, height: 27, display: "grid", placeItems: "center", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 8, background: EDITOR_NEU_ACTIVE_SURFACE, boxShadow: "2px 2px 6px rgba(148,163,184,.18), -2px -2px 5px rgba(255,255,255,.82)", padding: 0, fontWeight: 850, cursor: "pointer" };
const cardStyle: React.CSSProperties = { minWidth: 164, maxWidth: 220, display: "grid", alignContent: "start", gap: 5, textAlign: "left", border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 11, background: EDITOR_NEU_ACTIVE_SURFACE, boxShadow: "2px 3px 7px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.78)", color: "inherit", padding: "8px 10px", cursor: "pointer", overflow: "hidden", font: "inherit" };
const inlineCardStyle: React.CSSProperties = { ...cardStyle, cursor: "default" };
const huddleCardStyle: React.CSSProperties = { position: "relative", minWidth: 176, maxWidth: 230, display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 5, border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`, borderRadius: 11, background: "linear-gradient(145deg,rgba(239,250,255,.96),rgba(246,240,255,.94))", boxShadow: "2px 3px 7px rgba(148,163,184,.14), -2px -2px 6px rgba(255,255,255,.78)", padding: "8px 8px 8px 10px", overflow: "hidden" };
const huddleCardButtonStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "30px minmax(0,1fr)", alignItems: "center", gap: 7, border: 0, background: "transparent", color: "inherit", padding: 0, textAlign: "left", cursor: "pointer", font: "inherit" };
const removeButtonStyle: React.CSSProperties = { width: 24, height: 24, display: "grid", placeItems: "center", border: "1px solid rgba(244,63,94,.18)", borderRadius: 7, background: "rgba(255,255,255,.72)", color: "#be123c", padding: 0, cursor: "pointer", fontSize: 16, lineHeight: 1 };
const kpiCardHeaderStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", alignItems: "center", gap: 7 };
const cardTitleStyle: React.CSSProperties = { minWidth: 0, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#172033", fontSize: 12, fontWeight: 850 };
const emptyLabelStyle: React.CSSProperties = { alignSelf: "center", padding: "7px 2px", color: "#64748b", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" };
const errorStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 11, fontWeight: 750 };
const inlineTitleStyle: React.CSSProperties = { display: "block", width: "100%", boxSizing: "border-box", border: "1px solid #38bdf8", borderRadius: 4, padding: "1px 3px", fontWeight: 800, outline: 0 };
const previewStyle: React.CSSProperties = { minWidth: 0, display: "block", color: "#64748b", fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const backdropStyle: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 12000, display: "grid", placeItems: "center", background: "rgba(15,23,42,.38)", padding: 24 };
const dialogStyle: React.CSSProperties = { width: "min(1120px, 95vw)", height: "min(820px, 91vh)", minWidth: 0, minHeight: 0, display: "grid", gridTemplateRows: "96px minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(255,255,255,.84)", borderRadius: 18, background: "linear-gradient(145deg,#f8fafc,#eef2f7)", boxShadow: "0 28px 80px rgba(15,23,42,.32)" };
const headerStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateRows: "48px 48px", borderBottom: "1px solid rgba(15,23,42,.12)", background: "linear-gradient(180deg,rgba(255,255,255,.96),rgba(248,250,252,.88))" };
const titleRowStyle: React.CSSProperties = { minWidth: 0, display: "flex", gap: 12, alignItems: "center", padding: "7px 10px 3px 14px" };
const toolbarFrameStyle: React.CSSProperties = { minWidth: 0, overflowX: "auto", overflowY: "visible", padding: "2px 10px 5px" };
const titleStyle: React.CSSProperties = { flex: 1, border: 0, outline: 0, fontSize: 18, fontWeight: 850, background: "transparent" };
const closeButtonStyle: React.CSSProperties = { width: 28, height: 28, display: "grid", placeItems: "center", border: "1px solid transparent", borderRadius: 8, background: "linear-gradient(135deg,#ff5a6b,#ef334e)", color: "#fff", padding: 0, cursor: "pointer", fontSize: 15, fontWeight: 900, boxShadow: "0 8px 18px rgba(239,51,78,.26), inset 1px 1px 0 rgba(255,255,255,.38)" };

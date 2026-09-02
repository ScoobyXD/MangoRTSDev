import React, { useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import type { ActionItemColor } from "../entities/entitiesApi.js";
import { ActionItemIcon } from "../../icons/index.js";

export type ActionItemDueDates = { analysisDueDate?: string; completionDueDate?: string };

export const ActionItemSelectionDialog: React.FC<{
  text: string;
  color: ActionItemColor;
  onSave: (dueDates: ActionItemDueDates) => Promise<void>;
  onCancel: () => void;
}> = ({ text, color, onSave, onCancel }) => {
  const [analysisDueDate, setAnalysisDueDate] = useState("");
  const [completionDueDate, setCompletionDueDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return <AppModalPortal>
    <div role="presentation" style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: "rgba(15,23,42,.32)" }}>
      <form role="dialog" aria-modal="true" aria-label="Create Action Item" onKeyDown={(event) => { if (event.key === "Escape" && !saving) { event.stopPropagation(); onCancel(); } }} onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        if (!analysisDueDate && !completionDueDate) {
          setError("Enter an analysis due date or completion due date.");
          return;
        }
        setSaving(true);
        setError("");
        try { await onSave({ analysisDueDate: analysisDueDate || undefined, completionDueDate: completionDueDate || undefined }); }
        catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create the Action Item."); }
        finally { setSaving(false); }
      }} style={{ display: "grid", gap: 14, width: "min(440px, calc(100vw - 32px))", padding: 20, borderRadius: 12, background: "white", color: "#0f172a", boxShadow: "0 16px 48px rgba(15,23,42,.24)" }}>
        <strong style={{ display: "flex", alignItems: "center", gap: 8 }}><ActionItemIcon outerRingColor={color === "yellow" ? "#ca8a04" : "#dc2626"} />Create {color} Action Item</strong>
        <div style={{ maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 13 }}>{text}</div>
        <span style={{ fontSize: 12 }}>Enter at least one due date.</span>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Analysis due date<input autoFocus type="date" aria-label="Analysis due date" value={analysisDueDate} onChange={(event) => setAnalysisDueDate(event.target.value)} disabled={saving} /></label>
        <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Completion due date<input type="date" aria-label="Completion due date" value={completionDueDate} onChange={(event) => setCompletionDueDate(event.target.value)} disabled={saving} /></label>
        {error && <div role="alert" style={{ color: "#b91c1c", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}><button type="button" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save Action Item"}</button></div>
      </form>
    </div>
  </AppModalPortal>;
};

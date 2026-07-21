import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import {
  createEntityField,
  deleteEntityField,
  ENTITY_FIELD_COLORS,
  listEntityFields,
  sortEntityFields,
  updateEntityField,
  type EntityField,
} from "./entityFieldsApi.js";

export function FieldsContent({ accent = "#6366f1" }: { accent?: string }) {
  const companyID = getActiveCompanyID();
  const [fields, setFields] = useState<EntityField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [colorDraft, setColorDraft] = useState<string>(ENTITY_FIELD_COLORS[0]);
  const [busyID, setBusyID] = useState("");
  const [editingID, setEditingID] = useState("");
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(ENTITY_FIELD_COLORS[0]);
  const [deleteConfirmID, setDeleteConfirmID] = useState("");

  const loadFields = useCallback(async () => {
    if (!companyID) {
      setFields([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setFields(await listEntityFields(companyID));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load fields");
    } finally {
      setLoading(false);
    }
  }, [companyID]);

  useEffect(() => { void loadFields(); }, [loadFields]);

  const fieldNameSet = useMemo(() => new Set(fields.map((field) => field.name.trim().toLocaleLowerCase())), [fields]);
  const cleanNameDraft = nameDraft.trim();
  const canCreate = Boolean(companyID && cleanNameDraft && cleanNameDraft.length <= 64 && !fieldNameSet.has(cleanNameDraft.toLocaleLowerCase()) && !busyID);

  const createField = async () => {
    if (!canCreate) return;
    setBusyID("create");
    setError("");
    try {
      const created = await createEntityField({ companyID, name: cleanNameDraft, color: colorDraft });
      setFields((current) => sortEntityFields([...current, created]));
      setNameDraft("");
      setColorDraft(ENTITY_FIELD_COLORS[(fields.length + 1) % ENTITY_FIELD_COLORS.length]);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create field");
    } finally {
      setBusyID("");
    }
  };

  const startEditing = (field: EntityField) => {
    setEditingID(field.field_id);
    setEditName(field.name);
    setEditColor(field.color);
    setDeleteConfirmID("");
  };

  const saveField = async (field: EntityField) => {
    const name = editName.trim();
    if (!name || name.length > 64) return;
    setBusyID(field.field_id);
    setError("");
    try {
      const saved = await updateEntityField({ companyID, fieldID: field.field_id, name, color: editColor, position: field.position });
      setFields((current) => sortEntityFields(current.map((item) => item.field_id === saved.field_id ? saved : item)));
      setEditingID("");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update field");
    } finally {
      setBusyID("");
    }
  };

  const removeField = async (field: EntityField) => {
    if (deleteConfirmID !== field.field_id) {
      setDeleteConfirmID(field.field_id);
      setEditingID("");
      return;
    }
    setBusyID(field.field_id);
    setError("");
    try {
      await deleteEntityField(companyID, field.field_id);
      setFields((current) => current.filter((item) => item.field_id !== field.field_id));
      setDeleteConfirmID("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete field");
    } finally {
      setBusyID("");
    }
  };

  return (
    <main style={pageStyle}>
      <section style={headerSurfaceStyle}>
        <div>
          <div style={eyebrowStyle}>Entities</div>
          <h1 style={titleStyle}>Fields</h1>
          <p style={subtitleStyle}>Create reusable labels for Projects, Nodes, and Logic Gates. Project columns and grouping use the same field library.</p>
        </div>
        <div style={fieldCountStyle(accent)}>{fields.length} {fields.length === 1 ? "field" : "fields"}</div>
      </section>

      <section aria-labelledby="create-field-title" style={createSurfaceStyle(accent)}>
        <div style={createCopyStyle}>
          <h2 id="create-field-title" style={sectionTitleStyle}>Create a field</h2>
          <span style={helperStyle}>Use a short label such as FX, AX, Region, or Launch.</span>
        </div>
        <div style={createControlsStyle}>
          <label style={inputLabelStyle}>
            Field name
            <input
              value={nameDraft}
              maxLength={64}
              placeholder="e.g. FX"
              style={inputStyle(accent)}
              onChange={(event) => setNameDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createField();
                }
              }}
            />
          </label>
          <fieldset style={paletteFieldsetStyle}>
            <legend style={paletteLegendStyle}>Color</legend>
            <div style={paletteStyle}>
              {ENTITY_FIELD_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  aria-pressed={colorDraft === color}
                  style={colorButtonStyle(color, colorDraft === color)}
                  onClick={() => setColorDraft(color)}
                />
              ))}
            </div>
          </fieldset>
          <button type="button" disabled={!canCreate} style={createButtonStyle(accent, !canCreate)} onClick={() => void createField()}>
            {busyID === "create" ? "Creating…" : "+ Add field"}
          </button>
        </div>
        {cleanNameDraft && fieldNameSet.has(cleanNameDraft.toLocaleLowerCase()) ? <div style={inlineHintStyle}>A field with this name already exists.</div> : null}
      </section>

      {error ? <div role="alert" style={errorStyle}>{error}</div> : null}

      <section aria-label="Field library" style={librarySurfaceStyle}>
        <div style={libraryHeaderStyle}>
          <div>
            <h2 style={sectionTitleStyle}>Field library</h2>
            <div style={helperStyle}>Fields become selectable project columns and grouping choices.</div>
          </div>
          <button type="button" disabled={loading} style={refreshButtonStyle} onClick={() => void loadFields()}>Refresh</button>
        </div>
        {loading ? <div style={emptyStyle}>Loading fields…</div> : fields.length === 0 ? (
          <div style={emptyStyle}>No fields yet. Create your first label above.</div>
        ) : (
          <div style={fieldGridStyle}>
            {fields.map((field) => {
              const editing = editingID === field.field_id;
              const confirmingDelete = deleteConfirmID === field.field_id;
              const busy = busyID === field.field_id;
              return (
                <article key={field.field_id} style={fieldCardStyle(field.color)}>
                  <div style={fieldCardTopStyle}>
                    <span aria-hidden="true" style={fieldDotStyle(field.color)} />
                    {editing ? (
                      <input autoFocus value={editName} maxLength={64} aria-label={`Rename ${field.name}`} style={editInputStyle} onChange={(event) => setEditName(event.currentTarget.value)} />
                    ) : (
                      <span style={fieldNameStyle}>{field.name}</span>
                    )}
                    <span style={usagePillStyle}>{field.assignment_count ?? 0} assigned</span>
                  </div>
                  {editing ? (
                    <div style={editPanelStyle}>
                      <div style={paletteStyle}>
                        {ENTITY_FIELD_COLORS.map((color) => (
                          <button key={color} type="button" aria-label={`Use ${color}`} aria-pressed={editColor === color} style={colorButtonStyle(color, editColor === color)} onClick={() => setEditColor(color)} />
                        ))}
                      </div>
                      <div style={cardActionsStyle}>
                        <button type="button" style={quietButtonStyle} disabled={busy} onClick={() => setEditingID("")}>Cancel</button>
                        <button type="button" style={saveButtonStyle(accent)} disabled={busy || !editName.trim()} onClick={() => void saveField(field)}>{busy ? "Saving…" : "Save"}</button>
                      </div>
                    </div>
                  ) : (
                    <div style={fieldCardBottomStyle}>
                      <span style={fieldPreviewStyle(field.color)}>{field.name}</span>
                      <div style={cardActionsStyle}>
                        <button type="button" style={quietButtonStyle} disabled={busy} onClick={() => startEditing(field)}>Edit</button>
                        <button type="button" style={deleteButtonStyle(confirmingDelete)} disabled={busy} onClick={() => void removeField(field)}>
                          {busy ? "Deleting…" : confirmingDelete ? "Confirm delete" : "Delete"}
                        </button>
                      </div>
                    </div>
                  )}
                  {confirmingDelete ? <div style={deleteHintStyle}>Deleting removes this label from every assigned entity.</div> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

const pageStyle: React.CSSProperties = { width: "100%", height: "100%", minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 16, padding: "18px clamp(14px, 2.5vw, 30px) 32px", boxSizing: "border-box", background: "radial-gradient(circle at 8% 0%, rgba(103,232,249,.14), transparent 28%), radial-gradient(circle at 96% 4%, rgba(196,181,253,.16), transparent 27%), #f4f7fb", color: "#0f172a" };
const headerSurfaceStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: 18, padding: "20px 22px", border: "1px solid rgba(255,255,255,.82)", borderRadius: 18, background: "linear-gradient(145deg, rgba(255,255,255,.94), rgba(237,244,250,.84))", boxShadow: "12px 12px 28px rgba(148,163,184,.20), -10px -10px 26px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.94)" };
const eyebrowStyle: React.CSSProperties = { color: "#6366f1", fontSize: 11, fontWeight: 950, letterSpacing: ".14em", textTransform: "uppercase" };
const titleStyle: React.CSSProperties = { margin: "4px 0 5px", fontSize: 27, lineHeight: 1.1, fontWeight: 950, letterSpacing: "-.025em" };
const subtitleStyle: React.CSSProperties = { maxWidth: 680, margin: 0, color: "#64748b", fontSize: 13, fontWeight: 650, lineHeight: 1.55 };
const fieldCountStyle = (accent: string): React.CSSProperties => ({ flexShrink: 0, minHeight: 34, display: "inline-flex", alignItems: "center", padding: "0 12px", border: `1px solid ${accent}33`, borderRadius: 999, background: `${accent}12`, color: accent, fontSize: 12, fontWeight: 900 });
const createSurfaceStyle = (accent: string): React.CSSProperties => ({ display: "grid", gap: 14, padding: "18px 20px", border: `1px solid ${accent}26`, borderRadius: 16, background: "linear-gradient(135deg, rgba(255,255,255,.90), rgba(238,246,255,.82) 50%, rgba(247,241,255,.84))", boxShadow: "8px 8px 20px rgba(148,163,184,.18), -8px -8px 20px rgba(255,255,255,.9), inset 0 0 22px rgba(99,102,241,.035)" });
const createCopyStyle: React.CSSProperties = { display: "grid", gap: 3 };
const sectionTitleStyle: React.CSSProperties = { margin: 0, color: "#1e293b", fontSize: 16, fontWeight: 950 };
const helperStyle: React.CSSProperties = { color: "#64748b", fontSize: 12, fontWeight: 650 };
const createControlsStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", alignItems: "end", gap: 14 };
const inputLabelStyle: React.CSSProperties = { display: "grid", gap: 6, color: "#475569", fontSize: 11, fontWeight: 900 };
const inputStyle = (accent: string): React.CSSProperties => ({ width: "100%", minHeight: 40, border: `1px solid ${accent}38`, borderRadius: 10, background: "rgba(255,255,255,.9)", boxShadow: "inset 3px 3px 8px rgba(148,163,184,.16), inset -3px -3px 8px rgba(255,255,255,.9)", color: "#0f172a", padding: "0 12px", boxSizing: "border-box", font: "inherit", fontSize: 13, fontWeight: 800, outline: "none" });
const paletteFieldsetStyle: React.CSSProperties = { margin: 0, padding: 0, border: 0 };
const paletteLegendStyle: React.CSSProperties = { marginBottom: 6, color: "#475569", fontSize: 11, fontWeight: 900 };
const paletteStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 };
const colorButtonStyle = (color: string, selected: boolean): React.CSSProperties => ({ width: 25, height: 25, border: `3px solid ${selected ? "#ffffff" : "transparent"}`, borderRadius: 999, background: color, boxShadow: selected ? `0 0 0 2px ${color}, 0 4px 10px ${color}55` : "inset 1px 1px 0 rgba(255,255,255,.55)", cursor: "pointer", transform: selected ? "scale(1.07)" : "scale(1)" });
const createButtonStyle = (accent: string, disabled: boolean): React.CSSProperties => ({ minHeight: 40, border: 0, borderRadius: 10, background: disabled ? "#cbd5e1" : `linear-gradient(135deg, ${accent}, #8b5cf6)`, boxShadow: disabled ? "none" : `0 9px 20px ${accent}3d, inset 1px 1px 0 rgba(255,255,255,.35)`, color: "#fff", padding: "0 17px", font: "inherit", fontSize: 12, fontWeight: 950, cursor: disabled ? "default" : "pointer" });
const inlineHintStyle: React.CSSProperties = { color: "#b45309", fontSize: 11, fontWeight: 800 };
const errorStyle: React.CSSProperties = { padding: "10px 13px", border: "1px solid rgba(239,68,68,.24)", borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontSize: 12, fontWeight: 800 };
const librarySurfaceStyle: React.CSSProperties = { display: "grid", gap: 14, padding: "18px 20px", border: "1px solid rgba(255,255,255,.86)", borderRadius: 16, background: "rgba(248,250,252,.84)", boxShadow: "10px 10px 24px rgba(148,163,184,.18), -8px -8px 22px rgba(255,255,255,.9)" };
const libraryHeaderStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 };
const refreshButtonStyle: React.CSSProperties = { minHeight: 32, border: "1px solid rgba(148,163,184,.30)", borderRadius: 9, background: "rgba(255,255,255,.86)", color: "#475569", padding: "0 11px", font: "inherit", fontSize: 11, fontWeight: 850, cursor: "pointer", boxShadow: "0 4px 10px rgba(15,23,42,.05)" };
const emptyStyle: React.CSSProperties = { minHeight: 140, display: "grid", placeItems: "center", border: "1px dashed rgba(148,163,184,.34)", borderRadius: 13, color: "#64748b", fontSize: 12, fontWeight: 800 };
const fieldGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 };
const fieldCardStyle = (color: string): React.CSSProperties => ({ display: "grid", gap: 13, padding: "14px", border: `1px solid ${color}22`, borderRadius: 14, background: "linear-gradient(145deg, rgba(255,255,255,.96), rgba(240,244,249,.88))", boxShadow: `7px 7px 16px rgba(148,163,184,.18), -6px -6px 14px rgba(255,255,255,.92), inset 0 0 18px ${color}08` });
const fieldCardTopStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto", alignItems: "center", gap: 8 };
const fieldDotStyle = (color: string): React.CSSProperties => ({ width: 10, height: 10, borderRadius: 999, background: color, boxShadow: `0 0 0 4px ${color}18` });
const fieldNameStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", color: "#1e293b", fontSize: 14, fontWeight: 950 };
const usagePillStyle: React.CSSProperties = { borderRadius: 999, background: "#eef2f7", color: "#64748b", padding: "4px 7px", fontSize: 10, fontWeight: 850 };
const fieldCardBottomStyle: React.CSSProperties = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10 };
const fieldPreviewStyle = (color: string): React.CSSProperties => ({ maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", border: `1px solid ${color}36`, borderRadius: 999, background: `${color}16`, color, padding: "5px 9px", fontSize: 11, fontWeight: 950 });
const cardActionsStyle: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 6 };
const quietButtonStyle: React.CSSProperties = { minHeight: 29, border: "1px solid rgba(148,163,184,.28)", borderRadius: 8, background: "rgba(255,255,255,.9)", color: "#475569", padding: "0 9px", font: "inherit", fontSize: 10, fontWeight: 850, cursor: "pointer" };
const saveButtonStyle = (accent: string): React.CSSProperties => ({ ...quietButtonStyle, borderColor: accent, background: accent, color: "#fff" });
const deleteButtonStyle = (confirming: boolean): React.CSSProperties => ({ ...quietButtonStyle, borderColor: confirming ? "#ef4444" : "rgba(239,68,68,.20)", background: confirming ? "#ef4444" : "#fff7f7", color: confirming ? "#fff" : "#b91c1c" });
const deleteHintStyle: React.CSSProperties = { color: "#b91c1c", fontSize: 10, fontWeight: 750, lineHeight: 1.4 };
const editInputStyle: React.CSSProperties = { width: "100%", minWidth: 0, height: 31, border: "1px solid rgba(99,102,241,.36)", borderRadius: 8, padding: "0 8px", boxSizing: "border-box", font: "inherit", fontSize: 12, fontWeight: 850, outline: "none" };
const editPanelStyle: React.CSSProperties = { display: "grid", gap: 10 };

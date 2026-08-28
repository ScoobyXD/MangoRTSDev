import { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { ExplorerEntityIcon } from "../../icons/index.js";
import type { CompanyUser } from "../communications/communicationsApi.js";
import {
  getEntityDetail,
  updateEntity,
  updateEntityField,
  type ActionItemColor,
  type Entity,
  type EntityField,
  type EntityFieldValue,
} from "../entities/entitiesApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_OPEN,
  updateRenderedEditorEntityReference,
  type EditorEntityLink,
  type EditorEntityLinkRequest,
} from "./editorEntityLinks.js";
import { EntityDetailsRichEditor } from "./EntityDetailsRichEditor.js";
import {
  createEmptyMangoTiptapDocument,
  validateMangoTiptapDocument,
  type MangoTiptapDocument,
} from "./tiptap/mangoTiptapDocument.js";

export type EntityReferencePreviewHostProps = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
};

type EntityReferencePreview = {
  requestID: number;
  entity: EditorEntityLink;
  detail: Entity | null;
  companyUsers: CompanyUser[];
  loading: boolean;
  error: string;
};

function companyUserLabel(users: readonly CompanyUser[], userID: string): string {
  const user = users.find((candidate) => candidate.user_id === userID);
  return user?.display_name?.trim() || user?.email?.trim() || "Company user unavailable";
}

function readableOptionKey(value: string): string {
  const words = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Not set";
}

function formatCalendarDate(value: string): string {
  const calendarDate = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (calendarDate) return `${calendarDate[2]}/${calendarDate[3]}/${calendarDate[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function entityActionItemColor(entity: Entity): ActionItemColor | null {
  if (!isActionItemEntity(entity)) return null;
  const field = entity.entity_fields.find((candidate) => (
    candidate.system_key?.trim().toLowerCase() === "color"
    || candidate.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") === "color"
  ));
  return field?.value === "yellow" || field?.value === "red" ? field.value : null;
}

function isActionItemEntity(entity: Entity): boolean {
  return entity.entity_type_name.trim().toLowerCase() === "action item";
}

function syncEntityReferencePresentation(entity: Entity): void {
  updateRenderedEditorEntityReference({
    entityID: entity.entity_id,
    label: entity.name,
    isActionItem: isActionItemEntity(entity),
    actionItemColor: entityActionItemColor(entity),
  });
}

function entityBodyJSONForSave(value: MangoTiptapDocument, currentBody: unknown): Record<string, unknown> {
  const annotations = isRecord(currentBody) && Array.isArray(currentBody.annotations)
    ? currentBody.annotations
    : [];
  return { ...value, annotations };
}

function parseEditableCalendarDate(value: string): string {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
  if (!match) throw new Error("Use month/day/year for dates.");
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new Error("Use a valid month/day/year date.");
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseEntityFieldInput(field: EntityField, rawValue: string): EntityFieldValue {
  const value = rawValue.trim();
  if (!value) return null;
  if (field.field_type === "boolean") return value === "true";
  if (field.field_type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${field.name} must be a number.`);
    return number;
  }
  if (field.field_type === "date") return parseEditableCalendarDate(value);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entityBodyDocument(value: unknown): MangoTiptapDocument | null {
  if (!isRecord(value)) return null;
  const result = validateMangoTiptapDocument({
    format: value.format,
    schema_version: value.schema_version,
    document: value.document,
  });
  return result.valid ? result.value : null;
}

function previewError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message || "This Entity is unavailable or you no longer have access to it.";
}

export function EntityReferencePreviewHost({ companyID, requestJSON }: EntityReferencePreviewHostProps) {
  const [preview, setPreview] = useState<EntityReferencePreview | null>(null);
  const [savingTarget, setSavingTarget] = useState("");
  const [saveError, setSaveError] = useState("");
  const requestIDRef = useRef(0);

  const close = useCallback(() => {
    requestIDRef.current += 1;
    setSavingTarget("");
    setSaveError("");
    setPreview(null);
  }, []);

  const open = useCallback((entity: EditorEntityLink) => {
    if (entity.entityType !== "entity") return;
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
    setSavingTarget("");
    setSaveError("");
    setPreview({ requestID, entity, detail: null, companyUsers: [], loading: true, error: "" });
  }, []);

  useEffect(() => {
    const onOpenEntityReference = (event: Event) => {
      const entity = (event as CustomEvent<EditorEntityLink>).detail;
      if (entity?.entityType === "entity") open(entity);
    };
    window.addEventListener(EVENT_EDITOR_ENTITY_REFERENCE_OPEN, onOpenEntityReference);
    return () => window.removeEventListener(EVENT_EDITOR_ENTITY_REFERENCE_OPEN, onOpenEntityReference);
  }, [open]);

  const requestID = preview?.requestID ?? 0;
  const entityID = preview?.entity.entityID.trim() ?? "";

  useEffect(() => {
    if (!requestID || !entityID) return undefined;
    const controller = new AbortController();
    void getEntityDetail(requestJSON, { companyID, entityID, signal: controller.signal })
      .then(async (detail) => {
        const needsCompanyUsers = Boolean(detail.created_by_user_id)
          || detail.entity_fields.some((field) => field.field_type === "person" && typeof field.value === "string" && field.value.trim());
        let companyUsers: CompanyUser[] = [];
        if (needsCompanyUsers) {
          try {
            const response = await requestJSON<{ users?: CompanyUser[] }>(`/v1/companies/${encodeURIComponent(companyID)}/users`, {
              cache: "no-store",
              signal: controller.signal,
            });
            companyUsers = response.users ?? [];
          } catch {
            if (controller.signal.aborted) return;
          }
        }
        if (controller.signal.aborted || requestIDRef.current !== requestID) return;
        syncEntityReferencePresentation(detail);
        setPreview((current) => current?.requestID === requestID
          ? { ...current, detail, companyUsers, loading: false, error: "" }
          : current);
      })
      .catch((cause) => {
        if (controller.signal.aborted || requestIDRef.current !== requestID) return;
        setPreview((current) => current?.requestID === requestID
          ? { ...current, detail: null, companyUsers: [], loading: false, error: previewError(cause) }
          : current);
      });
    return () => controller.abort();
  }, [companyID, entityID, requestID, requestJSON]);

  const retry = useCallback(() => {
    setSaveError("");
    setPreview((current) => {
      if (!current) return null;
      const requestID = requestIDRef.current + 1;
      requestIDRef.current = requestID;
      return { ...current, requestID, detail: null, companyUsers: [], loading: true, error: "" };
    });
  }, []);

  const saveNameAndDetails = useCallback(async (name: string, body: MangoTiptapDocument) => {
    const detail = preview?.detail;
    if (!detail || savingTarget) return;
    const cleanName = name.trim();
    if (!cleanName) {
      setSaveError("Entity name is required.");
      return;
    }
    setSavingTarget("entity");
    setSaveError("");
    try {
      const saved = await updateEntity({
        companyID,
        entityID: detail.entity_id,
        name: cleanName,
        bodyJSON: entityBodyJSONForSave(body, detail.body_json),
        baseRevision: detail.revision,
      }, requestJSON);
      syncEntityReferencePresentation(saved);
      setPreview((current) => current?.requestID === preview.requestID
        ? { ...current, entity: { ...current.entity, label: saved.name }, detail: saved }
        : current);
    } catch (cause) {
      setSaveError(previewError(cause));
    } finally {
      setSavingTarget("");
    }
  }, [companyID, preview, requestJSON, savingTarget]);

  const saveFieldValue = useCallback(async (field: EntityField, rawValue: string) => {
    const detail = preview?.detail;
    if (!detail || savingTarget) return;
    setSavingTarget(field.entity_field_id);
    setSaveError("");
    try {
      const savedField = await updateEntityField({
        companyID,
        entityID: detail.entity_id,
        entityFieldID: field.entity_field_id,
        value: parseEntityFieldInput(field, rawValue),
      }, requestJSON);
      const nextDetail: Entity = {
        ...detail,
        entity_fields: detail.entity_fields.map((candidate) => (
          candidate.entity_field_id === savedField.entity_field_id ? savedField : candidate
        )),
      };
      syncEntityReferencePresentation(nextDetail);
      setPreview((current) => current?.requestID === preview.requestID
        ? { ...current, detail: nextDetail }
        : current);
    } catch (cause) {
      setSaveError(previewError(cause));
    } finally {
      setSavingTarget("");
    }
  }, [companyID, preview, requestJSON, savingTarget]);

  if (!preview) return null;
  const title = preview.detail?.name.trim() || preview.entity.label.trim() || "Entity";
  const fields = [...(preview.detail?.entity_fields ?? [])].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
  const bodyDocument = entityBodyDocument(preview.detail?.body_json) ?? createEmptyMangoTiptapDocument();
  const detailKind = preview.detail?.entity_type_name.trim().toLowerCase() === "action item" ? "Action Item" : "Entity";
  const createdBy = preview.detail?.created_by_user_id
    ? companyUserLabel(preview.companyUsers, preview.detail.created_by_user_id)
    : "Not set";
  const createdDate = preview.detail?.created_timestamp ? formatCalendarDate(preview.detail.created_timestamp) : "Not set";

  return (
    <AppModalPortal onRequestClose={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${detailKind} details: ${title}`}
        data-mango-entity-reference-preview="true"
        onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        style={{ position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", padding: 16, background: "rgba(15,23,42,.48)" }}
      >
        <section style={{ width: "min(680px, calc(100vw - 32px))", maxHeight: "min(780px, calc(100vh - 32px))", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(148,163,184,.34)", borderRadius: 18, background: "#fff", boxShadow: "0 28px 80px rgba(15,23,42,.30)" }}>
          <header style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid rgba(148,163,184,.22)", background: "linear-gradient(135deg,rgba(240,253,250,.96),rgba(239,246,255,.96))" }}>
            <ExplorerEntityIcon kind="entity" />
            <div style={{ minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f172a", fontSize: 17, fontWeight: 850 }}>{title}</div>
              <div style={{ marginTop: 2, color: "#64748b", fontSize: 11, fontWeight: 700 }}>{preview.detail?.entity_type_name || "Entity"}</div>
            </div>
            <button type="button" aria-label={`Close ${detailKind} details`} onClick={close} style={{ width: 32, height: 32, border: "1px solid rgba(148,163,184,.28)", borderRadius: 9, background: "#fff", color: "#475569", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
          </header>
          <div style={{ minHeight: 180, overflowY: "auto", padding: 18 }}>
            {preview.loading ? (
              <div role="status" style={{ padding: "28px 8px", color: "#64748b", textAlign: "center", fontSize: 12 }}>Loading Entity details…</div>
            ) : preview.error ? (
              <div role="alert" style={{ display: "grid", justifyItems: "center", gap: 12, padding: "24px 8px", color: "#991b1b", textAlign: "center", fontSize: 12 }}>
                <span>{preview.error}</span>
                <button type="button" onClick={retry} style={{ padding: "7px 13px", border: "1px solid rgba(153,27,27,.3)", borderRadius: 9, background: "#fff", color: "#991b1b", cursor: "pointer", fontWeight: 800 }}>Retry</button>
              </div>
            ) : preview.detail ? (
              <div style={{ display: "grid", gap: 18 }}>
                {saveError && <div role="alert" data-mango-entity-save-error="true" style={saveErrorStyle}>{saveError}</div>}
                <EntityNameAndDetailsEditor
                  key={`${preview.detail.entity_id}:${preview.detail.revision}`}
                  entity={preview.detail}
                  body={bodyDocument}
                  saving={savingTarget === "entity"}
                  disabled={Boolean(savingTarget && savingTarget !== "entity")}
                  onSave={saveNameAndDetails}
                />
                <section aria-label="Entity assigned fields">
                  <h3 style={sectionHeadingStyle}>Fields</h3>
                  <div style={fieldListStyle}>
                    <ReadOnlyEntityValue label="Created by" value={createdBy} />
                    <ReadOnlyEntityValue label="Created date" value={createdDate} />
                    {fields.map((field) => (
                      <EntityFieldValueEditor
                        key={`${field.entity_field_id}:${field.updated_timestamp}`}
                        field={field}
                        companyUsers={preview.companyUsers}
                        saving={savingTarget === field.entity_field_id}
                        disabled={Boolean(savingTarget && savingTarget !== field.entity_field_id)}
                        onSave={saveFieldValue}
                      />
                    ))}
                    {fields.length === 0 && <div style={emptyFieldsStyle}>This Entity has no assigned fields yet.</div>}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </AppModalPortal>
  );
}

function EntityNameAndDetailsEditor({ entity, body, saving, disabled, onSave }: {
  entity: Entity;
  body: MangoTiptapDocument;
  saving: boolean;
  disabled: boolean;
  onSave: (name: string, body: MangoTiptapDocument) => Promise<void>;
}) {
  const [name, setName] = useState(entity.name);
  const [details, setDetails] = useState(body);
  const locked = saving || disabled;
  return (
    <section aria-label="Entity name and details">
      <h3 style={sectionHeadingStyle}>Name and details</h3>
      <form
        style={{ display: "grid", gap: 10 }}
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(name, details);
        }}
      >
        <label style={editorLabelStyle}>
          Name
          <input
            name="name"
            value={name}
            maxLength={200}
            disabled={locked}
            aria-label="Entity name"
            onChange={(event) => setName(event.currentTarget.value)}
            style={editorInputStyle}
          />
        </label>
        <label style={editorLabelStyle}>Details</label>
        <EntityDetailsRichEditor value={body} disabled={locked} onChange={setDetails} />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="submit" disabled={locked || !name.trim()} aria-label="Save Entity name and details" style={saveButtonStyle(locked || !name.trim())}>
            {saving ? "Saving…" : "Save name and details"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ReadOnlyEntityValue({ label, value }: { label: string; value: string }) {
  return (
    <div style={readOnlyFieldStyle}>
      <span style={fieldNameStyle}>{label}</span>
      <span style={{ ...readOnlyTextStyle, color: value === "Not set" ? "#94a3b8" : "#0f172a" }}>{value}</span>
    </div>
  );
}

function EntityFieldValueEditor({ field, companyUsers, saving, disabled, onSave }: {
  field: EntityField;
  companyUsers: readonly CompanyUser[];
  saving: boolean;
  disabled: boolean;
  onSave: (field: EntityField, rawValue: string) => Promise<void>;
}) {
  const locked = saving || disabled;
  return (
    <form
      data-mango-entity-field-editor={field.entity_field_id}
      style={editableFieldStyle}
      onSubmit={(event) => {
        event.preventDefault();
        const rawValue = String(new FormData(event.currentTarget).get("value") ?? "");
        void onSave(field, rawValue);
      }}
    >
      <label htmlFor={`entity-reference-field-${field.entity_field_id}`} style={fieldNameStyle}>{field.name}</label>
      <EntityFieldInput field={field} companyUsers={companyUsers} disabled={locked} />
      <button type="submit" disabled={locked} aria-label={`Save ${field.name}`} style={fieldSaveButtonStyle(locked)}>
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}

function EntityFieldInput({ field, companyUsers, disabled }: {
  field: EntityField;
  companyUsers: readonly CompanyUser[];
  disabled: boolean;
}) {
  const id = `entity-reference-field-${field.entity_field_id}`;
  const current = field.value === null ? "" : String(field.value);
  if (field.field_type === "boolean") {
    return <select id={id} name="value" defaultValue={current} disabled={disabled} aria-label={`Value for ${field.name}`} style={editorInputStyle}>
      <option value="">Not set</option>
      <option value="true">Yes</option>
      <option value="false">No</option>
    </select>;
  }
  if (field.field_type === "choice" || field.field_type === "color") {
    const options = field.config?.options ?? [];
    const currentConfigured = !current || options.some((option) => option.key === current);
    return <select id={id} name="value" defaultValue={current} disabled={disabled} aria-label={`Value for ${field.name}`} style={editorInputStyle}>
      <option value="">{field.field_type === "color" ? "No color" : "Not set"}</option>
      {!currentConfigured && <option value={current}>{readableOptionKey(current)}</option>}
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </select>;
  }
  if (field.field_type === "person") {
    const currentUserKnown = !current || companyUsers.some((user) => user.user_id === current);
    return <select id={id} name="value" defaultValue={current} disabled={disabled} aria-label={`Value for ${field.name}`} style={editorInputStyle}>
      <option value="">Unassigned</option>
      {!currentUserKnown && <option value={current}>Company user unavailable</option>}
      {companyUsers.map((user) => <option key={user.user_id} value={user.user_id}>{user.display_name?.trim() || user.email?.trim() || "Company user unavailable"}</option>)}
    </select>;
  }
  if (field.field_type === "date") {
    return <input
      id={id}
      name="value"
      type="text"
      inputMode="numeric"
      pattern="(?:0?[1-9]|1[0-2])/(?:0?[1-9]|[12][0-9]|3[01])/\d{4}"
      placeholder="MM/DD/YYYY"
      defaultValue={current ? formatCalendarDate(current) : ""}
      disabled={disabled}
      aria-label={`Value for ${field.name}`}
      style={editorInputStyle}
    />;
  }
  return <input
    id={id}
    name="value"
    type={field.field_type === "number" ? "number" : "text"}
    step={field.field_type === "number" ? "any" : undefined}
    defaultValue={current}
    disabled={disabled}
    aria-label={`Value for ${field.name}`}
    style={editorInputStyle}
  />;
}

const sectionHeadingStyle: React.CSSProperties = { margin: "0 0 8px", color: "#334155", fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" };
const editorLabelStyle: React.CSSProperties = { display: "grid", gap: 5, color: "#475569", fontSize: 11, fontWeight: 850 };
const editorInputStyle: React.CSSProperties = { width: "100%", minWidth: 0, minHeight: 34, boxSizing: "border-box", border: "1px solid rgba(148,163,184,.32)", borderRadius: 8, background: "#fff", color: "#0f172a", padding: "0 9px", font: "inherit", fontSize: 12 };
const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({ minHeight: 32, border: 0, borderRadius: 8, background: disabled ? "#cbd5e1" : "#0f766e", color: "#fff", padding: "0 12px", font: "inherit", fontSize: 11, fontWeight: 850, cursor: disabled ? "default" : "pointer" });
const fieldListStyle: React.CSSProperties = { display: "grid", gap: 9 };
const readOnlyFieldStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px,.8fr) minmax(0,1.2fr) 58px", alignItems: "center", gap: 10, padding: "9px 11px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" };
const editableFieldStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px,.8fr) minmax(0,1.2fr) 58px", alignItems: "center", gap: 10, padding: "9px 11px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" };
const fieldNameStyle: React.CSSProperties = { color: "#475569", fontSize: 11, fontWeight: 800 };
const readOnlyTextStyle: React.CSSProperties = { minWidth: 0, overflowWrap: "anywhere", fontSize: 12 };
const fieldSaveButtonStyle = (disabled: boolean): React.CSSProperties => ({ minHeight: 30, border: "1px solid rgba(15,118,110,.28)", borderRadius: 7, background: disabled ? "#e2e8f0" : "#fff", color: disabled ? "#94a3b8" : "#0f766e", padding: "0 8px", font: "inherit", fontSize: 10, fontWeight: 850, cursor: disabled ? "default" : "pointer" });
const saveErrorStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid rgba(239,68,68,.24)", borderRadius: 9, background: "#fef2f2", color: "#991b1b", fontSize: 11, fontWeight: 750 };
const emptyFieldsStyle: React.CSSProperties = { padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc", color: "#94a3b8", fontSize: 12 };

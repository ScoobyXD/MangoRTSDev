import { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { ExplorerEntityIcon } from "../../icons/index.js";
import type { CompanyUser } from "../communications/communicationsApi.js";
import { getEntityDetail, type Entity, type EntityField } from "../entities/entitiesApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_OPEN,
  type EditorEntityLink,
  type EditorEntityLinkRequest,
} from "./editorEntityLinks.js";
import { validateMangoTiptapDocument, type MangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";
import { MangoTiptapStaticRenderer } from "./tiptap/MangoTiptapStaticRenderer.js";

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

function fieldValueLabel(field: EntityField, companyUsers: readonly CompanyUser[]): string {
  if (field.value === null || field.value === "") return "Not set";
  if (field.field_type === "boolean") return field.value === true ? "Yes" : "No";
  if ((field.field_type === "choice" || field.field_type === "color") && typeof field.value === "string") {
    return field.config?.options?.find((option) => option.key === field.value)?.label || readableOptionKey(field.value);
  }
  if (field.field_type === "person" && typeof field.value === "string") {
    return companyUserLabel(companyUsers, field.value);
  }
  if (field.field_type === "date" && typeof field.value === "string") {
    return formatCalendarDate(field.value);
  }
  return String(field.value);
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

function entityBodyHasContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.text === "string" && value.text.trim()) return true;
  if (["mention", "mangoEntityLink", "mangoAttachmentImage", "horizontalRule"].includes(String(value.type ?? ""))) return true;
  return Array.isArray(value.content) && value.content.some(entityBodyHasContent);
}

function previewError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message || "This Entity is unavailable or you no longer have access to it.";
}

export function EntityReferencePreviewHost({ companyID, requestJSON }: EntityReferencePreviewHostProps) {
  const [preview, setPreview] = useState<EntityReferencePreview | null>(null);
  const requestIDRef = useRef(0);

  const close = useCallback(() => {
    requestIDRef.current += 1;
    setPreview(null);
  }, []);

  const open = useCallback((entity: EditorEntityLink) => {
    if (entity.entityType !== "entity") return;
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
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
    setPreview((current) => {
      if (!current) return null;
      const requestID = requestIDRef.current + 1;
      requestIDRef.current = requestID;
      return { ...current, requestID, detail: null, companyUsers: [], loading: true, error: "" };
    });
  }, []);

  if (!preview) return null;
  const title = preview.detail?.name.trim() || preview.entity.label.trim() || "Entity";
  const fields = [...(preview.detail?.entity_fields ?? [])].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
  const bodyDocument = entityBodyDocument(preview.detail?.body_json);
  const hasBody = Boolean(bodyDocument && entityBodyHasContent(bodyDocument.document));
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
        <section style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "min(720px, calc(100vh - 32px))", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(148,163,184,.34)", borderRadius: 18, background: "#fff", boxShadow: "0 28px 80px rgba(15,23,42,.30)" }}>
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
            ) : (
              <div style={{ display: "grid", gap: 18 }}>
                <section aria-label="Entity details body">
                  <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" }}>Details</h3>
                  {hasBody && bodyDocument ? (
                    <MangoTiptapStaticRenderer
                      value={bodyDocument}
                      ariaLabel={`${title} details`}
                      style={{ minHeight: 0, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#fff" }}
                    />
                  ) : (
                    <div style={{ padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc", color: "#94a3b8", fontSize: 12 }}>No details provided.</div>
                  )}
                </section>
                <section aria-label="Entity assigned fields">
                  <h3 style={{ margin: "0 0 8px", color: "#334155", fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase" }}>Fields</h3>
                  {fields.length > 0 ? (
                    <dl style={{ display: "grid", gap: 9, margin: 0 }}>
                      {detailKind === "Action Item" && (
                        <>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                            <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>Created by</dt>
                            <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: createdBy === "Not set" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{createdBy}</dd>
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                            <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>Created date</dt>
                            <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: createdDate === "Not set" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{createdDate}</dd>
                          </div>
                        </>
                      )}
                      {fields.map((field) => (
                        <div key={field.entity_field_id} style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                          <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>{field.name}</dt>
                          <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: field.value === null || field.value === "" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{fieldValueLabel(field, preview.companyUsers)}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    detailKind === "Action Item" ? (
                      <dl style={{ display: "grid", gap: 9, margin: 0 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                          <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>Created by</dt>
                          <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: createdBy === "Not set" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{createdBy}</dd>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                          <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>Created date</dt>
                          <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: createdDate === "Not set" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{createdDate}</dd>
                        </div>
                      </dl>
                    ) : <div style={{ padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc", color: "#94a3b8", fontSize: 12 }}>This Entity has no assigned fields yet.</div>
                  )}
                </section>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppModalPortal>
  );
}

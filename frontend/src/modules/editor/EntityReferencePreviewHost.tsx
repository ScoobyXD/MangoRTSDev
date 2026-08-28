import { useCallback, useEffect, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { getEntityDetail, type Entity, type EntityField } from "../entities/entitiesApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_OPEN,
  type EditorEntityLink,
  type EditorEntityLinkRequest,
} from "./editorEntityLinks.js";
import { EntityIcon } from "./EntityIcon.js";

export type EntityReferencePreviewHostProps = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
};

type EntityReferencePreview = {
  requestID: number;
  entity: EditorEntityLink;
  detail: Entity | null;
  loading: boolean;
  error: string;
};

function fieldValueLabel(field: EntityField): string {
  if (field.value === null || field.value === "") return "Not set";
  if (field.field_type === "boolean") return field.value === true ? "Yes" : "No";
  return String(field.value);
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
    setPreview({ requestID, entity, detail: null, loading: true, error: "" });
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
      .then((detail) => {
        if (controller.signal.aborted || requestIDRef.current !== requestID) return;
        setPreview((current) => current?.requestID === requestID
          ? { ...current, detail, loading: false, error: "" }
          : current);
      })
      .catch((cause) => {
        if (controller.signal.aborted || requestIDRef.current !== requestID) return;
        setPreview((current) => current?.requestID === requestID
          ? { ...current, detail: null, loading: false, error: previewError(cause) }
          : current);
      });
    return () => controller.abort();
  }, [companyID, entityID, requestID, requestJSON]);

  const retry = useCallback(() => {
    setPreview((current) => {
      if (!current) return null;
      const requestID = requestIDRef.current + 1;
      requestIDRef.current = requestID;
      return { ...current, requestID, detail: null, loading: true, error: "" };
    });
  }, []);

  if (!preview) return null;
  const title = preview.detail?.name.trim() || preview.entity.label.trim() || "Entity";
  const fields = [...(preview.detail?.entity_fields ?? [])].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));

  return (
    <AppModalPortal onRequestClose={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Entity details: ${title}`}
        data-mango-entity-reference-preview="true"
        onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}
        style={{ position: "fixed", inset: 0, zIndex: 1, display: "grid", placeItems: "center", padding: 16, background: "rgba(15,23,42,.48)" }}
      >
        <section style={{ width: "min(560px, calc(100vw - 32px))", maxHeight: "min(720px, calc(100vh - 32px))", display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(148,163,184,.34)", borderRadius: 18, background: "#fff", boxShadow: "0 28px 80px rgba(15,23,42,.30)" }}>
          <header style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "16px 18px", borderBottom: "1px solid rgba(148,163,184,.22)", background: "linear-gradient(135deg,rgba(240,253,250,.96),rgba(239,246,255,.96))" }}>
            <EntityIcon />
            <div style={{ minWidth: 0 }}>
              <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f172a", fontSize: 17, fontWeight: 850 }}>{title}</div>
              <div style={{ marginTop: 2, color: "#64748b", fontSize: 11, fontWeight: 700 }}>{preview.detail?.entity_type_name || "Entity"}</div>
            </div>
            <button type="button" aria-label="Close Entity details" onClick={close} style={{ width: 32, height: 32, border: "1px solid rgba(148,163,184,.28)", borderRadius: 9, background: "#fff", color: "#475569", cursor: "pointer", fontSize: 17, lineHeight: 1 }}>×</button>
          </header>
          <div style={{ minHeight: 180, overflowY: "auto", padding: 18 }}>
            {preview.loading ? (
              <div role="status" style={{ padding: "28px 8px", color: "#64748b", textAlign: "center", fontSize: 12 }}>Loading Entity details…</div>
            ) : preview.error ? (
              <div role="alert" style={{ display: "grid", justifyItems: "center", gap: 12, padding: "24px 8px", color: "#991b1b", textAlign: "center", fontSize: 12 }}>
                <span>{preview.error}</span>
                <button type="button" onClick={retry} style={{ padding: "7px 13px", border: "1px solid rgba(153,27,27,.3)", borderRadius: 9, background: "#fff", color: "#991b1b", cursor: "pointer", fontWeight: 800 }}>Retry</button>
              </div>
            ) : fields.length > 0 ? (
              <dl style={{ display: "grid", gap: 9, margin: 0 }}>
                {fields.map((field) => (
                  <div key={field.entity_field_id} style={{ display: "grid", gridTemplateColumns: "minmax(120px, .8fr) minmax(0, 1.2fr)", gap: 14, padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" }}>
                    <dt style={{ color: "#475569", fontSize: 11, fontWeight: 800 }}>{field.name}</dt>
                    <dd style={{ minWidth: 0, margin: 0, overflowWrap: "anywhere", color: field.value === null || field.value === "" ? "#94a3b8" : "#0f172a", fontSize: 12 }}>{fieldValueLabel(field)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <div style={{ padding: "28px 8px", color: "#64748b", textAlign: "center", fontSize: 12 }}>This Entity has no fields yet.</div>
            )}
          </div>
        </section>
      </div>
    </AppModalPortal>
  );
}

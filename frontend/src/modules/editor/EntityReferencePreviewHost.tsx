import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppModalPortal, useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { ActionItemIcon, ExplorerEntityIcon } from "../../icons/index.js";
import type { CompanyUser } from "../communications/communicationsApi.js";
import {
  getEntityDetail,
  updateEntity,
  updateEntityField,
  type Entity,
  type EntityField,
  type EntityFieldValue,
} from "../entities/entitiesApi.js";
import {
  EVENT_EDITOR_ENTITY_REFERENCE_OPEN,
  editorEntityActionItemColor,
  updateRenderedEditorEntityReference,
  type EditorEntityLinkAnchorBounds,
  type EditorEntityLink,
  type EditorEntityLinkRequest,
  type EditorEntityReferenceOpenDetail,
} from "./editorEntityLinks.js";
import { EntityDetailsRichEditor } from "./EntityDetailsRichEditor.js";
import {
  CompanyUserSearchPicker,
  EditorCalendarDateInput,
  editorCompanyUserLabel,
  editorCompanyUserMatches,
} from "./EditorFieldControls.js";
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
  anchor?: EditorEntityLinkAnchorBounds;
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

function isActionItemEntity(entity: Entity): boolean {
  return entity.entity_type_name.trim().toLowerCase() === "action item";
}

function syncEntityReferencePresentation(entity: Entity): void {
  updateRenderedEditorEntityReference({
    entityID: entity.entity_id,
    label: entity.name,
    isActionItem: isActionItemEntity(entity),
    actionItemColor: editorEntityActionItemColor(entity),
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

  const open = useCallback((entity: EditorEntityLink, anchor?: EditorEntityLinkAnchorBounds) => {
    if (entity.entityType !== "entity") return;
    const requestID = requestIDRef.current + 1;
    requestIDRef.current = requestID;
    setSavingTarget("");
    setSaveError("");
    setPreview({ requestID, entity, ...(anchor ? { anchor } : {}), detail: null, companyUsers: [], loading: true, error: "" });
  }, []);

  useEffect(() => {
    const onOpenEntityReference = (event: Event) => {
      const detail = (event as CustomEvent<EditorEntityReferenceOpenDetail>).detail;
      if (detail?.entity?.entityType === "entity") open(detail.entity, detail.anchor);
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
          || detail.entity_fields.some((field) => field.field_type === "person");
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

  const acceptSavedActionItem = useCallback((requestID: number, saved: Entity) => {
    syncEntityReferencePresentation(saved);
    setPreview((current) => current?.requestID === requestID
      ? { ...current, entity: { ...current.entity, label: saved.name, isActionItem: true }, detail: saved }
      : current);
  }, []);

  if (!preview) return null;
  const title = preview.detail?.name.trim() || preview.entity.label.trim() || "Entity";
  const fields = [...(preview.detail?.entity_fields ?? [])].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
  const bodyDocument = entityBodyDocument(preview.detail?.body_json) ?? createEmptyMangoTiptapDocument();
  const detailKind = preview.detail?.entity_type_name.trim().toLowerCase() === "action item" ? "Action Item" : "Entity";
  const createdBy = preview.detail?.created_by_user_id
    ? companyUserLabel(preview.companyUsers, preview.detail.created_by_user_id)
    : "Not set";
  const createdDate = preview.detail?.created_timestamp ? formatCalendarDate(preview.detail.created_timestamp) : "Not set";
  const actionItem = preview.entity.isActionItem === true || Boolean(preview.detail && isActionItemEntity(preview.detail));

  if (actionItem) {
    return (
      <ActionItemReferencePopover
        preview={preview}
        companyID={companyID}
        requestJSON={requestJSON}
        onRetry={retry}
        onSaved={(saved) => acceptSavedActionItem(preview.requestID, saved)}
        onClose={close}
      />
    );
  }

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

type ActionItemDraft = {
  name: string;
  details: string;
  fieldValues: Record<string, string>;
};

function actionItemFieldKey(field: EntityField): string {
  return field.system_key?.trim().toLowerCase()
    || field.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function actionItemFieldDraftValue(field: EntityField): string {
  if (field.value === null) return "";
  const value = String(field.value);
  return field.field_type === "date" ? formatCalendarDate(value) : value;
}

function plainEntityBodyText(value: unknown): string {
  if (!isRecord(value)) return "";
  const document = isRecord(value.document) ? value.document : value;
  const read = (node: unknown): string => {
    if (!isRecord(node)) return "";
    if (node.type === "text" && typeof node.text === "string") return node.text;
    if (node.type === "hardBreak") return "\n";
    if (!Array.isArray(node.content)) return "";
    const values = node.content.map(read);
    return node.type === "doc" ? values.join("\n") : values.join("");
  };
  return read(document).trim();
}

function plainEntityBodyJSON(value: string, currentBody: unknown): Record<string, unknown> {
  const annotations = isRecord(currentBody) && Array.isArray(currentBody.annotations)
    ? currentBody.annotations
    : [];
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  return {
    format: "mango-tiptap-json",
    schema_version: 1,
    annotations,
    document: {
      type: "doc",
      content: lines.map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
    },
  };
}

function actionItemDraft(entity: Entity): ActionItemDraft {
  return {
    name: entity.name,
    details: plainEntityBodyText(entity.body_json),
    fieldValues: Object.fromEntries(entity.entity_fields.map((field) => [
      field.entity_field_id,
      actionItemFieldDraftValue(field),
    ])),
  };
}

function actionItemDraftsEqual(left: ActionItemDraft, right: ActionItemDraft): boolean {
  if (left.name !== right.name || left.details !== right.details) return false;
  const fieldIDs = new Set([...Object.keys(left.fieldValues), ...Object.keys(right.fieldValues)]);
  return [...fieldIDs].every((fieldID) => left.fieldValues[fieldID] === right.fieldValues[fieldID]);
}

export function actionItemReferencePopoverPosition(
  anchor: EditorEntityLinkAnchorBounds | undefined,
  viewportWidth = typeof window === "undefined" ? 1200 : window.innerWidth,
  viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight,
): React.CSSProperties {
  const width = Math.max(0, Math.min(500, viewportWidth - 24));
  const maxHeight = Math.max(0, Math.min(640, viewportHeight - 24));
  const desiredLeft = anchor
    ? anchor.right + 8 + width <= viewportWidth - 12
      ? anchor.right + 8
      : anchor.left - width - 8
    : (viewportWidth - width) / 2;
  const left = Math.max(12, Math.min(desiredLeft, viewportWidth - width - 12));
  const desiredTop = anchor ? anchor.top : (viewportHeight - maxHeight) / 2;
  const top = Math.max(12, Math.min(desiredTop, viewportHeight - maxHeight - 12));
  return { position: "fixed", left, top, width, maxHeight };
}

const ACTION_ITEM_POPOVER_Z_INDEX = 12020;

function ActionItemFloatingPortal({
  anchor,
  children,
}: {
  anchor?: EditorEntityLinkAnchorBounds;
  children: React.ReactNode;
}) {
  const owningModalLayer = anchor?.portalTarget;
  if (owningModalLayer?.isConnected) return createPortal(children, owningModalLayer);
  return <AppModalPortal trapFocus={false}>{children}</AppModalPortal>;
}

function ActionItemReferencePopover({
  preview,
  companyID,
  requestJSON,
  onRetry,
  onSaved,
  onClose,
}: {
  preview: EntityReferencePreview;
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  onRetry: () => void;
  onSaved: (entity: Entity) => void;
  onClose: () => void;
}) {
  if (preview.detail) {
    return (
      <EditableActionItemPopover
        key={preview.detail.entity_id}
        entity={preview.detail}
        companyUsers={preview.companyUsers}
        anchor={preview.anchor}
        companyID={companyID}
        requestJSON={requestJSON}
        onSaved={onSaved}
        onClose={onClose}
      />
    );
  }
  const title = preview.entity.label.trim() || "Action Item";
  return (
    <PendingActionItemReferencePopover
      preview={preview}
      title={title}
      onRetry={onRetry}
      onClose={onClose}
    />
  );
}

function PendingActionItemReferencePopover({
  preview,
  title,
  onRetry,
  onClose,
}: {
  preview: EntityReferencePreview;
  title: string;
  onRetry: () => void;
  onClose: () => void;
}) {
  const popoverRef = useRef<HTMLElement | null>(null);
  useAppFloatingMenuDismissal(true, popoverRef, onClose);
  return (
    <ActionItemFloatingPortal anchor={preview.anchor}>
      <section
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-label={"Action Item details: " + title}
        data-mango-entity-reference-preview="true"
        data-mango-action-item-popover="true"
        style={{ ...actionItemReferencePopoverPosition(preview.anchor), zIndex: ACTION_ITEM_POPOVER_Z_INDEX, display: "grid", gridTemplateRows: "auto minmax(120px,1fr)", overflow: "hidden", border: "1px solid rgba(148,163,184,.34)", borderRadius: 14, background: "#fff", boxShadow: "0 18px 50px rgba(15,23,42,.24)" }}
      >
        <header style={actionItemHeaderStyle}>
          <span style={actionItemIconBadgeStyle(null)}><ActionItemIcon size={17} /></span>
          <strong style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#0f172a", fontSize: 14 }}>{title}</strong>
          <button type="button" aria-label="Close Action Item details" onClick={onClose} style={actionItemCloseButtonStyle}>×</button>
        </header>
        {preview.loading ? (
          <div role="status" style={{ padding: "34px 18px", color: "#64748b", textAlign: "center", fontSize: 12 }}>Loading Action Item…</div>
        ) : (
          <div role="alert" style={{ display: "grid", justifyItems: "center", gap: 12, padding: "28px 18px", color: "#991b1b", textAlign: "center", fontSize: 12 }}>
            <span>{preview.error}</span>
            <button type="button" onClick={onRetry} style={{ padding: "7px 13px", border: "1px solid rgba(153,27,27,.3)", borderRadius: 9, background: "#fff", color: "#991b1b", cursor: "pointer", fontWeight: 800 }}>Retry</button>
          </div>
        )}
      </section>
    </ActionItemFloatingPortal>
  );
}

function EditableActionItemPopover({
  entity,
  companyUsers,
  anchor,
  companyID,
  requestJSON,
  onSaved,
  onClose,
}: {
  entity: Entity;
  companyUsers: readonly CompanyUser[];
  anchor?: EditorEntityLinkAnchorBounds;
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  onSaved: (entity: Entity) => void;
  onClose: () => void;
}) {
  const initialDraft = actionItemDraft(entity);
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const entityRef = useRef(entity);
  const draftRef = useRef(initialDraft);
  const savedDraftRef = useRef(initialDraft);
  const changeVersionRef = useRef(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savePromiseRef = useRef<Promise<boolean> | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);

  const saveCurrentDraft = useCallback(async (): Promise<boolean> => {
    const target: ActionItemDraft = {
      name: draftRef.current.name,
      details: draftRef.current.details,
      fieldValues: { ...draftRef.current.fieldValues },
    };
    const previouslySaved = savedDraftRef.current;
    let latestEntity = entityRef.current;
    const cleanName = target.name.trim();
    setSaving(true);
    setSaveError("");
    try {
      if (!cleanName) throw new Error("Action Item title is required.");
      const nextSaved: ActionItemDraft = {
        name: previouslySaved.name,
        details: previouslySaved.details,
        fieldValues: { ...previouslySaved.fieldValues },
      };
      const nameChanged = target.name !== previouslySaved.name;
      const detailsChanged = target.details !== previouslySaved.details;

      if (nameChanged || detailsChanged) {
        const saved = await updateEntity({
          companyID,
          entityID: latestEntity.entity_id,
          name: cleanName,
          ...(detailsChanged ? { bodyJSON: plainEntityBodyJSON(target.details, latestEntity.body_json) } : {}),
          baseRevision: latestEntity.revision,
        }, requestJSON);
        latestEntity = saved;
        nextSaved.name = target.name;
        nextSaved.details = target.details;
        entityRef.current = latestEntity;
        savedDraftRef.current = {
          ...nextSaved,
          fieldValues: { ...nextSaved.fieldValues },
        };
        onSaved(latestEntity);
      }

      for (const field of latestEntity.entity_fields) {
        const rawValue = target.fieldValues[field.entity_field_id] ?? "";
        if (rawValue === previouslySaved.fieldValues[field.entity_field_id]) continue;
        const savedField = await updateEntityField({
          companyID,
          entityID: latestEntity.entity_id,
          entityFieldID: field.entity_field_id,
          value: parseEntityFieldInput(field, rawValue),
        }, requestJSON);
        latestEntity = {
          ...latestEntity,
          entity_fields: latestEntity.entity_fields.map((candidate) => (
            candidate.entity_field_id === savedField.entity_field_id ? savedField : candidate
          )),
        };
        nextSaved.fieldValues[field.entity_field_id] = rawValue;
        entityRef.current = latestEntity;
        savedDraftRef.current = {
          ...nextSaved,
          fieldValues: { ...nextSaved.fieldValues },
        };
        onSaved(latestEntity);
      }

      savedDraftRef.current = nextSaved;
      entityRef.current = latestEntity;
      return true;
    } catch (cause) {
      setSaveError(previewError(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [companyID, onSaved, requestJSON]);

  const flushLatest = useCallback(async (): Promise<boolean> => {
    while (true) {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const activeSave = savePromiseRef.current;
      if (activeSave) {
        if (!(await activeSave)) return false;
        continue;
      }
      if (actionItemDraftsEqual(draftRef.current, savedDraftRef.current)) return true;
      const save = saveCurrentDraft();
      savePromiseRef.current = save;
      void save.finally(() => {
        if (savePromiseRef.current === save) savePromiseRef.current = null;
      });
      if (!(await save)) return false;
      if (savePromiseRef.current === save) savePromiseRef.current = null;
    }
  }, [saveCurrentDraft]);

  const scheduleSave = useCallback((next: ActionItemDraft) => {
    draftRef.current = next;
    setDraft(next);
    changeVersionRef.current += 1;
    setSaveError("");
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushLatest();
    }, 500);
  }, [flushLatest]);

  useEffect(() => () => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
  }, []);

  const updateName = (name: string) => scheduleSave({ ...draftRef.current, name });
  const updateDetails = (details: string) => scheduleSave({ ...draftRef.current, details });
  const updateField = (fieldID: string, value: string) => scheduleSave({
    ...draftRef.current,
    fieldValues: { ...draftRef.current.fieldValues, [fieldID]: value },
  });
  const closeAfterFlush = async () => {
    while (true) {
      const versionBeforeFlush = changeVersionRef.current;
      if (!(await flushLatest())) return;
      if (
        versionBeforeFlush === changeVersionRef.current
        && actionItemDraftsEqual(draftRef.current, savedDraftRef.current)
      ) {
        onClose();
        return;
      }
    }
  };

  useAppFloatingMenuDismissal(true, popoverRef, () => { void closeAfterFlush(); });

  const orderedFields = [...entity.entity_fields].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));
  const fieldByKey = new Map(orderedFields.map((field) => [actionItemFieldKey(field), field]));
  const personField = fieldByKey.get("person_in_charge");
  const colorField = fieldByKey.get("color");
  const analysisDateField = fieldByKey.get("analysis_due_date");
  const completionDateField = fieldByKey.get("completion_due_date");
  const statusField = fieldByKey.get("status");
  const primaryFields = [personField, colorField, analysisDateField, completionDateField, statusField]
    .filter((field): field is EntityField => Boolean(field));
  const primaryFieldIDs = new Set(primaryFields.map((field) => field.entity_field_id));
  const additionalFields = orderedFields.filter((field) => !primaryFieldIDs.has(field.entity_field_id));
  const color = colorField ? draft.fieldValues[colorField.entity_field_id] : "";
  const saved = !saving && !saveError && actionItemDraftsEqual(draft, savedDraftRef.current);
  const createdBy = entity.created_by_user_id ? companyUserLabel(companyUsers, entity.created_by_user_id) : "Not set";
  const createdDate = entity.created_timestamp ? formatCalendarDate(entity.created_timestamp) : "Not set";

  return (
    <ActionItemFloatingPortal anchor={anchor}>
      <section
        ref={popoverRef}
        role="dialog"
        aria-modal="false"
        aria-label={"Action Item details: " + (draft.name.trim() || entity.name)}
        data-mango-entity-reference-preview="true"
        data-mango-action-item-popover="true"
        style={{ ...actionItemReferencePopoverPosition(anchor), zIndex: ACTION_ITEM_POPOVER_Z_INDEX, display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden", border: "1px solid rgba(148,163,184,.34)", borderRadius: 14, background: "#fff", boxShadow: "0 18px 50px rgba(15,23,42,.24)" }}
      >
        <header style={actionItemHeaderStyle}>
            <span className={color === "yellow" || color === "red" ? "mango-editor-action-item--" + color : undefined} style={actionItemIconBadgeStyle(color)}>
              <ActionItemIcon size={17} />
            </span>
            <input
              value={draft.name}
              maxLength={200}
              aria-label="Action Item title"
              onChange={(event) => updateName(event.currentTarget.value)}
              style={{ ...editorInputStyle, minHeight: 36, fontSize: 14, fontWeight: 850 }}
            />
            <span role="status" style={{ color: saveError ? "#b91c1c" : saving ? "#64748b" : saved ? "#15803d" : "#92400e", fontSize: 10, fontWeight: 800, whiteSpace: "nowrap" }}>
              {saveError ? "Not saved" : saving ? "Saving…" : saved ? "Saved" : "Pending"}
            </span>
            <button type="button" aria-label="Close Action Item details" onClick={() => void closeAfterFlush()} style={actionItemCloseButtonStyle}>×</button>
        </header>
        <div style={{ minHeight: 0, overflowY: "auto", padding: 14 }}>
            <div style={{ display: "grid", gap: 12 }}>
              {saveError && <div role="alert" data-mango-entity-save-error="true" style={saveErrorStyle}>{saveError}</div>}
              <label style={editorLabelStyle}>
                Details
                <textarea
                  value={draft.details}
                  rows={5}
                  aria-label="Action Item details"
                  onChange={(event) => updateDetails(event.currentTarget.value)}
                  style={{ ...editorInputStyle, minHeight: 104, resize: "vertical", padding: "9px 10px", lineHeight: 1.45 }}
                />
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,.82fr) minmax(0,1.18fr)", gap: 10, alignItems: "start" }}>
                <section aria-label="Action Item creation details" style={actionItemMetadataCardStyle}>
                  <ReadOnlyEntityValue label="Created by" value={createdBy} compact />
                  <ReadOnlyEntityValue label="Created date" value={createdDate} compact />
                  {personField && (
                    <ActionItemFieldControl
                      field={personField}
                      value={draft.fieldValues[personField.entity_field_id] ?? ""}
                      companyUsers={companyUsers}
                      onChange={(value) => updateField(personField.entity_field_id, value)}
                    />
                  )}
                </section>
                <section aria-label="Action Item responsibility and dates" style={actionItemMetadataCardStyle}>
                  {[colorField, analysisDateField, completionDateField].map((field) => field ? (
                    <ActionItemFieldControl
                      key={field.entity_field_id}
                      field={field}
                      value={draft.fieldValues[field.entity_field_id] ?? ""}
                      companyUsers={companyUsers}
                      onChange={(value) => updateField(field.entity_field_id, value)}
                    />
                  ) : null)}
                </section>
              </div>
              {additionalFields.length > 0 && (
                <section aria-label="Additional Action Item fields" style={{ ...actionItemMetadataCardStyle, gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
                  {additionalFields.map((field) => (
                    <ActionItemFieldControl
                      key={field.entity_field_id}
                      field={field}
                      value={draft.fieldValues[field.entity_field_id] ?? ""}
                      companyUsers={companyUsers}
                      onChange={(value) => updateField(field.entity_field_id, value)}
                    />
                  ))}
                </section>
              )}
              {statusField && (
                <section aria-label="Action Item status" style={actionItemMetadataCardStyle}>
                  <ActionItemFieldControl
                    field={statusField}
                    value={draft.fieldValues[statusField.entity_field_id] ?? ""}
                    companyUsers={companyUsers}
                    onChange={(value) => updateField(statusField.entity_field_id, value)}
                  />
                </section>
              )}
            </div>
        </div>
      </section>
    </ActionItemFloatingPortal>
  );
}

function ActionItemFieldControl({
  field,
  value,
  companyUsers,
  onChange,
}: {
  field: EntityField;
  value: string;
  companyUsers: readonly CompanyUser[];
  onChange: (value: string) => void;
}) {
  const id = "action-item-field-" + field.entity_field_id;
  const select = (children: React.ReactNode) => (
    <select id={id} value={value} aria-label={"Value for " + field.name} onChange={(event) => onChange(event.currentTarget.value)} style={editorInputStyle}>
      {children}
    </select>
  );
  let control: React.ReactNode;
  if (field.field_type === "boolean") {
    control = select(<><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></>);
  } else if (field.field_type === "choice") {
    const options = field.config?.options ?? [];
    const currentConfigured = !value || options.some((option) => option.key === value);
    control = select(<>
      <option value="">Not set</option>
      {!currentConfigured && <option value={value}>{readableOptionKey(value)}</option>}
      {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
    </>);
  } else if (field.field_type === "color") {
    return (
      <div style={editorLabelStyle}>
        <span>{field.name}</span>
        <ActionItemColorPicker id={id} field={field} value={value} onChange={onChange} />
      </div>
    );
  } else if (field.field_type === "person") {
    return (
      <div style={editorLabelStyle}>
        <label htmlFor={id}>{field.name}</label>
        <ActionItemPersonPicker id={id} value={value} companyUsers={companyUsers} onChange={onChange} />
      </div>
    );
  } else if (field.field_type === "date") {
    return (
      <div style={editorLabelStyle}>
        <label htmlFor={id}>{field.name}</label>
        <EditorCalendarDateInput
          id={id}
          value={value}
          ariaLabel={"Value for " + field.name}
          accent="#0f766e"
          onChange={onChange}
          containerStyle={{ gridTemplateColumns: "minmax(0, 1fr) 34px" }}
          inputStyle={{ ...editorInputStyle, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
          buttonStyle={{ width: 34, height: 34, borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }}
        />
      </div>
    );
  } else {
    control = <input id={id} value={value} type={field.field_type === "number" ? "number" : "text"} step={field.field_type === "number" ? "any" : undefined} aria-label={"Value for " + field.name} onChange={(event) => onChange(event.currentTarget.value)} style={editorInputStyle} />;
  }
  return <label htmlFor={id} style={editorLabelStyle}>{field.name}{control}</label>;
}

function actionItemPersonLabel(user: CompanyUser | undefined): string {
  return user?.display_name?.trim() || user?.email?.trim() || "Company user unavailable";
}

function ActionItemPersonPicker({
  id,
  value,
  companyUsers,
  onChange,
}: {
  id: string;
  value: string;
  companyUsers: readonly CompanyUser[];
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedUser = companyUsers.find((user) => user.user_id === value);
  const selectedLabel = value ? actionItemPersonLabel(selectedUser) : "";
  const [query, setQuery] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const matchingUsers = useMemo(() => [...companyUsers]
    .filter((user) => editorCompanyUserMatches(user, query))
    .sort((left, right) => editorCompanyUserLabel(left).localeCompare(editorCompanyUserLabel(right), undefined, { numeric: true, sensitivity: "base" })), [companyUsers, query]);
  const showUnassigned = !query.trim() || "unassigned".includes(query.trim().toLocaleLowerCase());

  useEffect(() => {
    if (!open) setQuery(selectedLabel);
  }, [open, selectedLabel]);
  useAppFloatingMenuDismissal(open, rootRef, () => setOpen(false));

  const choose = (userID: string, label: string) => {
    setQuery(label);
    setOpen(false);
    onChange(userID);
  };
  return (
    <CompanyUserSearchPicker
      ref={rootRef}
      id={id}
      inputAriaLabel="Value for Person in charge"
      resultsAriaLabel="Person in charge results"
      query={query}
      placeholder="Search company users"
      accent="rgba(148,163,184,.32)"
      showResults={open}
      hasResults={showUnassigned || matchingUsers.length > 0}
      emptyMessage="No matching company users"
      onQueryChange={(nextQuery) => {
        setQuery(nextQuery);
        setOpen(true);
      }}
      onInputFocus={(event) => {
        setOpen(true);
        event.currentTarget.select();
      }}
      onInputKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          setQuery(selectedLabel);
          setOpen(false);
        } else if (event.key === "Enter" && matchingUsers[0]) {
          event.preventDefault();
          choose(matchingUsers[0].user_id, actionItemPersonLabel(matchingUsers[0]));
        }
      }}
      style={{ position: "relative", minWidth: 0 }}
      inputStyle={{ width: "100%", minHeight: 34, padding: "0 9px", fontSize: 12, fontWeight: 600 }}
      listStyle={actionItemPickerMenuStyle}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
        setOpen(false);
      }}
    >
      {showUnassigned && (
        <button type="button" role="option" aria-selected={!value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose("", "")} style={actionItemPickerOptionStyle}>
          <span aria-hidden="true" style={actionItemPersonAvatarStyle}>—</span>
          <span>Unassigned</span>
        </button>
      )}
      {matchingUsers.map((user) => {
        const label = actionItemPersonLabel(user);
        return (
          <button key={user.user_id} type="button" role="option" aria-selected={user.user_id === value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(user.user_id, label)} style={actionItemPickerOptionStyle}>
            <span aria-hidden="true" style={actionItemPersonAvatarStyle}>{label.slice(0, 1).toLocaleUpperCase()}</span>
            <span style={{ minWidth: 0, display: "grid", textAlign: "left" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
              {user.email?.trim() && user.display_name?.trim() && <span style={{ color: "#64748b", fontSize: 10, fontWeight: 600 }}>{user.email.trim()}</span>}
            </span>
          </button>
        );
      })}
    </CompanyUserSearchPicker>
  );
}

function actionItemColorFill(key: string, configuredColor?: string): string {
  return configuredColor || (key === "yellow" ? "#facc15" : key === "red" ? "#ef4444" : "#ffffff");
}

function ActionItemColorPicker({ id, field, value, onChange }: { id: string; field: EntityField; value: string; onChange: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const configuredOptions = field.config?.options ?? [];
  const currentOption = configuredOptions.find((option) => option.key === value);
  const selectedLabel = value ? currentOption?.label || readableOptionKey(value) : "No color";
  useAppFloatingMenuDismissal(open, rootRef, () => setOpen(false));
  const options = [
    { key: "", label: "No color", color: undefined },
    ...(!value || currentOption ? [] : [{ key: value, label: readableOptionKey(value), color: undefined }]),
    ...configuredOptions,
  ];
  return (
    <div ref={rootRef} style={{ position: "relative", minWidth: 0 }}>
      <button
        id={id}
        type="button"
        aria-label={"Value for " + field.name}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        data-action-item-color-value={value}
        onClick={() => setOpen((current) => !current)}
        style={{ ...editorInputStyle, display: "grid", gridTemplateColumns: "18px minmax(0,1fr) auto", alignItems: "center", gap: 8, textAlign: "left", cursor: "pointer" }}
      >
        <span data-action-item-color-swatch="true" aria-hidden="true" style={actionItemColorSwatchStyle(actionItemColorFill(value, currentOption?.color))} />
        <span>{selectedLabel}</span>
        <span aria-hidden="true" style={{ color: "#64748b", fontSize: 10 }}>⌄</span>
      </button>
      {open && (
        <div id={`${id}-options`} role="listbox" aria-label="Action Item color options" style={actionItemPickerMenuStyle}>
          {options.map((option) => (
            <button
              key={option.key || "no-color"}
              type="button"
              role="option"
              aria-selected={option.key === value}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(option.key); setOpen(false); }}
              style={actionItemPickerOptionStyle}
            >
              <span data-action-item-color-option-swatch={option.key || "none"} aria-hidden="true" style={actionItemColorSwatchStyle(actionItemColorFill(option.key, option.color))} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
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

function ReadOnlyEntityValue({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div style={compact ? compactReadOnlyFieldStyle : readOnlyFieldStyle}>
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
const actionItemHeaderStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto auto", alignItems: "center", gap: 9, padding: "11px 12px", borderBottom: "1px solid rgba(148,163,184,.22)", background: "linear-gradient(135deg,rgba(254,252,232,.98),rgba(255,255,255,.98))" };
const actionItemIconBadgeStyle = (color: string | null): React.CSSProperties => ({ width: 30, height: 30, display: "inline-grid", placeItems: "center", border: "1px solid rgba(15,23,42,.24)", borderRadius: 8, background: color === "yellow" ? "#facc15" : color === "red" ? "#ef4444" : "#f8fafc", color: "#111827" });
const actionItemCloseButtonStyle: React.CSSProperties = { width: 30, height: 30, border: "1px solid rgba(185,28,28,.36)", borderRadius: 8, background: "#fee2e2", color: "#b91c1c", cursor: "pointer", fontSize: 18, fontWeight: 900, lineHeight: 1 };
const actionItemMetadataCardStyle: React.CSSProperties = { display: "grid", gap: 8, padding: 10, border: "1px solid rgba(148,163,184,.22)", borderRadius: 10, background: "#f8fafc" };
const actionItemPickerMenuStyle: React.CSSProperties = { position: "absolute", zIndex: 4, left: 0, right: 0, top: "calc(100% + 4px)", maxHeight: 190, overflowY: "auto", display: "grid", gap: 3, padding: 5, border: "1px solid rgba(148,163,184,.34)", borderRadius: 9, background: "#ffffff", boxShadow: "0 12px 28px rgba(15,23,42,.18)" };
const actionItemPickerOptionStyle: React.CSSProperties = { width: "100%", minWidth: 0, minHeight: 32, display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", alignItems: "center", gap: 8, border: 0, borderRadius: 7, background: "transparent", color: "#0f172a", padding: "4px 7px", font: "inherit", fontSize: 11, fontWeight: 750, cursor: "pointer", textAlign: "left" };
const actionItemPersonAvatarStyle: React.CSSProperties = { width: 24, height: 24, display: "grid", placeItems: "center", borderRadius: 999, background: "#ccfbf1", color: "#115e59", fontSize: 10, fontWeight: 900 };
const actionItemColorSwatchStyle = (fill: string): React.CSSProperties => ({ width: 18, height: 18, display: "block", border: "1px solid rgba(15,23,42,.3)", borderRadius: 4, background: fill, boxShadow: "inset 0 1px 0 rgba(255,255,255,.55)" });
const editorLabelStyle: React.CSSProperties = { display: "grid", gap: 5, color: "#475569", fontSize: 11, fontWeight: 850 };
const editorInputStyle: React.CSSProperties = { width: "100%", minWidth: 0, minHeight: 34, boxSizing: "border-box", border: "1px solid rgba(148,163,184,.32)", borderRadius: 8, background: "#fff", color: "#0f172a", padding: "0 9px", font: "inherit", fontSize: 12 };
const saveButtonStyle = (disabled: boolean): React.CSSProperties => ({ minHeight: 32, border: 0, borderRadius: 8, background: disabled ? "#cbd5e1" : "#0f766e", color: "#fff", padding: "0 12px", font: "inherit", fontSize: 11, fontWeight: 850, cursor: disabled ? "default" : "pointer" });
const fieldListStyle: React.CSSProperties = { display: "grid", gap: 9 };
const readOnlyFieldStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px,.8fr) minmax(0,1.2fr) 58px", alignItems: "center", gap: 10, padding: "9px 11px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" };
const compactReadOnlyFieldStyle: React.CSSProperties = { display: "grid", gap: 4, padding: "8px 9px", border: "1px solid rgba(148,163,184,.18)", borderRadius: 8, background: "#fff" };
const editableFieldStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(120px,.8fr) minmax(0,1.2fr) 58px", alignItems: "center", gap: 10, padding: "9px 11px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc" };
const fieldNameStyle: React.CSSProperties = { color: "#475569", fontSize: 11, fontWeight: 800 };
const readOnlyTextStyle: React.CSSProperties = { minWidth: 0, overflowWrap: "anywhere", fontSize: 12 };
const fieldSaveButtonStyle = (disabled: boolean): React.CSSProperties => ({ minHeight: 30, border: "1px solid rgba(15,118,110,.28)", borderRadius: 7, background: disabled ? "#e2e8f0" : "#fff", color: disabled ? "#94a3b8" : "#0f766e", padding: "0 8px", font: "inherit", fontSize: 10, fontWeight: 850, cursor: disabled ? "default" : "pointer" });
const saveErrorStyle: React.CSSProperties = { padding: "8px 10px", border: "1px solid rgba(239,68,68,.24)", borderRadius: 9, background: "#fef2f2", color: "#991b1b", fontSize: 11, fontWeight: 750 };
const emptyFieldsStyle: React.CSSProperties = { padding: "10px 12px", border: "1px solid rgba(148,163,184,.2)", borderRadius: 10, background: "#f8fafc", color: "#94a3b8", fontSize: 12 };

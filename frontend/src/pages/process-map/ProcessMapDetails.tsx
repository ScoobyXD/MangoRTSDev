import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createRequestJSON } from "../../modules/api/requestJSON.js";
import { listCompanyUsers, type CompanyUser } from "../../modules/communications/communicationsApi.js";
import { LogicGateTiptapEditorSurface } from "../../modules/editor/LogicGateTiptapEditorSurface.js";
import { selectCurrentEditorTextProjection } from "../../modules/editor/editorProjection.js";
import { flushMangoTiptapResource } from "../../modules/editor/tiptap/mangoTiptapFlushRegistry.js";
import type { MangoTiptapDocument } from "../../modules/editor/tiptap/mangoTiptapDocument.js";
import { editorSaveNeedsFailureAttention, type EditorSaveState } from "../../modules/editor/EditorSaveStatusIcon.js";
import { getLogicGateInformationProjectionSingleFlight, getLogicGateRecordSingleFlight, invalidateLogicGateRecordStoreCaches } from "../../modules/logic-gates/logicGateRecordStore.js";
import { canEditResourceAccess } from "../../modules/nodes/types.js";
import type { ProcessStep } from "../../modules/kanban/processWork.js";
import type { ProcessStepEditorPlacement } from "../../modules/editor/ProcessStepInstructionEditor.js";
import "./processMapDetails.css";

export type ProcessMapDetailsContents = { editor_document?: MangoTiptapDocument };

export type ProcessMapDetailsProps = {
  apiBase: string;
  companyID: string;
  processID: string;
  isNew?: boolean;
  canEdit?: boolean;
  disabled?: boolean;
  refreshVersion?: number;
  onChange?: (contents: ProcessMapDetailsContents) => void;
  onBusyChange?: (busy: boolean) => void;
  steps?: readonly ProcessStep[];
  onStepBodyChange?: (stepID: string, body: MangoTiptapDocument) => void;
  focusStepID?: string;
  editorWidth: number;
  onEditorWidthChange: (width: number) => void;
  stepEditorPlacement?: ProcessStepEditorPlacement | null;
  onStepEditorReturn?: () => void;
};

export function ProcessMapDetails({ apiBase, companyID, processID, isNew = false, canEdit = true, disabled = false, refreshVersion = 0, onChange, onBusyChange, steps, onStepBodyChange, focusStepID, editorWidth, onEditorWidthChange, stepEditorPlacement, onStepEditorReturn }: ProcessMapDetailsProps) {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [resourceCanEdit, setResourceCanEdit] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [retrying, setRetrying] = useState(false);
  const [documentID, setDocumentID] = useState(isNew ? "logic-gate-overview" : "");
  const [editorState, setEditorState] = useState<EditorSaveState>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [section, setSection] = useState<"overview" | "steps">(focusStepID ? "steps" : "overview");
  const [collapsed, setCollapsed] = useState(false);
  const panelID = useId();
  const panelRef = useRef<HTMLElement>(null);
  const resize = useRef<{ pointerID: number; startX: number; width: number } | null>(null);
  const clampWidth = (width: number) => Math.min(Math.max(240, width), Math.max(240, (panelRef.current?.closest(".process-map-workspace")?.getBoundingClientRect().width || window.innerWidth) - 336));
  const contents = useRef<ProcessMapDetailsContents>({});
  const live = useRef(true);
  const changeCallback = useRef(onChange);
  const busyCallback = useRef(onBusyChange);
  changeCallback.current = onChange;
  busyCallback.current = onBusyChange;

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; busyCallback.current?.(false); };
  }, []);
  useEffect(() => {
    // Failure badges persist for the page session; navigation flushes the actual editor work.
    onBusyChange?.(loading || retrying || (!isNew && (editorState?.status === "pending" || editorState?.status === "saving")));
  }, [loading, retrying, editorState, isNew, onBusyChange]);
  useEffect(() => { if (focusStepID) setSection("steps"); }, [focusStepID]);

  useEffect(() => {
    let current = true;
    void listCompanyUsers(companyID).then((next) => { if (current) setUsers(next); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Could not load people for mentions."); });
    return () => { current = false; };
  }, [companyID, retry]);

  useEffect(() => {
    if (isNew) return;
    let current = true;
    setLoading(true);
    void Promise.all([
      getLogicGateRecordSingleFlight(apiBase, companyID, processID),
      getLogicGateInformationProjectionSingleFlight(apiBase, companyID, processID),
    ]).then(([record, projections]) => {
      if (!current) return;
      setResourceCanEdit(canEditResourceAccess(record));
      setDocumentID(selectCurrentEditorTextProjection(projections)?.information_id || "logic-gate-overview");
      setError("");
    }).catch((cause) => {
      if (!current) return;
      setResourceCanEdit(false);
      setDocumentID("");
      setError(cause instanceof Error ? cause.message : "Could not load the Process editor.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [apiBase, companyID, isNew, processID, refreshVersion, retry]);

  const writeEnabled = canEdit && resourceCanEdit && !disabled && !loading && !retrying;
  const publish = useCallback((document: MangoTiptapDocument) => {
    contents.current = { editor_document: document };
    changeCallback.current?.(contents.current);
  }, []);
  const retryFailedOperation = async () => {
    if (!isNew && editorSaveNeedsFailureAttention(editorState)) {
      setRetrying(true);
      try {
        await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID });
        if (live.current) setError("");
      } catch (cause) {
        if (live.current) setError(cause instanceof Error ? cause.message : "Could not save the Process editor.");
      } finally {
        if (live.current) setRetrying(false);
      }
      return;
    }
    if (!isNew) invalidateLogicGateRecordStoreCaches(apiBase, companyID, processID);
    setError("");
    setRetry((value) => value + 1);
  };
  return <aside ref={panelRef} className={`process-map-details${collapsed ? " is-collapsed" : ""}`} aria-label="Process editor panel">
    <div hidden={collapsed} className="process-map-details__resize" role="separator" aria-label="Resize Process editor" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={clampWidth(Infinity)} aria-valuenow={clampWidth(editorWidth)} tabIndex={0}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        resize.current = { pointerID: event.pointerId, startX: event.clientX, width: panelRef.current?.getBoundingClientRect().width || editorWidth };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const drag = resize.current;
        if (drag?.pointerID === event.pointerId) onEditorWidthChange(clampWidth(drag.width + drag.startX - event.clientX));
      }}
      onPointerUp={(event) => {
        if (resize.current?.pointerID !== event.pointerId) return;
        resize.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={(event) => {
        if (resize.current?.pointerID !== event.pointerId) return;
        onEditorWidthChange(resize.current.width);
        resize.current = null;
      }}
      onLostPointerCapture={() => { resize.current = null; }}
      onKeyDown={(event) => {
        const width = panelRef.current?.getBoundingClientRect().width || editorWidth;
        const next = event.key === "ArrowLeft" ? width + 24 : event.key === "ArrowRight" ? width - 24 : event.key === "Home" ? 240 : event.key === "End" ? Infinity : null;
        if (next === null) return;
        event.preventDefault();
        onEditorWidthChange(clampWidth(next));
      }} />
    <header className="process-map-details__heading">
      <button type="button" className="process-map-details__collapse" aria-label={collapsed ? "Expand Process editor" : "Collapse Process editor"} title={collapsed ? "Expand Process editor" : "Collapse Process editor"} aria-expanded={!collapsed} aria-controls={panelID} onClick={() => setCollapsed((value) => !value)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={collapsed ? "M19 12H5m7-7-7 7 7 7" : "M5 12h14m-7-7 7 7-7 7"} /></svg>
      </button>
      <nav hidden={collapsed} className="process-map-details__tabs" aria-label="Process editor sections">
        <button type="button" aria-controls={panelID} aria-pressed={section === "overview"} onClick={() => setSection("overview")}>Editor</button>
        <button type="button" aria-controls={panelID} aria-pressed={section === "steps"} onClick={() => setSection("steps")}>Steps</button>
      </nav>
      <span hidden={collapsed}>{isNew ? "Draft" : canEdit && resourceCanEdit ? "Autosave" : "Read only"}</span>
    </header>
    {error && <div hidden={collapsed} role="alert" className="process-map-details__error">{error} <button type="button" disabled={retrying || loading} onClick={() => { void retryFailedOperation(); }}>Retry</button></div>}
    <section hidden={collapsed} id={panelID} className="process-map-details__editor" aria-label="Process SOP editor">
      {loading && !documentID && <div role="status" className="process-map-details__loading">Loading editor…</div>}
      {documentID && <Suspense fallback={<div role="status" className="process-map-details__loading">Loading editor…</div>}>
        <LogicGateTiptapEditorSurface key={`${processID}:${documentID}`} apiBase={apiBase} companyID={companyID} resourceID={processID} documentID={documentID}
          section={section} focusInformationID={section === "steps" ? focusStepID : undefined}
          steps={steps} onStepBodyChange={onStepBodyChange}
          stepEditorPlacement={stepEditorPlacement} onStepEditorReturn={onStepEditorReturn}
          dataAttributes={{ "data-process-sop-document-id": documentID }}
          value={isNew && contents.current.editor_document ? JSON.stringify(contents.current.editor_document) : undefined}
          saveMode={isNew ? "local" : "server"} requestJSON={requestJSON} editable={writeEnabled}
          mentionUsers={users}
          onDocumentSnapshotChange={isNew ? publish : undefined}
          onSaveStateChange={setEditorState} onError={setError}
          attachmentContext={isNew ? undefined : { apiBase, companyID, resourceType: "logic_gate", resourceID: processID, informationID: documentID, editorSurface: "logic_gate_editor", requestJSON, onError: setError }}
          className="process-map-details__document" placeholder="Write your SOP…" />
      </Suspense>}
    </section>
  </aside>;
}

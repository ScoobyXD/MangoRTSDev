import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createRequestJSON } from "../../modules/api/requestJSON.js";
import { listCompanyUsers, type CompanyUser } from "../../modules/communications/communicationsApi.js";
import { LogicGateTiptapEditorSurface } from "../../modules/editor/LogicGateTiptapEditorSurface.js";
import { selectCurrentEditorTextProjection } from "../../modules/editor/editorProjection.js";
import { flushMangoTiptapResource } from "../../modules/editor/tiptap/mangoTiptapFlushRegistry.js";
import type { MangoTiptapDocument } from "../../modules/editor/tiptap/mangoTiptapDocument.js";
import { editorSaveNeedsFailureAttention, type EditorSaveState } from "../../modules/editor/EditorSaveStatusIcon.js";
import { BareMangoEditorToolbar, useBareMangoEditorControls } from "../../modules/huddles/BareMangoEditor.js";
import { getLogicGateInformationProjectionSingleFlight, getLogicGateRecordSingleFlight, invalidateLogicGateRecordStoreCaches } from "../../modules/logic-gates/logicGateRecordStore.js";
import { canEditResourceAccess } from "../../modules/nodes/types.js";
import type { EditorTabID } from "../../modules/editor/editorTabs.js";
import type { ProcessStep } from "../../modules/kanban/processWork.js";
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
};

export function ProcessMapDetails({ apiBase, companyID, processID, isNew = false, canEdit = true, disabled = false, refreshVersion = 0, onChange, onBusyChange, steps, onStepBodyChange, focusStepID }: ProcessMapDetailsProps) {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [resourceCanEdit, setResourceCanEdit] = useState(isNew);
  const [loading, setLoading] = useState(!isNew);
  const [retrying, setRetrying] = useState(false);
  const [documentID, setDocumentID] = useState(isNew ? "logic-gate-overview" : "");
  const [editorState, setEditorState] = useState<EditorSaveState>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editorTab, setEditorTab] = useState<EditorTabID>("editor");
  const [section, setSection] = useState<"overview" | "steps">(focusStepID ? "steps" : "overview");
  const controls = useBareMangoEditorControls();
  const panelID = useId();
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
  return <aside className="process-map-details" aria-label="Process editor panel">
    <header className="process-map-details__heading"><h2>{section === "steps" ? "Steps" : "Process editor"}</h2><span>{isNew ? "Draft" : canEdit && resourceCanEdit ? "Autosave" : "Read only"}</span></header>
    {error && <div role="alert" className="process-map-details__error">{error} <button type="button" disabled={retrying || loading} onClick={() => { void retryFailedOperation(); }}>Retry</button></div>}
    <section id={panelID} className="process-map-details__editor" aria-label="Process SOP editor">
      <BareMangoEditorToolbar controls={controls} visibleTabIDs={["format", "outline-styles"]} activeTab={editorTab} onSelectTab={setEditorTab} formattingDisabled={!writeEnabled} />
      {loading && !documentID && <div role="status" className="process-map-details__loading">Loading editor…</div>}
      {documentID && <Suspense fallback={<div role="status" className="process-map-details__loading">Loading editor…</div>}>
        <LogicGateTiptapEditorSurface key={`${processID}:${documentID}`} apiBase={apiBase} companyID={companyID} resourceID={processID} documentID={documentID}
          section={section} focusInformationID={section === "steps" ? focusStepID : undefined}
          steps={steps} onStepBodyChange={onStepBodyChange}
          dataAttributes={{ "data-process-sop-document-id": documentID }}
          value={isNew && contents.current.editor_document ? JSON.stringify(contents.current.editor_document) : undefined}
          saveMode={isNew ? "local" : "server"} requestJSON={requestJSON} editable={writeEnabled}
          outlineStyle={controls.outlineStyle} formattingControllerRef={controls.controllerRef} mentionUsers={users}
          onSelectionFontSizeChange={controls.setFontSize} onSelectionInlineFormatChange={controls.setInline}
          onSelectionHighlightColorChange={controls.setHighlight} onSelectionTextAlignmentChange={controls.setAlignment}
          onDocumentSnapshotChange={isNew ? publish : undefined}
          onSaveStateChange={setEditorState} onError={setError}
          attachmentContext={isNew ? undefined : { apiBase, companyID, resourceType: "logic_gate", resourceID: processID, informationID: documentID, editorSurface: "logic_gate_editor", requestJSON, onError: setError }}
          className="process-map-details__document" placeholder="Write your SOP…" />
      </Suspense>}
    </section>
    <nav className="process-map-details__tabs" aria-label="Process editor sections">
      <button type="button" aria-controls={panelID} aria-pressed={section === "overview"} onClick={() => setSection("overview")}>Editor</button>
      <button type="button" aria-controls={panelID} aria-pressed={section === "steps"} onClick={() => setSection("steps")}>Steps</button>
    </nav>
  </aside>;
}

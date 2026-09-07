import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MangoTiptapEditorProps } from "./tiptap/MangoTiptapEditor.js";
import type { MangoTiptapDocument } from "./tiptap/mangoTiptapDocument.js";
import { mangoTiptapPendingStorageKey, type MangoTiptapSaveState } from "./tiptap/mangoTiptapSync.js";
import { EditorSaveStatusIcon, editorSaveNeedsFailureAttention } from "./EditorSaveStatusIcon.js";
import { APIHTTPError, isAbortError } from "../api/requestJSON.js";
import { clearProcessWorkCache, getCachedProcessWork, getProcessWorkSingleFlight, invalidateLogicGateArenaViewCache, PROCESS_WORK_UPDATED_EVENT } from "../kanban/kanbanApi.js";
import { orderedProcessSteps, type ProcessStep, type ProcessWorkSnapshot } from "../kanban/processWork.js";
import { createCoalescedCanonicalRefresh } from "../realtime/coalescedCanonicalRefresh.js";
import { subscribeRealtimeScope } from "../realtime/realtimeWebSocket.js";
import { scheduleTransientInformationFocus } from "./transientInformationFocus.js";
import "./processStepInstructions.css";

const LazyMangoTiptapEditor = React.lazy(async () => {
  const module = await import("./tiptap/MangoTiptapEditor.js");
  return { default: module.MangoTiptapEditor };
});

export type LogicGateTiptapEditorSurfaceProps = Omit<MangoTiptapEditorProps, "resourceType" | "ariaLabel"> & {
  apiBase: string;
  steps?: readonly ProcessStep[];
  onStepBodyChange?: (stepID: string, body: MangoTiptapDocument) => void;
  section?: "overview" | "steps";
  focusInformationID?: string;
  focusMentionUserID?: string;
  focusRequestID?: number;
};

export const LogicGateTiptapEditorSurface: React.FC<LogicGateTiptapEditorSurfaceProps> = ({
  apiBase, steps: localSteps, onStepBodyChange, section, focusInformationID, focusMentionUserID, focusRequestID,
  leadingContent, className, style, onSaveStateChange, onFocus, ...props
}) => {
  const { companyID, resourceID: processID, documentID, saveMode = "server" } = props;
  const [snapshot, setSnapshot] = useState<ProcessWorkSnapshot | null>(() => saveMode === "local" ? null : getCachedProcessWork(apiBase, companyID, processID)?.contents ?? null);
  const [loadError, setLoadError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [activeDocument, setActiveDocument] = useState(documentID);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const saveStates = useRef(new Map<string, MangoTiptapSaveState>());
  const mounted = useRef(true);
  const currentDocumentIDs = useRef<ReadonlySet<string>>(new Set([documentID]));
  const onSaveStateChangeRef = useRef(onSaveStateChange);
  onSaveStateChangeRef.current = onSaveStateChange;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (saveMode === "local") return;
    const controller = new AbortController();
    const refresh = createCoalescedCanonicalRefresh(async () => {
      const next = await getProcessWorkSingleFlight(apiBase, companyID, processID, controller.signal);
      if (!controller.signal.aborted) { setSnapshot(next); setLoadError(""); setUnavailable(false); }
    }, (cause) => {
      if (controller.signal.aborted || isAbortError(cause)) return;
      if (cause instanceof APIHTTPError && (cause.status === 403 || cause.status === 404)) {
        clearProcessWorkCache(apiBase, companyID, processID);
        setSnapshot(null);
        setUnavailable(true);
      }
      setLoadError("Could not load the Process steps. Reopen the Process to try again.");
    });
    const requestRefresh = () => { invalidateLogicGateArenaViewCache(apiBase, companyID, processID); refresh.request(); };
    const onWorkChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ companyID: string; logicGateID: string }>).detail;
      if (detail?.companyID === companyID && detail.logicGateID === processID) requestRefresh();
    };
    const unsubscribe = subscribeRealtimeScope(apiBase, companyID, `process:${processID}`, {
      onAccepted: requestRefresh,
      onProcessWorkChanged: requestRefresh,
      onRejected: () => {
        controller.abort(); refresh.dispose(); clearProcessWorkCache(apiBase, companyID, processID);
        setSnapshot(null); setUnavailable(true); setLoadError("This Process is unavailable.");
      },
    });
    window.addEventListener(PROCESS_WORK_UPDATED_EVENT, onWorkChanged);
    refresh.request();
    return () => { controller.abort(); refresh.dispose(); unsubscribe(); window.removeEventListener(PROCESS_WORK_UPDATED_EVENT, onWorkChanged); };
  }, [apiBase, companyID, processID, saveMode]);

  const steps = useMemo(() => orderedProcessSteps(saveMode === "local" ? localSteps ?? [] : snapshot?.steps ?? []), [localSteps, saveMode, snapshot?.steps]);
  const documentIDs = useMemo(() => new Set([documentID, ...steps.map((step) => step.process_step_id)]), [documentID, steps]);
  currentDocumentIDs.current = documentIDs;
  const informationID = focusInformationID?.trim() ?? "";
  const focusDocumentAvailable = !unavailable && documentIDs.has(informationID);
  useEffect(() => {
    if (!focusDocumentAvailable) return undefined;
    return scheduleTransientInformationFocus({ root: () => rootRef.current, informationID, mentionUserID: focusMentionUserID });
  }, [focusDocumentAvailable, focusMentionUserID, focusRequestID, informationID, processID]);
  const isCurrentDocument = useCallback((id: string) => mounted.current && currentDocumentIDs.current.has(id), []);
  const publishSaveState = useCallback(() => {
    if (!mounted.current) return;
    const states = [...saveStates.current.values()];
    const combined = states.find(editorSaveNeedsFailureAttention)
      ?? states.find((entry) => entry.status === "saving")
      ?? states.find((entry) => entry.status === "pending")
      ?? { status: "saved" as const };
    onSaveStateChangeRef.current?.(combined);
  }, []);
  const reportSaveState = useCallback((id: string, state: MangoTiptapSaveState) => {
    if (!isCurrentDocument(id)) return;
    // A failed save stays visible until its section is removed, just as in the shared editor.
    if (!editorSaveNeedsFailureAttention(saveStates.current.get(id))) saveStates.current.set(id, state);
    publishSaveState();
  }, [isCurrentDocument, publishSaveState]);
  useEffect(() => {
    for (const id of saveStates.current.keys()) if (!documentIDs.has(id)) saveStates.current.delete(id);
    setActiveDocument((current) => documentIDs.has(current) ? current : documentID);
    publishSaveState();
  }, [documentID, documentIDs, publishSaveState]);
  useEffect(() => {
    if (section === "overview") setActiveDocument(documentID);
    else if (section === "steps") setActiveDocument((current) => current !== documentID && documentIDs.has(current) ? current : steps[0]?.process_step_id ?? documentID);
  }, [section, documentID, documentIDs, steps]);
  const attachmentContext = props.attachmentContext ?? {
    apiBase, companyID, resourceType: "logic_gate" as const, resourceID: processID, informationID: documentID,
    editorSurface: "logic_gate_editor" as const, requestJSON: props.requestJSON, onError: props.onError,
  };
  const formattingProps = {
    outlineStyle: props.outlineStyle,
    formattingControllerRef: props.formattingControllerRef,
    onSelectionFontSizeChange: props.onSelectionFontSizeChange,
    onSelectionInlineFormatChange: props.onSelectionInlineFormatChange,
    onSelectionHighlightColorChange: props.onSelectionHighlightColorChange,
    onSelectionTextAlignmentChange: props.onSelectionTextAlignmentChange,
  };
  const canEdit = props.editable !== false && (saveMode === "local" || snapshot?.permissions.can_edit === true);
  const documentCallbacks = (id: string) => ({
    onError: (message: string) => { if (isCurrentDocument(id)) props.onError?.(message); },
    onRecoveryStorageError: (message: string) => { if (isCurrentDocument(id)) props.onRecoveryStorageError?.(message); },
    onRecoveryStorageRecovered: () => { if (isCurrentDocument(id)) props.onRecoveryStorageRecovered?.(); },
    onSaveStateChange: (state: MangoTiptapSaveState) => reportSaveState(id, state),
  });

  if (unavailable) return <div className="mango-process-instructions" style={style}><div role="alert" className="mango-process-instructions__error">This Process is unavailable.</div></div>;

  return <div ref={rootRef} className={["mango-process-instructions", className].filter(Boolean).join(" ")} style={style} data-process-editor-section={section}>
    {leadingContent}
    <div hidden={section === "steps"}>
    <LazyMangoTiptapEditor {...props} resourceType="logic_gate" ariaLabel="Process editor"
      {...documentCallbacks(documentID)}
      editable={canEdit}
      formattingControllerActive={section !== "steps" && activeDocument === documentID}
      onFocus={() => { setActiveDocument(documentID); onFocus?.(); }} />
    </div>
    {loadError && <div role="alert" className="mango-process-instructions__error">{loadError}</div>}
    {saveMode !== "local" && !snapshot && !loadError && <div role="status" className="mango-process-instructions__loading">Loading steps…</div>}
    <div className="mango-process-instructions__steps" hidden={section === "overview"}>
      {section === "steps" && steps.length === 0 && <p className="mango-process-instructions__loading">Start this process with a right-click or by pressing the plus button.</p>}
      {steps.map((step, index) => <section key={step.process_step_id} className="mango-process-instructions__step" aria-label={`Step ${index + 1}: ${step.name}`} data-process-step-id={step.process_step_id}>
        <div className="mango-process-instructions__heading">
          <h3><span className="mango-process-instructions__number">{index + 1}</span>{step.name}</h3>
          {saveMode !== "local" && <EditorSaveStatusIcon compact storageKey={mangoTiptapPendingStorageKey({ companyID, resourceType: "process_step", resourceID: step.process_step_id, documentID: step.process_step_id })} />}
        </div>
        <LazyMangoTiptapEditor {...formattingProps}
          companyID={companyID} resourceType="process_step" resourceID={step.process_step_id} documentID={step.process_step_id}
          currentUserID={props.currentUserID} requestJSON={props.requestJSON} saveMode={saveMode}
          value={step.body_json ? JSON.stringify(step.body_json) : undefined}
          editable={canEdit}
          ariaLabel="Step instructions" placeholder="Write instructions for this step…"
          style={{ minHeight: 112 }} attachmentContext={attachmentContext} mentionUsers={props.mentionUsers}
          formattingControllerActive={section !== "overview" && activeDocument === step.process_step_id}
          onFocus={() => { setActiveDocument(step.process_step_id); onFocus?.(); }}
          {...documentCallbacks(step.process_step_id)}
          onEntityLink={props.onEntityLink} onEntityOpen={props.onEntityOpen}
          onDocumentSnapshotChange={saveMode === "local" ? (document) => onStepBodyChange?.(step.process_step_id, document) : undefined}
        />
      </section>)}
    </div>
  </div>;
};

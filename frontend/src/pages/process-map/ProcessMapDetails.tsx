import { Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { APIHTTPError, createRequestJSON } from "../../modules/api/requestJSON.js";
import { listCompanyUserGroups, listCompanyUsers, patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache, type CompanyUser, type CompanyUserGroupsResponse } from "../../modules/communications/communicationsApi.js";
import { RACIAssignmentBoard } from "../../modules/editor/EditorLinkedDocumentPanels.js";
import { LogicGateTiptapEditorSurface } from "../../modules/editor/LogicGateTiptapEditorSurface.js";
import { selectCurrentEditorTextProjection } from "../../modules/editor/editorProjection.js";
import { saveEditorResourceRACI, toResourceRACIAssignmentInput } from "../../modules/editor/resourceRACI.js";
import { flushMangoTiptapResource } from "../../modules/editor/tiptap/mangoTiptapFlushRegistry.js";
import type { MangoTiptapDocument } from "../../modules/editor/tiptap/mangoTiptapDocument.js";
import { editorSaveNeedsFailureAttention, type EditorSaveState } from "../../modules/editor/EditorSaveStatusIcon.js";
import { BareMangoEditorToolbar, useBareMangoEditorControls } from "../../modules/huddles/BareMangoEditor.js";
import { getLogicGateInformationProjectionSingleFlight, getLogicGateRecordSingleFlight, invalidateLogicGateRecordStoreCaches, patchLogicGateRecordStoreRACIAssignments } from "../../modules/logic-gates/logicGateRecordStore.js";
import { logicGateDisplayRACIAssignments, type LogicGateResourceRACIPayload } from "../../modules/logic-gates/raciPresentation.js";
import type { LogicGateRACIAssignment, LogicGateRACIPrincipalType, LogicGateRACIRole } from "../../modules/logic-gates/types.js";
import { canEditResourceAccess } from "../../modules/nodes/types.js";
import type { EditorTabID } from "../../modules/editor/editorTabs.js";
import "./processMapDetails.css";

export type ProcessMapDetailsContents = {
  gvic_assignments?: ReturnType<typeof toResourceRACIAssignmentInput>[];
  editor_document?: MangoTiptapDocument;
};

export type ProcessMapDetailsProps = {
  apiBase: string;
  companyID: string;
  processID: string;
  isNew?: boolean;
  folderID?: string;
  canEdit?: boolean;
  disabled?: boolean;
  refreshVersion?: number;
  onChange?: (contents: ProcessMapDetailsContents) => void;
  onBusyChange?: (busy: boolean) => void;
};

export function ProcessMapDetails({ apiBase, companyID, processID, isNew = false, folderID = "", canEdit = true, disabled = false, refreshVersion = 0, onChange, onBusyChange }: ProcessMapDetailsProps) {
  const requestJSON = useMemo(() => createRequestJSON(apiBase), [apiBase]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [groups, setGroups] = useState<CompanyUserGroupsResponse>({ groups: [], members: [] });
  const [policy, setPolicy] = useState<LogicGateResourceRACIPayload | null>(null);
  const [localAssignments, setLocalAssignments] = useState<LogicGateRACIAssignment[] | undefined>();
  const [resourceCanEdit, setResourceCanEdit] = useState(isNew);
  const [loading, setLoading] = useState(true);
  const [directoryReady, setDirectoryReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [documentID, setDocumentID] = useState("");
  const [editorState, setEditorState] = useState<EditorSaveState>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [editorTab, setEditorTab] = useState<EditorTabID>("editor");
  const controls = useBareMangoEditorControls();
  const panelID = useId();
  const contents = useRef<ProcessMapDetailsContents>({});
  const live = useRef(true);
  const mutationPending = useRef(false);
  const policyScope = useRef("");
  const policyMutationVersion = useRef(0);
  const changeCallback = useRef(onChange);
  const busyCallback = useRef(onBusyChange);
  changeCallback.current = onChange;
  busyCallback.current = onBusyChange;

  useEffect(() => {
    live.current = true;
    return () => { live.current = false; busyCallback.current?.(false); };
  }, []);
  useEffect(() => {
    onBusyChange?.(loading || saving || editorLoading || (!isNew && (editorState?.status === "pending" || editorState?.status === "saving" || editorSaveNeedsFailureAttention(editorState))));
  }, [loading, saving, editorLoading, editorState, isNew, onBusyChange]);

  useEffect(() => {
    let current = true;
    setDirectoryReady(false);
    void Promise.all([listCompanyUsers(companyID), listCompanyUserGroups(companyID)]).then(([nextUsers, nextGroups]) => {
      if (!current) return;
      setUsers(nextUsers);
      setGroups(nextGroups);
      setDirectoryReady(true);
    }).catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : "Could not load people and teams."); });
    return () => { current = false; };
  }, [companyID, retry]);

  useEffect(() => {
    let current = true;
    const mutationVersion = policyMutationVersion.current;
    const resourceType = isNew ? "company_explorer_folder" : "logic_gate";
    const resourceID = isNew ? folderID : processID;
    const scope = `${apiBase}:${companyID}:${resourceType}:${resourceID}`;
    if (policyScope.current !== scope) {
      policyScope.current = scope;
      setLoading(true);
      setPolicy(null);
      setError("");
    }
    if (!resourceID) {
      setLoading(false);
      return () => { current = false; };
    }
    const access = isNew ? Promise.resolve(true) : getLogicGateRecordSingleFlight(apiBase, companyID, processID).then(canEditResourceAccess);
    void Promise.all([
      requestJSON<LogicGateResourceRACIPayload>(`/v1/resources/${resourceType}/${encodeURIComponent(resourceID)}/gvic?company_id=${encodeURIComponent(companyID)}`),
      access,
    ]).then(([nextPolicy, editable]) => {
      if (!current || mutationVersion !== policyMutationVersion.current) return;
      setPolicy(nextPolicy);
      setResourceCanEdit(editable);
    }).catch((cause) => {
      if (!current) return;
      setPolicy(null);
      setResourceCanEdit(false);
      if (!isNew) setEditorOpen(false);
      setError(cause instanceof Error ? cause.message : "Could not load Process assignments.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [apiBase, companyID, folderID, isNew, processID, refreshVersion, requestJSON, retry]);

  const displayedAssignments = localAssignments ?? (policy ? logicGateDisplayRACIAssignments(policy) : []);
  const writeEnabled = canEdit && resourceCanEdit && !disabled && !loading && !saving;
  const publish = useCallback((update: ProcessMapDetailsContents) => {
    contents.current = { ...contents.current, ...update };
    changeCallback.current?.(contents.current);
  }, []);
  const saveAssignments = async (next: LogicGateRACIAssignment[]) => {
    if (!writeEnabled || !policy || mutationPending.current) return;
    if (isNew) {
      setLocalAssignments(next);
      publish({ gvic_assignments: next.map(toResourceRACIAssignmentInput) });
      return;
    }
    mutationPending.current = true;
    policyMutationVersion.current += 1;
    setSaving(true);
    setError("");
    try {
      const updated = await saveEditorResourceRACI({ apiBase, companyID, resourceType: "logic_gate", resourceID: processID, assignments: next, assignmentMode: "customized", revision: policy.revision, requestJSON });
      if (!live.current) return;
      policyMutationVersion.current += 1;
      setPolicy(updated);
      const assignments = logicGateDisplayRACIAssignments(updated);
      patchLogicGateRecordStoreRACIAssignments(apiBase, companyID, processID, assignments);
      patchLogicGateRACIAssignmentsInCommunicationsWorkspaceCache(companyID, processID, assignments);
    } catch (cause) {
      if (!live.current) return;
      if (cause instanceof APIHTTPError && cause.status === 409) {
        try {
          const current = await requestJSON<LogicGateResourceRACIPayload>(`/v1/resources/logic_gate/${encodeURIComponent(processID)}/gvic?company_id=${encodeURIComponent(companyID)}`, { cache: "no-store" });
          if (!live.current) return;
          setPolicy(current);
          setError("Assignments changed elsewhere. Review the current assignments and try again.");
        } catch (refreshError) {
          if (!live.current) return;
          setPolicy(null);
          setResourceCanEdit(false);
          setEditorOpen(false);
          setError(refreshError instanceof Error ? refreshError.message : "Could not reload assignments.");
        }
      } else {
        if (cause instanceof APIHTTPError && [401, 403, 404].includes(cause.status)) {
          setPolicy(null);
          setResourceCanEdit(false);
          setEditorOpen(false);
        }
        setError(cause instanceof Error ? cause.message : "Could not save assignments.");
      }
    } finally {
      mutationPending.current = false;
      if (live.current) setSaving(false);
    }
  };
  const addPrincipal = (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    const user = users.find((item) => item.user_id === principalID);
    const group = groups.groups.find((item) => item.group_id === principalID);
    const next = displayedAssignments.filter((assignment) => {
      const principal = toResourceRACIAssignmentInput(assignment);
      return principal.principal_type !== principalType || principal.principal_id !== principalID;
    });
    void saveAssignments([...next, {
      company_id: companyID, logic_gate_id: processID, role, principal_type: principalType, principal_id: principalID,
      user_id: principalType === "user" ? principalID : "", user_display_name: user?.display_name, user_email: user?.email,
      principal_name: principalType === "group" ? group?.name : user?.display_name, created_timestamp: "",
    }]);
  };
  const removePrincipal = (role: LogicGateRACIRole, principalType: LogicGateRACIPrincipalType, principalID: string) => {
    void saveAssignments(displayedAssignments.filter((assignment) => {
      const principal = toResourceRACIAssignmentInput(assignment);
      return principal.role !== role || principal.principal_type !== principalType || principal.principal_id !== principalID;
    }));
  };
  const toggleEditor = async () => {
    if (disabled || editorLoading) return;
    setEditorLoading(true);
    try {
      if (editorOpen) {
        if (!isNew) await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID });
        if (live.current) setEditorOpen(false);
        return;
      }
      const projections = isNew ? [] : await getLogicGateInformationProjectionSingleFlight(apiBase, companyID, processID);
      if (!live.current) return;
      setDocumentID(selectCurrentEditorTextProjection(projections)?.information_id || "logic-gate-overview");
      setEditorOpen(true);
    } catch (cause) {
      if (live.current) setError(cause instanceof Error ? cause.message : "Could not open the Process editor.");
    } finally {
      if (live.current) setEditorLoading(false);
    }
  };
  const retryFailedOperation = async () => {
    if (!isNew && editorSaveNeedsFailureAttention(editorState)) {
      setEditorLoading(true);
      try {
        await flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: processID });
        if (live.current) setError("");
      } catch (cause) {
        if (live.current) setError(cause instanceof Error ? cause.message : "Could not save the Process editor.");
      } finally {
        if (live.current) setEditorLoading(false);
      }
      return;
    }
    if (!isNew) invalidateLogicGateRecordStoreCaches(apiBase, companyID, processID);
    setError("");
    setRetry((value) => value + 1);
  };
  return <div className="process-map-details" aria-label="Process assignments and editor">
    <RACIAssignmentBoard assignments={displayedAssignments} overwrittenByAncestor={isNew && localAssignments ? null : policy?.overwritten_by_ancestor}
      companyUsers={users} companyUserGroups={groups.groups} companyUserGroupMembers={groups.members}
      accent="#0f766e" panelBackground="#ffffff" ruleColor="#cbd5e1" canEdit={writeEnabled && directoryReady && Boolean(policy)}
      onAddPrincipal={addPrincipal} onRemovePrincipal={removePrincipal} />
    {error && <div role="alert" className="process-map-details__error">{error} <button type="button" disabled={saving || editorLoading} onClick={() => { void retryFailedOperation(); }}>Retry</button></div>}
    <button type="button" className="process-map-details__toggle" aria-expanded={editorOpen} aria-controls={panelID} disabled={disabled || editorLoading || (!isNew && (!policy || loading))} onClick={() => { void toggleEditor(); }}>
      <span aria-hidden="true">{editorOpen ? "⌃" : "⌄"}</span> Editor
    </button>
    {editorOpen && <section id={panelID} className="process-map-details__editor" aria-label="Process SOP editor">
      <BareMangoEditorToolbar controls={controls} activeTab={editorTab} onSelectTab={setEditorTab} formattingDisabled={!writeEnabled} />
      <Suspense fallback={<div role="status">Loading editor…</div>}>
        <LogicGateTiptapEditorSurface key={`${processID}:${documentID}`} companyID={companyID} resourceID={processID} documentID={documentID}
          dataAttributes={{ "data-process-sop-document-id": documentID }}
          value={isNew && contents.current.editor_document ? JSON.stringify(contents.current.editor_document) : undefined}
          saveMode={isNew ? "local" : "server"} requestJSON={requestJSON} editable={writeEnabled}
          outlineStyle={controls.outlineStyle} formattingControllerRef={controls.controllerRef} mentionUsers={users}
          onSelectionFontSizeChange={controls.setFontSize} onSelectionInlineFormatChange={controls.setInline}
          onSelectionHighlightColorChange={controls.setHighlight} onSelectionTextAlignmentChange={controls.setAlignment}
          onDocumentSnapshotChange={isNew ? (document) => publish({ editor_document: document }) : undefined}
          onSaveStateChange={setEditorState} onError={setError}
          attachmentContext={isNew ? undefined : { apiBase, companyID, resourceType: "logic_gate", resourceID: processID, informationID: documentID, editorSurface: "logic_gate_editor", requestJSON, onError: setError }}
          className="process-map-details__document" placeholder="Write your SOP…" />
      </Suspense>
    </section>}
  </div>;
}

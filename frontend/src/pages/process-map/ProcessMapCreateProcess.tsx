import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestJSON } from "../../modules/api/requestJSON.js";
import type { CompanyExplorerFolder } from "../../modules/folders/companyExplorerFolders.js";
import { ProcessStepMapEditor, type ProcessStepMapCommands } from "../../modules/kanban/ProcessStepMap.js";
import { completeStepMapLayout, type ProcessStepMapLayout } from "../../modules/kanban/processStepMapGeometry.js";
import type { ProcessStep, ProcessStepRelationship } from "../../modules/kanban/processWork.js";
import { createWorkspaceEntityBatchCommand } from "../../modules/workspace/workspaceEntityCommands.js";
import { ProcessMapDestinationPath, processMapFolderPath } from "./ProcessMapDestinationPath.js";
import { fetchHierarchyPath } from "../../modules/hierarchy/hierarchyPathApi.js";
import type { ProcessWorkSnapshot } from "../../modules/kanban/processWork.js";
import { ProcessMapActions } from "./ProcessMapActions.js";
import { ProcessMapDetails, type ProcessMapDetailsContents } from "./ProcessMapDetails.js";
import { emitDashboardEvent, EVENT_COMPANY_EXPLORER_FIND_REQUESTED } from "../../modules/dashboardEvents.js";
import type { CompanyExplorerWorkspaceEntityBatchResponse } from "../../modules/company-explorer/CompanyExplorerContentModel.js";
import type { MangoTiptapDocument } from "../../modules/editor/tiptap/mangoTiptapDocument.js";

type ProcessContents = { steps: ProcessStep[]; relationships: ProcessStepRelationship[]; layout: ProcessStepMapLayout };
export type SavedMapProcess = { processID: string; name: string; folderID: string };

export function ProcessMapCreateProcess({ apiBase, companyID, processID, firstStep, initialFolderID, folders, foldersLoading, active, onSaved, onBack, onBusyChange, hoverModeEnabled, onHoverModeChange }: {
  apiBase: string; companyID: string; processID: string; firstStep: boolean; initialFolderID: string;
  folders: CompanyExplorerFolder[]; foldersLoading: boolean; active: boolean;
  onSaved: (process: SavedMapProcess, response?: CompanyExplorerWorkspaceEntityBatchResponse) => void; onBack: () => void;
  onBusyChange: (busy: boolean) => void;
  hoverModeEnabled: boolean; onHoverModeChange: (enabled: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const filenameRef = useRef<HTMLButtonElement>(null);
  const [folderID, setFolderID] = useState(initialFolderID);
  const [contents, setContents] = useState<ProcessContents>(() => {
    const steps = firstStep ? [{ process_step_id: crypto.randomUUID(), logic_gate_id: processID, name: "New Step", position: 1000 }] : [];
    return { steps, relationships: [], layout: completeStepMapLayout({ revision: 0, steps: [], routes: [] }, steps, []) };
  });
  const current = useRef(contents);
  const updateStepBody = useCallback((stepID: string, body: MangoTiptapDocument) => {
    const next = { ...current.current, steps: current.current.steps.map((step) => step.process_step_id === stepID ? { ...step, body_json: body } : step) };
    current.current = next;
    setContents(next);
  }, []);
  const details = useRef<ProcessMapDetailsContents>({});
  const updateDetails = useCallback((next: ProcessMapDetailsContents) => { details.current = next; }, []);
  const [detailsBusy, setDetailsBusy] = useState(true);
  const [editorBusy, setEditorBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  const created = useRef(false);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => { if (!created.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { mounted.current = false; window.removeEventListener("beforeunload", warn); };
  }, []);
  useEffect(() => { onBusyChange(saving || editorBusy || detailsBusy); }, [onBusyChange, saving, editorBusy, detailsBusy]);
  // Folder creation can refresh the list without resetting the chosen destination.
  const destinationPath = processMapFolderPath(folders, folderID);
  const selectedFolder = destinationPath[destinationPath.length - 1];
  useEffect(() => {
    if (!folderID || !active || foldersLoading) return;
    const folderPathIDs = processMapFolderPath(folders, folderID).map((folder) => folder.folder_id);
    if (folderPathIDs.length) emitDashboardEvent(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, { companyID, sourceFrameID: "process-map", folderPathIDs, changedAt: Date.now() });
  }, [active, companyID, folderID, folders, foldersLoading]);
  const commands = useMemo<ProcessStepMapCommands>(() => {
    const update = (next: ProcessContents) => {
      next.layout = completeStepMapLayout(next.layout, next.steps, next.relationships);
      current.current = next;
      setContents(next);
    };
    return {
      readLayout: async () => current.current.layout,
      saveLayout: async (layout) => {
        update({ ...current.current, layout: { ...layout, revision: current.current.layout.revision + 1 } });
        return current.current.layout;
      },
      createStep: async (stepName) => {
        if (current.current.steps.length >= 200) throw new Error("A Process can contain up to 200 Steps when first saved.");
        const step: ProcessStep = { process_step_id: crypto.randomUUID(), logic_gate_id: processID, name: stepName, position: Math.max(0, ...current.current.steps.map((item) => item.position)) + 1000 };
        update({ ...current.current, steps: [...current.current.steps, step] });
        return { step };
      },
      renameStep: async (id, stepName) => {
        const step = current.current.steps.find((item) => item.process_step_id === id);
        if (!step) throw new Error("This Step is no longer in this Process.");
        const renamed = { ...step, name: stepName };
        update({ ...current.current, steps: current.current.steps.map((item) => item === step ? renamed : item) });
        return { step: renamed };
      },
      deleteStep: async (id) => update({ ...current.current, steps: current.current.steps.filter((item) => item.process_step_id !== id), relationships: current.current.relationships.filter((edge) => edge.source.resource_id !== id && edge.target.resource_id !== id) }),
      connectSteps: async (sourceID, targetID) => {
        const existing = current.current.relationships.find((edge) => edge.source.resource_id === sourceID && edge.target.resource_id === targetID);
        if (existing) return { relationship: existing };
        if (current.current.relationships.length >= 500) throw new Error("A Process can contain up to 500 connections when first saved.");
        if (sourceID === targetID || ![sourceID, targetID].every((id) => current.current.steps.some((step) => step.process_step_id === id))) throw new Error("Choose two different Steps in this Process.");
        const relationship: ProcessStepRelationship = { resource_operational_relationship_id: crypto.randomUUID(), source: { resource_type: "process_step", resource_id: sourceID }, target: { resource_type: "process_step", resource_id: targetID } };
        update({ ...current.current, relationships: [...current.current.relationships, relationship] });
        return { relationship };
      },
      disconnectSteps: async (id) => update({ ...current.current, relationships: current.current.relationships.filter((edge) => edge.resource_operational_relationship_id !== id) }),
    };
  }, [processID]);
  const save = async () => {
    if (submitting.current || editorBusy || detailsBusy || foldersLoading || !name.trim() || !selectedFolder) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const process = current.current;
      const response = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID, entityKind: "logic_gate", folderID, mutationOrigin: "company_explorer",
        items: [{ client_id: processID, title: name.trim() }],
        processDefinition: { logic_gate_id: processID, steps: process.steps.map(({ process_step_id, name: stepName, body_json }) => ({ process_step_id, name: stepName, body_json })), relationships: process.relationships, layout: { steps: process.layout.steps, routes: process.layout.routes }, ...details.current },
        requestJSON: (path, init) => requestJSON(apiBase, path, init),
      });
      created.current = true;
      if (mounted.current) onSaved({ processID, name: name.trim(), folderID }, response);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save this Process. Your changes are still here.");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  const openSavedVersion = async () => {
    if (submitting.current || editorBusy) return;
    submitting.current = true;
    setSaving(true);
    try {
      const [snapshot, path] = await Promise.all([
        requestJSON<ProcessWorkSnapshot>(apiBase, `/v2/logic-gates/${encodeURIComponent(processID)}/work?company_id=${encodeURIComponent(companyID)}`, { cache: "no-store" }),
        fetchHierarchyPath(apiBase, { companyID, kind: "company_explorer", resourceType: "logic_gate", resourceID: processID }),
      ]);
      const folderSegments = path.segments.filter((segment) => segment.entity_type === "folder");
      const parent = folderSegments[folderSegments.length - 1];
      if (path.status !== "resolved" || !parent) throw new Error("The saved Process destination is unavailable.");
      created.current = true;
      if (mounted.current) onSaved({ processID, name: snapshot.logic_gate.header, folderID: parent.entity_id });
    } catch {
      if (mounted.current) setError("No saved version is available. Check your connection or try Save Process again.");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <section className="process-map-workspace process-map-workspace--new" aria-label="New Process map" aria-busy={saving}>
    <div className="process-map-workspace__path" aria-label="Process location">
      <button type="button" disabled={saving || editorBusy} onClick={onBack}>← Company map</button>
      <span aria-hidden="true">/</span>
      <ProcessMapDestinationPath folders={folders} folderID={folderID} onChange={setFolderID} disabled={saving || foldersLoading} />
      <span aria-hidden="true">/</span>
      {editingName ? <input className="process-map-workspace__filename" aria-label="Process name" autoFocus placeholder="Untitled Process" value={name} maxLength={240} disabled={saving} onChange={(event) => setName(event.currentTarget.value)} onBlur={() => setEditingName(false)} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") {
          event.preventDefault();
          const previousFocus = document.activeElement;
          setEditingName(false);
          window.requestAnimationFrame(() => {
            if (document.activeElement === previousFocus || document.activeElement === document.body) filenameRef.current?.focus();
          });
        }
      }} /> : <button ref={filenameRef} type="button" className="process-map-workspace__filename" aria-label="Name Process" title="Rename Process" disabled={saving} onClick={() => setEditingName(true)}>{name.trim() || "Untitled Process"}<span aria-hidden="true"> ✎</span></button>}
    </div>
    <ProcessMapDetails key={processID} apiBase={apiBase} companyID={companyID} processID={processID} isNew folderID={folderID} canEdit={active && !saving} disabled={saving} onChange={updateDetails} onBusyChange={setDetailsBusy} steps={contents.steps} onStepBodyChange={updateStepBody} />
    {error && <div role="alert" className="process-map-authoring-error">{error} Your changes are still here. If Save already completed, find the saved Process; later changes will be left behind. <button type="button" disabled={saving || editorBusy || detailsBusy} onClick={() => { void openSavedVersion(); }}>Find saved Process</button></div>}
    <ProcessStepMapEditor steps={contents.steps} relationships={contents.relationships} canEdit={active && !saving} commands={commands} onBusyChange={setEditorBusy} saveMode="new" processName={name} initialEditingStepID={firstStep ? contents.steps[0]?.process_step_id : undefined} hoverModeEnabled={hoverModeEnabled}
      renderActions={({ createStep, disabled, busy }) => <ProcessMapActions onCreateStep={createStep} disabled={saving || busy || !active} stepDisabled={disabled} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={onHoverModeChange}>
        <button type="button" className="process-map-primary" disabled={saving || editorBusy || detailsBusy || foldersLoading || !name.trim() || !selectedFolder} onClick={() => { void save(); }}>{saving ? "Saving…" : "Save Process"}</button>
        {(!name.trim() || !selectedFolder) && <span className="process-map-workspace__status">{!name.trim() ? "Name this Process in the path above." : "Choose a Folder in the path above."}</span>}
      </ProcessMapActions>} />
  </section>;
}

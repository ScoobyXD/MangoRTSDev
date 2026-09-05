import { useEffect, useMemo, useRef, useState } from "react";
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

type DraftContents = { steps: ProcessStep[]; relationships: ProcessStepRelationship[]; layout: ProcessStepMapLayout };
export type SavedMapProcess = { processID: string; name: string; folderID: string };

export function ProcessMapDraft({ apiBase, companyID, processID, firstStep, initialFolderID, folders, foldersLoading, active, onSaved, onBack, onCreateFolder, onCreateProcess, onBusyChange, hoverModeEnabled, onHoverModeChange }: {
  apiBase: string; companyID: string; processID: string; firstStep: boolean; initialFolderID: string;
  folders: CompanyExplorerFolder[]; foldersLoading: boolean; active: boolean;
  onSaved: (process: SavedMapProcess) => void; onBack: () => void;
  onCreateFolder: (parentFolderID?: string) => void; onCreateProcess: (folderID?: string) => void; onBusyChange: (busy: boolean) => void;
  hoverModeEnabled: boolean; onHoverModeChange: (enabled: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const filenameRef = useRef<HTMLButtonElement>(null);
  const [folderID, setFolderID] = useState(initialFolderID);
  const [contents, setContents] = useState<DraftContents>(() => {
    const steps = firstStep ? [{ process_step_id: crypto.randomUUID(), logic_gate_id: processID, name: "New Step", position: 1000 }] : [];
    return { steps, relationships: [], layout: completeStepMapLayout({ revision: 0, steps: [], routes: [] }, steps, []) };
  });
  const current = useRef(contents);
  const [editorBusy, setEditorBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => { mounted.current = false; window.removeEventListener("beforeunload", warn); };
  }, []);
  useEffect(() => { onBusyChange(saving || editorBusy); }, [onBusyChange, saving, editorBusy]);
  // Folder creation can refresh the list without resetting the chosen destination.
  const destinationPath = processMapFolderPath(folders, folderID);
  const selectedFolder = destinationPath[destinationPath.length - 1];
  const commands = useMemo<ProcessStepMapCommands>(() => {
    const update = (next: DraftContents) => {
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
        if (!step) throw new Error("This Step is no longer in the draft.");
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
    if (submitting.current || editorBusy || foldersLoading || !name.trim() || !selectedFolder) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const draft = current.current;
      await createWorkspaceEntityBatchCommand({
        companyID, entityKind: "logic_gate", folderID, mutationOrigin: "company_explorer",
        items: [{ client_id: processID, title: name.trim() }],
        processDefinition: { logic_gate_id: processID, steps: draft.steps.map(({ process_step_id, name: stepName }) => ({ process_step_id, name: stepName })), relationships: draft.relationships, layout: { steps: draft.layout.steps, routes: draft.layout.routes } },
        requestJSON: (path, init) => requestJSON(apiBase, path, init),
      });
      if (mounted.current) onSaved({ processID, name: name.trim(), folderID });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Could not save this Process. Your draft is still here.");
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
      if (mounted.current) onSaved({ processID, name: snapshot.logic_gate.header, folderID: parent.entity_id });
    } catch {
      if (mounted.current) setError("No saved version is available. Check your connection or try Save Process again.");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return <section className="process-map-workspace" aria-label="New Process map" aria-busy={saving}>
    <div className="process-map-workspace__path" aria-label="Process location">
      <button type="button" disabled={saving || editorBusy} onClick={onBack}>← Company map</button>
      <span aria-hidden="true">/</span>
      <ProcessMapDestinationPath folders={folders} folderID={folderID} onChange={setFolderID} disabled={saving || foldersLoading} />
      <span aria-hidden="true">/</span>
      {editingName ? <input className="process-map-workspace__filename" aria-label="Process name" autoFocus placeholder="Untitled Process" value={name} maxLength={240} disabled={saving} onChange={(event) => setName(event.currentTarget.value)} onBlur={() => setEditingName(false)} onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); setEditingName(false); window.requestAnimationFrame(() => filenameRef.current?.focus()); }
      }} /> : <button ref={filenameRef} type="button" className="process-map-workspace__filename" aria-label="Name Process" title="Rename Process" disabled={saving} onClick={() => setEditingName(true)}>{name.trim() || "Untitled Process"}<span aria-hidden="true"> ✎</span></button>}
    </div>
    {error && <div role="alert" className="process-map-authoring-error">{error} Your draft has been kept. If Save already completed, you can open that saved version; later draft edits will be left behind. <button type="button" disabled={saving || editorBusy} onClick={() => { void openSavedVersion(); }}>Open saved version</button></div>}
    <ProcessStepMapEditor steps={contents.steps} relationships={contents.relationships} canEdit={active && !saving} commands={commands} onBusyChange={setEditorBusy} saveMode="draft" presentation="canvas" hoverModeEnabled={hoverModeEnabled}
      onCreateFolder={() => onCreateFolder(folderID || undefined)} onCreateProcess={() => onCreateProcess(folderID || undefined)}
      renderActions={({ createStep, disabled, busy }) => <ProcessMapActions onCreateFolder={() => onCreateFolder(folderID || undefined)} onCreateProcess={() => onCreateProcess(folderID || undefined)} onCreateStep={createStep} disabled={saving || busy || !active} stepDisabled={disabled} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={onHoverModeChange}>
        <span className="process-map-workspace__status">Unsaved draft</span>
        <button type="button" className="process-map-primary" disabled={saving || editorBusy || foldersLoading || !name.trim() || !selectedFolder} onClick={() => { void save(); }}>{saving ? "Saving…" : "Save Process"}</button>
        {(!name.trim() || !selectedFolder) && <span className="process-map-workspace__status">{!name.trim() ? "Name this Process in the path above." : "Choose a Folder in the path above."}</span>}
      </ProcessMapActions>} />
  </section>;
}

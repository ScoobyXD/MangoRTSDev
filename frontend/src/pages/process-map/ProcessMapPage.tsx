import { useCallback, useEffect, useRef, useState } from "react";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { requestJSON } from "../../modules/api/requestJSON.js";
import { emitDashboardEvent, emitExplorerContextUpdated, EVENT_COMPANY_EXPLORER_FIND_REQUESTED } from "../../modules/dashboardEvents.js";
import type { CompanyExplorerFolder } from "../../modules/folders/companyExplorerFolders.js";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";
import { ProcessMapCreateFolderDialog } from "./ProcessMapCreateFolderDialog.js";
import { ProcessMapDestinationPath, processMapFolderPath } from "./ProcessMapDestinationPath.js";
import { ProcessMapDraft, type SavedMapProcess } from "./ProcessMapDraft.js";
import { ProcessMapSavedProcess } from "./ProcessMapSavedProcess.js";
import { ProcessMapActions } from "./ProcessMapActions.js";
import "./processMapAuthoring.css";

export type ProcessMapPageProps = { apiBase: string; companyID: string; onOpenLogicGate: (logicGateID: string, label: string) => void; onDraftStateChange?: (active: boolean) => void; active?: boolean };
type Workspace = { kind: "draft"; processID: string; folderID: string; firstStep: boolean } | ({ kind: "saved" } & SavedMapProcess);

export function ProcessMapPage(props: ProcessMapPageProps) {
  return <ProcessMapCompanyPage key={`${props.apiBase}:${props.companyID}`} {...props} />;
}

function ProcessMapCompanyPage({ apiBase, companyID, onOpenLogicGate, onDraftStateChange, active = true }: ProcessMapPageProps) {
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderDialog, setFolderDialog] = useState<{ parentID?: string } | null>(null);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderError, setFolderError] = useState("");
  const [folderRefresh, setFolderRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [pendingWorkspace, setPendingWorkspace] = useState<{ next: Workspace | null } | null>(null);
  const confirmRef = useRef<HTMLElement>(null);
  useAppFloatingMenuDismissal(Boolean(pendingWorkspace), confirmRef, () => setPendingWorkspace(null));
  const needsFolders = workspace !== null || folderDialog !== null;
  useEffect(() => { onDraftStateChange?.(workspace?.kind === "draft"); }, [onDraftStateChange, workspace?.kind]);
  useEffect(() => { if (!active) { setFolderDialog(null); setPendingWorkspace(null); } }, [active]);
  useEffect(() => {
    if (!needsFolders) return;
    const controller = new AbortController();
    setFoldersLoading(true);
    setFolderError("");
    void requestJSON<{ folders: CompanyExplorerFolder[] }>(apiBase, `/v1/company-explorer/folders?company_id=${encodeURIComponent(companyID)}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setFolders(response.folders); })
      .catch(() => { if (!controller.signal.aborted) setFolderError("Could not load Folders."); })
      .finally(() => { if (!controller.signal.aborted) setFoldersLoading(false); });
    return () => controller.abort();
  }, [apiBase, companyID, needsFolders, folderRefresh]);
  const changeWorkspace = useCallback((next: Workspace | null) => {
    if (busy) return;
    if (workspace?.kind === "draft") setPendingWorkspace({ next });
    else { setWorkspace(next); setNotice(""); }
  }, [busy, workspace?.kind]);
  const createProcess = (parentID?: string, firstStep = false) => changeWorkspace({ kind: "draft", processID: crypto.randomUUID(), folderID: parentID ?? "", firstStep });
  const createFolder = (parentID?: string) => { if (!busy) setFolderDialog({ parentID }); };
  const saved = (process: SavedMapProcess) => {
    setBusy(false);
    setPendingWorkspace(null);
    setWorkspace({ kind: "saved", ...process });
    emitExplorerContextUpdated({ companyID, kind: "company_explorer" });
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_FIND_REQUESTED, { companyID, sourceFrameID: "process-map", folderPathIDs: processMapFolderPath(folders, process.folderID).map((folder) => folder.folder_id), entities: [{ kind: "logic_gate", id: process.processID }], changedAt: Date.now() });
  };
  return <main className="process-map-page" aria-label="Process Map">
    <div className="process-map-page__canvas">
      <div className="process-map-company-canvas" style={workspace ? { visibility: "hidden", pointerEvents: "none" } : undefined} aria-hidden={workspace ? true : undefined} ref={(element) => element?.toggleAttribute("inert", Boolean(workspace))}>
        <ProcessMapSurface apiBase={apiBase} companyID={companyID} hoverModeEnabled={hoverModeEnabled} onOpenLogicGate={onOpenLogicGate} onCreateFolder={createFolder} onCreateProcess={(parentID) => createProcess(parentID)} onCreateStep={(parentID) => createProcess(parentID, true)} />
      </div>
      {!workspace && <ProcessMapActions onCreateFolder={() => createFolder()} onCreateProcess={() => createProcess()} onCreateStep={() => createProcess(undefined, true)} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled} />}
      {workspace?.kind === "draft" && <ProcessMapDraft key={workspace.processID} apiBase={apiBase} companyID={companyID} processID={workspace.processID} firstStep={workspace.firstStep} initialFolderID={workspace.folderID} folders={folders} foldersLoading={foldersLoading || !!folderError} active={active} onSaved={saved} onBack={() => changeWorkspace(null)} onCreateFolder={createFolder} onCreateProcess={createProcess} onBusyChange={setBusy} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled} />}
      {workspace?.kind === "saved" && <section className="process-map-workspace" aria-label="Saved Process map">
        <div className="process-map-workspace__path" aria-label="Process location">
          <button type="button" disabled={busy} onClick={() => changeWorkspace(null)}>← Company map</button><span aria-hidden="true">/</span>
          <ProcessMapDestinationPath folders={folders} folderID={workspace.folderID} onChange={() => {}} disabled /><span aria-hidden="true">/</span><strong className="process-map-workspace__saved-name">{workspace.name}</strong>
        </div>
        <ProcessMapSavedProcess key={workspace.processID} apiBase={apiBase} companyID={companyID} processID={workspace.processID} onBusyChange={setBusy} onCreateFolder={() => createFolder(workspace.folderID)} onCreateProcess={() => createProcess(workspace.folderID)} hoverModeEnabled={hoverModeEnabled}
          renderActions={({ createStep, disabled, busy: mapBusy }) => <ProcessMapActions onCreateFolder={() => createFolder(workspace.folderID)} onCreateProcess={() => createProcess(workspace.folderID)} onCreateStep={createStep} disabled={busy || mapBusy} stepDisabled={disabled} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled}>
            <span className="process-map-workspace__status">Saved · Changes save automatically</span>
            <button type="button" disabled={busy} onClick={() => onOpenLogicGate(workspace.processID, workspace.name)}>Open Board / SOP</button>
          </ProcessMapActions>} />
      </section>}
      {folderDialog && foldersLoading && <div role="status" className="process-map-authoring-notice">Loading Folders… <button type="button" onClick={() => setFolderDialog(null)}>Cancel</button></div>}
      {folderError && needsFolders && <div role="alert" className="process-map-authoring-notice">{folderError} <button type="button" onClick={() => setFolderRefresh((value) => value + 1)}>Retry</button>{folderDialog && <button type="button" onClick={() => setFolderDialog(null)}>Cancel</button>}</div>}
      {notice && <div role="status" className="process-map-authoring-notice">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
      {folderDialog && !foldersLoading && !folderError && <ProcessMapCreateFolderDialog apiBase={apiBase} companyID={companyID} folders={folders} initialParentFolderID={folderDialog.parentID} onClose={() => setFolderDialog(null)} onCreated={(folder) => { setFolderDialog(null); setFolderRefresh((value) => value + 1); setNotice(`Folder “${folder.name}” created.`); emitExplorerContextUpdated({ companyID, kind: "company_explorer" }); }} />}
      {pendingWorkspace && <section ref={confirmRef} className="process-map-confirm" role="dialog" aria-labelledby="process-map-discard-title"><h2 id="process-map-discard-title">Discard this Process draft?</h2><p>This Process and its Steps have not been saved.</p><div><button type="button" autoFocus onClick={() => setPendingWorkspace(null)}>Keep editing</button><button type="button" disabled={busy} onClick={() => { if (busy) return; setWorkspace(pendingWorkspace.next); setBusy(false); setPendingWorkspace(null); }}>Discard draft</button></div></section>}
    </div>
  </main>;
}

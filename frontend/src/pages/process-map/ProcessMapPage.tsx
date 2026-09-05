import { useCallback, useEffect, useRef, useState } from "react";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import { requestJSON } from "../../modules/api/requestJSON.js";
import { emitDashboardEvent, emitExplorerContextUpdated, EVENT_COMPANY_EXPLORER_PROCESS_CREATED } from "../../modules/dashboardEvents.js";
import type { CompanyExplorerWorkspaceEntityBatchResponse } from "../../modules/company-explorer/CompanyExplorerContentModel.js";
import type { CompanyExplorerFolder } from "../../modules/folders/companyExplorerFolders.js";
import { ProcessMapSurface } from "../../modules/process-map/ProcessMapSurface.js";
import { ProcessMapCreateFolderDialog } from "./ProcessMapCreateFolderDialog.js";
import { ProcessMapDestinationPath, processMapFolderPath } from "./ProcessMapDestinationPath.js";
import { ProcessMapCreateProcess, type SavedMapProcess } from "./ProcessMapCreateProcess.js";
import { ProcessMapSavedProcess } from "./ProcessMapSavedProcess.js";
import { ProcessMapDetails } from "./ProcessMapDetails.js";
import { flushMangoTiptapResource } from "../../modules/editor/tiptap/mangoTiptapFlushRegistry.js";
import { ProcessMapActions } from "./ProcessMapActions.js";
import "./processMapAuthoring.css";

export type ProcessMapPageProps = { apiBase: string; companyID: string; onOpenLogicGate: (logicGateID: string, label: string) => void; active?: boolean };
type Workspace = { kind: "new"; processID: string; folderID: string; firstStep: boolean } | ({ kind: "saved" } & SavedMapProcess);

export function ProcessMapPage(props: ProcessMapPageProps) {
  return <ProcessMapCompanyPage key={`${props.apiBase}:${props.companyID}`} {...props} />;
}

function ProcessMapCompanyPage({ apiBase, companyID, onOpenLogicGate, active = true }: ProcessMapPageProps) {
  const [hoverModeEnabled, setHoverModeEnabled] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [exiting, setExiting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailsBusy, setDetailsBusy] = useState(false);
  const [savedProcessID, setSavedProcessID] = useState<string | null>(null);
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
  useEffect(() => { if (!active) { setFolderDialog(null); setPendingWorkspace(null); setWorkspace(null); setExiting(false); } }, [active]);
  const finishExit = useCallback(() => { setWorkspace(null); setExiting(false); }, []);
  useEffect(() => {
    if (!exiting) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!active || motion.matches) { finishExit(); return; }
    const onMotionChange = () => { if (motion.matches) finishExit(); };
    motion.addEventListener("change", onMotionChange);
    const timer = window.setTimeout(finishExit, 440);
    return () => { window.clearTimeout(timer); motion.removeEventListener("change", onMotionChange); };
  }, [active, exiting, finishExit]);
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
  const openWorkspace = useCallback((next: Workspace | null) => {
    setNotice("");
    if (workspace && !next && active && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) setExiting(true);
    else setWorkspace(next);
  }, [active, workspace]);
  const changeWorkspace = useCallback((next: Workspace | null) => {
    if (busy || detailsBusy || exiting) return;
    if (workspace?.kind === "new") setPendingWorkspace({ next });
    else if (workspace?.kind === "saved" && !next) {
      setBusy(true);
      void flushMangoTiptapResource({ companyID, resourceType: "logic_gate", resourceID: workspace.processID })
        .then(() => openWorkspace(null))
        .catch(() => setNotice("The SOP could not be saved. Please try going back again."))
        .finally(() => setBusy(false));
    }
    else openWorkspace(next);
  }, [busy, companyID, detailsBusy, exiting, openWorkspace, workspace]);
  const createProcess = (parentID?: string, firstStep = false) => changeWorkspace({ kind: "new", processID: crypto.randomUUID(), folderID: parentID ?? "", firstStep });
  const createFolder = (parentID?: string) => { if (!busy && !exiting) setFolderDialog({ parentID }); };
  const saved = (process: SavedMapProcess, response?: CompanyExplorerWorkspaceEntityBatchResponse) => {
    setBusy(false);
    setPendingWorkspace(null);
    setSavedProcessID(process.processID);
    emitDashboardEvent(EVENT_COMPANY_EXPLORER_PROCESS_CREATED, { companyID, processID: process.processID, response, folderPathIDs: processMapFolderPath(folders, process.folderID).map((folder) => folder.folder_id) });
    openWorkspace(null);
  };
  return <main className="process-map-page" aria-label="Process Map">
    <div className="process-map-page__canvas">
      <div className={`process-map-company-canvas${workspace && !exiting ? " is-focused" : ""}`} aria-hidden={workspace ? true : undefined} ref={(element) => element?.toggleAttribute("inert", Boolean(workspace))}>
        <ProcessMapSurface apiBase={apiBase} companyID={companyID} hoverModeEnabled={hoverModeEnabled} savedProcessID={savedProcessID} onOpenLogicGate={(processID, name, folderID) => changeWorkspace({ kind: "saved", processID, name, folderID: folderID ?? "" })} onCreateFolder={createFolder} onCreateProcess={(parentID) => createProcess(parentID)} onCreateStep={(parentID) => createProcess(parentID, true)} />
      </div>
      {!workspace && <ProcessMapActions onCreateFolder={() => createFolder()} onCreateProcess={() => createProcess()} onCreateStep={() => createProcess(undefined, true)} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled} />}
      {workspace && <div className={`process-map-focus${exiting ? " is-exiting" : ""}`} aria-hidden={exiting ? true : undefined} ref={(element) => element?.toggleAttribute("inert", exiting)} onAnimationEnd={(event) => { if (exiting && event.target === event.currentTarget && event.animationName === "process-map-exit") finishExit(); }}>
      {workspace?.kind === "new" && <ProcessMapCreateProcess key={workspace.processID} apiBase={apiBase} companyID={companyID} processID={workspace.processID} firstStep={workspace.firstStep} initialFolderID={workspace.folderID} folders={folders} foldersLoading={foldersLoading || !!folderError} active={active} onSaved={saved} onBack={() => changeWorkspace(null)} onBusyChange={setBusy} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled} />}
      {workspace?.kind === "saved" && <section key={workspace.processID} className="process-map-workspace" aria-label="Saved Process map">
        <div className="process-map-workspace__path" aria-label="Process location">
          <button type="button" disabled={busy || detailsBusy} onClick={() => changeWorkspace(null)}>← Company map</button><span aria-hidden="true">/</span>
          <ProcessMapDestinationPath folders={folders} folderID={workspace.folderID} onChange={() => {}} disabled /><span aria-hidden="true">/</span><strong className="process-map-workspace__saved-name">{workspace.name}</strong>
        </div>
        <ProcessMapSavedProcess apiBase={apiBase} companyID={companyID} processID={workspace.processID} onBusyChange={setBusy} hoverModeEnabled={hoverModeEnabled}
          renderDetails={(canEdit, refreshVersion) => <ProcessMapDetails apiBase={apiBase} companyID={companyID} processID={workspace.processID} canEdit={canEdit} refreshVersion={refreshVersion} disabled={busy} onBusyChange={setDetailsBusy} />}
          renderActions={({ createStep, disabled, busy: mapBusy }) => <ProcessMapActions onCreateStep={createStep} disabled={busy || mapBusy} stepDisabled={disabled} hoverModeEnabled={hoverModeEnabled} onHoverModeChange={setHoverModeEnabled}>
            <span className="process-map-workspace__status">Saved · Changes save automatically</span>
            <button type="button" disabled={busy} onClick={() => onOpenLogicGate(workspace.processID, workspace.name)}>Open Board / SOP</button>
          </ProcessMapActions>} />
      </section>}
      </div>}
      {folderDialog && foldersLoading && <div role="status" className="process-map-authoring-notice">Loading Folders… <button type="button" onClick={() => setFolderDialog(null)}>Cancel</button></div>}
      {folderError && needsFolders && <div role="alert" className="process-map-authoring-notice">{folderError} <button type="button" onClick={() => setFolderRefresh((value) => value + 1)}>Retry</button>{folderDialog && <button type="button" onClick={() => setFolderDialog(null)}>Cancel</button>}</div>}
      {notice && <div role="status" className="process-map-authoring-notice">{notice}<button type="button" aria-label="Dismiss notice" onClick={() => setNotice("")}>×</button></div>}
      {folderDialog && !foldersLoading && !folderError && <ProcessMapCreateFolderDialog apiBase={apiBase} companyID={companyID} folders={folders} initialParentFolderID={folderDialog.parentID} onClose={() => setFolderDialog(null)} onCreated={(folder) => { setFolderDialog(null); setFolderRefresh((value) => value + 1); setNotice(`Folder “${folder.name}” created.`); emitExplorerContextUpdated({ companyID, kind: "company_explorer" }); }} />}
      {pendingWorkspace && <section ref={confirmRef} className="process-map-confirm" role="dialog" aria-labelledby="process-map-leave-title"><h2 id="process-map-leave-title">Are you sure?</h2><p>This Process has not been saved. Going back will discard it.</p><div><button type="button" autoFocus onClick={() => setPendingWorkspace(null)}>Keep editing</button><button type="button" disabled={busy || exiting} onClick={() => { if (busy || exiting) return; openWorkspace(pendingWorkspace.next); setBusy(false); setPendingWorkspace(null); }}>Go back</button></div></section>}
    </div>
  </main>;
}

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppFloatingMenuDismissal } from "../../app/AppModalPortal.js";
import type { CompanyExplorerFolder } from "../../modules/folders/companyExplorerFolders.js";

export function processMapFolderPath(folders: CompanyExplorerFolder[], folderID: string): CompanyExplorerFolder[] {
  const byID = new Map(folders.map((folder) => [folder.folder_id, folder]));
  const path: CompanyExplorerFolder[] = [];
  const visited = new Set<string>();
  for (let id = folderID; id;) {
    const folder = byID.get(id);
    if (!folder || visited.has(id)) return [];
    visited.add(id);
    path.push(folder);
    id = folder.parent_folder_id ?? "";
  }
  return path.reverse();
}

export type ProcessMapDestinationPathProps = {
  folders: CompanyExplorerFolder[];
  folderID: string;
  onChange: (id: string) => void;
  allowRoot?: boolean;
  disabled?: boolean;
};

export function ProcessMapDestinationPath({ folders, folderID, onChange, allowRoot = false, disabled = false }: ProcessMapDestinationPathProps): React.ReactElement {
  const id = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const browserRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [browsingFolderID, setBrowsingFolderID] = useState("");
  const selectedPath = useMemo(() => processMapFolderPath(folders, folderID), [folders, folderID]);
  const browsingPath = useMemo(() => processMapFolderPath(folders, browsingFolderID), [folders, browsingFolderID]);
  const browsingFolder = browsingPath[browsingPath.length - 1];
  const browsingValid = !browsingFolderID || Boolean(browsingFolder);
  const children = useMemo(() => folders
    .filter((folder) => (folder.parent_folder_id ?? "") === browsingFolderID)
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name)), [folders, browsingFolderID]);
  useAppFloatingMenuDismissal(open, containerRef, () => setOpen(false));
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (open) (browserRef.current?.querySelector<HTMLButtonElement>(".process-map-path__children button")
      ?? browserRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)"))?.focus();
  }, [open, browsingFolderID]);

  const closeBrowser = () => {
    const previousFocus = document.activeElement;
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (document.activeElement === previousFocus || document.activeElement === document.body) containerRef.current?.querySelector<HTMLButtonElement>("nav button")?.focus();
    });
  };

  const browse = (nextFolderID: string) => {
    if (disabled) return;
    setBrowsingFolderID(nextFolderID);
    setOpen(true);
  };
  const breadcrumbButton = (label: string, nextFolderID: string) => <button
    type="button"
    disabled={disabled}
    aria-haspopup="dialog"
    aria-expanded={open}
    aria-controls={open ? `${id}-browser` : undefined}
    onClick={() => browse(nextFolderID)}
  >{label}</button>;

  return <div className="process-map-path" ref={containerRef}>
    <nav className="process-map-path__breadcrumb" aria-label="Destination path">
      {!selectedPath.length && (!allowRoot || folderID)
        ? breadcrumbButton("Choose Folder", "")
        : <>
          {breadcrumbButton("Workspace", "")}
          {selectedPath.map((folder) => <React.Fragment key={folder.folder_id}>
            <span aria-hidden="true">/</span>
            {breadcrumbButton(folder.name, folder.folder_id)}
          </React.Fragment>)}
        </>}
    </nav>
    {folderID && !selectedPath.length && <span className="process-map-path__unavailable" role="status">The selected Folder is unavailable. Choose another Folder.</span>}
    {open && !disabled && <div ref={browserRef} id={`${id}-browser`} className="process-map-path__browser" role="dialog" aria-label="Choose destination Folder">
      <div className="process-map-path__browser-header">
        <button type="button" disabled={!browsingFolderID} onClick={() => setBrowsingFolderID(browsingFolder?.parent_folder_id ?? "")} aria-label="Up to parent Folder">Up</button>
        <span>{browsingValid ? ["Workspace", ...browsingPath.map((folder) => folder.name)].join(" / ") : "Folder unavailable"}</span>
        <button type="button" onClick={closeBrowser} aria-label="Close Folder browser">×</button>
      </div>
      <div className="process-map-path__children">
        {browsingValid && children.map((folder) => <button type="button" key={folder.folder_id} aria-label={`Open ${folder.name}`} onClick={() => setBrowsingFolderID(folder.folder_id)}>
          <span aria-hidden="true">📁</span><span>{folder.name}</span><span aria-hidden="true">›</span>
        </button>)}
        {browsingValid && children.length === 0 && <p>No Folders inside this location.</p>}
      </div>
      <div className="process-map-path__browser-actions">
        <button type="button" disabled={!browsingValid || (!allowRoot && !browsingFolderID)} onClick={() => {
          if (disabled || !browsingValid || (!allowRoot && !browsingFolderID)) return;
          onChange(browsingFolderID);
          closeBrowser();
        }}>{!browsingFolderID && allowRoot ? "Use Workspace" : "Use this Folder"}</button>
      </div>
    </div>}
  </div>;
}

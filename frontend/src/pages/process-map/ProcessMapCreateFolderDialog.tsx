import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { APIHTTPError, requestJSON } from "../../modules/api/requestJSON.js";
import type { CompanyExplorerV2Row } from "../../modules/company-explorer/companyExplorerLazyApi.js";
import type { CompanyExplorerFolder } from "../../modules/folders/companyExplorerFolders.js";
import { ProcessMapDestinationPath, processMapFolderPath } from "./ProcessMapDestinationPath.js";

export type ProcessMapCreateFolderDialogProps = {
  apiBase: string;
  companyID: string;
  folders: CompanyExplorerFolder[];
  initialParentFolderID?: string;
  onClose: () => void;
  onCreated: (folder: CompanyExplorerV2Row) => void;
};

export function ProcessMapCreateFolderDialog({ apiBase, companyID, folders, initialParentFolderID = "", onClose, onCreated }: ProcessMapCreateFolderDialogProps): React.ReactElement {
  const id = useId();
  const [name, setName] = useState("");
  const [parentFolderID, setParentFolderID] = useState(initialParentFolderID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, [apiBase, companyID]);
  const validDestination = useMemo(() => !parentFolderID || processMapFolderPath(folders, parentFolderID).length > 0, [folders, parentFolderID]);
  const close = () => { if (!requestRef.current) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (requestRef.current || !companyID.trim() || !name.trim() || !validDestination) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setSaving(true);
    setError("");
    try {
      const folder = await requestJSON<CompanyExplorerV2Row>(apiBase, "/v1/company-explorer/folders", {
        method: "POST",
        json: { company_id: companyID, parent_folder_id: parentFolderID, name: name.trim() },
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      onCreated(folder);
      onClose();
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof APIHTTPError && (cause.status === 403 || cause.status === 404)
        ? "This destination is no longer available. Choose another Folder and try again."
        : cause instanceof Error ? cause.message : "Could not create the Folder. Please try again.");
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setSaving(false);
      }
    }
  };
  return <AppModalPortal onRequestClose={close}>
    <div className="process-map-folder-dialog__backdrop">
      <form className="process-map-folder-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={saving} onSubmit={(event) => void submit(event)}>
        <h2 id={`${id}-title`}>Create Folder</h2>
        <label className="process-map-folder-dialog__field">Folder name
          <input autoFocus required value={name} disabled={saving} onChange={(event) => setName(event.currentTarget.value)} />
        </label>
        <div className="process-map-folder-dialog__field">
          <span>Save in</span>
          <ProcessMapDestinationPath folders={folders} folderID={parentFolderID} onChange={setParentFolderID} allowRoot disabled={saving} />
        </div>
        {error && <div className="process-map-folder-dialog__error" role="alert">{error}</div>}
        <div className="process-map-folder-dialog__actions">
          <button type="button" disabled={saving} onClick={close}>Cancel</button>
          <button type="submit" disabled={saving || !companyID.trim() || !name.trim() || !validDestination}>{saving ? "Creating…" : "Create Folder"}</button>
        </div>
      </form>
    </div>
  </AppModalPortal>;
}

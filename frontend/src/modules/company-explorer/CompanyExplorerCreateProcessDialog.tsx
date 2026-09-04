import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import type { CompanyExplorerFolder } from "../folders/companyExplorerFolders";
import { createWorkspaceEntityBatchClientID, createWorkspaceEntityBatchCommand, type WorkspaceEntityBatchCreatorLogicGateRACIRole, type WorkspaceEntityCommandRequest } from "../workspace/workspaceEntityCommands";
import type { CompanyExplorerWorkspaceEntityBatchResponse } from "./CompanyExplorerContentModel";

type Props = {
  companyID: string;
  requestJSON: WorkspaceEntityCommandRequest;
  initialFolderID: string;
  position?: number;
  creatorRACIRole?: WorkspaceEntityBatchCreatorLogicGateRACIRole;
  isDarkTheme: boolean;
  onCreated: (response: CompanyExplorerWorkspaceEntityBatchResponse, folderPath: string[]) => void;
  onClose: () => void;
};

export function CompanyExplorerCreateProcessDialog({ companyID, requestJSON, initialFolderID, position, creatorRACIRole, isDarkTheme, onCreated, onClose }: Props): React.ReactElement {
  const id = useId();
  const [name, setName] = useState("");
  const [folderID, setFolderID] = useState(initialFolderID);
  const [folders, setFolders] = useState<CompanyExplorerFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void requestJSON<{ folders?: CompanyExplorerFolder[] }>(`/v1/company-explorer/folders?company_id=${encodeURIComponent(companyID)}`, { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setFolders(response.folders ?? []); })
      .catch(() => { if (!controller.signal.aborted) setError("Could not load Folders. Close this dialog and try again."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [companyID, requestJSON]);

  const options = useMemo(() => {
    const byID = new Map(folders.map((folder) => [folder.folder_id, folder]));
    return folders.map((folder) => {
      const path: CompanyExplorerFolder[] = [];
      const visited = new Set<string>();
      for (let current: CompanyExplorerFolder | undefined = folder; current && !visited.has(current.folder_id); current = byID.get(current.parent_folder_id ?? "")) {
        visited.add(current.folder_id);
        path.unshift(current);
      }
      return { id: folder.folder_id, label: path.map((entry) => entry.name).join(" / "), path: path.map((entry) => entry.folder_id) };
    }).sort((left, right) => left.label.localeCompare(right.label));
  }, [folders]);
  const selectedFolder = options.find((option) => option.id === folderID);
  const close = () => { if (!submitting.current) onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current || !name.trim() || !selectedFolder || loading) return;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const response = await createWorkspaceEntityBatchCommand<CompanyExplorerWorkspaceEntityBatchResponse>({
        companyID,
        entityKind: "logic_gate",
        folderID,
        mutationOrigin: "company_explorer",
        creatorLogicGateRACIRole: creatorRACIRole,
        items: [{ client_id: createWorkspaceEntityBatchClientID("explorer-logic-gate"), title: name.trim(), position: folderID === initialFolderID ? position : undefined }],
        requestJSON,
      });
      if (!response.logic_gates?.[0]) throw new Error("Process creation returned no Process.");
      onCreated(response, selectedFolder.path);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the Process. Please try again.");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };
  const fieldStyle: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 34, border: "1px solid rgba(100,116,139,0.45)", borderRadius: 6, padding: "6px 9px", background: isDarkTheme ? "#182129" : "#fff", color: "inherit", font: "inherit" };
  return (
    <AppModalPortal onRequestClose={close}>
      <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", display: "grid", placeItems: "center" }}>
        <form onSubmit={(event) => { void submit(event); }} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={saving} style={{ width: "min(420px, 90vw)", borderRadius: 10, border: "1px solid rgba(100,116,139,0.45)", background: isDarkTheme ? "#11161b" : "#fff", color: isDarkTheme ? "#f6f8fb" : "#111827", padding: 18, display: "grid", gap: 14, fontSize: 13 }}>
          <div id={`${id}-title`} style={{ fontSize: 16, fontWeight: 700 }}>Create Process</div>
          <label style={{ display: "grid", gap: 5 }}>Process name
            <input autoFocus required value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={saving} style={fieldStyle} />
          </label>
          <label style={{ display: "grid", gap: 5 }}>Folder
            <select required value={selectedFolder ? folderID : ""} onChange={(event) => setFolderID(event.currentTarget.value)} disabled={loading || saving} style={fieldStyle}>
              <option value="">{loading ? "Loading Folders…" : "Choose a Folder"}</option>
              {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
          </label>
          {!loading && options.length === 0 && !error && <div>Create a Folder in Company Explorer first.</div>}
          {error && <div role="alert" style={{ color: isDarkTheme ? "#fca5a5" : "#b91c1c", overflowWrap: "anywhere" }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" disabled={saving} onClick={close} style={{ ...fieldStyle, width: "auto", cursor: "pointer" }}>Cancel</button>
            <button type="submit" disabled={loading || saving || !name.trim() || !selectedFolder} style={{ ...fieldStyle, width: "auto", fontWeight: 700, cursor: "pointer" }}>{saving ? "Creating…" : "Create Process"}</button>
          </div>
        </form>
      </div>
    </AppModalPortal>
  );
}

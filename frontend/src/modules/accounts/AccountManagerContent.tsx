import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmActionMenu, confirmMenuPositionFromElement, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu.js";
import { getActiveCompanyID } from "../../auth/currentCompany.js";
import {
  createAccount,
  createAccountFolder,
  deleteAccount,
  deleteAccountFolder,
  listAccountFolders,
  sortAccountFolders,
  sortAccountsByName,
  updateAccount,
  updateAccountFolder,
  type Account,
  type AccountFolder,
} from "./accountsApi.js";
import { useCompanyAccounts } from "./AccountFilterControl.js";

type AccountManagerContentProps = {
  accent: string;
  widgetId?: string;
  hideTopControls?: boolean;
  theme?: "mango" | "teal" | "light" | "dark";
};

type AccountTreeRow =
  | { kind: "root"; id: "root"; depth: number; label: string }
  | { kind: "folder"; id: string; depth: number; folder: AccountFolder; label: string; childCount: number }
  | { kind: "account"; id: string; depth: number; account: Account; label: string };

type Selection =
  | { kind: "root"; id: "" }
  | { kind: "folder"; id: string }
  | { kind: "account"; id: string };

const ROOT_SELECTION: Selection = { kind: "root", id: "" };

export const AccountManagerContent: React.FC<AccountManagerContentProps> = ({
  accent,
  widgetId: _widgetId,
  hideTopControls: _hideTopControls,
  theme: _theme,
}) => {
  const companyID = getActiveCompanyID();
  const { accounts, setAccounts, loading: accountsLoading, error: accountsError, reload: reloadAccounts } = useCompanyAccounts(companyID);
  const [folders, setFolders] = useState<AccountFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selection, setSelection] = useState<Selection>(ROOT_SELECTION);
  const [expandedFolderIDs, setExpandedFolderIDs] = useState<Set<string>>(() => new Set(["root"]));
  const [folderDraft, setFolderDraft] = useState("");
  const [accountDraft, setAccountDraft] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [moveTargetFolderID, setMoveTargetFolderID] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ selection: Selection; name: string; position?: ConfirmActionMenuPosition | null } | null>(null);

  const reloadFolders = useCallback(() => {
    const cleanCompanyID = companyID.trim();
    if (!cleanCompanyID) {
      setFolders([]);
      return;
    }
    setFoldersLoading(true);
    listAccountFolders(cleanCompanyID)
      .then((next) => {
        setFolders(next);
        setError("");
      })
      .catch((loadError) => {
        setFolders([]);
        setError(loadError instanceof Error ? loadError.message : "Failed to load account folders");
      })
      .finally(() => setFoldersLoading(false));
  }, [companyID]);

  useEffect(() => {
    reloadFolders();
  }, [reloadFolders]);

  const folderByID = useMemo(() => new Map(folders.map((folder) => [folder.folder_id, folder])), [folders]);
  const accountByID = useMemo(() => new Map(accounts.map((account) => [account.account_id, account])), [accounts]);
  const selectedFolderID = selection.kind === "folder" ? selection.id : selection.kind === "root" ? "" : (accountByID.get(selection.id)?.folder_id ?? "");
  const selectedFolder = selectedFolderID ? folderByID.get(selectedFolderID) ?? null : null;
  const selectedAccount = selection.kind === "account" ? accountByID.get(selection.id) ?? null : null;
  const selectedEntityName = selection.kind === "root"
    ? "Accounts"
    : selectedAccount?.name || selectedFolder?.name || "";

  useEffect(() => {
    setRenameDraft(selectedEntityName);
    setMoveTargetFolderID(selection.kind === "folder"
      ? selectedFolder?.parent_folder_id ?? ""
      : selectedAccount?.folder_id ?? "");
  }, [selectedAccount?.folder_id, selectedAccount?.name, selectedEntityName, selectedFolder?.name, selectedFolder?.parent_folder_id, selection.kind]);

  const treeRows = useMemo(() => buildAccountTreeRows(folders, accounts, expandedFolderIDs), [accounts, expandedFolderIDs, folders]);
  const folderOptions = useMemo(() => {
    const blockedFolderIDs = selection.kind === "folder" ? collectFolderSubtreeIDs(selection.id, folders) : new Set<string>();
    return sortAccountFolders(folders).filter((folder) => !blockedFolderIDs.has(folder.folder_id));
  }, [folders, selection]);
  const accountsInSelectedScope = useMemo(() => {
    if (selection.kind === "account" && selectedAccount) return [selectedAccount];
    return sortAccountsByName(accounts.filter((account) => (account.folder_id ?? "") === selectedFolderID));
  }, [accounts, selectedAccount, selectedFolderID, selection.kind]);
  const childFoldersInSelectedScope = useMemo(() => (
    sortAccountFolders(folders.filter((folder) => (folder.parent_folder_id ?? "") === selectedFolderID))
  ), [folders, selectedFolderID]);

  const selectRow = useCallback((row: AccountTreeRow) => {
    if (row.kind === "root") {
      setSelection(ROOT_SELECTION);
      return;
    }
    setSelection({ kind: row.kind, id: row.id });
  }, []);

  const toggleFolder = useCallback((folderID: string) => {
    setExpandedFolderIDs((current) => {
      const next = new Set(current);
      if (next.has(folderID)) next.delete(folderID);
      else next.add(folderID);
      return next;
    });
  }, []);

  const createFolderInSelection = useCallback(async () => {
    const name = folderDraft.trim();
    if (!name || busy) return;
    setBusy("folder");
    setError("");
    try {
      const created = await createAccountFolder({
        companyID,
        name,
        parentFolderID: selectedFolderID || null,
        position: childFoldersInSelectedScope.length,
      });
      setFolders((current) => sortAccountFolders([...current, created]));
      setExpandedFolderIDs((current) => new Set(current).add(selectedFolderID || "root"));
      setFolderDraft("");
      setSelection({ kind: "folder", id: created.folder_id });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create folder");
    } finally {
      setBusy("");
    }
  }, [busy, childFoldersInSelectedScope.length, companyID, folderDraft, selectedFolderID]);

  const createAccountInSelection = useCallback(async () => {
    const name = accountDraft.trim();
    if (!name || busy) return;
    setBusy("account");
    setError("");
    try {
      const created = await createAccount({
        companyID,
        name,
        folderID: selectedFolderID || null,
        position: accountsInSelectedScope.length,
      });
      setAccounts((current) => sortAccountsByName([...current, created]));
      setAccountDraft("");
      setSelection({ kind: "account", id: created.account_id });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create account");
    } finally {
      setBusy("");
    }
  }, [accountDraft, accountsInSelectedScope.length, busy, companyID, selectedFolderID, setAccounts]);

  const saveSelectedRename = useCallback(async () => {
    const name = renameDraft.trim();
    if (!name || selection.kind === "root" || busy) return;
    setBusy("rename");
    setError("");
    try {
      if (selection.kind === "account") {
        const account = accountByID.get(selection.id);
        if (!account) return;
        const saved = await updateAccount({
          companyID,
          accountID: selection.id,
          name,
          folderID: account.folder_id ?? null,
          position: account.position,
        });
        setAccounts((current) => sortAccountsByName(current.map((item) => item.account_id === saved.account_id ? saved : item)));
      } else {
        const folder = folderByID.get(selection.id);
        if (!folder) return;
        const saved = await updateAccountFolder({
          companyID,
          folderID: selection.id,
          name,
          parentFolderID: folder.parent_folder_id ?? null,
          position: folder.position,
        });
        setFolders((current) => sortAccountFolders(current.map((item) => item.folder_id === saved.folder_id ? saved : item)));
      }
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Failed to rename");
    } finally {
      setBusy("");
    }
  }, [accountByID, busy, companyID, folderByID, renameDraft, selection, setAccounts]);

  const moveSelected = useCallback(async () => {
    if (selection.kind === "root" || busy) return;
    const nextFolderID = moveTargetFolderID.trim();
    setBusy("move");
    setError("");
    try {
      if (selection.kind === "account") {
        const account = accountByID.get(selection.id);
        if (!account) return;
        const saved = await updateAccount({
          companyID,
          accountID: selection.id,
          name: account.name,
          folderID: nextFolderID || null,
          position: account.position,
        });
        setAccounts((current) => sortAccountsByName(current.map((item) => item.account_id === saved.account_id ? saved : item)));
      } else {
        const folder = folderByID.get(selection.id);
        if (!folder) return;
        const saved = await updateAccountFolder({
          companyID,
          folderID: selection.id,
          name: folder.name,
          parentFolderID: nextFolderID || null,
          position: folder.position,
        });
        setFolders((current) => sortAccountFolders(current.map((item) => item.folder_id === saved.folder_id ? saved : item)));
        setExpandedFolderIDs((current) => new Set(current).add(nextFolderID || "root"));
      }
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move");
    } finally {
      setBusy("");
    }
  }, [accountByID, busy, companyID, folderByID, moveTargetFolderID, selection, setAccounts]);

  const requestDeleteSelected = useCallback((position?: ConfirmActionMenuPosition) => {
    if (selection.kind === "root" || busy) return;
    setDeleteConfirmation({ selection, name: selectedEntityName || selection.id, position: position ?? null });
  }, [busy, selectedEntityName, selection]);

  const deleteSelected = useCallback(async (target: Selection) => {
    if (target.kind === "root" || busy) return;
    setDeleteConfirmation(null);
    setBusy("delete");
    setError("");
    try {
      if (target.kind === "account") {
        await deleteAccount(companyID, target.id);
        setAccounts((current) => current.filter((account) => account.account_id !== target.id));
      } else {
        await deleteAccountFolder(companyID, target.id);
        const deletedIDs = collectFolderSubtreeIDs(target.id, folders);
        setFolders((current) => current.filter((folder) => !deletedIDs.has(folder.folder_id)));
        setAccounts((current) => current.filter((account) => !deletedIDs.has(account.folder_id ?? "")));
      }
      setSelection(ROOT_SELECTION);
      reloadAccounts();
      reloadFolders();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete");
    } finally {
      setBusy("");
    }
  }, [busy, companyID, folders, reloadAccounts, reloadFolders, setAccounts]);

  const loading = accountsLoading || foldersLoading;
  const combinedError = error || accountsError;

  return (
    <div style={pageStyle}>
      <section style={managerSurfaceStyle}>
        <div style={headerStyle}>
          <div style={titleStackStyle}>
            <h2 style={titleStyle}>Account Manager</h2>
            <div style={metaStyle}>{accounts.length} account{accounts.length === 1 ? "" : "s"}{loading ? " - Loading" : ""}</div>
          </div>
          <button type="button" style={refreshButtonStyle(accent)} disabled={loading} onClick={() => { reloadAccounts(); reloadFolders(); }}>
            Refresh
          </button>
        </div>

        {combinedError && <div style={errorStyle}>{combinedError}</div>}

        <div style={contentGridStyle}>
          <div style={treePanelStyle}>
            <div style={panelHeaderStyle}>
              <span>Accounts</span>
              <span style={panelHeaderMetaStyle}>{folders.length} folder{folders.length === 1 ? "" : "s"}</span>
            </div>
            <div className="kanban-board-scroll" style={treeScrollStyle}>
              {treeRows.map((row) => (
                <AccountTreeRowButton
                  key={`${row.kind}:${row.id}`}
                  row={row}
                  selected={row.kind === selection.kind && row.id === (selection.kind === "root" ? "root" : selection.id)}
                  expanded={row.kind === "root" ? expandedFolderIDs.has("root") : row.kind === "folder" ? expandedFolderIDs.has(row.id) : false}
                  onSelect={() => selectRow(row)}
                  onToggle={() => {
                    if (row.kind === "root") toggleFolder("root");
                    if (row.kind === "folder") toggleFolder(row.id);
                  }}
                />
              ))}
            </div>
          </div>

          <div style={detailPanelStyle}>
            <div style={panelHeaderStyle}>
              <span>{selectedEntityName || "Accounts"}</span>
              <span style={panelHeaderMetaStyle}>{selection.kind === "root" ? "Root" : selection.kind}</span>
            </div>

            <div style={createGridStyle}>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Folder</span>
                <span style={inputActionStyle}>
                  <input value={folderDraft} onChange={(event) => setFolderDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void createFolderInSelection(); }} style={inputStyle} placeholder="New folder" />
                  <button type="button" style={smallButtonStyle} disabled={!folderDraft.trim() || !!busy} onClick={() => void createFolderInSelection()}>Add</button>
                </span>
              </label>
              <label style={fieldStyle}>
                <span style={fieldLabelStyle}>Account</span>
                <span style={inputActionStyle}>
                  <input value={accountDraft} onChange={(event) => setAccountDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void createAccountInSelection(); }} style={inputStyle} placeholder="New account" />
                  <button type="button" style={smallButtonStyle} disabled={!accountDraft.trim() || !!busy} onClick={() => void createAccountInSelection()}>Add</button>
                </span>
              </label>
            </div>

            {selection.kind !== "root" && (
              <div style={editGridStyle}>
                <label style={fieldStyle}>
                  <span style={fieldLabelStyle}>Name</span>
                  <span style={inputActionStyle}>
                    <input value={renameDraft} onChange={(event) => setRenameDraft(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSelectedRename(); }} style={inputStyle} />
                    <button type="button" style={smallButtonStyle} disabled={!renameDraft.trim() || !!busy} onClick={() => void saveSelectedRename()}>Save</button>
                  </span>
                </label>
                <label style={fieldStyle}>
                  <span style={fieldLabelStyle}>Move to</span>
                  <span style={inputActionStyle}>
                    <select value={moveTargetFolderID} onChange={(event) => setMoveTargetFolderID(event.currentTarget.value)} style={selectStyle}>
                      <option value="">Root</option>
                      {folderOptions.map((folder) => (
                        <option key={folder.folder_id} value={folder.folder_id}>{folderPathLabel(folder, folderByID)}</option>
                      ))}
                    </select>
                    <button type="button" style={smallButtonStyle} disabled={!!busy} onClick={() => void moveSelected()}>Move</button>
                  </span>
                </label>
                <button type="button" style={dangerButtonStyle} disabled={!!busy} onClick={(event) => requestDeleteSelected(confirmMenuPositionFromElement(event.currentTarget))}>Delete</button>
              </div>
            )}

            <div style={summaryGridStyle}>
              <SummaryList title="Folders" empty="No folders" items={childFoldersInSelectedScope.map((folder) => ({
                id: folder.folder_id,
                label: folder.name,
                detail: folder.folder_id,
                onClick: () => setSelection({ kind: "folder", id: folder.folder_id }),
              }))} />
              <SummaryList title="Accounts" empty="No accounts" items={accountsInSelectedScope.map((account) => ({
                id: account.account_id,
                label: account.name,
                detail: account.account_id,
                onClick: () => setSelection({ kind: "account", id: account.account_id }),
              }))} />
            </div>
          </div>
        </div>
      </section>
      {deleteConfirmation && (
        <ConfirmActionMenu
          title={`Delete ${deleteConfirmation.name}?`}
          detail={`This deletes the selected ${deleteConfirmation.selection.kind}.`}
          position={deleteConfirmation.position}
          confirmLabel={busy === "delete" ? "Deleting" : "Yes"}
          cancelLabel="No"
          confirmDisabled={busy === "delete"}
          onConfirm={() => void deleteSelected(deleteConfirmation.selection)}
          onCancel={() => setDeleteConfirmation(null)}
        />
      )}
    </div>
  );
};

function buildAccountTreeRows(folders: AccountFolder[], accounts: Account[], expandedFolderIDs: Set<string>): AccountTreeRow[] {
  const rows: AccountTreeRow[] = [{ kind: "root", id: "root", depth: 0, label: "Accounts" }];
  if (!expandedFolderIDs.has("root")) return rows;
  const foldersByParent = new Map<string, AccountFolder[]>();
  const accountsByFolder = new Map<string, Account[]>();
  for (const folder of folders) {
    const parentID = folder.parent_folder_id ?? "";
    const list = foldersByParent.get(parentID) ?? [];
    list.push(folder);
    foldersByParent.set(parentID, list);
  }
  for (const account of accounts) {
    const folderID = account.folder_id ?? "";
    const list = accountsByFolder.get(folderID) ?? [];
    list.push(account);
    accountsByFolder.set(folderID, list);
  }
  for (const [parentID, list] of foldersByParent.entries()) foldersByParent.set(parentID, sortAccountFolders(list));
  for (const [folderID, list] of accountsByFolder.entries()) accountsByFolder.set(folderID, sortAccountsByName(list));

  const appendChildren = (parentID: string, depth: number) => {
    for (const folder of foldersByParent.get(parentID) ?? []) {
      const childFolderCount = foldersByParent.get(folder.folder_id)?.length ?? 0;
      const childAccountCount = accountsByFolder.get(folder.folder_id)?.length ?? 0;
      rows.push({ kind: "folder", id: folder.folder_id, folder, depth, label: folder.name, childCount: childFolderCount + childAccountCount });
      if (expandedFolderIDs.has(folder.folder_id)) appendChildren(folder.folder_id, depth + 1);
    }
    for (const account of accountsByFolder.get(parentID) ?? []) {
      rows.push({ kind: "account", id: account.account_id, account, depth, label: account.name });
    }
  };
  appendChildren("", 1);
  return rows;
}

function collectFolderSubtreeIDs(folderID: string, folders: AccountFolder[]): Set<string> {
  const ids = new Set<string>([folderID]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) {
      const parentID = folder.parent_folder_id ?? "";
      if (!ids.has(parentID) || ids.has(folder.folder_id)) continue;
      ids.add(folder.folder_id);
      changed = true;
    }
  }
  return ids;
}

function folderPathLabel(folder: AccountFolder, folderByID: Map<string, AccountFolder>): string {
  const labels: string[] = [];
  let current: AccountFolder | undefined = folder;
  const seen = new Set<string>();
  while (current && !seen.has(current.folder_id)) {
    seen.add(current.folder_id);
    labels.unshift(current.name);
    current = current.parent_folder_id ? folderByID.get(current.parent_folder_id) : undefined;
  }
  return labels.join(" / ") || folder.name;
}

function AccountTreeRowButton({
  row,
  selected,
  expanded,
  onSelect,
  onToggle,
}: {
  row: AccountTreeRow;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const canExpand = row.kind === "root" || (row.kind === "folder" && row.childCount > 0);
  return (
    <div style={treeRowFrameStyle(row.depth, selected)}>
      {canExpand ? (
        <button type="button" title={expanded ? "Collapse" : "Expand"} aria-label={expanded ? "Collapse" : "Expand"} style={disclosureButtonStyle} onClick={(event) => { event.stopPropagation(); onToggle(); }}>
          <span style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }}>{">"}</span>
        </button>
      ) : (
        <span style={{ width: 24 }} />
      )}
      <button type="button" style={treeRowButtonStyle} onClick={onSelect}>
        <span style={treeIconStyle(row.kind)} />
        <span style={treeLabelStyle}>{row.label || row.id}</span>
      </button>
    </div>
  );
}

function SummaryList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ id: string; label: string; detail: string; onClick: () => void }>;
}) {
  return (
    <div style={summaryPanelStyle}>
      <div style={summaryTitleStyle}>{title}</div>
      <div style={summaryRowsStyle}>
        {items.length > 0 ? items.map((item) => (
          <button key={item.id} type="button" style={summaryRowStyle} onClick={item.onClick}>
            <span style={summaryLabelStyle}>{item.label || item.detail}</span>
            <span style={summaryDetailStyle}>{item.detail}</span>
          </button>
        )) : (
          <div style={emptyStyle}>{empty}</div>
        )}
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  background: "linear-gradient(135deg, #f8fafc 0%, #eef4f8 52%, #f7f8fb 100%)",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
  overflow: "hidden",
};

const managerSurfaceStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 12,
  padding: 16,
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const titleStackStyle: React.CSSProperties = { display: "grid", gap: 4, minWidth: 0 };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 820, letterSpacing: 0, color: "#111827" };
const metaStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 720 };

function refreshButtonStyle(accent: string): React.CSSProperties {
  return {
    minHeight: 34,
    border: "1px solid transparent",
    borderRadius: 8,
    background: `linear-gradient(145deg, rgba(255,255,255,0.96), rgba(247,248,252,0.86)) padding-box, linear-gradient(135deg, ${accent}, rgba(183,124,255,0.68)) border-box`,
    color: "#111827",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: 760,
    padding: "0 12px",
    boxShadow: "7px 7px 16px rgba(174, 174, 192, 0.22), -7px -7px 16px rgba(255, 255, 255, 0.88), inset 1px 1px 0 rgba(255,255,255,0.86)",
  };
}

const errorStyle: React.CSSProperties = {
  color: "#be123c",
  border: "1px solid rgba(225, 29, 72, 0.22)",
  borderRadius: 8,
  background: "linear-gradient(135deg, rgba(255, 241, 242, 0.96), rgba(255, 247, 237, 0.72))",
  padding: "8px 10px",
  fontSize: 12,
  fontWeight: 700,
};

const contentGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(260px, 0.7fr) minmax(420px, 1.3fr)",
  gap: 14,
};

const treePanelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  border: "1px solid rgba(255, 255, 255, 0.78)",
  borderRadius: 8,
  background: "linear-gradient(180deg, rgba(251,251,253,0.96), rgba(242,244,248,0.92))",
  padding: 12,
  boxShadow: "12px 12px 28px rgba(174,174,192,0.24), -10px -10px 24px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.9)",
};

const detailPanelStyle: React.CSSProperties = {
  ...treePanelStyle,
  alignContent: "start",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 10,
  color: "#111827",
  fontSize: 13,
  fontWeight: 820,
};

const panelHeaderMetaStyle: React.CSSProperties = { color: "#64748b", fontSize: 10.5, fontWeight: 720 };
const treeScrollStyle: React.CSSProperties = { minHeight: 0, overflow: "auto", display: "grid", alignContent: "start", gap: 5, paddingRight: 4 };

function treeRowFrameStyle(depth: number, selected: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 34,
    display: "grid",
    gridTemplateColumns: "24px minmax(0, 1fr)",
    alignItems: "center",
    paddingLeft: depth * 15,
    border: "1px solid transparent",
    borderRadius: 8,
    background: selected
      ? "linear-gradient(135deg, rgba(255,255,255,0.92), rgba(230,252,255,0.48) 48%, rgba(247,239,255,0.58)) padding-box, linear-gradient(135deg, rgba(92,238,255,0.52), rgba(183,124,255,0.44)) border-box"
      : "transparent",
    boxShadow: selected ? "inset 1px 1px 0 rgba(255,255,255,0.82), 0 7px 16px rgba(96,165,250,0.08)" : undefined,
  };
}

const disclosureButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "#64748b",
  cursor: "pointer",
  fontSize: 18,
  padding: 0,
};

const treeRowButtonStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  display: "grid",
  gridTemplateColumns: "16px minmax(0, 1fr)",
  alignItems: "center",
  gap: 8,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 720,
  textAlign: "left",
  padding: "6px 8px 6px 0",
};

function treeIconStyle(kind: AccountTreeRow["kind"]): React.CSSProperties {
  return {
    width: kind === "account" ? 10 : 13,
    height: kind === "account" ? 10 : 11,
    border: kind === "account" ? "2px solid #14b8a6" : "1.5px solid #64748b",
    borderRadius: kind === "account" ? 999 : 3,
    background: kind === "root" ? "#f97316" : kind === "folder" ? "#e2e8f0" : "rgba(20, 184, 166, 0.16)",
  };
}

const treeLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const createGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 };
const editGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr)) auto", gap: 10, alignItems: "end", borderTop: "1px solid rgba(148, 163, 184, 0.18)", paddingTop: 12 };
const fieldStyle: React.CSSProperties = { minWidth: 0, display: "grid", gap: 6 };
const fieldLabelStyle: React.CSSProperties = { color: "#475569", fontSize: 10.5, fontWeight: 780 };
const inputActionStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8 };

const inputStyle: React.CSSProperties = {
  minWidth: 0,
  width: "100%",
  height: 38,
  border: "1px solid rgba(255,255,255,0.78)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(247,248,252,0.86))",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 650,
  outline: "none",
  padding: "0 10px",
  boxShadow: "inset 3px 3px 7px rgba(174,174,192,0.16), inset -3px -3px 7px rgba(255,255,255,0.88)",
};

const selectStyle: React.CSSProperties = { ...inputStyle, padding: "0 8px" };

const smallButtonStyle: React.CSSProperties = {
  minHeight: 38,
  border: "1px solid rgba(255,255,255,0.78)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.94), rgba(247,248,252,0.86))",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 780,
  padding: "0 12px",
  boxShadow: "5px 5px 12px rgba(174,174,192,0.20), -5px -5px 12px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255,255,255,0.82)",
};

const dangerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  borderColor: "rgba(225,29,72,0.28)",
  color: "#9f1239",
  background: "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(255,241,242,0.82))",
};

const summaryGridStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 10,
  borderTop: "1px solid rgba(148, 163, 184, 0.18)",
  paddingTop: 12,
};

const summaryPanelStyle: React.CSSProperties = {
  minHeight: 160,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  border: "1px solid rgba(255,255,255,0.78)",
  borderRadius: 8,
  background: "linear-gradient(145deg, rgba(255,255,255,0.80), rgba(241,245,249,0.68))",
  padding: 10,
  boxShadow: "inset 3px 3px 7px rgba(174,174,192,0.14), inset -3px -3px 7px rgba(255,255,255,0.84)",
};

const summaryTitleStyle: React.CSSProperties = { color: "#111827", fontSize: 12, fontWeight: 800 };
const summaryRowsStyle: React.CSSProperties = { display: "grid", alignContent: "start", gap: 6, minHeight: 0, overflow: "auto" };
const summaryRowStyle: React.CSSProperties = { minWidth: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 2, border: "1px solid rgba(100,116,139,0.12)", borderRadius: 8, background: "rgba(255,255,255,0.66)", color: "#111827", cursor: "pointer", font: "inherit", textAlign: "left", padding: "7px 8px" };
const summaryLabelStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 760 };
const summaryDetailStyle: React.CSSProperties = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 10, fontWeight: 650 };
const emptyStyle: React.CSSProperties = { color: "#64748b", fontSize: 11, fontWeight: 650, padding: 6 };

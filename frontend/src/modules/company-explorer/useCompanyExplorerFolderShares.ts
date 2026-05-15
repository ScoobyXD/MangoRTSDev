import { useCallback, useState } from "react";
import type {
  CompanyExplorerFolderShare,
  CompanyExplorerFolderShareDialog,
  CompanyExplorerFolderShareInviteResponse,
  CompanyExplorerFolderSharesResponse,
} from "./CompanyExplorerContentModel";
import type { CompanyExplorerShareTarget } from "./companyExplorerTypes";

type CompanyExplorerRequestJSON = <T>(path: string, init?: RequestInit) => Promise<T>;

export function useCompanyExplorerFolderShares(
  companyID: string,
  requestJSON: CompanyExplorerRequestJSON,
): {
  folderShareDialog: CompanyExplorerFolderShareDialog | null;
  openFolderShareDialog: (target: CompanyExplorerShareTarget) => void;
  updateFolderShareEmail: (email: string) => void;
  closeFolderShareDialog: () => void;
  submitFolderShare: () => Promise<void>;
  removeFolderShare: (share: CompanyExplorerFolderShare) => Promise<void>;
  refreshFolderShares: () => void;
} {
  const [folderShareDialog, setFolderShareDialog] = useState<CompanyExplorerFolderShareDialog | null>(null);

  const folderSharesPath = useCallback((folderID: string): string => (
    `/v1/company-explorer/folders/${encodeURIComponent(folderID)}/shares?company_id=${encodeURIComponent(companyID)}`
  ), [companyID]);

  const loadFolderShares = useCallback(async (folderID: string) => {
    const payload = await requestJSON<CompanyExplorerFolderSharesResponse>(folderSharesPath(folderID));
    return payload.shares ?? [];
  }, [folderSharesPath, requestJSON]);

  const openFolderShareDialog = useCallback((target: CompanyExplorerShareTarget) => {
    setFolderShareDialog({
      folderID: target.folderID,
      label: target.label,
      email: "",
      shares: [],
      loading: true,
      busy: false,
      error: "",
      message: "",
      invitationToken: "",
    });
    void (async () => {
      try {
        const shares = await loadFolderShares(target.folderID);
        setFolderShareDialog((current) => (
          current?.folderID === target.folderID
            ? { ...current, shares, loading: false, error: "" }
            : current
        ));
      } catch (err) {
        setFolderShareDialog((current) => (
          current?.folderID === target.folderID
            ? { ...current, loading: false, error: err instanceof Error ? err.message : "failed_to_load_folder_shares" }
            : current
        ));
      }
    })();
  }, [loadFolderShares]);

  const updateFolderShareEmail = useCallback((email: string) => {
    setFolderShareDialog((current) => (
      current ? { ...current, email, error: "", message: "", invitationToken: "" } : current
    ));
  }, []);

  const closeFolderShareDialog = useCallback(() => {
    setFolderShareDialog(null);
  }, []);

  const submitFolderShare = useCallback(async () => {
    const current = folderShareDialog;
    if (!current) return;
    const email = current.email.trim().toLowerCase();
    if (!email) {
      setFolderShareDialog({ ...current, error: "email_required", message: "", invitationToken: "" });
      return;
    }
    setFolderShareDialog({ ...current, busy: true, error: "", message: "", invitationToken: "" });
    try {
      const payload = await requestJSON<CompanyExplorerFolderShareInviteResponse>(folderSharesPath(current.folderID), {
        method: "POST",
        body: JSON.stringify({ company_id: companyID, email }),
      });
      const share = payload.share;
      setFolderShareDialog((latest) => {
        if (!latest || latest.folderID !== current.folderID) return latest;
        const shares = share
          ? [
            ...latest.shares.filter((item) => item.email !== share.email),
            share,
          ].sort((a, b) => (a.status === b.status ? a.email.localeCompare(b.email) : a.status.localeCompare(b.status)))
          : latest.shares;
        return {
          ...latest,
          email: "",
          shares,
          busy: false,
          error: "",
          message: share?.status === "active" ? "Folder shared." : "Invitation created.",
          invitationToken: payload.invitation?.token ?? "",
        };
      });
    } catch (err) {
      setFolderShareDialog((latest) => (
        latest?.folderID === current.folderID
          ? { ...latest, busy: false, error: err instanceof Error ? err.message : "failed_to_share_folder", message: "", invitationToken: "" }
          : latest
      ));
    }
  }, [companyID, folderShareDialog, folderSharesPath, requestJSON]);

  const removeFolderShare = useCallback(async (share: CompanyExplorerFolderShare) => {
    const current = folderShareDialog;
    if (!current) return;
    setFolderShareDialog({ ...current, busy: true, error: "", message: "", invitationToken: "" });
    try {
      await requestJSON<{ status?: string }>(`${folderSharesPath(current.folderID)}&email=${encodeURIComponent(share.email)}`, {
        method: "DELETE",
      });
      setFolderShareDialog((latest) => (
        latest?.folderID === current.folderID
          ? {
            ...latest,
            shares: latest.shares.filter((item) => item.email !== share.email),
            busy: false,
            error: "",
            message: "Share removed.",
            invitationToken: "",
          }
          : latest
      ));
    } catch (err) {
      setFolderShareDialog((latest) => (
        latest?.folderID === current.folderID
          ? { ...latest, busy: false, error: err instanceof Error ? err.message : "failed_to_remove_folder_share", message: "", invitationToken: "" }
          : latest
      ));
    }
  }, [folderShareDialog, folderSharesPath, requestJSON]);

  const refreshFolderShares = useCallback(() => {
    const current = folderShareDialog;
    if (!current) return;
    const currentFolderID = current.folderID;
    setFolderShareDialog({ ...current, loading: true, error: "", message: "", invitationToken: "" });
    void (async () => {
      try {
        const shares = await loadFolderShares(currentFolderID);
        setFolderShareDialog((latest) => (
          latest?.folderID === currentFolderID ? { ...latest, shares, loading: false } : latest
        ));
      } catch (err) {
        setFolderShareDialog((latest) => (
          latest?.folderID === currentFolderID
            ? { ...latest, loading: false, error: err instanceof Error ? err.message : "failed_to_load_folder_shares" }
            : latest
        ));
      }
    })();
  }, [folderShareDialog, loadFolderShares]);

  return {
    folderShareDialog,
    openFolderShareDialog,
    updateFolderShareEmail,
    closeFolderShareDialog,
    submitFolderShare,
    removeFolderShare,
    refreshFolderShares,
  };
}

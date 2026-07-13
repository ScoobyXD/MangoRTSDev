import React from "react";
import { AppModalPortal } from "../../app/AppModalPortal";
import { ConfirmActionMenu, type ConfirmActionMenuPosition } from "../../app/ConfirmActionMenu";
import type { CompanyExplorerDeleteConfirmationSummary } from "./CompanyExplorerContentModel";
import type { ExplorerDeleteTargetWithLabel } from "./companyExplorerTypes";

type CompanyExplorerDeleteBlockedDialogProps = {
  message: string;
  isDarkTheme: boolean;
  onClose: () => void;
};

export function CompanyExplorerDeleteBlockedDialog({ message, isDarkTheme, onClose }: CompanyExplorerDeleteBlockedDialogProps): React.ReactElement {
  return (
    <AppModalPortal onRequestClose={onClose}>
    <div role="presentation" style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 1, display: "grid", placeItems: "center" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="company-explorer-delete-blocked-title" style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(100,116,139,0.45)", background: isDarkTheme ? "#11161b" : "rgba(255,255,255,0.95)", color: isDarkTheme ? "#f6f8fb" : "#111111", padding: 12, display: "grid", gap: 10 }}>
        <div id="company-explorer-delete-blocked-title" style={{ fontSize: 12, fontWeight: 700 }}>Folder cannot be deleted</div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#d6e0e6" : "#222222" }}>{message}</div>
        <button
          type="button"
          onClick={onClose}
          style={{ border: "1px solid rgba(100,116,139,0.45)", background: "#fff", color: "#111111", cursor: "pointer", fontWeight: 700, minHeight: 28 }}
        >
          OK
        </button>
      </div>
    </div>
    </AppModalPortal>
  );
}

type CompanyExplorerDeleteConfirmationDialogProps = {
  targets: ExplorerDeleteTargetWithLabel[];
  summary: CompanyExplorerDeleteConfirmationSummary;
  acknowledged: boolean;
  isDarkTheme: boolean;
  position?: ConfirmActionMenuPosition | null;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onConfirm: (targets: ExplorerDeleteTargetWithLabel[], confirmationDisplayName: string) => void;
  onCancel: () => void;
};

export function CompanyExplorerDeleteConfirmationDialog({
  targets,
  summary,
  acknowledged,
  isDarkTheme,
  position,
  onAcknowledgedChange,
  onConfirm,
  onCancel,
}: CompanyExplorerDeleteConfirmationDialogProps): React.ReactElement {
  const confirmationDisabled = summary.requiresFolderAcknowledgement && !acknowledged;
  return (
    <ConfirmActionMenu
      title={summary.title}
      detail={(
        <>
          <div>{summary.detail}</div>
          <div style={{ marginTop: 5 }}>Selected: {summary.targetList}</div>
        </>
      )}
      position={position}
      isDarkTheme={isDarkTheme}
      confirmDisabled={confirmationDisabled}
      onConfirm={(confirmationDisplayName) => onConfirm(targets, confirmationDisplayName)}
      onCancel={onCancel}
    >
      {summary.requiresFolderAcknowledgement && (
        <label style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 7, alignItems: "start", fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#f6f8fb" : "#111111" }}>
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledgedChange(event.currentTarget.checked)}
            style={{ marginTop: 1 }}
          />
          <span>I understand that deleting this folder moves all contents inside of this folder to the Recycle Bin.</span>
        </label>
      )}
    </ConfirmActionMenu>
  );
}

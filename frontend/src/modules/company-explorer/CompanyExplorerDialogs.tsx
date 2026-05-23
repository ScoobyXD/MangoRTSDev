import React from "react";
import type {
  CompanyExplorerDeleteConfirmationSummary,
  CompanyExplorerFolderShare,
  CompanyExplorerFolderShareDialog,
} from "./CompanyExplorerContentModel";
import type { ExplorerDeleteTargetWithLabel } from "./companyExplorerTypes";

type CompanyExplorerFolderShareDialogViewProps = {
  dialog: CompanyExplorerFolderShareDialog;
  isDarkTheme: boolean;
  ruleColor: string;
  rowRuleColor: string;
  onEmailChange: (email: string) => void;
  onSubmit: () => void;
  onRemoveShare: (share: CompanyExplorerFolderShare) => void;
  onClose: () => void;
  onRefresh: () => void;
};

export function CompanyExplorerFolderShareDialogView({
  dialog,
  isDarkTheme,
  ruleColor,
  rowRuleColor,
  onEmailChange,
  onSubmit,
  onRemoveShare,
  onClose,
  onRefresh,
}: CompanyExplorerFolderShareDialogViewProps): React.ReactElement {
  const actionDisabled = dialog.busy || !dialog.email.trim();
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center", padding: 12 }}>
      <div style={{ width: "min(520px, 94%)", maxHeight: "min(680px, 92vh)", overflow: "auto", borderRadius: 8, border: "1px solid rgba(100,116,139,0.45)", background: isDarkTheme ? "#11161b" : "rgba(255,255,255,0.96)", color: isDarkTheme ? "#f6f8fb" : "#111111", padding: 14, display: "grid", gap: 12, boxShadow: "0 18px 44px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "grid", gap: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 800 }}>Share folder</div>
          <div style={{ fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#b8c4cc" : "#333333", overflowWrap: "anywhere" }}>{dialog.label}</div>
        </div>
        <form
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: 8, alignItems: "stretch" }}
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <input
            value={dialog.email}
            onChange={(event) => onEmailChange(event.target.value.toLowerCase())}
            type="email"
            placeholder="Email"
            disabled={dialog.busy}
            style={{ minHeight: 32, minWidth: 0, border: `1px solid ${ruleColor}`, background: isDarkTheme ? "#0f1216" : "#ffffff", color: isDarkTheme ? "#f6f8fb" : "#111111", padding: "0 9px", fontSize: 12, boxSizing: "border-box" }}
          />
          <button
            type="submit"
            disabled={actionDisabled}
            style={{ minHeight: 32, border: "1px solid rgba(100,116,139,0.55)", background: "#475569", color: "#ffffff", cursor: actionDisabled ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 800, padding: "0 12px", opacity: actionDisabled ? 0.6 : 1 }}
          >
            {dialog.busy ? "Sharing" : "Invite"}
          </button>
        </form>
        {dialog.error && <div style={{ fontSize: 11, color: "#b00020", lineHeight: 1.35 }}>{dialog.error}</div>}
        {dialog.message && <div style={{ fontSize: 11, color: isDarkTheme ? "#86efac" : "#166534", lineHeight: 1.35 }}>{dialog.message}</div>}
        {dialog.invitationToken && (
          <div style={{ fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#d6e0e6" : "#222222", border: `1px solid ${rowRuleColor}`, padding: 8, overflowWrap: "anywhere" }}>
            Invite token: {dialog.invitationToken}
          </div>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: isDarkTheme ? "#d6e0e6" : "#222222" }}>People</div>
          {dialog.loading ? (
            <div style={{ fontSize: 11, color: isDarkTheme ? "#b8c4cc" : "#333333" }}>Loading</div>
          ) : dialog.shares.length === 0 ? (
            <div style={{ fontSize: 11, color: isDarkTheme ? "#b8c4cc" : "#333333" }}>No shares yet.</div>
          ) : (
            <div style={{ display: "grid", border: `1px solid ${rowRuleColor}` }}>
              {dialog.shares.map((share) => (
                <div key={share.email} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 8, alignItems: "center", minHeight: 34, padding: "6px 8px", borderTop: `1px solid ${rowRuleColor}` }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12 }}>{share.email}</span>
                    <span style={{ fontSize: 10, fontWeight: 800, color: share.status === "active" ? (isDarkTheme ? "#cbd5e1" : "#334155") : (isDarkTheme ? "#cbd5e1" : "#475569") }}>{share.status}</span>
                  <button
                    type="button"
                    onClick={() => onRemoveShare(share)}
                    disabled={dialog.busy}
                    style={{ minHeight: 24, border: "1px solid rgba(100,116,139,0.35)", background: isDarkTheme ? "#111827" : "#fff", color: "#334155", cursor: dialog.busy ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 800, padding: "0 8px", opacity: dialog.busy ? 0.6 : 1 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ minHeight: 30, border: "1px solid rgba(100,116,139,0.45)", background: "#fff", color: "#111111", cursor: "pointer", fontSize: 12, fontWeight: 800 }}
          >
            Done
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={dialog.loading || dialog.busy}
            style={{ minHeight: 30, border: `1px solid ${ruleColor}`, background: isDarkTheme ? "#0f1216" : "#ffffff", color: isDarkTheme ? "#f6f8fb" : "#111111", cursor: dialog.loading || dialog.busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 800, opacity: dialog.loading || dialog.busy ? 0.6 : 1 }}
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

type CompanyExplorerDeleteBlockedDialogProps = {
  message: string;
  isDarkTheme: boolean;
  onClose: () => void;
};

export function CompanyExplorerDeleteBlockedDialog({ message, isDarkTheme, onClose }: CompanyExplorerDeleteBlockedDialogProps): React.ReactElement {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(100,116,139,0.45)", background: isDarkTheme ? "#11161b" : "rgba(255,255,255,0.95)", color: isDarkTheme ? "#f6f8fb" : "#111111", padding: 12, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>Folder cannot be deleted</div>
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
  );
}

type CompanyExplorerDeleteConfirmationDialogProps = {
  targets: ExplorerDeleteTargetWithLabel[];
  summary: CompanyExplorerDeleteConfirmationSummary;
  acknowledged: boolean;
  isDarkTheme: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onConfirm: (targets: ExplorerDeleteTargetWithLabel[]) => void;
  onCancel: () => void;
};

export function CompanyExplorerDeleteConfirmationDialog({
  targets,
  summary,
  acknowledged,
  isDarkTheme,
  onAcknowledgedChange,
  onConfirm,
  onCancel,
}: CompanyExplorerDeleteConfirmationDialogProps): React.ReactElement {
  const confirmationDisabled = summary.requiresFolderAcknowledgement && !acknowledged;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.28)", zIndex: 120, display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(420px, 90%)", borderRadius: 10, border: "1px solid rgba(100,116,139,0.45)", background: isDarkTheme ? "#11161b" : "rgba(255,255,255,0.95)", color: isDarkTheme ? "#f6f8fb" : "#111111", padding: 12, display: "grid", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700 }}>
          {summary.title}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#b8c4cc" : "#2e2e2e" }}>
          {summary.detail}
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#d6e0e6" : "#222222" }}>
          Selected: {summary.targetList}
        </div>
        {summary.requiresFolderAcknowledgement && (
          <label style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 7, alignItems: "start", fontSize: 11, lineHeight: 1.35, color: isDarkTheme ? "#f6f8fb" : "#111111" }}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => onAcknowledgedChange(event.currentTarget.checked)}
              style={{ marginTop: 1 }}
            />
            <span>I understand that deleting this folder deletes all contents inside of this folder.</span>
          </label>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            type="button"
            onClick={() => onConfirm(targets)}
            disabled={confirmationDisabled}
            style={{ border: "1px solid rgba(100,116,139,0.45)", background: "#fff", color: "#111111", cursor: confirmationDisabled ? "not-allowed" : "pointer", fontWeight: 700, opacity: confirmationDisabled ? 0.55 : 1 }}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ border: "1px solid #64748b", boxShadow: "inset 0 0 0 1px rgba(100,116,139,0.25), 0 0 10px rgba(100,116,139,0.18)", color: "#334155", background: "#fff", cursor: "pointer", fontWeight: 700 }}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

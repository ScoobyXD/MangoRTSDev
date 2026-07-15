import React from "react";
import type { EditorSyncBlock } from "./editorProjectionSync";

type EditorSyncBlockingModalProps = {
  block: EditorSyncBlock | null;
  accent: string;
  onRetry: () => void;
  onUseServer: () => void;
  onKeepLocalAgainstLatest: () => void;
};

export const EditorSyncBlockingModal: React.FC<EditorSyncBlockingModalProps> = ({
  block,
  accent,
  onRetry,
  onUseServer,
  onKeepLocalAgainstLatest,
}) => {
  if (!block) return null;
  const conflict = block.reason === "revision_conflict";
  const authenticationRequired = block.reason === "authentication_required";
  const serverDeleted = Boolean(block.current?.is_deleted);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Editor save blocked"
      style={{ position: "fixed", inset: 0, zIndex: 20000, display: "grid", placeItems: "center", padding: 24, background: "rgba(15,23,42,0.78)", backdropFilter: "blur(4px)" }}
    >
      <section style={{ width: "min(760px, 96vw)", maxHeight: "90vh", overflow: "auto", border: "3px solid #b91c1c", borderRadius: 18, background: "#fff", color: "#111827", boxShadow: "0 30px 90px rgba(0,0,0,0.5)", padding: 28, display: "grid", gap: 18 }}>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ color: "#b91c1c", fontSize: 13, fontWeight: 950, letterSpacing: "0.08em", textTransform: "uppercase" }}>Editing and saving are blocked</div>
          <h2 style={{ margin: 0, fontSize: 25, lineHeight: 1.15 }}>{conflict ? serverDeleted ? "The server version was deleted" : "A newer server version exists" : authenticationRequired ? "Your session can no longer save" : "This draft has not been saved"}</h2>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.55 }}>{block.message}</p>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, color: "#475569" }}>Your local draft is retained in this browser for this user, company, and document. Mango will not overwrite the server automatically.</p>
        </div>
        {conflict && block.current && (
          <div style={{ border: "1px solid #cbd5e1", borderRadius: 12, background: "#f8fafc", padding: 14, display: "grid", gap: 7 }}>
            <strong>{serverDeleted ? "Server deletion" : "Server"} revision {block.current.revision ?? "unknown"}</strong>
            {!serverDeleted && <div style={{ maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", font: "12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace" }}>{block.current.information}</div>}
          </div>
        )}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {conflict && block.current && <button type="button" onClick={onUseServer} style={buttonStyle("#fff", "#334155")}>{serverDeleted ? "Use server deletion" : "Use server version"}</button>}
          {conflict && <button type="button" onClick={onKeepLocalAgainstLatest} style={buttonStyle("#fff", accent)}>Keep local draft and recheck</button>}
          {!conflict && <button type="button" onClick={onRetry} style={buttonStyle("#fff", accent)}>{authenticationRequired ? "Retry after signing in" : "Retry save"}</button>}
          {authenticationRequired && <button type="button" onClick={() => window.location.reload()} style={buttonStyle("#fff", "#334155")}>Refresh after signing in</button>}
        </div>
      </section>
    </div>
  );
};

function buttonStyle(color: string, background: string): React.CSSProperties {
  return { border: 0, borderRadius: 10, minHeight: 42, padding: "0 16px", color, background, cursor: "pointer", fontSize: 13, fontWeight: 900 };
}

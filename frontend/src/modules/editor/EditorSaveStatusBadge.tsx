import React from "react";
import type { MangoTiptapSaveState } from "./tiptap/mangoTiptapSync.js";

export type EditorSaveState = MangoTiptapSaveState;

export function editorSaveNeedsFailureAttention(state?: EditorSaveState): boolean {
  return state?.status === "failed" || Boolean(state?.unresolvedFailure);
}

const presentation = {
  pending: { label: "Pending", color: "#92400e", background: "#fffbeb", border: "#f59e0b" },
  saving: { label: "Saving", color: "#1d4ed8", background: "#eff6ff", border: "#60a5fa" },
  saved: { label: "Saved", color: "#166534", background: "#f0fdf4", border: "#4ade80" },
  failed: { label: "Save failed", color: "#b91c1c", background: "#fef2f2", border: "#f87171" },
} as const;

const SaveStateIcon: React.FC<{ status: EditorSaveState["status"] }> = ({ status }) => {
  if (status === "saving") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12">
        <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="23 12">
          <animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite" />
        </circle>
      </svg>
    );
  }
  if (status === "saved") {
    return <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12"><path d="m3 8.3 3 3L13 4.7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  }
  if (status === "failed") {
    return <svg aria-hidden="true" viewBox="0 0 16 16" width="12" height="12"><path d="M8 3v6m0 3h.01" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>;
  }
  return <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />;
};

export const EditorSaveStatusBadge: React.FC<{
  state?: EditorSaveState;
  compact?: boolean;
}> = ({ state = { status: "saved" }, compact = false }) => {
  const view = presentation[state.status];
  const title = state.message || (
    state.status === "saved" && state.updatedTimestamp
      ? `Saved to the database at ${new Date(state.updatedTimestamp).toLocaleString()}`
      : view.label
  );
  return (
    <span
      role="status"
      aria-live="polite"
      data-editor-save-status={state.status}
      title={title}
      style={{
        flex: "0 0 auto",
        minHeight: 20,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: compact ? "1px 5px" : "2px 7px",
        border: `1px solid ${view.border}`,
        borderRadius: 6,
        background: view.background,
        color: view.color,
        fontSize: compact ? 9.5 : 10.5,
        fontWeight: 900,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      <SaveStateIcon status={state.status} />
      {view.label}
    </span>
  );
};
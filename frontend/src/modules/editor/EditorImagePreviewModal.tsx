import React from "react";
import { AppModalPortal } from "../../app/AppModalPortal.js";
import { UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE } from "./UnifiedNodeShell.js";

export type EditorImagePreviewModalProps = {
  label: string;
  src: string;
  emptyLabel?: string;
  copyable?: boolean;
  onClose: () => void;
  onDownload: () => void;
};

/** Shared fullscreen image viewer for editor images and chat image attachments. */
export const EditorImagePreviewModal: React.FC<EditorImagePreviewModalProps> = ({
  label,
  src,
  emptyLabel = "Preview unavailable",
  copyable = false,
  onClose,
  onDownload,
}) => (
  <AppModalPortal onRequestClose={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      data-mango-copyable-image={copyable ? "true" : undefined}
      data-mango-image-preview-backdrop="translucent"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1,
        background: "rgba(15,23,42,0.82)",
        display: "grid",
        placeItems: "center",
        padding: 12,
      }}
    >
      <button
        type="button"
        aria-label="Close image preview"
        title="Close image preview"
        data-mango-image-preview-close="true"
        onClick={onClose}
        style={{
          ...UNIFIED_NODE_SHELL_CLOSE_BUTTON_TEMPLATE_STYLE,
          position: "fixed",
          top: 18,
          right: 18,
          zIndex: 2,
        }}
      >
        X
      </button>
      <div style={{ position: "relative", display: "inline-grid", placeItems: "center", lineHeight: 0 }}>
        {src ? (
          <img
            alt={label}
            src={src}
            style={{
              width: "auto",
              height: "auto",
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "calc(100vh - 32px)",
              objectFit: "contain",
              display: "block",
            }}
          />
        ) : (
          <div style={{ minWidth: "min(420px, calc(100vw - 32px))", minHeight: "min(320px, calc(100vh - 32px))", display: "grid", placeItems: "center", color: "#ffffff", fontSize: 12, fontWeight: 850, lineHeight: 1.35 }}>
            {emptyLabel}
          </div>
        )}
        <button
          type="button"
          aria-label="Download image"
          title="Download image"
          data-mango-image-preview-download="true"
          onClick={onDownload}
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            width: 36,
            height: 36,
            border: "1px solid rgba(255,255,255,0.82)",
            borderRadius: 8,
            background: "rgba(15,23,42,0.86)",
            color: "#ffffff",
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
            boxShadow: "0 6px 20px rgba(0,0,0,0.38)",
            fontSize: 20,
            lineHeight: 1,
          }}
        >
          ⇩
        </button>
      </div>
    </div>
  </AppModalPortal>
);

import React from "react";
import FrameRightClickMenu from "./framerightclickmenu";

export type ConfirmActionMenuPosition = {
  x: number;
  y: number;
};

export function confirmMenuPositionFromElement(element: Element): ConfirmActionMenuPosition {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.right + 8,
    y: rect.top,
  };
}

type ConfirmActionMenuProps = {
  title: React.ReactNode;
  detail?: React.ReactNode;
  position?: ConfirmActionMenuPosition | null;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  isDarkTheme?: boolean;
  children?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export const ConfirmActionMenu: React.FC<ConfirmActionMenuProps> = ({
  title,
  detail,
  position,
  confirmLabel = "Yes",
  cancelLabel = "No",
  confirmDisabled = false,
  isDarkTheme = false,
  children,
  onConfirm,
  onCancel,
}) => {
  const viewportWidth = typeof window === "undefined" ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 768 : window.innerHeight;
  const x = position?.x ?? Math.max(24, Math.round(viewportWidth / 2 - 170));
  const y = position?.y ?? Math.max(24, Math.round(viewportHeight / 2 - 68));
  const panelText = isDarkTheme ? "#f6f8fb" : "#111827";
  const mutedText = isDarkTheme ? "#b8c4cc" : "#334155";
  const buttonSurface = isDarkTheme ? "rgba(255,255,255,0.08)" : "#ffffff";

  return (
    <FrameRightClickMenu x={x} y={y} onClose={onCancel} width="min(340px, calc(100vw - 24px))" minWidth={260}>
      <div style={{ padding: "8px 10px 9px", display: "grid", gap: 8, color: panelText }}>
        <div style={{ fontSize: 12, fontWeight: 800, lineHeight: 1.35 }}>
          {title}
        </div>
        {detail && (
          <div style={{ fontSize: 11, lineHeight: 1.35, color: mutedText }}>
            {detail}
          </div>
        )}
        {children}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            style={{
              minHeight: 26,
              border: "1px solid rgba(100,116,139,0.45)",
              borderRadius: 8,
              background: buttonSurface,
              color: panelText,
              cursor: confirmDisabled ? "not-allowed" : "pointer",
              fontWeight: 800,
              opacity: confirmDisabled ? 0.55 : 1,
            }}
          >
            {confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{
              minHeight: 26,
              border: "1px solid #64748b",
              borderRadius: 8,
              boxShadow: "inset 0 0 0 1px rgba(100,116,139,0.25), 0 0 10px rgba(100,116,139,0.18)",
              color: isDarkTheme ? "#d6e0e6" : "#334155",
              background: buttonSurface,
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </FrameRightClickMenu>
  );
};

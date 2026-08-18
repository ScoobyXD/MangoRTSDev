import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "./NodeWorkspaceSurfaceShared.js";

type UniversalLinkerControlsProps = {
  busy: boolean;
  pickerOpen: boolean;
  showCreateFloatingNode?: boolean;
  createFloatingNodeAriaLabel?: string;
  openPickerAriaLabel: string;
  pickerLauncherRef?: React.Ref<HTMLButtonElement>;
  onCreateFloatingNode?: () => void;
  onTogglePicker: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

function FloatingNodeIcon() {
  return (
    <span aria-hidden="true" style={{ width: 22, height: 22, position: "relative", display: "grid", placeItems: "center" }}>
      <ExplorerRowIcon kind="node" />
      <span style={{ position: "absolute", right: -2, top: -3, width: 12, height: 12, display: "grid", placeItems: "center", borderRadius: "50%", border: "1px solid rgba(79,70,229,0.30)", background: "#ffffff", color: "#4f46e5", fontSize: 10, fontWeight: 950, lineHeight: 1 }}>+</span>
    </span>
  );
}

const universalLinkerControlsStyle: React.CSSProperties = {
  width: "clamp(205px, 28vw, 300px)",
  minWidth: 184,
  display: "grid",
  gridTemplateColumns: "34px minmax(0, 1fr)",
  gap: 6,
};

export function UniversalLinkerControls({
  busy,
  pickerOpen,
  showCreateFloatingNode = true,
  createFloatingNodeAriaLabel,
  openPickerAriaLabel,
  pickerLauncherRef,
  onCreateFloatingNode,
  onTogglePicker,
}: UniversalLinkerControlsProps) {
  return (
    <div
      data-universal-linker-controls="true"
      style={{ ...universalLinkerControlsStyle, gridTemplateColumns: showCreateFloatingNode ? universalLinkerControlsStyle.gridTemplateColumns : "minmax(0, 1fr)" }}
    >
      {showCreateFloatingNode ? <button
        type="button"
        data-universal-linker-floating-node-button="true"
        aria-label={createFloatingNodeAriaLabel ?? "Create floating node"}
        title="Create floating node"
        disabled={busy}
        onClick={onCreateFloatingNode}
        style={{ width: 34, height: 32, display: "grid", placeItems: "center", border: "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 10, background: EDITOR_NEU_SURFACE, color: "#4f46e5", cursor: busy ? "wait" : "pointer", boxShadow: EDITOR_NEU_SHADOW }}
      >
        <FloatingNodeIcon />
      </button> : null}
      <button
        ref={pickerLauncherRef}
        type="button"
        data-universal-linker-picker-button="true"
        aria-label={openPickerAriaLabel}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        disabled={busy}
        onClick={onTogglePicker}
        style={{ width: "100%", height: 32, minWidth: 0, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 7, border: pickerOpen ? "1px solid transparent" : "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 10, background: pickerOpen ? EDITOR_NEU_ACTIVE_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box" : EDITOR_NEU_SURFACE, color: "#334155", padding: "0 10px", cursor: busy ? "wait" : "text", textAlign: "left", boxShadow: pickerOpen ? "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW }}
      >
        <strong aria-hidden="true" style={{ color: "#7c3aed", fontSize: 14, fontWeight: 950 }}>##</strong>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>Ready! Open universal linker</span>
      </button>
    </div>
  );
}

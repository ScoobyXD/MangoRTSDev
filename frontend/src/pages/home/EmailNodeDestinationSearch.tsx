import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import { type EditorEntityLink, type EditorEntityLinkRequest } from "../../modules/editor/editorEntityLinks.js";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "../../modules/editor/NodeWorkspaceSurfaceShared.js";
import {
  UniversalEntityPicker,
  type UniversalEntityPickerAnchor,
  type UniversalEntityPickerMode,
} from "../../modules/editor/UniversalEntityPicker.js";
import type { LogicGateRecord } from "../../modules/logic-gates/types.js";
import type { EmailNodeDestination } from "./emailCollaborationChat.js";
import { INBOX_PRIORITIES } from "./homeConstants.js";

type EmailNodeDestinationSearchProps = {
  companyID: string;
  requestJSON: EditorEntityLinkRequest;
  logicGates: LogicGateRecord[];
  busy: boolean;
  actionNotice?: string;
  onSubmit: (destination: EmailNodeDestination) => void;
  onOpenEntity: (entity: EditorEntityLink) => void;
  onError: (message: string) => void;
};

const EMAIL_PICKER_LINK_TARGET_TYPES = ["node", "logic_gate", "project"] as const;

const choiceGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 5,
  border: "1px solid " + EDITOR_NEU_SOFT_BORDER,
  borderRadius: 10,
  background: "rgba(248,250,252,0.72)",
  padding: 6,
  boxShadow: "inset 2px 2px 5px rgba(174,174,192,0.12), inset -2px -2px 5px rgba(255,255,255,0.84)",
};

function destinationChoiceStyle(selected: boolean): React.CSSProperties {
  return {
    minWidth: 0,
    minHeight: 31,
    display: "grid",
    gridTemplateColumns: "25px minmax(0, 1fr)",
    alignItems: "center",
    gap: 7,
    border: selected ? "1px solid transparent" : "1px solid " + EDITOR_NEU_SOFT_BORDER,
    borderRadius: 8,
    background: selected
      ? EDITOR_NEU_ACTIVE_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box"
      : EDITOR_NEU_SURFACE,
    color: selected ? "#4f46e5" : "#334155",
    padding: "4px 7px",
    textAlign: "left",
    cursor: "pointer",
    boxShadow: selected
      ? "inset 2px 2px 5px rgba(174,174,192,0.12), inset -2px -2px 5px rgba(255,255,255,0.88)"
      : EDITOR_NEU_SHADOW,
  };
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']")
    || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function FloatingNodeIcon() {
  return (
    <span aria-hidden="true" style={{ width: 22, height: 22, position: "relative", display: "grid", placeItems: "center" }}>
      <ExplorerRowIcon kind="node" />
      <span style={{ position: "absolute", right: -2, top: -3, width: 12, height: 12, display: "grid", placeItems: "center", borderRadius: "50%", border: "1px solid rgba(79,70,229,0.30)", background: "#ffffff", color: "#4f46e5", fontSize: 10, fontWeight: 950, lineHeight: 1 }}>+</span>
    </span>
  );
}

export function EmailNodeDestinationSearch({
  companyID,
  requestJSON,
  logicGates,
  busy,
  actionNotice = "",
  onSubmit,
  onOpenEntity,
  onError,
}: EmailNodeDestinationSearchProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const launcherRef = React.useRef<HTMLButtonElement | null>(null);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pickerAnchor, setPickerAnchor] = React.useState<UniversalEntityPickerAnchor>({ left: 24, top: 56 });
  const [pendingLink, setPendingLink] = React.useState<EditorEntityLink | null>(null);
  const [priority, setPriority] = React.useState("");
  const [projectLogicGateID, setProjectLogicGateID] = React.useState("");
  const selectedPriority = Number(priority);

  const closePicker = React.useCallback(() => setPickerOpen(false), []);
  const resetPendingLink = React.useCallback(() => {
    setPendingLink(null);
    setPriority("");
    setProjectLogicGateID("");
  }, []);
  const openPicker = React.useCallback(() => {
    if (busy) return;
    const bounds = launcherRef.current?.getBoundingClientRect();
    setPickerAnchor({ left: bounds?.left ?? 24, top: (bounds?.bottom ?? 49) + 7 });
    resetPendingLink();
    setPickerOpen(true);
  }, [busy, resetPendingLink]);

  React.useEffect(() => {
    const openUniversalEmailPicker = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "#" || event.metaKey || event.ctrlKey || event.altKey || busy) return;
      if (isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      openPicker();
    };
    document.addEventListener("keydown", openUniversalEmailPicker);
    return () => document.removeEventListener("keydown", openUniversalEmailPicker);
  }, [busy, openPicker]);

  React.useEffect(() => {
    if (!pendingLink) return undefined;
    const dismiss = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) resetPendingLink();
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [pendingLink, resetPendingLink]);

  const chooseEntity = React.useCallback(async (entity: EditorEntityLink, mode: UniversalEntityPickerMode) => {
    setPickerOpen(false);
    if (mode === "reference") {
      try {
        onOpenEntity(entity);
      } catch (cause) {
        onError(cause instanceof Error ? cause.message : "Unable to open this resource.");
      }
      return;
    }
    if (entity.entityType === "node") {
      onSubmit({ kind: "node", nodeID: entity.entityID });
      return;
    }
    setPriority("");
    setProjectLogicGateID("");
    setPendingLink(entity);
  }, [onError, onOpenEntity, onSubmit]);

  const submitPendingLink = React.useCallback((overrides: { priority?: number; projectLogicGateID?: string } = {}) => {
    if (!pendingLink || busy) return;
    const activePriority = overrides.priority ?? selectedPriority;
    const activeProjectLogicGateID = overrides.projectLogicGateID ?? projectLogicGateID;
    if (!Number.isInteger(activePriority) || activePriority < 1 || activePriority > 5) return;
    if (pendingLink.entityType === "logic_gate") {
      resetPendingLink();
      onSubmit({ kind: "logic_gate", logicGateID: pendingLink.entityID, priority: activePriority });
      return;
    }
    if (pendingLink.entityType === "project" && activeProjectLogicGateID) {
      resetPendingLink();
      onSubmit({ kind: "project", projectID: pendingLink.entityID, logicGateID: activeProjectLogicGateID, priority: activePriority });
    }
  }, [busy, onSubmit, pendingLink, projectLogicGateID, resetPendingLink, selectedPriority]);

  const createFloatingNode = () => {
    if (busy) return;
    setPickerOpen(false);
    resetPendingLink();
    onSubmit({ kind: "standalone" });
  };

  return (
    <div
      ref={wrapperRef}
      data-email-node-destination-search="true"
      style={{ position: "relative", flex: "0 1 300px", width: "clamp(205px, 28vw, 300px)", minWidth: 184, display: "grid", gridTemplateColumns: "34px minmax(0, 1fr)", gap: 6 }}
    >
      {actionNotice && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-email-action-success="true"
          style={{ position: "absolute", zIndex: 86, top: 0, right: "calc(100% + 9px)", width: "max-content", maxWidth: "min(240px, 34vw)", minHeight: 32, display: "grid", alignItems: "center", border: "1px solid rgba(34,197,94,0.42)", borderRadius: 10, background: "linear-gradient(145deg, rgba(240,253,244,0.98), rgba(220,252,231,0.96))", color: "#166534", padding: "6px 10px", fontSize: 11, fontWeight: 850, lineHeight: 1.25, boxShadow: "0 10px 22px rgba(22,101,52,0.18)", animation: "mango-pane-enter 180ms ease-out", pointerEvents: "none" }}
        >
          {actionNotice}
        </div>
      )}
      <button
        type="button"
        data-email-floating-node-button="true"
        aria-label="Create floating node from email"
        title="Create floating node"
        disabled={busy}
        onClick={createFloatingNode}
        style={{ width: 34, height: 32, display: "grid", placeItems: "center", border: "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 10, background: EDITOR_NEU_SURFACE, color: "#4f46e5", cursor: busy ? "wait" : "pointer", boxShadow: EDITOR_NEU_SHADOW }}
      >
        <FloatingNodeIcon />
      </button>
      <button
        ref={launcherRef}
        type="button"
        data-email-universal-picker-launcher="true"
        aria-label="Open universal email picker"
        aria-haspopup="dialog"
        aria-expanded={pickerOpen}
        disabled={busy}
        onClick={() => { if (pickerOpen) closePicker(); else openPicker(); }}
        style={{ width: "100%", height: 32, minWidth: 0, display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: 7, border: pickerOpen ? "1px solid transparent" : "1px solid " + EDITOR_NEU_SOFT_BORDER, borderRadius: 10, background: pickerOpen ? EDITOR_NEU_ACTIVE_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box" : EDITOR_NEU_SURFACE, color: "#334155", padding: "0 10px", cursor: busy ? "wait" : "text", textAlign: "left", boxShadow: pickerOpen ? "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.86)" : EDITOR_NEU_SHADOW }}
      >
        <strong aria-hidden="true" style={{ color: "#7c3aed", fontSize: 14, fontWeight: 950 }}>##</strong>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 800 }}>Ready! Open universal linker</span>
      </button>

      {pickerOpen && (
        <UniversalEntityPicker
          companyID={companyID}
          requestJSON={requestJSON}
          sourceLabel="Email"
          linkTargetTypes={EMAIL_PICKER_LINK_TARGET_TYPES}
          initialMode="link"
          anchor={pickerAnchor}
          onChoose={chooseEntity}
          onCancel={closePicker}
        />
      )}

      {pendingLink && (
        <div
          data-email-node-destination-details="true"
          role="dialog"
          aria-label={"Finish linking email to " + pendingLink.label}
          style={{ position: "absolute", zIndex: 70, top: "calc(100% + 7px)", right: 0, width: "min(390px, calc(100vw - 32px))", maxHeight: "min(72vh, 540px)", overflowY: "auto", display: "grid", gap: 9, border: "1px solid transparent", borderRadius: 13, background: EDITOR_NEU_SURFACE + " padding-box, " + EDITOR_NEU_EDGE_FRAME + " border-box", padding: 10, boxShadow: EDITOR_NEU_PANEL_SHADOW }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr)", alignItems: "center", gap: 8, color: "#334155" }}>
            <ExplorerRowIcon kind={pendingLink.entityType} />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5 }}>{pendingLink.label}</strong>
              <span style={{ color: "#64748b", fontSize: 9.5 }}>{pendingLink.entityType === "logic_gate" ? "Create a new email Node in this Logic Gate" : "Create a new email Node in this Project"}</span>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: pendingLink.entityType === "project" ? "minmax(0, 0.9fr) minmax(0, 1.1fr)" : "minmax(0, 1fr)", gap: 7, alignItems: "start" }}>
            <section aria-label="Email Node priority" style={{ minWidth: 0, display: "grid", gap: 4, color: "#64748b", fontSize: 9.5, fontWeight: 850 }}>
              <span>Choose priority</span>
              <div data-email-node-priority-choices="pre-open" role="group" aria-label="Email Node priority choices" style={choiceGroupStyle}>
                {INBOX_PRIORITIES.map((item) => {
                  const selected = priority === String(item.value);
                  return (
                    <button
                      key={item.value}
                      type="button"
                      data-email-node-priority-option={item.value}
                      aria-pressed={selected}
                      onClick={() => {
                        setPriority(String(item.value));
                        if (pendingLink.entityType !== "project" || projectLogicGateID) submitPendingLink({ priority: item.value });
                      }}
                      style={destinationChoiceStyle(selected)}
                    >
                      <span style={{ width: 23, height: 23, borderRadius: 7, display: "grid", placeItems: "center", background: selected ? "rgba(79,70,229,0.12)" : "rgba(226,232,240,0.68)", color: selected ? "#4f46e5" : "#64748b", fontSize: 10, fontWeight: 900 }}>{item.value}</span>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.25, fontWeight: 800 }}>{item.label.replace(/^\d+\s*/, "")}</span>
                    </button>
                  );
                })}
              </div>
            </section>
            {pendingLink.entityType === "project" && (
              <section aria-label="Project Logic Gate" style={{ minWidth: 0, display: "grid", gap: 4, color: "#64748b", fontSize: 9.5, fontWeight: 850 }}>
                <span>Choose Logic Gate</span>
                <div className="editor-document-scroll" data-email-project-logic-gate-choices="pre-open" role="group" aria-label="Project Logic Gate choices" style={{ ...choiceGroupStyle, maxHeight: 174, overflowY: "auto" }}>
                  {logicGates.map((logicGate) => {
                    const selected = projectLogicGateID === logicGate.logic_gate_id;
                    return (
                      <button
                        key={logicGate.logic_gate_id}
                        type="button"
                        data-email-project-logic-gate-option={logicGate.logic_gate_id}
                        aria-pressed={selected}
                        onClick={() => {
                          setProjectLogicGateID(logicGate.logic_gate_id);
                          if (Number.isInteger(selectedPriority) && selectedPriority >= 1 && selectedPriority <= 5) submitPendingLink({ projectLogicGateID: logicGate.logic_gate_id });
                        }}
                        style={destinationChoiceStyle(selected)}
                      >
                        <ExplorerRowIcon kind="logic_gate" />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.25, fontWeight: 800 }}>{logicGate.header || logicGate.logic_gate_id}</span>
                      </button>
                    );
                  })}
                  {logicGates.length === 0 && <span style={{ padding: 6, color: "#94a3b8", fontSize: 10 }}>No Logic Gates available</span>}
                </div>
              </section>
            )}
          </div>
          {busy && <div role="status" style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>Linking email to destination</div>}
        </div>
      )}
    </div>
  );
}

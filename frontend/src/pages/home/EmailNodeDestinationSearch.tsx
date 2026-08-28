import React from "react";
import { ExplorerEntityIcon, ExplorerRowIcon } from "../../icons/index.js";
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
import { UniversalLinkerControls } from "../../modules/editor/UniversalLinkerControls.js";
import type { LogicGateRecord } from "../../modules/logic-gates/types.js";
import type { EmailNodeDestination } from "./emailCollaborationChat.js";

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

const EMAIL_PICKER_LINK_TARGET_TYPES = ["node", "project", "logic_gate"] as const;
type PendingEmailProjectLink = EditorEntityLink & { entityType: "project" };

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
  const [pendingLink, setPendingLink] = React.useState<PendingEmailProjectLink | null>(null);
  const [projectLogicGateID, setProjectLogicGateID] = React.useState("");

  const closePicker = React.useCallback(() => setPickerOpen(false), []);
  const resetPendingLink = React.useCallback(() => {
    setPendingLink(null);
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
    if (entity.entityType === "logic_gate") {
      onSubmit({ kind: "logic_gate", logicGateID: entity.entityID });
      return;
    }
    if (entity.entityType !== "project") {
      onError("This resource cannot be used as an email destination.");
      return;
    }
    setProjectLogicGateID("");
    setPendingLink({ ...entity, entityType: "project" });
  }, [onError, onOpenEntity, onSubmit]);

  const submitPendingLink = React.useCallback((overrides: { projectLogicGateID?: string } = {}) => {
    if (!pendingLink || busy) return;
    const activeProjectLogicGateID = overrides.projectLogicGateID ?? projectLogicGateID;
    if (pendingLink.entityType === "project" && activeProjectLogicGateID) {
      resetPendingLink();
      onSubmit({ kind: "project", projectID: pendingLink.entityID, logicGateID: activeProjectLogicGateID });
    }
  }, [busy, onSubmit, pendingLink, projectLogicGateID, resetPendingLink]);

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
      style={{ position: "relative", flex: "0 0 auto" }}
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
      <UniversalLinkerControls
        busy={busy}
        pickerOpen={pickerOpen}
        createFloatingNodeAriaLabel="Create floating node from email"
        openPickerAriaLabel="Open universal email picker"
        pickerLauncherRef={launcherRef}
        onCreateFloatingNode={createFloatingNode}
        onTogglePicker={() => { if (pickerOpen) closePicker(); else openPicker(); }}
      />

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
            <ExplorerEntityIcon kind={pendingLink.entityType} />
            <span style={{ minWidth: 0 }}>
              <strong style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11.5 }}>{pendingLink.label}</strong>
              <span style={{ color: "#64748b", fontSize: 9.5 }}>Create a new email Node in this Project</span>
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 7, alignItems: "start" }}>
            {pendingLink.entityType === "project" && (
              <section aria-label="Project Process" style={{ minWidth: 0, display: "grid", gap: 4, color: "#64748b", fontSize: 9.5, fontWeight: 850 }}>
                <span>Choose Process</span>
                <div className="editor-document-scroll" data-email-project-logic-gate-choices="pre-open" role="group" aria-label="Project Process choices" style={{ ...choiceGroupStyle, maxHeight: 174, overflowY: "auto" }}>
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
                          submitPendingLink({ projectLogicGateID: logicGate.logic_gate_id });
                        }}
                        style={destinationChoiceStyle(selected)}
                      >
                        <ExplorerRowIcon kind="logic_gate" />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.25, fontWeight: 800 }}>{logicGate.header || logicGate.logic_gate_id}</span>
                      </button>
                    );
                  })}
                  {logicGates.length === 0 && <span style={{ padding: 6, color: "#94a3b8", fontSize: 10 }}>No Processes available</span>}
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

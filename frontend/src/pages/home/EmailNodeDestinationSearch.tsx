import React from "react";
import { ExplorerRowIcon } from "../../icons/index.js";
import type { LogicGateRecord } from "../../modules/logic-gates/types";
import type { NodeRecord } from "../../modules/nodes/types";
import {
  listProjects,
  type ProjectRecord,
} from "../../modules/project-management/projectManagementApi";
import {
  EDITOR_NEU_ACTIVE_SURFACE,
  EDITOR_NEU_EDGE_FRAME,
  EDITOR_NEU_PANEL_SHADOW,
  EDITOR_NEU_SHADOW,
  EDITOR_NEU_SOFT_BORDER,
  EDITOR_NEU_SURFACE,
} from "../../modules/editor/NodeWorkspaceSurfaceShared";
import {
  buildEmailNodeDestinationSearchOptions,
  type EmailNodeDestination,
  type EmailNodeDestinationSearchOption,
} from "./emailCollaborationChat";
import { INBOX_PRIORITIES } from "./homeConstants";

type EmailNodeDestinationSearchProps = {
  companyID: string;
  nodes: NodeRecord[];
  logicGates: LogicGateRecord[];
  currentNodeID?: string;
  busy: boolean;
  onSubmit: (destination: EmailNodeDestination) => void;
  onOpenCurrentNode: () => void;
  onError: (message: string) => void;
};

const searchInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: 0,
  outline: 0,
  background: "transparent",
  color: "#334155",
  padding: "0 8px 0 10px",
  fontSize: 11,
  fontWeight: 750,
};

const choiceGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 5,
  border: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
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
    border: selected ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
    borderRadius: 8,
    background: selected
      ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`
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

function SendArrowIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" style={{ display: "block" }}>
      <path d="M2.5 8h10.25M9 4.25 12.75 8 9 11.75" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function destinationKindLabel(kind: EmailNodeDestinationSearchOption["kind"]): string {
  switch (kind) {
    case "current": return "Current Node";
    case "node": return "Node";
    case "logic_gate": return "Logic Gate";
    case "project": return "Project";
    case "standalone": return "New Node";
    default: return "Destination";
  }
}

function destinationIconKind(kind: EmailNodeDestinationSearchOption["kind"]): "node" | "logic_gate" | "project" {
  if (kind === "logic_gate") return "logic_gate";
  if (kind === "project") return "project";
  return "node";
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches("input, textarea, select, [contenteditable='true']")
    || Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

export function EmailNodeDestinationSearch({
  companyID,
  nodes,
  logicGates,
  currentNodeID,
  busy,
  onSubmit,
  onOpenCurrentNode,
  onError,
}: EmailNodeDestinationSearchProps) {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [selectedKey, setSelectedKey] = React.useState("");
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [priority, setPriority] = React.useState("");
  const [projectLogicGateID, setProjectLogicGateID] = React.useState("");
  const [projects, setProjects] = React.useState<ProjectRecord[]>([]);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [projectsCompanyID, setProjectsCompanyID] = React.useState("");

  React.useEffect(() => {
    setProjects([]);
    setProjectsCompanyID("");
  }, [companyID]);

  React.useEffect(() => {
    if (!open || !companyID || projectsCompanyID === companyID || projectsLoading) return;
    let cancelled = false;
    setProjectsLoading(true);
    void listProjects(companyID)
      .then((payload) => {
        if (cancelled) return;
        setProjects(payload.projects ?? []);
        setProjectsCompanyID(companyID);
      })
      .catch((cause) => {
        if (cancelled) return;
        setProjectsCompanyID(companyID);
        onError(cause instanceof Error ? cause.message : "Failed to load projects.");
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => { cancelled = true; };
  }, [companyID, onError, open, projectsCompanyID]);

  React.useEffect(() => {
    if (!open) return undefined;
    const dismiss = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  React.useEffect(() => {
    const focusHashtagSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "#" || event.metaKey || event.ctrlKey || event.altKey || busy) return;
      if (isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      setQuery("#");
      setSelectedKey("");
      setOpen(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    document.addEventListener("keydown", focusHashtagSearch);
    return () => document.removeEventListener("keydown", focusHashtagSearch);
  }, [busy]);

  const options = React.useMemo(() => buildEmailNodeDestinationSearchOptions({
    query,
    nodes,
    logicGates,
    projects,
    currentNodeID,
  }), [currentNodeID, logicGates, nodes, projects, query]);
  const selectedOption = options.find((option) => option.key === selectedKey) ?? null;
  const selectedPriority = Number(priority);
  const selectionReady = Boolean(selectedOption) && (
    selectedOption?.kind === "current"
    || selectedOption?.kind === "node"
    || (
      Number.isInteger(selectedPriority)
      && selectedPriority >= 1
      && selectedPriority <= 5
      && (selectedOption?.kind !== "project" || Boolean(projectLogicGateID))
    )
  );

  React.useEffect(() => {
    setHighlightedIndex((current) => Math.min(Math.max(0, current), Math.max(0, options.length - 1)));
  }, [options.length]);

  const resetSearch = React.useCallback(() => {
    setQuery("");
    setSelectedKey("");
    setPriority("");
    setProjectLogicGateID("");
    setOpen(false);
  }, []);

  const chooseOption = React.useCallback((option: EmailNodeDestinationSearchOption) => {
    setSelectedKey(option.key);
    setQuery(`# ${option.label}`);
    setPriority("");
    setProjectLogicGateID("");
    setOpen(true);
  }, []);

  const runOption = React.useCallback((
    option: EmailNodeDestinationSearchOption,
    overrides: { priority?: number; projectLogicGateID?: string } = {},
  ) => {
    if (busy) return;
    const activePriority = overrides.priority ?? selectedPriority;
    const activeProjectLogicGateID = overrides.projectLogicGateID ?? projectLogicGateID;
    if (option.kind === "current") {
      resetSearch();
      onOpenCurrentNode();
      return;
    }
    if (option.kind === "node") {
      resetSearch();
      onSubmit({ kind: "node", nodeID: option.id });
      return;
    }
    if (!Number.isInteger(activePriority) || activePriority < 1 || activePriority > 5) {
      chooseOption(option);
      return;
    }
    if (option.kind === "logic_gate") {
      resetSearch();
      onSubmit({ kind: "logic_gate", logicGateID: option.id, priority: activePriority });
      return;
    }
    if (option.kind === "project") {
      if (!activeProjectLogicGateID) {
        chooseOption(option);
        return;
      }
      resetSearch();
      onSubmit({
        kind: "project",
        projectID: option.id,
        logicGateID: activeProjectLogicGateID,
        priority: activePriority,
      });
      return;
    }
    resetSearch();
    onSubmit({ kind: "standalone", priority: activePriority });
  }, [busy, chooseOption, onOpenCurrentNode, onSubmit, projectLogicGateID, resetSearch, selectedPriority]);

  const submitCurrentSearch = React.useCallback(() => {
    if (selectedOption) {
      runOption(selectedOption);
      return;
    }
    const highlighted = options[highlightedIndex];
    if (!highlighted) return;
    if (highlighted.kind === "current" || highlighted.kind === "node") runOption(highlighted);
    else chooseOption(highlighted);
  }, [chooseOption, highlightedIndex, options, runOption, selectedOption]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    submitCurrentSearch();
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.min(options.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      submitCurrentSearch();
    } else if (event.key === "Escape") {
      event.preventDefault();
      resetSearch();
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={wrapperRef}
      data-email-node-destination-search="true"
      style={{ position: "relative", flex: "0 1 300px", width: "clamp(190px, 28vw, 300px)", minWidth: 170 }}
    >
      <form
        role="search"
        aria-label="Send email to a Node destination"
        onSubmit={submitSearch}
        style={{
          width: "100%",
          height: 32,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 31px",
          alignItems: "center",
          border: open ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
          borderRadius: 10,
          background: open
            ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`
            : EDITOR_NEU_SURFACE,
          boxShadow: open
            ? "inset 2px 2px 6px rgba(174,174,192,0.16), inset -2px -2px 6px rgba(255,255,255,0.86)"
            : EDITOR_NEU_SHADOW,
          overflow: "hidden",
        }}
      >
        <input
          ref={inputRef}
          data-email-node-hashtag-input="true"
          type="search"
          role="combobox"
          aria-label="Search Nodes, Logic Gates, and projects"
          aria-expanded={open}
          aria-controls="email-node-destination-results"
          aria-activedescendant={open && options[highlightedIndex] ? `email-node-destination-${highlightedIndex}` : undefined}
          autoComplete="off"
          value={query}
          placeholder="# Search Nodes, Logic Gates, projects"
          disabled={busy}
          onFocus={() => {
            if (!query) setQuery("#");
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedKey("");
            setPriority("");
            setProjectLogicGateID("");
            setHighlightedIndex(0);
            setOpen(true);
          }}
          onKeyDown={handleInputKeyDown}
          style={searchInputStyle}
        />
        <button
          type="submit"
          aria-label="Send email to selected destination"
          title={selectionReady ? "Send email (Enter)" : "Choose a destination"}
          disabled={busy || !selectionReady}
          style={{
            width: 31,
            height: 30,
            display: "grid",
            placeItems: "center",
            border: 0,
            borderLeft: `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
            background: selectionReady ? "rgba(79,70,229,0.10)" : "transparent",
            color: selectionReady ? "#4f46e5" : "#94a3b8",
            cursor: busy ? "wait" : selectionReady ? "pointer" : "default",
          }}
        >
          <SendArrowIcon />
        </button>
      </form>

      {open && (
        <div
          id="email-node-destination-results"
          data-email-node-destination-popover="true"
          role="listbox"
          aria-label="Email Node destinations"
          style={{
            position: "absolute",
            zIndex: 70,
            top: "calc(100% + 7px)",
            right: 0,
            width: "min(390px, calc(100vw - 32px))",
            maxHeight: "min(72vh, 540px)",
            overflowY: "auto",
            display: "grid",
            gap: 7,
            border: "1px solid transparent",
            borderRadius: 13,
            background: `${EDITOR_NEU_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`,
            padding: 9,
            boxShadow: EDITOR_NEU_PANEL_SHADOW,
            animation: "mango-pane-enter 150ms ease-out",
          }}
        >
          <div style={{ color: "#64748b", fontSize: 10, fontWeight: 800, lineHeight: 1.35 }}>
            Click a Node to send. New destinations send when their required choices are complete.
          </div>
          <div className="editor-document-scroll" style={{ maxHeight: selectedOption ? 154 : 220, overflowY: "auto", display: "grid", gap: 4 }}>
            {options.map((option, index) => {
              const selected = option.key === selectedKey;
              const highlighted = index === highlightedIndex;
              return (
                <button
                  id={`email-node-destination-${index}`}
                  data-email-node-destination-option={option.kind}
                  key={option.key}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => {
                    if (option.kind === "current" || option.kind === "node") runOption(option);
                    else chooseOption(option);
                  }}
                  style={{
                    minHeight: 43,
                    display: "grid",
                    gridTemplateColumns: "23px minmax(0, 1fr) auto",
                    alignItems: "center",
                    gap: 7,
                    border: selected ? "1px solid transparent" : `1px solid ${EDITOR_NEU_SOFT_BORDER}`,
                    borderRadius: 9,
                    background: selected
                      ? `${EDITOR_NEU_ACTIVE_SURFACE} padding-box, ${EDITOR_NEU_EDGE_FRAME} border-box`
                      : highlighted ? "rgba(248,250,252,0.98)" : EDITOR_NEU_SURFACE,
                    color: selected ? "#4f46e5" : "#334155",
                    padding: "5px 8px",
                    textAlign: "left",
                    cursor: "pointer",
                    boxShadow: EDITOR_NEU_SHADOW,
                  }}
                >
                  <ExplorerRowIcon kind={destinationIconKind(option.kind)} />
                  <span style={{ minWidth: 0, display: "grid", gap: 1 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, fontWeight: 850 }}>{option.label}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#64748b", fontSize: 9.5, fontWeight: 650 }}>{option.detail}</span>
                  </span>
                  <span style={{ color: "#64748b", fontSize: 9, fontWeight: 850 }}>{destinationKindLabel(option.kind)}</span>
                </button>
              );
            })}
            {projectsLoading && <div role="status" style={{ color: "#64748b", fontSize: 10, padding: 6 }}>Loading projects</div>}
            {!projectsLoading && options.length === 0 && <div style={{ color: "#64748b", fontSize: 10.5, padding: 6 }}>No matching destinations</div>}
          </div>

          {selectedOption && selectedOption.kind !== "current" && selectedOption.kind !== "node" && (
            <div data-email-node-destination-details="true" style={{ display: "grid", gridTemplateColumns: selectedOption.kind === "project" ? "minmax(0, 0.9fr) minmax(0, 1.1fr)" : "minmax(0, 1fr)", gap: 7, alignItems: "start" }}>
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
                          const nextPriority = item.value;
                          setPriority(String(nextPriority));
                          if (selectedOption.kind !== "project" || Boolean(projectLogicGateID)) {
                            runOption(selectedOption, { priority: nextPriority });
                          }
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
              {selectedOption.kind === "project" && (
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
                            const nextLogicGateID = logicGate.logic_gate_id;
                            setProjectLogicGateID(nextLogicGateID);
                            if (Number.isInteger(selectedPriority) && selectedPriority >= 1 && selectedPriority <= 5) {
                              runOption(selectedOption, { projectLogicGateID: nextLogicGateID });
                            }
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
          )}
          {busy && <div role="status" style={{ color: "#64748b", fontSize: 10, fontWeight: 800 }}>Sending email to destination</div>}
        </div>
      )}
    </div>
  );
}

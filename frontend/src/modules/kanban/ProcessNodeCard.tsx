import React from "react";
import { ExplorerEntityIcon } from "../../icons/index.js";
import { processStatusColor, type ProcessStep, type ProcessWorkNode } from "./processWork";
import type { ProcessNodeStatePatch } from "./kanbanApi";
import { KANBAN_NODE_PRIORITY_STYLE_OPTIONS } from "./shared";

type Props = {
  node: ProcessWorkNode;
  steps: ProcessStep[];
  selected: boolean;
  active: boolean;
  canEdit: boolean;
  busy: boolean;
  personName: string;
  canAccept: boolean;
  canCancel: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onOpen: () => void;
  onChange: (patch: ProcessNodeStatePatch) => void;
  onStart: () => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
};

export function ProcessNodeCard({ node, steps, selected, active, canEdit, busy, personName, canAccept, canCancel, onSelect, onOpen, onChange, onStart, onDragStart, onDragOver, onDrop }: Props) {
  const statusLabel = node.status === "Backlogs" ? "Backlog" : node.status;
  const priorityStyle = KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((option) => option.value === String(node.priority ?? 0))
    ?? KANBAN_NODE_PRIORITY_STYLE_OPTIONS[KANBAN_NODE_PRIORITY_STYLE_OPTIONS.length - 1];
  return <article data-process-node={node.node_id} className={`process-work__node${selected ? " is-selected" : ""}`} style={{ "--status-color": processStatusColor(node.status) } as React.CSSProperties}
    draggable={canEdit && !busy && active} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
    onClick={(event) => { if (!(event.target as HTMLElement).closest("button,input,select,summary,a")) onSelect(event); }}
    onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button,input,select,summary,a")) onOpen(); }}>
    <div className="process-work__node-heading">
      <button type="button" className="process-work__node-title mango-editor-entity-link mango-editor-entity-link--node" onClick={onOpen}>
        <ExplorerEntityIcon kind="node" className="mango-editor-entity-icon" />
        <span className="mango-editor-entity-label">{node.node_title}</span>
      </button>
      {node.created_from_email && <span title="Created from email">✉</span>}
    </div>
    <div className="process-work__node-tags"><span className="process-work__status-label"><span aria-hidden="true" className="process-work__label-dot" />{statusLabel}</span>{node.is_issue && <strong className="process-work__issue">Issue</strong>}
      {!active && node.process_step_id && <span>↳ {steps.find((step) => step.process_step_id === node.process_step_id)?.name}</span>}
    </div>
    <div className="process-work__node-meta"><span className="process-work__priority-label" style={{ color: priorityStyle.color, borderColor: priorityStyle.borderColor, background: priorityStyle.surface, boxShadow: `0 4px 10px ${priorityStyle.glow}, inset 1px 1px 0 rgba(255,255,255,0.86)` }}><span aria-hidden="true" className="process-work__priority-icon" />{priorityStyle.label}</span>{node.due_date && <span>Due {node.due_date}</span>}</div>
    {!!node.accounts?.length && <div className="process-work__node-meta">{node.accounts.map((account) => account.name).join(" · ")}</div>}
    {node.placed_by_user_id && <div className="process-work__byline">from: {personName || "Unknown person"} · {new Date(node.created_timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
    {node.status === "Requested" && <div className="process-work__request">{canAccept ? <>
      <button type="button" disabled={busy} onClick={() => onChange({ status: "Pending" })}>Accept</button>
      <button type="button" disabled={busy} onClick={() => onChange({ status: "Backlogs" })}>Decline</button>
    </> : <><span>Request pending</span>{canCancel && <button type="button" disabled={busy} onClick={() => onChange({ status: "Backlogs" })}>Cancel request</button>}</>}</div>}
    {!active && node.status !== "Requested" && canEdit && <button type="button" disabled={busy || steps.length === 0} onClick={onStart}>Start work…</button>}
  </article>;
}

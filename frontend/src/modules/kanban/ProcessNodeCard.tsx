import React from "react";
import { PROCESS_STATUSES, processStatusColor, type ProcessStep, type ProcessWorkNode } from "./processWork";
import type { ProcessNodeStatePatch } from "./kanbanApi";
import { getKanbanPriorityGroupLabel, KANBAN_NODE_PRIORITY_STYLE_OPTIONS } from "./shared";

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
  onToggleSelect: () => void;
  onOpen: () => void;
  onChange: (patch: ProcessNodeStatePatch) => void;
  onStatus: (status: string) => void;
  onStart: () => void;
  onRename: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onDueDate: (date: string) => void;
  onDragStart: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
};

export function ProcessNodeCard({ node, steps, selected, active, canEdit, busy, personName, canAccept, canCancel, onSelect, onToggleSelect, onOpen, onChange, onStatus, onStart, onRename, onDelete, onRevert, onDueDate, onDragStart, onDragOver, onDrop }: Props) {
  const statusLabel = node.status === "Backlogs" ? "Backlog" : node.status;
  return <article data-process-node={node.node_id} className={`process-work__node${selected ? " is-selected" : ""}`} style={{ "--status-color": processStatusColor(node.status) } as React.CSSProperties}
    draggable={canEdit && !busy && active} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop}
    onClick={(event) => { if (!(event.target as HTMLElement).closest("button,input,select,summary,a")) onSelect(event); }}
    onDoubleClick={(event) => { if (!(event.target as HTMLElement).closest("button,input,select,summary,a")) onOpen(); }}>
    <div className="process-work__node-heading">
      <input type="checkbox" aria-label={`Select ${node.node_title}`} checked={selected} onChange={onToggleSelect} />
      <button type="button" className="process-work__node-title" onClick={onOpen}>{node.node_title}</button>
      {node.created_from_email && <span title="Created from email">✉</span>}
    </div>
    <div className="process-work__node-tags"><span>{statusLabel}</span>{node.is_issue && <strong className="process-work__issue">Issue</strong>}
      {!active && node.process_step_id && <span>↳ {steps.find((step) => step.process_step_id === node.process_step_id)?.name}</span>}
    </div>
    <div className="process-work__node-meta">{getKanbanPriorityGroupLabel(node.priority ?? 0)}{node.due_date && ` · Due ${node.due_date}`}</div>
    {!!node.accounts?.length && <div className="process-work__node-meta">{node.accounts.map((account) => account.name).join(" · ")}</div>}
    {node.placed_by_user_id && <div className="process-work__byline">from: {personName || "Unknown person"} · {new Date(node.created_timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>}
    {node.status === "Requested" && <div className="process-work__request">{canAccept ? <>
      <button type="button" disabled={busy} onClick={() => onChange({ status: "Pending" })}>Accept</button>
      <button type="button" disabled={busy} onClick={() => onChange({ status: "Backlogs" })}>Decline</button>
    </> : <><span>Request pending</span>{canCancel && <button type="button" disabled={busy} onClick={() => onChange({ status: "Backlogs" })}>Cancel request</button>}</>}</div>}
    {!active && node.status !== "Requested" && canEdit && <button type="button" disabled={busy || steps.length === 0} onClick={onStart}>Start work…</button>}
    {canEdit && <details className="process-work__node-actions"><summary>Change</summary><div>
      <label>Status<select aria-label={`Status for ${node.node_title}`} value={node.status} disabled={busy} onChange={(event) => onStatus(event.target.value)}>{PROCESS_STATUSES.map((status) => <option key={status} value={status}>{status === "Backlogs" ? "Backlog" : status}</option>)}</select></label>
      <label>Step<select aria-label={`Step for ${node.node_title}`} value={node.process_step_id ?? ""} disabled={busy} onChange={(event) => onChange({ process_step_id: event.target.value || null })}><option value="">No step assigned</option>{steps.map((step) => <option key={step.process_step_id} value={step.process_step_id}>{step.name}</option>)}</select></label>
      <label>Priority<select aria-label={`Priority for ${node.node_title}`} value={node.priority ?? 0} disabled={busy} onChange={(event) => onChange({ priority: Number(event.target.value) || null })}>{KANBAN_NODE_PRIORITY_STYLE_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label>Due date<input type="date" key={node.due_date ?? "none"} defaultValue={node.due_date ?? ""} disabled={busy} onBlur={(event) => { if (event.target.value !== (node.due_date ?? "")) onDueDate(event.target.value); }} /></label>
      <label className="process-work__check"><input type="checkbox" checked={node.is_issue} disabled={busy} onChange={(event) => onChange({ is_issue: event.target.checked })} />Issue</label>
      <button type="button" disabled={busy} onClick={onRename}>Rename</button><button type="button" disabled={busy} className="process-work__danger" onClick={onDelete}>Delete Node</button>
      {node.created_from_email && !node.has_project && <button type="button" disabled={busy} onClick={onRevert}>Return to My Triage</button>}
    </div></details>}
  </article>;
}

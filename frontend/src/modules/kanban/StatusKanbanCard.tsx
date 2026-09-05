import React, { useState } from "react";
import { statusKanbanCardColorRailStyle, hexToRgba } from "./statusKanbanPresentation";
import type { ProcessWorkNode } from "./processWork";
import { ExplorerRowIcon } from "../../icons/index.js";
import { KANBAN_EDGE_FRAME } from "./KanbanContentModel";

const NodeDocumentIcon: React.FC<{ color: string }> = ({ color }) => (
  <svg aria-hidden="true" width="19" height="19" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M4 1.75h5.25L12 4.5v9.75H4z" fill="rgba(255,255,255,0.58)" stroke={color} strokeWidth="1.45" />
    <path d="M9.25 1.75V4.5H12M5.75 7.25h4.5M5.75 9.5h4.5M5.75 11.75h3" fill="none" stroke={color} strokeWidth="1.18" />
  </svg>
);

const EmailSourceIcon: React.FC<{ color: string; size?: number }> = ({ color, size = 14 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
    <path d="M2.25 4.25h11.5v7.5H2.25z" fill="rgba(255,255,255,0.76)" stroke={color} strokeWidth="1.35" strokeLinejoin="round" />
    <path d="M2.75 4.75 8 8.7l5.25-3.95" fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export type StatusKanbanCardProps = {
  node: ProcessWorkNode;
  editable: boolean;
  busy: boolean;
  color: string;
  highlighted: boolean;
  selected: boolean;
  dragBefore: boolean;
  dragAfter: boolean;
  emailTransferTarget: boolean;
  text: string;
  subtext: string;
  accent: string;
  editingTitle: boolean;
  renameTitleDraft: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onMouseDown: React.MouseEventHandler<HTMLElement>;
  onClick: React.MouseEventHandler<HTMLElement>;
  onDoubleClick: React.MouseEventHandler<HTMLElement>;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
  onSetRenameTitleDraft: (title: string) => void;
  onCommitRenameTitle: (title: string) => void;
  onCancelRenameTitle: () => void;
  onDragStart: React.DragEventHandler<HTMLElement>;
  onDragEnd: React.DragEventHandler<HTMLElement>;
  onDragOver: React.DragEventHandler<HTMLElement>;
  onDragLeave: React.DragEventHandler<HTMLElement>;
  onDrop: React.DragEventHandler<HTMLElement>;
  requestedActions?: {
    busy: boolean;
    onAccept: () => void;
    onDecline: () => void;
  };
  requestedStatusText?: string;
  requestedStatusAction?: {
    label: string;
    title: string;
    busy: boolean;
    onClick: () => void;
  };
  bylineText?: string;
};

export const StatusKanbanCard: React.FC<StatusKanbanCardProps> = ({
  node,
  editable,
  busy,
  color,
  highlighted,
  selected,
  dragBefore,
  dragAfter,
  emailTransferTarget,
  text: themeText,
  subtext: themeSubtext,
  accent,
  editingTitle,
  renameTitleDraft,
  renameInputRef,
  onMouseDown,
  onClick,
  onDoubleClick,
  onContextMenu,
  onSetRenameTitleDraft,
  onCommitRenameTitle,
  onCancelRenameTitle,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  requestedActions,
  requestedStatusText,
  requestedStatusAction,
  bylineText,
}) => {
  const [hovered, setHovered] = useState(false);
  const text = `var(--status-kanban-card-text, ${themeText})`;
  const subtext = `var(--status-kanban-card-subtext, ${themeSubtext})`;
  const isIssue = node.is_issue === true;
  const cardFrame = `linear-gradient(135deg, ${hexToRgba(color, selected || highlighted ? 0.88 : 0.62)}, rgba(255,255,255,0.84) 72%)`;
  const accounts = (node.accounts ?? []).filter((account) => account.account_id.trim()).slice(0, 4);
  const showRequestedActions = Boolean(requestedActions);
  const createdFromEmail = node.created_from_email === true;
  const hasProject = node.has_project === true;
  const trailingGridColumns = [createdFromEmail ? "22px" : "", showRequestedActions ? "24px 24px" : ""].filter(Boolean).join(" ");
  const hasFooter = Boolean(requestedStatusText || requestedStatusAction || bylineText);
  const requestedActionButtonBase: React.CSSProperties = {
    width: 24,
    height: 24,
    padding: 0,
    boxSizing: "border-box",
    border: "1px solid rgba(255,255,255,0.72)",
    borderRadius: 7,
    display: "grid",
    placeItems: "center",
    font: "inherit",
    fontSize: 13,
    fontWeight: 900,
    lineHeight: 1,
    cursor: requestedActions?.busy ? "wait" : "pointer",
    boxShadow: "2px 2px 6px rgba(174,174,192,0.18), -2px -2px 6px rgba(255,255,255,0.78)",
    opacity: requestedActions?.busy ? 0.64 : 1,
  };

  return (
    <article
      data-process-node={node.node_id}
      draggable={editable && !busy && !editingTitle}
      tabIndex={0}
      onMouseDown={onMouseDown}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        display: "block",
        gridColumn: "auto",
        gridRow: "auto",
        width: "100%",
        boxSizing: "border-box",
        border: "1px solid transparent",
        borderRadius: 11,
        background: isIssue
          ? `linear-gradient(135deg, rgba(255,255,255,0.92), rgba(255,241,242,0.74) 48%, rgba(254,249,195,0.60)) padding-box, ${KANBAN_EDGE_FRAME} border-box`
          : `linear-gradient(135deg, rgba(255,255,255,0.98), rgba(255,255,255,0.94) 42%, ${hexToRgba(color, 0.09)} 100%) padding-box, ${cardFrame} border-box`,
        color: isIssue ? "#111111" : text,
        padding: "9px 10px 9px 15px",
        minHeight: 60,
        cursor: editingTitle ? "text" : editable && !busy ? "grab" : "default",
        outline: "none",
        overflow: "hidden",
        boxShadow: [
          `4px 4px 12px rgba(174, 174, 192, 0.18), -4px -4px 12px rgba(255, 255, 255, 0.84), 0 8px 18px ${hexToRgba(color, 0.10)}, inset 1px 1px 0 rgba(255,255,255,0.88)`,
          selected ? `0 0 0 1px ${color}, 0 0 12px ${hexToRgba(color, 0.28)}, inset 0 0 0 1px ${hexToRgba(color, 0.16)}` : "",
          highlighted && !selected ? `0 0 0 1px ${color} inset, 0 0 10px ${hexToRgba(color, 0.22)}` : "",
          dragBefore ? `0 -3px 0 ${accent}` : "",
          dragAfter ? `0 3px 0 ${accent}` : "",
          emailTransferTarget ? `0 0 0 2px ${accent}, 0 0 0 5px ${hexToRgba(accent, 0.20)}, 0 12px 24px ${hexToRgba(accent, 0.18)}` : "",
        ].filter(Boolean).join(", ") || undefined,
        transform: emailTransferTarget ? "translateY(-1px)" : hovered ? "translateY(-2px)" : "translateY(0)",
        transition: "box-shadow 150ms ease, transform 120ms ease, background 150ms ease",
      }}
      >
      {/* The color rail is a separate layer so selection border changes cannot erase it. */}
      <span aria-hidden="true" style={statusKanbanCardColorRailStyle(color)} />
      <div style={{ display: "grid", gridTemplateColumns: `20px minmax(0, 1fr)${trailingGridColumns ? ` ${trailingGridColumns}` : ""}`, gap: 7, alignItems: "start" }}>
        <span style={{ width: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <span title="Node" style={{ width: 20, height: 20, display: "grid", placeItems: "center" }}>
            <NodeDocumentIcon color={color} />
          </span>
          {hasProject && (
            <span title="Part of a Project" aria-label="Part of a Project" style={{ width: 18, height: 17, display: "grid", placeItems: "center" }}>
              <ExplorerRowIcon kind="project" />
            </span>
          )}
        </span>
        {editingTitle ? (
          <input
            ref={renameInputRef}
            value={renameTitleDraft}
            onChange={(event) => onSetRenameTitleDraft(event.currentTarget.value)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => {
              event.stopPropagation();
              event.currentTarget.select();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") {
                event.preventDefault();
                onCommitRenameTitle(event.currentTarget.value);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                onCancelRenameTitle();
                return;
              }
            }}
            onBlur={(event) => onCommitRenameTitle(event.currentTarget.value)}
            style={{
              minWidth: 0,
              width: "100%",
              border: "none",
              background: "transparent",
              color: isIssue ? "#334155" : subtext,
              caretColor: isIssue ? "#111111" : text,
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              lineHeight: 1.25,
              padding: 0,
              outline: "none",
              boxShadow: "none",
              appearance: "none",
            }}
          />
        ) : (
          <div style={{ fontSize: 12, fontWeight: 760, lineHeight: 1.25, overflowWrap: "anywhere" }}>{node.node_title}</div>
        )}
        {createdFromEmail && (
          <span
            title="Created from email"
            aria-label="Created from email"
            style={{
              width: 22,
              height: 22,
              border: `1px solid ${hexToRgba(color, 0.34)}`,
              borderRadius: 7,
              background: `linear-gradient(135deg, rgba(255,255,255,0.94), ${hexToRgba(color, 0.13)})`,
              color,
              display: "grid",
              placeItems: "center",
              boxSizing: "border-box",
              boxShadow: "1px 1px 4px rgba(174,174,192,0.14), -1px -1px 4px rgba(255,255,255,0.76)",
            }}
          >
            <EmailSourceIcon color={color} />
          </span>
        )}
        {requestedActions && (
          <>
            <button
              type="button"
              title="Accept request"
              aria-label={`Accept ${node.node_title}`}
              disabled={!editable || busy || requestedActions.busy}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestedActions.onAccept();
              }}
              style={{ ...requestedActionButtonBase, background: "linear-gradient(135deg, rgba(220,252,231,0.96), rgba(255,255,255,0.84))", color: "#15803d" }}
            >
              {"\u2713"}
            </button>
            <button
              type="button"
              title="Decline request"
              aria-label={`Decline ${node.node_title}`}
              disabled={!editable || busy || requestedActions.busy}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestedActions.onDecline();
              }}
              style={{ ...requestedActionButtonBase, background: "linear-gradient(135deg, rgba(254,226,226,0.96), rgba(255,255,255,0.84))", color: "#b91c1c" }}
            >
              X
            </button>
          </>
        )}
      </div>
      {accounts.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
          {accounts.map((account) => (
            <span key={account.account_id} title={account.name || account.account_id} style={{
              maxWidth: "100%",
              border: `1px solid ${hexToRgba(color, 0.22)}`,
              borderRadius: 7,
              background: `linear-gradient(135deg, rgba(255,255,255,0.92), ${hexToRgba(color, 0.10)})`,
              color: isIssue ? "#334155" : subtext,
              fontSize: 9.5,
              fontWeight: 820,
              lineHeight: 1.2,
              padding: "2px 6px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}>
              {account.name || account.account_id}
            </span>
          ))}
        </div>
      )}
      {hasFooter && (
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: requestedStatusAction ? "auto minmax(0, 1fr)" : "minmax(0, 1fr)", alignItems: "center", gap: 8, color: isIssue ? "#334155" : subtext, fontSize: 10.5, fontWeight: 760, lineHeight: 1.25, overflowWrap: "anywhere" }}>
          {requestedStatusAction && (
            <button
              type="button"
              title={requestedStatusAction.title}
              disabled={!editable || busy || requestedStatusAction.busy}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestedStatusAction.onClick();
              }}
              style={{
                minHeight: 21,
                border: `1px solid ${hexToRgba(color, 0.30)}`,
                borderRadius: 7,
                background: requestedStatusAction.busy ? "rgba(241,245,249,0.78)" : "rgba(255,255,255,0.86)",
                color: isIssue ? "#334155" : text,
                cursor: requestedStatusAction.busy ? "wait" : "pointer",
                padding: "2px 7px",
                font: "inherit",
                fontSize: 10,
                fontWeight: 850,
                lineHeight: 1,
                boxShadow: "1px 1px 4px rgba(174,174,192,0.14), -1px -1px 4px rgba(255,255,255,0.76)",
                opacity: requestedStatusAction.busy ? 0.64 : 1,
              }}
            >
              {requestedStatusAction.label}
            </button>
          )}
          <div
            title={[requestedStatusText, bylineText].filter(Boolean).join(" · ")}
            style={{ minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, flexWrap: "wrap", textAlign: "right" }}
          >
            {requestedStatusText && <span>{requestedStatusText}</span>}
            {bylineText && <span>{bylineText}</span>}
          </div>
        </div>
      )}
      {emailTransferTarget && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 4,
            border: `1px solid ${hexToRgba(accent, 0.70)}`,
            borderRadius: 8,
            pointerEvents: "none",
            background: `linear-gradient(135deg, ${hexToRgba(accent, 0.10)}, rgba(255,255,255,0.08))`,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "flex-end",
            padding: 6,
            boxSizing: "border-box",
          }}
        >
          <span style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            minHeight: 22,
            maxWidth: "100%",
            border: `1px solid ${hexToRgba(accent, 0.48)}`,
            borderRadius: 7,
            background: "rgba(255,255,255,0.94)",
            color: text,
            fontSize: 10,
            fontWeight: 880,
            lineHeight: 1,
            padding: "4px 7px",
            boxShadow: "0 6px 14px rgba(15,23,42,0.14)",
          }}>
            <EmailSourceIcon color={accent} size={13} />
            <span>Attach email</span>
          </span>
        </div>
      )}
    </article>
  );
};

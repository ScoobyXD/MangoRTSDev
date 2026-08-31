import React from "react";
import { ActionItemIcon } from "../../icons/ActionItemIcon.js";
import {
  ActionItemInlineFields,
  type ActionItemInlineFieldID,
  type ActionItemInlineFieldItem,
} from "./ActionItemInlineFields.js";

export type ActionItemRowItem = ActionItemInlineFieldItem & {
  entity_id: string;
  name: string;
  color?: string | null;
};

export type ActionItemRowProps<Item extends ActionItemRowItem = ActionItemRowItem> = {
  item: Item;
  displayedFields: ReadonlyArray<ActionItemInlineFieldID>;
  onOpen: (
    item: Item,
    target: HTMLButtonElement,
    activation: React.MouseEvent<HTMLButtonElement>,
  ) => void;
  renderCompletionDueDate?: (item: Item) => React.ReactNode;
};

export function ActionItemRow<Item extends ActionItemRowItem>({
  item,
  displayedFields,
  onOpen,
  renderCompletionDueDate,
}: ActionItemRowProps<Item>) {
  const color = item.color?.trim().toLowerCase();
  const pulseClassName = color === "red" || color === "yellow" ? `mango-editor-action-item--${color}` : undefined;
  return (
    <div
      className="action-item-row my-work-resource-row"
      data-action-item-row={item.entity_id}
      data-my-work-row="action-item"
      data-action-item-color={color || "none"}
      data-my-work-action-item-color={color || "none"}
      style={actionItemRowStyle(color)}
    >
      <button
        type="button"
        data-action-item-target={item.entity_id}
        data-my-work-target="action-item"
        data-action-item-color={color || "none"}
        data-my-work-action-item-color={color || "none"}
        style={actionItemPrimaryButtonStyle}
        onClick={(event) => onOpen(item, event.currentTarget, event)}
      >
        <span aria-hidden="true" style={actionItemColorBarStyle(color)} />
        <span className={pulseClassName} style={actionItemIconStyle(color)}>
          <ActionItemIcon className="mango-editor-action-item-icon" size={16} />
        </span>
        <span
          className={color === "red" || color === "yellow" ? `my-work-action-item-title--${color}` : undefined}
          data-action-item-title="true"
          data-my-work-action-item-title="true"
          style={actionItemNameStyle(color)}
        >
          {item.name}
        </span>
      </button>
      {displayedFields.length > 0 ? (
        <ActionItemInlineFields
          item={item}
          displayedFields={displayedFields}
          renderCompletionDueDate={renderCompletionDueDate}
        />
      ) : null}
    </div>
  );
}

const resourceButtonStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  gap: 8,
  border: "1px solid rgba(255,255,255,0.92)",
  borderRadius: 10,
  background: "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(244,247,251,0.94))",
  color: "#1e293b",
  boxShadow: "4px 4px 10px rgba(100,116,139,0.13), -3px -3px 9px rgba(255,255,255,0.92), inset 1px 1px 0 rgba(255,255,255,0.96)",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "6px 9px",
};

function actionItemRowStyle(color: string | undefined): React.CSSProperties {
  return {
    ...resourceButtonStyle,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: color === "red"
      ? "1px solid rgba(239,68,68,0.24)"
      : color === "yellow"
        ? "1px solid rgba(202,138,4,0.26)"
        : resourceButtonStyle.border,
    background: color === "red"
      ? "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(254,226,226,0.84))"
      : color === "yellow"
        ? "linear-gradient(145deg, rgba(255,255,255,0.96), rgba(254,249,195,0.86))"
        : resourceButtonStyle.background,
    cursor: "default",
    padding: "5px 7px 5px 5px",
  };
}

const actionItemPrimaryButtonStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 0%",
  minHeight: 34,
  display: "grid",
  gridTemplateColumns: "5px 29px minmax(0,1fr)",
  alignItems: "center",
  gap: 9,
  border: 0,
  borderRadius: 7,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  cursor: "pointer",
  textAlign: "left",
  padding: "2px 3px 2px 1px",
};

function actionItemColorBarStyle(color: string | undefined): React.CSSProperties {
  return {
    width: 5,
    height: "100%",
    minHeight: 34,
    borderRadius: 999,
    background: color === "red" ? "#ef4444" : color === "yellow" ? "#facc15" : "#cbd5e1",
    boxShadow: color === "red"
      ? "0 0 9px rgba(239,68,68,0.28)"
      : color === "yellow"
        ? "0 0 9px rgba(250,204,21,0.30)"
        : "none",
  };
}

function actionItemIconStyle(color: string | undefined): React.CSSProperties {
  const colored = color === "red" || color === "yellow";
  return {
    width: 29,
    height: 29,
    display: "grid",
    placeItems: "center",
    border: colored ? "1px solid var(--mango-entity-chip-border)" : "1px solid rgba(100,116,139,0.24)",
    borderRadius: 9,
    background: colored ? "var(--mango-entity-chip-background)" : "linear-gradient(145deg, #ffffff, #e2e8f0)",
    color: colored ? "#111827" : "#64748b",
    boxShadow: colored
      ? "inset 1px 1px 0 rgba(255,255,255,0.84), 0 2px 7px var(--mango-entity-chip-shadow)"
      : "3px 3px 7px rgba(100,116,139,0.14), -2px -2px 6px rgba(255,255,255,0.92)",
    flex: "0 0 auto",
  };
}

function actionItemNameStyle(color: string | undefined): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 800,
    width: "fit-content",
    maxWidth: "100%",
    color: color === "red" ? "#991b1b" : color === "yellow" ? "#713f12" : "#1e293b",
    padding: "4px 0",
  };
}

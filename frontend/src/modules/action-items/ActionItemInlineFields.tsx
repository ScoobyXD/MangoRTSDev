import React from "react";

export const ACTION_ITEM_INLINE_FIELD_IDS = [
  "person_in_charge",
  "assigned_by",
  "created_timestamp",
  "source",
  "color",
  "analysis_due_date",
  "completion_due_date",
  "status",
  "huddle_process",
] as const;

export type ActionItemInlineFieldID = (typeof ACTION_ITEM_INLINE_FIELD_IDS)[number];

export type ActionItemInlineFieldItem = {
  person_in_charge_name?: string | null;
  assigned_by_name?: string | null;
  created_timestamp?: string | null;
  source?: { name?: string | null } | null;
  color?: string | null;
  analysis_due_date?: string | null;
  completion_due_date?: string | null;
  status?: string | null;
  huddle_process?: { name?: string | null } | null;
};

export type ActionItemInlineFieldsProps<Item extends ActionItemInlineFieldItem = ActionItemInlineFieldItem> = {
  item: Item;
  displayedFields: ReadonlyArray<ActionItemInlineFieldID>;
  renderCompletionDueDate?: (item: Item) => React.ReactNode;
};

export function ActionItemInlineFields<Item extends ActionItemInlineFieldItem>({
  item,
  displayedFields,
  renderCompletionDueDate,
}: ActionItemInlineFieldsProps<Item>) {
  return (
    <div
      className="action-item-inline-fields my-work-action-item-inline-fields"
      data-action-item-inline-fields="true"
      data-my-work-action-item-inline-fields="true"
      aria-label="Action Item inline row fields"
      tabIndex={displayedFields.length > 1 ? 0 : -1}
      style={fieldsStyle}
    >
      {displayedFields.map((field) => (
        <span key={field} data-my-work-action-item-inline-field-slot={field} data-action-item-inline-field-slot={field} style={fieldSlotStyle}>
          {field === "completion_due_date" && renderCompletionDueDate
            ? renderCompletionDueDate(item)
            : renderStaticActionItemField(item, field)}
        </span>
      ))}
    </div>
  );
}

function renderStaticActionItemField(
  item: ActionItemInlineFieldItem,
  field: ActionItemInlineFieldID,
): React.ReactNode {
  if (field === "person_in_charge") {
    const name = item.person_in_charge_name?.trim() || "No person in charge";
    return (
      <span
        data-action-item-field={field}
        data-my-work-action-item-field={field}
        data-my-work-person-in-charge="true"
        aria-label={`Person in charge: ${name}`}
        title={`Person in charge: ${name}`}
        style={personStyle}
      >
        <span data-my-work-person-in-charge-icon="true" style={personIconStyle}><PersonIcon /></span>
        <span style={valueStyle}>{name}</span>
      </span>
    );
  }
  const presentation = fieldPresentation(item, field);
  return (
    <span
      data-action-item-field={field}
      data-my-work-action-item-field={field}
      aria-label={`${presentation.label}: ${presentation.value}`}
      title={`${presentation.label}: ${presentation.value}`}
      style={staticFieldStyle}
    >
      <span style={labelStyle}>{presentation.label}</span>
      <span style={valueStyle}>{presentation.value}</span>
    </span>
  );
}

function fieldPresentation(
  item: ActionItemInlineFieldItem,
  field: Exclude<ActionItemInlineFieldID, "person_in_charge">,
): { label: string; value: string } {
  if (field === "assigned_by") return { label: "Assigned by", value: item.assigned_by_name?.trim() || "Unknown" };
  if (field === "created_timestamp") return { label: "Created", value: formatActionItemInlineDate(item.created_timestamp) };
  if (field === "source") return { label: "Source", value: item.source?.name?.trim() || "No source" };
  if (field === "color") return { label: "Color", value: titleCaseLabel(item.color) || "No color" };
  if (field === "analysis_due_date") return { label: "Analysis due", value: formatActionItemInlineDate(item.analysis_due_date) };
  if (field === "completion_due_date") return { label: "Completion due", value: formatActionItemInlineDate(item.completion_due_date) };
  if (field === "status") return { label: "Status", value: titleCaseLabel(item.status) || "No status" };
  return { label: "Huddle process", value: item.huddle_process?.name?.trim() || "No Huddle process" };
}

export function formatActionItemInlineDate(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "");
  return match ? `${match[2]}/${match[3]}/${match[1]}` : "No date";
}

function titleCaseLabel(value: string | null | undefined): string {
  return (value?.trim() ?? "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PersonIcon() {
  return (
    <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ display: "block" }}>
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.35" />
      <path d="M3.5 13.5c.45-2.55 2.05-3.8 4.5-3.8s4.05 1.25 4.5 3.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  );
}

const fieldsStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "0 1 auto",
  maxWidth: "62%",
  display: "flex",
  flexWrap: "nowrap",
  alignItems: "center",
  justifyContent: "flex-start",
  overflowX: "auto",
  overflowY: "hidden",
  whiteSpace: "nowrap",
  marginLeft: "auto",
  gap: 6,
};
const fieldSlotStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "0 0 auto",
  display: "inline-flex",
  alignItems: "center",
};
const staticFieldStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "0 0 auto",
  maxWidth: 162,
  minHeight: 31,
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  boxSizing: "border-box",
  border: "1px solid rgba(100,116,139,.28)",
  borderRadius: 9,
  background: "linear-gradient(145deg,#ffffff,#f1f5f9)",
  color: "#475569",
  boxShadow: "3px 3px 8px rgba(100,116,139,.10), -2px -2px 7px rgba(255,255,255,.92), inset 1px 1px 0 rgba(255,255,255,.94)",
  padding: "4px 7px",
};
const personStyle: React.CSSProperties = {
  ...staticFieldStyle,
  border: "1px solid rgba(14,116,144,.34)",
  background: "linear-gradient(145deg,#ffffff,#ecfeff)",
  color: "#0e7490",
  padding: "2px 8px 2px 4px",
};
const personIconStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  flex: "0 0 auto",
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(14,116,144,.30)",
  borderRadius: 7,
  background: "#ecfeff",
};
const labelStyle: React.CSSProperties = { flex: "0 0 auto", color: "#64748b", fontSize: 9.5, fontWeight: 750 };
const valueStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 10.5,
  fontWeight: 850,
};

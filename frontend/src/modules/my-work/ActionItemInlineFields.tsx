import React from "react";
import type { MyWorkActionItem, MyWorkActionItemDisplayFieldID } from "./myWorkApi.js";

export type ActionItemInlineFieldsProps = {
  item: MyWorkActionItem;
  displayedFields: ReadonlyArray<MyWorkActionItemDisplayFieldID>;
  renderCompletionDueDate: () => React.ReactNode;
};

export function ActionItemInlineFields({ item, displayedFields, renderCompletionDueDate }: ActionItemInlineFieldsProps) {
  return (
    <div data-my-work-action-item-inline-fields="true" style={fieldsStyle}>
      {displayedFields.map((field) => (
        <React.Fragment key={field}>
          {field === "completion_due_date"
            ? renderCompletionDueDate()
            : renderStaticActionItemField(item, field)}
        </React.Fragment>
      ))}
    </div>
  );
}

function renderStaticActionItemField(
  item: MyWorkActionItem,
  field: Exclude<MyWorkActionItemDisplayFieldID, "completion_due_date">,
): React.ReactNode {
  if (field === "person_in_charge") {
    const name = item.person_in_charge_name?.trim() || "No person in charge";
    return (
      <span
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
  item: MyWorkActionItem,
  field: Exclude<MyWorkActionItemDisplayFieldID, "person_in_charge" | "completion_due_date">,
): { label: string; value: string } {
  if (field === "assigned_by") return { label: "Assigned by", value: item.assigned_by_name?.trim() || "Unknown" };
  if (field === "created_timestamp") return { label: "Created", value: formatMyWorkInlineDate(item.created_timestamp) };
  if (field === "source") return { label: "Source", value: item.source?.name?.trim() || "No source" };
  if (field === "color") return { label: "Color", value: titleCaseLabel(item.color) || "No color" };
  if (field === "analysis_due_date") return { label: "Analysis due", value: formatMyWorkInlineDate(item.analysis_due_date) };
  if (field === "status") return { label: "Status", value: titleCaseLabel(item.status) || "No status" };
  return { label: "Huddle process", value: item.huddle_process?.name?.trim() || "No Huddle process" };
}

export function formatMyWorkInlineDate(value: string | null | undefined): string {
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
  maxWidth: "62%",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 6,
};
const staticFieldStyle: React.CSSProperties = {
  minWidth: 0,
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

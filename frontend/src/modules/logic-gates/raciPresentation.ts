import type React from "react";
import {
  KANBAN_LOGIC_GATE_BACKLOG_COLOR,
  KANBAN_LOGIC_GATE_DONE_COLOR,
  KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR,
  KANBAN_LOGIC_GATE_REVIEW_COLOR,
} from "../kanban/shared.js";
import type { LogicGateRACIRole } from "./types.js";

export type LogicGateRACIRolePresentation = {
  role: LogicGateRACIRole;
  label: string;
  accent: string;
};

export const LOGIC_GATE_RACI_ROLE_PRESENTATIONS: ReadonlyArray<LogicGateRACIRolePresentation> = [
  { role: "responsible", label: "Responsible", accent: KANBAN_LOGIC_GATE_IN_PROGRESS_COLOR },
  { role: "accountable", label: "Accountable", accent: KANBAN_LOGIC_GATE_DONE_COLOR },
  { role: "consulted", label: "Consulted", accent: KANBAN_LOGIC_GATE_REVIEW_COLOR },
  { role: "informed", label: "Informed", accent: KANBAN_LOGIC_GATE_BACKLOG_COLOR },
];

const LOGIC_GATE_RACI_ROLE_PRESENTATION_BY_ROLE = new Map(
  LOGIC_GATE_RACI_ROLE_PRESENTATIONS.map((presentation) => [presentation.role, presentation]),
);

export function logicGateRACIRolePresentation(role: string): { label: string; accent: string } {
  const normalizedRole = role.trim().toLowerCase();
  const presentation = LOGIC_GATE_RACI_ROLE_PRESENTATION_BY_ROLE.get(normalizedRole as LogicGateRACIRole);
  if (presentation) return presentation;
  if (normalizedRole === "other") return { label: "Other", accent: "#64748b" };
  if (!normalizedRole || normalizedRole === "none") return { label: "No RACI", accent: "#64748b" };
  return {
    label: normalizedRole.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
    accent: "#64748b",
  };
}

export function logicGateRACIRaisedSurfaceStyle(role: string): React.CSSProperties {
  const { accent } = logicGateRACIRolePresentation(role);
  return {
    border: "1px solid transparent",
    background: `radial-gradient(circle at 12% 10%, ${colorWithAlpha(accent, 0.14)} 0%, ${colorWithAlpha(accent, 0.08)} 34%, transparent 62%) padding-box, linear-gradient(160deg, ${colorWithAlpha(accent, 0.12)} 0%, ${colorWithAlpha(accent, 0.07)} 42%, rgba(255,255,255,0.96) 78%, ${colorWithAlpha(accent, 0.06)} 100%) padding-box, linear-gradient(135deg, ${colorWithAlpha(accent, 0.34)} 0%, ${colorWithAlpha(accent, 0.22)} 46%, ${colorWithAlpha(accent, 0.12)} 78%, rgba(255,255,255,0.92) 100%) border-box`,
    boxShadow: `0 14px 30px ${colorWithAlpha(accent, 0.06)}, 4px 4px 12px rgba(174,174,192,0.14), -4px -4px 12px rgba(255,255,255,0.86), inset 1px 1px 0 rgba(255,255,255,0.90)`,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const value = match[1];
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

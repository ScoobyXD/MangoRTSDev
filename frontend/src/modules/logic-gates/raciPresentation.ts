import type React from "react";
import type { LogicGateRACIRole } from "./types.js";

export type LogicGateRACIRolePresentation = {
  role: LogicGateRACIRole;
  label: string;
  accent: string;
};

export const LOGIC_GATE_RACI_ROLE_PRESENTATIONS: ReadonlyArray<LogicGateRACIRolePresentation> = [
  { role: "responsible", label: "Responsible", accent: "#f97316" },
  { role: "accountable", label: "Accountable", accent: "#16a34a" },
  { role: "consulted", label: "Consulted", accent: "#2563eb" },
  { role: "informed", label: "Informed", accent: "#7c3aed" },
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
    background: `radial-gradient(circle at 12% 10%, ${colorWithAlpha(accent, 0.42)} 0%, ${colorWithAlpha(accent, 0.24)} 34%, transparent 62%) padding-box, linear-gradient(160deg, ${colorWithAlpha(accent, 0.32)} 0%, ${colorWithAlpha(accent, 0.22)} 42%, rgba(248,250,252,0.92) 78%, ${colorWithAlpha(accent, 0.12)} 100%) padding-box, linear-gradient(135deg, ${colorWithAlpha(accent, 0.86)} 0%, ${colorWithAlpha(accent, 0.54)} 46%, ${colorWithAlpha(accent, 0.24)} 78%, rgba(255,255,255,0.88) 100%) border-box`,
    boxShadow: `0 14px 30px ${colorWithAlpha(accent, 0.16)}, 4px 4px 12px rgba(174,174,192,0.18), -4px -4px 12px rgba(255,255,255,0.82), inset 1px 1px 0 rgba(255,255,255,0.86)`,
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const value = match[1];
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

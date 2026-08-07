import type React from "react";
import type { LogicGateGVICRole } from "./types.js";

export type LogicGateGVICRolePresentation = {
  role: LogicGateGVICRole;
  label: string;
  accent: string;
};

export const LOGIC_GATE_GVIC_ROLE_PRESENTATIONS: ReadonlyArray<LogicGateGVICRolePresentation> = [
  { role: "responsible", label: "Responsible", accent: "#f97316" },
  { role: "consulted", label: "Consulted", accent: "#2563eb" },
  { role: "verifier", label: "Verifier", accent: "#16a34a" },
  { role: "informed", label: "Informed", accent: "#7c3aed" },
];

const LOGIC_GATE_GVIC_ROLE_PRESENTATION_BY_ROLE = new Map(
  LOGIC_GATE_GVIC_ROLE_PRESENTATIONS.map((presentation) => [presentation.role, presentation]),
);

export function logicGateGVICRolePresentation(role: string): { label: string; accent: string } {
  const normalizedRole = role.trim().toLowerCase();
  const presentation = LOGIC_GATE_GVIC_ROLE_PRESENTATION_BY_ROLE.get(normalizedRole as LogicGateGVICRole);
  if (presentation) return presentation;
  if (normalizedRole === "other") return { label: "Other", accent: "#64748b" };
  if (!normalizedRole || normalizedRole === "none") return { label: "No RCVI", accent: "#64748b" };
  return {
    label: normalizedRole.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()),
    accent: "#64748b",
  };
}

export function logicGateGVICRaisedSurfaceStyle(role: string): React.CSSProperties {
  const { accent } = logicGateGVICRolePresentation(role);
  return {
    border: "1px solid transparent",
    background: `linear-gradient(145deg, rgba(255,255,255,0.96), ${colorWithAlpha(accent, 0.07)}) padding-box, linear-gradient(135deg, ${colorWithAlpha(accent, 0.67)}, rgba(255,255,255,0.84)) border-box`,
    boxShadow: "4px 4px 12px rgba(174,174,192,0.16), -4px -4px 12px rgba(255,255,255,0.78), inset 1px 1px 0 rgba(255,255,255,0.84)",
  };
}

function colorWithAlpha(color: string, alpha: number): string {
  const match = color.trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const value = match[1];
  return `rgba(${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

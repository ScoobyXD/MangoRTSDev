import type React from "react";
import { logicGateGVICRaisedSurfaceStyle, logicGateGVICRolePresentation } from "../../modules/logic-gate-map/gvicPresentation.js";
import { KANBAN_NODE_PRIORITY_STYLE_OPTIONS } from "../../modules/kanban/shared.js";
import type { UpdateGroup } from "../../modules/notifications/notificationsApi.js";

export type UpdateGroupSemanticPresentation = {
  kind: "gvic" | "priority";
  iconLabel: string;
  iconColor: string;
  iconBorderColor: string;
  surfaceStyle: React.CSSProperties;
};

export function resolveUpdateGroupSemanticPresentation(
  group: Pick<UpdateGroup, "field" | "key" | "label">,
): UpdateGroupSemanticPresentation | null {
  if (group.field === "gvic") {
    const role = group.key.startsWith("gvic:") ? group.key.slice("gvic:".length).trim().toLowerCase() : group.label.trim().toLowerCase();
    const presentation = logicGateGVICRolePresentation(role);
    return {
      kind: "gvic",
      iconLabel: presentation.label.slice(0, 1).toUpperCase() || "G",
      iconColor: presentation.accent,
      iconBorderColor: presentation.accent,
      surfaceStyle: {
        ...logicGateGVICRaisedSurfaceStyle(role),
        minHeight: 28,
        boxSizing: "border-box",
        gridTemplateColumns: "18px minmax(0, auto)",
        gap: 6,
        borderRadius: 8,
        color: "#111827",
        padding: "3px 9px 3px 6px",
      },
    };
  }

  if (group.field === "priority") {
    const priorityValue = group.key.startsWith("priority:") ? group.key.slice("priority:".length).trim() : "";
    const normalizedLabel = normalizeGroupLabel(group.label);
    const option = KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((candidate) => candidate.value === priorityValue)
      ?? KANBAN_NODE_PRIORITY_STYLE_OPTIONS.find((candidate) => normalizeGroupLabel(candidate.label) === normalizedLabel);
    if (!option) return null;
    return {
      kind: "priority",
      iconLabel: "P",
      iconColor: option.color,
      iconBorderColor: option.borderColor,
      surfaceStyle: {
        minHeight: 28,
        boxSizing: "border-box",
        gridTemplateColumns: "18px minmax(0, auto)",
        gap: 6,
        border: `1px solid ${option.borderColor}`,
        borderRadius: 8,
        background: option.surface,
        color: option.color,
        padding: "3px 9px 3px 6px",
        boxShadow: `4px 4px 11px rgba(174,174,192,0.18), -3px -3px 9px rgba(255,255,255,0.82), 0 8px 18px ${option.glow}, inset 1px 1px 0 rgba(255,255,255,0.86)`,
      },
    };
  }

  return null;
}

function normalizeGroupLabel(label: string): string {
  return label.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

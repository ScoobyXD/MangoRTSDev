import type { CSSProperties } from "react";
import { hexToRgba } from "./shared";

export function formatStatusKanbanTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const hours = date.getHours();
  return `${date.getMonth() + 1}/${date.getDate()} ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours >= 12 ? "p.m." : "a.m."}`;
}

export function statusKanbanCardColorRailStyle(color: string): CSSProperties {
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: 6,
    background: `linear-gradient(180deg, ${hexToRgba(color, 0.96)}, ${hexToRgba(color, 0.58)})`,
    boxShadow: `0 0 12px ${hexToRgba(color, 0.22)}`,
    pointerEvents: "none",
  };
}

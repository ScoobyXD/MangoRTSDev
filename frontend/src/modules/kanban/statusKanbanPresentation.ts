import type { CSSProperties } from "react";

export function formatStatusKanbanTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "";
  const hours = date.getHours();
  return `${date.getMonth() + 1}/${date.getDate()} ${hours % 12 || 12}:${String(date.getMinutes()).padStart(2, "0")} ${hours >= 12 ? "p.m." : "a.m."}`;
}

// Original status-board colors; these helpers contain no work state.
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return `rgba(100,116,139,${alpha})`;
  const value = Number.parseInt(clean, 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${alpha})`;
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

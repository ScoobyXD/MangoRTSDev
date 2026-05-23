export const MANGO_FONT_FAMILY = "\"Inter\", \"Inter var\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";

export const MANGO_UI_GRADIENT_COLUMNS = [
  "rgba(71, 85, 105, 1)",
  "rgba(100, 116, 139, 1)",
  "rgba(71, 85, 105, 1)",
  "rgba(100, 116, 139, 1)",
] as const;

export const MANGO_UI_HEX = {
  column1: "#475569",
  column2: "#64748b",
  column3: "#475569",
  column4: "#64748b",
} as const;

export const MANGO_ACCENT = "rgb(71, 85, 105)";
export const MANGO_ACCENT_HEX = MANGO_UI_HEX.column1;
export const MANGO_GRADIENT = `linear-gradient(90deg, ${MANGO_UI_GRADIENT_COLUMNS.join(", ")})`;
export const MANGO_TEXT = "#111827";
export const MANGO_SURFACE = "#ffffff";

export const TEAL_COLORWAY = {
  color: "#475569",
  accent: "#334155",
  text: "#334155",
  tagBg: "#334155",
  tagText: "#ffffff",
} as const;

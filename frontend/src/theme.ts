export const MANGO_FONT_FAMILY = "\"Inter\", \"Inter var\", system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";

export const MANGO_UI_GRADIENT_COLUMNS = [
  "rgba(0, 233, 255, 1)",
  "rgba(56, 189, 248, 1)",
  "rgba(14, 165, 233, 1)",
  "rgba(0, 188, 212, 1)",
] as const;

export const MANGO_UI_HEX = {
  column1: "#00e9ff",
  column2: "#38bdf8",
  column3: "#0ea5e9",
  column4: "#00bcd4",
} as const;

export const MANGO_ACCENT = "rgb(0, 233, 255)";
export const MANGO_ACCENT_HEX = MANGO_UI_HEX.column1;
export const MANGO_GRADIENT = `linear-gradient(90deg, ${MANGO_UI_GRADIENT_COLUMNS.join(", ")})`;
export const MANGO_TEXT = "#111827";
export const MANGO_SURFACE = "#ffffff";

export const TEAL_COLORWAY = {
  color: "#00e9ff",
  accent: "#006f85",
  text: "#042028",
  tagBg: "#042028",
  tagText: "#ffffff",
} as const;

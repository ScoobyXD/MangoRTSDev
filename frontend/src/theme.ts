export const MANGO_FONT_FAMILY = "\"Helvetica Neue\", Helvetica, Arial, sans-serif";

export const MANGO_ORANGE_COLUMNS = [
  "rgba(251, 177, 82, 1)",
  "rgba(254, 169, 78, 1)",
  "rgba(254, 155, 70, 1)",
  "rgba(255, 136, 32, 1)",
] as const;

export const MANGO_ORANGE_HEX = {
  column1: "#fbb152",
  column2: "#fea94e",
  column3: "#fe9b46",
  column4: "#ff8820",
} as const;

export const MANGO_ACCENT = "rgb(255, 136, 32)";
export const MANGO_ACCENT_HEX = MANGO_ORANGE_HEX.column4;
export const MANGO_GRADIENT = `linear-gradient(90deg, ${MANGO_ORANGE_COLUMNS.join(", ")})`;
export const MANGO_TEXT = "#24120a";
export const MANGO_SURFACE = "#ffffff";

export const TEAL_COLORWAY = {
  color: "#00e9ff",
  accent: "#006f85",
  text: "#042028",
  tagBg: "#042028",
  tagText: "#ffffff",
} as const;

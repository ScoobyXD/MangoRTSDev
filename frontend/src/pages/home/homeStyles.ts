import React from "react";
import { HOME_COLUMN_RESIZER_WIDTH, HOME_ROW_RESIZER_HEIGHT, INBOX_PRIORITIES } from "./homeConstants";
import { normalizeResponsibleInboxStatus, responsibleStatusColor } from "./homeUtils";

export const HOME_CYAN = "rgb(71, 85, 105)";
const HOME_CYAN_FAINT = "rgba(71, 85, 105, 0.10)";
const HOME_CYAN_SOFT = "rgba(71, 85, 105, 0.16)";
const HOME_CYAN_HOVER = "rgba(71, 85, 105, 0.24)";
const HOME_CYAN_MEDIUM = "rgba(71, 85, 105, 0.28)";
const HOME_CYAN_BORDER = "rgba(71, 85, 105, 0.72)";
const HOME_BLACK = "#000000";
const HOME_BLACK_SOFT = "rgba(0, 0, 0, 0.18)";
const HOME_NODE_RAIL_ORANGE = "#ff9708";
const HOME_NODE_RAIL_ORANGE_DEEP = "#ff8f00";
const HOME_NODE_RAIL_WHITE = "#ffffff";
const HOME_KEY_COLUMN_RADIUS = 16;
const HOME_KEY_ELEVATED_RADIUS = 11;
const HOME_KEY_PANEL_BACKGROUND = "linear-gradient(180deg, #fbfbfd 0%, #f2f4f8 100%)";
const HOME_KEY_SOFT_BORDER = "rgba(255, 255, 255, 0.76)";
const HOME_KEY_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)";
const HOME_KEY_ACTIVE_SURFACE = "linear-gradient(145deg, #ffffff 0%, #f5f6fa 100%)";
const HOME_KEY_SHADOW = "7px 7px 16px rgba(174, 174, 192, 0.26), -7px -7px 16px rgba(255, 255, 255, 0.92), inset 1px 1px 0 rgba(255, 255, 255, 0.86)";
const HOME_KEY_RAISED_SHADOW = "10px 10px 22px rgba(174, 174, 192, 0.32), -8px -8px 18px rgba(255, 255, 255, 0.96), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const HOME_KEY_ACTIVE_SHADOW = "8px 8px 20px rgba(174, 174, 192, 0.30), -7px -7px 16px rgba(255, 255, 255, 0.95), inset 0 0 0 1px rgba(148, 163, 184, 0.14)";
const HOME_KEY_EDGE_FRAME_GRADIENT = "linear-gradient(135deg, rgba(92, 238, 255, 0.92) 0%, rgba(128, 216, 255, 0.82) 34%, rgba(183, 124, 255, 0.88) 72%, rgba(255, 255, 255, 0.86) 100%)";
const HOME_KEY_EDGE_FRAME_SHADOW = "0 0 0 1px rgba(120, 224, 255, 0.22), 0 8px 22px rgba(96, 165, 250, 0.12), 0 0 16px rgba(183, 124, 255, 0.24), inset 1px 1px 0 rgba(255, 255, 255, 0.9)";
const HOME_KEY_PANEL_SHADOW = "inset 0 0 0 1px rgba(255, 255, 255, 0.72), inset 5px 5px 16px rgba(174, 174, 192, 0.16), inset -5px -5px 16px rgba(255, 255, 255, 0.86), 0 12px 28px rgba(15, 23, 42, 0.14)";
const HOME_NODE_ICON_BLUE = "#19a8ff";
const HOME_NODE_ICON_BLUE_SOFT = "rgba(25, 168, 255, 0.12)";
const HOME_NODE_ICON_BLUE_BORDER = "rgba(25, 168, 255, 0.68)";
const HOME_LOGIC_GATE_GREEN = "#19f07a";
const HOME_LOGIC_GATE_GREEN_SOFT = "rgba(25, 240, 122, 0.12)";
const HOME_LOGIC_GATE_GREEN_BORDER = "rgba(25, 240, 122, 0.72)";

export function homeColorWithAlpha(color: string, alpha: number): string {
  const trimmed = color.trim();
  const hexMatch = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const value = hexMatch[1];
    const red = Number.parseInt(value.slice(0, 2), 16);
    const green = Number.parseInt(value.slice(2, 4), 16);
    const blue = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }
  const rgbMatch = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) return `rgba(${rgbMatch[1]}, ${rgbMatch[2]}, ${rgbMatch[3]}, ${alpha})`;
  return trimmed;
}

export const pageStyle: React.CSSProperties = {
  height: "100vh",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  background: "#edf2f7",
  color: "#111827",
  fontFamily: "var(--mango-font-family)",
};

export const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 14,
  padding: "0 18px",
  borderBottom: `1px solid ${HOME_BLACK}`,
  background: "#ffffff",
};

export const brandStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  lineHeight: 1,
};

export const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
};

export const headerDividerStyle: React.CSSProperties = {
  width: 1,
  height: 22,
  background: HOME_BLACK,
};

export const userPillStyle: React.CSSProperties = {
  maxWidth: 220,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
};

export const workspaceStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  gap: 10,
  padding: 10,
  overflow: "auto",
  background: "#ffffff",
};

export const columnResizeHandleStyle: React.CSSProperties = {
  position: "relative",
  zIndex: 4,
  minHeight: 0,
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "stretch",
  justifyContent: "center",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "col-resize",
  touchAction: "none",
};

export const columnResizeGripStyle: React.CSSProperties = {
  width: 2,
  minHeight: 0,
  borderRadius: 2,
  background: "transparent",
};

export const railRowResizeHandleStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "stretch",
  padding: 0,
  border: 0,
  background: "transparent",
  cursor: "row-resize",
  touchAction: "none",
};

export const railRowResizeGripStyle: React.CSSProperties = {
  width: "100%",
  height: 2,
  borderRadius: 2,
  background: "transparent",
};

export const sidebarStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 8,
  padding: 8,
  border: "none",
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

export const sidebarNavStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
  overflow: "auto",
};

export const sidebarSectionStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
  minWidth: 0,
};

export const sharedInboxRowsStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  minWidth: 0,
};

export function sharedInboxFolderRowStyle(depth: number, active: boolean, dropPlacement: "before" | "after" | "inside" | null, hovered = false): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "18px 17px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${active ? HOME_CYAN_BORDER : dropPlacement === "inside" ? HOME_CYAN_BORDER : hovered ? HOME_CYAN_MEDIUM : "transparent"}`,
    borderRadius: 6,
    background: active ? HOME_CYAN_SOFT : dropPlacement === "inside" ? HOME_CYAN_FAINT : hovered ? HOME_CYAN_HOVER : "#ffffff",
    color: "#111827",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    padding: `3px 5px 3px ${8 + depth * 14}px`,
    textAlign: "left",
    minWidth: 0,
    boxShadow: dropPlacement === "before"
      ? `inset 0 2px 0 ${HOME_CYAN}`
      : dropPlacement === "after"
        ? `inset 0 -2px 0 ${HOME_CYAN}`
        : undefined,
  };
}

export const sharedInboxDisclosureButtonStyle: React.CSSProperties = {
  width: 18,
  height: 20,
  display: "grid",
  placeItems: "center",
  border: "none",
  background: "transparent",
  color: "rgba(15, 23, 42, 0.62)",
  cursor: "pointer",
  padding: 0,
};

export const sharedInboxRenameInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 23,
  border: `1px solid ${HOME_CYAN}`,
  borderRadius: 5,
  background: "#ffffff",
  color: "#111827",
  font: "inherit",
  fontSize: 12,
  fontWeight: 700,
  padding: "0 6px",
  outline: "none",
};

export const sharedInboxContextMenuButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 12px",
};

export function navButtonStyle(active: boolean): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 8,
    border: `1px solid ${active ? HOME_CYAN_BORDER : HOME_BLACK_SOFT}`,
    borderRadius: 6,
    background: active ? HOME_CYAN_SOFT : "#ffffff",
    color: "#111827",
    cursor: "pointer",
    font: "inherit",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    padding: "0 10px",
    textAlign: "left",
    minWidth: 0,
  };
}

export const navLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const sharedInboxLabelStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 1,
};

export const sharedInboxAccountMetaStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  color: "rgba(15, 23, 42, 0.54)",
  fontSize: 10,
  fontWeight: 600,
};

export const navMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(15, 23, 42, 0.54)",
};

export const sharedInboxCreateStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 30px",
  gap: 5,
};

export const sharedInboxInputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 30,
  border: `1px solid ${HOME_BLACK_SOFT}`,
  borderRadius: 6,
  padding: "0 8px",
  font: "inherit",
  fontSize: 11,
};

export const sharedInboxCreateButtonStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  border: `1px solid ${HOME_CYAN_BORDER}`,
  borderRadius: 6,
  background: "#ffffff",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1,
};

export const panelStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto",
  gap: 10,
  padding: 10,
  border: "none",
  background: HOME_KEY_PANEL_BACKGROUND,
  borderRadius: HOME_KEY_COLUMN_RADIUS,
  boxShadow: HOME_KEY_PANEL_SHADOW,
  overflow: "hidden",
};

export function mailViewerPanelStyle(attached: boolean): React.CSSProperties {
  return {
    ...panelStyle,
    marginLeft: attached ? -HOME_COLUMN_RESIZER_WIDTH : 0,
    borderRadius: attached ? `0 ${HOME_KEY_COLUMN_RADIUS}px ${HOME_KEY_COLUMN_RADIUS}px 0` : HOME_KEY_COLUMN_RADIUS,
  };
}

export function mailPanelStyle(attached: boolean): React.CSSProperties {
  return {
    minHeight: 0,
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr)",
    gap: 12,
    padding: 10,
    border: "none",
    background: HOME_KEY_PANEL_BACKGROUND,
    borderRadius: attached ? `${HOME_KEY_COLUMN_RADIUS}px 0 0 ${HOME_KEY_COLUMN_RADIUS}px` : HOME_KEY_COLUMN_RADIUS,
    boxShadow: HOME_KEY_PANEL_SHADOW,
    overflow: "hidden",
  };
}

export const mailPanelControlsStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 8,
};

export function logicGateRailStyle(topHeight: number): React.CSSProperties {
  return {
    position: "sticky",
    right: 0,
    zIndex: 2,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: `${topHeight}px ${HOME_ROW_RESIZER_HEIGHT}px minmax(0, 1fr)`,
    gap: 0,
    padding: 10,
    overflow: "hidden",
    background: "#ffffff",
    borderRadius: 8,
    boxShadow: "0 14px 34px rgba(15, 23, 42, 0.10), 0 1px 0 rgba(255, 255, 255, 0.92) inset",
  };
}

export const logicGateRailSectionStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 0,
  border: "none",
  background: "transparent",
  borderRadius: 0,
  overflow: "hidden",
};

export const logicGateRailHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

export function nodeInboxRailStyle(topHeight: number): React.CSSProperties {
  return {
    position: "sticky",
    right: 0,
    zIndex: 2,
    minHeight: 0,
    display: "grid",
    gridTemplateRows: `${topHeight}px ${HOME_ROW_RESIZER_HEIGHT}px minmax(0, 1fr)`,
    gap: 0,
    padding: 0,
    overflow: "hidden",
    background: HOME_NODE_RAIL_WHITE,
    borderRadius: "34px 34px 46px 46px",
    boxShadow: "0 22px 42px rgba(255, 143, 0, 0.16), 0 16px 34px rgba(15, 23, 42, 0.14)",
  };
}

export const nodeInboxRailSectionStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  padding: 0,
  border: "none",
  background: "transparent",
  borderRadius: 0,
  overflow: "hidden",
};

export const nodeInboxPrimarySectionStyle: React.CSSProperties = {
  ...nodeInboxRailSectionStyle,
  padding: "18px 14px 10px",
  background: `linear-gradient(180deg, ${HOME_NODE_RAIL_ORANGE} 0%, ${HOME_NODE_RAIL_ORANGE_DEEP} 100%)`,
};

export const nodeInboxOtherSectionStyle: React.CSSProperties = {
  ...nodeInboxRailSectionStyle,
  padding: "10px 14px 16px",
  background: HOME_NODE_RAIL_WHITE,
};

export const nodeInboxRailHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
  padding: "0 2px",
};

export const nodeInboxPanelTitleStyle: React.CSSProperties = {
  margin: 0,
  color: HOME_NODE_RAIL_WHITE,
  fontSize: 14,
  fontWeight: 800,
  lineHeight: 1.1,
};

export const nodeInboxMutedSmallStyle: React.CSSProperties = {
  color: "rgba(255, 255, 255, 0.72)",
  fontSize: 11,
  fontWeight: 700,
};

export const nodeInboxOtherPanelTitleStyle: React.CSSProperties = {
  ...nodeInboxPanelTitleStyle,
  color: HOME_NODE_RAIL_ORANGE,
};

export const nodeInboxOtherMutedSmallStyle: React.CSSProperties = {
  ...nodeInboxMutedSmallStyle,
  color: "rgba(255, 151, 8, 0.70)",
};

export const nodeInboxListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 12,
  overflowY: "auto",
  padding: "2px 2px 6px 0",
  scrollbarColor: "rgba(255, 255, 255, 0.72) transparent",
};

export const nodeInboxOtherListStyle: React.CSSProperties = {
  ...nodeInboxListStyle,
  scrollbarColor: "rgba(255, 151, 8, 0.56) transparent",
};

export const nodeInboxGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 8,
};

export const nodeInboxFolderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 6,
  color: HOME_NODE_RAIL_WHITE,
  fontSize: 10,
  fontWeight: 800,
};

export const nodeInboxGroupCountStyle: React.CSSProperties = {
  minWidth: 17,
  height: 17,
  display: "grid",
  placeItems: "center",
  border: `1px solid rgba(255, 255, 255, 0.72)`,
  borderRadius: 999,
  color: HOME_NODE_RAIL_WHITE,
  fontSize: 9,
  fontWeight: 800,
  lineHeight: 1,
};

export const nodeInboxGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
  gap: 7,
};

export type NodeInboxTileTone = "orange" | "light";

export function nodeInboxTileStyle(selected: boolean, tone: NodeInboxTileTone = "orange"): React.CSSProperties {
  const lightTone = tone === "light";
  return {
    position: "relative",
    minHeight: 68,
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 5,
    border: `1px solid ${lightTone ? HOME_NODE_RAIL_ORANGE : HOME_NODE_RAIL_WHITE}`,
    borderRadius: 7,
    background: lightTone
      ? selected ? "rgba(255, 151, 8, 0.10)" : HOME_NODE_RAIL_WHITE
      : selected ? "rgba(255, 255, 255, 0.18)" : "rgba(255, 255, 255, 0.05)",
    color: lightTone ? HOME_NODE_RAIL_ORANGE : HOME_NODE_RAIL_WHITE,
    cursor: "grab",
    font: "inherit",
    padding: "7px 6px",
    minWidth: 0,
    boxShadow: selected ? (lightTone ? "0 0 0 2px rgba(255, 151, 8, 0.14)" : "0 0 0 2px rgba(255, 255, 255, 0.22)") : "none",
  };
}

export const nodeInboxTileIconStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  background: "transparent",
};

export function nodeInboxTileTextStyle(tone: NodeInboxTileTone = "orange"): React.CSSProperties {
  return {
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflowWrap: "anywhere",
    textAlign: "center",
    color: tone === "light" ? HOME_NODE_RAIL_ORANGE : HOME_NODE_RAIL_WHITE,
    fontSize: 10,
    fontWeight: 800,
    lineHeight: 1.15,
  };
}

export const nodeInboxEmptyStyle: React.CSSProperties = {
  minHeight: 64,
  display: "grid",
  placeItems: "center",
  color: "rgba(255, 255, 255, 0.72)",
  fontSize: 11,
  fontWeight: 700,
  textAlign: "center",
};

export const nodeInboxOtherEmptyStyle: React.CSSProperties = {
  ...nodeInboxEmptyStyle,
  color: "rgba(255, 151, 8, 0.68)",
};

export const myLogicGatesListStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 10,
  overflowY: "auto",
  paddingRight: 2,
};

export const myLogicGateGroupStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 7,
};

export const myLogicGateFolderLabelStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  color: "rgba(15, 23, 42, 0.76)",
};

export const myLogicGateGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
  gap: 8,
};

export function myLogicGateTileStyle(selected: boolean): React.CSSProperties {
  return {
    position: "relative",
    minHeight: 88,
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
    gap: 7,
    border: `1px solid ${selected ? HOME_LOGIC_GATE_GREEN : HOME_LOGIC_GATE_GREEN_BORDER}`,
    borderRadius: 7,
    background: "#ffffff",
    color: "#111827",
    cursor: "grab",
    font: "inherit",
    padding: "10px 8px",
    minWidth: 0,
    boxShadow: selected ? `0 0 0 2px ${HOME_LOGIC_GATE_GREEN_SOFT}` : "none",
  };
}

export const myLogicGateTileIconStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  background: "#ffffff",
  transform: "scale(1.5)",
};

export const myNodeTileIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  background: "#ffffff",
  transform: "scale(1.35)",
};

export const myLogicGateTileTextStyle: React.CSSProperties = {
  maxWidth: "100%",
  minWidth: 0,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  overflowWrap: "anywhere",
  textAlign: "center",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
};

export const shortcutRemoveStyle: React.CSSProperties = {
  position: "absolute",
  top: 5,
  right: 6,
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  borderRadius: 4,
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 12,
  lineHeight: 1,
  cursor: "pointer",
};

export const allLogicGateRowsStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 2,
  paddingRight: 2,
};

export function logicGateTreeRowStyle(depth: number, selected: boolean, isDropTarget: boolean): React.CSSProperties {
  return {
    minHeight: 29,
    display: "flex",
    alignItems: "center",
    gap: 6,
    border: `1px solid ${selected ? HOME_CYAN_BORDER : "transparent"}`,
    borderRadius: 6,
    background: selected ? HOME_CYAN_SOFT : isDropTarget ? "#ffffff" : "transparent",
    color: "#111827",
    cursor: "pointer",
    padding: `3px 7px 3px ${6 + depth * 14}px`,
    minWidth: 0,
  };
}

export const logicGateDisclosureStyle: React.CSSProperties = {
  width: 18,
  height: 20,
  border: "none",
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  padding: 0,
  flexShrink: 0,
};

export const logicGateTreeRowTextStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 600,
};

export const logicGateRaciPanelStyle: React.CSSProperties = {
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  padding: 0,
  border: "none",
  background: "transparent",
  borderRadius: 0,
  overflow: "visible",
};

export const logicGateRaciMatrixSurfaceStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  minHeight: 0,
  maxWidth: "100%",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 10,
  padding: "14px 14px 16px",
  border: "1px solid rgba(255, 255, 255, 0.62)",
  borderRadius: 8,
  background:
    "radial-gradient(circle at 10% 8%, rgba(255, 196, 218, 0.72) 0%, rgba(255, 196, 218, 0) 26%), radial-gradient(circle at 92% 0%, rgba(178, 166, 255, 0.72) 0%, rgba(178, 166, 255, 0) 32%), radial-gradient(circle at 88% 92%, rgba(88, 238, 226, 0.56) 0%, rgba(88, 238, 226, 0) 32%), linear-gradient(135deg, rgba(255, 255, 255, 0.92) 0%, rgba(237, 243, 255, 0.84) 42%, rgba(244, 232, 255, 0.70) 68%, rgba(224, 255, 250, 0.76) 100%)",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.13), 0 20px 56px rgba(125, 151, 255, 0.18), 0 1px 0 rgba(255, 255, 255, 0.94) inset",
  boxSizing: "border-box",
  overflow: "hidden",
};

export const logicGateRaciHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
};

export const logicGateRaciMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "rgba(15, 23, 42, 0.56)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export const logicGateRaciScrollStyle: React.CSSProperties = {
  minHeight: 0,
  height: "100%",
  overflow: "auto",
  padding: "2px 4px 8px 0",
  ["--kanban-board-scroll-accent" as string]: HOME_CYAN,
  ["--kanban-board-scroll-track" as string]: HOME_CYAN_FAINT,
};

export function inboxMatrixGridStyle(columnCount: number): React.CSSProperties {
  return {
    minWidth: columnCount >= 4 ? 920 : 760,
    display: "grid",
    gridTemplateColumns: `116px repeat(${columnCount}, minmax(210px, 1fr))`,
    gridTemplateRows: `54px repeat(${INBOX_PRIORITIES.length}, minmax(112px, auto))`,
    alignItems: "stretch",
    background: "rgba(255, 255, 255, 0.16)",
    filter: "drop-shadow(0 8px 18px rgba(96, 165, 250, 0.08))",
  };
}

export const logicGateRaciCornerStyle: React.CSSProperties = {
  gridColumn: 1,
  gridRow: 1,
  background: "rgba(255, 255, 255, 0.34)",
};

export const logicGateRaciColumnHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "rgba(255, 255, 255, 0.38)",
  padding: "0 12px",
};

export const logicGateRaciColumnLetterStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${HOME_CYAN_BORDER}`,
  borderRadius: 5,
  background: HOME_CYAN_FAINT,
  color: HOME_CYAN,
  fontSize: 13,
  fontWeight: 800,
  flexShrink: 0,
};

export const logicGateRaciColumnLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 12,
  fontWeight: 700,
};

export const logicGateRaciPriorityHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  alignItems: "start",
  background: "rgba(255, 255, 255, 0.34)",
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
  padding: "10px 8px 0 0",
  textAlign: "right",
};

export function logicGateRaciCellStyle(activeDrop: boolean): React.CSSProperties {
  return {
    minHeight: 112,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(184px, 196px))",
    alignContent: "start",
    alignItems: "start",
    justifyContent: "start",
    gap: 10,
    background: activeDrop ? HOME_CYAN_FAINT : "rgba(255, 255, 255, 0.20)",
    boxShadow: activeDrop ? `inset 0 0 0 2px ${HOME_CYAN_MEDIUM}` : "none",
    padding: 10,
    transition: "background 120ms ease, box-shadow 120ms ease",
  };
}

export const logicGateInboxGroupStyle: React.CSSProperties = {
  position: "relative",
  width: "min(100%, 196px)",
  aspectRatio: "1 / 1",
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "44px minmax(0, 1fr)",
  border: `1px solid ${HOME_LOGIC_GATE_GREEN_BORDER}`,
  borderRadius: 8,
  background: "#ffffff",
  overflow: "hidden",
  boxShadow: "0 10px 22px rgba(15, 23, 42, 0.09), 0 1px 0 rgba(255, 255, 255, 0.92) inset",
};

export const logicGateInboxGroupResizeHandleStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  bottom: 0,
  height: 9,
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  cursor: "row-resize",
  touchAction: "none",
  zIndex: 3,
};

export const logicGateInboxGroupResizeGripStyle: React.CSSProperties = {
  width: 36,
  height: 3,
  marginBottom: 2,
  borderRadius: 2,
  background: "rgba(15, 23, 42, 0.34)",
};

export function logicGateInboxGroupHeaderStyle(interactive: boolean, color?: string): React.CSSProperties {
  const tint = color ? homeColorWithAlpha(color, 0.13) : "rgba(248, 250, 252, 0.92)";
  const strongerTint = color ? homeColorWithAlpha(color, 0.20) : "#ffffff";
  return {
    width: "100%",
    minHeight: 44,
    display: "grid",
    gridTemplateColumns: "30px minmax(0, 1fr) auto auto auto",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderBottom: `1px solid rgba(15, 23, 42, 0.10)`,
    background: `linear-gradient(180deg, ${strongerTint} 0%, ${tint} 100%)`,
    color: "#111827",
    cursor: interactive ? "pointer" : "default",
    padding: "0 9px",
    minWidth: 0,
    textAlign: "left",
    opacity: 1,
  };
}

export const logicGateInboxGroupIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${HOME_LOGIC_GATE_GREEN_BORDER}`,
  borderRadius: 6,
  background: "#ffffff",
};

export const logicGateInboxGroupTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  fontSize: 11,
  lineHeight: 1.15,
  fontWeight: 800,
};

export function logicGateInboxGroupNotificationStyle(role: string): React.CSSProperties {
  const colors = inboxNotificationRoleColors(role);
  return {
    minWidth: 21,
    height: 18,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.background,
    color: colors.color,
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1,
    padding: "0 5px",
    boxSizing: "border-box",
  };
}

function inboxNotificationRoleColors(role: string): { background: string; border: string; color: string } {
  switch (role) {
    case "responsible":
      return { background: "#f1f5f9", border: "rgba(100, 116, 139, 0.36)", color: "#334155" };
    case "accountable":
      return { background: "#f1f5f9", border: "rgba(100, 116, 139, 0.38)", color: "#334155" };
    case "consulted":
      return { background: "#f1f5f9", border: "rgba(100, 116, 139, 0.34)", color: "#334155" };
    case "informed":
      return { background: "#f1f5f9", border: "rgba(100, 116, 139, 0.32)", color: "#334155" };
    case "other":
      return { background: "#f8fafc", border: "rgba(100, 116, 139, 0.34)", color: "#334155" };
    default:
      return { background: HOME_CYAN_FAINT, border: HOME_CYAN_MEDIUM, color: "#334155" };
  }
}
export const logicGateInboxGroupCountStyle: React.CSSProperties = {
  minWidth: 21,
  height: 18,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${HOME_BLACK_SOFT}`,
  borderRadius: 4,
  background: "rgba(255, 255, 255, 0.78)",
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
};

export const logicGateInboxNodeListStyle: React.CSSProperties = {
  height: "100%",
  maxHeight: "none",
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 5,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "8px 8px 12px",
  background: "linear-gradient(180deg, #ffffff 0%, #fbfdfe 100%)",
  ["--kanban-board-scroll-accent" as string]: HOME_CYAN,
  ["--kanban-board-scroll-track" as string]: HOME_CYAN_FAINT,
};

export function logicGateInboxNodeRowStyle(selected: boolean, depth = 0, hasUnreadNotification = false): React.CSSProperties {
  const indentPx = 10 + Math.min(Math.max(0, Math.round(depth)), 8) * 14;
  return {
    minHeight: 28,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: `${indentPx}px 16px minmax(0, 1fr) auto auto`,
    alignItems: "center",
    gap: 5,
    border: `1px solid ${selected ? HOME_NODE_ICON_BLUE : HOME_NODE_ICON_BLUE_BORDER}`,
    borderRadius: 6,
    background: selected ? HOME_NODE_ICON_BLUE_SOFT : hasUnreadNotification ? "#f8fbff" : "rgba(255, 255, 255, 0.94)",
    color: "#111827",
    cursor: "grab",
    padding: "4px 5px 4px 0",
    boxShadow: selected
      ? `0 0 0 2px ${HOME_NODE_ICON_BLUE_SOFT} inset`
      : hasUnreadNotification
        ? "0 0 0 1px rgba(100, 116, 139, 0.16) inset"
        : "0 1px 2px rgba(15, 23, 42, 0.04)",
  };
}

export const logicGateInboxNodeGuideStyle: React.CSSProperties = {
  width: 10,
  height: "100%",
  borderLeft: "1px solid rgba(15, 23, 42, 0.18)",
  borderBottom: "1px solid rgba(15, 23, 42, 0.18)",
  justifySelf: "end",
};

export const logicGateInboxNodeIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
};

export function logicGateInboxNodeTitleStyle(hasUnreadNotification = false): React.CSSProperties {
  return {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 11,
    fontWeight: hasUnreadNotification ? 800 : 600,
  };
}

export function logicGateInboxNodeNotificationStyle(role: string): React.CSSProperties {
  const colors = inboxNotificationRoleColors(role);
  return {
    minWidth: 18,
    height: 16,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${colors.border}`,
    borderRadius: 4,
    background: colors.background,
    color: colors.color,
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1,
    padding: "0 4px",
    boxSizing: "border-box",
  };
}

export const logicGateInboxNodeRemoveStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "rgba(15, 23, 42, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
};

export function logicGateInboxNodeStatusStyle(value: unknown): React.CSSProperties {
  const status = normalizeResponsibleInboxStatus(value);
  const color = status ? responsibleStatusColor(status) : "rgba(15, 23, 42, 0.48)";
  return {
    minWidth: 21,
    height: 18,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${status ? color : "rgba(15, 23, 42, 0.16)"}`,
    borderRadius: 4,
    background: "rgba(255, 255, 255, 0.72)",
    color,
    fontSize: 9,
    fontWeight: 800,
    lineHeight: 1,
  };
}

export const emptySmallStyle: React.CSSProperties = {
  minHeight: 64,
  display: "grid",
  placeItems: "center",
  color: "rgba(15, 23, 42, 0.52)",
  fontSize: 11,
};

export const messageContextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 80,
  minWidth: 178,
  padding: 4,
  border: "1px solid rgba(15, 23, 42, 0.16)",
  borderRadius: 7,
  background: "#ffffff",
  boxShadow: "0 12px 28px rgba(0, 0, 0, 0.16)",
};

export const nodeEditorPopupBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 130,
  display: "grid",
  placeItems: "center",
  background: "rgba(15, 23, 42, 0.18)",
  padding: 22,
};

export const nodeEditorPopupStyle: React.CSSProperties = {
  position: "relative",
  width: "min(1180px, calc(100vw - 44px))",
  height: "min(820px, calc(100vh - 64px))",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100vh - 64px))",
  border: "1px solid rgba(100, 116, 139, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(15, 23, 42, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
  overflow: "hidden",
  cursor: "default",
};

export const nodeEditorPopupCloseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 8,
  zIndex: 8,
  width: 24,
  height: 24,
  border: "1px solid #334155",
  borderRadius: 4,
  background: "#475569",
  color: "#ffffff",
  fontSize: 16,
  fontWeight: 600,
  lineHeight: "20px",
  cursor: "pointer",
};

export const nodeEditorPopupCollapseButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 7,
  right: 38,
  zIndex: 8,
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: "1px solid rgba(100, 116, 139, 0.56)",
  borderRadius: 4,
  background: "#ffffff",
  color: "#334155",
  padding: 0,
  cursor: "pointer",
};

export const deleteModalBackdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  display: "grid",
  placeItems: "center",
  background: "rgba(0,0,0,0.28)",
};

export const deleteModalStyle: React.CSSProperties = {
  width: "min(420px, 90%)",
  display: "grid",
  gap: 10,
  border: "1px solid rgba(100,116,139,0.45)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#111827",
  padding: 12,
  boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
};

export const deleteModalDetailStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.68)",
  fontSize: 11,
  lineHeight: 1.35,
};

export const contextMenuActionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  fontWeight: 600,
  textAlign: "left",
  padding: "0 10px",
};

export const connectPanelStyle: React.CSSProperties = {
  width: "min(460px, calc(100vw - 28px))",
  display: "grid",
  gap: 12,
  padding: 16,
  border: "1px solid rgba(100, 116, 139, 0.24)",
  background: "#ffffff",
  borderRadius: 8,
};

export const centerStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  placeItems: "center",
  padding: 16,
};

export const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "start",
  justifyContent: "space-between",
  gap: 10,
  minWidth: 0,
};

export const panelTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 600,
};

export const mutedTextStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.68)",
  fontSize: 12,
  lineHeight: 1.45,
};

export const mutedSmallStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 11,
  overflowWrap: "anywhere",
};

export const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(100, 116, 139, 0.32)",
  borderRadius: 6,
  background: "#fff",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  padding: "0 9px",
};

export const headerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid rgba(100, 116, 139, 0.62)",
  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.84), rgba(15, 23, 42, 0.72))",
  color: "#f8fafc",
  fontWeight: 500,
  boxShadow: "0 0 0 1px rgba(100, 116, 139, 0.12) inset, 0 8px 20px rgba(0, 0, 0, 0.18)",
};

export const primaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid #334155",
  borderRadius: 6,
  background: "var(--mango-gradient)",
  color: "#111827",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 10px",
};

export const mailPanelSmallButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: `1px solid ${HOME_KEY_SOFT_BORDER}`,
  borderRadius: HOME_KEY_ELEVATED_RADIUS,
  background: HOME_KEY_SURFACE,
  color: "#111111",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 650,
  padding: "0 10px",
  boxShadow: HOME_KEY_SHADOW,
  letterSpacing: 0,
  transition: "background 140ms ease, border-color 140ms ease, box-shadow 160ms ease, transform 160ms ease",
};

export const mailPanelPrimaryButtonStyle: React.CSSProperties = {
  ...mailPanelSmallButtonStyle,
  minHeight: 38,
  border: "1px solid transparent",
  background: `${HOME_KEY_SURFACE} padding-box, ${HOME_KEY_EDGE_FRAME_GRADIENT} border-box`,
  boxShadow: `${HOME_KEY_RAISED_SHADOW}, ${HOME_KEY_EDGE_FRAME_SHADOW}`,
};

export const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#64748b",
  color: "#334155",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(100, 116, 139, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
};

export const mailPanelInputStyle: React.CSSProperties = {
  ...inputStyle,
  border: `1px solid ${HOME_KEY_SOFT_BORDER}`,
  borderRadius: HOME_KEY_ELEVATED_RADIUS,
  background: HOME_KEY_SURFACE,
  color: "#111827",
  boxShadow: "inset 3px 3px 8px rgba(174, 174, 192, 0.18), inset -3px -3px 8px rgba(255, 255, 255, 0.82)",
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  height: "min(280px, 34vh)",
  resize: "vertical",
  padding: 9,
  lineHeight: 1.45,
};

export const mailPanelTextareaStyle: React.CSSProperties = {
  ...mailPanelInputStyle,
  height: "min(280px, 34vh)",
  resize: "vertical",
  padding: 9,
  lineHeight: 1.45,
};

export const mailListToolbarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
};

export const triageMailListHeaderStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.35fr)",
  gap: 10,
  alignItems: "start",
  minWidth: 0,
};

export const mailListTitleStackStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

export const accountRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  justifySelf: "end",
  minWidth: 0,
  maxWidth: "100%",
};

export const accountEmailStyle: React.CSSProperties = {
  ...mutedSmallStyle,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const searchRowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 72px",
  gap: 6,
  alignItems: "center",
};

export const searchButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  width: "100%",
  height: 34,
  alignSelf: "center",
};

export const mailPanelSearchButtonStyle: React.CSSProperties = {
  ...mailPanelSmallButtonStyle,
  width: "100%",
  height: 34,
  alignSelf: "center",
};

export const mailArchiveActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
  alignItems: "center",
};

export function mailArchiveActionButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...mailPanelSmallButtonStyle,
    minHeight: 34,
    width: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    overflow: "hidden",
    whiteSpace: "nowrap",
    fontWeight: 700,
    border: `1px solid ${active ? "transparent" : HOME_KEY_SOFT_BORDER}`,
    background: active ? `${HOME_KEY_ACTIVE_SURFACE} padding-box, ${HOME_KEY_EDGE_FRAME_GRADIENT} border-box` : HOME_KEY_SURFACE,
    color: "#111111",
    boxShadow: active ? `${HOME_KEY_ACTIVE_SHADOW}, ${HOME_KEY_EDGE_FRAME_SHADOW}` : HOME_KEY_SHADOW,
  };
}

export const mailArchiveActionLabelStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const mailArchiveActionCountStyle: React.CSSProperties = {
  flexShrink: 0,
  minWidth: 18,
  height: 18,
  display: "inline-grid",
  placeItems: "center",
  borderRadius: 9,
  padding: "0 5px",
  border: "1px solid rgba(148, 163, 184, 0.18)",
  background: "linear-gradient(145deg, #ffffff 0%, #f6f7fb 100%)",
  color: "#334155",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
  boxShadow: "2px 2px 5px rgba(174, 174, 192, 0.22), -2px -2px 5px rgba(255, 255, 255, 0.86)",
};

export const mailFiltersRowStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

export const checkboxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 7,
  fontSize: 11,
};

export const selectedCountStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.58)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export const listHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 8,
  fontSize: 11,
  fontWeight: 600,
};

export const messageListStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  alignContent: "start",
  gap: 10,
  padding: "2px 4px 4px",
};

export const loadingMoreStyle: React.CSSProperties = {
  minHeight: 28,
  display: "grid",
  placeItems: "center",
  color: "rgba(15, 23, 42, 0.56)",
  fontSize: 11,
};

export function messageRowStyle(active: boolean, unread: boolean, hovered = false): React.CSSProperties {
  const framed = active || hovered;
  return {
    display: "grid",
    gap: 4,
    minHeight: 78,
    border: `1px solid ${framed ? "transparent" : HOME_KEY_SOFT_BORDER}`,
    borderRadius: HOME_KEY_ELEVATED_RADIUS,
    background: framed ? `${active ? HOME_KEY_ACTIVE_SURFACE : HOME_KEY_SURFACE} padding-box, ${HOME_KEY_EDGE_FRAME_GRADIENT} border-box` : HOME_KEY_SURFACE,
    cursor: "pointer",
    color: "#111827",
    font: "inherit",
    fontSize: 12,
    fontWeight: unread ? 700 : 600,
    padding: 9,
    textAlign: "left",
    minWidth: 0,
    boxShadow: framed ? `${active ? HOME_KEY_ACTIVE_SHADOW : HOME_KEY_RAISED_SHADOW}, ${HOME_KEY_EDGE_FRAME_SHADOW}` : unread ? HOME_KEY_RAISED_SHADOW : HOME_KEY_SHADOW,
    letterSpacing: 0,
    transform: hovered ? "translateY(-2px)" : "translateY(0)",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease",
  };
}

export function triageMessageRowStyle(active: boolean, unread: boolean, draggable: boolean, pendingAutoArchive = false, hovered = false): React.CSSProperties {
  const framed = active || hovered;
  return {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) 98px",
    gap: 9,
    alignItems: "start",
    minHeight: 82,
    border: `1px solid ${framed ? "transparent" : HOME_KEY_SOFT_BORDER}`,
    borderRadius: HOME_KEY_ELEVATED_RADIUS,
    background: pendingAutoArchive
      ? "linear-gradient(145deg, #f2f3f6 0%, #e7e9ee 100%)"
      : framed
        ? `${active ? HOME_KEY_ACTIVE_SURFACE : HOME_KEY_SURFACE} padding-box, ${HOME_KEY_EDGE_FRAME_GRADIENT} border-box`
        : HOME_KEY_SURFACE,
    cursor: draggable ? "grab" : "pointer",
    color: pendingAutoArchive ? "rgba(15, 23, 42, 0.72)" : "#111827",
    font: "inherit",
    fontSize: 12,
    padding: "10px 10px 9px",
    textAlign: "left",
    minWidth: 0,
    boxShadow: framed
      ? `${active ? HOME_KEY_ACTIVE_SHADOW : HOME_KEY_RAISED_SHADOW}, ${HOME_KEY_EDGE_FRAME_SHADOW}`
      : pendingAutoArchive
        ? "inset 0 0 0 1px rgba(148, 163, 184, 0.16)"
        : unread ? HOME_KEY_RAISED_SHADOW : HOME_KEY_SHADOW,
    letterSpacing: 0,
    transform: hovered ? "translateY(-2px)" : "translateY(0)",
    transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease, color 120ms ease",
  };
}

export function messageSelectDotStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    marginTop: 4,
    borderRadius: 9,
    background: active ? HOME_KEY_EDGE_FRAME_GRADIENT : unread ? "#38bdf8" : "rgba(100, 116, 139, 0.22)",
    boxShadow: active
      ? "0 0 0 4px rgba(92, 238, 255, 0.18), 0 0 13px rgba(183, 124, 255, 0.34), 2px 2px 5px rgba(157, 171, 191, 0.5)"
      : unread
        ? "0 0 0 4px rgba(56, 189, 248, 0.16), 0 0 12px rgba(56, 189, 248, 0.34)"
        : "inset 1px 1px 2px rgba(15, 23, 42, 0.12), inset -1px -1px 2px rgba(255, 255, 255, 0.75)",
  };
}

export function messagePlacementIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 22,
    height: 22,
    marginTop: 0,
    display: "grid",
    placeItems: "center",
    color: active ? "#38bdf8" : HOME_CYAN,
    filter: active ? "drop-shadow(0 0 5px rgba(183, 124, 255, 0.46)) drop-shadow(0 0 4px rgba(92, 238, 255, 0.38))" : undefined,
    transform: "scale(1.25)",
  };
}

export const triageMessageContentStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 3,
};

export const triageSenderStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
};

export const triageSubjectStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 700,
};

export const triageDateStyle: React.CSSProperties = {
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

export const triageMessageMetaStyle: React.CSSProperties = {
  display: "grid",
  justifyItems: "end",
  alignContent: "start",
  gap: 6,
  minWidth: 94,
};

export function messageStarButtonStyle(highlighted: boolean, hovered = false): React.CSSProperties {
  return {
    ...mailPanelSmallButtonStyle,
    width: 28,
    height: 28,
    minHeight: 28,
    padding: 0,
    display: "grid",
    placeItems: "center",
    color: highlighted ? "#facc15" : "rgba(15, 23, 42, 0.45)",
    border: `1px solid ${highlighted ? "rgba(250, 204, 21, 0.45)" : HOME_KEY_SOFT_BORDER}`,
    background: HOME_KEY_SURFACE,
    boxShadow: hovered
      ? "5px 5px 12px rgba(174, 174, 192, 0.3), -5px -5px 12px rgba(255, 255, 255, 0.94), 0 0 0 3px rgba(250, 204, 21, 0.14), inset 1px 1px 0 rgba(255, 255, 255, 0.9)"
      : "4px 4px 9px rgba(174, 174, 192, 0.24), -4px -4px 9px rgba(255, 255, 255, 0.9), inset 1px 1px 0 rgba(255, 255, 255, 0.86)",
    transform: hovered ? "translateY(-1px)" : "translateY(0)",
  };
}

export const messageArchiveButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  width: "100%",
  minHeight: 24,
  padding: "0 7px",
  fontSize: 10,
  fontWeight: 700,
};

export const messageRowTopStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "center",
  fontSize: 11,
};

export const snippetStyle: React.CSSProperties = {
  overflow: "hidden",
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 2,
  color: "rgba(15, 23, 42, 0.62)",
  fontSize: 11,
  lineHeight: 1.35,
};

export const detailStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto auto minmax(0, 1fr)",
  gap: 10,
};

export const detailSubjectStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

export const toolbarStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

export const iframeStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 0,
  height: "100%",
  border: `1px solid ${HOME_KEY_SOFT_BORDER}`,
  borderRadius: HOME_KEY_ELEVATED_RADIUS,
  background: "#ffffff",
  boxShadow: HOME_KEY_SHADOW,
};

export const composeStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gap: 8,
  alignContent: "start",
};

export const emptyStateStyle: React.CSSProperties = {
  minHeight: 120,
  display: "grid",
  placeItems: "center",
  color: "rgba(15, 23, 42, 0.56)",
  fontSize: 12,
};

export const errorStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#fff0f4",
  color: "#8b123f",
  borderBottom: "1px solid rgba(255, 61, 127, 0.28)",
  fontSize: 12,
};

export const noticeStyle: React.CSSProperties = {
  padding: "8px 14px",
  background: "#f0fdf4",
  color: "#166534",
  borderBottom: "1px solid rgba(22, 163, 74, 0.22)",
  fontSize: 12,
  fontWeight: 600,
};

export const inlineErrorStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid rgba(255, 61, 127, 0.28)",
  borderRadius: 6,
  background: "#fff0f4",
  color: "#8b123f",
  fontSize: 11,
  lineHeight: 1.35,
};

export const inlineNoticeStyle: React.CSSProperties = {
  padding: "8px 10px",
  border: "1px solid rgba(22, 163, 74, 0.22)",
  borderRadius: 6,
  background: "#f0fdf4",
  color: "#166534",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.35,
};

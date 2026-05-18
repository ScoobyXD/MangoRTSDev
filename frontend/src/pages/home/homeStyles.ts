import React from "react";
import { HOME_ROW_RESIZER_HEIGHT, INBOX_PRIORITIES } from "./homeConstants";
import { normalizeResponsibleInboxStatus, responsibleStatusColor } from "./homeUtils";

export const HOME_CYAN = "rgb(0, 233, 255)";
const HOME_CYAN_FAINT = "rgba(0, 233, 255, 0.10)";
const HOME_CYAN_SOFT = "rgba(0, 233, 255, 0.16)";
const HOME_CYAN_MEDIUM = "rgba(0, 233, 255, 0.28)";
const HOME_CYAN_BORDER = "rgba(0, 233, 255, 0.72)";
const HOME_BLACK = "#000000";
const HOME_BLACK_SOFT = "rgba(0, 0, 0, 0.18)";

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
  background: "#ffffff",
  color: "#24120a",
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
  background: HOME_BLACK,
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
  background: HOME_BLACK,
};

export const sidebarStyle: React.CSSProperties = {
  minHeight: 0,
  minWidth: 0,
  display: "grid",
  alignContent: "start",
  gap: 8,
  padding: 8,
  border: `1px solid ${HOME_BLACK}`,
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

export function sharedInboxFolderRowStyle(depth: number, active: boolean, dropPlacement: "before" | "after" | "inside" | null): React.CSSProperties {
  return {
    width: "100%",
    minHeight: 30,
    display: "grid",
    gridTemplateColumns: "18px 17px minmax(0, 1fr)",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${active ? HOME_CYAN_BORDER : dropPlacement === "inside" ? HOME_CYAN_BORDER : "transparent"}`,
    borderRadius: 6,
    background: active ? HOME_CYAN_SOFT : dropPlacement === "inside" ? HOME_CYAN_FAINT : "#ffffff",
    color: "#24120a",
    cursor: "grab",
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
  color: "rgba(36, 18, 10, 0.62)",
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
  color: "#24120a",
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
  color: "#24120a",
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
    color: "#24120a",
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
  color: "rgba(36, 18, 10, 0.54)",
  fontSize: 10,
  fontWeight: 600,
};

export const navMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "rgba(36, 18, 10, 0.54)",
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
  color: "#24120a",
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
  border: `1px solid ${HOME_BLACK}`,
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

export const mailPanelStyle: React.CSSProperties = {
  ...panelStyle,
  gridTemplateRows: "auto minmax(0, 1fr)",
};

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
    overflow: "hidden",
    background: "#ffffff",
  };
}

export const logicGateRailSectionStyle: React.CSSProperties = {
  minHeight: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 10,
  border: `1px solid ${HOME_BLACK}`,
  background: "#ffffff",
  borderRadius: 8,
  overflow: "hidden",
};

export const logicGateRailHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 8,
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
  color: "rgba(36, 18, 10, 0.76)",
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
    border: `1px solid ${selected ? HOME_CYAN_BORDER : HOME_CYAN_MEDIUM}`,
    borderRadius: 7,
    background: selected ? HOME_CYAN_SOFT : HOME_CYAN_FAINT,
    color: "#24120a",
    cursor: "grab",
    font: "inherit",
    padding: "10px 8px",
    minWidth: 0,
    boxShadow: selected ? `0 0 0 2px ${HOME_CYAN_SOFT} inset` : "none",
  };
}

export const myLogicGateTileIconStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  display: "grid",
  placeItems: "center",
  borderRadius: 6,
  background: HOME_CYAN_SOFT,
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
  color: "rgba(36, 18, 10, 0.58)",
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
    color: "#24120a",
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
  color: "#24120a",
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
  minHeight: 0,
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 8,
  padding: 10,
  border: `1px solid ${HOME_BLACK}`,
  background: "#ffffff",
  borderRadius: 8,
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
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: "nowrap",
};

export const logicGateRaciScrollStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  padding: "0 2px 4px 0",
  ["--kanban-board-scroll-accent" as string]: HOME_CYAN,
  ["--kanban-board-scroll-track" as string]: HOME_CYAN_FAINT,
};

export function inboxMatrixGridStyle(columnCount: number): React.CSSProperties {
  return {
    minWidth: columnCount >= 4 ? 920 : 760,
    display: "grid",
    gridTemplateColumns: `120px repeat(${columnCount}, minmax(190px, 1fr))`,
    gridTemplateRows: `46px repeat(${INBOX_PRIORITIES.length}, minmax(112px, auto))`,
    alignItems: "stretch",
  };
}

export const logicGateRaciCornerStyle: React.CSSProperties = {
  gridColumn: 1,
  gridRow: 1,
  borderRight: `1px solid ${HOME_BLACK}`,
  borderBottom: `1px solid ${HOME_BLACK}`,
};

export const logicGateRaciColumnHeaderStyle: React.CSSProperties = {
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  borderBottom: `1px solid ${HOME_BLACK}`,
  borderRight: `1px solid ${HOME_BLACK}`,
  background: "#ffffff",
  padding: "0 10px",
};

export const logicGateRaciColumnLetterStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  display: "grid",
  placeItems: "center",
  border: `1px solid ${HOME_CYAN_BORDER}`,
  borderRadius: 5,
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
  borderRight: `1px solid ${HOME_BLACK}`,
  borderBottom: `1px solid ${HOME_BLACK}`,
  color: "rgba(36, 18, 10, 0.66)",
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
    alignContent: "start",
    gap: 7,
    borderRight: `1px solid ${HOME_BLACK}`,
    borderBottom: `1px solid ${HOME_BLACK}`,
    background: activeDrop ? HOME_CYAN_FAINT : "#ffffff",
    boxShadow: activeDrop ? `inset 0 0 0 2px ${HOME_CYAN_MEDIUM}` : "none",
    padding: 8,
    transition: "background 120ms ease, box-shadow 120ms ease",
  };
}

export const logicGateInboxGroupStyle: React.CSSProperties = {
  position: "relative",
  minWidth: 0,
  display: "grid",
  gridTemplateRows: "30px minmax(0, auto)",
  border: `1px solid ${HOME_BLACK}`,
  borderRadius: 7,
  background: "#ffffff",
  overflow: "hidden",
  boxShadow: "0 2px 7px rgba(36, 18, 10, 0.05)",
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
  width: 42,
  height: 2,
  marginBottom: 2,
  borderRadius: 2,
  background: HOME_BLACK,
};

export function logicGateInboxGroupHeaderStyle(interactive: boolean, color?: string): React.CSSProperties {
  const tint = color ? homeColorWithAlpha(color, 0.13) : "#ffffff";
  return {
    width: "100%",
    height: 30,
    display: "grid",
    gridTemplateColumns: "18px minmax(0, 1fr) auto auto auto",
    alignItems: "center",
    gap: 6,
    border: "none",
    borderBottom: `1px solid ${HOME_BLACK}`,
    background: tint,
    color: "#24120a",
    cursor: interactive ? "pointer" : "default",
    padding: "0 8px",
    minWidth: 0,
    textAlign: "left",
    opacity: 1,
  };
}

export const logicGateInboxGroupTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
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
      return { background: "#fee2e2", border: "rgba(220, 38, 38, 0.36)", color: "#b91c1c" };
    case "accountable":
      return { background: "#fef3c7", border: "rgba(217, 119, 6, 0.38)", color: "#b45309" };
    case "consulted":
      return { background: "#dcfce7", border: "rgba(22, 163, 74, 0.34)", color: "#15803d" };
    case "informed":
      return { background: "#e0f2fe", border: "rgba(2, 132, 199, 0.32)", color: "#0369a1" };
    default:
      return { background: HOME_CYAN_FAINT, border: HOME_CYAN_MEDIUM, color: "#042028" };
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
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 10,
  fontWeight: 800,
  lineHeight: 1,
};

export const logicGateInboxNodeListStyle: React.CSSProperties = {
  maxHeight: 124,
  minHeight: 0,
  display: "grid",
  alignContent: "start",
  gap: 3,
  overflowY: "auto",
  overflowX: "hidden",
  padding: "5px 5px 6px 7px",
  background: "#ffffff",
  ["--kanban-board-scroll-accent" as string]: HOME_CYAN,
  ["--kanban-board-scroll-track" as string]: HOME_CYAN_FAINT,
};

export function logicGateInboxNodeRowStyle(selected: boolean): React.CSSProperties {
  return {
    minHeight: 28,
    minWidth: 0,
    display: "grid",
    gridTemplateColumns: "10px 16px minmax(0, 1fr) auto",
    alignItems: "center",
    gap: 5,
    border: `1px solid ${selected ? HOME_CYAN_BORDER : HOME_BLACK_SOFT}`,
    borderRadius: 5,
    background: selected ? HOME_CYAN_SOFT : "#ffffff",
    color: "#24120a",
    cursor: "grab",
    padding: "3px 4px 3px 0",
    boxShadow: selected ? `0 0 0 2px ${HOME_CYAN_FAINT} inset` : "none",
  };
}

export const logicGateInboxNodeGuideStyle: React.CSSProperties = {
  width: 10,
  height: "100%",
  borderLeft: `1px solid ${HOME_BLACK_SOFT}`,
  borderBottom: `1px solid ${HOME_BLACK_SOFT}`,
  justifySelf: "end",
};

export const logicGateInboxNodeIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
  display: "grid",
  placeItems: "center",
};

export const logicGateInboxNodeTitleStyle: React.CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 11,
  fontWeight: 700,
};

export const logicGateInboxNodeRemoveStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  display: "grid",
  placeItems: "center",
  border: "none",
  borderRadius: 4,
  background: "transparent",
  color: "rgba(36, 18, 10, 0.58)",
  cursor: "pointer",
  font: "inherit",
  fontSize: 12,
  lineHeight: 1,
  padding: 0,
};

export function logicGateInboxNodeStatusStyle(value: unknown): React.CSSProperties {
  const status = normalizeResponsibleInboxStatus(value);
  const color = status ? responsibleStatusColor(status) : "rgba(36, 18, 10, 0.48)";
  return {
    minWidth: 21,
    height: 18,
    display: "grid",
    placeItems: "center",
    border: `1px solid ${status ? color : "rgba(36, 18, 10, 0.16)"}`,
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
  color: "rgba(36, 18, 10, 0.52)",
  fontSize: 11,
};

export const messageContextMenuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 80,
  minWidth: 178,
  padding: 4,
  border: "1px solid rgba(36, 18, 10, 0.16)",
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
  background: "rgba(36, 18, 10, 0.18)",
  padding: 22,
};

export const nodeEditorPopupStyle: React.CSSProperties = {
  position: "relative",
  width: "min(1180px, calc(100vw - 44px))",
  height: "min(820px, calc(100vh - 64px))",
  minWidth: "min(420px, calc(100vw - 44px))",
  minHeight: "min(320px, calc(100vh - 64px))",
  border: "1px solid rgba(255, 136, 32, 0.54)",
  borderRadius: 16,
  background: "#ffffff",
  boxShadow: "0 18px 42px rgba(36, 18, 10, 0.22), inset 0 0 0 1px rgba(255, 255, 255, 0.72)",
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
  border: "1px solid #8b0000",
  borderRadius: 4,
  background: "#ff1f1f",
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
  border: "1px solid rgba(255, 136, 32, 0.56)",
  borderRadius: 4,
  background: "#ffffff",
  color: "#ff8820",
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
  border: "1px solid rgba(255,136,32,0.45)",
  borderRadius: 10,
  background: "#ffffff",
  color: "#24120a",
  padding: 12,
  boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
};

export const deleteModalDetailStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 11,
  lineHeight: 1.35,
};

export const contextMenuActionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 31,
  border: "none",
  borderRadius: 5,
  background: "transparent",
  color: "#24120a",
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
  border: "1px solid rgba(255, 136, 32, 0.24)",
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
  color: "rgba(36, 18, 10, 0.68)",
  fontSize: 12,
  lineHeight: 1.45,
};

export const mutedSmallStyle: React.CSSProperties = {
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  overflowWrap: "anywhere",
};

export const smallButtonStyle: React.CSSProperties = {
  minHeight: 30,
  border: "1px solid rgba(255, 136, 32, 0.32)",
  borderRadius: 6,
  background: "#fff",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  padding: "0 9px",
};

export const headerButtonStyle: React.CSSProperties = {
  ...smallButtonStyle,
  border: "1px solid rgba(255, 136, 32, 0.62)",
  background: "linear-gradient(180deg, rgba(9, 31, 38, 0.84), rgba(5, 18, 23, 0.72))",
  color: "#e8fbff",
  fontWeight: 500,
  boxShadow: "0 0 0 1px rgba(255, 136, 32, 0.12) inset, 0 8px 20px rgba(0, 0, 0, 0.18)",
};

export const primaryButtonStyle: React.CSSProperties = {
  minHeight: 34,
  border: "1px solid #ff8820",
  borderRadius: 6,
  background: "linear-gradient(90deg, rgba(251, 177, 82, 1), rgba(254, 169, 78, 1), rgba(254, 155, 70, 1), rgba(255, 136, 32, 1))",
  color: "#24120a",
  cursor: "pointer",
  font: "inherit",
  fontSize: 11,
  fontWeight: 600,
  padding: "0 10px",
};

export const dangerButtonStyle: React.CSSProperties = {
  borderColor: "#ff3d7f",
  color: "#8b123f",
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  height: 34,
  border: "1px solid rgba(255, 136, 32, 0.28)",
  borderRadius: 6,
  padding: "0 9px",
  font: "inherit",
  fontSize: 12,
};

export const textareaStyle: React.CSSProperties = {
  ...inputStyle,
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

export const mailArchiveActionsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
  gap: 6,
  alignItems: "center",
};

export function mailArchiveActionButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...smallButtonStyle,
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 700,
    borderColor: active ? HOME_CYAN : smallButtonStyle.borderColor,
    background: active ? HOME_CYAN_SOFT : smallButtonStyle.background,
    color: active ? "#042028" : smallButtonStyle.color,
  };
}

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
  color: "rgba(36, 18, 10, 0.58)",
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
  gap: 6,
};

export const loadingMoreStyle: React.CSSProperties = {
  minHeight: 28,
  display: "grid",
  placeItems: "center",
  color: "rgba(36, 18, 10, 0.56)",
  fontSize: 11,
};

export function messageRowStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    display: "grid",
    gap: 4,
    minHeight: 78,
    border: `1px solid ${active ? HOME_CYAN : unread ? HOME_CYAN_BORDER : HOME_BLACK_SOFT}`,
    borderRadius: 7,
    background: active ? HOME_CYAN_SOFT : unread ? HOME_CYAN_FAINT : "#ffffff",
    cursor: "pointer",
    color: "#24120a",
    font: "inherit",
    fontSize: 12,
    fontWeight: unread ? 700 : 500,
    padding: 9,
    textAlign: "left",
    minWidth: 0,
  };
}

export function triageMessageRowStyle(active: boolean, unread: boolean, draggable: boolean, pendingAutoArchive = false): React.CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: "20px minmax(0, 1fr) 62px",
    gap: 9,
    alignItems: "start",
    minHeight: 82,
    border: `1px solid ${pendingAutoArchive ? "rgba(36, 18, 10, 0.26)" : active ? HOME_CYAN : unread ? HOME_CYAN_MEDIUM : HOME_BLACK_SOFT}`,
    borderRadius: 7,
    background: pendingAutoArchive ? "#e7e7e7" : active ? HOME_CYAN_SOFT : unread ? HOME_CYAN_FAINT : "#ffffff",
    cursor: draggable ? "grab" : "pointer",
    color: pendingAutoArchive ? "rgba(36, 18, 10, 0.72)" : "#24120a",
    font: "inherit",
    fontSize: 12,
    padding: "10px 10px 9px",
    textAlign: "left",
    minWidth: 0,
    transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
  };
}

export function messageSelectDotStyle(active: boolean, unread: boolean): React.CSSProperties {
  return {
    width: 9,
    height: 9,
    marginTop: 4,
    borderRadius: 9,
    background: active ? HOME_CYAN : unread ? HOME_CYAN_BORDER : "rgba(36, 18, 10, 0.16)",
    boxShadow: active ? `0 0 0 3px ${HOME_CYAN_SOFT}` : undefined,
  };
}

export function messagePlacementIconStyle(active: boolean): React.CSSProperties {
  return {
    width: 18,
    height: 18,
    marginTop: 0,
    display: "grid",
    placeItems: "center",
    color: active ? "#24120a" : HOME_CYAN,
    transform: "scale(1.05)",
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
  color: "rgba(36, 18, 10, 0.62)",
  fontSize: 11,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

export const triageMessageMetaStyle: React.CSSProperties = {
  display: "grid",
  justifyItems: "end",
  alignContent: "start",
  gap: 6,
  minWidth: 58,
};

export function messageStarButtonStyle(active: boolean): React.CSSProperties {
  return {
    ...smallButtonStyle,
    width: 28,
    height: 28,
    minHeight: 28,
    padding: 0,
    display: "grid",
    placeItems: "center",
    color: active ? "#b85f00" : "rgba(36, 18, 10, 0.45)",
    background: active ? "#fff2d8" : "#ffffff",
    borderColor: active ? "rgba(255, 136, 32, 0.62)" : "rgba(36, 18, 10, 0.16)",
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
  color: "rgba(36, 18, 10, 0.62)",
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
  border: "1px solid rgba(255, 136, 32, 0.16)",
  borderRadius: 6,
  background: "#fff",
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
  color: "rgba(36, 18, 10, 0.56)",
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
  background: "#effff6",
  color: "#0f7b3f",
  borderBottom: "1px solid rgba(15, 123, 63, 0.22)",
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
  border: "1px solid rgba(15, 123, 63, 0.22)",
  borderRadius: 6,
  background: "#effff6",
  color: "#0f7b3f",
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.35,
};

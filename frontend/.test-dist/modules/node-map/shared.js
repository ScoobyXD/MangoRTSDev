// Reusable line-divider style for panel sections in node-map side UI.
export const divider = { borderBottom: "1px solid currentColor", padding: "5px 0" };
// Canonical node information type options mapped to backend enum contract.
export const INFO_TYPES = [
    "Text box",
    "Checklist",
    "Status",
    "Due date",
    "Employee name",
    "PDF",
    "PNG",
    "MOV",
    "Hyperlink",
];
// Shared geometry constants for node cards and mini-grid snapping behavior.
export const NODE_W = 148;
export const NODE_H = 96;
export const MINI_GRID = 12;
export const SESSION_NODE_MAP_STATE = new Map();
export const PANEL_MIN_WIDTH = 300;
export const PANEL_MIN_HEIGHT = 220;
// Drag handles for the node details panel move/resize feature.
export const panelResizeHandles = [
    { key: "top-left", edges: { top: true, left: true }, cursor: "nwse-resize", style: { top: -6, left: -6, width: 12, height: 12 } },
    { key: "top-right", edges: { top: true, right: true }, cursor: "nesw-resize", style: { top: -6, right: -6, width: 12, height: 12 } },
    { key: "bottom-left", edges: { bottom: true, left: true }, cursor: "nesw-resize", style: { bottom: -6, left: -6, width: 12, height: 12 } },
    { key: "bottom-right", edges: { bottom: true, right: true }, cursor: "nwse-resize", style: { bottom: -6, right: -6, width: 12, height: 12 } },
    { key: "top", edges: { top: true }, cursor: "ns-resize", style: { top: -4, left: 14, right: 14, height: 8 } },
    { key: "bottom", edges: { bottom: true }, cursor: "ns-resize", style: { bottom: -4, left: 14, right: 14, height: 8 } },
    { key: "left", edges: { left: true }, cursor: "ew-resize", style: { left: -4, top: 14, bottom: 14, width: 8 } },
    { key: "right", edges: { right: true }, cursor: "ew-resize", style: { right: -4, top: 14, bottom: 14, width: 8 } },
];
// Input sanitizer helpers used by forms and pointer math throughout node-map modules.
export function trimOrEmpty(value) {
    return value.trim();
}
export function clamp(value, minimum, maximum) {
    if (minimum > maximum)
        return minimum;
    return Math.max(minimum, Math.min(maximum, value));
}
export function snapToGrid(value) {
    return Math.round(value / MINI_GRID) * MINI_GRID;
}
// Relationship anchor helper for opposite-side calculations.
export function oppositeSide(direction) {
    if (direction === "left")
        return "right";
    if (direction === "right")
        return "left";
    if (direction === "top")
        return "bottom";
    return "top";
}
export const NODE_DOC_LINKS_KEY = "node-doc-widget-links-v1";
export const EDITOR_LINKS_KEY = NODE_DOC_LINKS_KEY;
export const EXPLORER_MAP_LINKS_KEY = "company-explorer-widget-links-v1";
export const NODE_MAP_EXPLORER_CONTEXT_KEY_PREFIX = "node-map-explorer-context-v1";
export const NODE_DOC_MIN_W = 180;
export const NODE_DOC_MIN_H = 36;
// Parser that converts persisted backend text payload into editor box geometry/content.
export function parseDocBox(info) {
    if (info.type !== "Text box")
        return null;
    try {
        const parsed = JSON.parse(info.information);
        if (typeof parsed?.x !== "number" || typeof parsed?.y !== "number" || typeof parsed?.text !== "string")
            return null;
        return {
            local_id: typeof parsed.local_id === "string" && parsed.local_id.trim() ? parsed.local_id : info.information_id,
            x: parsed.x,
            y: parsed.y,
            w: typeof parsed.w === "number" ? parsed.w : 320,
            h: typeof parsed.h === "number" ? parsed.h : 52,
            information_id: info.information_id,
            information: parsed.text,
        };
    }
    catch {
        return { local_id: info.information_id, x: 24, y: 56, w: 320, h: 52, information_id: info.information_id, information: info.information };
    }
}

import React from "react";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const ACTION_ITEM_TARGET_RING_PATH = "M12.8 7.7a5.1 5.1 0 1 1-4.5-4.5";
export const ACTION_ITEM_TARGET_INNER_PATH = "M10.3 8.5a2.55 2.55 0 1 1-2.8-2.8";
export const ACTION_ITEM_TARGET_ARROW_PATH = "M8 8 14.5 1.5M11.5 1.5h3v3";

export const ActionItemIcon: React.FC<{
  className?: string;
  size?: number;
  outerRingColor?: string;
  innerRingColor?: string;
}> = ({ className, size = 16, outerRingColor = "currentColor", innerRingColor = "currentColor" }) => (
  <svg
    aria-hidden="true"
    className={className}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    style={{ display: "block", flexShrink: 0 }}
  >
    <path d={ACTION_ITEM_TARGET_RING_PATH} stroke={outerRingColor} strokeWidth="1.5" strokeLinecap="round" />
    <path d={ACTION_ITEM_TARGET_INNER_PATH} stroke={innerRingColor} strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="8" cy="8" r="1" fill={innerRingColor} />
    <path d={ACTION_ITEM_TARGET_ARROW_PATH} stroke={innerRingColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export function createActionItemIconElement(ownerDocument: Document, size = 16): SVGSVGElement {
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.style.display = "block";
  svg.style.flexShrink = "0";

  const addPath = (d: string, lineJoin = false) => {
    const path = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", d);
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-linecap", "round");
    if (lineJoin) path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  };
  addPath(ACTION_ITEM_TARGET_RING_PATH);
  addPath(ACTION_ITEM_TARGET_INNER_PATH);
  const center = ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  center.setAttribute("cx", "8");
  center.setAttribute("cy", "8");
  center.setAttribute("r", "1");
  center.setAttribute("fill", "currentColor");
  svg.append(center);
  addPath(ACTION_ITEM_TARGET_ARROW_PATH, true);
  return svg;
}

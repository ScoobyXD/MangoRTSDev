import React from "react";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export const EntityIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-hidden="true"
    className={className}
    width="15"
    height="15"
    viewBox="0 0 16 16"
    style={{ display: "block", flexShrink: 0 }}
  >
    <rect x="2.25" y="2.25" width="11.5" height="11.5" rx="2" fill="rgba(13,148,136,.10)" stroke="#0d9488" strokeWidth="1.25" />
    <path d="M5.1 5.35h5.8M5.1 8h5.8M5.1 10.65h3.65" fill="none" stroke="#0d9488" strokeWidth="1.15" strokeLinecap="round" />
  </svg>
);

export function createEntityIconElement(ownerDocument: Document): SVGSVGElement {
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.style.display = "block";
  svg.style.flexShrink = "0";

  const body = ownerDocument.createElementNS(SVG_NAMESPACE, "rect");
  body.setAttribute("x", "2.25");
  body.setAttribute("y", "2.25");
  body.setAttribute("width", "11.5");
  body.setAttribute("height", "11.5");
  body.setAttribute("rx", "2");
  body.setAttribute("fill", "rgba(13,148,136,.10)");
  body.setAttribute("stroke", "#0d9488");
  body.setAttribute("stroke-width", "1.25");

  const lines = ownerDocument.createElementNS(SVG_NAMESPACE, "path");
  lines.setAttribute("d", "M5.1 5.35h5.8M5.1 8h5.8M5.1 10.65h3.65");
  lines.setAttribute("fill", "none");
  lines.setAttribute("stroke", "#0d9488");
  lines.setAttribute("stroke-width", "1.15");
  lines.setAttribute("stroke-linecap", "round");

  svg.append(body, lines);
  return svg;
}

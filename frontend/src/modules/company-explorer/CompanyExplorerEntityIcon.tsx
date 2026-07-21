import React from "react";

export type ExplorerEntityIconKind = "node" | "logic_gate" | "project";
export type ExplorerEntityIconTone = "default" | "inverse" | "orange";

type SVGSpec = {
  tag: string;
  attrs: Record<string, string | number>;
  children?: SVGSpec[];
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SVG_DOM_ATTRIBUTE_NAMES: Readonly<Record<string, string>> = {
  gradientUnits: "gradientUnits",
  stopColor: "stop-color",
  stopOpacity: "stop-opacity",
  strokeLinecap: "stroke-linecap",
  strokeLinejoin: "stroke-linejoin",
  strokeOpacity: "stroke-opacity",
  strokeWidth: "stroke-width",
};

const NODE_BODY_PATH = "M3.7 1.7h5.45l3.15 3.15v9.45H3.7z";
const NODE_DETAIL_PATH = "M9.15 1.7v3.15h3.15M5.55 7.25h4.9M5.55 9.55h4.9M5.55 11.85h3.25";
const PROJECT_BODY_PATH = "M2.3 3.1h11.4v9.8H2.3z";
const PROJECT_DETAIL_PATH = "M4.1 5.25h3.2M4.1 7.85h5.7M4.1 10.45h3.9";
const PROJECT_CHECKS_PATH = "M11.25 5.15h1.3v1.3h-1.3zM11.25 7.45h1.3v1.3h-1.3zM11.25 9.75h1.3v1.3h-1.3z";
const LOGIC_GATE_CONNECTION_PATH = "M1.4 5.25h3.05M1.4 10.75h3.05M11.7 8h2.9";
const LOGIC_GATE_BODY_PATH = "M4.35 3.55h3.35c2.45 0 4.45 1.95 4.45 4.45s-2 4.45-4.45 4.45H4.35z";

function iconSpecs(kind: ExplorerEntityIconKind, tone: ExplorerEntityIconTone, id: string): SVGSpec[] {
  if (kind === "node") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : `url(#${id})`;
    return [
      ...(tone === "default" ? [{
        tag: "defs",
        attrs: {},
        children: [{
          tag: "linearGradient",
          attrs: { id, x1: "8", y1: "1.7", x2: "8", y2: "14.3", gradientUnits: "userSpaceOnUse" },
          children: [
            { tag: "stop", attrs: { stopColor: "#33ddd5" } },
            { tag: "stop", attrs: { offset: "1", stopColor: "#19a8ff" } },
          ],
        }],
      } satisfies SVGSpec] : []),
      { tag: "path", attrs: { d: NODE_BODY_PATH, fill: "none", stroke, strokeWidth: "1.35", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: NODE_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } },
    ];
  }
  if (kind === "project") {
    const stroke = tone === "inverse" ? "#ffffff" : tone === "orange" ? "#ff9708" : "#2563eb";
    const fill = tone === "inverse" ? "rgba(255,255,255,0.10)" : tone === "orange" ? "rgba(255,151,8,0.10)" : "rgba(37,99,235,0.10)";
    return [
      { tag: "path", attrs: { d: PROJECT_BODY_PATH, fill, stroke, strokeWidth: "1.25", strokeLinejoin: "round" } },
      { tag: "path", attrs: { d: PROJECT_DETAIL_PATH, fill: "none", stroke, strokeWidth: "1.05", strokeLinecap: "round" } },
      { tag: "path", attrs: { d: PROJECT_CHECKS_PATH, fill: stroke } },
    ];
  }
  return [{
    tag: "defs",
    attrs: {},
    children: [{
      tag: "linearGradient",
      attrs: { id, x1: "1.4", y1: "3.55", x2: "14.6", y2: "12.45", gradientUnits: "userSpaceOnUse" },
      children: [
        { tag: "stop", attrs: { stopColor: "#7cff9b" } },
        { tag: "stop", attrs: { offset: "0.58", stopColor: "#19f07a" } },
        { tag: "stop", attrs: { offset: "1", stopColor: "#00c86f" } },
      ],
    }],
  }, {
    tag: "path",
    attrs: { d: LOGIC_GATE_CONNECTION_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.25", strokeLinecap: "round" },
  }, {
    tag: "path",
    attrs: { d: LOGIC_GATE_BODY_PATH, fill: "none", stroke: `url(#${id})`, strokeWidth: "1.35", strokeLinejoin: "round" },
  },
  { tag: "circle", attrs: { cx: "4.35", cy: "5.25", r: "0.85", fill: "#19f07a" } },
  { tag: "circle", attrs: { cx: "4.35", cy: "10.75", r: "0.85", fill: "#19f07a" } },
  { tag: "circle", attrs: { cx: "12.15", cy: "8", r: "0.85", fill: "#19f07a" } }];
}

function renderReactSpec(spec: SVGSpec, key: string): React.ReactElement {
  return React.createElement(
    spec.tag,
    { ...spec.attrs, key },
    spec.children?.map((child, index) => renderReactSpec(child, `${key}-${index}`)),
  );
}

function appendDOMSpec(ownerDocument: Document, parent: SVGElement, spec: SVGSpec): void {
  const element = ownerDocument.createElementNS(SVG_NAMESPACE, spec.tag);
  Object.entries(spec.attrs).forEach(([name, value]) => {
    element.setAttribute(SVG_DOM_ATTRIBUTE_NAMES[name] ?? name, String(value));
  });
  spec.children?.forEach((child) => appendDOMSpec(ownerDocument, element, child));
  parent.appendChild(element);
}

export const ExplorerEntityIcon: React.FC<{
  kind: ExplorerEntityIconKind;
  tone?: ExplorerEntityIconTone;
  className?: string;
}> = ({ kind, tone = "default", className }) => {
  const id = `mango-${kind}-icon-${React.useId().replace(/:/g, "")}`;
  return (
    <svg aria-hidden="true" className={className} width="15" height="15" viewBox="0 0 16 16" style={{ display: "block", flexShrink: 0 }}>
      {iconSpecs(kind, tone, id).map((spec, index) => renderReactSpec(spec, `${kind}-${index}`))}
    </svg>
  );
};

let explorerEntityDOMIconSequence = 0;

export function createExplorerEntityIconElement(
  ownerDocument: Document,
  kind: ExplorerEntityIconKind,
  tone: ExplorerEntityIconTone = "default",
): SVGSVGElement {
  explorerEntityDOMIconSequence += 1;
  const id = `mango-${kind}-dom-icon-${explorerEntityDOMIconSequence}`;
  const svg = ownerDocument.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.style.display = "block";
  svg.style.flexShrink = "0";
  iconSpecs(kind, tone, id).forEach((spec) => appendDOMSpec(ownerDocument, svg, spec));
  return svg;
}

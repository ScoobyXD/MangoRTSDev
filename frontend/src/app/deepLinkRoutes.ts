import { GVIC_INBOX_SECTIONS } from "../pages/home/homeConstants.js";
import type { RaciInboxRole, RaciInboxViewID } from "../pages/home/homeTypes.js";

export type LogicGateDeepLinkRoute = {
  kind: "logic_gate";
  logicGateID: string;
  nodeID?: string;
};

export type NodeDeepLinkRoute = {
  kind: "node";
  nodeID: string;
};

export type ProjectDeepLinkRoute = {
  kind: "project";
  projectID: string;
};

export type GvicDeepLinkRoute = {
  kind: "gvic";
  role: RaciInboxRole;
  viewID: RaciInboxViewID;
  nodeID?: string;
};

export type DeepLinkRoute = LogicGateDeepLinkRoute | NodeDeepLinkRoute | ProjectDeepLinkRoute | GvicDeepLinkRoute;

function cleanSegment(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return "";
  }
}

function encodeSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

export function normalizeAppPath(pathname: string): string {
  const withoutQuery = pathname.split(/[?#]/, 1)[0]?.trim() || "/";
  if (withoutQuery.length > 1) return withoutQuery.replace(/\/+$/, "");
  return "/";
}

export function gvicSectionForRoleOrView(value: string): (typeof GVIC_INBOX_SECTIONS)[number] | null {
  const token = value.trim().toLowerCase();
  if (!token) return null;
  return GVIC_INBOX_SECTIONS.find((section) => section.role === token || section.viewID === token) ?? null;
}

export function gvicRoleForViewID(viewID: string): RaciInboxRole | null {
  return GVIC_INBOX_SECTIONS.find((section) => section.viewID === viewID)?.role ?? null;
}

export function gvicViewIDForRole(role: string): RaciInboxViewID | null {
  return GVIC_INBOX_SECTIONS.find((section) => section.role === role)?.viewID ?? null;
}

export function parseDeepLinkRoute(pathname: string): DeepLinkRoute | null {
  const segments = normalizeAppPath(pathname).split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "logic-gates") {
    const logicGateID = cleanSegment(segments[1]);
    return logicGateID ? { kind: "logic_gate", logicGateID } : null;
  }
  if (segments.length === 4 && segments[0] === "logic-gates" && segments[2] === "nodes") {
    const logicGateID = cleanSegment(segments[1]);
    const nodeID = cleanSegment(segments[3]);
    return logicGateID && nodeID ? { kind: "logic_gate", logicGateID, nodeID } : null;
  }
  if (segments.length === 2 && segments[0] === "nodes") {
    const nodeID = cleanSegment(segments[1]);
    return nodeID ? { kind: "node", nodeID } : null;
  }
  if (segments.length === 2 && segments[0] === "projects") {
    const projectID = cleanSegment(segments[1]);
    return projectID ? { kind: "project", projectID } : null;
  }
  if ((segments.length === 2 || segments.length === 4) && segments[0] === "gvic") {
    if (segments.length === 4 && segments[2] !== "nodes") return null;
    const section = gvicSectionForRoleOrView(cleanSegment(segments[1]));
    if (!section) return null;
    const nodeID = segments.length === 4 ? cleanSegment(segments[3]) : "";
    if (segments.length === 4 && !nodeID) return null;
    return {
      kind: "gvic",
      role: section.role,
      viewID: section.viewID,
      nodeID: nodeID || undefined,
    };
  }
  return null;
}

export function buildLogicGateRoute(logicGateID: string, nodeID?: string): string {
  const cleanLogicGateID = encodeSegment(logicGateID);
  const cleanNodeID = nodeID?.trim() ? encodeSegment(nodeID) : "";
  return cleanNodeID ? `/logic-gates/${cleanLogicGateID}/nodes/${cleanNodeID}` : `/logic-gates/${cleanLogicGateID}`;
}

export function buildNodeRoute(nodeID: string): string {
  return `/nodes/${encodeSegment(nodeID)}`;
}

export function buildProjectRoute(projectID: string): string {
  return `/projects/${encodeSegment(projectID)}`;
}

export function buildGvicRoute(role: RaciInboxRole, nodeID?: string): string {
  const cleanRole = encodeSegment(role);
  const cleanNodeID = nodeID?.trim() ? encodeSegment(nodeID) : "";
  return cleanNodeID ? `/gvic/${cleanRole}/nodes/${cleanNodeID}` : `/gvic/${cleanRole}`;
}

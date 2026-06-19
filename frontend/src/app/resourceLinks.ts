import { buildGvicRoute, buildLogicGateRoute, buildNodeRoute, normalizeAppPath, parseDeepLinkRoute } from "./deepLinkRoutes.js";

export function buildAbsoluteAppURL(origin: string, appPath: string): string {
  return new URL(normalizeAppPath(appPath), origin).toString();
}

export function openAppPathInNewTab(appPath: string): void {
  if (typeof window === "undefined") return;
  window.open(buildAbsoluteAppURL(window.location.origin, appPath), "_blank", "noopener,noreferrer");
}

export function buildContextualNodeRoute(nodeID: string, currentPath?: string): string {
  const route = parseDeepLinkRoute(currentPath ?? (typeof window === "undefined" ? "" : window.location.pathname));
  if (route?.kind === "logic_gate") return buildLogicGateRoute(route.logicGateID, nodeID);
  if (route?.kind === "gvic") return buildGvicRoute(route.role, nodeID);
  return buildNodeRoute(nodeID);
}

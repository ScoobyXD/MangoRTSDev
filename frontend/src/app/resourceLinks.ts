import { normalizeAppPath } from "./deepLinkRoutes.js";

export function buildAbsoluteAppURL(origin: string, appPath: string): string {
  return new URL(normalizeAppPath(appPath), origin).toString();
}

export function openAppPathInNewTab(appPath: string): void {
  if (typeof window === "undefined") return;
  window.open(buildAbsoluteAppURL(window.location.origin, appPath), "_blank", "noopener,noreferrer");
}

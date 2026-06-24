import { humanLabelOrFallback } from "../modules/entityLabels.js";
export type SidebarPinKind = "node" | "logic_gate" | "project";

export type SidebarPin = {
  pinID: string;
  id: string;
  kind: SidebarPinKind;
  name: string;
  position: number;
  createdTimestamp: string;
};

export type SidebarPinDraft = {
  id: string;
  kind: SidebarPinKind;
  name?: string;
};

export type SidebarPinRequestDetail = {
  id: string;
  kind: SidebarPinKind;
  name?: string;
};

export const EVENT_APP_SIDEBAR_PIN_REQUESTED = "mangorts:app-sidebar-pin-requested";

export function sidebarPinFallbackName(kind: SidebarPinKind, id: string): string {
  if (kind === "logic_gate") return "Logic Gate";
  if (kind === "project") return "Project";
  return `Node ${id.trim().slice(0, 8) || "pin"}`;
}

export function requestAppSidebarPin(detail: SidebarPinRequestDetail): void {
  const id = detail.id.trim();
  if (!id) return;
  const rawName = detail.name;
  window.dispatchEvent(new CustomEvent<SidebarPinRequestDetail>(EVENT_APP_SIDEBAR_PIN_REQUESTED, {
    detail: {
      id,
      kind: detail.kind,
      name: detail.kind === "logic_gate" ? humanLabelOrFallback(rawName, sidebarPinFallbackName(detail.kind, id)) : (rawName?.trim() || sidebarPinFallbackName(detail.kind, id)),
    },
  }));
}

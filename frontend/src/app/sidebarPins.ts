import { humanLabelOrFallback } from "../modules/entityLabels.js";
export type SidebarPinKind = "node" | "logic_gate";

export type SidebarPin = {
  id: string;
  kind: SidebarPinKind;
  label: string;
  addedAt: number;
};

export type SidebarPinRequestDetail = {
  id: string;
  kind: SidebarPinKind;
  label?: string;
};

export const EVENT_APP_SIDEBAR_PIN_REQUESTED = "mangorts:app-sidebar-pin-requested";

export function sidebarPinFallbackLabel(kind: SidebarPinKind, id: string): string {
  if (kind === "logic_gate") return "Logic Gate";
  return `Node ${id.trim().slice(0, 8) || "pin"}`;
}

export function requestAppSidebarPin(detail: SidebarPinRequestDetail): void {
  const id = detail.id.trim();
  if (!id) return;
  window.dispatchEvent(new CustomEvent<SidebarPinRequestDetail>(EVENT_APP_SIDEBAR_PIN_REQUESTED, {
    detail: {
      id,
      kind: detail.kind,
      label: detail.kind === "logic_gate" ? humanLabelOrFallback(detail.label, sidebarPinFallbackLabel(detail.kind, id)) : (detail.label?.trim() || sidebarPinFallbackLabel(detail.kind, id)),
    },
  }));
}

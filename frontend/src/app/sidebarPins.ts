import { humanLabelOrFallback } from "../modules/entityLabels.js";
import type { ExplorerDropPayload } from "../modules/company-explorer/treePresentation.js";
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

export function sidebarPinExplorerDropPayload(pin: Pick<SidebarPin, "id" | "kind">): ExplorerDropPayload | null {
  const id = pin.id.trim();
  if (!id) return null;
  if (pin.kind === "node") return { kind: "node", itemID: id, itemType: "node" };
  if (pin.kind === "logic_gate") return { kind: "logic_gate", itemID: id, itemType: "logic_gate" };
  return null;
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

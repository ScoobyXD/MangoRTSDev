import type { SidebarPin } from "./sidebarPins.js";

export type SidebarPinNodePopupLaunch = {
  nodeID: string;
  nodeTitle: string;
  initialFullscreen: false;
  popupInstanceID: number;
};

export function sidebarPinNodePopupLaunch(pin: SidebarPin, popupInstanceID = Date.now()): SidebarPinNodePopupLaunch | null {
  if (pin.kind !== "node" || !pin.id.trim()) return null;
  return {
    nodeID: pin.id.trim(),
    nodeTitle: pin.name,
    initialFullscreen: false,
    popupInstanceID,
  };
}

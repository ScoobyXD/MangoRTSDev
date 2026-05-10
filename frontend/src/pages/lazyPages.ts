import React from "react";

let logicGateArenaPagePromise: Promise<typeof import("./logic-gate-arena")> | null = null;
let communicationsPagePromise: Promise<typeof import("./communications/CommunicationsPage")> | null = null;

function loadLogicGateArenaPage() {
  logicGateArenaPagePromise ??= import("./logic-gate-arena");
  return logicGateArenaPagePromise;
}

function loadCommunicationsPage() {
  communicationsPagePromise ??= import("./communications/CommunicationsPage");
  return communicationsPagePromise;
}

export function preloadLogicGateArenaPage(): void {
  void loadLogicGateArenaPage();
}

export function preloadCommunicationsPage(): void {
  void loadCommunicationsPage();
}

export const LazyLogicGateArenaPage = React.lazy(() => loadLogicGateArenaPage().then((module) => ({ default: module.LogicGateArenaPage })));
export const LazyCommunicationsPage = React.lazy(() => loadCommunicationsPage().then((module) => ({ default: module.CommunicationsPage })));
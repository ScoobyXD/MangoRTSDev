import React from "react";

let logicGateArenaPagePromise: Promise<typeof import("./logic-gate-arena")> | null = null;
let homePagePromise: Promise<typeof import("./home/HomePage")> | null = null;

function loadLogicGateArenaPage() {
  logicGateArenaPagePromise ??= import("./logic-gate-arena");
  return logicGateArenaPagePromise;
}

function loadHomePage() {
  homePagePromise ??= import("./home/HomePage");
  return homePagePromise;
}

export function preloadLogicGateArenaPage(): void {
  void loadLogicGateArenaPage();
}

export function preloadHomePage(): void {
  void loadHomePage();
}

export const LazyLogicGateArenaPage = React.lazy(() => loadLogicGateArenaPage().then((module) => ({ default: module.LogicGateArenaPage })));
export const LazyHomePage = React.lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));

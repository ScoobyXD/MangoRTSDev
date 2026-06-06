import React from "react";

let logicGateArenaPagePromise: Promise<typeof import("./logic-gate-arena")> | null = null;
let homePagePromise: Promise<typeof import("./home/HomePage")> | null = null;
let projectManagementPagePromise: Promise<typeof import("./project-management")> | null = null;

function loadLogicGateArenaPage() {
  logicGateArenaPagePromise ??= import("./logic-gate-arena");
  return logicGateArenaPagePromise;
}

function loadHomePage() {
  homePagePromise ??= import("./home/HomePage");
  return homePagePromise;
}

function loadProjectManagementPage() {
  projectManagementPagePromise ??= import("./project-management");
  return projectManagementPagePromise;
}

export function preloadLogicGateArenaPage(): void {
  void loadLogicGateArenaPage();
}

export function preloadHomePage(): void {
  void loadHomePage();
}

export function preloadProjectManagementPage(): void {
  void loadProjectManagementPage();
}

export const LazyLogicGateArenaPage = React.lazy(() => loadLogicGateArenaPage().then((module) => ({ default: module.LogicGateArenaPage })));
export const LazyHomePage = React.lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));
export const LazyProjectManagementPage = React.lazy(() => loadProjectManagementPage().then((module) => ({ default: module.ProjectManagementPage })));

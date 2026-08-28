import React from "react";

let logicGateArenaPagePromise: Promise<typeof import("./logic-gate-arena")> | null = null;
let homePagePromise: Promise<typeof import("./home/HomePage")> | null = null;
let projectManagementPagePromise: Promise<typeof import("./project-management")> | null = null;
let accountManagerPagePromise: Promise<typeof import("./account-manager")> | null = null;
let teamsPagePromise: Promise<typeof import("./teams")> | null = null;
let entitiesPagePromise: Promise<typeof import("./entities")> | null = null;
let processMapPagePromise: Promise<typeof import("./process-map/ProcessMapPage")> | null = null;

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

function loadAccountManagerPage() {
  accountManagerPagePromise ??= import("./account-manager");
  return accountManagerPagePromise;
}

function loadTeamsPage() {
  teamsPagePromise ??= import("./teams");
  return teamsPagePromise;
}

function loadEntitiesPage() {
  entitiesPagePromise ??= import("./entities");
  return entitiesPagePromise;
}

function loadProcessMapPage() {
  processMapPagePromise ??= import("./process-map/ProcessMapPage");
  return processMapPagePromise;
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

export function preloadAccountManagerPage(): void {
  void loadAccountManagerPage();
}

export function preloadTeamsPage(): void {
  void loadTeamsPage();
}

export const LazyLogicGateArenaPage = React.lazy(() => loadLogicGateArenaPage().then((module) => ({ default: module.LogicGateArenaPage })));
export const LazyHomePage = React.lazy(() => loadHomePage().then((module) => ({ default: module.HomePage })));

export function preloadEntitiesPage(): void {
  void loadEntitiesPage();
}
export function preloadProcessMapPage(): void {
  void loadProcessMapPage();
}
export const LazyProjectManagementPage = React.lazy(() => loadProjectManagementPage().then((module) => ({ default: module.ProjectManagementPage })));
export const LazyAccountManagerPage = React.lazy(() => loadAccountManagerPage().then((module) => ({ default: module.AccountManagerPage })));
export const LazyTeamsPage = React.lazy(() => loadTeamsPage().then((module) => ({ default: module.TeamsPage })));
export const LazyEntitiesPage = React.lazy(() => loadEntitiesPage().then((module) => ({ default: module.EntitiesPage })));
export const LazyProcessMapPage = React.lazy(() => loadProcessMapPage().then((module) => ({ default: module.ProcessMapPage })));

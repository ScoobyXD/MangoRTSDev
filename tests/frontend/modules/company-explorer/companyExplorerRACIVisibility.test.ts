import assert from "node:assert/strict";
import {
  shouldIncludeRACICustomRootFolder,
  shouldShowRACICompanyScopedFolderShell,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerRACIVisibility.js";

function run(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run("includes company-scoped custom roots before lazy child items are loaded", () => {
  assert.equal(shouldIncludeRACICustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
});

run("keeps user-scoped custom roots tied to the matching user", () => {
  assert.equal(shouldIncludeRACICustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-a",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeRACICustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-b",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("uses loaded owner ids when custom root child items are available", () => {
  assert.equal(shouldIncludeRACICustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-a"],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeRACICustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-b"],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("shows company-scoped RACI child folder shells before their branches are loaded", () => {
  assert.equal(shouldShowRACICompanyScopedFolderShell("company"), true);
  assert.equal(shouldShowRACICompanyScopedFolderShell(undefined), true);
  assert.equal(shouldShowRACICompanyScopedFolderShell("user"), false);
  assert.equal(shouldShowRACICompanyScopedFolderShell("team"), false);
});

import assert from "node:assert/strict";
import {
  shouldIncludeRaciCustomRootFolder,
  shouldShowRaciCompanyScopedFolderShell,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerRaciVisibility.js";

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
  assert.equal(shouldIncludeRaciCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
});

run("keeps user-scoped custom roots tied to the matching user", () => {
  assert.equal(shouldIncludeRaciCustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-a",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeRaciCustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-b",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("uses loaded owner ids when custom root child items are available", () => {
  assert.equal(shouldIncludeRaciCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-a"],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeRaciCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-b"],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("shows company-scoped RACI child folder shells before their branches are loaded", () => {
  assert.equal(shouldShowRaciCompanyScopedFolderShell("company"), true);
  assert.equal(shouldShowRaciCompanyScopedFolderShell(undefined), true);
  assert.equal(shouldShowRaciCompanyScopedFolderShell("user"), false);
  assert.equal(shouldShowRaciCompanyScopedFolderShell("team"), false);
});

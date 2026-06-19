import assert from "node:assert/strict";
import {
  shouldIncludeGVICCustomRootFolder,
  shouldShowGVICCompanyScopedFolderShell,
} from "../../../../frontend/src/modules/company-explorer/companyExplorerGVICVisibility.js";

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
  assert.equal(shouldIncludeGVICCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
});

run("keeps user-scoped custom roots tied to the matching user", () => {
  assert.equal(shouldIncludeGVICCustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-a",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeGVICCustomRootFolder({
    rootScopeType: "user",
    rootScopeID: "user-b",
    ownerUserIDs: [],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("uses loaded owner ids when custom root child items are available", () => {
  assert.equal(shouldIncludeGVICCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-a"],
    requestedOwnerUserIDs: ["user-a"],
  }), true);
  assert.equal(shouldIncludeGVICCustomRootFolder({
    rootScopeType: "company",
    rootScopeID: null,
    ownerUserIDs: ["user-b"],
    requestedOwnerUserIDs: ["user-a"],
  }), false);
});

run("shows company-scoped GVIC child folder shells before their branches are loaded", () => {
  assert.equal(shouldShowGVICCompanyScopedFolderShell("company"), true);
  assert.equal(shouldShowGVICCompanyScopedFolderShell(undefined), true);
  assert.equal(shouldShowGVICCompanyScopedFolderShell("user"), false);
  assert.equal(shouldShowGVICCompanyScopedFolderShell("team"), false);
});

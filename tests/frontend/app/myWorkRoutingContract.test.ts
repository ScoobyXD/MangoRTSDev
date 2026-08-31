import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sidebar orders Pinned, Huddle Boards, Tower, and Organization while Tower omits RACI trees", () => {
  const source = readFileSync("frontend/src/app/AppSidebarChrome.tsx", "utf8");
  const pinnedStart = source.indexOf("<AppSidebarPinnedSection");
  const huddleBoardsStart = source.indexOf("<HuddleExplorerSection", pinnedStart);
  const towerStart = source.indexOf('aria-label="Tower"');
  const organizationStart = source.indexOf('aria-label="Organization"');
  const hiddenSectionStart = source.indexOf("{!explorerSearchActive && (");
  const hiddenSectionEnd = source.indexOf("</>", towerStart);
  assert.ok(pinnedStart >= 0 && huddleBoardsStart > pinnedStart && towerStart > huddleBoardsStart && organizationStart > towerStart);
  assert.ok(hiddenSectionStart >= 0 && hiddenSectionEnd > hiddenSectionStart);
  assert.ok(pinnedStart > hiddenSectionStart && towerStart < hiddenSectionEnd, "Pinned, Huddle Boards, and Tower stay hidden while Explorer search is active");
  const towerEnd = source.indexOf("</section>", towerStart);
  assert.ok(towerStart >= 0 && towerEnd > towerStart);
  const tower = source.slice(towerStart, towerEnd);
  const myWork = tower.indexOf('label="My Work"');
  const projects = tower.indexOf('label="Projects"');
  const processMap = tower.indexOf('label="Process Map"');
  assert.ok(myWork >= 0);
  assert.ok(projects > myWork);
  assert.ok(processMap > projects);
  assert.doesNotMatch(source, /AppSidebarRACITabsSection|raci-tabs:company/);
  assert.match(tower, /<AppSidebarButton\s+label="My Work"[\s\S]*?icon=\{<HeaderMyWorkIcon color="#2563eb" \/>\}[\s\S]*?elevated[\s\S]*?onClick=\{\(\) => onPageSelect\("my-work"\)\}/);
  assert.match(tower, /<AppSidebarElevatedActionButton\s+label="Projects"[\s\S]*?icon=\{<HeaderProjectManagementIcon color="#3b82f6" \/>\}[\s\S]*?actionLabel="Edit Projects view"[\s\S]*?onAction=\{requestProjectViewSettings\}/);
  assert.doesNotMatch(tower, /HomeBuiltInViewSidebarRow/);
  assert.match(source, /function AppSidebarButton[\s\S]*?aria-current=\{active \? "page" : undefined\}/);
  assert.match(source, /function AppSidebarElevatedActionButton[\s\S]*?<button[\s\S]*?onClick=\{onSelect\}[\s\S]*?<\/button>[\s\S]*?<button[\s\S]*?aria-label=\{actionLabel\}/);
});

test("My Work is a lazy authenticated static page with persisted page identity", () => {
  const auth = readFileSync("frontend/src/auth/AuthGate.tsx", "utf8");
  const app = readFileSync("frontend/src/app/applayout.tsx", "utf8");
  const lazyPages = readFileSync("frontend/src/pages/lazyPages.ts", "utf8");
  const persistence = readFileSync("frontend/src/app/useFramePersistence.ts", "utf8");
  assert.match(auth, /path === "\/my-work"[\s\S]*preloadMyWorkSurface/);
  assert.match(auth, /normalizedPath === "\/my-work"[\s\S]*initialPage="my-work"/);
  const connectGoogleStart = auth.indexOf("function ConnectGooglePage");
  const settingsStart = auth.indexOf("function SettingsPage", connectGoogleStart);
  assert.ok(connectGoogleStart >= 0 && settingsStart > connectGoogleStart);
  const connectGoogle = auth.slice(connectGoogleStart, settingsStart);
  assert.equal(connectGoogle.match(/onNavigate\("\/my-work"\)/g)?.length, 2, "connected and skipped Google onboarding both continue to My Work");
  assert.doesNotMatch(connectGoogle, /onNavigate\("\/home"\)/);
  assert.match(lazyPages, /import\("\.\/my-work"\)/);
  assert.match(lazyPages, /LazyMyWorkPage/);
  assert.match(app, /if \(page === "my-work"\) return "\/my-work"/);
  const myWorkPageStart = app.indexOf("<LazyMyWorkPage");
  const myWorkPageEnd = app.indexOf("/>", myWorkPageStart);
  assert.ok(myWorkPageStart >= 0 && myWorkPageEnd > myWorkPageStart);
  const myWorkPage = app.slice(myWorkPageStart, myWorkPageEnd);
  assert.match(myWorkPage, /key=\{`\$\{activeCompanyID\}:\$\{myWorkSubjectID\}`\}/);
  assert.match(myWorkPage, /companyID=\{activeCompanyID\}/);
  assert.match(myWorkPage, /subjectID=\{myWorkSubjectID\}/);
  assert.match(myWorkPage, /requestJSON=\{appRequestJSON\}/);
  assert.match(persistence, /id: "view-my-work", name: "My Work", page: "my-work", frames: \[\]/);
});

test("Auth loading and login states exclude the authenticated My Work shell", () => {
  const auth = readFileSync("frontend/src/auth/AuthGate.tsx", "utf8");
  const loadingBranch = auth.indexOf("if (loading) return");
  const loginBranch = auth.indexOf("if (!me || isAuthPath(normalizedPath))");
  const myWorkBranch = auth.indexOf('if (normalizedPath === "/my-work")');
  assert.ok(loadingBranch >= 0 && loginBranch > loadingBranch && myWorkBranch > loginBranch);
  assert.doesNotMatch(auth.slice(loadingBranch, loginBranch), /LazyAppLayout/);
  assert.doesNotMatch(auth.slice(loginBranch, myWorkBranch), /initialPage="my-work"/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { isAuthPath, nextPathAfterAuthentication, nextPathForAuthState } from "../../../frontend/src/auth/authRoutes.js";

test("auth route guard sends unauthenticated app routes to login", () => {
  assert.equal(nextPathForAuthState("/", false), "/login");
  assert.equal(nextPathForAuthState("/admin/users", false), "/login");
  assert.equal(nextPathForAuthState("/settings", false), "/login");
  assert.equal(nextPathForAuthState("/communications", false), "/login");
  assert.equal(nextPathForAuthState("/accept-invite", false), "/accept-invite");
});

test("auth route guard sends authenticated login routes back to app", () => {
  assert.equal(nextPathForAuthState("/login", true), "/home");
  assert.equal(nextPathForAuthState("/admin/users", true), "/settings");
  assert.equal(nextPathForAuthState("/settings", true), "/settings");
  assert.equal(nextPathForAuthState("/communications", true), "/home");
});

test("signup is not an auth route", () => {
  assert.equal(isAuthPath("/signup"), false);
  assert.equal(nextPathForAuthState("/signup", false), "/login");
  assert.equal(nextPathForAuthState("/signup", true), "/signup");
});

test("auth path detection normalizes trailing slash", () => {
  assert.equal(isAuthPath("/forgot-password/"), true);
  assert.equal(isAuthPath("/forgot-password/?from=node"), true);
  assert.equal(isAuthPath("/workspace"), false);
});

test("auth route guard returns to a requested resource after authentication", () => {
  assert.equal(nextPathAfterAuthentication("/login", "/nodes/node-1"), "/nodes/node-1");
  assert.equal(nextPathAfterAuthentication("/complete-account", "/projects/project-1?ignored=true"), "/projects/project-1");
  assert.equal(nextPathAfterAuthentication("/login", "/logic-gates/lg-1/nodes/node-1"), "/logic-gates/lg-1/nodes/node-1");
});

test("auth route guard ignores auth pages as return targets", () => {
  assert.equal(nextPathAfterAuthentication("/login"), "/home");
  assert.equal(nextPathAfterAuthentication("/login", ""), "/home");
  assert.equal(nextPathAfterAuthentication("/login", "/login"), "/home");
  assert.equal(nextPathAfterAuthentication("/complete-account", "/forgot-password"), "/home");
});


import test from "node:test";
import assert from "node:assert/strict";
import { isAuthPath, nextPathForAuthState } from "../../../frontend/src/auth/authRoutes.js";

test("auth route guard sends unauthenticated app routes to login", () => {
  assert.equal(nextPathForAuthState("/", false), "/login");
  assert.equal(nextPathForAuthState("/admin/users", false), "/login");
  assert.equal(nextPathForAuthState("/accept-invite", false), "/accept-invite");
});

test("auth route guard sends authenticated login routes back to app", () => {
  assert.equal(nextPathForAuthState("/login", true), "/");
  assert.equal(nextPathForAuthState("/signup", true), "/");
  assert.equal(nextPathForAuthState("/admin/users", true), "/admin/users");
});

test("auth path detection normalizes trailing slash", () => {
  assert.equal(isAuthPath("/forgot-password/"), true);
  assert.equal(isAuthPath("/workspace"), false);
});


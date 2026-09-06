import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import type { Root } from "react-dom/client";

test("password signup and invitation browser flow", async (t) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/login", pretendToBeVisual: true });
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (key: string, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  for (const key of ["window", "document", "navigator", "localStorage", "sessionStorage", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "MutationObserver"]) {
    install(key, key === "window" ? dom.window : (dom.window as unknown as Record<string, unknown>)[key]);
  }
  install("IS_REACT_ACT_ENVIRONMENT", true);
  install("getComputedStyle", dom.window.getComputedStyle.bind(dom.window));
  install("requestAnimationFrame", dom.window.requestAnimationFrame.bind(dom.window));
  install("cancelAnimationFrame", dom.window.cancelAnimationFrame.bind(dom.window));
  Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  const response = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  const requests: { path: string; action: string; body: Record<string, any>; authorization: string | null }[] = [];
  let handle: (request: typeof requests[number]) => Response | Promise<Response> = () => response({});
  dom.window.fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    const request = {
      path: new URL(String(input)).pathname,
      action: headers.get("X-Amz-Target")?.split(".").pop() ?? "",
      body: init?.body ? JSON.parse(String(init.body)) : {},
      authorization: headers.get("Authorization"),
    };
    requests.push(request);
    return handle(request);
  };
  install("fetch", dom.window.fetch);
  const auth = await import("../../../frontend/src/auth/cognitoAuth.js");
  auth.installAuthenticatedFetch();
  globalThis.fetch = dom.window.fetch;
  assert.equal(auth.isAuthEnabled(), true);
  const { createRoot } = await import("react-dom/client");
  const { default: AuthGate } = await import("../../../frontend/src/auth/AuthGate.js");
  const container = document.getElementById("root")!;
  let root: Root | null = null;
  const flush = async () => { await act(async () => { await new Promise(setImmediate); }); };
  const mount = async (path = "/login") => {
    window.history.replaceState({}, "", path);
    root = createRoot(container);
    await act(async () => { root!.render(<AuthGate />); });
    await flush();
  };
  const reset = async () => {
    if (root) await act(async () => root!.unmount());
    root = null;
    auth.logout();
    auth.resetTerminalAuthFailure();
    localStorage.clear();
    sessionStorage.clear();
    requests.length = 0;
  };
  const type = async (input: HTMLInputElement, value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const submit = async (form: HTMLFormElement) => {
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await flush();
  };
  const authenticated = () => response({ AuthenticationResult: { AccessToken: "test-access", IdToken: "test-id", RefreshToken: "test-refresh", ExpiresIn: 3600 } });
  const unconfirmed = () => response({ __type: "UserNotConfirmedException", message: "User is not confirmed." }, 400);
  try {
    await t.test("native signup forms collect only email/password and wait without storing the password", async () => {
      handle = (request) => request.action === "InitiateAuth" ? unconfirmed() : response({ UserConfirmed: false });
      await mount();
      const signup = container.querySelector<HTMLFormElement>('form[aria-label="Sign Up"]')!;
      const signin = container.querySelector<HTMLFormElement>('form[aria-label="Sign In"]')!;
      assert.ok(signup && signin);
      assert.equal(signup.querySelectorAll("input").length, 2);
      assert.equal(signin.querySelectorAll("input").length, 2);
      assert.match(signup.textContent!, /Create password/);
      const signupPassword = signup.querySelector<HTMLInputElement>('input[type="password"]')!;
      assert.equal(signupPassword.autocomplete, "new-password");
      await type(signup.querySelector('input[type="email"]')!, "NEW@Example.com");
      await type(signupPassword, " KeepMyPassword!9 ");
      await submit(signup);
      assert.deepEqual(requests.find((r) => r.action === "SignUp")?.body, {
        ClientId: "test-client", Username: "new@example.com", Password: " KeepMyPassword!9 ", UserAttributes: [{ Name: "email", Value: "new@example.com" }],
      });
      assert.match(container.textContent!, /Keep this page open/);
      assert.equal(signupPassword.value, "");
      assert.equal(auth.hasStoredToken(), false);
      assert.equal(localStorage.length, 0);
      assert.equal(sessionStorage.length, 0);
      assert.ok(!requests.some((r) => r.path.startsWith("/v1/")), "no Mango or mailbox request before confirmation");
      const stop = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Stop waiting")!;
      await act(async () => stop.click());
      await flush();
      assert.equal(signup.querySelector("button")!.disabled, false);
      assert.equal(auth.hasStoredToken(), false);
      await reset();
    });

    await t.test("confirmation on another device lets the original browser authenticate with its submitted password", async (subtest) => {
      subtest.mock.timers.enable({ apis: ["setTimeout"] });
      let confirmed = false;
      handle = () => confirmed ? authenticated() : unconfirmed();
      const result = auth.waitForSignupConfirmation("new@example.com", "original-password", new AbortController().signal);
      await new Promise(setImmediate);
      assert.equal(auth.hasStoredToken(), false);
      confirmed = true;
      subtest.mock.timers.tick(10_000);
      assert.deepEqual(await result, { status: "authenticated" });
      assert.ok(auth.hasStoredToken());
      assert.equal(requests.length, 2);
      assert.ok(requests.every((r) => r.body.AuthFlow === "USER_PASSWORD_AUTH" && r.body.AuthParameters.PASSWORD === "original-password"));
      assert.doesNotMatch(localStorage.getItem("mangorts:cognito-token-v2")!, /original-password/);
      subtest.mock.timers.reset();
      await reset();
    });

    await t.test("cancellation rejects a late successful login without storing its tokens", async () => {
      let finish!: (value: Response) => void;
      handle = () => new Promise((resolve) => { finish = resolve; });
      const controller = new AbortController();
      const pending = auth.waitForSignupConfirmation("new@example.com", "password", controller.signal);
      const rejected = assert.rejects(pending, { name: "AbortError" });
      await new Promise(setImmediate);
      controller.abort();
      finish(authenticated());
      await rejected;
      assert.equal(auth.hasStoredToken(), false);
      await reset();
    });

    await t.test("waiting is bounded and unrelated provider failures are not retried", async (subtest) => {
      subtest.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
      handle = unconfirmed;
      const pending = auth.waitForSignupConfirmation("new@example.com", "password", new AbortController().signal);
      const rejected = assert.rejects(pending, /Automatic sign-in timed out/);
      await new Promise(setImmediate);
      subtest.mock.timers.tick(600_001);
      await rejected;
      assert.equal(requests.length, 1);
      assert.equal(auth.hasStoredToken(), false);
      subtest.mock.timers.reset();
      requests.length = 0;
      handle = () => response({ __type: "NotAuthorizedException", message: "Incorrect username or password." }, 400);
      await assert.rejects(auth.waitForSignupConfirmation("new@example.com", "wrong", new AbortController().signal), /Incorrect email or password/);
      assert.equal(requests.length, 1);
      await reset();
    });

    await t.test("Cognito-only accounts can recover their password without a Mango profile", async () => {
      handle = () => response({ CodeDeliveryDetails: { DeliveryMedium: "EMAIL" } });
      assert.equal((await auth.forgotPassword(" NEW@Example.com ")).expires_in_seconds, 3600);
      assert.deepEqual(requests.map((r) => r.action), ["ForgotPassword"]);
      assert.equal(requests[0].body.Username, "new@example.com");
      await reset();
    });

    for (const existing of [false, true]) {
      await t.test(`${existing ? "existing" : "new"} invitee joins before current-user bootstrap`, async () => {
        const invitation = { invitation_id: "invite", company_id: "inviting-company", company_name: "Inviting Company", email: "invitee@example.com", role: "company_user", status: "pending", expires_timestamp: "2099-01-01" };
        handle = (request) => {
          if (request.path === "/v1/invitations/validate") return response({ invitation, account_exists: existing });
          if (request.path === "/v1/invitations/accept") return response({ invitation: { ...invitation, status: "accepted" } });
          if (request.path === "/v1/me") return new Promise(() => {});
          if (request.action === "InitiateAuth") return authenticated();
          return response({});
        };
        await mount("/accept-invite?token=valid-token");
        const form = container.querySelector<HTMLFormElement>('form[aria-label="Accept invitation"]')!;
        assert.ok(form);
        await type(form.querySelector('input[type="password"]')!, "chosen-password");
        await submit(form);
        const accepted = requests.find((r) => r.path === "/v1/invitations/accept")!;
        assert.ok(accepted);
        if (existing) {
          assert.equal(accepted.authorization, "Bearer test-id");
          assert.equal(accepted.body.password, undefined);
          assert.equal(accepted.body.email, undefined);
        } else {
          assert.equal(accepted.body.email, "invitee@example.com");
          assert.equal(accepted.body.password, "chosen-password");
        }
        assert.ok(requests.findIndex((r) => r.path === "/v1/me") > requests.indexOf(accepted));
        assert.equal(sessionStorage.getItem("mangorts:active-company-id-v1"), "inviting-company");
        assert.ok(!requests.some((r) => r.path.includes("communications")));
        await reset();
      });
    }

    await t.test("a partial Cognito signup recovers through its own password challenge", async () => {
      const invitation = { invitation_id: "invite", company_id: "inviting-company", company_name: "Inviting Company", email: "invitee@example.com", role: "company_user", status: "pending", expires_timestamp: "2099-01-01" };
      let acceptanceAttempts = 0;
      handle = (request) => {
        if (request.path === "/v1/invitations/validate") return response({ invitation, account_exists: false });
        if (request.path === "/v1/invitations/accept") {
          acceptanceAttempts++;
          return acceptanceAttempts === 1 ? response({ error: "existing_account_sign_in_required" }, 409) : response({ invitation });
        }
        if (request.action === "InitiateAuth") return response({ ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "temporary-session" });
        if (request.action === "RespondToAuthChallenge") return authenticated();
        if (request.path === "/v1/me") return new Promise(() => {});
        return response({});
      };
      await mount("/accept-invite?token=valid-token");
      const form = container.querySelector<HTMLFormElement>('form[aria-label="Accept invitation"]')!;
      const password = form.querySelector<HTMLInputElement>('input[type="password"]')!;
      await type(password, "chosen-password");
      await submit(form);
      assert.equal(password.autocomplete, "current-password");
      assert.match(container.textContent!, /existing password/);
      await type(password, "chosen-password");
      await submit(form);
      assert.equal(acceptanceAttempts, 2);
      const challenge = requests.find((request) => request.action === "RespondToAuthChallenge")!;
      assert.equal(challenge.body.Session, "temporary-session");
      assert.equal(challenge.body.ChallengeResponses.NEW_PASSWORD, "chosen-password");
      assert.equal(requests.filter((request) => request.path === "/v1/invitations/accept")[1].authorization, "Bearer test-id");
      await reset();
    });

    await t.test("a backend failure after joining never sends the user back to a consumed invitation", async () => {
      const invitation = { invitation_id: "invite", company_id: "inviting-company", email: "invitee@example.com", role: "company_user", status: "pending", expires_timestamp: "2099-01-01" };
      handle = (request) => {
        if (request.path === "/v1/invitations/validate") return response({ invitation, account_exists: false });
        if (request.path === "/v1/invitations/accept") return response({ invitation });
        if (request.path === "/v1/me") return response({ error: "authentication_unavailable" }, 503);
        return authenticated();
      };
      await mount("/accept-invite?token=valid-token");
      const form = container.querySelector<HTMLFormElement>('form[aria-label="Accept invitation"]')!;
      await type(form.querySelector('input[type="password"]')!, "password");
      await submit(form);
      assert.equal(window.location.pathname, "/login");
      assert.match(container.querySelector('[role="alert"]')!.textContent!, /Mango is temporarily unavailable/);
      assert.equal(requests.filter((request) => request.path === "/v1/invitations/validate").length, 1);
      await reset();
    });

    await t.test("a temporary backend error after login returns to Sign In with the error", async () => {
      handle = (request) => request.path === "/v1/me" ? response({ error: "authentication_unavailable" }, 503) : authenticated();
      await mount();
      const form = container.querySelector<HTMLFormElement>('form[aria-label="Sign In"]')!;
      await type(form.querySelector('input[type="email"]')!, "existing@example.com");
      await type(form.querySelector('input[type="password"]')!, "password");
      await submit(form);
      assert.equal(window.location.pathname, "/login");
      assert.match(container.querySelector('[role="alert"]')!.textContent!, /Mango is temporarily unavailable/);
      assert.ok(container.querySelector('form[aria-label="Sign In"]'));
      await reset();
    });
  } finally {
    await reset();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  }
});

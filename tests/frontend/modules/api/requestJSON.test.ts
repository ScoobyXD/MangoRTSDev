import test from "node:test";
import assert from "node:assert/strict";
import { requestJSON, requestJSONWithMeta } from "../../../../frontend/src/modules/api/requestJSON.js";

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(payload), { ...init, headers });
}

test("requestJSON serializes json bodies and default JSON headers", async () => {
  let seenURL = "";
  let seenBody: BodyInit | null | undefined;
  let seenHeaders = new Headers();
  const payload = await requestJSON<{ ok: boolean }>("https://api.example.test", "/v1/widgets", {
    auth: false,
    fetchImpl: async (input, init) => {
      seenURL = input.toString();
      seenBody = init?.body;
      seenHeaders = new Headers(init?.headers);
      return jsonResponse({ ok: true });
    },
    json: { title: "Alpha" },
    method: "POST",
  });

  assert.deepEqual(payload, { ok: true });
  assert.equal(seenURL, "https://api.example.test/v1/widgets");
  assert.equal(seenBody, JSON.stringify({ title: "Alpha" }));
  assert.equal(seenHeaders.get("Content-Type"), "application/json");
  assert.equal(seenHeaders.get("Accept"), "application/json");
});

test("requestJSON aborts requests when timeout elapses", async () => {
  let sawAbort = false;
  const fetchImpl: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing_abort_signal");
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        sawAbort = true;
        reject(signal.reason);
      }, { once: true });
    });
  };

  await assert.rejects(
    requestJSON("https://api.example.test", "/v1/slow", { auth: false, fetchImpl, timeoutMs: 1 }),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );
  assert.equal(sawAbort, true);
});

test("requestJSON parses structured API errors", async () => {
  await assert.rejects(
    requestJSON("https://api.example.test", "/v1/widgets", {
      auth: false,
      fetchImpl: async () => jsonResponse({ error: "widget_not_found" }, { status: 404, statusText: "Not Found" }),
    }),
    /widget_not_found/,
  );
});

test("requestJSON returns undefined for 204 responses", async () => {
  const payload = await requestJSON<unknown>("https://api.example.test", "/v1/widgets/1", {
    auth: false,
    fetchImpl: async () => new Response(null, { status: 204 }),
  });

  assert.equal(payload, undefined);
});

test("requestJSON adds bearer auth when an API token is available", async () => {
  let tokenRequests = 0;
  let authorizationHeader = "";
  await requestJSON("https://api.example.test", "/v1/widgets", {
    fetchImpl: async (_input, init) => {
      authorizationHeader = new Headers(init?.headers).get("Authorization") ?? "";
      return jsonResponse({ ok: true });
    },
    getAccessToken: async () => {
      tokenRequests += 1;
      return "access-token-1";
    },
  });

  assert.equal(tokenRequests, 1);
  assert.equal(authorizationHeader, "Bearer access-token-1");
});

test("requestJSON preserves caller Authorization headers", async () => {
  let tokenRequests = 0;
  let authorizationHeader = "";
  await requestJSON("https://api.example.test", "/v1/widgets", {
    fetchImpl: async (_input, init) => {
      authorizationHeader = new Headers(init?.headers).get("Authorization") ?? "";
      return jsonResponse({ ok: true });
    },
    getAccessToken: async () => {
      tokenRequests += 1;
      return "access-token-1";
    },
    headers: { Authorization: "Bearer caller-token" },
  });

  assert.equal(tokenRequests, 0);
  assert.equal(authorizationHeader, "Bearer caller-token");
});

test("requestJSON treats future 304 responses as empty successful reads", async () => {
  const payload = await requestJSON<unknown>("https://api.example.test", "/v1/widgets", {
    auth: false,
    fetchImpl: async () => new Response(null, { status: 304 }),
  });

  assert.equal(payload, undefined);
});

test("requestJSON propagates caller cancellation", async () => {
  let sawAbort = false;
  const controller = new AbortController();
  const reason = new DOMException("caller cancelled", "AbortError");
  const fetchImpl: typeof fetch = async (_input, init) => {
    const signal = init?.signal;
    if (!signal) throw new Error("missing_abort_signal");
    return new Promise<Response>((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        sawAbort = true;
        reject(signal.reason);
      }, { once: true });
    });
  };

  const promise = requestJSON("https://api.example.test", "/v1/cancel", {
    auth: false,
    fetchImpl,
    signal: controller.signal,
    timeoutMs: 0,
  });
  controller.abort(reason);

  await assert.rejects(promise, (error: unknown) => error === reason);
  assert.equal(sawAbort, true);
});

test("requestJSONWithMeta sends conditional headers and returns 304 metadata", async () => {
  let seenHeaders = new Headers();
  const response = await requestJSONWithMeta<unknown>("https://api.example.test", "/v1/widgets", {
    auth: false,
    fetchImpl: async (_input, init) => {
      seenHeaders = new Headers(init?.headers);
      return new Response(null, { status: 304, headers: { ETag: '"widgets-v1"' } });
    },
    headers: { "If-None-Match": '"widgets-v1"' },
  });

  assert.equal(seenHeaders.get("If-None-Match"), '"widgets-v1"');
  assert.equal(response.status, 304);
  assert.equal(response.ok, true);
  assert.equal(response.notModified, true);
  assert.equal(response.body, undefined);
  assert.equal(response.etag, '"widgets-v1"');
});

test("requestJSONWithMeta can return non-OK responses for cache fallbacks", async () => {
  const response = await requestJSONWithMeta<unknown>("https://api.example.test", "/v1/widgets", {
    auth: false,
    fetchImpl: async () => jsonResponse({ error: "temporarily_unavailable" }, { status: 503, statusText: "Unavailable" }),
    throwOnHTTPError: false,
  });

  assert.equal(response.status, 503);
  assert.equal(response.ok, false);
  assert.equal(response.notModified, false);
  assert.equal(response.body, undefined);
});

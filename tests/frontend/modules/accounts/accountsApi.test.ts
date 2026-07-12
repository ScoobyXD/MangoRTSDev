import test from "node:test";
import assert from "node:assert/strict";
import {
  emitAccountsUpdated,
  invalidateCompanyAccountsCache,
  listAccounts,
} from "../../../../frontend/src/modules/accounts/accountsApi.js";
import { logout } from "../../../../frontend/src/auth/cognitoAuth.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

test("company account reads are shared across mounted editors and invalidated before update events", async () => {
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred<Response>();
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    if (fetchCalls === 1) return firstResponse.promise;
    return new Response(JSON.stringify({
      accounts: [{ company_id: "company-1", account_id: "account-2", name: "Second", created_timestamp: "2026-07-12T00:00:00Z" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  invalidateCompanyAccountsCache();
  try {
    const first = listAccounts("company-1");
    const strictModeReplay = listAccounts("company-1");
    assert.equal(fetchCalls, 1);
    firstResponse.resolve(new Response(JSON.stringify({
      accounts: [{ company_id: "company-1", account_id: "account-1", name: "First", created_timestamp: "2026-07-12T00:00:00Z" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    assert.deepEqual((await first).map((account) => account.account_id), ["account-1"]);
    assert.deepEqual((await strictModeReplay).map((account) => account.account_id), ["account-1"]);
    assert.equal((await listAccounts("company-1"))[0]?.account_id, "account-1");
    assert.equal(fetchCalls, 1);

    emitAccountsUpdated("company-1");
    assert.equal((await listAccounts("company-1"))[0]?.account_id, "account-2");
    assert.equal(fetchCalls, 2);
  } finally {
    invalidateCompanyAccountsCache();
    globalThis.fetch = originalFetch;
  }
});

test("company account callers reject an old auth generation after an in-flight response", async () => {
  const originalFetch = globalThis.fetch;
  const response = deferred<Response>();
  globalThis.fetch = (async () => response.promise) as typeof fetch;
  invalidateCompanyAccountsCache();
  try {
    const read = listAccounts("company-stale-auth");
    logout();
    response.resolve(new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await assert.rejects(read, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
  } finally {
    invalidateCompanyAccountsCache();
    globalThis.fetch = originalFetch;
  }
});

test("company account invalidation aborts an obsolete in-flight caller", async () => {
  const originalFetch = globalThis.fetch;
  const firstResponse = deferred<Response>();
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (calls === 1) return firstResponse.promise;
    return new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  const companyID = "company-invalidation";
  invalidateCompanyAccountsCache(companyID);
  try {
    const staleRead = listAccounts(companyID);
    invalidateCompanyAccountsCache(companyID);
    firstResponse.resolve(new Response(JSON.stringify({ accounts: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await assert.rejects(staleRead, (cause: unknown) => cause instanceof DOMException && cause.name === "AbortError");
    await listAccounts(companyID);
    assert.equal(calls, 2);
  } finally {
    invalidateCompanyAccountsCache(companyID);
    globalThis.fetch = originalFetch;
  }
});

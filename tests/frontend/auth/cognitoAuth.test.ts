import assert from "node:assert/strict";
import test from "node:test";
import { hasStoredToken, logout } from "../../../frontend/src/auth/cognitoAuth.js";

const TOKEN_KEY = "mangorts:cognito-token-v2";

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } as Storage;
}

function installStorage(name: "localStorage" | "sessionStorage", storage: Storage): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value: storage });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

function storedToken(expiresAt = Date.now() + 60_000): string {
  return JSON.stringify({ access_token: "access-token", expires_at: expiresAt });
}

test("auth token is shared through localStorage for same-browser tabs", () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const restoreLocal = installStorage("localStorage", local);
  const restoreSession = installStorage("sessionStorage", session);
  try {
    local.setItem(TOKEN_KEY, storedToken());
    assert.equal(hasStoredToken(), true);

    logout();
    assert.equal(local.getItem(TOKEN_KEY), null);
    assert.equal(session.getItem(TOKEN_KEY), null);
  } finally {
    restoreLocal();
    restoreSession();
  }
});

test("auth token migrates a legacy sessionStorage token into localStorage", () => {
  const local = createMemoryStorage();
  const session = createMemoryStorage();
  const restoreLocal = installStorage("localStorage", local);
  const restoreSession = installStorage("sessionStorage", session);
  try {
    session.setItem(TOKEN_KEY, storedToken());
    assert.equal(hasStoredToken(), true);
    assert.equal(local.getItem(TOKEN_KEY), session.getItem(TOKEN_KEY));
  } finally {
    restoreLocal();
    restoreSession();
  }
});

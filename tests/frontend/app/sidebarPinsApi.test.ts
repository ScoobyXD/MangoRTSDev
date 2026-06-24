import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSidebarPin,
  deleteSidebarPin,
  fetchSidebarPins,
  reorderSidebarPins,
} from "../../../frontend/src/app/sidebarPinsApi.js";

type CapturedRequest = {
  url: string;
  method: string;
  body: string;
};

const PIN_RECORD = {
  pin_id: "pin-1",
  company_id: "company-1",
  user_id: "user-1",
  resource_type: "node",
  resource_id: "node-1",
  name: "Node One",
  position: 10,
  created_timestamp: "2026-06-24T12:00:00Z",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createTrackingStorage(touchedKeys: string[]): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      touchedKeys.push(key);
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      touchedKeys.push(key);
      values.delete(key);
    },
    setItem(key: string, value: string) {
      touchedKeys.push(key);
      values.set(key, value);
    },
  } as Storage;
}

function installGlobal<T extends "fetch" | "localStorage" | "sessionStorage">(name: T, value: typeof globalThis[T]): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete (globalThis as Record<string, unknown>)[name];
  };
}

describe("sidebarPinsApi", () => {
  it("uses only the DB-backed user-pins API and never browser pin storage", async () => {
    const requests: CapturedRequest[] = [];
    const touchedStorageKeys: string[] = [];
    const restoreLocalStorage = installGlobal("localStorage", createTrackingStorage(touchedStorageKeys));
    const restoreSessionStorage = installGlobal("sessionStorage", createTrackingStorage(touchedStorageKeys));
    const restoreFetch = installGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : "";
      requests.push({ url, method, body });

      if (method === "GET" && url === "https://api.example.test/v1/user-pins?company_id=company-1") {
        return jsonResponse({ user_pins: [PIN_RECORD] });
      }
      if (method === "POST" && url === "https://api.example.test/v1/user-pins") {
        return jsonResponse(PIN_RECORD);
      }
      if (method === "DELETE" && url === "https://api.example.test/v1/user-pins/pin-1?company_id=company-1") {
        return jsonResponse({ deleted: true });
      }
      if (method === "PUT" && url === "https://api.example.test/v1/user-pins/order") {
        return jsonResponse({ user_pins: [PIN_RECORD] });
      }
      throw new Error(`unexpected sidebar pin request: ${method} ${url}`);
    }) as typeof fetch);

    try {
      const fetched = await fetchSidebarPins("https://api.example.test", "company-1");
      const created = await createSidebarPin("https://api.example.test", "company-1", {
        kind: "node",
        id: "node-1",
        name: "Client Name Is Not Persisted",
      });
      await deleteSidebarPin("https://api.example.test", "company-1", "pin-1");
      const reordered = await reorderSidebarPins("https://api.example.test", "company-1", ["pin-1"]);

      assert.equal(fetched[0]?.pinID, "pin-1");
      assert.equal(created.name, "Node One");
      assert.equal(reordered[0]?.position, 10);
      assert.equal(requests.some((request) => request.url.includes("/v1/pins")), false);
      assert.deepEqual(
        JSON.parse(requests.find((request) => request.method === "POST")?.body ?? "{}"),
        {
          company_id: "company-1",
          resource_type: "node",
          resource_id: "node-1",
        },
      );
      assert.deepEqual(
        JSON.parse(requests.find((request) => request.method === "PUT")?.body ?? "{}"),
        {
          company_id: "company-1",
          pin_ids: ["pin-1"],
        },
      );
      assert.equal(touchedStorageKeys.some((key) => /pin/i.test(key)), false);
    } finally {
      restoreFetch();
      restoreSessionStorage();
      restoreLocalStorage();
    }
  });
});
